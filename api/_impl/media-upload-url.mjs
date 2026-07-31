import crypto from "node:crypto";

// Issues a short-lived signed upload URL so the browser can PUT the media bytes
// directly into the private Supabase Storage bucket. The service role key never
// leaves the server. A metadata row is registered up front; the client uploads
// the bytes straight to Storage afterwards.

const BUCKET = "exam-media";

const ASSIGNMENTS = {
  "C-001": { primary: "E-001", secondary: "E-002" },
  "C-002": { primary: "E-002", secondary: "E-003" },
  "C-003": { primary: "E-003", secondary: "E-001" },
  "C-004": { primary: "E-001", secondary: "E-003" },
};

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
  return { id: null, role: session.role, subject_id: session.subjectId };
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
  return response.status === 204 ? null : response.json();
}

async function resolveSession(sessionToken) {
  if (!sessionToken) return null;
  if (!envReady()) {
    if (process.env.VETBARA_DEMO_MODE === "false") return null;
    return readDemoSessionToken(sessionToken);
  }
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

// Real rosters live in examiner_assignments (fetched once per request, see handler below). When
// that lookup succeeded it is the ONLY authority — the hardcoded ASSIGNMENTS above only pairs the
// 4 standard demo ids (C-001..004/E-001..003), so consulting it alongside a real roster of more
// than 4 candidates silently rejected every examiner assigned to candidate 5+ ("Examiner can
// upload only for assigned candidates" even though the Centre's own roster shows them assigned).
// The demo map is reached only when the lookup was unavailable (no backend / query failed).
function scopeError(session, media, dbAssignedCandidateIds) {
  const candidateId = media.candidateId ? String(media.candidateId) : null;

  // Centre/Admin upload field-preparation site photos, which are keyed by exam
  // (and tree), not by a candidate.
  if (session.role === "Centre" || session.role === "Admin") {
    if (media.mediaType !== "photo") return "Centre can upload only photos";
    if (!media.examId && !candidateId) return "Missing exam/candidate id for media";
    return null;
  }

  if (!candidateId) return "Missing candidate id for media";
  if (session.role === "Candidate") {
    if (media.mediaType !== "photo") return "Candidate can upload only photos";
    return candidateId === session.subject_id ? null : "Candidate can upload only their own photos";
  }
  if (session.role === "Examiner") {
    if (media.mediaType !== "audio") return "Examiner can upload only audio recordings";
    const assigned = dbAssignedCandidateIds
      ? dbAssignedCandidateIds.has(candidateId)
      : isAssignedExaminer(session.subject_id, candidateId);
    return assigned ? null : "Examiner can upload only for assigned candidates";
  }
  return "Role cannot upload media";
}

function sanitizeSegment(value, fallback) {
  const cleaned = String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function extensionFor(mimeType, fileName) {
  const fromName = String(fileName ?? "").split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-zA-Z0-9]+$/.test(fromName)) return fromName.toLowerCase();
  const map = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  return map[String(mimeType ?? "").split(";")[0]] || (String(mimeType ?? "").startsWith("audio") ? "webm" : "jpg");
}

function normalizeMedia(raw) {
  const media = raw && typeof raw === "object" ? raw : {};
  return {
    clientMediaId: media.clientMediaId ? String(media.clientMediaId) : null,
    mediaType: media.type === "audio" || media.mediaType === "audio" ? "audio" : "photo",
    candidateId: media.candidateId ? String(media.candidateId) : null,
    examinerId: media.examinerId ? String(media.examinerId) : null,
    examId: media.examId ? String(media.examId) : null,
    sectionKey: media.sectionKey ? String(media.sectionKey) : null,
    tree: media.tree ? String(media.tree) : null,
    fileName: media.fileName ? String(media.fileName) : null,
    mimeType: media.mimeType ? String(media.mimeType) : null,
    sizeBytes: Number.isFinite(media.sizeBytes) ? Math.round(media.sizeBytes) : null,
    durationMs: Number.isFinite(media.durationMs) ? Math.round(media.durationMs) : null,
    caption: media.caption ? String(media.caption) : null,
    description: media.description ? String(media.description) : null,
    cleaned: Boolean(media.cleaned),
  };
}

async function createSignedUploadUrl(path) {
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(await response.text());
  const body = await response.json();
  // body.url is like "/object/upload/sign/exam-media/<path>?token=..."
  // Hand the client a LAN-reachable host (SUPABASE_PUBLIC_URL) when set; the
  // signed token is validated by path, not host, so swapping the host is safe.
  const publicBase = process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL;
  return `${publicBase}/storage/v1${body.url}`;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, media: rawMedia } = request.body ?? {};
    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });

    const media = normalizeMedia(rawMedia);
    if (!media.clientMediaId) return sendJson(response, 400, { error: "Missing clientMediaId" });

    let dbAssignedCandidateIds = null;
    if (session.role === "Examiner" && envReady()) {
      try {
        const rows = await supabase(`examiner_assignments?examiner_id=eq.${encodeURIComponent(session.subject_id)}&select=candidate_id`);
        dbAssignedCandidateIds = new Set(rows.map((row) => row.candidate_id));
      } catch { dbAssignedCandidateIds = null; }
    }

    const scope = scopeError(session, media, dbAssignedCandidateIds);
    if (scope) return sendJson(response, 403, { error: scope });

    // Demo / no backend configured: client keeps the local IndexedDB copy only.
    if (!envReady() || !session.id) {
      return sendJson(response, 200, { ok: true, stored: false, demo: true });
    }

    const ext = extensionFor(media.mimeType, media.fileName);
    const folder = media.mediaType === "audio" ? "audio" : media.sectionKey === "field" || media.sectionKey === "field-prep" ? "field-photos" : "photos";
    const path = [
      folder,
      sanitizeSegment(media.candidateId || media.examId, "site"),
      `${sanitizeSegment(media.clientMediaId, "media")}.${ext}`,
    ].join("/");

    const uploadUrl = await createSignedUploadUrl(path);

    const rows = await supabase("exam_media?on_conflict=session_id,client_media_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        client_media_id: media.clientMediaId,
        session_id: session.id,
        role: session.role,
        media_type: media.mediaType,
        candidate_id: media.candidateId,
        examiner_id: media.examinerId ?? (session.role === "Examiner" ? session.subject_id : null),
        exam_id: media.examId,
        section_key: media.sectionKey,
        tree: media.tree,
        storage_bucket: BUCKET,
        storage_path: path,
        file_name: media.fileName,
        mime_type: media.mimeType,
        size_bytes: media.sizeBytes,
        duration_ms: media.durationMs,
        caption: media.caption,
        description: media.description,
        cleaned: media.cleaned,
        payload: rawMedia && typeof rawMedia === "object" ? rawMedia.payload ?? {} : {},
      }),
    });

    return sendJson(response, 200, { ok: true, stored: true, uploadUrl, path, id: rows?.[0]?.id ?? null });
  } catch (error) {
    console.error("Media upload URL failed", error);
    return sendJson(response, 500, { error: "Could not create media upload URL" });
  }
}
