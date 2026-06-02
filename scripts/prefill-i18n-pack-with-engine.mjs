#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { translateText } from "./translation-engine.mjs";

const PLACEHOLDERS = [
  "{role}",
  "{label}",
  "{event}",
  "{variants}",
  "{questions}",
  "{message}",
  "{variant}",
];

const PROTECTED_TERMS = [
  "Centre Audit Package",
  "backend-loaded pilot data",
  "demo fallback data",
  "pilot/archive placeholder",
  "correctAnswer",
  "variantCode",
  "questionId",
  "VARIANT_CODE",
  "NOT PASSED",
  "Candidate QR",
  "Examiner QR",
  "Centre QR",
  "Centre Setup",
  "Draft Export",
  "sync queue",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "Practicing",
  "Consulting",
  "Candidate",
  "Examiner",
  "Centre",
  "Admin",
  "primary",
  "secondary",
  "VETcert",
  "VetBara",
  "PASS",
].sort((a, b) => b.length - a.length);

function parseArgs(argv) {
  const args = {
    packPath: null,
    provider: "mock",
    dryRun: true,
    write: false,
    onlyEmpty: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!args.packPath && !arg.startsWith("--")) {
      args.packPath = arg;
      continue;
    }

    if (arg === "--provider") {
      args.provider = argv[++i];
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--write") {
      args.write = true;
      args.dryRun = false;
      continue;
    }

    if (arg === "--only-empty") {
      args.onlyEmpty = true;
      continue;
    }

    if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.packPath) {
    throw new Error("Usage: node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/<lang>-translation-pack.json --provider mock --dry-run");
  }

  if (args.write && args.dryRun) {
    throw new Error("Use either --write or --dry-run, not both.");
  }

  return args;
}

function inferLanguage(packPath) {
  const base = path.basename(packPath);
  const match = base.match(/^([a-z]{2})-translation-pack\.json$/);
  if (!match) {
    throw new Error(`Cannot infer language from filename: ${base}`);
  }
  return match[1];
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read or parse ${filePath}: ${error.message}`);
  }
}

function normalizeEntries(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  throw new Error("Expected translation pack JSON to be an array or object with entries array.");
}

function tokenCounts(text, token) {
  return String(text ?? "").split(token).length - 1;
}

function maskText(text) {
  let masked = String(text ?? "");
  const masks = [];

  function applyMask(token, kind) {
    const count = tokenCounts(masked, token);
    for (let i = 0; i < count; i += 1) {
      const mask = `__VETBARA_${kind}_${masks.length}__`;
      masked = masked.replace(token, mask);
      masks.push({ mask, token, kind });
    }
  }

  for (const placeholder of PLACEHOLDERS) {
    applyMask(placeholder, "PLACEHOLDER");
  }

  for (const term of PROTECTED_TERMS) {
    applyMask(term, "TERM");
  }

  return { masked, masks };
}

function unmaskText(text, masks) {
  let unmasked = String(text ?? "");
  for (const { mask, token } of masks) {
    unmasked = unmasked.replaceAll(mask, token);
  }
  return unmasked;
}

function assertPreserved(source, target) {
  for (const placeholder of PLACEHOLDERS) {
    const sourceCount = tokenCounts(source, placeholder);
    const targetCount = tokenCounts(target, placeholder);
    if (sourceCount !== targetCount) {
      throw new Error(`Placeholder count mismatch for ${placeholder}: source=${sourceCount}, target=${targetCount}`);
    }
  }

  for (const term of PROTECTED_TERMS) {
    const sourceCount = tokenCounts(source, term);
    const targetCount = tokenCounts(target, term);
    if (sourceCount !== targetCount) {
      throw new Error(`Protected term count mismatch for ${term}: source=${sourceCount}, target=${targetCount}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetLanguage = inferLanguage(args.packPath);
  const data = readJson(args.packPath);
  const entries = normalizeEntries(data);

  let eligibleRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  const samples = [];

  for (const entry of entries) {
    if (entry.status !== "needs_review") {
      skippedRows += 1;
      continue;
    }

    if (args.onlyEmpty && String(entry.target ?? "").trim()) {
      skippedRows += 1;
      continue;
    }

    if (args.limit !== null && updatedRows >= args.limit) {
      skippedRows += 1;
      continue;
    }

    eligibleRows += 1;

    const source = String(entry.en ?? "");
    const { masked, masks } = maskText(source);

    const translatedMasked = await translateText({
      provider: args.provider,
      source: masked,
      targetLanguage,
    });

    const translated = unmaskText(translatedMasked, masks);
    assertPreserved(source, translated);

    if (samples.length < 5) {
      samples.push({
        key: entry.key,
        before: entry.target ?? "",
        after: translated,
      });
    }

    entry.target = translated;
    entry.status = "needs_review";
    updatedRows += 1;
  }

  const summary = {
    language: targetLanguage,
    provider: args.provider,
    mode: args.write ? "write" : "dry-run",
    totalRows: entries.length,
    eligibleRows,
    updatedRows,
    skippedRows,
    samples,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (args.write) {
    fs.writeFileSync(args.packPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`\nUpdated ${args.packPath}`);
  } else {
    console.log("\nDry run only. No file was written.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
