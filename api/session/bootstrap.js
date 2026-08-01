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

// The hardcoded CANDIDATES/EXAMINERS constants only ever covered the original 4-candidate/
// 3-examiner demo roster. A real certification's 5th+ candidate or 4th+ examiner is invisible to
// them, so candidateBootstrap/examinerBootstrap returned null and the handler 404'd with "Session
// subject not found" BEFORE ever looking at the real roster — a 4th examiner (or 5th candidate)
// could never log in at all, no matter how correct the rest of the roster/session plumbing was.
// This mirrors the same shape from the real roster (centreSetup, already loaded for every
// session) so the client needs no changes.
function assignmentRoleFor(centreSetup, candidateId, examinerId) {
  const row = (centreSetup.assignments || []).find((a) => a.candidateId === candidateId && a.examinerId === examinerId);
  return row?.role ?? null;
}

function buildBootstrapPackageFromRoster(session, centreSetup) {
  if (session.role === "Candidate") {
    const candidate = (centreSetup.candidates || []).find((item) => item.id === session.subjectId);
    if (!candidate) return null;
    return {
      candidate: { id: candidate.id, name: candidate.name, birthDate: candidate.birthDate || "", documentId: candidate.documentId || "", level: candidate.level || "Practicing", status: "Ready" },
      sections: sectionsFor(candidate.level || "Practicing"),
      allowedPortal: "Candidate",
      sessionId: session.id ?? null,
    };
  }
  if (session.role === "Examiner") {
    const examiner = (centreSetup.examiners || []).find((item) => item.id === session.subjectId);
    if (!examiner) return null;
    const assignedCandidates = (centreSetup.candidates || []).flatMap((candidate) => {
      const assignmentRole = assignmentRoleFor(centreSetup, candidate.id, examiner.id);
      return assignmentRole ? [{ ...candidate, assignmentRole }] : [];
    });
    return {
      examiner: { id: examiner.id, name: examiner.name, birthDate: examiner.birthDate || "", registrationId: examiner.registrationId || "" },
      assignedCandidates,
      allowedPortal: "Examiner",
      sessionId: session.id ?? null,
    };
  }
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
// SCOPING MATTERS: several certifications (exam events) can exist at once — e.g. the same venue
// on two different days, each with its own Centre link and roster. The roster attached to a
// bootstrap must come from the SESSION'S OWN exam event; serving "the newest current event"
// globally leaked one certification's candidates into the other Centre, whose autosave then
// PERSISTED the copied roster ("the same participants appeared in both certifications").
// Resolution order:
//   1. Centre session → its subject id IS the centre id → that centre's current event only
//      (a fresh certification with no event yet gets NO roster, never another cert's).
//   2. Candidate/Examiner session → the qr_token label ends with the exam event id
//      (`${role} ${subjectId} ${examEventId}` — written by ensureQrAccess), or, failing that,
//      their newest roster row's exam_event_id.
//   3. Legacy fallback for non-Centre roles only (demo/seeded tokens with no roster rows):
//      the most recently updated current event that carries a test package.
// Best-effort: any failure yields null (demo/offline).
async function loadCentreSetupForBootstrap(session) {
  try {
    let event = null;

    if (session?.role === "Centre") {
      const rows = await supabase(`exam_events?centre_id=eq.${encodeURIComponent(session.subjectId)}&status=eq.current&select=id,payload,updated_at&order=updated_at.desc&limit=1`);
      event = rows[0] ?? null;
      if (!event) return null;
    }

    if (!event && session?.qrTokenId) {
      const tokenRows = await supabase(`qr_tokens?id=eq.${encodeURIComponent(session.qrTokenId)}&select=label&limit=1`);
      const label = String(tokenRows[0]?.label || "");
      const eventId = label.split(/\s+/).pop();
      if (eventId && eventId.startsWith("EXAM-")) {
        const rows = await supabase(`exam_events?id=eq.${encodeURIComponent(eventId)}&select=id,payload,updated_at&limit=1`);
        event = rows[0] ?? null;
      }
    }

    if (!event && (session?.role === "Candidate" || session?.role === "Examiner")) {
      const table = session.role === "Candidate" ? "candidates" : "examiners";
      const rows = await supabase(`${table}?id=eq.${encodeURIComponent(session.subjectId)}&select=exam_event_id,updated_at&order=updated_at.desc&limit=1`);
      const eventId = rows[0]?.exam_event_id;
      if (eventId) {
        const eventRows = await supabase(`exam_events?id=eq.${encodeURIComponent(eventId)}&select=id,payload,updated_at&limit=1`);
        event = eventRows[0] ?? null;
      }
    }

    if (!event) {
      const events = await supabase("exam_events?status=eq.current&select=id,payload,updated_at&order=updated_at.desc&limit=20");
      event = events.find((e) => objectPayload(e?.payload).testPackage) || events[0];
    }
    if (!event) return null;
    const examEventId = event.id;
    const testPackage = objectPayload(event.payload).testPackage ?? null;
    const harmonogramSettings = objectPayload(event.payload).harmonogramSettings ?? null;
    const [candidateRows, examinerRows, assignmentRows] = await Promise.all([
      supabase(`candidates?exam_event_id=eq.${encodeURIComponent(examEventId)}&select=id,name,level,payload&order=id.asc`),
      supabase(`examiners?exam_event_id=eq.${encodeURIComponent(examEventId)}&select=id,name,payload&order=id.asc`),
      supabase(`examiner_assignments?exam_event_id=eq.${encodeURIComponent(examEventId)}&select=candidate_id,examiner_id,role&order=candidate_id.asc`),
    ]);
    const candidates = candidateRows.map((row) => {
      const p = objectPayload(row.payload);
      return { id: row.id, name: row.name || p.name || row.id, level: row.level || p.level || "Practicing", birthDate: p.birthDate || "", documentId: p.documentId || "", email: p.email || "" };
    });
    const examiners = examinerRows.map((row) => {
      const p = objectPayload(row.payload);
      return { id: row.id, name: row.name || p.name || row.id, registrationId: p.registrationId || p.registration_id || "", email: p.email || "" };
    });
    const assignments = assignmentRows.map((row) => ({ candidateId: row.candidate_id, examinerId: row.examiner_id, role: row.role }));
    // The client scopes its per-exam browser caches by this id, so results from one certification
    // never surface in another opened in the same browser.
    return { examEventId, testPackage, harmonogramSettings, candidates, examiners, assignments };
  } catch (error) {
    console.warn("Bootstrap could not load Centre setup", error?.message || error);
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
      const rows = await supabase(`app_sessions?token_hash=eq.${hash(rawSessionToken)}&revoked_at=is.null&select=id,role,subject_id,qr_token_id,expires_at&limit=1`);
      const row = rows[0];
      if (!row || new Date(row.expires_at) <= new Date()) return sendJson(response, 401, { error: "Invalid or expired session" });
      session = { id: row.id, role: row.role, subjectId: row.subject_id, qrTokenId: row.qr_token_id ?? null };
    }

    // Attach the persisted Centre setup (test package + real candidate/examiner roster) so every
    // role receives the imported Admin.vet content AND the real names/emails — not the demo
    // roster. Only when Supabase is configured; demo mode has no persistence. Loaded BEFORE the
    // subject-found gate below so a roster member beyond the hardcoded demo constants (5th+
    // candidate, 4th+ examiner) can still be found via the real roster fallback.
    const centreSetup = envReady() ? await loadCentreSetupForBootstrap(session) : null;
    const hasCentreSetup = centreSetup && (centreSetup.testPackage || centreSetup.candidates?.length || centreSetup.examiners?.length);

    let bootstrapPackage = buildBootstrapPackage(session);
    if (!bootstrapPackage && centreSetup) bootstrapPackage = buildBootstrapPackageFromRoster(session, centreSetup);
    if (!bootstrapPackage) return sendJson(response, 404, { error: "Session subject not found" });

    return sendJson(response, 200, {
      role: session.role,
      subjectId: session.subjectId,
      package: bootstrapPackage,
      centreSetup: hasCentreSetup ? centreSetup : null,
    });
  } catch (error) {
    console.error("Session bootstrap failed", error);
    return sendJson(response, 500, { error: "Session bootstrap failed" });
  }
}
