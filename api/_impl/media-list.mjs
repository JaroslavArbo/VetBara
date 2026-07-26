import crypto from "node:crypto";

// Lists exam media (examiner voice recordings + report photos) for Centre staff,
// with short-lived signed download URLs so recordings can be pulled off the
// private bucket for further processing. Centre role only.

const BUCKET = "exam-media";
const DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? [] : response.json();
}

async function resolveSession(sessionToken) {
  if (!sessionToken || !envReady()) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return { id: session.id, role: session.role, subjectId: session.subject_id };
}

async function createSignedDownloadUrl(path) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: DOWNLOAD_TTL_SECONDS }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const publicBase = process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL;
    return body.signedURL ? `${publicBase}/storage/v1${body.signedURL}` : null;
  } catch (error) {
    console.warn("Signed download URL failed", error);
    return null;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken } = request.body ?? {};

    if (!envReady()) {
      // No backend configured: media lives only in the capturing tablet's
      // local store. Signal this so the client falls back to IndexedDB.
      return sendJson(response, 200, { ok: true, stored: false, demo: true, media: [] });
    }

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (session.role !== "Centre") return sendJson(response, 403, { error: "Only Centre can list exam media" });

    const rows = await supabase("exam_media?select=id,client_media_id,media_type,candidate_id,examiner_id,exam_id,section_key,tree,storage_path,file_name,mime_type,size_bytes,duration_ms,caption,cleaned,created_at&order=created_at.desc");

    const media = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        clientMediaId: row.client_media_id,
        mediaType: row.media_type,
        candidateId: row.candidate_id,
        examinerId: row.examiner_id,
        examId: row.exam_id,
        sectionKey: row.section_key,
        tree: row.tree,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        durationMs: row.duration_ms,
        caption: row.caption,
        cleaned: row.cleaned,
        createdAt: row.created_at,
        downloadUrl: await createSignedDownloadUrl(row.storage_path),
      }))
    );

    return sendJson(response, 200, { ok: true, stored: true, media });
  } catch (error) {
    console.error("Media list failed", error);
    return sendJson(response, 500, { error: "Could not list exam media" });
  }
}
