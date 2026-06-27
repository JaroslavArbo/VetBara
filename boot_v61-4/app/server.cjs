#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

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

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
ensureDir(dataDir); ensureDir(path.join(dataDir, 'sync')); ensureDir(path.join(dataDir, 'packages')); ensureDir(path.join(dataDir, 'results')); ensureDir(path.join(dataDir, 'final')); ensureDir(path.join(dataDir, 'scans')); ensureDir(path.join(dataDir, 'logbook'));
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function sendJson(res, status, payload) { const body = JSON.stringify(payload ?? {}, null, 2); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(body); }
function readBody(req) { return new Promise((resolve) => { const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({ raw: text }); } }); }); }
function localIpv4() { if (fixedHost) return fixedHost; const nets = os.networkInterfaces(); for (const entries of Object.values(nets)) { for (const entry of entries || []) { if (entry && entry.family === 'IPv4' && !entry.internal) return entry.address; } } return '127.0.0.1'; }
const lanIp = localIpv4();
const protocol = useHttps && httpsCerts ? 'https' : 'http';
const publicHost = argValue('public-host', process.env.VETBARA_PUBLIC_HOST || lanIp) || lanIp;
const localHost = argValue('local-host', process.env.VETBARA_LOCAL_HOST || (protocol === 'https' ? 'localhost' : '127.0.0.1'));
const baseUrl = argValue('public-base-url', process.env.VETBARA_PUBLIC_BASE_URL || `${protocol}://${publicHost}:${port}`);
const localBaseUrl = argValue('local-base-url', process.env.VETBARA_LOCAL_BASE_URL || `${protocol}://${localHost}:${port}`);
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
const syncLogPath = path.join(dataDir, 'sync', 'events.json');
const finalDir = path.join(dataDir, 'final');
function activePackage() { return readJson(activePackagePath, readJson(latestPackagePath, { ok: false, variants: [], questions: [] })); }
function tokenAccess(tokenOrUrl) { const raw = String(tokenOrUrl || ''); let u = null; try { u = new URL(raw); } catch {} const params = u ? u.searchParams : new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw); const role = params.get('role') || (raw.includes('CANDIDATE') ? 'Candidate' : raw.includes('EXAMINER') ? 'Examiner' : raw.includes('CENTRE') ? 'Centre' : ''); const subjectId = params.get('id') || params.get('subjectId') || (raw.match(/C-\d{3}/)?.[0]) || (raw.match(/E-\d{3}/)?.[0]) || (role === 'Centre' ? 'CENTRE-ARBOR' : ''); return { role: role || 'Centre', subjectId, token: params.get('token') || raw, name: params.get('name') || '', level: params.get('level') || '', sessionToken: `local-${role || 'Centre'}-${subjectId || 'session'}-${Date.now()}`, mode: 'portable-lan' }; }
function saveSyncEvents(events) { const current = readJson(syncLogPath, []); const appended = current.concat((Array.isArray(events) ? events : []).map((event) => ({ ...event, receivedAt: new Date().toISOString() }))); writeJson(syncLogPath, appended); return appended.length; }

async function api(req, res, pathname) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (pathname === '/api/assets-list') {
    const dir = path.join(distDir, 'assets');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    return sendJson(res, 200, { ok: true, distDir, assetsDir: dir, files });
  }
  if (pathname === '/api/centre-link') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const raw = String(body.link || body.url || body.raw || '').trim();
      const normalized = normalizeCentreLink(raw);
      if (!normalized) return sendJson(res, 400, { ok: false, error: 'Invalid Centre access link. It must contain role=Centre and token=...' });
      writeJson(path.join(dataDir, 'centre-link.json'), { raw, normalized, savedAt: new Date().toISOString() });
      fs.writeFileSync(centreLinkFile, raw, 'utf8');
      centreLink = normalized;
      centreLinkMissing = false;
      const local = new URL(localBaseUrl + '/'); try { local.search = new URL(normalized).search; } catch {} return sendJson(res, 200, { ok: true, centreLink: normalized, localCentreLink: local.toString() });
    }
    return sendJson(res, 200, { ok: true, centreLink, missing: centreLinkMissing });
  }
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'vetbara-portable-lan', mode, time: new Date().toISOString(), protocol, https: protocol === 'https', gpsReady: protocol === 'https', baseUrl, localBaseUrl, lanIp, publicHost, dataDir, certSource: httpsCerts ? httpsCerts.source : null });
  if (pathname === '/api/portable/info') return sendJson(res, 200, { ok: true, mode, protocol, https: protocol === 'https', gpsReady: protocol === 'https', baseUrl, localBaseUrl, centreLink, centreLinkMissing, dataDir, activePackage: activePackage() });
  if (pathname === '/api/qr/resolve' && req.method === 'POST') { const body = await readBody(req); return sendJson(res, 200, tokenAccess(body.token || body.url || body.raw)); }
  if (pathname === '/api/session/bootstrap' && req.method === 'POST') { const body = await readBody(req); return sendJson(res, 200, { ok: true, sessionToken: body.sessionToken, portable: true, baseUrl, testPackage: activePackage(), centreSetup: readJson(centreSetupPath, {}) }); }
  if (pathname === '/api/sync/batch' && req.method === 'POST') { const body = await readBody(req); const count = saveSyncEvents(body.events || []); return sendJson(res, 200, { ok: true, stored: count }); }
  if (pathname === '/api/centre/setup' && req.method === 'POST') { const body = await readBody(req); if (body.action === 'save') { const payload = { ...(readJson(centreSetupPath, {}) || {}), candidates: body.candidates || [], examiners: body.examiners || [], assignments: body.assignments || [], testPackage: body.testPackage || activePackage(), updatedAt: new Date().toISOString() }; writeJson(centreSetupPath, payload); return sendJson(res, 200, { ok: true, ...payload }); } return sendJson(res, 200, { ok: true, ...(readJson(centreSetupPath, {}) || {}) }); }
  if (pathname === '/api/centre/test-package/active') { if (req.method === 'POST' || req.method === 'PUT') { const body = await readBody(req); writeJson(activePackagePath, body?.package || body?.testPackage || body); return sendJson(res, 200, { ok: true, package: activePackage() }); } return sendJson(res, 200, activePackage()); }
  if (pathname === '/api/admin/test-package/latest' || pathname === '/api/admin/test-package/approved') return sendJson(res, 200, activePackage());
  if (pathname === '/api/admin/test-package/list') return sendJson(res, 200, { packages: [{ id: 'portable-active', label: 'Portable active package', updatedAt: new Date().toISOString(), package: activePackage() }] });
  if (pathname === '/api/admin/test-package/authoring/save' && req.method === 'POST') { const body = await readBody(req); writeJson(latestPackagePath, body?.package || body?.testPackage || body); return sendJson(res, 200, { ok: true, id: 'portable-latest' }); }
  if (pathname === '/api/admin/test-package/approve' && req.method === 'POST') { const latest = readJson(latestPackagePath, activePackage()); writeJson(activePackagePath, latest); return sendJson(res, 200, { ok: true, package: latest }); }
  if (pathname === '/api/admin/test-package/convert' && req.method === 'POST') { const body = await readBody(req); return sendJson(res, 200, { ok: true, package: body }); }
  if (pathname.startsWith('/api/admin/authoring-drafts')) { if (pathname.endsWith('/list')) return sendJson(res, 200, { drafts: [] }); if (pathname.endsWith('/latest')) return sendJson(res, 200, { draft: null }); if (pathname.endsWith('/save') && req.method === 'POST') return sendJson(res, 200, { ok: true, id: `draft-${Date.now()}` }); return sendJson(res, 200, { ok: true }); }
  if (pathname === '/api/local-results') { if (req.method === 'POST' || req.method === 'PUT') { const body = await readBody(req); writeJson(localResultsPath, body.results || body); return sendJson(res, 200, { ok: true, results: readJson(localResultsPath, {}) }); } return sendJson(res, 200, { ok: true, results: readJson(localResultsPath, {}) }); }
  if (pathname === '/api/local-exchange/packages') return sendJson(res, 200, { packages: [] });
  if (pathname.startsWith('/api/local-exchange/packages/')) return sendJson(res, 404, { error: 'No local exchange package found in portable runner.' });
  if (pathname === '/api/evaluation/candidate' && req.method === 'POST') return sendJson(res, 200, { sections: [], testResponses: [], outdoor: [], report: {} });
  if (pathname === '/api/evaluation/export' && req.method === 'POST') return sendJson(res, 200, { filename: 'VetBara_Evaluation_Draft.xls', mimeType: 'application/vnd.ms-excel', base64: Buffer.from('VetBara portable evaluation export is stored in the final .vet_fin package.').toString('base64') });
  if (pathname === '/api/centre/audit-export' && req.method === 'POST') return sendJson(res, 200, { filename: 'VetBara_Centre_Audit.json', mimeType: 'application/json', base64: Buffer.from(JSON.stringify({ centreSetup: readJson(centreSetupPath, {}), sync: readJson(syncLogPath, []), activePackage: activePackage() }, null, 2)).toString('base64') });
  if (pathname === '/api/centre/final-package' && req.method === 'POST') { const body = await readBody(req); const name = `VetBara_${(body.examId || 'exam').replace(/[^a-z0-9_-]+/gi,'_')}_${Date.now()}.vet_fin.json`; const payload = { createdAt: new Date().toISOString(), mode: 'portable-lan', body, activePackage: activePackage(), centreSetup: readJson(centreSetupPath, {}), localResults: readJson(localResultsPath, {}), sync: readJson(syncLogPath, []) }; const file = path.join(finalDir, name); writeJson(file, payload); return sendJson(res, 200, { ok: true, filename: name, path: file, base64: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'), mimeType: 'application/json' }); }
  if (pathname.includes('/field-preparation') || pathname.includes('/field-tablet-sync') || pathname.includes('/field-package')) { if (req.method === 'POST' || req.method === 'PUT') { const body = await readBody(req); saveSyncEvents([{ type: pathname, payload: body }]); return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() }); } return sendJson(res, 200, { ok: true, data: null, package: activePackage() }); }
  return sendJson(res, 404, { error: `Unknown portable API endpoint: ${pathname}` });
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
function injectedIndexHtml() { const file = path.join(distDir, 'index.html'); let html = repairIndexAssetReferences(fs.readFileSync(file, 'utf8')); const payload = { mode, baseUrl, lanBaseUrl: baseUrl, localBaseUrl, centreLink, startedAt: new Date().toISOString() }; const script = `${portableSafetyScript()}<script>window.__VETBARA_PORTABLE__=${JSON.stringify(payload)};(function(){var cfg=window.__VETBARA_PORTABLE__; if(!cfg)return; var url=new URL(location.href); var role=url.searchParams.get('role'); var appMode=url.searchParams.get('mode'); var isOtherAllowedRole = role==='Candidate'||role==='Examiner'||role==='FieldTablet'; var isFieldTablet = appMode==='field-tablet'||role==='FieldTablet'; if(cfg.mode==='admin'&&!role&&!appMode){url.search='?role=Admin&portable=' + encodeURIComponent(cfg.startedAt); location.replace(url.toString()); return;} if(cfg.mode==='centre'&&cfg.centreLink&&role!=='Centre'&&!isFieldTablet&&!isOtherAllowedRole){location.replace(cfg.centreLink);}})();</script>`; return html.replace('</head>', `${script}</head>`); }
function centreSetupHtml() { return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VetBara Centre setup</title>
<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}.wrap{max-width:860px;margin:64px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)}h1{margin:0 0 8px;font-size:32px}p{color:#475569;font-size:16px;line-height:1.5}textarea{width:100%;min-height:120px;border:1px solid #cbd5e1;border-radius:16px;padding:14px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box}button{margin-top:14px;border:0;border-radius:16px;background:#020617;color:white;font-weight:800;padding:12px 18px;font-size:16px;cursor:pointer}.err{margin-top:14px;color:#be123c;font-weight:700}.hint{background:#f1f5f9;border-radius:16px;padding:12px 14px;margin:16px 0;color:#334155}</style></head>
<body><main class="wrap"><h1>VetBara Centre access link required</h1><p>This Centre installation runs only after receiving the Centre access link generated by Admin.</p><div class="hint">Paste the full Admin Centre link here. It must contain <b>role=Centre</b> and <b>token=...</b>. The runner will automatically replace the host with this computer's current LAN address.</div><textarea id="link" placeholder="http://.../?role=Centre&id=...&token=..."></textarea><br><button id="go">Save link and open Centre</button><div id="err" class="err"></div></main><script>document.getElementById('go').onclick=async()=>{const err=document.getElementById('err');err.textContent='';try{const r=await fetch('/api/centre-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:document.getElementById('link').value})});const data=await r.json();if(!r.ok||!data.ok){err.textContent=data.error||'Invalid Centre link';return;}location.href=(data.localCentreLink||data.centreLink)+'&fresh='+Date.now();}catch(e){err.textContent=e.message||String(e);}};</script></body></html>`; }

function resetHtml() { return `<!doctype html><meta charset="utf-8"><title>VetBara reset</title><body style="font-family:system-ui;padding:32px"><h1>VetBara cache reset</h1><p>Resetting service workers and caches...</p><pre id="out"></pre><script>(async()=>{const out=document.getElementById('out');function log(s){out.textContent+=s+'\n'}; if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); log('service workers: '+regs.length); for(const r of regs){await r.unregister(); log('unregistered '+(r.scope||''));}} if(window.caches){const keys=await caches.keys(); log('caches: '+keys.length); for(const k of keys){await caches.delete(k); log('deleted '+k);}} log('done - opening VetBara'); setTimeout(()=>location.href='/?role=${mode === 'admin' ? 'Admin' : 'Centre'}&reset=1',800);})();</script></body>`; }
function serveStatic(req, res, pathname) { if (mode === 'centre' && centreLinkMissing && (pathname === '/' || pathname === '/index.html')) { res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }); res.end(centreSetupHtml()); return; } if (pathname === '/__reset.html') { res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }); res.end(resetHtml()); return; } if (pathname === '/vetbara-field-sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`); return; } let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname); if (!filePath.startsWith(distDir)) { res.writeHead(403); res.end('Forbidden'); return; } if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(distDir, 'index.html'); if (path.basename(filePath) === 'index.html') { const body = injectedIndexHtml(); res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(body); return; } const ext = path.extname(filePath).toLowerCase(); res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate' }); fs.createReadStream(filePath).pipe(res); }
function openBrowser(url) { if (hasArg('no-open')) return; const q = JSON.stringify(url); if (process.platform === 'darwin') exec(`open ${q}`); else if (process.platform === 'win32') exec(`start "" ${q}`, { shell: true }); else exec(`xdg-open ${q}`); }
const requestHandler = async (req, res) => { try { const parsed = new URL(req.url, baseUrl); if (parsed.pathname.startsWith('/api/')) return api(req, res, parsed.pathname); return serveStatic(req, res, decodeURIComponent(parsed.pathname)); } catch (err) { console.error(err); return sendJson(res, 500, { error: err.message || 'Portable server error' }); } };
let server;
if (protocol === 'https') {
  server = https.createServer({ key: fs.readFileSync(httpsCerts.keyFile), cert: fs.readFileSync(httpsCerts.certFile) }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}
server.listen(port, '0.0.0.0', () => {
  const lanLaunchUrl = mode === 'centre' ? (centreLink || `${baseUrl}/`) : `${baseUrl}/?role=Admin`;
  let localLaunchUrl = `${localBaseUrl}/?role=Admin`;
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
