#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const packPaths = process.argv.slice(2);
const allowedStatuses = new Set(["needs_review", "approved", "rejected", "needs_discussion"]);
const outputDir = path.join("docs", "i18n", "generated");
const outputFile = path.join(outputDir, "translation-review-progress.md");

if (!packPaths.length) {
  console.error(
    "Usage: node scripts/report-i18n-review-progress.mjs <translation-pack.json> [translation-pack.json ...]"
  );
  process.exit(2);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: could not read or parse JSON: ${error.message}`);
  }
}

function normalizeEntries(data, filePath) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  throw new Error(`${filePath}: expected JSON to be an array or an object with an entries array`);
}

function inferLanguage(filePath) {
  const match = path.basename(filePath).match(/^([a-z]{2})-translation-pack\.json$/u);
  if (!match) {
    throw new Error(`${filePath}: could not infer language code from filename`);
  }
  return match[1];
}

function targetText(entry) {
  return String(entry.target ?? "");
}

function summarizePack(filePath) {
  const language = inferLanguage(filePath);
  const entries = normalizeEntries(readJson(filePath), filePath);
  const summary = {
    language,
    file: filePath,
    totalRows: entries.length,
    needs_review: 0,
    approved: 0,
    rejected: 0,
    needs_discussion: 0,
    blankTargets: 0,
    filledTargets: 0,
    importReady: 0,
  };

  for (const [index, entry] of entries.entries()) {
    const row = index + 1;
    const key = entry.key ?? `(row ${row})`;
    const status = entry.status ?? "";

    if (!allowedStatuses.has(status)) {
      throw new Error(`${filePath}: ${key}: invalid status "${status}"`);
    }

    summary[status] += 1;

    const hasTarget = Boolean(targetText(entry).trim());
    if (hasTarget) {
      summary.filledTargets += 1;
    } else {
      summary.blankTargets += 1;
    }

    if (status === "approved" && hasTarget) {
      summary.importReady += 1;
    }
  }

  return summary;
}

function totalSummaries(summaries) {
  return summaries.reduce(
    (total, summary) => ({
      language: "total",
      file: "",
      totalRows: total.totalRows + summary.totalRows,
      needs_review: total.needs_review + summary.needs_review,
      approved: total.approved + summary.approved,
      rejected: total.rejected + summary.rejected,
      needs_discussion: total.needs_discussion + summary.needs_discussion,
      blankTargets: total.blankTargets + summary.blankTargets,
      filledTargets: total.filledTargets + summary.filledTargets,
      importReady: total.importReady + summary.importReady,
    }),
    {
      language: "total",
      file: "",
      totalRows: 0,
      needs_review: 0,
      approved: 0,
      rejected: 0,
      needs_discussion: 0,
      blankTargets: 0,
      filledTargets: 0,
      importReady: 0,
    }
  );
}

function tableRows(summaries) {
  return summaries.map((summary) => ({
    language: summary.language,
    total: summary.totalRows,
    needs_review: summary.needs_review,
    approved: summary.approved,
    rejected: summary.rejected,
    needs_discussion: summary.needs_discussion,
    blank_targets: summary.blankTargets,
    filled_targets: summary.filledTargets,
    import_ready: summary.importReady,
  }));
}

function markdownTable(summaries) {
  const rows = summaries.map(
    (summary) =>
      `| ${summary.language} | ${summary.totalRows} | ${summary.needs_review} | ${summary.approved} | ${summary.rejected} | ${summary.needs_discussion} | ${summary.blankTargets} | ${summary.filledTargets} | ${summary.importReady} |`
  );

  return [
    "| Language | Total rows | needs_review | approved | rejected | needs_discussion | Blank targets | Filled targets | import-ready |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

function writeMarkdownReport(summaries, generatedAt) {
  const totals = totalSummaries(summaries);
  const markdown = [
    "# Translation Review Progress",
    "",
    `Report file: ${outputFile}`,
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Per-Language Progress",
    "",
    markdownTable(summaries),
    "",
    "## Totals",
    "",
    markdownTable([totals]),
    "",
    "## Import Reminder",
    "",
    "Only `approved` rows are importable. The import-ready count means rows with `status` set to `approved` and a nonblank `target` value.",
    "",
    "Generated approved dictionaries remain empty unless approved rows exist. Rows marked `needs_review`, `rejected`, or `needs_discussion` are not imported.",
    "",
  ].join("\n");

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, markdown);
}

try {
  const summaries = packPaths.map(summarizePack);
  const generatedAt = new Date().toISOString();
  const totals = totalSummaries(summaries);

  console.table(tableRows(summaries));
  console.log("\nTotals:");
  console.table(tableRows([totals]));

  writeMarkdownReport(summaries, generatedAt);
  console.log(`\nWrote ${outputFile}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
