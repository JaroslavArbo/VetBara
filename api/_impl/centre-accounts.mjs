import crypto from "node:crypto";
import { envReady, sendJson, supabase, resolveAdminSession } from "../_lib/backend.mjs";
import {
  auditAuth, createAdminSession, requestIp, sha256, upsertAdminAuthUser, validateAdminPassword,
} from "../_lib/adminauth.mjs";

// Centre accounts (§10): an administrator invites a Centre, the Centre activates itself and lands in
// pending_approval, and an administrator then approves or rejects it. Nothing here touches the old
// shared Centre QR link, which keeps working until every Centre has been migrated (§22 phase 5).
//
// Credentials live in Supabase Auth, exactly like the administrator accounts, so turning on TOTP or
// a passkey for a Centre later (§10.3) needs no second credential system.

const INVITE_TTL_SECONDS = 60 * 60 * 24 * 7; // §10.1 - 7 days

function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

async function requireAdmin(request, response) {
  const session = await resolveAdminSession(request.body?.sessionToken);
  if (!session) {
    sendJson(response, 401, { error: "Admin session required" });
    return null;
  }
  return session;
}

// --- admin: create / list / revoke invitations --------------------------------------------------

async function createInvite(request, response, audit) {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const centreId = cleanText(request.body?.centreId, 80);
  const centreName = cleanText(request.body?.centreName, 160);
  const invitedEmail = cleanText(request.body?.invitedEmail, 160).toLowerCase();
  if (!centreId || !centreName || !invitedEmail) {
    return sendJson(response, 400, { error: "Centre id, name and contact e-mail are required" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitedEmail)) {
    return sendJson(response, 400, { error: "That contact e-mail does not look valid" });
  }

  // Only the hash is stored; the plaintext is returned once and cannot be recovered afterwards.
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString();

  // Supersede any earlier open invitation for the same Centre, so only the newest link works.
  await supabase(`centre_invites?centre_id=eq.${encodeURIComponent(centreId)}&accepted_at=is.null&revoked_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  }).catch(() => {});

  await supabase("centre_invites", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      centre_id: centreId, centre_name: centreName, invited_email: invitedEmail,
      country: cleanText(request.body?.country, 80) || null,
      internal_ref: cleanText(request.body?.internalRef, 80) || null,
      token_hash: sha256(token), expires_at: expiresAt, created_by: admin.subjectId,
    }),
  });

  await auditAuth({ ...audit, actorType: "admin", actorId: admin.subjectId, action: "centre_invite_created", targetType: "centre", targetId: centreId });
  return sendJson(response, 200, { ok: true, centreId, token, expiresAt });
}

async function listInvites(request, response) {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  const rows = await supabase("centre_invites?select=id,centre_id,centre_name,invited_email,country,expires_at,accepted_at,revoked_at,created_at&order=created_at.desc&limit=100");
  return sendJson(response, 200, { ok: true, invites: rows });
}

// --- centre: look at an invitation, then activate ------------------------------------------------

async function resolveInvite(token) {
  if (!token) return null;
  const rows = await supabase(`centre_invites?token_hash=eq.${sha256(token)}&accepted_at=is.null&revoked_at=is.null&select=*&limit=1`);
  const invite = rows[0];
  if (!invite || new Date(invite.expires_at) <= new Date()) return null;
  return invite;
}

async function inspectInvite(request, response) {
  const invite = await resolveInvite(request.body?.token);
  if (!invite) return sendJson(response, 401, { error: "This invitation is invalid, already used, or has expired" });
  return sendJson(response, 200, {
    ok: true, centreId: invite.centre_id, centreName: invite.centre_name,
    invitedEmail: invite.invited_email, country: invite.country, expiresAt: invite.expires_at,
  });
}

async function activateCentre(request, response, audit) {
  const invite = await resolveInvite(request.body?.token);
  if (!invite) {
    await auditAuth({ ...audit, actorType: "centre", action: "centre_activation_requested", result: "failure", metadata: { reason: "invalid_or_expired_invite" } });
    return sendJson(response, 401, { error: "This invitation is invalid, already used, or has expired" });
  }

  const email = cleanText(request.body?.email, 160).toLowerCase() || invite.invited_email;
  const username = cleanText(request.body?.username, 80) || email;
  const password = String(request.body?.password ?? "");
  if (password !== String(request.body?.passwordConfirm ?? "")) {
    return sendJson(response, 400, { error: "The two passwords do not match" });
  }
  // Centres are held to the same password rules as administrators (§10.2 "silné heslo").
  const policyError = validateAdminPassword(password, username);
  if (policyError) return sendJson(response, 400, { error: policyError });

  const authUserId = await upsertAdminAuthUser(email, password);

  // pending_approval, NOT active: an administrator still has to review it (§10.2).
  const existing = await supabase(`user_profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
  const payload = {
    username, role: "centre_admin", centre_id: invite.centre_id, status: "pending_approval",
    auth_user_id: authUserId, auth_email: email, password_set_at: new Date().toISOString(),
    salt: null, password_hash: null,
  };
  let profileId = existing[0]?.id ?? null;
  if (profileId) {
    await supabase(`user_profiles?id=eq.${encodeURIComponent(profileId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
  } else {
    const created = await supabase("user_profiles", { method: "POST", body: JSON.stringify(payload) });
    profileId = created?.[0]?.id ?? null;
  }

  await supabase(`centre_invites?id=eq.${encodeURIComponent(invite.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ accepted_at: new Date().toISOString() }),
  });
  await supabase("centre_approval_events", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ centre_id: invite.centre_id, user_profile_id: profileId, action: "requested", performed_by: username }),
  });
  await auditAuth({ ...audit, actorType: "centre", actorId: username, action: "centre_activation_requested", targetType: "centre", targetId: invite.centre_id });

  return sendJson(response, 200, { ok: true, centreId: invite.centre_id, username, status: "pending_approval" });
}

// --- admin: approve / reject / suspend -----------------------------------------------------------

const DECISIONS = {
  approve: { status: "active", action: "approved" },
  reject: { status: "disabled", action: "rejected" },
  suspend: { status: "suspended", action: "suspended" },
  reactivate: { status: "active", action: "reactivated" },
  "request-info": { status: null, action: "info_requested" },
};

async function decide(request, response, audit) {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const decision = DECISIONS[String(request.body?.decision || "").trim()];
  if (!decision) return sendJson(response, 400, { error: "Unknown decision" });

  const username = cleanText(request.body?.username, 80);
  const rows = await supabase(`user_profiles?username=eq.${encodeURIComponent(username)}&select=*&limit=1`);
  const profile = rows[0];
  if (!profile || !String(profile.role || "").startsWith("centre")) {
    return sendJson(response, 404, { error: "Unknown Centre account" });
  }

  if (decision.status) {
    const patch = { status: decision.status };
    if (decision.status === "active") patch.activated_at = new Date().toISOString();
    if (decision.status === "suspended") patch.suspended_at = new Date().toISOString();
    await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  }

  await supabase("centre_approval_events", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      centre_id: profile.centre_id, user_profile_id: profile.id, action: decision.action,
      performed_by: admin.subjectId, reason: cleanText(request.body?.reason, 500) || null,
    }),
  });
  await auditAuth({ ...audit, actorType: "admin", actorId: admin.subjectId, action: `centre_${decision.action}`, targetType: "centre", targetId: profile.centre_id });

  return sendJson(response, 200, { ok: true, username, centreId: profile.centre_id, status: decision.status || profile.status });
}

async function listPending(request, response) {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  const rows = await supabase("user_profiles?role=like.centre*&select=username,centre_id,auth_email,status,created_at,activated_at&order=created_at.desc&limit=200");
  return sendJson(response, 200, { ok: true, centres: rows });
}

// --- centre sign-in -------------------------------------------------------------------------------

// The password itself is checked by Supabase Auth in the browser; this exchanges the resulting
// access token for an ordinary Centre app_session, the same bridge the admin area uses. A Centre
// that has not been approved yet cannot get a session, whatever its password is.
async function centreSession(request, response, audit) {
  const { verifySupabaseAccessToken } = await import("../_lib/adminauth.mjs");
  const verified = await verifySupabaseAccessToken(request.body?.accessToken);
  if (!verified?.id) {
    await auditAuth({ ...audit, actorType: "centre", action: "centre_login_failed", result: "failure", metadata: { reason: "invalid_supabase_token" } });
    return sendJson(response, 401, { error: "Invalid session" });
  }
  const rows = await supabase(`user_profiles?auth_user_id=eq.${encodeURIComponent(verified.id)}&select=*&limit=1`);
  const profile = rows[0];
  if (!profile || !String(profile.role || "").startsWith("centre")) {
    await auditAuth({ ...audit, actorType: "centre", action: "centre_login_failed", result: "failure", metadata: { reason: "not_a_centre_account" } });
    return sendJson(response, 403, { error: "This account cannot sign in here" });
  }
  if (profile.status !== "active") {
    await auditAuth({ ...audit, actorType: "centre", actorId: profile.username, action: "centre_login_failed", result: "failure", metadata: { reason: `status_${profile.status}` } });
    return sendJson(response, 403, { error: "This Centre account is not approved yet", status: profile.status });
  }

  const session = await createAdminSession({ username: profile.centre_id || profile.username });
  await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_login_at: new Date().toISOString() }),
  }).catch(() => {});
  await auditAuth({ ...audit, actorType: "centre", actorId: profile.username, action: "centre_login_success", targetType: "centre", targetId: profile.centre_id });

  return sendJson(response, 200, {
    ok: true, username: profile.username, centreId: profile.centre_id,
    sessionToken: session.sessionToken, expiresAt: session.expiresAt,
  });
}

const ACTIONS = {
  "invite-create": createInvite,
  "invite-list": listInvites,
  "invite-inspect": inspectInvite,
  activate: activateCentre,
  decide,
  list: listPending,
  session: centreSession,
};

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Centre accounts require the backend to be configured" });
  const audit = { ip: requestIp(request), userAgent: request.headers?.["user-agent"] };
  const fn = ACTIONS[String(request.body?.action || "").trim()];
  if (!fn) return sendJson(response, 400, { error: "Unsupported action" });
  try {
    return await fn(request, response, audit);
  } catch (error) {
    console.error("Centre accounts action failed", error);
    return sendJson(response, 500, { error: "Centre account action failed" });
  }
}
