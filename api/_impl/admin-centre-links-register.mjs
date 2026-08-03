import crypto from "node:crypto";

// Registers a generated Centre access token so the strict Supabase-backed
// /api/qr/resolve accepts it. Without this, per-exam Centre links minted by
// Admin (centreAccessLinkFor) never exist in qr_tokens and resolve returns 401
// once Supabase is configured.
//
// When Supabase is NOT configured this is a no-op (registered:false): the
// portable-LAN fallback path in qr/resolve derives access from URL params, so
// links still work in that mode.
//
// Requires a valid Admin session (see api/admin/auth/*) and only mints
// role=Centre tokens (guarded by the CENTRE- token prefix).

// A Centre link must be activated (opened at least once) within this many days of being generated.
export const CENTRE_LINK_ACTIVATION_DAYS = 21;

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function envReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function resolveAdminSession(sessionToken) {
  if (!sessionToken) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=role,expires_at&limit=1`);
  const session = rows[0];
  if (!session || session.role !== "Admin" || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? [] : response.json();
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  const { sessionToken, token, id, place, examDate, centre } = request.body ?? {};
  if (!token || !id) return sendJson(response, 400, { error: "Missing token or id" });
  if (!String(token).startsWith("CENTRE-")) return sendJson(response, 400, { error: "Only Centre tokens can be registered here" });

  if (!envReady()) return sendJson(response, 200, { ok: true, registered: false, reason: "supabase-not-configured" });

  try {
    // Gate token minting behind a valid Admin session.
    const admin = await resolveAdminSession(sessionToken);
    if (!admin) return sendJson(response, 401, { error: "Admin session required" });

    // A freshly minted Centre link is only valid for three weeks UNTIL it is first opened. Opening
    // it clears expires_at (see qr/resolve.js), so a certification that has actually started never
    // expires mid-exam; an invitation that was never used simply stops working.
    const activationDeadline = new Date(Date.now() + CENTRE_LINK_ACTIVATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await supabase("qr_tokens?on_conflict=token_hash", {
      method: "POST",
      body: JSON.stringify([
        {
          token_hash: hash(String(token)),
          role: "Centre",
          subject_id: String(id),
          label: `Centre ${centre || place || id}${examDate ? ` ${examDate}` : ""}`,
          expires_at: activationDeadline,
        },
      ]),
    });
    return sendJson(response, 200, { ok: true, registered: true });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Centre token registration failed" });
  }
}
