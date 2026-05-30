import crypto from "node:crypto";

const DEMO_TOKENS = [
  { token: "VETBARA-CENTRE-ARBOR-2026", role: "Centre", subject_id: "CENTRE-ARBOR" },
  { token: "VETBARA-CANDIDATE-C-001-2026", role: "Candidate", subject_id: "C-001" },
  { token: "VETBARA-EXAMINER-E-001-2026", role: "Examiner", subject_id: "E-001" },
];

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  return response.json();
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return sendJson(response, 503, { error: "Supabase is not configured" });

  const seedSecret = request.headers["x-seed-secret"];
  if (!process.env.VETBARA_SEED_SECRET || seedSecret !== process.env.VETBARA_SEED_SECRET) return sendJson(response, 401, { error: "Unauthorized" });

  try {
    const rows = DEMO_TOKENS.map(({ token, ...row }) => ({
      ...row,
      token_hash: hash(token),
      label: `${row.role} demo ${row.subject_id}`,
    }));

    const result = await supabase("qr_tokens?on_conflict=token_hash", {
      method: "POST",
      body: JSON.stringify(rows),
    });

    return sendJson(response, 200, { ok: true, inserted: result.length });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Seed failed" });
  }
}
