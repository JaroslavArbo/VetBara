import crypto from "node:crypto";

// "Opakované generování" button in section D: Candidate/Examiner QR tokens are DERIVED
// deterministically from role+subjectId+examEventId (see ensureQrAccess in api/centre/setup.js),
// so the printed/shared QR code itself never needs to change - what actually needs resetting when
// someone forgets their PIN is the PIN and the list of devices trusted against it. Clearing both
// puts the token back to "first device wins, gets prompted to set a new PIN", which is exactly the
// recovery a forgotten PIN needs, without having to reprint or resend a new link.

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encode(value) {
  return encodeURIComponent(value);
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

async function resolveCentreSession(sessionToken) {
  if (!sessionToken) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || session.role !== "Centre" || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { ok: true, reset: false, reason: "supabase-not-configured" });

  try {
    const { sessionToken, role, subjectId } = request.body ?? {};
    if (role !== "Candidate" && role !== "Examiner") return sendJson(response, 400, { error: "role must be Candidate or Examiner" });
    if (!subjectId) return sendJson(response, 400, { error: "Missing subjectId" });

    const centre = await resolveCentreSession(sessionToken);
    if (!centre) return sendJson(response, 401, { error: "Centre session required" });

    const tokenRows = await supabase(`qr_tokens?role=eq.${encode(role)}&subject_id=eq.${encode(subjectId)}&revoked_at=is.null&select=id&order=created_at.desc&limit=1`);
    const qrTokenId = tokenRows[0]?.id;
    if (!qrTokenId) return sendJson(response, 200, { ok: true, reset: false, reason: "no-active-token" });

    await supabase(`qr_tokens?id=eq.${encode(qrTokenId)}`, { method: "PATCH", body: JSON.stringify({ pin_hash: null }) });
    await supabase(`qr_token_devices?qr_token_id=eq.${encode(qrTokenId)}`, { method: "DELETE" }).catch(() => {});

    return sendJson(response, 200, { ok: true, reset: true });
  } catch (error) {
    console.error("QR PIN reset failed", error);
    return sendJson(response, 500, { error: error.message || "QR PIN reset failed" });
  }
}
