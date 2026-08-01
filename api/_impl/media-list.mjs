import crypto from "node:crypto";

// Lists exam media (examiner voice recordings + report photos) with short-lived signed download
// URLs. Centre staff get the whole certification's roster; a Candidate session may only list its
// own media (used to rehydrate report photos/handwritten notes on reopen - see
// hydrateReportPhotosFromMedia in App.jsx).

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
  return { id: session.id, role: session.role, subject_id: session.subject_id };
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
    if (session.role !== "Centre" && session.role !== "Candidate") return sendJson(response, 403, { error: "Only Centre or Candidate can list exam media" });

    const columns = "id,client_media_id,media_type,candidate_id,examiner_id,exam_id,section_key,tree,storage_path,file_name,mime_type,size_bytes,duration_ms,caption,cleaned,created_at,payload";
    let rows;

    if (session.role === "Candidate") {
      // A Candidate may only ever see their own media (e.g. to rehydrate report photos on a
      // device/session that never captured them) - never the roster-wide listing Centre gets.
      rows = await supabase(`exam_media?candidate_id=eq.${encodeURIComponent(String(session.subject_id || ""))}&select=${columns}&order=created_at.desc`);
    } else {
      // Scope the library to THIS certification. It used to select every row in the table, so a
      // Centre saw the photos and recordings of every other exam ever run ("old exam's photos keep
      // showing up in the new exam"). A row belongs here when it was captured for one of this exam
      // event's candidates, or tagged with this certification's exam id (field/site photos).
      const centreId = String(session.subject_id || "");
      let rosterCandidateIds = [];
      try {
        const eventRows = await supabase(`exam_events?centre_id=eq.${encodeURIComponent(centreId)}&status=eq.current&select=id&order=updated_at.desc&limit=1`);
        const examEventId = eventRows[0]?.id;
        if (examEventId) {
          const candidateRows = await supabase(`candidates?exam_event_id=eq.${encodeURIComponent(examEventId)}&select=id`);
          rosterCandidateIds = candidateRows.map((row) => row.id).filter(Boolean);
        }
      } catch (error) {
        // Fail closed: without a roster we still scope by exam id rather than listing everything.
        console.warn("Media list could not resolve the exam roster", error?.message || error);
      }
      // PostgREST needs the commas/parentheses of an `or=(...)` group literal, so values are
      // double-quoted (which also makes ids containing separators safe) instead of URL-encoded.
      const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
      const orFilters = [`exam_id.eq.${quote(centreId)}`];
      if (rosterCandidateIds.length) orFilters.push(`candidate_id.in.(${rosterCandidateIds.map(quote).join(",")})`);
      rows = await supabase(`exam_media?or=(${orFilters.join(",")})&select=${columns}&order=created_at.desc`);
    }

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
        // Wall-clock time recording actually started (set at capture, see finalizeVoiceRecording
        // in App.jsx) - lets the Centre line up an outdoor question's own score-save timestamp
        // against roughly where in the recording it was answered. Absent on recordings captured
        // before this field existed.
        recordingStartedAt: row.payload?.recordingStartedAt ?? null,
        downloadUrl: await createSignedDownloadUrl(row.storage_path),
      }))
    );

    return sendJson(response, 200, { ok: true, stored: true, media });
  } catch (error) {
    console.error("Media list failed", error);
    return sendJson(response, 500, { error: "Could not list exam media" });
  }
}
