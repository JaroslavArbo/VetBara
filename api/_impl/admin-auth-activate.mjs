import { envReady, sendJson, supabase } from "../_lib/backend.mjs";
import {
  auditAuth, createActivationToken, createAdminSession, findAdminProfile, hashPasswordWithSalt,
  newSalt, requestIp, resolveActivationToken, sha256, validateAdminPassword,
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
      return sendJson(response, 200, { ok: true, username: resolved.profile.username, role: resolved.profile.role });
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

      const salt = newSalt();
      await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          salt, password_hash: hashPasswordWithSalt(password, salt), password_set_at: new Date().toISOString(),
          status: "active", activated_at: new Date().toISOString(),
        }),
      });
      // Burn the link immediately - single use (§4.2).
      await supabase(`admin_activation_tokens?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      });

      const session = await createAdminSession(profile);
      await auditAuth({ ...audit, actorId: profile.username, action: "admin_password_created" });
      await auditAuth({ ...audit, actorId: profile.username, action: "admin_activation_completed" });

      return sendJson(response, 200, {
        ok: true, username: profile.username, role: profile.role,
        sessionToken: session.sessionToken, expiresAt: session.expiresAt,
        // §8: the account is usable now, but the spec's target state also needs a second factor.
        secondFactorRequired: true,
      });
    }

    return sendJson(response, 400, { error: "Unsupported action" });
  } catch (error) {
    console.error("Admin activation failed", error);
    return sendJson(response, 500, { error: "Admin activation failed" });
  }
}
