import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Pick a LAN-reachable IPv4 for this host so generated QR/tablet/centre links
// point at the machine's network address, not localhost (which on a tablet
// refers to the tablet itself). Prefer en0 (the usual macOS Wi-Fi/Ethernet).
function detectLanHost() {
  const ifaces = os.networkInterfaces();
  const pick = (name) => (ifaces[name] || []).find((i) => i.family === "IPv4" && !i.internal)?.address;
  if (pick("en0")) return pick("en0");
  for (const name of Object.keys(ifaces)) {
    const addr = pick(name);
    if (addr) return addr;
  }
  return null;
}

// Resolve a request path to an api/ handler file, mirroring production routing:
// exact file first, then an `<area>-router.js` that vercel.json rewrites map
// `/api/<area>/*` onto (path segments passed as ?path=<rest>). Returns
// { file, params } or null.
function resolveApiRoute(apiDir, pathname) {
  const segs = pathname.replace(/^\/api\//, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const exact = path.join(apiDir, `${segs.join("/")}.js`);
  if (fs.existsSync(exact)) return { file: exact, params: {} };
  const index = path.join(apiDir, ...segs, "index.js");
  if (fs.existsSync(index)) return { file: index, params: {} };
  if (segs.length >= 2) {
    const router = path.join(apiDir, `${segs[0]}-router.js`);
    if (fs.existsSync(router)) return { file: router, params: { path: segs.slice(1).join("/") } };
  }
  return null;
}

// Dev-only Vite plugin that runs the Vercel-style serverless functions in `api/`
// as local middleware, so `npm run dev` serves the full backend (session, sync,
// media, centre setup, evaluation, qr) against a local Supabase — not just the
// subset the main vite.config already mocks. Production still uses Vercel.
//
// It also loads `.env.local` / `.env` into process.env so the handlers see
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VETBARA_* like they do on Vercel.

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function vetbaraLocalApiPlugin() {
  const root = process.cwd();
  const apiDir = path.join(root, "api");

  let resolvedPort = 3000;

  return {
    name: "vetbara-local-api",
    apply: "serve",
    configResolved(config) {
      loadEnvFile(path.join(root, ".env.local"));
      loadEnvFile(path.join(root, ".env"));
      resolvedPort = config.server?.port || resolvedPort;
      // Local Supabase is bound on 127.0.0.1; tablets can't reach that. Derive a
      // LAN-facing public base so the signed storage URLs we hand to the tablet
      // use the host's LAN IP (server-side REST keeps using the loopback URL).
      const lanHost = detectLanHost();
      const supaUrl = process.env.SUPABASE_URL;
      if (lanHost && supaUrl && !process.env.SUPABASE_PUBLIC_URL) {
        try {
          const u = new URL(supaUrl);
          if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
            u.hostname = lanHost;
            process.env.SUPABASE_PUBLIC_URL = u.origin;
          }
        } catch { /* ignore malformed SUPABASE_URL */ }
      }
    },
    // Inject a LAN base URL so QR codes and Centre/tablet links resolve from
    // other devices on the same Wi-Fi (portableLanOrigin() reads this global).
    transformIndexHtml() {
      const host = detectLanHost();
      if (!host) return [];
      const baseUrl = `http://${host}:${resolvedPort}`;
      return [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: `window.__VETBARA_PORTABLE__=Object.assign({},window.__VETBARA_PORTABLE__,{baseUrl:${JSON.stringify(baseUrl)}});`,
        },
      ];
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();

        const url = new URL(req.url, "http://localhost");
        // Resolve exact file or a catch-all router; if neither exists this route
        // belongs to vite.config's own mocks, so hand it back with next().
        const match = resolveApiRoute(apiDir, url.pathname);
        if (!match) return next();
        const file = match.file;

        try {
          const mod = await server.ssrLoadModule(file);
          const handler = mod.default;
          if (typeof handler !== "function") return next();

          let body;
          if (req.method !== "GET" && req.method !== "HEAD") {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString("utf8");
            const contentType = req.headers["content-type"] || "";
            body = contentType.includes("application/json") && raw ? JSON.parse(raw) : raw || undefined;
          }

          const request = {
            method: req.method,
            headers: req.headers,
            query: { ...Object.fromEntries(url.searchParams), ...match.params },
            body,
            url: req.url,
          };
          const response = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            setHeader(key, value) { res.setHeader(key, value); return this; },
            getHeader(key) { return res.getHeader(key); },
            json(obj) {
              res.statusCode = this.statusCode;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(obj));
            },
            send(data) {
              res.statusCode = this.statusCode;
              res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
            },
            end(data) { res.statusCode = this.statusCode; res.end(data); },
          };

          await handler(request, response);
          if (!res.writableEnded) res.end();
        } catch (error) {
          console.error(`[local-api] ${req.url} failed:`, error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
          }
          if (!res.writableEnded) res.end(JSON.stringify({ error: "Local API error", detail: String(error?.message || error) }));
        }
      });
    },
  };
}
