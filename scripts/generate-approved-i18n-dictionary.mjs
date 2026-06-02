#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const packPaths = process.argv.slice(2);

if (!packPaths.length) {
  console.error(
    "Usage: node scripts/generate-approved-i18n-dictionary.mjs <translation-pack.json> [translation-pack.json ...]"
  );
  process.exit(2);
}

const protectedTerms = [
  "correctAnswer",
  "variantCode",
  "questionId",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "VARIANT_CODE",
  "PASS",
  "NOT PASSED",
  "Candidate",
  "Examiner",
  "Centre",
  "Admin",
  "Practicing",
  "Consulting",
  "primary",
  "secondary",
  "Centre Setup",
  "Candidate QR",
  "Examiner QR",
  "Centre QR",
  "Draft Export",
  "Centre Audit Package",
  "sync queue",
  "pilot/archive placeholder",
  "backend-loaded pilot data",
  "demo fallback data",
];

const allowedStatuses = new Set(["needs_review", "approved", "rejected", "needs_discussion"]);
const supportedLanguages = new Set(["de", "it", "sv", "hr", "nl", "no", "fr", "es"]);
const outputDir = path.join("docs", "i18n", "generated");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: could not read or parse JSON: ${error.message}`);
  }
}

function normalizeEntries(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  throw new Error("expected JSON to be an array or an object with an entries array");
}

function placeholders(text) {
  return new Set(String(text ?? "").match(/\{[A-Za-z0-9_]+\}/g) ?? []);
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function formatSet(set) {
  return [...set].sort().join(", ") || "(none)";
}

function sourceText(entry) {
  return entry.en ?? entry.source ?? "";
}

function targetText(entry) {
  return entry.target ?? "";
}

function inferLanguage(filePath) {
  const match = path.basename(filePath).match(/^([a-z]{2})-translation-pack\.json$/u);
  const language = match?.[1];

  if (!language || !supportedLanguages.has(language)) {
    throw new Error(`${filePath}: could not infer supported language code from filename`);
  }

  return language;
}

function protectedTermsFromNotes(notes) {
  if (!notes || !/Protected term\(s\):/.test(notes)) return [];

  return notes
    .replace(/^.*Protected term\(s\):\s*/u, "")
    .split(/[,.]/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function validateApprovedEntry(entry, key, errors) {
  const source = sourceText(entry);
  const target = targetText(entry);

  if (!target.trim()) {
    errors.push(`${key}: approved entry has empty target.`);
    return;
  }

  const sourcePlaceholders = placeholders(source);
  const targetPlaceholders = placeholders(target);

  if (!sameSet(sourcePlaceholders, targetPlaceholders)) {
    errors.push(
      `${key}: placeholder mismatch. source=${formatSet(sourcePlaceholders)} target=${formatSet(targetPlaceholders)}`
    );
  }

  for (const term of protectedTerms) {
    if (source.includes(term) && !target.includes(term)) {
      errors.push(`${key}: protected term missing from target: ${term}`);
    }
  }

  for (const term of protectedTermsFromNotes(entry.notes)) {
    if (source.includes(term) && !target.includes(term)) {
      errors.push(`${key}: protected term from notes missing from target: ${term}`);
    }
  }
}

function preparePack(filePath) {
  const language = inferLanguage(filePath);
  const data = readJson(filePath);
  const entries = normalizeEntries(data);
  const errors = [];
  const dictionary = {};

  let approvedRows = 0;
  let skippedRows = 0;

  for (const [index, entry] of entries.entries()) {
    const row = index + 1;
    const key = entry.key ?? `(row ${row})`;
    const status = entry.status ?? "";

    if (!allowedStatuses.has(status)) {
      errors.push(`${key}: invalid status "${status}".`);
      continue;
    }

    if (status !== "approved") {
      skippedRows += 1;
      continue;
    }

    approvedRows += 1;
    validateApprovedEntry(entry, key, errors);

    if (targetText(entry).trim()) {
      dictionary[key] = targetText(entry);
    }
  }

  if (errors.length) {
    const details = errors.map((error) => `- ${error}`).join("\n");
    throw new Error(`${filePath}: approved dictionary generation failed:\n${details}`);
  }

  const outputFile = path.join(outputDir, `${language}-approved-dictionary.json`);

  return {
    dictionary,
    outputFile,
    summary: {
      language,
      totalEntries: entries.length,
      approvedRows,
      generatedKeys: Object.keys(dictionary).length,
      skippedRows,
      outputFile,
    },
  };
}

try {
  const preparedPacks = packPaths.map(preparePack);

  fs.mkdirSync(outputDir, { recursive: true });

  for (const pack of preparedPacks) {
    fs.writeFileSync(pack.outputFile, `${JSON.stringify(pack.dictionary, null, 2)}\n`);
  }

  for (const pack of preparedPacks) {
    console.log(JSON.stringify(pack.summary, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
