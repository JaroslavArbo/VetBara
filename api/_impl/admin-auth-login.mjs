import crypto from "node:crypto";

// Admin login. Verifies username/password against the single admin_credentials
// row (bootstrapped to the default Bara / VetBara2026 on first ever login, which
// the admin then changes) and issues an Admin app_session used to authorize
// sensitive Admin actions.

const DEFAULT_USERNAME = "Bara";
const DEFAULT_PASSWORD = "VetBara2026";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h admin shift

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function envReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? [] : response.json();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function passwordMatches(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function loadOrBootstrapCredentials() {
  const rows = await supabase("admin_credentials?id=eq.1&select=*&limit=1");
  if (rows[0]) return rows[0];
  // First ever login: seed the default account so Bara / VetBara2026 works once.
  const salt = crypto.randomBytes(16).toString("hex");
  const created = await supabase("admin_credentials", {
    method: "POST",
    body: JSON.stringify({ id: 1, username: DEFAULT_USERNAME, salt, password_hash: hashPassword(DEFAULT_PASSWORD, salt) }),
  });
  return created[0];
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Admin auth requires the backend to be configured" });

  const { username, password } = request.body ?? {};
  if (!username || !password) return sendJson(response, 400, { error: "Missing username or password" });

  try {
    const creds = await loadOrBootstrapCredentials();
    const ok = String(username) === creds.username && passwordMatches(password, creds.salt, creds.password_hash);
    if (!ok) return sendJson(response, 401, { error: "Invalid username or password" });

    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    await supabase("app_sessions", {
      method: "POST",
      body: JSON.stringify({ token_hash: sha256(sessionToken), role: "Admin", subject_id: creds.username, expires_at: expiresAt }),
    });

    return sendJson(response, 200, { ok: true, sessionToken, username: creds.username, expiresAt });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Login failed" });
  }
}
