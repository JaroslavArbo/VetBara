import crypto from "node:crypto";

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

function encode(value) {
  return encodeURIComponent(value);
}

async function resolveSession(sessionToken) {
  if (!sessionToken) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return { id: session.id, role: session.role, subjectId: session.subject_id };
}

async function loadCurrentExamEvent(centreId) {
  const rows = await supabase(`exam_events?centre_id=eq.${encode(centreId)}&status=eq.current&select=id&limit=1`);
  return rows[0] ?? null;
}

function idInQuery(ids) {
  return ids.map((id) => encode(id)).join(",");
}

const AUDIT_COLUMNS = "id,event_type,role,subject_id,candidate_id,payload,created_at";

// The persistent, exam-wide activity log (see AUDIT_EVENT_TYPE in api/sync/batch.js): every
// addAudit() call on any device also fires an "audit.logged" sync event, so this survives a page
// reload and reads the same from any Centre device. Three separately-scoped reads, unioned:
//  - the Centre's own actions (workspace open/close, package import, corrections, identify) -
//    scoped by its own subject id directly, no roster/event-id matching needed at all.
//  - this roster's examiners' own actions (login, outdoor recording, identify) - scoped by
//    subject_id IN (this centre's examiner ids), never a blanket "all examiners" read.
//  - this roster's candidates' own actions (login, section open/close) - same idea.
// Scoping candidate/examiner reads by roster MEMBERSHIP rather than by matching exam_event_id
// exactly avoids the same event-id drift that can otherwise make report data look emptied out
// (see evaluation-candidate.mjs's candidateOwnExamEventIds).

// Security events (logins, PIN lockouts, device registrations, approval decisions) live in
// auth_audit_log, not in sync_events, because they are recorded server-side by the auth layer
// rather than by an addAudit() call on somebody's device. The Centre needs them in the SAME trail:
// "who got in, from what, and when it was refused" is exactly what an invigilator is asked about
// afterwards. Only rows belonging to this Centre or to its own roster are read.
const CENTRE_SECURITY_ACTIONS = [
  "centre_login_success", "centre_login_failed",
  "pin_created", "pin_verification_failed", "pin_temporarily_locked", "pin_permanently_locked", "pin_reset",
  "qr_device_registered", "qr_device_limit_reached", "qr_device_revoked", "qr_all_devices_revoked",
  "centre_approved", "centre_rejected", "centre_suspended", "centre_reactivated",
];

// Wording for the Centre's trail. Deliberately plain: this is read by an examination coordinator,
// not by an engineer.
const SECURITY_LABELS = {
  centre_login_success: "Centre signed in",
  centre_login_failed: "Centre sign-in refused",
  pin_created: "PIN created",
  pin_verification_failed: "Wrong PIN entered",
  pin_temporarily_locked: "PIN temporarily locked",
  pin_permanently_locked: "PIN locked - needs unlocking",
  pin_reset: "PIN reset",
  qr_device_registered: "New device registered",
  qr_device_limit_reached: "Device limit reached",
  qr_device_revoked: "Device revoked",
  qr_all_devices_revoked: "All devices revoked",
  centre_approved: "Centre approved",
  centre_rejected: "Centre rejected",
  centre_suspended: "Centre suspended",
  centre_reactivated: "Centre reactivated",
};

// Anything that means "somebody was refused" is flagged so it surfaces under the Centre's
// existing "alerts only" filter.
const SECURITY_ALERTS = new Set([
  "centre_login_failed", "pin_verification_failed", "pin_temporarily_locked",
  "pin_permanently_locked", "qr_device_limit_reached", "centre_rejected", "centre_suspended",
]);

async function readSecurityEvents(centreId, subjectIds) {
  const actions = CENTRE_SECURITY_ACTIONS.map((a) => encode(a)).join(",");
  // NOTE the dotted syntax: inside PostgREST's or=(...) a condition is written
  // field.operator.value, NOT the top-level field=operator.value. Getting that wrong makes the
  // whole filter invalid, and the previous .catch() swallowed the error so the trail silently
  // showed no security events at all.
  const scopes = [`target_id.eq.${encode(centreId)}`, `actor_id.eq.${encode(centreId)}`];
  if (subjectIds.length) scopes.push(`actor_id.in.(${idInQuery(subjectIds)})`, `target_id.in.(${idInQuery(subjectIds)})`);
  const rows = await supabase(
    `auth_audit_log?action=in.(${actions})&or=(${scopes.join(",")})&select=id,actor_type,actor_id,action,result,target_id,created_at&order=created_at.desc&limit=300`
  ).catch((error) => { console.warn("Centre security-event read failed", error?.message || error); return []; });
  return rows.map((row) => ({
    id: `sec-${row.id}`,
    action: SECURITY_LABELS[row.action] || row.action,
    target: row.actor_id || row.target_id || "-",
    detail: row.result === "failure" ? "refused" : "",
    actorRole: row.actor_type === "centre" ? "Centre" : row.actor_type === "admin" ? "Admin" : row.actor_type,
    alert: SECURITY_ALERTS.has(row.action) || row.result === "failure",
    time: "",
    createdAt: row.created_at,
  }));
}

async function readAuditEvents(centreId, candidateIds, examinerIds) {
  const queries = [
    supabase(`sync_events?subject_id=eq.${encode(centreId)}&role=eq.Centre&event_type=eq.audit.logged&select=${AUDIT_COLUMNS}&order=created_at.desc&limit=500`),
  ];
  if (candidateIds.length) {
    queries.push(supabase(`sync_events?subject_id=in.(${idInQuery(candidateIds)})&role=eq.Candidate&event_type=eq.audit.logged&select=${AUDIT_COLUMNS}&order=created_at.desc&limit=500`));
  }
  if (examinerIds.length) {
    queries.push(supabase(`sync_events?subject_id=in.(${idInQuery(examinerIds)})&role=eq.Examiner&event_type=eq.audit.logged&select=${AUDIT_COLUMNS}&order=created_at.desc&limit=500`));
  }
  const results = await Promise.all(queries);
  const byId = new Map();
  for (const rows of results) {
    for (const row of rows) byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { ok: true, entries: [] });

  try {
    const { sessionToken } = request.body ?? {};
    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    if (session.role !== "Centre") return sendJson(response, 403, { error: "Centre audit trail is not available for this session" });

    const centreId = session.subjectId;
    const examEvent = await loadCurrentExamEvent(centreId);
    const examEventId = examEvent?.id ?? "";

    const [candidates, examiners] = examEvent
      ? await Promise.all([
          supabase(`candidates?centre_id=eq.${encode(centreId)}&exam_event_id=eq.${encode(examEventId)}&select=id`),
          supabase(`examiners?centre_id=eq.${encode(centreId)}&exam_event_id=eq.${encode(examEventId)}&select=id`),
        ])
      : [[], []];

    const candidateIds = candidates.map((c) => c.id);
    const examinerIds = examiners.map((e) => e.id);
    const rows = await readAuditEvents(centreId, candidateIds, examinerIds);
    const entries = rows.map((row) => ({
      // Prefer the client-generated id (payload.localId): the Centre that originated an entry
      // already shows it instantly via its own local addAudit() call, and matching ids is how
      // mergeRemoteAudit recognises "already have this one" instead of showing it twice once this
      // read model catches up. Entries from other roles get the same treatment for free.
      id: row.payload?.localId || row.id,
      action: row.payload?.action ?? row.event_type,
      target: row.payload?.target ?? row.candidate_id ?? row.subject_id,
      detail: row.payload?.detail ?? "",
      actorRole: row.payload?.actorRole ?? row.role,
      alert: row.payload?.alert === true,
      time: row.payload?.time ?? "",
      createdAt: row.created_at,
    }));

    // Security events are merged into the same list, newest first, so the Centre has ONE trail
    // rather than two places to look.
    const security = await readSecurityEvents(centreId, [...candidateIds, ...examinerIds]);
    const merged = [...entries, ...security].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return sendJson(response, 200, { ok: true, entries: merged });
  } catch (error) {
    console.error("Centre audit read failed", error);
    return sendJson(response, 500, { error: "Centre audit read failed" });
  }
}
