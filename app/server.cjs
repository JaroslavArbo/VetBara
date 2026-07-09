#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');

const args = process.argv.slice(2);
function argValue(name, fallback = '') { const prefix = `--${name}=`; const found = args.find((a) => a.startsWith(prefix)); return found ? found.slice(prefix.length) : fallback; }
function hasArg(name) { return args.includes(`--${name}`); }

const mode = (argValue('mode', process.env.VETBARA_MODE || 'admin') || 'admin').toLowerCase();
const port = Number(argValue('port', process.env.PORT || '3010')) || 3010;
const fixedHost = argValue('host-ip', process.env.VETBARA_HOST_IP || '');
const appDir = __dirname;
const distDir = path.join(appDir, 'dist');
const dataDir = path.join(appDir, 'data');
const certDir = path.join(appDir, 'certs');
function fileExists(file) { try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; } }
function discoverHttpsCerts() {
  const explicitCert = argValue('cert', process.env.VETBARA_HTTPS_CERT || '');
  const explicitKey = argValue('key', process.env.VETBARA_HTTPS_KEY || '');
  if (explicitCert && explicitKey && fileExists(explicitCert) && fileExists(explicitKey)) return { certFile: explicitCert, keyFile: explicitKey, source: 'explicit' };
  const pairs = [
    ['vetbara-lan.pem', 'vetbara-lan-key.pem'],
    ['vetbara.test.pem', 'vetbara.test-key.pem'],
    ['server.pem', 'server-key.pem'],
    ['cert.pem', 'key.pem'],
  ];
  for (const [certName, keyName] of pairs) {
    const certFile = path.join(certDir, certName);
    const keyFile = path.join(certDir, keyName);
    if (fileExists(certFile) && fileExists(keyFile)) return { certFile, keyFile, source: `${certName} + ${keyName}` };
  }
  return null;
}
const httpsCerts = discoverHttpsCerts();
const forceHttps = hasArg('https') || String(process.env.VETBARA_HTTPS || '').toLowerCase() === 'true';
const useHttps = Boolean(httpsCerts) || forceHttps;
if (forceHttps && !httpsCerts) {
  console.warn('HTTPS was requested, but no certificate/key pair was found in app/certs. Falling back to HTTP.');
}
const centreLinkFile = path.join(dataDir, 'centre-link.txt');
function readTextFile(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } }
const centreLinkRaw = argValue('centre-link', process.env.VETBARA_CENTRE_LINK || '') || readTextFile(centreLinkFile);

// Single secret used to authorize the privileged operator of THIS instance (Admin, when
// --mode=admin; Centre, when --mode=centre). It is only ever embedded in a page load that
// matches this instance's own role, never in Candidate/Examiner/FieldTablet page loads, and
// every mutating/privileged API call must present it. See requireOperatorToken().
// Persisted to disk and reused across restarts: a fresh random token every restart would
// silently invalidate any Admin/Centre browser tab left open from before the restart (its
// autosave/save calls would start failing with 401), risking loss of in-progress edits that
// hadn't been saved yet. Delete the file (or set VETBARA_ADMIN_TOKEN) to force a new token.
const operatorTokenFile = path.join(dataDir, 'operator-token.txt');
function loadOrCreateOperatorToken() {
  const fromEnv = process.env.VETBARA_ADMIN_TOKEN || process.env.VETBARA_OPERATOR_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const existing = fs.readFileSync(operatorTokenFile, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const fresh = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(operatorTokenFile, fresh, 'utf8');
  } catch {}
  return fresh;
}
const operatorToken = loadOrCreateOperatorToken();
const operatorTokenBuf = Buffer.from(operatorToken, 'utf8');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
const backupsDir = path.join(dataDir, 'backups');
const syncDir = path.join(dataDir, 'sync');
ensureDir(dataDir); ensureDir(syncDir); ensureDir(path.join(dataDir, 'packages')); ensureDir(path.join(dataDir, 'results')); ensureDir(path.join(dataDir, 'final')); ensureDir(path.join(dataDir, 'scans')); ensureDir(path.join(dataDir, 'logbook')); ensureDir(backupsDir);

// --- Integrity: in-memory + persisted log of data problems (corrupt JSON, failed parses) ---
// so they surface via /api/health instead of being silently swallowed.
const integrityAlertsPath = path.join(dataDir, 'integrity-alerts.json');
let integrityWarnings = readJsonRaw(integrityAlertsPath, []);
function readJsonRaw(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function recordIntegrityWarning(context, error) {
  const entry = { at: new Date().toISOString(), context, error: String(error && error.message || error) };
  integrityWarnings.push(entry);
  if (integrityWarnings.length > 200) integrityWarnings = integrityWarnings.slice(-200);
  try { fs.writeFileSync(integrityAlertsPath, JSON.stringify(integrityWarnings, null, 2)); } catch {}
  console.error(`[integrity] ${context}:`, error);
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { recordIntegrityWarning(`readJson:${file}`, err); return fallback; }
}
// Atomic write: write to a temp file in the same directory, then rename over the target.
// Avoids leaving a half-written/corrupt JSON file behind on crash or power loss mid-write.
function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
// Before overwriting a critical file, keep a timestamped copy so a bad approve/import can be rolled back by hand.
function backupThenWrite(file, data, keep = 20) {
  if (fs.existsSync(file)) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupsDir, `${path.basename(file)}.${stamp}.bak.json`);
      fs.copyFileSync(file, backupFile);
      const prefix = `${path.basename(file)}.`;
      const older = fs.readdirSync(backupsDir).filter((n) => n.startsWith(prefix)).sort();
      for (const old of older.slice(0, Math.max(0, older.length - keep))) { try { fs.unlinkSync(path.join(backupsDir, old)); } catch {} }
    } catch (err) { recordIntegrityWarning(`backup:${file}`, err); }
  }
  writeJson(file, data);
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload ?? {}, null, 2);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req), ...extraHeaders };
  res.writeHead(status, headers);
  res.end(body);
}
function readBody(req) { return new Promise((resolve) => { const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({ raw: text }); } }); }); }
function localIpv4() { if (fixedHost) return fixedHost; const nets = os.networkInterfaces(); for (const entries of Object.values(nets)) { for (const entry of entries || []) { if (entry && entry.family === 'IPv4' && !entry.internal) return entry.address; } } return '127.0.0.1'; }
const lanIp = localIpv4();
const protocol = useHttps && httpsCerts ? 'https' : 'http';
const publicHost = argValue('public-host', process.env.VETBARA_PUBLIC_HOST || lanIp) || lanIp;
const localHost = argValue('local-host', process.env.VETBARA_LOCAL_HOST || (protocol === 'https' ? 'localhost' : '127.0.0.1'));
const baseUrl = argValue('public-base-url', process.env.VETBARA_PUBLIC_BASE_URL || `${protocol}://${publicHost}:${port}`);
const localBaseUrl = argValue('local-base-url', process.env.VETBARA_LOCAL_BASE_URL || `${protocol}://${localHost}:${port}`);

// --- CORS: reflect only origins that can legitimately be this deployment (LAN base URL, ---
// local URL, localhost/127.0.0.1 on the same port). Anything else gets no CORS header, so
// a page on another site/host cannot call this API cross-origin from a browser.
const allowedOrigins = new Set([baseUrl, localBaseUrl, `${protocol}://${lanIp}:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`, `https://127.0.0.1:${port}`, `https://localhost:${port}`].filter(Boolean));
function corsHeaders(req) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-VetBara-Operator-Token', 'Access-Control-Allow-Credentials': 'true' };
  }
  return {};
}

function normalizeCentreLink(raw) { if (!raw) return ''; try { const u = new URL(raw); if ((u.searchParams.get('role') || '').toLowerCase() !== 'centre') return ''; const out = new URL(baseUrl + '/'); out.search = u.search; return out.toString(); } catch { if (raw.includes('role=Centre') || raw.includes('role=centre')) return `${baseUrl}/${raw.startsWith('?') ? raw : `?${raw}`}`; return ''; } }
let centreLink = normalizeCentreLink(centreLinkRaw);
let centreLinkMissing = mode === 'centre' && !centreLink;
if (mode === 'centre' && centreLinkMissing) {
  console.warn('\nVetBara Centre started without a Centre access link.');
  console.warn('The browser will show a setup page where the Admin Centre link can be pasted.\n');
}

const activePackagePath = path.join(dataDir, 'active-test-package.json');
const latestPackagePath = path.join(dataDir, 'latest-admin-package.json');
const centreSetupPath = path.join(dataDir, 'centre-setup.json');
const localResultsPath = path.join(dataDir, 'examiner-results.json');
const finalDir = path.join(dataDir, 'final');
function activePackage() { return readJson(activePackagePath, readJson(latestPackagePath, { ok: false, variants: [], questions: [] })); }
function tokenAccess(tokenOrUrl) { const raw = String(tokenOrUrl || ''); let u = null; try { u = new URL(raw); } catch {} const params = u ? u.searchParams : new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw); const role = params.get('role') || (raw.includes('CANDIDATE') ? 'Candidate' : raw.includes('EXAMINER') ? 'Examiner' : raw.includes('CENTRE') ? 'Centre' : ''); const subjectId = params.get('id') || params.get('subjectId') || (raw.match(/C-\d{3}/)?.[0]) || (raw.match(/E-\d{3}/)?.[0]) || (role === 'Centre' ? 'CENTRE-ARBOR' : ''); return { role: role || 'Centre', subjectId, token: params.get('token') || raw, name: params.get('name') || '', level: params.get('level') || '', sessionToken: `local-${role || 'Centre'}-${subjectId || 'session'}-${Date.now()}`, mode: 'portable-lan' }; }

// --- Sync log rotation: one file per day (plus a part-N suffix if a single day gets huge), ---
// instead of one array that grows for the whole life of the install.
const SYNC_ROTATE_AT = 5000;
function dateStamp(d = new Date()) { return d.toISOString().slice(0, 10); }
function currentSyncLogPath() {
  const stamp = dateStamp();
  let part = 1;
  let file = path.join(syncDir, `events-${stamp}.json`);
  while (true) {
    const existing = readJson(file, []);
    if (!Array.isArray(existing) || existing.length < SYNC_ROTATE_AT) return file;
    part += 1;
    file = path.join(syncDir, `events-${stamp}-part${part}.json`);
  }
}
function allSyncLogFiles() {
  const legacy = path.join(syncDir, 'events.json');
  const rotated = fs.existsSync(syncDir) ? fs.readdirSync(syncDir).filter((n) => /^events-.*\.json$/.test(n)).sort().map((n) => path.join(syncDir, n)) : [];
  return [...(fs.existsSync(legacy) ? [legacy] : []), ...rotated];
}
function saveSyncEvents(events) {
  const file = currentSyncLogPath();
  const current = readJson(file, []);
  const appended = current.concat((Array.isArray(events) ? events : []).map((event) => ({ ...event, receivedAt: new Date().toISOString() })));
  writeJson(file, appended);
  return appended.length;
}
function readAllSyncEvents() { return allSyncLogFiles().flatMap((f) => readJson(f, [])); }

// --- Operator-token guard for privileged Admin/Centre-only actions. ---
// Candidate/Examiner/FieldTablet page loads never receive this token (see injectedIndexHtml),
// so only a browser that legitimately opened this instance's own Admin/Centre workspace can
// call these endpoints. Missing/incorrect token -> 401, no side effect performed.
function requireOperatorToken(req) {
  const header = req.headers['x-vetbara-operator-token'];
  const url = new URL(req.url, baseUrl);
  const provided = String(header || url.searchParams.get('operatorToken') || '');
  if (!provided) return false;
  const providedBuf = Buffer.from(provided, 'utf8');
  if (providedBuf.length !== operatorTokenBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, operatorTokenBuf);
}

async function api(req, res, pathname) {
  const reply = (status, payload, headers) => sendJson(req, res, status, payload, headers);
  if (req.method === 'OPTIONS') return reply(204, {});
  const guarded = (fn) => async () => {
    if (!requireOperatorToken(req)) return reply(401, { ok: false, error: 'This action requires the operator token for this VetBara instance (Admin or Centre workspace only).' });
    return fn();
  };

  if (pathname === '/api/assets-list') {
    const dir = path.join(distDir, 'assets');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    return reply(200, { ok: true, distDir, assetsDir: dir, files });
  }
  if (pathname === '/api/centre-link') {
    if (req.method === 'POST') return guarded(async () => {
      const body = await readBody(req);
      const raw = String(body.link || body.url || body.raw || '').trim();
      const normalized = normalizeCentreLink(raw);
      if (!normalized) return reply(400, { ok: false, error: 'Invalid Centre access link. It must contain role=Centre and token=...' });
      writeJson(path.join(dataDir, 'centre-link.json'), { raw, normalized, savedAt: new Date().toISOString() });
      fs.writeFileSync(centreLinkFile, raw, 'utf8');
      centreLink = normalized;
      centreLinkMissing = false;
      const local = new URL(localBaseUrl + '/'); try { local.search = new URL(normalized).search; } catch {} return reply(200, { ok: true, centreLink: normalized, localCentreLink: local.toString() });
    })();
    return reply(200, { ok: true, centreLink, missing: centreLinkMissing });
  }
  if (pathname === '/api/health') return reply(200, { ok: true, service: 'vetbara-portable-lan', mode, time: new Date().toISOString(), protocol, https: protocol === 'https', gpsReady: protocol === 'https', baseUrl, localBaseUrl, lanIp, publicHost, dataDir, certSource: httpsCerts ? httpsCerts.source : null, integrityWarnings: integrityWarnings.slice(-20) });
  if (pathname === '/api/portable/info') return reply(200, { ok: true, mode, protocol, https: protocol === 'https', gpsReady: protocol === 'https', baseUrl, localBaseUrl, centreLink, centreLinkMissing, dataDir, activePackage: activePackage() });
  if (pathname === '/api/qr/resolve' && req.method === 'POST') { const body = await readBody(req); return reply(200, tokenAccess(body.token || body.url || body.raw)); }
  if (pathname === '/api/session/bootstrap' && req.method === 'POST') { const body = await readBody(req); return reply(200, { ok: true, sessionToken: body.sessionToken, portable: true, baseUrl, testPackage: activePackage(), centreSetup: readJson(centreSetupPath, {}) }); }
  if (pathname === '/api/sync/batch' && req.method === 'POST') { const body = await readBody(req); const count = saveSyncEvents(body.events || []); return reply(200, { ok: true, stored: count }); }
  // Lets the Centre (a separate device/browser tab from Candidates and Examiners on the real
  // portable LAN deployment) poll for activity that happened elsewhere, so its "Auditní stopa"
  // reflects opens/closes/edits/fullscreen-exits/app-switches across every device, not just its
  // own local actions. Guarded: this is candidate/examiner activity data, Centre/Admin-only.
  if (pathname === '/api/sync/recent' && req.method === 'GET') return guarded(async () => {
    const url = new URL(req.url, baseUrl);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 300));
    const events = readAllSyncEvents();
    events.sort((a, b) => String(a.receivedAt || a.createdAt || '').localeCompare(String(b.receivedAt || b.createdAt || '')));
    return reply(200, { ok: true, events: events.slice(-limit) });
  })();
  if (pathname === '/api/centre/setup' && req.method === 'POST') return guarded(async () => {
    const body = await readBody(req);
    if (body.action === 'save') { const payload = { ...(readJson(centreSetupPath, {}) || {}), candidates: body.candidates || [], examiners: body.examiners || [], assignments: body.assignments || [], testPackage: body.testPackage || activePackage(), updatedAt: new Date().toISOString() }; backupThenWrite(centreSetupPath, payload); return reply(200, { ok: true, ...payload }); }
    return reply(200, { ok: true, ...(readJson(centreSetupPath, {}) || {}) });
  })();
  if (pathname === '/api/centre/setup') return reply(200, { ok: true, ...(readJson(centreSetupPath, {}) || {}) });
  if (pathname === '/api/centre/test-package/active') {
    if (req.method === 'POST' || req.method === 'PUT') return guarded(async () => { const body = await readBody(req); backupThenWrite(activePackagePath, body?.package || body?.testPackage || body); return reply(200, { ok: true, package: activePackage() }); })();
    return reply(200, activePackage());
  }
  if (pathname === '/api/admin/test-package/latest' || pathname === '/api/admin/test-package/approved') return reply(200, activePackage());
  if (pathname === '/api/admin/test-package/list') return reply(200, { packages: [{ id: 'portable-active', label: 'Portable active package', updatedAt: new Date().toISOString(), package: activePackage() }] });
  if (pathname === '/api/admin/test-package/authoring/save' && req.method === 'POST') return guarded(async () => { const body = await readBody(req); backupThenWrite(latestPackagePath, body?.package || body?.testPackage || body); return reply(200, { ok: true, id: 'portable-latest' }); })();
  if (pathname === '/api/admin/test-package/approve' && req.method === 'POST') return guarded(async () => { const latest = readJson(latestPackagePath, activePackage()); backupThenWrite(activePackagePath, latest); return reply(200, { ok: true, package: latest }); })();
  if (pathname === '/api/admin/test-package/convert' && req.method === 'POST') return guarded(async () => { const body = await readBody(req); return reply(200, { ok: true, package: body }); })();
  if (pathname.startsWith('/api/admin/authoring-drafts')) {
    const authoringDraftsDir = path.join(dataDir, 'authoring-drafts');
    ensureDir(authoringDraftsDir);
    function listDraftFiles() {
      try { return fs.readdirSync(authoringDraftsDir).filter((name) => name.endsWith('.json')).sort().reverse(); } catch { return []; }
    }
    function draftSummary(filename, draft) {
      return { filename, draftId: draft.draftId || filename, title: draft.title || '', updatedAt: draft.updatedAt || draft.createdAt || '' };
    }
    if (pathname.endsWith('/list')) {
      const drafts = listDraftFiles()
        .map((filename) => { const draft = readJson(path.join(authoringDraftsDir, filename), null); return draft ? draftSummary(filename, draft) : null; })
        .filter(Boolean);
      return reply(200, { drafts });
    }
    if (pathname.endsWith('/latest')) {
      const files = listDraftFiles();
      const draft = files.length ? readJson(path.join(authoringDraftsDir, files[0]), null) : null;
      if (!draft) return reply(404, { error: 'No saved draft found.' });
      return reply(200, draft);
    }
    if (pathname.endsWith('/save') && req.method === 'POST') return guarded(async () => {
      const body = await readBody(req);
      const incoming = body?.draft && typeof body.draft === 'object' ? body.draft : body;
      const now = new Date().toISOString();
      const draftId = incoming.draftId || `draft-${Date.now()}`;
      const draft = { ...incoming, draftId, updatedAt: now };
      const filename = `${now.replace(/[:.]/g, '-')}-${draftId}.json`;
      writeJson(path.join(authoringDraftsDir, filename), draft);
      return reply(200, { ok: true, draft, filename, summary: draftSummary(filename, draft) });
    })();
    const requestedDraftId = decodeURIComponent(pathname.split('/').pop() || '');
    if (req.method === 'GET' && requestedDraftId && requestedDraftId !== 'authoring-drafts') {
      const match = listDraftFiles().find((filename) => filename.includes(requestedDraftId));
      const draft = match ? readJson(path.join(authoringDraftsDir, match), null) : null;
      if (draft) return reply(200, draft);
      return reply(404, { error: `Draft not found: ${requestedDraftId}` });
    }
    return reply(200, { ok: true });
  }
  if (pathname === '/api/local-results') { if (req.method === 'POST' || req.method === 'PUT') { const body = await readBody(req); writeJson(localResultsPath, body.results || body); return reply(200, { ok: true, results: readJson(localResultsPath, {}) }); } return reply(200, { ok: true, results: readJson(localResultsPath, {}) }); }
  if (pathname === '/api/local-exchange/packages') return reply(200, { packages: [] });
  if (pathname.startsWith('/api/local-exchange/packages/')) return reply(404, { error: 'No local exchange package found in portable runner.' });
  if (pathname === '/api/evaluation/candidate' && req.method === 'POST') return reply(200, { sections: [], testResponses: [], outdoor: [], report: {} });
  if (pathname === '/api/evaluation/export' && req.method === 'POST') return reply(200, { filename: 'VetBara_Evaluation_Draft.xls', mimeType: 'application/vnd.ms-excel', base64: Buffer.from('VetBara portable evaluation export is stored in the final .vet_fin package.').toString('base64') });
  if (pathname === '/api/centre/audit-export' && req.method === 'POST') return guarded(async () => reply(200, { filename: 'VetBara_Centre_Audit.json', mimeType: 'application/json', base64: Buffer.from(JSON.stringify({ centreSetup: readJson(centreSetupPath, {}), sync: readAllSyncEvents(), activePackage: activePackage() }, null, 2)).toString('base64') }))();
  if (pathname === '/api/centre/final-package' && req.method === 'POST') return guarded(async () => {
    const body = await readBody(req);
    const name = `VetBara_${(body.examId || 'exam').replace(/[^a-z0-9_-]+/gi, '_')}_${Date.now()}.vet_fin.json`;
    const payload = { createdAt: new Date().toISOString(), mode: 'portable-lan', body, activePackage: activePackage(), centreSetup: readJson(centreSetupPath, {}), localResults: readJson(localResultsPath, {}), sync: readAllSyncEvents() };
    const file = path.join(finalDir, name);
    writeJson(file, payload);
    return reply(200, { ok: true, filename: name, path: file, base64: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'), mimeType: 'application/json' });
  })();
  {
    const fieldMatch = pathname.match(/^\/api\/exams\/([^/]+)\/field-preparation$/);
    const fieldValidateMatch = pathname.match(/^\/api\/exams\/([^/]+)\/field-preparation\/validate$/);
    const fieldPackageMatch = pathname.match(/^\/api\/exams\/([^/]+)\/field-package\/(practicing|consulting)$/);
    const tabletSyncMatch = pathname.match(/^\/api\/exams\/([^/]+)\/field-tablet-sync$/);
    const tabletSyncLatestMatch = pathname.match(/^\/api\/exams\/([^/]+)\/field-tablet-sync\/latest$/);
    if (fieldMatch || fieldValidateMatch || fieldPackageMatch || tabletSyncMatch || tabletSyncLatestMatch) {
      const examId = decodeURIComponent((fieldMatch || fieldValidateMatch || fieldPackageMatch || tabletSyncMatch || tabletSyncLatestMatch)[1]);
      const safeExamId = examId.replace(/[^a-z0-9_-]/gi, '_');
      const fieldPreparationsDir = path.join(dataDir, 'field-preparations');
      const fieldTabletSyncDir = path.join(dataDir, 'field-tablet-sync');
      ensureDir(fieldPreparationsDir);
      ensureDir(fieldTabletSyncDir);
      const prepFile = path.join(fieldPreparationsDir, `${safeExamId}.json`);
      const readPreparation = () => readJson(prepFile, null);

      function validateFieldPreparation(prep) {
        const issues = [];
        const hasNumber = (value) => Number.isFinite(Number(value));
        if (!hasNumber(prep?.examCenter?.point?.lat) || !hasNumber(prep?.examCenter?.point?.lng)) {
          issues.push({ severity: 'error', code: 'MISSING_CENTER_COORDINATES', message: 'Zkušební centrum nemá platné GPS souřadnice.' });
        }
        for (const level of ['Practicing', 'Consulting']) {
          for (const code of ['A', 'B', 'C', 'D']) {
            const matches = (prep?.trees || []).filter((tree) => (tree.assignments || []).some((a) => a.level === level && a.code === code));
            if (!matches.length) issues.push({ severity: 'error', code: `MISSING_${level.toUpperCase()}_${code}`, message: `Chybí ${level} strom ${code}.` });
            if (matches.length > 1) issues.push({ severity: 'warning', code: `DUPLICATE_${level.toUpperCase()}_${code}`, message: `${level} strom ${code} je přiřazen více než jednou.` });
          }
        }
        const practicingA = (prep?.trees || []).find((tree) => (tree.assignments || []).some((a) => a.level === 'Practicing' && a.code === 'A'));
        if (!practicingA?.practicingTreeAData) issues.push({ severity: 'error', code: 'MISSING_PRACTICING_A_DATA', message: 'Practicing A nemá vyplněná management data.' });
        return { valid: !issues.some((issue) => issue.severity === 'error'), issues };
      }

      function candidatePackage(prep, level) {
        const normalizedLevel = level === 'practicing' ? 'Practicing' : 'Consulting';
        const trees = (prep?.trees || []).flatMap((tree) => (tree.assignments || [])
          .filter((assignment) => assignment.level === normalizedLevel && assignment.visibleToCandidate !== false)
          .map((assignment) => ({
            id: tree.id,
            code: assignment.code,
            name: tree.name,
            latitude: Number(tree.point?.lat),
            longitude: Number(tree.point?.lng),
            candidateNote: tree.candidateNote || '',
            photos: (tree.photos || []).map((photo) => ({ id: photo.id, fileName: photo.fileName || photo.name, url: photo.url, thumbnailUrl: photo.thumbnailUrl, caption: photo.caption || '' })),
            practicingTreeAData: tree.practicingTreeAData,
          })));
        return {
          packageType: 'vetbara-field-exam',
          packageVersion: '1.0',
          examId: prep.examId || examId,
          level: normalizedLevel.toUpperCase(),
          siteName: prep.siteName,
          createdAt: new Date().toISOString(),
          examCenter: {
            latitude: Number(prep.examCenter?.point?.lat),
            longitude: Number(prep.examCenter?.point?.lng),
            candidateNote: prep.examCenter?.candidateNote || '',
            photos: prep.examCenter?.photos || [],
          },
          trees: trees.sort((a, b) => String(a.code).localeCompare(String(b.code))),
        };
      }

      function applyFieldPreparationSnapshot(prep, syncPayload) {
        const snapshot = syncPayload?.fieldPreparationSnapshot;
        if (!snapshot || typeof snapshot !== 'object') return null;
        const now = new Date().toISOString();
        const current = prep && typeof prep === 'object' ? prep : {};
        const centre = snapshot.examCenter && typeof snapshot.examCenter === 'object' ? snapshot.examCenter : {};
        const centrePoint = centre.point && typeof centre.point === 'object' ? centre.point : {};
        const centreLat = Number(centrePoint.lat ?? centrePoint.latitude ?? centre.latitude ?? centre.lat);
        const centreLng = Number(centrePoint.lng ?? centrePoint.longitude ?? centre.longitude ?? centre.lng);
        const referenceLatitude = Number(snapshot.referenceLatitude ?? snapshot.mapView?.center?.lat ?? current.referenceLatitude ?? centreLat);
        const referenceLongitude = Number(snapshot.referenceLongitude ?? snapshot.mapView?.center?.lng ?? current.referenceLongitude ?? centreLng);
        const trees = Array.isArray(snapshot.trees) ? snapshot.trees : [];
        return {
          ...current,
          examId: snapshot.examId || current.examId || examId,
          siteName: snapshot.siteName || current.siteName || '',
          referenceLatitude,
          referenceLongitude,
          updatedAt: now,
          updatedBy: 'Field tablet sync',
          lastTabletSyncId: syncPayload?.syncId || null,
          lastTabletSyncAt: syncPayload?.receivedAt || syncPayload?.syncedAt || now,
          examCenter: {
            ...(current.examCenter || {}),
            ...centre,
            point: { ...(current.examCenter?.point || {}), ...(centrePoint || {}), lat: centreLat, lng: centreLng },
          },
          trees: trees.map((tree, index) => {
            const point = tree.point && typeof tree.point === 'object' ? tree.point : {};
            const lat = Number(point.lat ?? point.latitude ?? tree.latitude ?? tree.lat);
            const lng = Number(point.lng ?? point.longitude ?? tree.longitude ?? tree.lng);
            const assignments = Array.isArray(tree.assignments) && tree.assignments.length
              ? tree.assignments
              : [{ level: tree.level || 'Practicing', code: tree.code || String.fromCharCode(65 + (index % 4)), visibleToCandidate: true }];
            return {
              ...tree,
              id: tree.id || `field-tree-${index + 1}`,
              name: tree.name || `Strom ${index + 1}`,
              assignments,
              point: { ...(point || {}), lat, lng },
              candidateNote: tree.candidateNote || '',
              practicingTreeAData: tree.practicingTreeAData || tree.managementData || { interventions: [] },
              labelDirection: tree.labelDirection || 'n',
              labelOffsetX: Number(tree.labelOffsetX || 0),
              labelOffsetY: Number(tree.labelOffsetY || 0),
            };
          }),
        };
      }

      function mergeTabletSyncIntoPreparation(prep, syncPayload) {
        const snapshotApplied = applyFieldPreparationSnapshot(prep, syncPayload);
        if (snapshotApplied) return snapshotApplied;
        if (!prep || typeof prep !== 'object') return prep;
        const draft = syncPayload?.draft && typeof syncPayload.draft === 'object' ? syncPayload.draft : {};
        const treeNotes = draft.treeNotes && typeof draft.treeNotes === 'object' ? draft.treeNotes : {};
        const packageSnapshot = syncPayload?.packageSnapshot && typeof syncPayload.packageSnapshot === 'object' ? syncPayload.packageSnapshot : {};
        const packageTrees = Array.isArray(packageSnapshot.trees) ? packageSnapshot.trees : [];
        const now = new Date().toISOString();
        function treeKey(level, code) {
          const normalizedLevel = String(level || 'Practicing').toLowerCase() === 'consulting' ? 'Consulting' : 'Practicing';
          return `${normalizedLevel}:${String(code || '').trim().toUpperCase()}`;
        }
        function noteFor(level, code) {
          const codeOnly = String(code || '').trim().toUpperCase();
          return treeNotes[treeKey(level, codeOnly)] || treeNotes[codeOnly] || null;
        }
        function snapshotFor(level, code) {
          const wanted = treeKey(level, code);
          return packageTrees.find((tree) => treeKey(tree.level || level, tree.code) === wanted) || null;
        }
        const next = { ...prep, updatedAt: now, updatedBy: 'Field tablet sync' };
        const centerDraft = draft.examCenter && typeof draft.examCenter === 'object' ? draft.examCenter : {};
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
            if (n?.managementData && typeof n.managementData === 'object') merged.practicingTreeAData = { ...(merged.practicingTreeAData || {}), ...n.managementData };
            if (n?.labelDirection) merged.labelDirection = n.labelDirection;
            if (n?.labelOffsetX !== undefined) merged.labelOffsetX = Number(n.labelOffsetX || 0);
            if (n?.labelOffsetY !== undefined) merged.labelOffsetY = Number(n.labelOffsetY || 0);
          }
          return merged;
        });
        return next;
      }

      function readLatestTabletSync() {
        try {
          const entries = fs.readdirSync(fieldTabletSyncDir).filter((name) => name.endsWith('.json') && name.includes(safeExamId)).sort().reverse();
          for (const name of entries) {
            const data = readJson(path.join(fieldTabletSyncDir, name), null);
            if (data) return data;
          }
          return null;
        } catch { return null; }
      }

      if (req.method === 'GET' && fieldMatch) {
        const data = readPreparation();
        if (!data) return reply(404, { error: 'Field preparation not found' });
        return reply(200, { fieldPreparation: data });
      }
      if (req.method === 'PUT' && fieldMatch) {
        const body = await readBody(req);
        const incoming = body.fieldPreparation || body;
        if (!incoming || typeof incoming !== 'object') return reply(400, { error: 'Invalid field preparation payload' });
        const stored = { ...incoming, examId: incoming.examId || examId, updatedAt: new Date().toISOString() };
        backupThenWrite(prepFile, stored);
        return reply(200, { ok: true, fieldPreparation: stored, validation: validateFieldPreparation(stored) });
      }
      if (req.method === 'POST' && fieldValidateMatch) {
        const data = readPreparation();
        if (!data) return reply(404, { error: 'Field preparation not found' });
        return reply(200, validateFieldPreparation(data));
      }
      if (req.method === 'GET' && fieldPackageMatch) {
        const data = readPreparation();
        if (!data) return reply(404, { error: 'Field preparation not found' });
        return reply(200, candidatePackage(data, fieldPackageMatch[2]));
      }
      if (req.method === 'GET' && tabletSyncLatestMatch) {
        const currentPreparation = readPreparation();
        if (!currentPreparation) return reply(404, { error: 'Field preparation not found' });
        const latestSync = readLatestTabletSync();
        if (!latestSync) return reply(200, { ok: true, fieldPreparation: currentPreparation, syncId: null, message: 'No tablet sync package found' });
        const fieldPreparation = mergeTabletSyncIntoPreparation(currentPreparation, latestSync);
        writeJson(prepFile, fieldPreparation);
        return reply(200, { ok: true, syncId: latestSync.syncId || null, fieldPreparationUpdated: true, fieldPreparation });
      }
      if (req.method === 'POST' && tabletSyncMatch) {
        const body = await readBody(req);
        if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid tablet sync payload' });
        const syncId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeExamId}-${crypto.randomBytes(4).toString('hex')}`;
        const stored = { ...body, examId: body.examId || examId, syncId, receivedAt: new Date().toISOString() };
        writeJson(path.join(fieldTabletSyncDir, `${syncId}.json`), stored);
        const currentPreparation = readPreparation();
        let fieldPreparation = currentPreparation;
        if (currentPreparation) {
          fieldPreparation = mergeTabletSyncIntoPreparation(currentPreparation, stored);
          writeJson(prepFile, fieldPreparation);
        }
        return reply(200, { ok: true, syncId, receivedAt: stored.receivedAt, fieldPreparationUpdated: Boolean(currentPreparation), fieldPreparation });
      }
      return reply(405, { error: 'Method not allowed' });
    }
  }
  return reply(404, { error: `Unknown portable API endpoint: ${pathname}` });
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.webp': 'image/webp', '.wasm': 'application/wasm' };
function latestAsset(pattern) {
  try {
    const assetDir = path.join(distDir, 'assets');
    const files = fs.readdirSync(assetDir).filter((name) => pattern.test(name)).sort((a, b) => fs.statSync(path.join(assetDir, b)).mtimeMs - fs.statSync(path.join(assetDir, a)).mtimeMs);
    return files[0] ? `/assets/${files[0]}` : '';
  } catch { return ''; }
}
function repairIndexAssetReferences(html) {
  // Some portable builds were assembled from copied dist folders where index.html pointed to an older hashed Vite asset.
  // If that happens, Safari/Chrome receive a blank page because the module script is missing. Repair at serve time.
  html = html.replace(/src="(\/assets\/index-[^"]+\.js)"/g, (m, src) => {
    return fs.existsSync(path.join(distDir, src.replace(/^\//, ''))) ? m : `src="${latestAsset(/^index-.*\.js$/) || src}"`;
  });
  html = html.replace(/href="(\/assets\/index-[^"]+\.css)"/g, (m, href) => {
    return fs.existsSync(path.join(distDir, href.replace(/^\//, ''))) ? m : `href="${latestAsset(/^index-.*\.css$/) || href}"`;
  });
  return html;
}
function portableSafetyScript() {
  return `<script>
  (function(){
    window.__VETBARA_PORTABLE_NO_SW__ = true;
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(function(reg){ reg.unregister(); }); }); } catch(e) {}
      try { navigator.serviceWorker.register = function(){ console.warn('VetBara portable: service worker registration disabled.'); return Promise.resolve({ unregister:function(){return Promise.resolve(true);} }); }; } catch(e) {}
    }
    if (window.caches && caches.keys) { try { caches.keys().then(function(keys){ keys.forEach(function(k){ if (String(k).toLowerCase().indexOf('vetbara') >= 0) caches.delete(k); }); }); } catch(e) {} }
  })();
  </script>`;
}
// Attaches the operator token (when this page load legitimately received one) to every
// same-origin /api/ call the app makes, without needing changes inside the app bundle itself.
function operatorFetchScript() {
  return `<script>
  (function(){
    var cfg = window.__VETBARA_PORTABLE__;
    var token = cfg && cfg.operatorToken;
    if (!token || !window.fetch) return;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var path = new URL(url, location.origin).pathname;
        if (path.indexOf('/api/') === 0) {
          init = init ? Object.assign({}, init) : {};
          init.headers = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || {});
          init.headers.set('X-VetBara-Operator-Token', token);
          return originalFetch(input, init);
        }
      } catch (e) {}
      return originalFetch(input, init);
    };
  })();
  </script>`;
}
function centreSetupHtml() {
  // This page is the Centre operator's own bootstrap step (served only on this instance,
  // only while no Centre link is configured yet), so it is fine to hand it the operator
  // token directly for its one job: saving the Admin-issued Centre link.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VetBara Centre setup</title>
<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}.wrap{max-width:860px;margin:64px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)}h1{margin:0 0 8px;font-size:32px}p{color:#475569;font-size:16px;line-height:1.5}textarea{width:100%;min-height:120px;border:1px solid #cbd5e1;border-radius:16px;padding:14px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box}button{margin-top:14px;border:0;border-radius:16px;background:#020617;color:white;font-weight:800;padding:12px 18px;font-size:16px;cursor:pointer}.err{margin-top:14px;color:#be123c;font-weight:700}.hint{background:#f1f5f9;border-radius:16px;padding:12px 14px;margin:16px 0;color:#334155}</style></head>
<body><main class="wrap"><h1>VetBara Centre access link required</h1><p>This Centre installation runs only after receiving the Centre access link generated by Admin.</p><div class="hint">Paste the full Admin Centre link here. It must contain <b>role=Centre</b> and <b>token=...</b>. The runner will automatically replace the host with this computer's current LAN address.</div><textarea id="link" placeholder="http://.../?role=Centre&id=...&token=..."></textarea><br><button id="go">Save link and open Centre</button><div id="err" class="err"></div></main><script>var OPERATOR_TOKEN=${JSON.stringify(operatorToken)};document.getElementById('go').onclick=async()=>{const err=document.getElementById('err');err.textContent='';try{const r=await fetch('/api/centre-link',{method:'POST',headers:{'Content-Type':'application/json','X-VetBara-Operator-Token':OPERATOR_TOKEN},body:JSON.stringify({link:document.getElementById('link').value})});const data=await r.json();if(!r.ok||!data.ok){err.textContent=data.error||'Invalid Centre link';return;}location.href=(data.localCentreLink||data.centreLink)+'&fresh='+Date.now();}catch(e){err.textContent=e.message||String(e);}};</script></body></html>`;
}

function resetHtml() { return `<!doctype html><meta charset="utf-8"><title>VetBara reset</title><body style="font-family:system-ui;padding:32px"><h1>VetBara cache reset</h1><p>Resetting service workers and caches...</p><pre id="out"></pre><script>(async()=>{const out=document.getElementById('out');function log(s){out.textContent+=s+'\n'}; if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); log('service workers: '+regs.length); for(const r of regs){await r.unregister(); log('unregistered '+(r.scope||''));}} if(window.caches){const keys=await caches.keys(); log('caches: '+keys.length); for(const k of keys){await caches.delete(k); log('deleted '+k);}} log('done - opening VetBara'); setTimeout(()=>location.href='/?role=${mode === 'admin' ? 'Admin&token=' + operatorToken : 'Centre'}&reset=1',800);})();</script></body>`; }
function injectedIndexHtml(role) {
  const file = path.join(distDir, 'index.html');
  let html = repairIndexAssetReferences(fs.readFileSync(file, 'utf8'));
  // Only the browser that legitimately opened this instance's own operator workspace
  // (Admin, on a --mode=admin instance; Centre, on a --mode=centre instance) gets the
  // operator token. Candidate/Examiner/FieldTablet/other loads never receive it.
  const isOperatorPageLoad = (mode === 'admin' && (!role || role === 'Admin')) || (mode === 'centre' && role === 'Centre');
  // adminToken is kept only for the bundle's own redirect-to-Admin logic (fired when mode==='admin'
  // and no role/appMode is present yet, which is covered by isOperatorPageLoad). Gating it the same
  // way as operatorToken stops the real secret from leaking into a Candidate/Examiner page's source
  // when they are served from the same Admin-mode instance.
  const payload = { mode, baseUrl, lanBaseUrl: baseUrl, localBaseUrl, centreLink, startedAt: new Date().toISOString(), adminToken: isOperatorPageLoad && mode === 'admin' ? operatorToken : '', operatorToken: isOperatorPageLoad ? operatorToken : '' };
  const script = `${portableSafetyScript()}<script>window.__VETBARA_PORTABLE__=${JSON.stringify(payload)};(function(){var cfg=window.__VETBARA_PORTABLE__; if(!cfg)return; var url=new URL(location.href); var role=url.searchParams.get('role'); var appMode=url.searchParams.get('mode'); var isOtherAllowedRole = role==='Candidate'||role==='Examiner'||role==='FieldTablet'; var isFieldTablet = appMode==='field-tablet'||role==='FieldTablet'; if(cfg.mode==='admin'&&!role&&!appMode){url.search='?role=Admin&token=' + encodeURIComponent(cfg.adminToken || '') + '&portable=' + encodeURIComponent(cfg.startedAt); location.replace(url.toString()); return;} if(cfg.mode==='centre'&&cfg.centreLink&&role!=='Centre'&&!isFieldTablet&&!isOtherAllowedRole){location.replace(cfg.centreLink);}})();</script>${operatorFetchScript()}`;
  return html.replace('</head>', `${script}</head>`);
}
function serveStatic(req, res, parsedUrl) {
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const role = parsedUrl.searchParams.get('role');
  if (mode === 'centre' && centreLinkMissing && (pathname === '/' || pathname === '/index.html')) { res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }); res.end(centreSetupHtml()); return; }
  if (pathname === '/__reset.html') { res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }); res.end(resetHtml()); return; }
  if (pathname === '/vetbara-field-sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`); return; }
  let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(distDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(distDir, 'index.html');
  if (path.basename(filePath) === 'index.html') { const body = injectedIndexHtml(role); res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(body); return; }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  fs.createReadStream(filePath).pipe(res);
}
function openBrowser(url) { if (hasArg('no-open')) return; const q = JSON.stringify(url); if (process.platform === 'darwin') exec(`open ${q}`); else if (process.platform === 'win32') exec(`start "" ${q}`, { shell: true }); else exec(`xdg-open ${q}`); }
const requestHandler = async (req, res) => { try { const parsed = new URL(req.url, baseUrl); if (parsed.pathname.startsWith('/api/')) return api(req, res, parsed.pathname); return serveStatic(req, res, parsed); } catch (err) { console.error(err); return sendJson(req, res, 500, { error: err.message || 'Portable server error' }); } };
let server;
if (protocol === 'https') {
  server = https.createServer({ key: fs.readFileSync(httpsCerts.keyFile), cert: fs.readFileSync(httpsCerts.certFile) }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}
server.listen(port, '0.0.0.0', () => {
  const adminQuery = `?role=Admin&token=${encodeURIComponent(operatorToken)}`;
  const lanLaunchUrl = mode === 'centre' ? (centreLink || `${baseUrl}/`) : `${baseUrl}/${adminQuery}`;
  let localLaunchUrl = `${localBaseUrl}/${adminQuery}`;
  if (mode === 'centre' && centreLink) {
    try {
      const u = new URL(centreLink);
      const local = new URL(localBaseUrl + '/');
      local.search = u.search;
      localLaunchUrl = local.toString();
    } catch {
      localLaunchUrl = centreLink;
    }
  }
  console.log('\nVetBara Portable LAN Runner');
  console.log(`Mode: ${mode}`);
  console.log(`Protocol: ${protocol.toUpperCase()}${httpsCerts ? ` (${httpsCerts.source})` : ''}`);
  console.log(`Open on this computer: ${localLaunchUrl}`);
  console.log(`Use from other LAN devices: ${lanLaunchUrl}`);
  if (mode === 'centre' && !centreLink) console.log('Centre link is missing: paste the Admin Centre link in the browser setup page.');
  console.log(`Health on this computer: ${localBaseUrl}/api/health`);
  console.log(`If the page is blank, open reset: ${localBaseUrl}/__reset.html`);
  console.log(`Asset check: ${localBaseUrl}/api/assets-list`);
  console.log(`Health from LAN: ${baseUrl}/api/health`);
  if (protocol === 'https') console.log('GPS should be available after the tablet trusts the mkcert/root CA certificate.');
  else console.log('GPS on tablets usually requires HTTPS. Add certs to app/certs to enable HTTPS.');
  console.log(`Data directory: ${dataDir}`);
  console.log('\nKeep this window open while VetBara is running. Press Ctrl+C to stop.');
  console.log('If the LAN URL does not open on this Mac, try the local URL above first and allow Node/VetBara through the macOS firewall for other devices.\n');
  openBrowser(localLaunchUrl);
});
