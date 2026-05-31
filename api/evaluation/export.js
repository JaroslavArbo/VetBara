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

const DRAFT_LABEL = "DRAFT EXPORT — NOT OFFICIAL VETCERT RESULT";
const DRAFT_NOTE = "This file is generated from VetBara normalized test data and is not the final official VETcert evaluation template.";
const XLS_MIME_TYPE = "application/vnd.ms-excel";

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
  return result.json();
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

function candidateFor(candidateId) {
  return CANDIDATES.find((candidate) => candidate.id === candidateId) ?? { id: candidateId, name: candidateId, level: null };
}

function isAssignedExaminer(examinerId, candidateId) {
  const assignment = ASSIGNMENTS[candidateId];
  return Boolean(assignment && (assignment.primary === examinerId || assignment.secondary === examinerId));
}

function canExportCandidate(session, candidateId) {
  if (session.role === "Candidate") return session.subject_id === candidateId;
  if (session.role === "Examiner") return isAssignedExaminer(session.subject_id, candidateId);
  if (session.role === "Centre") return Boolean(CANDIDATES.find((candidate) => candidate.id === candidateId));
  return false;
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

function buildDraftCalculation(candidate, sections, testResponses, outdoorAssessments, outdoorScores) {
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
  warnings.push(DRAFT_NOTE);

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function keyValueTable(title, rows) {
  const body = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(formatCell(value))}</td></tr>`)
    .join("");
  return `<h2>${escapeHtml(title)}</h2><table><tbody>${body || emptyRow(2)}</tbody></table>`;
}

function emptyRow(columnCount) {
  return `<tr><td colspan="${columnCount}">No rows available.</td></tr>`;
}

function dataTable(title, headers, rows) {
  const headerCells = headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("");
  const body = rows.length
    ? rows
        .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(formatCell(header.value(row)))}</td>`).join("")}</tr>`)
        .join("")
    : emptyRow(headers.length);

  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headerCells}</tr></thead><tbody>${body}</tbody></table>`;
}

function listTable(title, items) {
  return dataTable(title, [{ label: "Item", value: (row) => row.value }], items.map((value) => ({ value })));
}

function buildHtmlExport(candidate, calculation, sections, testResponses, outdoorAssessments, outdoorScores, generatedAt) {
  const candidateRows = [
    ["Candidate ID", candidate.id],
    ["Name", candidate.name],
    ["Level", candidate.level],
    ["Generated At", generatedAt],
    ["Official Result", "No"],
  ];

  const calculationRows = [
    ["Status", calculation.status],
    ["Official Result", calculation.isOfficialResult],
    ["Sections Total", calculation.sections.total],
    ["Sections Closed", calculation.sections.closed],
    ["All Sections Closed", calculation.sections.allClosed],
    ["Written Available", calculation.written.available],
    ["Written Score", calculation.written.score],
    ["Outdoor Available", calculation.outdoor.available],
    ["Outdoor Score", calculation.outdoor.score],
    ["Outdoor Average", calculation.outdoor.average],
    ["Outdoor Score Count", calculation.outdoor.scoreCount],
    ["Primary Outdoor Score Count", calculation.outdoor.primaryScoreCount],
    ["Secondary Outdoor Score Count", calculation.outdoor.secondaryScoreCount],
    ["Report Available", calculation.report.available],
    ["Report Score", calculation.report.score],
    ["Can Generate Evaluation File", calculation.readiness.canGenerateEvaluationFile],
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(`VetBara Evaluation Draft ${candidate.id}`)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; }
    h1 { color: #991b1b; font-size: 20px; }
    h2 { margin-top: 24px; font-size: 16px; color: #1f2937; }
    p { margin: 8px 0 16px; }
    table { border-collapse: collapse; margin-bottom: 16px; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: bold; }
    .draft-note { color: #991b1b; font-weight: bold; }
  </style>
</head>
<body>
  <h1>${escapeHtml(DRAFT_LABEL)}</h1>
  <p class="draft-note">${escapeHtml(DRAFT_NOTE)}</p>
  ${keyValueTable("Candidate", candidateRows)}
  ${keyValueTable("Calculation Summary", calculationRows)}
  ${listTable("Blocking Issues", calculation.readiness.blockingIssues)}
  ${listTable("Warnings", calculation.readiness.warnings)}
  ${dataTable("Candidate Sections", [
    { label: "Section", value: (row) => row.section_key },
    { label: "Status", value: (row) => row.status },
    { label: "Opened At", value: (row) => row.opened_at },
    { label: "Closed At", value: (row) => row.closed_at },
    { label: "Updated At", value: (row) => row.updated_at },
    { label: "Payload", value: (row) => row.payload },
  ], sections)}
  ${dataTable("Outdoor Scores", [
    { label: "Item", value: (row) => row.item_id },
    { label: "Examiner", value: (row) => row.examiner_id },
    { label: "Mode", value: (row) => scoreMode(row) },
    { label: "Score", value: (row) => row.score },
    { label: "Note", value: (row) => row.note },
    { label: "Updated At", value: (row) => row.updated_at },
    { label: "Payload", value: (row) => row.payload },
  ], outdoorScores)}
  ${dataTable("Test Responses", [
    { label: "Question", value: (row) => row.question_id },
    { label: "Answer", value: (row) => row.answer },
    { label: "Submitted At", value: (row) => row.submitted_at },
    { label: "Updated At", value: (row) => row.updated_at },
    { label: "Payload", value: (row) => row.payload },
  ], testResponses)}
  ${dataTable("Outdoor Assessments", [
    { label: "Examiner", value: (row) => row.examiner_id },
    { label: "Mode", value: (row) => scoreMode(row) },
    { label: "Status", value: (row) => row.status },
    { label: "Opened At", value: (row) => row.opened_at },
    { label: "Submitted At", value: (row) => row.submitted_at },
    { label: "Updated At", value: (row) => row.updated_at },
    { label: "Payload", value: (row) => row.payload },
  ], outdoorAssessments)}
</body>
</html>`;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, candidateId, format = "xls" } = request.body ?? {};
    if (!candidateId) return sendJson(response, 400, { error: "Missing candidate id" });
    if (format !== "xls") return sendJson(response, 400, { error: "Unsupported export format" });

    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (!canExportCandidate(session, candidateId)) return sendJson(response, 403, { error: "Candidate is outside this session scope" });

    const [sections, testResponses, outdoorAssessments, outdoorScores] = await Promise.all([
      readRows("candidate_sections", candidateId),
      readRows("test_responses", candidateId),
      readRows("outdoor_assessments", candidateId),
      readRows("outdoor_scores", candidateId),
    ]);

    const candidate = candidateFor(candidateId);
    const generatedAt = new Date().toISOString();
    const calculation = buildDraftCalculation(candidate, sections, testResponses, outdoorAssessments, outdoorScores);
    const html = buildHtmlExport(candidate, calculation, sections, testResponses, outdoorAssessments, outdoorScores, generatedAt);

    return sendJson(response, 200, {
      ok: true,
      candidateId,
      filename: `VetBara_Evaluation_Draft_${candidateId}.xls`,
      mimeType: XLS_MIME_TYPE,
      base64: Buffer.from(html, "utf8").toString("base64"),
    });
  } catch (error) {
    console.error("Candidate evaluation export failed", error);
    return sendJson(response, 500, { error: "Candidate evaluation export failed" });
  }
}
