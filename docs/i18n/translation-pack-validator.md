# VetBara Translation Pack Validator

This validator checks reviewed translation packs before approved rows are imported into `src/i18n.js`.

It is intentionally strict. A translation pack can be useful for review even when many rows are still `needs_review`, but only rows marked `approved` are treated as import candidates.

## Command

```bash
node scripts/validate-i18n-pack.mjs docs/i18n/de-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/it-translation-pack.json
grep -n "validate-i18n-pack" scripts/validate-i18n-pack.mjs docs/i18n/translation-pack-validator.md
grep -n "correctAnswer" scripts/validate-i18n-pack.mjs docs/i18n/translation-pack-validator.md
grep -n "{role}" docs/i18n/translation-pack-validator.md
grep -n "approved" scripts/validate-i18n-pack.mjs docs/i18n/translation-pack-validator.md
git status --short
git diff --stat

git add scripts/validate-i18n-pack.mjs docs/i18n/translation-pack-validator.md
git commit -m "Add translation pack validator"
git push -u origin agent/i18n-translation-pack-validator
cd ~/vetbara
git checkout main
git pull
npm run build

git checkout -b agent/i18n-translation-pack-validator
mkdir -p scripts docs/i18n

cat > scripts/validate-i18n-pack.mjs <<'EOF'
#!/usr/bin/env node

import fs from "node:fs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node scripts/validate-i18n-pack.mjs <translation-pack.json>");
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

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read or parse JSON: ${error.message}`);
  }
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

function normalizeEntries(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  throw new Error("Expected JSON to be an array or an object with an entries array.");
}

function sourceText(entry) {
  return entry.en ?? entry.source ?? "";
}

function targetText(entry) {
  return entry.target ?? "";
}

const errors = [];
const warnings = [];
const data = readJson(filePath);
const entries = normalizeEntries(data);

let approved = 0;
let importable = 0;
let skipped = 0;

for (const [index, entry] of entries.entries()) {
  const row = index + 1;
  const key = entry.key ?? `(row ${row})`;
  const status = entry.status ?? "";

  if (!allowedStatuses.has(status)) {
    errors.push(`${key}: invalid status "${status}".`);
    continue;
  }

  if (status !== "approved") {
    skipped += 1;
    continue;
  }

  approved += 1;

  const source = sourceText(entry);
  const target = targetText(entry);

  if (!target.trim()) {
    errors.push(`${key}: approved entry has empty target.`);
    continue;
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

  if (entry.notes && /Protected term\(s\):/.test(entry.notes)) {
    const listedTerms = entry.notes
      .replace(/^.*Protected term\(s\):\s*/u, "")
      .split(/[,.]/u)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const term of listedTerms) {
      if (source.includes(term) && !target.includes(term)) {
        errors.push(`${key}: protected term from notes missing from target: ${term}`);
      }
    }
  }

  importable += 1;
}

const report = {
  file: filePath,
  totalEntries: entries.length,
  approved,
  importable,
  skipped,
  errors: errors.length,
  warnings: warnings.length,
};

console.log(JSON.stringify(report, null, 2));

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length) {
  console.error("\nErrors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("\nTranslation pack validation passed.");
