import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";

const LOCAL_EXCHANGE_DIR = path.resolve(".vetbara-local/packages");
const LOCAL_TEST_PACKAGES_DIR = path.resolve(".vetbara-local/test-packages");
const LOCAL_AUTHORING_DRAFTS_DIR = path.resolve(".vetbara-local/authoring-drafts");
const LOCAL_PACKAGE_HISTORY_DIR = path.resolve(".vetbara-local/package-history");
const LOCAL_CENTRE_LINKS_DIR = path.resolve(".vetbara-local/centre-links");
const LOCAL_TRANSLATION_OVERRIDES_FILE = path.resolve(".vetbara-local/translation-overrides.json");
const ACTIVE_TEST_PACKAGE_FILE = path.resolve(".vetbara-local/active-test-package.json");
const LOCAL_FIELD_PREPARATIONS_DIR = path.resolve(".vetbara-local/field-preparations");
const LOCAL_FIELD_TABLET_SYNC_DIR = path.resolve(".vetbara-local/field-tablet-sync");
const LOCAL_SCAN_INBOX_DIR = path.resolve(".vetbara-local/scan-inbox");
const LOCAL_EXAMINER_RESULTS_FILE = path.resolve(".vetbara-local/examiner-results.json");
const execFileAsync = promisify(execFile);

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function readBody(req, limitBytes = 80 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function localExchangePlugin() {
  return {
    name: "vetbara-local-exchange",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");

          if (url.pathname.startsWith("/api/local-results")) {
            await fs.mkdir(path.dirname(LOCAL_EXAMINER_RESULTS_FILE), { recursive: true });

            async function readResultsFile() {
              try {
                const raw = await fs.readFile(LOCAL_EXAMINER_RESULTS_FILE, "utf8");
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
              } catch {
                return {};
              }
            }

            async function writeResultsFile(results) {
              await fs.writeFile(LOCAL_EXAMINER_RESULTS_FILE, JSON.stringify(results, null, 2));
            }

            if (req.method === "GET" && url.pathname === "/api/local-results") {
              sendJson(res, 200, { ok: true, results: await readResultsFile() });
              return;
            }

            if (req.method === "POST" && url.pathname === "/api/local-results") {
              const raw = await readBody(req);
              const data = JSON.parse(raw || "{}");
              const records = Array.isArray(data.records) ? data.records : [data];
              const results = await readResultsFile();

              for (const record of records) {
                if (!record?.candidateId || !record?.field) continue;
                const candidateId = String(record.candidateId);
                const field = String(record.field);
                const previousCandidate = results[candidateId] && typeof results[candidateId] === "object" ? results[candidateId] : {};
                const previousField = previousCandidate[field] && typeof previousCandidate[field] === "object" ? previousCandidate[field] : {};
                results[candidateId] = {
                  ...previousCandidate,
                  [field]: {
                    ...previousField,
                    ...record,
                    candidateId,
                    field,
                    value: record.value === "" || record.value === null || record.value === undefined ? null : Number(record.value),
                    max: record.max === "" || record.max === null || record.max === undefined ? previousField.max ?? null : Number(record.max),
                    updatedAt: record.updatedAt || new Date().toISOString(),
                  },
                };
              }

              await writeResultsFile(results);
              sendJson(res, 200, { ok: true, results });
              return;
            }

            sendJson(res, 405, { error: "Method not allowed" });
            return;
          }

          if (!url.pathname.startsWith("/api/local-exchange/packages")) {
            next();
            return;
          }

          await fs.mkdir(LOCAL_EXCHANGE_DIR, { recursive: true });

          if (req.method === "GET" && url.pathname === "/api/local-exchange/packages") {
            const files = await fs.readdir(LOCAL_EXCHANGE_DIR);
            const packages = [];

            for (const file of files.filter((name) => name.endsWith(".json"))) {
              try {
                const raw = await fs.readFile(path.join(LOCAL_EXCHANGE_DIR, file), "utf8");
                const data = JSON.parse(raw);
                packages.push({
                  packageId: data.packageId,
                  candidateId: data.candidateId,
                  candidateName: data.candidateName,
                  level: data.level,
                  variantCode: data.variantCode,
                  createdAt: data.createdAt,
                  storedAt: data.storedAt,
                  reportPhotoCount: JSON.stringify(data.reportDraft || {}).match(/"dataUrl"/g)?.length ?? 0,
                  filename: file,
                });
              } catch {
                // Ignore malformed package files.
              }
            }

            packages.sort((a, b) =>
              String(b.storedAt || b.createdAt || "").localeCompare(String(a.storedAt || a.createdAt || ""))
            );
            sendJson(res, 200, { packages });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/local-exchange/packages") {
            const raw = await readBody(req);
            const data = JSON.parse(raw);

            if (data?.kind !== "vetbara.offlineCandidatePackage.v1" || !data.candidateId) {
              sendJson(res, 400, { error: "Invalid VetBara candidate package" });
              return;
            }

            const packageId = data.packageId || `pkg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
            const stored = {
              ...data,
              packageId,
              storedAt: new Date().toISOString(),
            };

            const safeCandidateId = String(data.candidateId).replace(/[^a-z0-9_-]/gi, "_");
            const filename = `${stored.storedAt.replace(/[:.]/g, "-")}-${safeCandidateId}-${packageId}.json`;
            await fs.writeFile(path.join(LOCAL_EXCHANGE_DIR, filename), JSON.stringify(stored, null, 2));

            sendJson(res, 201, { ok: true, packageId, filename });
            return;
          }

          const match = url.pathname.match(/^\/api\/local-exchange\/packages\/([^/]+)$/);

          if (req.method === "GET" && match) {
            const packageId = decodeURIComponent(match[1]);
            const files = await fs.readdir(LOCAL_EXCHANGE_DIR);

            for (const file of files.filter((name) => name.endsWith(".json"))) {
              const raw = await fs.readFile(path.join(LOCAL_EXCHANGE_DIR, file), "utf8");
              const data = JSON.parse(raw);
              if (data.packageId === packageId) {
                sendJson(res, 200, data);
                return;
              }
            }

            sendJson(res, 404, { error: "Package not found" });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(res, 500, { error: error.message || "Local exchange failed" });
        }
      });
    },
  };
}


async function readBinaryBody(req, limitBytes = 120 * 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > limitBytes) {
      throw new Error(`Request body too large: ${total} bytes`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function multipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(.+)$/i);
  return match ? match[1] : "";
}

function parseMultipartFiles(buffer, boundary) {
  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`);
  const files = {};

  for (const part of parts) {
    if (!part.includes("Content-Disposition")) continue;

    const nameMatch = part.match(/name="([^"]+)"/);
    const filenameMatch = part.match(/filename="([^"]*)"/);
    if (!nameMatch || !filenameMatch) continue;

    const name = nameMatch[1];
    const filename = filenameMatch[1];
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    let body = part.slice(headerEnd + 4);
    body = body.replace(/\r\n$/, "");

    files[name] = {
      filename,
      buffer: Buffer.from(body, "binary"),
    };
  }

  return files;
}

function normalizePdfLine(line) {
  return String(line || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfNoiseLine(line) {
  const value = normalizePdfLine(line);

  return (
    !value ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(value) ||
    /^--\s*\d+\s+of\s+\d+\s*--\s*\d+$/i.test(value) ||
    /^\d+$/.test(value) ||
    /^End of Document$/i.test(value) ||
    /^VETCERT$/i.test(value) ||
    /^Written exam paper/i.test(value) ||
    /^Paper:\s*\d+/i.test(value) ||
    /^Version:/i.test(value) ||
    /^For examiner use only$/i.test(value) ||
    /^Total marks for section/i.test(value) ||
    /^Question Notes Marks$/i.test(value) ||
    /^(Practising|Practicing|Consulting) level/i.test(value)
  );
}

function cleanPdfLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(normalizePdfLine)
    .filter((line) => !isPdfNoiseLine(line));
}

function extractMarksFromText(value) {
  const match = String(value || "").match(/\((\d+(?:\.\d+)?)\s*marks?\)|\/\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1] || match[2]) : 0;
}

function stripMarksFromText(value) {
  return String(value || "")
    .replace(/\((\d+(?:\.\d+)?)\s*marks?\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionStart(line) {
  return /^\d+\.\s+/.test(String(line || ""));
}

function isThemeLine(line) {
  return /^Theme\s*[-–]/i.test(String(line || ""));
}

function isSectionLine(line) {
  return /^Section\s+[A-Z]/i.test(String(line || ""));
}

function parseMcqQuestion(lines, index, level, section, theme) {
  const first = lines[index];
  const q = first.match(/^(\d+)\.\s+(.+)/);
  const number = Number(q[1]);

  let i = index + 1;
  let questionText = q[2];
  const options = [];
  let correctAnswer = "";

  while (i < lines.length) {
    const line = lines[i];

    if (/^A\.\s+/i.test(line)) break;
    if (isQuestionStart(line) || isSectionLine(line) || isThemeLine(line)) break;

    questionText += " " + line;
    i += 1;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^Answer\s+[A-D]\b/i.test(line)) {
      correctAnswer = (line.match(/^Answer\s+([A-D])\b/i) || [])[1]?.toUpperCase() || "";
      i += 1;
      break;
    }

    if (isQuestionStart(line) || isSectionLine(line) || isThemeLine(line)) break;

    const optionStart = line.match(/^([A-D])\.\s+(.+)/i);
    if (optionStart) {
      const letter = optionStart[1].toUpperCase();
      let optionText = optionStart[2];
      i += 1;

      while (i < lines.length) {
        const next = lines[i];

        if (/^[A-D]\.\s+/i.test(next)) break;
        if (/^Answer\s+[A-D]\b/i.test(next)) break;
        if (isQuestionStart(next) || isSectionLine(next) || isThemeLine(next)) break;

        optionText += " " + next;
        i += 1;
      }

      options.push(`${letter}. ${optionText.trim()}`);
      continue;
    }

    i += 1;
  }

  return {
    item: {
      id: `P-W-A${String(number).padStart(2, "0")}`,
      number,
      section,
      theme,
      type: "multipleChoice",
      text: stripMarksFromText(questionText),
      options,
      correctAnswer,
      scoringHelp: "",
      max: 1,
    },
    nextIndex: i,
  };
}

function parseWrittenQuestion(lines, index, level, section, theme) {
  const first = lines[index];
  const q = first.match(/^(\d+)\.\s+(.+)/);
  const number = Number(q[1]);

  let i = index + 1;
  let questionText = q[2];
  let max = extractMarksFromText(questionText);
  let questionClosed = max > 0;
  let scoringHelp = "";

  while (i < lines.length) {
    const line = lines[i];

    if (isSectionLine(line) || isThemeLine(line)) break;

    const nextQuestion = line.match(/^(\d+)\.\s+(.+)/);
    if (nextQuestion) {
      const nextNumber = Number(nextQuestion[1]);

      // Treat lower/equal numbers as sub-items inside the current answer,
      // e.g. "1. Soil compaction / 2. Change of soil level" inside Practicing Q7.
      if (nextNumber > number) break;
    }

    const lineMarks = extractMarksFromText(line);

    if (!questionClosed) {
      questionText += " " + line;

      // Re-check the combined text because PDFs often split "(3 marks)"
      // across two physical lines: "(3" + "marks)".
      max = extractMarksFromText(questionText) || lineMarks || max;
      questionClosed = max > 0;
    } else {
      scoringHelp += (scoringHelp ? "\n" : "") + line;
    }

    i += 1;
  }

  max = max || extractMarksFromText(questionText) || extractMarksFromText(scoringHelp);

  return {
    item: {
      id: `${level === "Consulting" ? "C" : "P"}-W-B${String(number).padStart(2, "0")}`,
      number,
      section,
      theme,
      type: "written",
      text: stripMarksFromText(questionText),
      options: [],
      correctAnswer: "",
      scoringHelp: scoringHelp.trim(),
      max,
    },
    nextIndex: i,
  };
}

function parseQuestionBlocksFromWrittenText(text, level) {
  const lines = cleanPdfLines(text);
  const questions = [];

  let section = "";
  let theme = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isSectionLine(line)) {
      section = line;
      i += 1;
      continue;
    }

    if (isThemeLine(line)) {
      theme = line;
      section = section || line;
      i += 1;
      continue;
    }

    if (!isQuestionStart(line)) {
      i += 1;
      continue;
    }

    const isPracticingSectionA =
      level === "Practicing" &&
      /^Section A/i.test(section || "") &&
      /^\d+\.\s+/.test(line);

    const parsed = isPracticingSectionA
      ? parseMcqQuestion(lines, i, level, section, theme)
      : parseWrittenQuestion(lines, i, level, section || theme, theme);

    if (parsed.item.max > 0 || parsed.item.options.length > 0) {
      questions.push(parsed.item);
    }

    i = parsed.nextIndex;
  }

  return questions;
}

function parseOutdoorBlocksFromText(text, level) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const exercises = [];
  let section = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^Section\s+\d+/i.test(line) || /^Exercise\s+\d+/i.test(line)) section = line;

    const q = line.match(/^Question\s+([0-9]+[a-z]?)/i);
    if (!q) {
      i += 1;
      continue;
    }

    const number = q[1];
    let question = "";
    let examinerGuidance = "";
    let max = Number((line.match(/\/\s*(\d+(?:\.\d+)?)/) || [])[1] || 0);

    i += 1;

    while (i < lines.length) {
      const current = lines[i];

      if (/^Question\s+[0-9]+[a-z]?/i.test(current)) break;

      const marks = current.match(/\/\s*(\d+(?:\.\d+)?)|\((\d+(?:\.\d+)?)\s*marks?\)/i);
      if (!max && marks) max = Number(marks[1] || marks[2]);

      if (!question && !/^Question$|^Notes$|^Marks$/i.test(current)) {
        question = current;
      } else {
        examinerGuidance += (examinerGuidance ? "\n" : "") + current;
      }

      i += 1;
    }

    exercises.push({
      id: `${level === "Consulting" ? "C" : "P"}-OUT-Q${String(number).toUpperCase()}`,
      number,
      section,
      question,
      examinerGuidance: examinerGuidance.trim(),
      max,
    });
  }

  return exercises;
}

async function pdfText(file) {
  if (!file?.buffer?.length) return "";

  try {
    const parser = new PDFParse({ data: file.buffer });

    try {
      const result = await parser.getText();
      return result?.text || "";
    } finally {
      await parser.destroy?.();
    }
  } catch (pdfParseError) {
    const tmpName = `vetbara-pdf-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    const tmpPath = path.join(LOCAL_TEST_PACKAGES_DIR, tmpName);

    await fs.mkdir(LOCAL_TEST_PACKAGES_DIR, { recursive: true });
    await fs.writeFile(tmpPath, file.buffer);

    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", tmpPath, "-"], {
        maxBuffer: 80 * 1024 * 1024,
      });

      if (!String(stdout || "").trim()) {
        throw new Error(`pdftotext returned empty text after pdf-parse failed: ${pdfParseError.message}`);
      }

      return stdout;
    } catch (fallbackError) {
      throw new Error(
        `PDF text extraction failed for ${file.filename || "uploaded PDF"}. ` +
        `pdf-parse: ${pdfParseError.message}. ` +
        `pdftotext fallback: ${fallbackError.message}. ` +
        `Install fallback with: brew install poppler`
      );
    } finally {
      try {
        await fs.unlink(tmpPath);
      } catch {}
    }
  }
}

function validateCertificationPackage(data) {
  const issues = [];

  const pwCount = data?.written?.Practicing?.questions?.length ?? 0;
  const pwMax = data?.variants?.Practicing?.writtenMax ?? 0;
  const cwCount = data?.written?.Consulting?.questions?.length ?? 0;
  const cwMax = data?.variants?.Consulting?.writtenMax ?? 0;

  if (pwCount !== 34 || Number(pwMax) !== 46) {
    issues.push(`Practicing written expected 34 questions / 46 marks, got ${pwCount} / ${pwMax}`);
  }

  if (cwCount !== 45 || Number(cwMax) !== 97) {
    issues.push(`Consulting written expected 45 questions / 97 marks, got ${cwCount} / ${cwMax}`);
  }

  return {
    status: issues.length ? "requires_review" : "valid",
    issues,
    checkedAt: new Date().toISOString(),
  };
}

function makeCertificationPackage({ practicingWrittenText, consultingWrittenText, practicingOutdoorText, consultingOutdoorText, sourceFiles }) {
  const practicingWritten = parseQuestionBlocksFromWrittenText(practicingWrittenText, "Practicing");
  const consultingWritten = parseQuestionBlocksFromWrittenText(consultingWrittenText, "Consulting");
  const practicingOutdoor = parseOutdoorBlocksFromText(practicingOutdoorText, "Practicing");
  const consultingOutdoor = parseOutdoorBlocksFromText(consultingOutdoorText, "Consulting");

  const data = {
    kind: "vetbara.certificationPackage.v1",
    packageId: `vetbara-cert-package-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    createdAt: new Date().toISOString(),
    sourceFiles,
    uiLanguageIndependent: true,
    variants: {
      Practicing: {
        code: "PRACTICING_ADMIN_PACKAGE",
        level: "Practicing",
        writtenQuestionCount: practicingWritten.length,
        writtenMax: practicingWritten.reduce((sum, q) => sum + Number(q.max || 0), 0),
        outdoorItemCount: practicingOutdoor.length,
        outdoorMax: practicingOutdoor.reduce((sum, q) => sum + Number(q.max || 0), 0),
      },
      Consulting: {
        code: "CONSULTING_ADMIN_PACKAGE",
        level: "Consulting",
        writtenQuestionCount: consultingWritten.length,
        writtenMax: consultingWritten.reduce((sum, q) => sum + Number(q.max || 0), 0),
        outdoorItemCount: consultingOutdoor.length,
        outdoorMax: consultingOutdoor.reduce((sum, q) => sum + Number(q.max || 0), 0),
      },
    },
    written: {
      Practicing: {
        level: "Practicing",
        questions: practicingWritten,
      },
      Consulting: {
        level: "Consulting",
        questions: consultingWritten,
      },
    },
    outdoor: {
      Practicing: {
        level: "Practicing",
        exercises: practicingOutdoor,
      },
      Consulting: {
        level: "Consulting",
        exercises: consultingOutdoor,
      },
    },
  };

  data.validation = validateCertificationPackage(data);
  return data;
}

async function readLocalTestPackages() {
  await fs.mkdir(LOCAL_TEST_PACKAGES_DIR, { recursive: true });

  const files = (await fs.readdir(LOCAL_TEST_PACKAGES_DIR)).filter((file) => file.endsWith(".json"));
  const packages = [];

  for (const file of files) {
    try {
      const filepath = path.join(LOCAL_TEST_PACKAGES_DIR, file);
      const data = JSON.parse(await fs.readFile(filepath, "utf8"));
      packages.push({ file, filepath, data });
    } catch {}
  }

  packages.sort((a, b) => String(b.data?.createdAt || "").localeCompare(String(a.data?.createdAt || "")));
  return packages;
}

async function findLocalTestPackage(packageId) {
  const packages = await readLocalTestPackages();
  return packages.find((item) => item.data?.packageId === packageId) || null;
}

function summarizeCertificationPackage(data, filename = "") {
  return {
    packageId: data.packageId,
    createdAt: data.createdAt,
    filename,
    variants: data.variants,
    sourceFiles: data.sourceFiles,
    validation: data.validation,
    approval: data.approval,
  };
}

function safeFilenamePart(value, fallback = "item") {
  const cleaned = String(value || fallback).replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  return cleaned || fallback;
}

function validateAuthoringDraft(draft) {
  if (!draft || draft.kind !== "vetbara.structuredAuthoringDraft.v1") {
    throw new Error("Invalid VetBara structured authoring draft");
  }

  if (!draft.documents || typeof draft.documents !== "object") {
    throw new Error("Authoring draft is missing documents");
  }
}

function summarizeAuthoringDraft(draft, filename = "") {
  const docs = draft?.documents || {};
  const docSummaries = {};

  for (const [key, doc] of Object.entries(docs)) {
    const list = Array.isArray(doc?.questions) ? doc.questions : Array.isArray(doc?.exercises) ? doc.exercises : [];
    docSummaries[key] = {
      count: list.length,
      max: list.reduce((sum, item) => sum + Number(item?.max || 0), 0),
    };
  }

  return {
    draftId: draft?.draftId || draft?.packageId,
    packageId: draft?.packageId,
    title: draft?.title,
    version: draft?.version,
    language: draft?.language,
    createdAt: draft?.createdAt,
    updatedAt: draft?.updatedAt,
    storedAt: draft?.storedAt,
    filename,
    documents: docSummaries,
  };
}

async function readLocalAuthoringDrafts() {
  await fs.mkdir(LOCAL_AUTHORING_DRAFTS_DIR, { recursive: true });
  const files = (await fs.readdir(LOCAL_AUTHORING_DRAFTS_DIR)).filter((file) => file.endsWith(".json"));
  const drafts = [];

  for (const file of files) {
    try {
      const filepath = path.join(LOCAL_AUTHORING_DRAFTS_DIR, file);
      const data = JSON.parse(await fs.readFile(filepath, "utf8"));
      drafts.push({ file, filepath, data });
    } catch {
      // Ignore malformed draft files.
    }
  }

  drafts.sort((a, b) => String(b.data?.storedAt || b.data?.updatedAt || "").localeCompare(String(a.data?.storedAt || a.data?.updatedAt || "")));
  return drafts;
}

function testPackageAdminPlugin() {
  return {
    name: "vetbara-test-package-admin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");

          if (
            !url.pathname.startsWith("/api/admin/test-package") &&
            !url.pathname.startsWith("/api/admin/authoring-drafts") &&
            !url.pathname.startsWith("/api/admin/package-history") &&
            !url.pathname.startsWith("/api/admin/centre-links") &&
            !url.pathname.startsWith("/api/translations/overrides") &&
            !url.pathname.startsWith("/api/centre/test-package")
          ) {
            next();
            return;
          }

          await fs.mkdir(LOCAL_TEST_PACKAGES_DIR, { recursive: true });
          await fs.mkdir(LOCAL_AUTHORING_DRAFTS_DIR, { recursive: true });
          await fs.mkdir(LOCAL_PACKAGE_HISTORY_DIR, { recursive: true });
          await fs.mkdir(LOCAL_CENTRE_LINKS_DIR, { recursive: true });

          if (req.method === "GET" && url.pathname === "/api/admin/authoring-drafts/list") {
            const drafts = await readLocalAuthoringDrafts();
            sendJson(res, 200, { drafts: drafts.map((item) => summarizeAuthoringDraft(item.data, item.file)) });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/admin/authoring-drafts/latest") {
            const drafts = await readLocalAuthoringDrafts();
            if (!drafts.length) {
              sendJson(res, 404, { error: "No structured authoring draft found" });
              return;
            }
            sendJson(res, 200, drafts[0].data);
            return;
          }

          const authoringMatch = url.pathname.match(/^\/api\/admin\/authoring-drafts\/([^/]+)$/);

          if (req.method === "GET" && authoringMatch) {
            const draftId = decodeURIComponent(authoringMatch[1]);
            const drafts = await readLocalAuthoringDrafts();
            const found = drafts.find((item) => item.data?.draftId === draftId || item.data?.packageId === draftId || item.file === draftId);
            if (!found) {
              sendJson(res, 404, { error: `Authoring draft not found: ${draftId}` });
              return;
            }
            sendJson(res, 200, found.data);
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/admin/authoring-drafts/save") {
            const raw = await readBody(req, 40 * 1024 * 1024);
            const body = JSON.parse(raw || "{}");
            const incoming = body.draft;
            validateAuthoringDraft(incoming);

            const storedAt = new Date().toISOString();
            const draftId = incoming.draftId || `vetbara-authoring-draft-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
            const draft = {
              ...incoming,
              draftId,
              updatedAt: incoming.updatedAt || storedAt,
              storedAt,
            };

            const filename = `${storedAt.replace(/[:.]/g, "-")}-${safeFilenamePart(draftId)}.json`;
            await fs.writeFile(path.join(LOCAL_AUTHORING_DRAFTS_DIR, filename), JSON.stringify(draft, null, 2));
            sendJson(res, 201, { ok: true, filename, draft, summary: summarizeAuthoringDraft(draft, filename) });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/admin/test-package/list") {
            const files = (await fs.readdir(LOCAL_TEST_PACKAGES_DIR)).filter((file) => file.endsWith(".json"));
            const packages = [];

            for (const file of files) {
              try {
                const data = JSON.parse(await fs.readFile(path.join(LOCAL_TEST_PACKAGES_DIR, file), "utf8"));
                packages.push(summarizeCertificationPackage(data, file));
              } catch {}
            }

            packages.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
            sendJson(res, 200, { packages });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/admin/test-package/latest") {
            const files = (await fs.readdir(LOCAL_TEST_PACKAGES_DIR)).filter((file) => file.endsWith(".json"));
            let latest = null;

            for (const file of files) {
              try {
                const data = JSON.parse(await fs.readFile(path.join(LOCAL_TEST_PACKAGES_DIR, file), "utf8"));
                if (!latest || String(data.createdAt || "") > String(latest.createdAt || "")) latest = data;
              } catch {}
            }

            if (!latest) {
              sendJson(res, 404, { error: "No local test package found" });
              return;
            }

            sendJson(res, 200, latest);
            return;
          }

          if (req.method === "GET" && (url.pathname === "/api/admin/test-package/approved" || url.pathname === "/api/centre/test-package/active")) {
            try {
              const data = JSON.parse(await fs.readFile(ACTIVE_TEST_PACKAGE_FILE, "utf8"));
              sendJson(res, 200, data);
            } catch {
              sendJson(res, 404, { error: "No approved active test package found" });
            }
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/admin/test-package/approve") {
            const body = JSON.parse(await readBody(req, 1024 * 1024) || "{}");
            const packageId = body.packageId;
            const allowRequiresReview = Boolean(body.allowRequiresReview);
            const reason = String(body.reason || "").trim();

            if (!packageId) {
              sendJson(res, 400, { error: "Missing packageId" });
              return;
            }

            const found = await findLocalTestPackage(packageId);

            if (!found) {
              sendJson(res, 404, { error: `Package not found: ${packageId}` });
              return;
            }

            const validationStatus = found.data?.validation?.status || "unknown";

            if (validationStatus !== "valid" && !allowRequiresReview) {
              sendJson(res, 409, {
                error: "Package requires review and cannot be approved without explicit override",
                validation: found.data.validation,
              });
              return;
            }

            if (validationStatus !== "valid" && !reason) {
              sendJson(res, 400, {
                error: "Override reason is required for requires_review package",
                validation: found.data.validation,
              });
              return;
            }

            const approved = {
              ...found.data,
              approval: {
                status: "approved",
                approvedAt: new Date().toISOString(),
                approvedForCentre: true,
                allowRequiresReview,
                reason,
              },
              activeForCentre: true,
            };

            await fs.writeFile(found.filepath, JSON.stringify(approved, null, 2));
            await fs.writeFile(ACTIVE_TEST_PACKAGE_FILE, JSON.stringify(approved, null, 2));

            sendJson(res, 200, { ok: true, package: approved, summary: summarizeCertificationPackage(approved, found.file) });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/admin/test-package/authoring/save") {
            const raw = await readBody(req, 40 * 1024 * 1024);
            const body = JSON.parse(raw || "{}");
            const incoming = body.package;

            if (!incoming || incoming.kind !== "vetbara.certificationPackage.v1") {
              sendJson(res, 400, { error: "Invalid VetBara certification package" });
              return;
            }

            const data = {
              ...incoming,
              packageId: incoming.packageId || `vetbara-authored-package-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
              createdAt: new Date().toISOString(),
              contentSource: incoming.contentSource || "admin-structured-authoring",
            };

            data.validation = validateCertificationPackage(data);

            const filename = `${data.createdAt.replace(/[:.]/g, "-")}-${data.packageId}.json`;
            await fs.writeFile(path.join(LOCAL_TEST_PACKAGES_DIR, filename), JSON.stringify(data, null, 2));

            sendJson(res, 201, { ok: true, filename, package: data, summary: summarizeCertificationPackage(data, filename) });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/admin/test-package/convert") {
            const contentType = req.headers["content-type"] || "";
            const boundary = multipartBoundary(contentType);
            if (!boundary) {
              sendJson(res, 400, { error: "Missing multipart boundary" });
              return;
            }

            const raw = await readBinaryBody(req, 120 * 1024 * 1024);
            const files = parseMultipartFiles(raw, boundary);

            const sourceFiles = Object.fromEntries(
              Object.entries(files).map(([key, file]) => [key, file.filename])
            );

            const practicingWrittenText = await pdfText(files.practicingWritten);
            const consultingWrittenText = await pdfText(files.consultingWritten);
            const practicingOutdoorText = await pdfText(files.practicingOutdoor);
            const consultingOutdoorText = await pdfText(files.consultingOutdoor);

            const data = makeCertificationPackage({
              practicingWrittenText,
              consultingWrittenText,
              practicingOutdoorText,
              consultingOutdoorText,
              sourceFiles,
            });

            const filename = `${data.createdAt.replace(/[:.]/g, "-")}-${data.packageId}.json`;
            await fs.writeFile(path.join(LOCAL_TEST_PACKAGES_DIR, filename), JSON.stringify(data, null, 2));

            sendJson(res, 201, { ok: true, filename, package: data });
            return;
          }

          if (url.pathname === "/api/translations/overrides") {
            const readOverrides = async () => {
              try { return JSON.parse(await fs.readFile(LOCAL_TRANSLATION_OVERRIDES_FILE, "utf8")); } catch { return {}; }
            };
            if (req.method === "GET") {
              sendJson(res, 200, { ok: true, overrides: await readOverrides() });
              return;
            }
            if (req.method === "POST") {
              const body = JSON.parse((await readBody(req)) || "{}");
              const lang = String(body.lang || "").trim();
              const key = String(body.key || "").trim();
              if (!lang || !key) { sendJson(res, 400, { ok: false, error: "lang and key are required" }); return; }
              const overrides = await readOverrides();
              const value = typeof body.value === "string" ? body.value.trim() : "";
              if (!overrides[lang]) overrides[lang] = {};
              if (value) overrides[lang][key] = value;
              else delete overrides[lang][key];
              await fs.writeFile(LOCAL_TRANSLATION_OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
              sendJson(res, 200, { ok: true, overrides });
              return;
            }
            sendJson(res, 200, { ok: true });
            return;
          }

          if (url.pathname.startsWith("/api/admin/package-history")) {
            const historySummary = (entry) => ({ id: entry.id, savedAt: entry.savedAt, language: entry.language || "", centre: entry.centre || "", note: entry.note || "", packageId: entry.packageId || "", vetFilename: entry.vetFilename || "" });
            const listHistoryFiles = async () => (await fs.readdir(LOCAL_PACKAGE_HISTORY_DIR)).filter((name) => name.endsWith(".json")).sort().reverse();
            const findHistoryFile = async (id) => (await listHistoryFiles()).find((filename) => filename.includes(id));
            const tail = url.pathname.split("/").filter(Boolean).slice(3);

            if (tail.length === 1 && tail[0] === "list") {
              const files = await listHistoryFiles();
              const entries = [];
              for (const file of files) {
                try { entries.push(historySummary(JSON.parse(await fs.readFile(path.join(LOCAL_PACKAGE_HISTORY_DIR, file), "utf8")))); } catch {}
              }
              sendJson(res, 200, { ok: true, history: entries });
              return;
            }
            if (tail.length === 1 && tail[0] === "save" && req.method === "POST") {
              const body = JSON.parse((await readBody(req, 40 * 1024 * 1024)) || "{}");
              const now = new Date().toISOString();
              const id = `hist-${Date.now()}`;
              const entry = { id, savedAt: now, language: body.language || "", centre: body.centre || "", note: body.note || "", packageId: body.packageId || "", vetFilename: body.vetFilename || "", package: body.package || null };
              const filename = `${now.replace(/[:.]/g, "-")}-${id}.json`;
              await fs.writeFile(path.join(LOCAL_PACKAGE_HISTORY_DIR, filename), JSON.stringify(entry, null, 2));
              sendJson(res, 200, { ok: true, entry: historySummary(entry) });
              return;
            }
            if (tail.length === 2 && tail[1] === "note" && req.method === "POST") {
              const id = decodeURIComponent(tail[0]);
              const match = await findHistoryFile(id);
              if (!match) { sendJson(res, 404, { ok: false, error: `Package history entry not found: ${id}` }); return; }
              const filePath = path.join(LOCAL_PACKAGE_HISTORY_DIR, match);
              const entry = JSON.parse(await fs.readFile(filePath, "utf8"));
              const body = JSON.parse((await readBody(req)) || "{}");
              entry.note = body.note || "";
              await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
              sendJson(res, 200, { ok: true, entry: historySummary(entry) });
              return;
            }
            if (tail.length === 2 && tail[1] === "delete" && req.method === "POST") {
              const id = decodeURIComponent(tail[0]);
              const match = await findHistoryFile(id);
              if (match) await fs.unlink(path.join(LOCAL_PACKAGE_HISTORY_DIR, match));
              sendJson(res, 200, { ok: true });
              return;
            }
            if (tail.length === 1 && req.method === "GET") {
              const id = decodeURIComponent(tail[0]);
              const match = await findHistoryFile(id);
              if (!match) { sendJson(res, 404, { ok: false, error: `Package history entry not found: ${id}` }); return; }
              const entry = JSON.parse(await fs.readFile(path.join(LOCAL_PACKAGE_HISTORY_DIR, match), "utf8"));
              sendJson(res, 200, { ok: true, entry });
              return;
            }
            sendJson(res, 200, { ok: true });
            return;
          }

          if (url.pathname.startsWith("/api/admin/centre-links")) {
            const listLinkFiles = async () => (await fs.readdir(LOCAL_CENTRE_LINKS_DIR)).filter((name) => name.endsWith(".json")).sort().reverse();
            const tail = url.pathname.split("/").filter(Boolean).slice(3);

            if (tail.length === 1 && tail[0] === "list") {
              const files = await listLinkFiles();
              const entries = [];
              for (const file of files) {
                try { entries.push(JSON.parse(await fs.readFile(path.join(LOCAL_CENTRE_LINKS_DIR, file), "utf8"))); } catch { /* skip corrupt entry */ }
              }
              sendJson(res, 200, { ok: true, links: entries });
              return;
            }
            if (tail.length === 1 && tail[0] === "save" && req.method === "POST") {
              const body = JSON.parse((await readBody(req)) || "{}");
              const now = new Date().toISOString();
              const id = `link-${Date.now()}`;
              const entry = { id, createdAt: now, place: body.place || "", examDate: body.examDate || "", centre: body.centre || "", token: body.token || "", url: body.url || "" };
              await fs.writeFile(path.join(LOCAL_CENTRE_LINKS_DIR, `${now.replace(/[:.]/g, "-")}-${id}.json`), JSON.stringify(entry, null, 2));
              sendJson(res, 200, { ok: true, entry });
              return;
            }
            sendJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }

          sendJson(res, 404, { error: "Unknown test package endpoint" });
        } catch (error) {
          sendJson(res, 500, { error: error.message || "Test package conversion failed" });
        }
      });
    },
  };
}



function fieldPreparationPlugin() {
  return {
    name: "vetbara-field-preparation-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const match = url.pathname.match(/^\/api\/exams\/([^/]+)\/field-preparation$/);
          const validateMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/field-preparation\/validate$/);
          const packageMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/field-package\/(practicing|consulting)$/);
          const tabletSyncMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/field-tablet-sync$/);
          const tabletSyncLatestMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/field-tablet-sync\/latest$/);

          if (!match && !validateMatch && !packageMatch && !tabletSyncMatch && !tabletSyncLatestMatch) {
            next();
            return;
          }

          await fs.mkdir(LOCAL_FIELD_PREPARATIONS_DIR, { recursive: true });
          const examId = decodeURIComponent((match || validateMatch || packageMatch || tabletSyncMatch || tabletSyncLatestMatch)[1]);
          const safeExamId = examId.replace(/[^a-z0-9_-]/gi, "_");
          const filePath = path.join(LOCAL_FIELD_PREPARATIONS_DIR, `${safeExamId}.json`);

          async function readPreparation() {
            try {
              const raw = await fs.readFile(filePath, "utf8");
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }

          function validateFieldPreparation(prep) {
            const issues = [];
            const hasNumber = (value) => Number.isFinite(Number(value));
            if (!hasNumber(prep?.examCenter?.point?.lat) || !hasNumber(prep?.examCenter?.point?.lng)) {
              issues.push({ severity: "error", code: "MISSING_CENTER_COORDINATES", message: "Zkušební centrum nemá platné GPS souřadnice." });
            }
            const levels = ["Practicing", "Consulting"];
            const codes = ["A", "B", "C", "D"];
            for (const level of levels) {
              for (const code of codes) {
                const matches = (prep?.trees || []).filter((tree) => (tree.assignments || []).some((assignment) => assignment.level === level && assignment.code === code));
                if (!matches.length) issues.push({ severity: "error", code: `MISSING_${level.toUpperCase()}_${code}`, message: `Chybí ${level} strom ${code}.` });
                if (matches.length > 1) issues.push({ severity: "warning", code: `DUPLICATE_${level.toUpperCase()}_${code}`, message: `${level} strom ${code} je přiřazen více než jednou.` });
              }
            }
            const practicingA = (prep?.trees || []).find((tree) => (tree.assignments || []).some((assignment) => assignment.level === "Practicing" && assignment.code === "A"));
            const data = practicingA?.practicingTreeAData;
            if (!data) issues.push({ severity: "error", code: "MISSING_PRACTICING_A_DATA", message: "Practicing A nemá vyplněná management data." });
            return { valid: !issues.some((issue) => issue.severity === "error"), issues };
          }


          function applyFieldPreparationSnapshot(prep, syncPayload) {
            const snapshot = syncPayload?.fieldPreparationSnapshot;
            if (!snapshot || typeof snapshot !== "object") return null;
            const now = new Date().toISOString();
            const current = prep && typeof prep === "object" ? prep : {};
            const centre = snapshot.examCenter && typeof snapshot.examCenter === "object" ? snapshot.examCenter : {};
            const centrePoint = centre.point && typeof centre.point === "object" ? centre.point : {};
            const centreLat = Number(centrePoint.lat ?? centrePoint.latitude ?? centre.latitude ?? centre.lat);
            const centreLng = Number(centrePoint.lng ?? centrePoint.longitude ?? centre.longitude ?? centre.lng);
            const referenceLatitude = Number(snapshot.referenceLatitude ?? snapshot.mapView?.center?.lat ?? current.referenceLatitude ?? centreLat);
            const referenceLongitude = Number(snapshot.referenceLongitude ?? snapshot.mapView?.center?.lng ?? current.referenceLongitude ?? centreLng);
            const trees = Array.isArray(snapshot.trees) ? snapshot.trees : [];
            return {
              ...current,
              examId: snapshot.examId || current.examId || examId,
              siteName: snapshot.siteName || current.siteName || "",
              referenceLatitude,
              referenceLongitude,
              updatedAt: now,
              updatedBy: "Field tablet sync",
              lastTabletSyncId: syncPayload?.syncId || null,
              lastTabletSyncAt: syncPayload?.receivedAt || syncPayload?.syncedAt || now,
              examCenter: {
                ...(current.examCenter || {}),
                ...centre,
                point: {
                  ...(current.examCenter?.point || {}),
                  ...(centrePoint || {}),
                  lat: centreLat,
                  lng: centreLng,
                },
              },
              trees: trees.map((tree, index) => {
                const point = tree.point && typeof tree.point === "object" ? tree.point : {};
                const lat = Number(point.lat ?? point.latitude ?? tree.latitude ?? tree.lat);
                const lng = Number(point.lng ?? point.longitude ?? tree.longitude ?? tree.lng);
                const assignments = Array.isArray(tree.assignments) && tree.assignments.length
                  ? tree.assignments
                  : [{ level: tree.level || "Practicing", code: tree.code || String.fromCharCode(65 + (index % 4)), visibleToCandidate: true }];
                return {
                  ...tree,
                  id: tree.id || `field-tree-${index + 1}`,
                  name: tree.name || `Strom ${index + 1}`,
                  assignments,
                  point: { ...(point || {}), lat, lng },
                  candidateNote: tree.candidateNote || "",
                  practicingTreeAData: tree.practicingTreeAData || tree.managementData || { interventions: [] },
                  labelDirection: tree.labelDirection || "n",
                  labelOffsetX: Number(tree.labelOffsetX || 0),
                  labelOffsetY: Number(tree.labelOffsetY || 0),
                };
              }),
            };
          }

          function mergeTabletSyncIntoPreparation(prep, syncPayload) {
            const snapshotApplied = applyFieldPreparationSnapshot(prep, syncPayload);
            if (snapshotApplied) return snapshotApplied;
            if (!prep || typeof prep !== "object") return prep;
            const draft = syncPayload?.draft && typeof syncPayload.draft === "object" ? syncPayload.draft : {};
            const treeNotes = draft.treeNotes && typeof draft.treeNotes === "object" ? draft.treeNotes : {};
            const packageSnapshot = syncPayload?.packageSnapshot && typeof syncPayload.packageSnapshot === "object" ? syncPayload.packageSnapshot : {};
            const packageTrees = Array.isArray(packageSnapshot.trees) ? packageSnapshot.trees : [];
            const now = new Date().toISOString();

            function treeKey(level, code) {
              const normalizedLevel = String(level || "Practicing").toLowerCase() === "consulting" ? "Consulting" : "Practicing";
              return `${normalizedLevel}:${String(code || "").trim().toUpperCase()}`;
            }

            function noteFor(level, code) {
              const codeOnly = String(code || "").trim().toUpperCase();
              return treeNotes[treeKey(level, codeOnly)] || treeNotes[codeOnly] || null;
            }

            function snapshotFor(level, code) {
              const wanted = treeKey(level, code);
              return packageTrees.find((tree) => treeKey(tree.level || level, tree.code) === wanted) || null;
            }

            const next = {
              ...prep,
              updatedAt: now,
              updatedBy: "Field tablet sync",
            };

            const centerDraft = draft.examCenter && typeof draft.examCenter === "object" ? draft.examCenter : {};
            const centerLat = Number(centerDraft.latitude ?? centerDraft.lat);
            const centerLng = Number(centerDraft.longitude ?? centerDraft.lng);
            if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
              next.examCenter = {
                ...(next.examCenter || {}),
                point: {
                  ...(next.examCenter?.point || {}),
                  lat: centerLat,
                  lng: centerLng,
                  x: Math.min(96, Math.max(4, 50 + ((centerLng - Number(next.referenceLongitude || centerLng)) / 0.000026))),
                  y: Math.min(92, Math.max(8, 50 - ((centerLat - Number(next.referenceLatitude || centerLat)) / 0.000018))),
                },
              };
            }

            next.trees = (Array.isArray(prep.trees) ? prep.trees : []).map((tree) => {
              const assignments = Array.isArray(tree.assignments) ? tree.assignments : [];
              let merged = { ...tree };
              for (const assignment of assignments) {
                const n = noteFor(assignment.level, assignment.code);
                const snapshot = snapshotFor(assignment.level, assignment.code);
                const lat = Number(n?.latitude ?? snapshot?.latitude);
                const lng = Number(n?.longitude ?? snapshot?.longitude);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                  const refLat = Number(next.referenceLatitude ?? next.examCenter?.point?.lat);
                  const refLng = Number(next.referenceLongitude ?? next.examCenter?.point?.lng);
                  const x = Number.isFinite(refLng) ? Math.min(96, Math.max(4, 50 + ((lng - refLng) / 0.000026))) : merged.point?.x;
                  const y = Number.isFinite(refLat) ? Math.min(92, Math.max(8, 50 - ((lat - refLat) / 0.000018))) : merged.point?.y;
                  merged = { ...merged, point: { ...(merged.point || {}), lat, lng, x, y } };
                }
                if (n?.treeName) merged.name = n.treeName;
                if (n?.candidateNote !== undefined) merged.candidateNote = n.candidateNote;
                if (n?.managementData && typeof n.managementData === "object") {
                  merged.practicingTreeAData = { ...(merged.practicingTreeAData || {}), ...n.managementData };
                }
                if (n?.labelDirection) merged.labelDirection = n.labelDirection;
                if (n?.labelOffsetX !== undefined) merged.labelOffsetX = Number(n.labelOffsetX || 0);
                if (n?.labelOffsetY !== undefined) merged.labelOffsetY = Number(n.labelOffsetY || 0);
              }
              return merged;
            });

            return next;
          }


          async function readLatestTabletSync() {
            try {
              await fs.mkdir(LOCAL_FIELD_TABLET_SYNC_DIR, { recursive: true });
              const entries = await fs.readdir(LOCAL_FIELD_TABLET_SYNC_DIR);
              const matching = entries
                .filter((name) => name.endsWith('.json') && name.includes(safeExamId))
                .sort()
                .reverse();
              for (const name of matching) {
                try {
                  const raw = await fs.readFile(path.join(LOCAL_FIELD_TABLET_SYNC_DIR, name), 'utf8');
                  return JSON.parse(raw);
                } catch {}
              }
              return null;
            } catch {
              return null;
            }
          }

          function candidatePackage(prep, level) {
            const normalizedLevel = level === "practicing" ? "Practicing" : "Consulting";
            const trees = (prep?.trees || []).flatMap((tree) => (tree.assignments || [])
              .filter((assignment) => assignment.level === normalizedLevel && assignment.visibleToCandidate !== false)
              .map((assignment) => ({
                id: tree.id,
                code: assignment.code,
                name: tree.name,
                latitude: Number(tree.point?.lat),
                longitude: Number(tree.point?.lng),
                candidateNote: tree.candidateNote || "",
                photos: (tree.photos || []).map((photo) => ({ id: photo.id, fileName: photo.fileName || photo.name, url: photo.url, thumbnailUrl: photo.thumbnailUrl, caption: photo.caption || "" })),
                practicingTreeAData: tree.practicingTreeAData,
              })));
            return {
              packageType: "vetbara-field-exam",
              packageVersion: "1.0",
              examId: prep.examId || examId,
              level: normalizedLevel.toUpperCase(),
              siteName: prep.siteName,
              createdAt: new Date().toISOString(),
              examCenter: {
                latitude: Number(prep.examCenter?.point?.lat),
                longitude: Number(prep.examCenter?.point?.lng),
                candidateNote: prep.examCenter?.candidateNote || "",
                photos: prep.examCenter?.photos || [],
              },
              trees: trees.sort((a, b) => String(a.code).localeCompare(String(b.code))),
            };
          }

          if (req.method === "GET" && match) {
            const data = await readPreparation();
            if (!data) {
              sendJson(res, 404, { error: "Field preparation not found" });
              return;
            }
            sendJson(res, 200, { fieldPreparation: data });
            return;
          }

          if (req.method === "PUT" && match) {
            const raw = await readBody(req, 40 * 1024 * 1024);
            const body = JSON.parse(raw || "{}");
            const incoming = body.fieldPreparation || body;
            if (!incoming || typeof incoming !== "object") {
              sendJson(res, 400, { error: "Invalid field preparation payload" });
              return;
            }
            const stored = { ...incoming, examId: incoming.examId || examId, updatedAt: new Date().toISOString() };
            await fs.writeFile(filePath, JSON.stringify(stored, null, 2));
            sendJson(res, 200, { ok: true, fieldPreparation: stored, validation: validateFieldPreparation(stored) });
            return;
          }

          if (req.method === "POST" && validateMatch) {
            const data = await readPreparation();
            if (!data) {
              sendJson(res, 404, { error: "Field preparation not found" });
              return;
            }
            sendJson(res, 200, validateFieldPreparation(data));
            return;
          }

          if (req.method === "GET" && packageMatch) {
            const data = await readPreparation();
            if (!data) {
              sendJson(res, 404, { error: "Field preparation not found" });
              return;
            }
            sendJson(res, 200, candidatePackage(data, packageMatch[2]));
            return;
          }


          if (req.method === "GET" && tabletSyncLatestMatch) {
            const currentPreparation = await readPreparation();
            if (!currentPreparation) {
              sendJson(res, 404, { error: "Field preparation not found" });
              return;
            }
            const latestSync = await readLatestTabletSync();
            if (!latestSync) {
              sendJson(res, 200, { ok: true, fieldPreparation: currentPreparation, syncId: null, message: "No tablet sync package found" });
              return;
            }
            const fieldPreparation = mergeTabletSyncIntoPreparation(currentPreparation, latestSync);
            await fs.writeFile(filePath, JSON.stringify(fieldPreparation, null, 2));
            sendJson(res, 200, { ok: true, syncId: latestSync.syncId || null, fieldPreparationUpdated: true, fieldPreparation });
            return;
          }

          if (req.method === "POST" && tabletSyncMatch) {
            await fs.mkdir(LOCAL_FIELD_TABLET_SYNC_DIR, { recursive: true });
            const raw = await readBody(req, 40 * 1024 * 1024);
            const body = JSON.parse(raw || "{}");
            if (!body || typeof body !== "object") {
              sendJson(res, 400, { error: "Invalid tablet sync payload" });
              return;
            }
            const syncId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeExamId}-${crypto.randomBytes(4).toString("hex")}`;
            const stored = { ...body, examId: body.examId || examId, syncId, receivedAt: new Date().toISOString() };
            await fs.writeFile(path.join(LOCAL_FIELD_TABLET_SYNC_DIR, `${syncId}.json`), JSON.stringify(stored, null, 2));

            const currentPreparation = await readPreparation();
            let fieldPreparation = currentPreparation;
            if (currentPreparation) {
              fieldPreparation = mergeTabletSyncIntoPreparation(currentPreparation, stored);
              await fs.writeFile(filePath, JSON.stringify(fieldPreparation, null, 2));
            }

            sendJson(res, 200, { ok: true, syncId, receivedAt: stored.receivedAt, fieldPreparationUpdated: Boolean(currentPreparation), fieldPreparation });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(res, 500, { error: error.message || "Field preparation API failed" });
        }
      });
    },
  };
}

function scanInboxPlugin() {
  return {
    name: "vetbara-scan-inbox-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const listMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/scan-inbox$/);
          const itemMatch = url.pathname.match(/^\/api\/exams\/([^/]+)\/scan-inbox\/([^/]+)$/);
          if (!listMatch && !itemMatch) {
            next();
            return;
          }

          const examId = decodeURIComponent((listMatch || itemMatch)[1]);
          const safeExamId = examId.replace(/[^a-z0-9_-]/gi, "_");
          const dir = path.join(LOCAL_SCAN_INBOX_DIR, safeExamId);
          await fs.mkdir(dir, { recursive: true });

          if (req.method === "POST" && listMatch) {
            const raw = await readBody(req);
            const body = JSON.parse(raw || "{}");
            if (!body || typeof body.dataUrl !== "string" || !body.dataUrl) {
              sendJson(res, 400, { error: "Missing dataUrl" });
              return;
            }
            const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
            await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, dataUrl: body.dataUrl, capturedAt: body.capturedAt || new Date().toISOString(), receivedAt: new Date().toISOString() }, null, 2));
            sendJson(res, 200, { ok: true, id });
            return;
          }

          if (req.method === "GET" && listMatch) {
            const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).sort();
            const items = [];
            for (const name of names) {
              try { items.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))); } catch { /* skip corrupt entry */ }
            }
            sendJson(res, 200, { items });
            return;
          }

          if (req.method === "DELETE" && itemMatch) {
            const id = decodeURIComponent(itemMatch[2]).replace(/[^a-zA-Z0-9_-]/g, "");
            try { await fs.unlink(path.join(dir, `${id}.json`)); } catch { /* already gone */ }
            sendJson(res, 200, { ok: true });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(res, 500, { error: error.message || "Scan inbox API failed" });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localExchangePlugin(), testPackageAdminPlugin(), fieldPreparationPlugin(), scanInboxPlugin()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    https: false,
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve("index.html"),
        admin: path.resolve("admin.html"),
      },
    },
  },
});
