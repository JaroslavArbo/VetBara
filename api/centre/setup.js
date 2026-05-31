import crypto from "node:crypto";

const QR_TOKEN_TTL_DAYS = 365;
const TOKEN_ORIGIN_FALLBACK = "https://vetbara.vercel.app";
const KNOWN_SEEDED_TOKENS = {
  "Candidate:C-001": "VETBARA-CANDIDATE-C-001-2026",
  "Examiner:E-001": "VETBARA-EXAMINER-E-001-2026",
};

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
  const result = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers ?? {}),
    },
  });

  if (!result.ok) throw new Error(await result.text());
  if (result.status === 204) return [];
  return result.json();
}

function upsertOptions(rows) {
  return {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  };
}

function encode(value) {
  return encodeURIComponent(value);
}

function invalidSetup(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normaliseRole(role) {
  return String(role || "").toLowerCase();
}

async function resolveSession(sessionToken) {
  if (!sessionToken) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return { id: session.id, role: session.role, subjectId: session.subject_id };
}

function defaultExamEventId(centreId) {
  return `EXAM-${centreId}-CURRENT`;
}

async function loadCurrentExamEvent(centreId) {
  const rows = await supabase(`exam_events?centre_id=eq.${encode(centreId)}&status=eq.current&select=*&limit=1`);
  return rows[0] ?? null;
}

async function ensureCurrentExamEvent(centreId) {
  await supabase("centres?on_conflict=id", upsertOptions([{ id: centreId, name: centreId, updated_at: new Date().toISOString() }]));

  const current = await loadCurrentExamEvent(centreId);
  if (current) return current;

  const [created] = await supabase("exam_events?on_conflict=id", upsertOptions([{
    id: defaultExamEventId(centreId),
    centre_id: centreId,
    name: "Current exam event",
    status: "current",
    updated_at: new Date().toISOString(),
  }]));

  return created;
}

function cleanId(value) {
  return String(value || "").trim();
}

function normaliseCandidate(candidate, centreId, examEventId) {
  const id = cleanId(candidate.id ?? candidate.candidateId);
  if (!id) throw invalidSetup("Candidate id is required");
  return {
    exam_event_id: examEventId,
    centre_id: centreId,
    id,
    name: cleanId(candidate.name) || id,
    level: cleanId(candidate.level) || null,
    payload: candidate,
    updated_at: new Date().toISOString(),
  };
}

function normaliseExaminer(examiner, centreId, examEventId) {
  const id = cleanId(examiner.id ?? examiner.examinerId);
  if (!id) throw invalidSetup("Examiner id is required");
  return {
    exam_event_id: examEventId,
    centre_id: centreId,
    id,
    name: cleanId(examiner.name) || id,
    payload: examiner,
    updated_at: new Date().toISOString(),
  };
}

function flattenAssignments(assignments) {
  return assignments.flatMap((assignment) => {
    const candidateId = cleanId(assignment.candidateId ?? assignment.candidate_id);
    if (!candidateId) return [];

    if (assignment.role || assignment.examinerId || assignment.examiner_id) {
      return [{
        candidateId,
        examinerId: cleanId(assignment.examinerId ?? assignment.examiner_id),
        role: normaliseRole(assignment.role),
        payload: assignment,
      }];
    }

    return [
      { candidateId, examinerId: cleanId(assignment.primary), role: "primary", payload: assignment },
      { candidateId, examinerId: cleanId(assignment.secondary), role: "secondary", payload: assignment },
    ].filter((row) => row.examinerId);
  });
}

function validateAssignments(assignments, candidateIds, examinerIds) {
  const flattened = flattenAssignments(assignments);
  const byCandidateRole = new Map();
  const primaryByCandidate = new Map();

  for (const assignment of flattened) {
    if (!assignment.examinerId) throw invalidSetup("Assignment examiner id is required");
    if (!candidateIds.has(assignment.candidateId)) throw invalidSetup("Assignment candidate does not exist");
    if (!examinerIds.has(assignment.examinerId)) throw invalidSetup("Assignment examiner does not exist");
    if (!["primary", "secondary"].includes(assignment.role)) throw invalidSetup("Assignment role is invalid");

    const key = `${assignment.candidateId}:${assignment.role}`;
    if (byCandidateRole.has(key)) throw invalidSetup(`Candidate ${assignment.candidateId} has more than one ${assignment.role} examiner`);
    byCandidateRole.set(key, assignment);
    if (assignment.role === "primary") primaryByCandidate.set(assignment.candidateId, assignment);
  }

  for (const candidateId of candidateIds) {
    if (!primaryByCandidate.has(candidateId)) throw invalidSetup(`Candidate ${candidateId} must have one primary examiner`);
  }

  return flattened;
}

function toAssignmentRow(assignment, centreId, examEventId) {
  return {
    exam_event_id: examEventId,
    centre_id: centreId,
    candidate_id: assignment.candidateId,
    examiner_id: assignment.examinerId,
    role: assignment.role,
    payload: assignment.payload,
    updated_at: new Date().toISOString(),
  };
}

function tokenSecret() {
  return process.env.VETBARA_QR_SECRET || process.env.VETBARA_SESSION_SECRET || process.env.VETBARA_SEED_SECRET || "vetbara-demo-qr-secret";
}

function deterministicQrToken(role, subjectId, examEventId) {
  const signature = crypto
    .createHmac("sha256", tokenSecret())
    .update(`${role}:${subjectId}:${examEventId}`)
    .digest("base64url")
    .slice(0, 18);
  return `VETBARA-${role.toUpperCase()}-${subjectId}-${signature}`;
}

function appOrigin(request) {
  const configured = process.env.VETBARA_PUBLIC_APP_URL || process.env.VITE_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, "");

  const host = request.headers["x-forwarded-host"] || request.headers.host;
  if (host) {
    const proto = request.headers["x-forwarded-proto"] || "https";
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return TOKEN_ORIGIN_FALLBACK;
}

function qrUrl(request, role, subjectId, token) {
  const url = new URL(appOrigin(request));
  url.searchParams.set("role", role);
  url.searchParams.set("id", subjectId);
  url.searchParams.set("token", token);
  return url.toString();
}

function activeQrToken(rows) {
  const now = Date.now();
  return rows.find((row) => !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > now)) ?? null;
}

function knownSeededToken(role, subjectId, tokenHash) {
  const token = KNOWN_SEEDED_TOKENS[`${role}:${subjectId}`];
  return token && hash(token) === tokenHash ? token : null;
}

async function ensureQrAccess(request, role, subjectId, examEventId) {
  const deterministicToken = deterministicQrToken(role, subjectId, examEventId);
  const deterministicHash = hash(deterministicToken);
  const expiresAt = new Date(Date.now() + QR_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const existingRows = await supabase(`qr_tokens?role=eq.${role}&subject_id=eq.${encode(subjectId)}&revoked_at=is.null&select=id,token_hash,expires_at,revoked_at,label&order=created_at.desc`);
  const active = activeQrToken(existingRows);
  const knownToken = active ? knownSeededToken(role, subjectId, active.token_hash) : null;

  if (active && (active.token_hash === deterministicHash || knownToken)) {
    const token = knownToken || deterministicToken;
    return { subjectId, token, url: qrUrl(request, role, subjectId, token) };
  }

  await supabase("qr_tokens?on_conflict=token_hash", upsertOptions([{
    token_hash: deterministicHash,
    role,
    subject_id: subjectId,
    label: `${role} ${subjectId} ${examEventId}`,
    expires_at: expiresAt,
    revoked_at: null,
  }]));

  return { subjectId, token: deterministicToken, url: qrUrl(request, role, subjectId, deterministicToken) };
}

async function buildQrAccess(request, candidates, examiners, examEventId) {
  const candidateAccess = await Promise.all(candidates.map((candidate) => ensureQrAccess(request, "Candidate", candidate.id, examEventId)));
  const examinerAccess = await Promise.all(examiners.map((examiner) => ensureQrAccess(request, "Examiner", examiner.id, examEventId)));
  return { candidates: candidateAccess, examiners: examinerAccess };
}

async function loadSetup(request, centreId, examEvent) {
  const examEventId = examEvent?.id ?? defaultExamEventId(centreId);

  if (!examEvent) {
    return {
      ok: true,
      examEventId,
      candidates: [],
      examiners: [],
      assignments: [],
      qrAccess: { candidates: [], examiners: [] },
    };
  }

  const [candidates, examiners, assignments] = await Promise.all([
    supabase(`candidates?centre_id=eq.${encode(centreId)}&exam_event_id=eq.${encode(examEventId)}&select=id,name,level,payload,updated_at&order=id.asc`),
    supabase(`examiners?centre_id=eq.${encode(centreId)}&exam_event_id=eq.${encode(examEventId)}&select=id,name,payload,updated_at&order=id.asc`),
    supabase(`examiner_assignments?centre_id=eq.${encode(centreId)}&exam_event_id=eq.${encode(examEventId)}&select=candidate_id,examiner_id,role,payload,updated_at&order=candidate_id.asc`),
  ]);

  return {
    ok: true,
    examEventId,
    candidates,
    examiners,
    assignments: assignments.map((assignment) => ({
      candidateId: assignment.candidate_id,
      examinerId: assignment.examiner_id,
      role: assignment.role,
      payload: assignment.payload,
      updatedAt: assignment.updated_at,
    })),
    qrAccess: await buildQrAccess(request, candidates, examiners, examEventId),
  };
}

async function saveSetup(request, centreId, body) {
  const examEvent = await ensureCurrentExamEvent(centreId);
  const examEventId = examEvent.id;
  const candidates = Array.isArray(body.candidates) ? body.candidates.map((candidate) => normaliseCandidate(candidate, centreId, examEventId)) : [];
  const examiners = Array.isArray(body.examiners) ? body.examiners.map((examiner) => normaliseExaminer(examiner, centreId, examEventId)) : [];
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const examinerIds = new Set(examiners.map((examiner) => examiner.id));
  const assignmentRows = validateAssignments(assignments, candidateIds, examinerIds).map((assignment) => toAssignmentRow(assignment, centreId, examEventId));

  const [savedCandidates, savedExaminers] = await Promise.all([
    candidates.length ? supabase("candidates?on_conflict=exam_event_id,id", upsertOptions(candidates)) : [],
    examiners.length ? supabase("examiners?on_conflict=exam_event_id,id", upsertOptions(examiners)) : [],
  ]);
  const savedAssignments = assignmentRows.length ? await supabase("examiner_assignments?on_conflict=exam_event_id,candidate_id,role", upsertOptions(assignmentRows)) : [];

  return {
    ok: true,
    examEventId,
    saved: {
      candidates: savedCandidates.length,
      examiners: savedExaminers.length,
      assignments: savedAssignments.length,
    },
    qrAccess: await buildQrAccess(request, savedCandidates, savedExaminers, examEventId),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Backend persistence is not configured" });

  try {
    const { sessionToken, action } = request.body ?? {};
    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (session.role !== "Centre") return sendJson(response, 403, { error: "Centre setup is not available for this session" });

    const centreId = session.subjectId;

    if (action === "load") {
      const examEvent = await loadCurrentExamEvent(centreId);
      return sendJson(response, 200, await loadSetup(request, centreId, examEvent));
    }

    if (action === "save") {
      return sendJson(response, 200, await saveSetup(request, centreId, request.body ?? {}));
    }

    return sendJson(response, 400, { error: "Unsupported centre setup action" });
  } catch (error) {
    if (error.statusCode) {
      console.warn("Centre setup validation failed", error.message);
      return sendJson(response, error.statusCode, { error: "Invalid centre setup" });
    }

    console.error("Centre setup failed", error);
    return sendJson(response, 500, { error: "Centre setup failed" });
  }
}
