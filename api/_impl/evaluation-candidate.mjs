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
// The Centre's own "current" exam event can drift from whichever event id a specific candidate's
// own sessions actually wrote under. sessionExamEventId() itself prefers the candidate's QR TOKEN
// label over their roster row's exam_event_id column - so if a token was minted before a roster
// re-import/re-setup moved the roster row to a newer event, the candidate's session (still using
// that older token) keeps writing under the OLD event, while a Centre-role fallback that only
// checks the roster row would miss it entirely. Returns every plausible scope (every QR token ever
// issued to this candidate, plus the roster row) so the caller can try each one in turn.
async function candidateOwnExamEventIds(candidateId) {
  const scopes = new Set();
  try {
    if (!envReady()) return [];
    // Every token ever issued (not just the active one - a regenerated token can leave an older,
    // unrevoked one behind, and it's whichever one the candidate's own device actually used that
    // decides the scope their writes were stamped with).
    const tokenRows = await supabase(`qr_tokens?subject_id=eq.${encodeURIComponent(candidateId)}&role=eq.Candidate&select=label`);
    for (const row of tokenRows ?? []) {
      const eventId = String(row?.label || "").trim().split(/\s+/).pop() || "";
      if (eventId.startsWith("EXAM-")) scopes.add(eventId);
    }
    const rosterRows = await supabase(`candidates?id=eq.${encodeURIComponent(candidateId)}&select=exam_event_id`);
    if (rosterRows[0]?.exam_event_id) scopes.add(rosterRows[0].exam_event_id);
  } catch { /* best-effort */ }
  return Array.from(scopes);
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
  const types = encodeURIComponent("report_draft.saved,report_photo.added,report_photo.moved");
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

// Session-integrity signals (fullscreen exits, app switching) recorded on the candidate's own
// device. The Centre invigilates from a separate device, so its audit trail can only show these
// once they have travelled through sync_events — hence reading them back here.
const INTEGRITY_EVENT_TYPES = "session.fullscreen_entered,session.fullscreen_exited,session.app_backgrounded,session.app_foregrounded";

async function readIntegrityEvents(candidateId, examEventId) {
  if (!envReady()) return [];
  const types = encodeURIComponent(INTEGRITY_EVENT_TYPES);
  return scopedRead((scope) => `sync_events?candidate_id=eq.${encodeURIComponent(candidateId)}${scope}&event_type=in.(${types})&select=id,event_type,role,subject_id,payload,created_at&order=created_at.asc`, examEventId);
}

function buildIntegrityEvents(events) {
  return events.map((event) => ({
    id: event.id,
    type: event.event_type,
    subjectKind: event.payload?.subjectKind ?? (event.role === "Examiner" ? "examiner" : "candidate"),
    subjectId: event.payload?.subjectId ?? event.subject_id ?? null,
    subjectName: event.payload?.subjectName ?? null,
    at: event.payload?.at ?? event.created_at ?? null,
  }));
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
      // Per-question written overrides / per-section report marks, when this save carried them
      // (Section E corrections always do). Without these the Centre can only see the rolled-up
      // total — not which question or report section the correction actually touched.
      scores: p.scores ?? null,
      marks: p.marks ?? null,
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

    // A photo the candidate re-assigned to the other tree on the tablet. Remove it from the source
    // tree and re-add it (under a fresh id) to the destination, so the Centre review shows it where
    // the candidate put it, not on its original capture tree. Events are read created_at.asc, so a
    // move always reduces after the add it targets.
    if (event.event_type === "report_photo.moved") {
      const oldId = payload.photoId || payload.id;
      const fromTree = payload.fromTree;
      const toTree = payload.toTree || payload.treeId;
      const newId = payload.newPhotoId || oldId;
      if (!oldId || !fromTree || !toTree) return draft;
      if (!draft[fromTree]) draft[fromTree] = { fieldNotes: "", photos: [], finalSections: {} };
      if (!draft[toTree]) draft[toTree] = { fieldNotes: "", photos: [], finalSections: {} };
      const moving = (draft[fromTree].photos ?? []).find((photo) => photo.id === oldId);
      draft[fromTree] = { ...draft[fromTree], photos: (draft[fromTree].photos ?? []).filter((photo) => photo.id !== oldId) };
      const destExisting = draft[toTree].photos ?? [];
      if (!destExisting.some((photo) => photo.id === newId)) {
        draft[toTree] = {
          ...draft[toTree],
          photos: [
            ...destExisting,
            {
              id: newId,
              caption: payload.caption || moving?.caption || `${toTree} candidate photo ${destExisting.length + 1}`,
              capturedAt: payload.capturedAt || moving?.capturedAt || event.created_at || null,
            },
          ],
        };
      }
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
    let [sections, testResponses, outdoorAssessments, outdoorScores, reportEvents, examinerScoreEvents, integrityEventRows, preparations] = await Promise.all([
      readRows("candidate_sections", candidateId, examEventId),
      readRows("test_responses", candidateId, examEventId),
      readRows("outdoor_assessments", candidateId, examEventId),
      readRows("outdoor_scores", candidateId, examEventId),
      readReportEvents(candidateId, examEventId),
      readExaminerScoreEvents(candidateId, examEventId),
      readIntegrityEvents(candidateId, examEventId).catch(() => []),
      // Tolerate the table not existing yet: code can deploy before the migration is applied, and a
      // missing preparation must not take the whole evaluation read model down with it.
      readRows("candidate_preparations", candidateId, examEventId).catch(() => []),
    ]);

    // A Centre-role read that came back empty for one of the candidate-authored datasets is retried
    // under every OTHER plausible scope for that candidate (their other QR tokens, their roster
    // row) before concluding they really have no data - independently per dataset, since e.g. their
    // section-open events and their report events can easily have been written under two different
    // scopes if a token was regenerated partway through the exam. Examiner-authored reads (outdoor
    // scores, examiner_score events) are scoped by the examiner's own session instead and are not
    // affected by this, so they are not retried.
    let scopeRecoveryDebug = null;
    if (session.role === "Centre" && (!sections.length || !testResponses.length || !reportEvents.length || !preparations.length)) {
      const candidateScopes = (await candidateOwnExamEventIds(candidateId)).filter((scope) => scope && scope !== examEventId);
      scopeRecoveryDebug = { centreScope: examEventId, candidateScopesTried: candidateScopes, recoveredScopes: null };
      if (candidateScopes.length) {
        const recover = async (rows, readFn) => {
          if (rows.length) return { rows, recoveredScope: null };
          for (const scope of candidateScopes) {
            const retried = await readFn(scope);
            if (retried.length) return { rows: retried, recoveredScope: scope };
          }
          return { rows, recoveredScope: null };
        };
        const [sectionsResult, testResponsesResult, reportEventsResult, preparationsResult] = await Promise.all([
          recover(sections, (scope) => readRows("candidate_sections", candidateId, scope)),
          recover(testResponses, (scope) => readRows("test_responses", candidateId, scope)),
          recover(reportEvents, (scope) => readReportEvents(candidateId, scope)),
          recover(preparations, (scope) => readRows("candidate_preparations", candidateId, scope).catch(() => [])),
        ]);
        sections = sectionsResult.rows;
        testResponses = testResponsesResult.rows;
        reportEvents = reportEventsResult.rows;
        preparations = preparationsResult.rows;
        const recoveredScopes = { sections: sectionsResult.recoveredScope, testResponses: testResponsesResult.recoveredScope, reportEvents: reportEventsResult.recoveredScope, preparations: preparationsResult.recoveredScope };
        scopeRecoveryDebug.recoveredScopes = recoveredScopes;
        if (Object.values(recoveredScopes).some(Boolean)) {
          console.warn("Candidate evaluation recovered via an alternate exam-event scope (Centre scope was stale/mismatched)", { candidateId, centreScope: examEventId, candidateScopesTried: candidateScopes, recoveredScopes });
        }
      }
    }

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
      integrityEvents: buildIntegrityEvents(integrityEventRows),
      preparations,
      summary: buildSummary(sections, testResponses, outdoorScores),
      // Centre-only, and only present when at least one candidate-authored dataset was empty under
      // the Centre's own scope - visible in the Network tab response so a "still shows nothing"
      // report can be diagnosed from what was actually tried, instead of guessing again.
      ...(scopeRecoveryDebug ? { _scopeRecoveryDebug: scopeRecoveryDebug } : {}),
    });
  } catch (error) {
    console.error("Candidate evaluation read model failed", error);
    return sendJson(response, 500, { error: "Candidate evaluation package failed" });
  }
}
