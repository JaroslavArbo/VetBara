import crypto from "node:crypto";

const CANDIDATES = [
  { id: "C-001", name: "Candidate 1", level: "Consulting" },
  { id: "C-002", name: "Candidate 2", level: "Practicing" },
  { id: "C-003", name: "Candidate 3", level: "Practicing" },
  { id: "C-004", name: "Candidate 4", level: "Consulting" },
];

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
  return response.json();
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


// Which exam event the requesting session belongs to (Centre → its current event; others → the
// event id ending their qr_token label). '' = unknown/legacy. Reads are filtered by it so one
// certification never sees another's (or a previous exam's) sections/answers/scores. If the
// 20260734 migration has not run yet, the filtered read fails on the missing column and we fall
// back to unscoped reads (deploy order stays free).
let eventScopingAvailable = true;
function isMissingEventColumnError(error) {
  return /exam_event_id|PGRST204|42703/i.test(String(error?.message || error));
}
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
async function scopedRead(buildPath, examEventId) {
  if (eventScopingAvailable && examEventId !== undefined) {
    try {
      return await supabase(buildPath(`&exam_event_id=eq.${encodeURIComponent(examEventId ?? "")}`));
    } catch (error) {
      if (!isMissingEventColumnError(error)) throw error;
      eventScopingAvailable = false;
    }
  }
  return supabase(buildPath(""));
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

function canReadCandidate(session, candidateId) {
  if (session.role === "Candidate") return session.subject_id === candidateId;
  if (session.role === "Examiner") return isAssignedExaminer(session.subject_id, candidateId);
  // A Centre session is already authenticated and scoped to its own exam event, so it may read
  // any candidate's results — including a real roster whose ids are not in the demo CANDIDATES
  // list. Restricting to the hardcoded demo ids would 403 the Centre results overview for real
  // exams and Outdoor scores submitted on examiner tablets would never appear in Section E.
  if (session.role === "Centre") return Boolean(candidateId);
  return false;
}

function candidateFor(candidateId) {
  return CANDIDATES.find((candidate) => candidate.id === candidateId) ?? { id: candidateId, name: candidateId, level: null };
}

async function readRows(table, candidateId, examEventId, orderBy = "updated_at.desc") {
  if (!envReady()) return [];
  const order = orderBy ? `&order=${orderBy}` : "";
  return scopedRead((scope) => `${table}?candidate_id=eq.${encodeURIComponent(candidateId)}${scope}&select=*${order}`, examEventId);
}

async function readReportEvents(candidateId, examEventId) {
  if (!envReady()) return [];
  const types = encodeURIComponent("report_draft.saved,report_photo.added");
  return scopedRead((scope) => `sync_events?candidate_id=eq.${encodeURIComponent(candidateId)}${scope}&event_type=in.(${types})&select=*&order=created_at.asc`, examEventId);
}

// Examiner-entered written/report scores travel as plain sync_events (no dedicated table), so
// read them here and keep only the latest value per examiner+field. The Centre reads these back
// into Section E — without them, an examiner's written/report score never leaves their tablet.
async function readExaminerScoreEvents(candidateId, examEventId) {
  if (!envReady()) return [];
  const types = encodeURIComponent("examiner_score.saved");
  return scopedRead((scope) => `sync_events?candidate_id=eq.${encodeURIComponent(candidateId)}${scope}&event_type=in.(${types})&select=*&order=created_at.asc`, examEventId);
}

function buildExaminerScores(events) {
  const byKey = {};
  for (const event of events) {
    const p = event.payload ?? {};
    const field = p.field;
    if (!field) continue;
    const examinerId = p.examinerId ?? event.subject_id ?? null;
    byKey[`${examinerId}:${field}`] = {
      candidateId: event.candidate_id,
      examinerId,
      field,
      value: p.value ?? null,
      max: p.max ?? null,
      mode: p.mode ?? p.role ?? null,
      role: p.role ?? p.mode ?? null,
      closed: Boolean(p.closed),
      closedAt: p.closedAt ?? null,
      submittedAt: p.submittedAt ?? null,
      updatedAt: p.updatedAt ?? event.created_at ?? null,
    };
  }
  return Object.values(byKey);
}

function createReportDraft() {
  return {
    "Tree A": { fieldNotes: "", photos: [], finalSections: {} },
    "Tree B": { fieldNotes: "", photos: [], finalSections: {} },
  };
}

function buildReportDraft(events) {
  return events.reduce((draft, event) => {
    const payload = event.payload ?? {};
    const treeId = payload.treeId || payload.tree || "Tree A";

    if (!draft[treeId]) {
      draft[treeId] = { fieldNotes: "", photos: [], finalSections: {} };
    }

    if (event.event_type === "report_draft.saved") {
      const fieldKey = payload.fieldKey || payload.key;
      const fieldType = payload.fieldType || "finalSection";
      if (!fieldKey) return draft;

      if (fieldType === "fieldNotes" || fieldKey === "fieldNotes") {
        draft[treeId] = { ...draft[treeId], fieldNotes: payload.value ?? "" };
      } else {
        draft[treeId] = {
          ...draft[treeId],
          finalSections: {
            ...(draft[treeId].finalSections ?? {}),
            [fieldKey]: payload.value ?? "",
          },
        };
      }
    }

    if (event.event_type === "report_photo.added") {
      const photoId = payload.photoId || payload.id;
      if (!photoId) return draft;
      const existing = draft[treeId].photos ?? [];
      if (existing.some((photo) => photo.id === photoId)) return draft;
      draft[treeId] = {
        ...draft[treeId],
        photos: [
          ...existing,
          {
            id: photoId,
            caption: payload.caption || `${treeId} candidate photo ${existing.length + 1}`,
            capturedAt: payload.capturedAt || event.created_at || null,
          },
        ],
      };
    }

    return draft;
  }, createReportDraft());
}

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

function treeHasReportContent(tree) {
  const finalSections = tree?.finalSections && typeof tree.finalSections === "object" ? tree.finalSections : {};
  const photos = Array.isArray(tree?.photos) ? tree.photos : [];
  return hasText(tree?.fieldNotes) || Object.values(finalSections).some(hasText) || photos.length > 0;
}

function buildReportSummary(reportDraft, reportEvents, sections) {
  const trees = Object.values(reportDraft ?? {});
  const fieldNotesFilled = trees.filter((tree) => hasText(tree?.fieldNotes)).length;
  const finalSectionsFilled = trees.reduce((total, tree) => {
    const finalSections = tree?.finalSections && typeof tree.finalSections === "object" ? tree.finalSections : {};
    return total + Object.values(finalSections).filter(hasText).length;
  }, 0);
  const photoPlaceholdersTotal = trees.reduce((total, tree) => total + (Array.isArray(tree?.photos) ? tree.photos.length : 0), 0);
  const isSubmitted = sections.some((section) => {
    const sectionKey = section.section_key ?? section.sectionKey;
    return sectionKey === "report" && ["closed", "submitted"].includes(section.status);
  });

  return {
    hasReportDraft: Boolean((reportEvents ?? []).length || fieldNotesFilled || finalSectionsFilled || photoPlaceholdersTotal),
    treesTotal: trees.length,
    treesWithContent: trees.filter(treeHasReportContent).length,
    fieldNotesFilled,
    finalSectionsFilled,
    photoPlaceholdersTotal,
    isSubmitted,
  };
}

function scoreMode(score) {
  if (score.payload?.mode) return score.payload.mode;
  const assignment = ASSIGNMENTS[score.candidate_id];
  if (!assignment) return null;
  if (assignment.primary === score.examiner_id) return "primary";
  if (assignment.secondary === score.examiner_id) return "secondary";
  return null;
}

function buildSummary(sections, testResponses, outdoorScores) {
  const numericScores = outdoorScores
    .map((score) => Number(score.score))
    .filter((score) => Number.isFinite(score));
  const scoreSum = numericScores.reduce((sum, score) => sum + score, 0);

  return {
    sectionsTotal: sections.length,
    sectionsClosed: sections.filter((section) => section.status === "closed").length,
    testResponsesTotal: testResponses.length,
    outdoorScoresTotal: numericScores.length,
    outdoorScoreSum: scoreSum,
    outdoorScoreAverage: numericScores.length ? scoreSum / numericScores.length : null,
    hasPrimaryExaminerScores: outdoorScores.some((score) => scoreMode(score) === "primary"),
    hasSecondaryExaminerScores: outdoorScores.some((score) => scoreMode(score) === "secondary"),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, candidateId } = request.body ?? {};
    if (!candidateId) return sendJson(response, 400, { error: "Missing candidate id" });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    let allowed = canReadCandidate(session, candidateId);
    if (!allowed && session.role === "Examiner" && envReady()) {
      // Real rosters live in examiner_assignments — the hardcoded demo ASSIGNMENTS only cover
      // E-001..E-003, which locked a 4th examiner out of reading their assigned candidates.
      try {
        const rows = await supabase(`examiner_assignments?examiner_id=eq.${encodeURIComponent(session.subject_id)}&candidate_id=eq.${encodeURIComponent(candidateId)}&select=candidate_id&limit=1`);
        allowed = rows.length > 0;
      } catch { /* keep denied */ }
    }
    if (!allowed) return sendJson(response, 403, { error: "Candidate is outside this session scope" });

    const examEventId = await sessionExamEventId(session);
    const [sections, testResponses, outdoorAssessments, outdoorScores, reportEvents, examinerScoreEvents] = await Promise.all([
      readRows("candidate_sections", candidateId, examEventId),
      readRows("test_responses", candidateId, examEventId),
      readRows("outdoor_assessments", candidateId, examEventId),
      readRows("outdoor_scores", candidateId, examEventId),
      readReportEvents(candidateId, examEventId),
      readExaminerScoreEvents(candidateId, examEventId),
    ]);

    const reportDraft = buildReportDraft(reportEvents);
    const reportSummary = buildReportSummary(reportDraft, reportEvents, sections);
    const examinerScores = buildExaminerScores(examinerScoreEvents);

    return sendJson(response, 200, {
      ok: true,
      candidateId,
      generatedAt: new Date().toISOString(),
      candidate: candidateFor(candidateId),
      sections,
      testResponses,
      outdoorAssessments,
      outdoorScores,
      reportEvents,
      reportDraft,
      reportSummary,
      examinerScores,
      summary: buildSummary(sections, testResponses, outdoorScores),
    });
  } catch (error) {
    console.error("Candidate evaluation read model failed", error);
    return sendJson(response, 500, { error: "Candidate evaluation package failed" });
  }
}
