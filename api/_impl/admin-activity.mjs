import { envReady, sendJson, supabase, resolveAdminSession } from "../_lib/backend.mjs";

// Administrator's overview of what Centres are doing (read-only).
//
// Deliberately NOT the Centre's full audit trail. An administrator supervising several
// certifications wants the shape of the day - a Centre opened, the exam actually started, people
// confirmed their identity, results were submitted, and anything that was refused - not every
// section open, voice recording or reconnect. Two sources are merged:
//
//   sync_events (audit.logged) - what people did on their devices
//   auth_audit_log             - what the auth layer decided (sign-ins, PIN lockouts, approvals)
//
// The allow-lists below are the whole point: everything else is noise at this altitude.

const MAIN_MOMENTS = new Set([
  "Centre workspace opened",
  "Centre workspace closed",
  "Exam started",
  "Exam start withdrawn",
  "Candidate identity confirmed",
  "Examiner identity confirmed",
  "Outdoor assessment submitted",
  "Candidate data sent to server",
  "Scanned test graded",
  "Offline candidate package imported",
  "Exam event opened",
]);

// Moments that mean something was refused or looks irregular - these are what an administrator
// most needs to see, so they are kept even though they are "negative" events.
const ALERT_MOMENTS = new Set([
  "Simultaneous device use detected",
  "Centre access failed",
  "QR resolve failed",
  "QR role blocked",
  "Candidate reopen request denied",
  "Backend unavailable",
]);

const AUTH_MOMENTS = {
  centre_login_success: { label: "Centre signed in", alert: false },
  centre_login_failed: { label: "Centre sign-in refused", alert: true },
  centre_activation_requested: { label: "Centre requested activation", alert: false },
  centre_approved: { label: "Centre approved", alert: false },
  centre_rejected: { label: "Centre rejected", alert: true },
  centre_suspended: { label: "Centre suspended", alert: true },
  centre_reactivated: { label: "Centre reactivated", alert: false },
  centre_invite_created: { label: "Centre invited", alert: false },
  admin_login_password_success: { label: "Administrator signed in", alert: false },
  admin_login_password_failed: { label: "Administrator sign-in refused", alert: true },
  admin_login_totp_failed: { label: "Administrator second factor refused", alert: true },
  admin_activation_completed: { label: "Administrator account activated", alert: false },
  pin_temporarily_locked: { label: "PIN temporarily locked", alert: true },
  pin_permanently_locked: { label: "PIN locked - needs unlocking", alert: true },
  qr_device_limit_reached: { label: "Device limit reached", alert: true },
  pin_reset: { label: "PIN reset", alert: false },
};

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { ok: true, entries: [] });

  try {
    if (!(await resolveAdminSession(request.body?.sessionToken))) {
      return sendJson(response, 401, { error: "Admin session required" });
    }

    const [auditRows, authRows] = await Promise.all([
      supabase("sync_events?event_type=eq.audit.logged&select=id,role,subject_id,candidate_id,payload,created_at&order=created_at.desc&limit=600").catch(() => []),
      supabase(`auth_audit_log?action=in.(${Object.keys(AUTH_MOMENTS).map(encodeURIComponent).join(",")})&select=id,actor_type,actor_id,action,result,target_id,created_at&order=created_at.desc&limit=300`).catch(() => []),
    ]);

    const fromDevices = auditRows
      .filter((row) => {
        const action = row.payload?.action;
        return MAIN_MOMENTS.has(action) || ALERT_MOMENTS.has(action);
      })
      .map((row) => ({
        id: `act-${row.id}`,
        action: row.payload?.action,
        who: row.payload?.target || row.subject_id || row.candidate_id || "-",
        role: row.payload?.actorRole || row.role || "",
        centreId: row.role === "Centre" ? row.subject_id : null,
        detail: row.payload?.detail || "",
        alert: ALERT_MOMENTS.has(row.payload?.action) || row.payload?.alert === true,
        createdAt: row.created_at,
      }));

    const fromAuth = authRows.map((row) => {
      const moment = AUTH_MOMENTS[row.action] || { label: row.action, alert: false };
      return {
        id: `auth-${row.id}`,
        action: moment.label,
        who: row.actor_id || row.target_id || "-",
        role: row.actor_type === "centre" ? "Centre" : row.actor_type === "admin" ? "Admin" : row.actor_type,
        centreId: row.target_id || null,
        detail: row.result === "failure" ? "refused" : "",
        alert: moment.alert || row.result === "failure",
        createdAt: row.created_at,
      };
    });

    const entries = [...fromDevices, ...fromAuth]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 300);

    return sendJson(response, 200, { ok: true, entries });
  } catch (error) {
    console.error("Admin activity read failed", error);
    return sendJson(response, 500, { error: "Admin activity read failed" });
  }
}
