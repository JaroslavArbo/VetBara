import crypto from "node:crypto";

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sign(value) {
  const secret = process.env.VETBARA_SESSION_SECRET || process.env.VETBARA_SEED_SECRET || "vetbara-demo-session-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function readDemoSessionToken(sessionToken) {
  const [prefix, payload, signature] = String(sessionToken).split(".");
  if (prefix !== "demo" || !payload || signature !== sign(payload)) return null;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (new Date(session.expiresAt) <= new Date()) return null;
  return session;
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

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken } = request.body ?? {};
    if (!sessionToken) return sendJson(response, 400, { error: "Missing session token" });

    if (!envReady()) {
      const demo = readDemoSessionToken(sessionToken);
      if (!demo || process.env.VETBARA_DEMO_MODE === "false") return sendJson(response, 401, { error: "Invalid demo session" });
      return sendJson(response, 200, {
        role: demo.role,
        subjectId: demo.subjectId,
        package: { mode: "demo", allowedPortal: demo.role },
      });
    }

    const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
    const session = rows[0];
    if (!session || new Date(session.expires_at) <= new Date()) return sendJson(response, 401, { error: "Invalid or expired session" });

    return sendJson(response, 200, {
      role: session.role,
      subjectId: session.subject_id,
      package: {
        allowedPortal: session.role,
        sessionId: session.id,
      },
    });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Session bootstrap failed" });
  }
}
