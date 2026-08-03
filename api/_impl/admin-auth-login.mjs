import { envReady, sendJson, supabase } from "../_lib/backend.mjs";
import { auditAuth, createAdminSession, findAdminProfile, passwordMatches, requestIp } from "../_lib/adminauth.mjs";

// Admin login against a NAMED identity in user_profiles (Admin_Bara / Admin_Jarek).
//
// §2.2: there is deliberately no bootstrap and no default password here any more. An account that
// has not been activated has no credential material at all and cannot be signed into - the only way
// in is a one-time activation link (see admin-auth-activate.mjs).

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Admin auth requires the backend to be configured" });

  const { username, password } = request.body ?? {};
  if (!username || !password) return sendJson(response, 400, { error: "Missing username or password" });

  const audit = { actorType: "admin", actorId: String(username).slice(0, 64), ip: requestIp(request), userAgent: request.headers?.["user-agent"] };

  try {
    const profile = await findAdminProfile(username);

    // One generic message for every failure reason, so the response never reveals whether an
    // account exists, is pending activation or is suspended.
    const reject = async (reason) => {
      await auditAuth({ ...audit, action: "admin_login_password_failed", result: "failure", metadata: { reason } });
      return sendJson(response, 401, { error: "Invalid credentials" });
    };

    if (!profile) return reject("unknown_username");
    if (profile.status === "pending_activation") return reject("pending_activation");
    if (profile.status !== "active") return reject(`status_${profile.status}`);
    if (!profile.password_hash || !profile.salt) return reject("no_credentials");
    if (!passwordMatches(password, profile.salt, profile.password_hash)) return reject("bad_password");

    const session = await createAdminSession(profile);
    await supabase(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_login_at: new Date().toISOString() }),
    }).catch(() => {});
    await auditAuth({ ...audit, action: "admin_login_password_success" });

    // NOTE (§3, §8): the second factor (TOTP / passkey) is phase 2-3 of the overhaul. Until it lands
    // the response reports that no second factor is enrolled, so the client can surface that.
    return sendJson(response, 200, {
      ok: true,
      username: profile.username,
      role: profile.role,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      secondFactor: { enrolled: false, required: false },
    });
  } catch (error) {
    console.error("Admin login failed", error);
    return sendJson(response, 500, { error: "Admin login failed" });
  }
}
