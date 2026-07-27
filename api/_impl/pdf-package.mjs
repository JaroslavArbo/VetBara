// PDF -> certification package builder. Pure helpers ported verbatim from
// vite.config.js (single behavior for dev and prod). validateCertificationPackage
// is imported from packages.mjs to avoid duplication.
import crypto from "node:crypto";
import { validateCertificationPackage } from "../_lib/packages.mjs";

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

export function parseQuestionBlocksFromWrittenText(text, level) {
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

export function parseOutdoorBlocksFromText(text, level) {
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

export function makeCertificationPackage({ practicingWrittenText, consultingWrittenText, practicingOutdoorText, consultingOutdoorText, sourceFiles }) {
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
