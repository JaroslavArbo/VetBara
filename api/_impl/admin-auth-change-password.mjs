import { validateAdminPassword } from "../_lib/adminauth.mjs";
import crypto from "node:crypto";

// Change the admin username and/or password. Requires a valid Admin session and
// the current password. Password is re-hashed with a fresh salt.

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

async function resolveAdminSession(sessionToken) {
  if (!sessionToken) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${sha256(sessionToken)}&revoked_at=is.null&select=role,expires_at&limit=1`);
  const session = rows[0];
  if (!session || session.role !== "Admin" || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Admin auth requires the backend to be configured" });

  const { sessionToken, currentPassword, newUsername, newPassword } = request.body ?? {};
  if (!currentPassword) return sendJson(response, 400, { error: "Missing current password" });
  if (!newUsername && !newPassword) return sendJson(response, 400, { error: "Nothing to change" });
  // §5 - the same strong-password policy the activation flow enforces.
  if (newPassword) {
    const policyError = validateAdminPassword(newPassword, newUsername || username);
    if (policyError) return sendJson(response, 400, { error: policyError });
  }

  try {
    const session = await resolveAdminSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Admin session required" });

    const rows = await supabase("admin_credentials?id=eq.1&select=*&limit=1");
    const creds = rows[0];
    if (!creds) return sendJson(response, 400, { error: "No admin account yet — log in first" });
    if (!passwordMatches(currentPassword, creds.salt, creds.password_hash)) {
      return sendJson(response, 401, { error: "Current password is incorrect" });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (newUsername) patch.username = String(newUsername).trim();
    if (newPassword) {
      const salt = crypto.randomBytes(16).toString("hex");
      patch.salt = salt;
      patch.password_hash = hashPassword(newPassword, salt);
    }
    const updated = await supabase("admin_credentials?id=eq.1", { method: "PATCH", body: JSON.stringify(patch) });
    return sendJson(response, 200, { ok: true, username: updated[0]?.username ?? patch.username ?? creds.username });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Change failed" });
  }
}
