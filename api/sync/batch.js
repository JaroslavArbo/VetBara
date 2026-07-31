import crypto from "node:crypto";

// Session-integrity signals: a logged-in Candidate or Examiner leaving fullscreen or switching
// away from the app. They are the Centre's invigilation feed (the Centre runs on its own device
// and cannot observe a tablet any other way), so they must cross the wire like any other event.
// They describe the signed-in subject, not a candidate's answers, so they have no projection
// table — they live in sync_events and are read back by the evaluation read model.
const SESSION_EVENT_TYPES = new Set([
  "session.fullscreen_entered",
  "session.fullscreen_exited",
  "session.app_backgrounded",
  "session.app_foregrounded",
]);

const SUPPORTED_EVENT_TYPES = new Set([
  "candidate_section.opened",
  "candidate_section.closed",
  "candidate_section.reopened",
  "test_response.saved",
  "test_response.submitted",
  "report_draft.saved",
  "report_photo.added",
  "candidate_preparation.saved",
  "outdoor_assessment.opened",
  "outdoor_assessment.submitted",
  "outdoor_score.saved",
  "examiner_score.saved",
  ...SESSION_EVENT_TYPES,
]);

const EVENT_TYPES_BY_ROLE = {
  Candidate: new Set([
    "candidate_section.opened",
    "candidate_section.closed",
    "candidate_section.reopened",
    "test_response.saved",
    "test_response.submitted",
    "report_draft.saved",
    "report_photo.added",
    "candidate_preparation.saved",
    ...SESSION_EVENT_TYPES,
  ]),
  Examiner: new Set([
    "outdoor_assessment.opened",
    "outdoor_assessment.submitted",
    "outdoor_score.saved",
    "examiner_score.saved",
    ...SESSION_EVENT_TYPES,
  ]),
  // The Centre is the exam authority and already reads every candidate in its event; section E lets
  // an identified examiner correct outdoor scores/notes and written/report marks from the Centre
  // (a closed test or report has no other route back to the examiner's own device), so those
  // corrections have to persist. Deliberately narrow: corrections only, no section-open/close
  // events, and every one is written to the exam audit log on the client.
  Centre: new Set([
    "outdoor_score.saved",
    "examiner_score.saved",
  ]),
};

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

function candidateIdReferences(event) {
  const references = [];

  if (event.candidateId) references.push({ source: "candidateId", value: String(event.candidateId) });
  if (event.payload?.candidateId) references.push({ source: "payload.candidateId", value: String(event.payload.candidateId) });
  if (event.entityId && String(event.entityId).startsWith("C-")) {
    references.push({ source: "entityId", value: String(event.entityId).split(":")[0] });
  }

  return references;
}

function candidateIdFor(event) {
  const references = candidateIdReferences(event);
  return references[0]?.value ?? null;
}

function candidateIdConflict(event) {
  const references = candidateIdReferences(event);
  const uniqueValues = new Set(references.map((reference) => reference.value));
  if (uniqueValues.size <= 1) return null;
  return references.map((reference) => `${reference.source}=${reference.value}`).join(", ");
}

function roleEventError(session, eventType) {
  const allowedTypes = EVENT_TYPES_BY_ROLE[session.role];
  if (!allowedTypes) return "Role cannot sync candidate or examiner events";
  return allowedTypes.has(eventType) ? null : `${session.role} cannot sync ${eventType}`;
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

function scopeError(session, candidateId, dbAssignedCandidateIds, eventType) {
  // A session-integrity event is scoped by the session itself: it reports on the signed-in
  // subject's own device. A Candidate's carries their id (and is checked below like any other
  // event); an Examiner's has no candidate at all, so requiring one would 403 every one of them.
  if (!candidateId) {
    if (SESSION_EVENT_TYPES.has(eventType) && (session.role === "Candidate" || session.role === "Examiner")) return null;
    return "Missing candidate id for scoped sync event";
  }

  if (session.role === "Candidate") {
    return candidateId === session.subject_id ? null : "Candidate can sync only their own data";
  }

  // The Centre operates on its whole exam event; candidate scoping is enforced by the session's
  // exam event id on the projection write, not by an assignment table.
  if (session.role === "Centre") return null;

  if (session.role === "Examiner") {
    // Real rosters live in examiner_assignments (fetched once per request). When that lookup
    // succeeded it is the ONLY authority: the hardcoded demo ASSIGNMENTS pair the standard ids
    // (C-001/E-001…) that every real exam also uses, so consulting them alongside the DB silently
    // authorised examiners the real roster had not assigned. The demo map is now reached only when
    // the lookup was unavailable (no backend configured / query failed), i.e. genuine demo mode.
    if (dbAssignedCandidateIds) {
      return dbAssignedCandidateIds.has(candidateId) ? null : "Examiner can sync only assigned candidates";
    }
    return isAssignedExaminer(session.subject_id, candidateId) ? null : "Examiner can sync only assigned candidates";
  }

  return "Role cannot sync this event";
}

function validateEvent(session, event, dbAssignedCandidateIds) {
  if (!event || typeof event !== "object") return { status: 400, error: "Event must be an object" };
  if (!event.clientEventId) return { status: 400, error: "Missing clientEventId" };
  if (!SUPPORTED_EVENT_TYPES.has(event.type)) return { status: 400, error: "Unsupported event type" };
  if (!event.entityType || !event.entityId) return { status: 400, error: "Missing entity reference" };

  const roleError = roleEventError(session, event.type);
  if (roleError) return { status: 403, error: roleError };

  const conflict = candidateIdConflict(event);
  if (conflict) return { status: 400, error: "Conflicting candidate id references", details: conflict };

  const candidateId = candidateIdFor(event);
  const error = scopeError(session, candidateId, dbAssignedCandidateIds, event.type);
  if (error) return { status: 403, error, candidateId };

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

function objectPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clientTimestamp(event) {
  const value = event.payload?.clientUpdatedAt || event.payload?.updatedAt || event.createdAt;
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

// Which exam event this session belongs to: Centre → its own current event; Candidate/Examiner →
// the exam event id at the end of their qr_token label (`${role} ${subjectId} ${examEventId}`,
// written by ensureQrAccess). Empty string when unknown (legacy/demo sessions) — those rows stay
// unscoped, matching pre-migration data.
async function sessionExamEventId(session) {
  try {
    if (!envReady()) return "";
    if (session.role === "Centre") {
      const rows = await supabase(`exam_events?centre_id=eq.${encodeURIComponent(session.subject_id)}&status=eq.current&select=id&order=updated_at.desc&limit=1`);
      return rows[0]?.id || "";
    }
    if (session.qr_token_id) {
      const rows = await supabase(`qr_tokens?id=eq.${encodeURIComponent(session.qr_token_id)}&select=label&limit=1`);
      const eventId = String(rows[0]?.label || "").trim().split(/\s+/).pop() || "";
      if (eventId.startsWith("EXAM-")) return eventId;
    }
    // Fallback (same order bootstrap.js uses): the subject's own roster row knows its exam event.
    // Without this, a token whose label predates the `role subject examEvent` format would write
    // unscoped rows that the Centre — which resolves a real event id — would never read back.
    if (session.role === "Candidate" || session.role === "Examiner") {
      const table = session.role === "Candidate" ? "candidates" : "examiners";
      const rows = await supabase(`${table}?id=eq.${encodeURIComponent(session.subject_id)}&select=exam_event_id,updated_at&order=updated_at.desc&limit=1`);
      return rows[0]?.exam_event_id || "";
    }
  } catch { /* best-effort */ }
  return "";
}

// Until migration 20260734 runs, the projection tables have no exam_event_id column and
// PostgREST rejects the scoped write. Fall back to the legacy shape so the deploy order does
// not matter (code first, migration later); the flag avoids re-trying on every call.
let eventScopingAvailable = true;
function isMissingEventColumnError(error) {
  return /exam_event_id|PGRST204|ON CONFLICT/i.test(String(error?.message || error));
}
async function upsertProjection(table, conflictCols, row, examEventId) {
  if (eventScopingAvailable) {
    try {
      return await supabase(`${table}?on_conflict=exam_event_id,${conflictCols}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ ...row, exam_event_id: examEventId ?? "" }),
      });
    } catch (error) {
      if (!isMissingEventColumnError(error)) throw error;
      eventScopingAvailable = false;
    }
  }
  return supabase(`${table}?on_conflict=${conflictCols}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
}

async function upsertNormalizedState(session, event, candidateId, examEventId) {
  if (!envReady() || !session.id) return false;

  const payload = event.payload ?? {};
  const sectionKey = sectionKeyFor(event);
  const updatedAt = clientTimestamp(event);

  if (event.type === "candidate_section.opened" || event.type === "candidate_section.reopened" || event.type === "candidate_section.closed") {
    if (!candidateId || !sectionKey) return false;
    const closed = event.type === "candidate_section.closed";
    const status = closed ? "closed" : "open";
    const openedAt = payload.openedAt || payload.openedAtIso || (!closed ? event.createdAt : null);
    const closedAt = payload.closedAt || payload.closedAtIso || (closed ? event.createdAt : null);
    await upsertProjection("candidate_sections", "candidate_id,section_key", {
        candidate_id: candidateId,
        section_key: sectionKey,
        status,
        opened_at: openedAt,
        closed_at: closed ? closedAt : null,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }, examEventId);
    return true;
  }

  if (event.type === "test_response.saved" || event.type === "test_response.submitted") {
    const questionId = payload.questionId || itemIdFor(event) || sectionKey;
    if (!candidateId || !questionId) return false;
    const answerPayload = objectPayload(payload.answer);
    const answer = {
      sectionKey: payload.sectionKey || answerPayload.sectionKey || sectionKey || "test",
      selectedAnswer: payload.selectedAnswer ?? answerPayload.selectedAnswer ?? answerPayload.answer ?? payload.value ?? payload.answer ?? "",
      variantCode: payload.variantCode ?? answerPayload.variantCode ?? null,
      updatedAt,
    };
    await upsertProjection("test_responses", "candidate_id,question_id", {
        candidate_id: candidateId,
        question_id: questionId,
        answer,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }, examEventId);
    return true;
  }

  if (event.type === "candidate_preparation.saved") {
    const treeKey = payload.treeKey || itemIdFor(event);
    if (!candidateId || !treeKey) return false;
    // Same deploy-order tolerance as exam_event_id above: this code can ship before the
    // 20260735 migration is applied. The raw event is already in sync_events by this point, so a
    // missing table costs the projection, not the data — and must not fail the client's batch.
    try {
      await upsertProjection("candidate_preparations", "candidate_id,tree_key", {
          candidate_id: candidateId,
          tree_key: treeKey,
          note: payload.note ?? null,
          sketch: payload.sketch ?? null,
          payload,
          client_updated_at: updatedAt,
          updated_at: new Date().toISOString(),
        }, examEventId);
    } catch (error) {
      if (!/candidate_preparations|does not exist|PGRST205|42P01/i.test(String(error?.message || error))) throw error;
      console.warn("candidate_preparations projection unavailable; event stored raw", error?.message || error);
      return false;
    }
    return true;
  }

  if (event.type === "outdoor_assessment.opened" || event.type === "outdoor_assessment.submitted") {
    const examinerId = examinerIdFor(session, event);
    const outdoorSection = sectionKey || payload.sectionKey || "outdoor";
    if (!candidateId || !examinerId) return false;
    await upsertProjection("outdoor_assessments", "candidate_id,examiner_id,section_key", {
        candidate_id: candidateId,
        examiner_id: examinerId,
        mode: payload.mode || "primary",
        section_key: outdoorSection,
        payload,
        submitted_at: event.type === "outdoor_assessment.submitted" ? payload.submittedAt ?? event.createdAt ?? new Date().toISOString() : null,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }, examEventId);
    return true;
  }

  if (event.type === "outdoor_score.saved") {
    const examinerId = examinerIdFor(session, event);
    const itemId = itemIdFor(event);
    if (!candidateId || !examinerId || !itemId) return false;
    await upsertProjection("outdoor_scores", "candidate_id,examiner_id,item_id", {
        candidate_id: candidateId,
        examiner_id: examinerId,
        item_id: itemId,
        score: payload.score ?? null,
        note: payload.note ?? payload.comment ?? null,
        payload,
        client_updated_at: updatedAt,
        updated_at: new Date().toISOString(),
      }, examEventId);
    return true;
  }

  return false;
}

async function storeEvent(session, event, candidateId, examEventId) {
  const createdAt = event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString();

  if (!envReady() || !session.id) {
    return { id: event.clientEventId, duplicate: false, normalized: false };
  }

  const duplicate = await existingEvent(session.id, event.clientEventId);
  if (duplicate) return { id: duplicate.id, duplicate: true, normalized: false };

  const syncEventRow = {
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
  };
  let rows;
  try {
    rows = await supabase("sync_events", { method: "POST", body: JSON.stringify({ ...syncEventRow, exam_event_id: examEventId ?? "" }) });
  } catch (error) {
    if (!isMissingEventColumnError(error)) throw error;
    rows = await supabase("sync_events", { method: "POST", body: JSON.stringify(syncEventRow) });
  }

  const normalized = await upsertNormalizedState(session, event, candidateId, examEventId);
  return { id: rows[0]?.id ?? event.clientEventId, duplicate: false, normalized };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, events } = request.body ?? {};
    if (!Array.isArray(events)) return sendJson(response, 400, { error: "Events must be an array" });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });

    let dbAssignedCandidateIds = null;
    if (session.role === "Examiner" && envReady()) {
      try {
        const rows = await supabase(`examiner_assignments?examiner_id=eq.${encodeURIComponent(session.subject_id)}&select=candidate_id`);
        dbAssignedCandidateIds = new Set(rows.map((row) => row.candidate_id));
      } catch { dbAssignedCandidateIds = null; }
    }

    const validations = events.map((event) => ({ event, validation: validateEvent(session, event, dbAssignedCandidateIds) }));
    const rejected = validations.find((item) => item.validation.error);
    if (rejected) {
      return sendJson(response, rejected.validation.status, {
        ok: false,
        accepted: 0,
        rejected: 1,
        error: rejected.validation.error,
        details: rejected.validation.details,
        clientEventId: rejected.event?.clientEventId ?? null,
      });
    }

    const results = [];
    let accepted = 0;
    const examEventId = await sessionExamEventId(session);

    for (const { event, validation } of validations) {
      const stored = await storeEvent(session, event, validation.candidateId ?? null, examEventId);
      accepted += 1;
      results.push({ clientEventId: event.clientEventId, ok: true, id: stored.id, duplicate: stored.duplicate, normalized: stored.normalized });
    }

    return sendJson(response, 200, { ok: true, accepted, rejected: 0, results });
  } catch (error) {
    console.error("Sync batch failed", error);
    return sendJson(response, 500, { error: "Sync batch failed" });
  }
}
