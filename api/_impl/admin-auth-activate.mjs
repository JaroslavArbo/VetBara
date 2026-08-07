import { envReady, sendJson, supabase } from "../_lib/backend.mjs";
import {
  adminEmailForUsername, auditAuth, createActivationToken, findAdminProfile, requestIp,
  resolveActivationToken, upsertAdminAuthUser, validateAdminPassword,
} from "../_lib/adminauth.mjs";

// Admin activation (§4.2). Three actions on one route:
//
//   action:"inspect"  - is this activation link still valid? (returns the username only)
//   action:"complete" - set the account's own strong password, activate it, open a session
//   action:"mint"     - SERVICE PROCEDURE: create a fresh activation link. Requires the
//                       VETBARA_SEED_SECRET header, never reachable from the public UI (§4.2, §20).
//
// The activation token is single-use, hashed at rest, expiring, and bound to one account.

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Admin auth requires the backend to be configured" });

  const body = request.body ?? {};
  const action = String(body.action || "").trim();
  const audit = { actorType: "admin", ip: requestIp(request), userAgent: request.headers?.["user-agent"] };

  try {
    // --- service procedure: mint a new activation link -------------------------------------
    if (action === "mint") {
      const secret = request.headers?.["x-seed-secret"];
      if (!process.env.VETBARA_SEED_SECRET || secret !== process.env.VETBARA_SEED_SECRET) {
        await auditAuth({ ...audit, action: "admin_activation_failed", result: "failure", metadata: { reason: "bad_service_secret" } });
        return sendJson(response, 401, { error: "Not authorised" });
      }
      const profile = await findAdminProfile(body.username);
      if (!profile) return sendJson(response, 404, { error: "Unknown admin account" });
      // Re-activation (§20): an account being re-issued a link goes back to pending_activation and
      // loses its old credentials, so the previous password stops working immediately.
      await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "pending_activation", password_hash: null, salt: null }),
      });
      // Any earlier unused link for this account is invalidated, so only the newest one works.
      await supabase(`admin_activation_tokens?user_profile_id=eq.${encodeURIComponent(profile.id)}&used_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      }).catch(() => {});
      const { token, expiresAt } = await createActivationToken(profile.id, String(body.createdBy || "service"));
      await auditAuth({ ...audit, actorId: profile.username, action: "admin_activation_started", targetType: "user_profile", targetId: profile.username });
      return sendJson(response, 200, { ok: true, username: profile.username, token, expiresAt });
    }

    // --- is this link still usable? ---------------------------------------------------------
    if (action === "inspect") {
      const resolved = await resolveActivationToken(body.token);
      if (!resolved) return sendJson(response, 401, { error: "This activation link is invalid or has expired" });
      return sendJson(response, 200, {
        ok: true, username: resolved.profile.username, role: resolved.profile.role,
        email: resolved.profile.auth_email || adminEmailForUsername(resolved.profile.username),
      });
    }

    // --- complete activation ---------------------------------------------------------------
    if (action === "complete") {
      const resolved = await resolveActivationToken(body.token);
      if (!resolved) {
        await auditAuth({ ...audit, action: "admin_activation_failed", result: "failure", metadata: { reason: "invalid_or_expired_token" } });
        return sendJson(response, 401, { error: "This activation link is invalid or has expired" });
      }
      const { row, profile } = resolved;
      const password = String(body.password ?? "");
      if (password !== String(body.passwordConfirm ?? "")) return sendJson(response, 400, { error: "The two passwords do not match" });
      const policyError = validateAdminPassword(password, profile.username);
      if (policyError) return sendJson(response, 400, { error: policyError });

      // The password now lives in Supabase Auth, not in our own table - Supabase owns admin
      // credentials and the MFA factors built on top of them.
      const email = profile.auth_email || adminEmailForUsername(profile.username);
      const authUserId = await upsertAdminAuthUser(email, password);

      await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          auth_user_id: authUserId, auth_email: email, password_set_at: new Date().toISOString(),
          // Deliberately NOT active yet, and no legacy hash kept: §8 says an account may not be
          // activated on a password alone. It becomes active at /api/admin/auth/session, once a
          // second factor has actually been verified.
          salt: null, password_hash: null,
        }),
      });
      // Burn the link immediately - single use (§4.2).
      await supabase(`admin_activation_tokens?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      });

      await auditAuth({ ...audit, actorId: profile.username, action: "admin_password_created" });

      return sendJson(response, 200, {
        ok: true, username: profile.username, role: profile.role, email,
        // The client now signs in to Supabase with this password and enrols a second factor; only
        // then is an admin session issued.
        nextStep: "enroll-second-factor",
      });
    }

    return sendJson(response, 400, { error: "Unsupported action" });
  } catch (error) {
    console.error("Admin activation failed", error);
    return sendJson(response, 500, { error: "Admin activation failed" });
  }
}
