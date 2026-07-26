import crypto from "node:crypto";

// Shared Supabase REST + session helpers for the serverless API functions.
// Files under api/_lib are ignored by Vercel's router (underscore prefix) but
// are bundled when imported by a function.

export function envReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sendJson(response, status, body) {
  response.status(status).json(body);
}

export async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  // Handle empty bodies (204, or Prefer: return=minimal which replies 201 empty).
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

// Resolve any app_sessions token → { role, subjectId } or null.
export async function resolveSession(sessionToken) {
  if (!sessionToken || !envReady()) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${sha256(sessionToken)}&revoked_at=is.null&select=role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return { role: session.role, subjectId: session.subject_id };
}

// Require an Admin session; returns the session or null.
export async function resolveAdminSession(sessionToken) {
  const session = await resolveSession(sessionToken);
  return session && session.role === "Admin" ? session : null;
}
