#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const header = ["key", "en", "cs", "target", "notes", "status"];
const allowedStatuses = new Set(["needs_review", "approved", "rejected", "needs_discussion"]);

function usage() {
  return [
    "Usage: node scripts/sync-i18n-json-targets-to-csv.mjs <translation-pack.json> [translation-pack.json ...] [--dry-run|--write] [--csv <path>]",
    "",
    "Default mode is --dry-run. Use --write to update the matching CSV file.",
    "Use --csv only with a single JSON path to override the inferred CSV path for tests.",
  ].join("\n");
}

function parseArgs(argv) {
  const jsonPaths = [];
  let mode = "dry-run";
  let csvOverride = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      mode = "dry-run";
      continue;
    }

    if (arg === "--write") {
      mode = "write";
      continue;
    }

    if (arg === "--csv") {
      csvOverride = argv[index + 1];
      if (!csvOverride) {
        throw new Error("--csv requires a path");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unsupported flag: ${arg}`);
    }

    jsonPaths.push(arg);
  }

  if (!jsonPaths.length) {
    throw new Error(usage());
  }

  if (csvOverride && jsonPaths.length !== 1) {
    throw new Error("--csv can only be used with a single JSON path");
  }

  return { jsonPaths, mode, csvOverride };
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
  const match = path.basename(filePath).match(/^([a-z]{2})-translation-pack(?:-test)?\.json$/u);
  if (!match) {
    throw new Error(`${filePath}: could not infer language code from filename`);
  }
  return match[1];
}

function inferCsvPath(jsonPath) {
  if (!jsonPath.endsWith(".json")) {
    throw new Error(`${jsonPath}: expected a .json translation pack path`);
  }
  return jsonPath.replace(/\.json$/u, ".csv");
}

function parseCsv(text, filePath) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error(`${filePath}: unterminated quoted CSV field`);
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    throw new Error(`${filePath}: CSV file is empty`);
  }

  return rows;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath}: CSV file is missing`);
  }

  const rows = parseCsv(fs.readFileSync(filePath, "utf8"), filePath);
  const csvHeader = rows[0];

  for (const column of header) {
    if (!csvHeader.includes(column)) {
      throw new Error(`${filePath}: required CSV column missing: ${column}`);
    }
  }

  if (csvHeader.join(",") !== header.join(",")) {
    throw new Error(`${filePath}: CSV header must be exactly ${header.join(",")}`);
  }

  return rows;
}

function entriesByKey(entries, filePath) {
  const map = new Map();

  for (const [index, entry] of entries.entries()) {
    const key = entry.key;
    if (!key) {
      throw new Error(`${filePath}: row ${index + 1} is missing key`);
    }
    if (map.has(key)) {
      throw new Error(`${filePath}: duplicate key: ${key}`);
    }
    if (!allowedStatuses.has(entry.status)) {
      throw new Error(`${filePath}: ${key}: unsupported status: ${entry.status}`);
    }
    map.set(key, entry);
  }

  return map;
}

function csvRowsByKey(rows, filePath) {
  const map = new Map();
  const dataRows = rows.slice(1);

  for (const [index, row] of dataRows.entries()) {
    if (row.length !== header.length) {
      throw new Error(`${filePath}: CSV row ${index + 2} has ${row.length} columns, expected ${header.length}`);
    }
    const key = row[0];
    if (!key) {
      throw new Error(`${filePath}: CSV row ${index + 2} is missing key`);
    }
    if (map.has(key)) {
      throw new Error(`${filePath}: duplicate key: ${key}`);
    }
    if (!allowedStatuses.has(row[5])) {
      throw new Error(`${filePath}: ${key}: unsupported status: ${row[5]}`);
    }
    map.set(key, row);
  }

  return map;
}

function compareKeySets(jsonMap, csvMap, jsonPath, csvPath) {
  const jsonKeys = new Set(jsonMap.keys());
  const csvKeys = new Set(csvMap.keys());
  const missingFromCsv = [...jsonKeys].filter((key) => !csvKeys.has(key));
  const missingFromJson = [...csvKeys].filter((key) => !jsonKeys.has(key));

  if (missingFromCsv.length || missingFromJson.length) {
    throw new Error(
      `${jsonPath} and ${csvPath}: JSON and CSV key sets differ. missingFromCsv=${missingFromCsv.join(",") || "(none)"}; missingFromJson=${missingFromJson.join(",") || "(none)"}`
    );
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/u.test(text)) {
    return `"${text.replace(/"/gu, '""')}"`;
  }
  return text;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function syncPack(jsonPath, options) {
  const csvPath = options.csvOverride ?? inferCsvPath(jsonPath);
  const language = inferLanguage(jsonPath);
  const jsonEntries = normalizeEntries(readJson(jsonPath), jsonPath);
  const csvRows = readCsv(csvPath);
  const jsonMap = entriesByKey(jsonEntries, jsonPath);
  const csvMap = csvRowsByKey(csvRows, csvPath);

  compareKeySets(jsonMap, csvMap, jsonPath, csvPath);

  let updatedTargets = 0;
  let updatedStatuses = 0;
  let unchanged = 0;

  for (const row of csvRows.slice(1)) {
    const jsonEntry = jsonMap.get(row[0]);
    const nextTarget = String(jsonEntry.target ?? "");
    const nextStatus = jsonEntry.status;
    let changed = false;

    if (row[3] !== nextTarget) {
      row[3] = nextTarget;
      updatedTargets += 1;
      changed = true;
    }

    if (row[5] !== nextStatus) {
      row[5] = nextStatus;
      updatedStatuses += 1;
      changed = true;
    }

    if (!changed) {
      unchanged += 1;
    }
  }

  if (options.mode === "write") {
    fs.writeFileSync(csvPath, serializeCsv(csvRows));
  }

  return {
    language,
    rows: csvRows.length - 1,
    updatedTargets,
    updatedStatuses,
    unchanged,
    mode: options.mode,
    csvPath,
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const summaries = options.jsonPaths.map((jsonPath) => syncPack(jsonPath, options));
  console.table(summaries);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
