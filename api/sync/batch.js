import crypto from "node:crypto";

const SUPPORTED_EVENT_TYPES = new Set([
  "candidate_section.opened",
  "candidate_section.closed",
  "candidate_section.reopened",
  "test_response.saved",
  "test_response.submitted",
  "outdoor_assessment.opened",
  "outdoor_score.saved",
  "outdoor_assessment.submitted",
]);

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
  return { id: null, role: session.role, subject_id: session.subjectId, qr_token_id: null };
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

  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,qr_token_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

function candidateIdFor(event) {
  if (event.candidateId) return String(event.candidateId);
  if (event.payload?.candidateId) return String(event.payload.candidateId);
  if (event.entityId && String(event.entityId).startsWith("C-")) return String(event.entityId).split(":")[0];
  return null;
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

function scopeError(session, candidateId) {
  if (session.role === "Candidate") {
    return candidateId === session.subject_id ? null : "Candidate can sync only their own data";
  }

  if (session.role === "Examiner") {
    return candidateId && isAssignedExaminer(session.subject_id, candidateId) ? null : "Examiner can sync only assigned candidates";
  }

  if (session.role === "Centre") return null;

  return "Role cannot sync this event";
}

function validateEvent(session, event) {
  if (!event || typeof event !== "object") return { error: "Event must be an object" };
  if (!event.clientEventId) return { error: "Missing clientEventId" };
  if (!SUPPORTED_EVENT_TYPES.has(event.type)) return { error: "Unsupported event type" };
  if (!event.entityType || !event.entityId) return { error: "Missing entity reference" };

  const candidateId = candidateIdFor(event);
  const error = scopeError(session, candidateId);
  if (error) return { error, candidateId };

  return { candidateId };
}

async function existingEvent(sessionId, clientEventId) {
  if (!envReady() || !sessionId) return null;
  const rows = await supabase(`sync_events?session_id=eq.${sessionId}&client_event_id=eq.${encodeURIComponent(clientEventId)}&select=id,client_event_id,event_type&limit=1`);
  return rows[0] ?? null;
}


function sectionKeyFor(event) {
  if (event.payload?.sectionKey) return String(event.payload.sectionKey);
  if (event.entityId && String(event.entityId).includes(":")) return String(event.entityId).split(":")[1];
  return null;
}

function examinerIdFor(session, event) {
  if (session.role === "Examiner") return session.subject_id;
  return event.payload?.examinerId ? String(event.payload.examinerId) : null;
}

function itemIdFor(event) {
  if (event.payload?.itemId) return String(event.payload.itemId);
  if (event.entityId && String(event.entityId).includes(":")) return String(event.entityId).split(":")[1];
  return null;
}

function clientTimestamp(event) {
  const value = event.payload?.clientUpdatedAt || event.payload?.updatedAt || event.createdAt;
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

async function upsertNormalizedState(session, event, candidateId) {
  if (!envReady() || !session.id) return false;

  const payload = event.payload ?? {};
  const sectionKey = sectionKeyFor(event);
  const updatedAt = clientTimestamp(event);

  if (event.type === "candidate_section.opened" || event.type === "candidate_section.reopened" || event.type === "candidate_section.closed") {
    if (!candidateId || !sectionKey) return false;
    const closed = event.type === "candidate_section.closed";
    const status = closed ? "closed" : "open";
    await supabase("candidate_sections?on_conflict=candidate_id,section_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        candidate_id: candidateId,
        section_key: sectionKey,
        status,
        opened_at: closed ? payload.openedAt ?? null : payload.openedAt ?? event.createdAt ?? new Date().toISOString(),
        closed_at: closed ? payload.closedAt ?? event.createdAt ?? new Date().toISOString() : null,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }),
    });
    return true;
  }

  if (event.type === "test_response.saved" || event.type === "test_response.submitted") {
    const questionId = payload.questionId || itemIdFor(event) || sectionKey;
    if (!candidateId || !questionId) return false;
    await supabase("test_responses?on_conflict=candidate_id,question_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        candidate_id: candidateId,
        question_id: questionId,
        answer: payload.answer ?? payload,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }),
    });
    return true;
  }

  if (event.type === "outdoor_assessment.opened" || event.type === "outdoor_assessment.submitted") {
    const examinerId = examinerIdFor(session, event);
    const outdoorSection = sectionKey || payload.sectionKey || "outdoor";
    if (!candidateId || !examinerId) return false;
    await supabase("outdoor_assessments?on_conflict=candidate_id,examiner_id,section_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        candidate_id: candidateId,
        examiner_id: examinerId,
        mode: payload.mode || "primary",
        section_key: outdoorSection,
        payload,
        submitted_at: event.type === "outdoor_assessment.submitted" ? payload.submittedAt ?? event.createdAt ?? new Date().toISOString() : null,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }),
    });
    return true;
  }

  if (event.type === "outdoor_score.saved") {
    const examinerId = examinerIdFor(session, event);
    const itemId = itemIdFor(event);
    if (!candidateId || !examinerId || !itemId) return false;
    await supabase("outdoor_scores?on_conflict=candidate_id,examiner_id,item_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        candidate_id: candidateId,
        examiner_id: examinerId,
        item_id: itemId,
        score: payload.score ?? null,
        note: payload.note ?? null,
        payload,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }),
    });
    return true;
  }

  return false;
}

async function storeEvent(session, event, candidateId) {
  const createdAt = event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString();

  if (!envReady() || !session.id) {
    return { id: event.clientEventId, duplicate: false, normalized: false };
  }

  const duplicate = await existingEvent(session.id, event.clientEventId);
  if (duplicate) return { id: duplicate.id, duplicate: true, normalized: false };

  const rows = await supabase("sync_events", {
    method: "POST",
    body: JSON.stringify({
      client_event_id: event.clientEventId,
      session_id: session.id,
      role: session.role,
      subject_id: session.subject_id,
      event_type: event.type,
      entity_type: event.entityType,
      entity_id: event.entityId,
      candidate_id: candidateId,
      payload: event.payload ?? {},
      created_at: createdAt,
    }),
  });

  const normalized = await upsertNormalizedState(session, event, candidateId);
  return { id: rows[0]?.id ?? event.clientEventId, duplicate: false, normalized };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, events } = request.body ?? {};
    if (!Array.isArray(events)) return sendJson(response, 400, { error: "Events must be an array" });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });

    const results = [];
    let accepted = 0;
    let rejected = 0;

    for (const event of events) {
      const validation = validateEvent(session, event);
      if (validation.error) {
        rejected += 1;
        results.push({ clientEventId: event?.clientEventId ?? null, ok: false, error: validation.error });
        continue;
      }

      const stored = await storeEvent(session, event, validation.candidateId ?? null);
      accepted += 1;
      results.push({ clientEventId: event.clientEventId, ok: true, id: stored.id, duplicate: stored.duplicate, normalized: stored.normalized });
    }

    return sendJson(response, 200, { ok: rejected === 0, accepted, rejected, results });
  } catch (error) {
    console.error("Sync batch failed", error);
    return sendJson(response, 500, { error: "Sync batch failed" });
  }
}
