import crypto from "node:crypto";

const CENTRE = { id: "CENTRE-ARBOR", name: "Arboricultural Academy" };
const EXAM_EVENT = {
  id: "EXAM-BUCHLOVICE-2026-03-31",
  date: "2026-03-31",
  place: "Buchlovice",
  language: "EN",
  levels: ["Practicing", "Consulting"],
};
const CANDIDATES = [
  { id: "C-001", name: "Candidate 1", birthDate: "", documentId: "", level: "Consulting", status: "Ready" },
  { id: "C-002", name: "Candidate 2", birthDate: "", documentId: "", level: "Practicing", status: "Ready" },
  { id: "C-003", name: "Candidate 3", birthDate: "", documentId: "", level: "Practicing", status: "Ready" },
  { id: "C-004", name: "Candidate 4", birthDate: "", documentId: "", level: "Consulting", status: "Ready" },
];
const EXAMINERS = [
  { id: "E-001", name: "Examiner 1", birthDate: "", registrationId: "EX-DEMO-001" },
  { id: "E-002", name: "Examiner 2", birthDate: "", registrationId: "EX-DEMO-002" },
  { id: "E-003", name: "Examiner 3", birthDate: "", registrationId: "EX-DEMO-003" },
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
  return session;
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

function sectionsFor(level) {
  const sections = [{ key: "test", title: "Written test", status: "not_started" }];
  if (level === "Consulting") sections.push({ key: "report", title: "Report for 2 trees", status: "not_started" });
  return sections;
}

function centreBootstrap(session) {
  return {
    centre: CENTRE,
    examEvent: EXAM_EVENT,
    candidates: CANDIDATES,
    examiners: EXAMINERS,
    assignments: Object.entries(ASSIGNMENTS).map(([candidateId, assignment]) => ({ candidateId, ...assignment })),
    allowedPortal: "Centre",
    sessionId: session.id ?? null,
  };
}

function candidateBootstrap(session) {
  const candidate = CANDIDATES.find((item) => item.id === session.subjectId);
  if (!candidate) return null;
  return {
    candidate,
    sections: sectionsFor(candidate.level),
    allowedPortal: "Candidate",
    sessionId: session.id ?? null,
  };
}

function examinerBootstrap(session) {
  const examiner = EXAMINERS.find((item) => item.id === session.subjectId);
  if (!examiner) return null;

  const assignedCandidates = CANDIDATES.flatMap((candidate) => {
    const assignment = ASSIGNMENTS[candidate.id];
    if (!assignment) return [];
    const assignmentRole = assignment.primary === examiner.id ? "primary" : assignment.secondary === examiner.id ? "secondary" : null;
    return assignmentRole ? [{ ...candidate, assignmentRole }] : [];
  });

  return {
    examiner,
    assignedCandidates,
    allowedPortal: "Examiner",
    sessionId: session.id ?? null,
  };
}

function buildBootstrapPackage(session) {
  if (session.role === "Centre") return centreBootstrap(session);
  if (session.role === "Candidate") return candidateBootstrap(session);
  if (session.role === "Examiner") return examinerBootstrap(session);
  return null;
}

function objectPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Every role opens on its own device, so the persisted Centre setup (which holds the imported
// Admin.vet test package: written/outdoor banks + activeAdminPackageMeta + outdoor briefing) must
// travel with the session bootstrap — otherwise an Examiner/Candidate sees "exam data not
// available yet", or an out-of-date package.
//
// One exam runs at a time, so the source of truth is the most recently updated *current* exam
// event that actually carries a test package. We deliberately do NOT key off a per-subject
// exam_event lookup: a candidate/examiner row can linger under an older exam event (upserts key
// on exam_event_id+id, so a new event makes a new row), which would pin them to a stale package
// even after the Centre re-imported. Best-effort: any failure yields null (demo/offline).
async function loadCentreSetupTestPackage(session) {
  try {
    const events = await supabase("exam_events?status=eq.current&select=payload,updated_at&order=updated_at.desc&limit=20");
    for (const event of events) {
      const testPackage = objectPayload(event?.payload).testPackage;
      if (testPackage && typeof testPackage === "object") return testPackage;
    }
    return null;
  } catch (error) {
    console.warn("Bootstrap could not load Centre setup test package", error?.message || error);
    return null;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const { sessionToken, token } = request.body ?? {};
    const rawSessionToken = sessionToken || token;
    if (!rawSessionToken) return sendJson(response, 400, { error: "Missing session token" });

    let session = null;

    if (!envReady()) {
      const demo = readDemoSessionToken(rawSessionToken);
      if (!demo || process.env.VETBARA_DEMO_MODE === "false") return sendJson(response, 401, { error: "Invalid demo session" });
      session = { role: demo.role, subjectId: demo.subjectId, id: null };
    } else {
      const rows = await supabase(`app_sessions?token_hash=eq.${hash(rawSessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
      const row = rows[0];
      if (!row || new Date(row.expires_at) <= new Date()) return sendJson(response, 401, { error: "Invalid or expired session" });
      session = { id: row.id, role: row.role, subjectId: row.subject_id };
    }

    const bootstrapPackage = buildBootstrapPackage(session);
    if (!bootstrapPackage) return sendJson(response, 404, { error: "Session subject not found" });

    // Attach the persisted Centre setup's test package so every role receives the imported
    // Admin.vet content (only when Supabase is configured; demo mode has no persistence).
    const testPackage = envReady() ? await loadCentreSetupTestPackage(session) : null;

    return sendJson(response, 200, {
      role: session.role,
      subjectId: session.subjectId,
      package: bootstrapPackage,
      centreSetup: testPackage ? { testPackage } : null,
    });
  } catch (error) {
    console.error("Session bootstrap failed", error);
    return sendJson(response, 500, { error: "Session bootstrap failed" });
  }
}
