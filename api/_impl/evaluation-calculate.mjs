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

function canCalculateCandidate(session, candidateId) {
  if (session.role === "Candidate") return session.subject_id === candidateId;
  if (session.role === "Examiner") return isAssignedExaminer(session.subject_id, candidateId);
  if (session.role === "Centre") return Boolean(CANDIDATES.find((candidate) => candidate.id === candidateId));
  return false;
}

function candidateFor(candidateId) {
  return CANDIDATES.find((candidate) => candidate.id === candidateId) ?? null;
}

async function readRows(table, candidateId, orderBy = "updated_at.desc") {
  if (!envReady()) return [];
  const order = orderBy ? `&order=${orderBy}` : "";
  return supabase(`${table}?candidate_id=eq.${encodeURIComponent(candidateId)}&select=*${order}`);
}

function scoreMode(score) {
  if (score.payload?.mode) return score.payload.mode;
  const assignment = ASSIGNMENTS[score.candidate_id];
  if (!assignment) return null;
  if (assignment.primary === score.examiner_id) return "primary";
  if (assignment.secondary === score.examiner_id) return "secondary";
  return null;
}

function numericOutdoorScores(outdoorScores) {
  return outdoorScores
    .map((score) => ({ ...score, numericScore: Number(score.score), mode: scoreMode(score) }))
    .filter((score) => Number.isFinite(score.numericScore));
}

function buildCalculation(candidate, sections, testResponses, outdoorAssessments, outdoorScores) {
  const closedSections = sections.filter((section) => section.status === "closed").length;
  const allSectionsClosed = sections.length > 0 && sections.length === closedSections;
  const scoredOutdoor = numericOutdoorScores(outdoorScores);
  const outdoorScore = scoredOutdoor.reduce((sum, score) => sum + score.numericScore, 0);
  const writtenAvailable = false;
  const reportAvailable = false;
  const blockingIssues = [];
  const warnings = ["This is a draft calculation, not an official VETcert result."];

  if (!candidate) blockingIssues.push("No candidate record is available.");
  if (sections.length === 0) blockingIssues.push("No candidate sections are available.");
  if (sections.length > 0 && !allSectionsClosed) blockingIssues.push("Not all candidate sections are closed.");
  if (scoredOutdoor.length === 0) blockingIssues.push("No outdoor scores are available.");
  if (!writtenAvailable) blockingIssues.push("Written score is unavailable.");
  if (candidate?.level === "Consulting" && !reportAvailable) blockingIssues.push("Consulting report score is unavailable.");
  if (testResponses.length === 0) warnings.push("No normalized written test response rows were found.");
  if (outdoorAssessments.length === 0) warnings.push("No normalized outdoor assessment rows were found.");

  return {
    status: "draft",
    isOfficialResult: false,
    written: {
      available: false,
      score: null,
      maxScore: null,
      notes: ["Written test scoring is not normalized yet."],
    },
    outdoor: {
      available: scoredOutdoor.length > 0,
      score: outdoorScore,
      maxScore: null,
      average: scoredOutdoor.length ? outdoorScore / scoredOutdoor.length : null,
      scoreCount: scoredOutdoor.length,
      primaryScoreCount: scoredOutdoor.filter((score) => score.mode === "primary").length,
      secondaryScoreCount: scoredOutdoor.filter((score) => score.mode === "secondary").length,
    },
    report: {
      available: false,
      score: null,
      maxScore: null,
      notes: ["Report scoring is not normalized yet."],
    },
    sections: {
      total: sections.length,
      closed: closedSections,
      allClosed: allSectionsClosed,
    },
    readiness: {
      canGenerateEvaluationFile: false,
      blockingIssues,
      warnings,
    },
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, candidateId } = request.body ?? {};
    if (!candidateId) return sendJson(response, 400, { error: "Missing candidate id" });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (!canCalculateCandidate(session, candidateId)) return sendJson(response, 403, { error: "Candidate is outside this session scope" });

    const candidate = candidateFor(candidateId);
    const [sections, testResponses, outdoorAssessments, outdoorScores] = await Promise.all([
      readRows("candidate_sections", candidateId),
      readRows("test_responses", candidateId),
      readRows("outdoor_assessments", candidateId),
      readRows("outdoor_scores", candidateId),
    ]);

    return sendJson(response, 200, {
      ok: true,
      candidateId,
      generatedAt: new Date().toISOString(),
      candidate: candidate ?? { id: candidateId, name: candidateId, level: null },
      calculation: buildCalculation(candidate, sections, testResponses, outdoorAssessments, outdoorScores),
    });
  } catch (error) {
    console.error("Candidate evaluation calculation failed", error);
    return sendJson(response, 500, { error: "Candidate evaluation calculation failed" });
  }
}
