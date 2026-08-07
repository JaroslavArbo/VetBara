import { envReady, sendJson, supabase } from "../_lib/backend.mjs";
import {
  auditAuth, createAdminSession, listAdminAuthFactors, requestIp, verifySupabaseAccessToken,
} from "../_lib/adminauth.mjs";

// Exchanges a Supabase Auth session for this app's Admin session.
//
// This is the ONLY place an Admin session is minted now, and it is where §8 is enforced: the
// Supabase token must have reached AAL2, i.e. a second factor (TOTP today, passkey next) has
// actually been satisfied. A password alone can never produce an admin session.
//
// Reaching AAL2 also completes activation: an account that was pending_activation flips to active
// here, because that is the first moment we know it has a working second factor.

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Admin auth requires the backend to be configured" });

  const accessToken = request.body?.accessToken;
  const audit = { actorType: "admin", ip: requestIp(request), userAgent: request.headers?.["user-agent"] };

  try {
    const authUser = await verifySupabaseAccessToken(accessToken);
    if (!authUser?.id) {
      await auditAuth({ ...audit, action: "admin_login_password_failed", result: "failure", metadata: { reason: "invalid_supabase_token" } });
      return sendJson(response, 401, { error: "Invalid session" });
    }

    // Match the Supabase identity to one of our admin profiles.
    const email = String(authUser.email || "").toLowerCase();
    const rows = await supabase(`user_profiles?select=*&or=(auth_user_id.eq.${encodeURIComponent(authUser.id)},username.eq.${encodeURIComponent(email.split("@")[0])})&limit=1`);
    const profile = rows[0];
    if (!profile) {
      await auditAuth({ ...audit, actorId: email, action: "admin_login_password_failed", result: "failure", metadata: { reason: "no_admin_profile" } });
      return sendJson(response, 403, { error: "This account is not an administrator" });
    }
    if (profile.status === "suspended" || profile.status === "disabled") {
      await auditAuth({ ...audit, actorId: profile.username, action: "admin_login_password_failed", result: "failure", metadata: { reason: `status_${profile.status}` } });
      return sendJson(response, 403, { error: "This account is not active" });
    }

    // §8 - no admin session without a verified second factor.
    if (authUser.aal !== "aal2") {
      const factors = await listAdminAuthFactors(authUser.id);
      await auditAuth({ ...audit, actorId: profile.username, action: "admin_login_totp_failed", result: "failure", metadata: { reason: "aal1_only" } });
      return sendJson(response, 403, {
        error: "A second factor is required",
        secondFactorRequired: true,
        // Tells the client whether to run a TOTP challenge or first-time enrolment.
        hasVerifiedFactor: factors.length > 0,
      });
    }

    const patch = { auth_user_id: authUser.id, last_login_at: new Date().toISOString() };
    const activating = profile.status === "pending_activation";
    if (activating) {
      patch.status = "active";
      patch.activated_at = new Date().toISOString();
    }
    await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
    });

    const session = await createAdminSession(profile);
    await auditAuth({ ...audit, actorId: profile.username, action: "admin_login_totp_success" });
    if (activating) await auditAuth({ ...audit, actorId: profile.username, action: "admin_activation_completed" });

    return sendJson(response, 200, {
      ok: true,
      username: profile.username,
      role: profile.role,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      activated: activating,
    });
  } catch (error) {
    console.error("Admin session exchange failed", error);
    return sendJson(response, 500, { error: "Admin sign-in failed" });
  }
}
