import crypto from "node:crypto";

const DEMO_TOKENS = {
  "VETBARA-CENTRE-ARBOR-2026": { role: "Centre", subjectId: "CENTRE-ARBOR" },
  "VETBARA-CANDIDATE-C-001-2026": { role: "Candidate", subjectId: "C-001" },
  "VETBARA-EXAMINER-E-001-2026": { role: "Examiner", subjectId: "E-001" },
};

const SESSION_TTL_SECONDS = 60 * 60 * 8;

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  const secret = process.env.VETBARA_SESSION_SECRET || process.env.VETBARA_SEED_SECRET || "vetbara-demo-session-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createDemoSessionToken(access, expiresAt) {
  const payload = base64urlJson({ role: access.role, subjectId: access.subjectId, expiresAt });
  return `demo.${payload}.${sign(payload)}`;
}

function parseToken(input) {
  try {
    const url = new URL(input);
    return url.searchParams.get("token") || input;
  } catch {
    return input;
  }
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
  return response.json();
}

async function createSession(access) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  if (!envReady()) return { sessionToken: createDemoSessionToken(access, expiresAt), expiresAt };

  const sessionToken = crypto.randomBytes(32).toString("base64url");
  await supabase("app_sessions", {
    method: "POST",
    body: JSON.stringify({
      token_hash: hash(sessionToken),
      role: access.role,
      subject_id: access.subjectId,
      qr_token_id: access.qrTokenId ?? null,
      expires_at: expiresAt,
    }),
  });

  return { sessionToken, expiresAt };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const token = parseToken(String(request.body?.token || "").trim());
    if (!token) return sendJson(response, 400, { error: "Missing QR token" });

    let access = null;

    if (envReady()) {
      const rows = await supabase(`qr_tokens?token_hash=eq.${hash(token)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
      const row = rows[0];
      if (row && (!row.expires_at || new Date(row.expires_at) > new Date())) {
        access = { role: row.role, subjectId: row.subject_id, qrTokenId: row.id };
      }
    }

    // Demo tokens are a local/offline convenience only: once Supabase is configured (envReady),
    // a lookup miss means the token is genuinely invalid/revoked and must not fall back to the
    // well-known demo constants (they are public in this repo). Every other resolveSession() in
    // this codebase already gates its demo path behind !envReady(); this one didn't, which let
    // the hardcoded demo tokens authenticate as Centre/Candidate/Examiner on a live deployment.
    if (!access && !envReady() && process.env.VETBARA_DEMO_MODE !== "false") access = DEMO_TOKENS[token] ?? null;
    if (!access) return sendJson(response, 401, { error: "Invalid or expired QR token" });

    const session = await createSession(access);
    return sendJson(response, 200, { role: access.role, subjectId: access.subjectId, ...session });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "QR resolve failed" });
  }
}
