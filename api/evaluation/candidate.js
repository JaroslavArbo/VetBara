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

  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

function canReadCandidate(session, candidateId) {
  if (session.role === "Candidate") return session.subject_id === candidateId;
  if (session.role === "Examiner") return isAssignedExaminer(session.subject_id, candidateId);
  if (session.role === "Centre") return Boolean(CANDIDATES.find((candidate) => candidate.id === candidateId));
  return false;
}

function candidateFor(candidateId) {
  return CANDIDATES.find((candidate) => candidate.id === candidateId) ?? { id: candidateId, name: candidateId, level: null };
}

async function readRows(table, candidateId, orderBy = "updated_at.desc") {
  if (!envReady()) return [];
  const order = orderBy ? `&order=${orderBy}` : "";
  return supabase(`${table}?candidate_id=eq.${encodeURIComponent(candidateId)}&select=*${order}`);
}

async function readReportEvents(candidateId) {
  if (!envReady()) return [];
  const types = encodeURIComponent("report_draft.saved,report_photo.added");
  return supabase(`sync_events?candidate_id=eq.${encodeURIComponent(candidateId)}&event_type=in.(${types})&select=*&order=created_at.asc`);
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

async function readReportEvents(candidateId) {
  if (!envReady()) return [];
  const types = encodeURIComponent("report_draft.saved,report_photo.added");
  return supabase(`sync_events?candidate_id=eq.${encodeURIComponent(candidateId)}&event_type=in.(${types})&select=*&order=created_at.asc`);
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
    if (!canReadCandidate(session, candidateId)) return sendJson(response, 403, { error: "Candidate is outside this session scope" });

  const [sections, testResponses, outdoorAssessments, outdoorScores, reportEvents] = await Promise.all([
  readRows("candidate_sections", candidateId),
  readRows("test_responses", candidateId),
  readRows("outdoor_assessments", candidateId),
  readRows("outdoor_scores", candidateId),
  readReportEvents(candidateId),
]);

const reportDraft = buildReportDraft(reportEvents);

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
summary: buildSummary(sections, testResponses, outdoorScores),
    });
  } catch (error) {
    console.error("Candidate evaluation read model failed", error);
    return sendJson(response, 500, { error: "Candidate evaluation package failed" });
  }
}
