#!/usr/bin/env node
// Keep the two working copies in step, and say so when they are not.
//
// The project lives twice: this local full-stack copy (Supabase in Docker, individual api/centre/*.js
// files served by the dev plugin) and the deploy repo, where those five Centre handlers were
// consolidated into api/_impl/centre-*.mjs behind one router to stay under Vercel's 12-function cap.
// Mirroring by hand has already put a fix in only one copy twice - once the report-photo reset, once
// the PIN reset - and in both cases production kept the old behaviour while the local copy looked
// correct. Nothing about that is visible from a passing build.
//
//   node scripts/sync-copies.mjs          # report drift only, change nothing
//   node scripts/sync-copies.mjs --apply  # copy this copy's version over the deploy repo
//
// Deliberately one-directional: this copy is where work happens. Anything only the deploy repo has
// (its routers, vercel.json) is listed as "deploy-only" and never touched.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const LOCAL = "/Users/kolarik/TEST_Claude/VetBara_final";
const DEPLOY = "/Users/kolarik/vetbara-github";
const apply = process.argv.includes("--apply");

// Paths that differ between the copies because of the function-count consolidation.
const RENAMES = {
  "api/centre/setup.js": "api/_impl/centre-setup.mjs",
  "api/centre/audit.js": "api/_impl/centre-audit.mjs",
  "api/centre/audit-export.js": "api/_impl/centre-audit-export.mjs",
  "api/centre/reset-qr-pin.js": "api/_impl/centre-reset-qr-pin.mjs",
  "api/centre/test-package/active.js": "api/_impl/centre-test-package-active.mjs",
};

// Thin re-export shims that exist only in the local copy so its dev plugin can route; the deploy
// repo reaches the same handler through its router.
const LOCAL_ONLY = new Set(["api/centre/accounts.js", "api/centre/outdoor-pacing.js"]);

// Files the deploy repo owns; never overwritten from here.
const DEPLOY_ONLY = new Set(["api/centre-router.js", "vercel.json"]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vercel", "supabase/.branches", ".claude"]);


// A RENAMED file sits at a different depth in each copy (api/centre/test-package/active.js became
// api/_impl/centre-test-package-active.mjs), so its relative imports legitimately differ - "../../_lib"
// here is "../_lib" there. Both are correct where they live. Without this the pair is reported as
// drift for ever, which trains you to ignore the report - the one thing a drift check must not do.
function normaliseForCompare(text, isRenamed) {
  return isRenamed ? text.replace(/(\.\.\/)+_lib\//g, "_LIB/") : text;
}

function walk(root, base = "") {
  const out = [];
  for (const entry of readdirSync(join(root, base))) {
    const rel = base ? `${base}/${entry}` : entry;
    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry)) continue;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) out.push(...walk(root, rel));
    else if (/\.(js|jsx|mjs|css|sql|json)$/.test(entry)) out.push(rel);
  }
  return out;
}

const tracked = walk(LOCAL).filter((rel) => (
  (rel.startsWith("src/") || rel.startsWith("api/") || rel.startsWith("supabase/migrations/"))
  && !LOCAL_ONLY.has(rel)
));

const drift = [];
for (const rel of tracked) {
  const target = RENAMES[rel] || rel;
  if (DEPLOY_ONLY.has(target)) continue;
  const localPath = join(LOCAL, rel);
  const deployPath = join(DEPLOY, target);
  const localText = readFileSync(localPath, "utf8");
  if (!existsSync(deployPath)) { drift.push({ rel, target, kind: "missing", deployNewer: false }); continue; }
  if (normaliseForCompare(readFileSync(deployPath, "utf8"), rel !== target) !== normaliseForCompare(localText, rel !== target)) {
    // Direction matters, and it is NOT always "local is ahead". The deploy repo has genuinely newer
    // work in places (its vetArchive.js and exams-router.js are substantially larger), so copying
    // blindly from here would destroy it. Anything newer on the deploy side is refused by default.
    const deployNewer = statSync(deployPath).mtimeMs > statSync(localPath).mtimeMs;
    drift.push({ rel, target, kind: "differs", deployNewer });
  }
}

if (!drift.length) {
  console.log(`  in step - ${tracked.length} tracked files identical`);
  process.exit(0);
}

console.log(`  ${drift.length} file(s) out of step (of ${tracked.length} tracked):`);
for (const item of drift) {
  const arrow = item.rel === item.target ? item.rel : `${item.rel} -> ${item.target}`;
  const flag = item.kind === "missing" ? "MISSING " : item.deployNewer ? "DEPLOY-NEWER" : "DIFFERS ";
  console.log(`   ${flag} ${arrow}`);
}

const only = (() => {
  const index = process.argv.indexOf("--only");
  return index >= 0 ? process.argv.slice(index + 1).filter((arg) => !arg.startsWith("--")) : null;
})();
const force = process.argv.includes("--force");

if (drift.some((item) => item.deployNewer)) {
  console.log("\n  NOTE: files marked DEPLOY-NEWER changed more recently in the deploy repo. Copying\n"
    + "  from here would discard that work, so they are skipped unless you pass --force.");
}

if (!apply) {
  console.log("\n  --apply            sync everything except DEPLOY-NEWER files");
  console.log("  --only <paths...>  sync just those paths (recommended after a focused change)");
  // Non-zero so this can gate a commit: drift is a finding, not a success.
  process.exit(1);
}

let synced = 0;
for (const item of drift) {
  if (only && !only.includes(item.rel) && !only.includes(item.target)) continue;
  if (item.deployNewer && !force) { console.log(`   skipped (deploy is newer): ${item.target}`); continue; }
  const deployPath = join(DEPLOY, item.target);
  if (!existsSync(dirname(deployPath))) { console.log(`   skipped (no such directory): ${item.target}`); continue; }
  writeFileSync(deployPath, readFileSync(join(LOCAL, item.rel), "utf8"));
  console.log(`   synced ${item.target}`);
  synced += 1;
}
console.log(`\n  ${synced} file(s) synced - review with \`git -C ${DEPLOY} diff\` before committing`);
