import crypto from "node:crypto";

// Deletes one exam media object (Centre only) — the storage bytes and the exam_media row.
// Scoped the same way media-list.mjs is: the row must belong to this Centre's own exam
// (exam_id match or candidate in its roster), so a Centre can only ever delete its own media.

const BUCKET = "exam-media";

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
  return { id: session.id, role: session.role, subject_id: session.subject_id };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, id } = request.body ?? {};
    if (!id) return sendJson(response, 400, { error: "Missing media id" });

    if (!envReady()) return sendJson(response, 200, { ok: true, stored: false, demo: true });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (session.role !== "Centre") return sendJson(response, 403, { error: "Only Centre can delete exam media" });

    const rows = await supabase(`exam_media?id=eq.${encodeURIComponent(id)}&select=id,candidate_id,exam_id,storage_bucket,storage_path&limit=1`);
    const row = rows[0];
    if (!row) return sendJson(response, 404, { error: "Media not found" });

    // Same scope check as the list: this Centre's own exam_id, or a candidate in its roster.
    const centreId = String(session.subject_id || "");
    let inScope = row.exam_id === centreId;
    if (!inScope && row.candidate_id) {
      try {
        const eventRows = await supabase(`exam_events?centre_id=eq.${encodeURIComponent(centreId)}&status=eq.current&select=id&order=updated_at.desc&limit=1`);
        const examEventId = eventRows[0]?.id;
        if (examEventId) {
          const candidateRows = await supabase(`candidates?id=eq.${encodeURIComponent(row.candidate_id)}&exam_event_id=eq.${encodeURIComponent(examEventId)}&select=id&limit=1`);
          inScope = candidateRows.length > 0;
        }
      } catch (error) {
        console.warn("Media delete could not resolve the exam roster", error?.message || error);
      }
    }
    if (!inScope) return sendJson(response, 403, { error: "Media is outside this Centre's exam" });

    try {
      const deleteResponse = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${row.storage_bucket || BUCKET}/${row.storage_path}`, {
        method: "DELETE",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      // A storage object already gone must not block removing the metadata row below — e.g. a
      // recording whose upload never finished (only the DB row was registered, per the signed-
      // URL flow) has nothing in storage to delete. Storage's own "not found" is deceptive: it
      // answers with HTTP 400, not 404, and puts the real 404 inside the JSON body.
      if (!deleteResponse.ok) {
        const body = await deleteResponse.text();
        let notFound = deleteResponse.status === 404;
        if (!notFound) {
          try { notFound = JSON.parse(body)?.statusCode === "404"; } catch { /* not JSON */ }
        }
        if (!notFound) throw new Error(body);
      }
    } catch (error) {
      console.error("Media storage delete failed", error);
      return sendJson(response, 500, { error: "Could not delete stored file" });
    }

    await supabase(`exam_media?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });

    return sendJson(response, 200, { ok: true, stored: true });
  } catch (error) {
    console.error("Media delete failed", error);
    return sendJson(response, 500, { error: "Could not delete exam media" });
  }
}
