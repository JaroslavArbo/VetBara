#!/usr/bin/env node

import fs from "node:fs";

const packPath = process.argv[2] ?? "docs/i18n/de-translation-pack.json";
const write = process.argv.includes("--write");

const replacements = [
  [/\bfuer\b/g, "für"],
  [/\bFuer\b/g, "Für"],
  [/\boeffnen\b/g, "öffnen"],
  [/\bOeffnen\b/g, "Öffnen"],
  [/\bschliessen\b/g, "schließen"],
  [/\bSchliessen\b/g, "Schließen"],
  [/\bbestaetigen\b/g, "bestätigen"],
  [/\bBestaetigen\b/g, "Bestätigen"],
  [/\bwaehlen\b/g, "wählen"],
  [/\bWaehlen\b/g, "Wählen"],
  [/\bPruefungsabschnitte\b/g, "Prüfungsabschnitte"],
  [/\bPruefungsereignis\b/g, "Prüfungsereignis"],
  [/\bPruefungssprache\b/g, "Prüfungssprache"],
  [/\bPruefungs\b/g, "Prüfungs"],
  [/\bPruefung\b/g, "Prüfung"],
  [/\bPruefungen\b/g, "Prüfungen"],
  [/\bIdentitaet\b/g, "Identität"],
  [/\bpruefen\b/g, "prüfen"],
  [/\bPruefen\b/g, "Prüfen"],
  [/\bueber\b/g, "über"],
  [/\bUeber\b/g, "Über"],
  [/\bzurueck\b/g, "zurück"],
  [/\bZurueck\b/g, "Zurück"],
  [/\bmuessen\b/g, "müssen"],
  [/\bMuessen\b/g, "Müssen"],
  [/\bkoennen\b/g, "können"],
  [/\bKoennen\b/g, "Können"],
];

function loadPack(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function entriesOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  throw new Error("Expected array or object with entries array.");
}

const data = loadPack(packPath);
const entries = entriesOf(data);

let changedRows = 0;
const samples = [];

for (const entry of entries) {
  if (entry.status !== "needs_review") continue;

  const before = String(entry.target ?? "");
  let after = before;

  for (const [pattern, replacement] of replacements) {
    after = after.replace(pattern, replacement);
  }

  if (after !== before) {
    changedRows += 1;
    if (samples.length < 20) {
      samples.push({
        key: entry.key,
        before,
        after,
      });
    }
    entry.target = after;
  }

  entry.status = "needs_review";
}

const summary = {
  packPath,
  mode: write ? "write" : "dry-run",
  totalRows: entries.length,
  changedRows,
  samples,
};

console.log(JSON.stringify(summary, null, 2));

if (write) {
  fs.writeFileSync(packPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Updated ${packPath}`);
} else {
  console.log("Dry run only. No file was written.");
}
