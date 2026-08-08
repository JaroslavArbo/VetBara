import crypto from "node:crypto";
import { auditAuth, requestIp } from "../_lib/adminauth.mjs";
import { verifyPin, hashPin, newPinSalt, normalisePin, pinLockState, nextStateAfterFailure, clearedPinState, PIN_GENERIC_ERROR } from "../_lib/pinsecurity.mjs";

// Called once, right after a Candidate/Examiner's FIRST device resolves their QR link (see
// promptSetPin in api/qr/resolve.js) - that device is already trusted; this just records the PIN
// any OTHER, later device will need to enter. Never blocks login on its own: if this fails (or is
// simply never called - a candidate who dismisses the dialog), the QR link keeps working exactly
// as it did before this feature existed, just without a PIN gate for a new device yet.

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

async function resolveSession(sessionToken) {
  if (!sessionToken || !envReady()) return null;
  const rows = await supabase(`app_sessions?token_hash=eq.${hash(sessionToken)}&revoked_at=is.null&select=id,role,subject_id,qr_token_id,expires_at&limit=1`);
  const session = rows[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { ok: true, stored: false });

  try {
    const { sessionToken, pin, action, subjectId } = request.body ?? {};
    const session = await resolveSession(sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });

    // VERIFY: the Centre asks whether a PIN matches the examiner who is self-identifying in
    // section E (that examiner is not the one holding this session, so it is checked by subject id).
    // An examiner who has never set a PIN yet reports hasPin:false, and the caller lets them
    // through - the PIN gate must never lock a real examiner out of correcting their own marks.
    if (action === "verify") {
      const wanted = String(subjectId ?? "").trim();
      if (!wanted) return sendJson(response, 400, { error: "subjectId is required" });
      if (session.role !== "Centre" && session.role !== "Examiner") return sendJson(response, 403, { error: "Not allowed to verify a PIN" });
      const rows = await supabase(`qr_tokens?role=eq.Examiner&subject_id=eq.${encodeURIComponent(wanted)}&revoked_at=is.null&select=id,pin_hash,pin_salt,pin_algo,pin_failed_attempts,pin_locked_until,pin_lockout_count,pin_permanently_locked_at&order=created_at.desc&limit=1`);
      const row = rows[0] || {};
      const pinHash = row.pin_hash ?? null;
      if (!pinHash) return sendJson(response, 200, { ok: true, hasPin: false, valid: true });
      const digits = String(pin ?? "").trim();
      // Same lockout rules as a new device (§13.1): this path verifies the very same PIN, so
      // leaving it uncounted would be an open side door for guessing.
      const lock = pinLockState(row);
      if (lock.locked) return sendJson(response, 200, { ok: true, hasPin: true, valid: false, locked: true, permanent: lock.permanent, error: PIN_GENERIC_ERROR });
      const check = verifyPin(digits, row);
      if (!check.ok) {
        await supabase(`qr_tokens?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(nextStateAfterFailure(row)),
        }).catch(() => {});
        return sendJson(response, 200, { ok: true, hasPin: true, valid: false, error: PIN_GENERIC_ERROR });
      }
      const patch = { ...clearedPinState() };
      if (check.needsUpgrade) {
        const salt = newPinSalt();
        patch.pin_salt = salt; patch.pin_hash = hashPin(digits, salt); patch.pin_algo = "scrypt";
      }
      await supabase(`qr_tokens?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
      }).catch(() => {});
      return sendJson(response, 200, { ok: true, hasPin: true, valid: true });
    }

    if (session.role !== "Candidate" && session.role !== "Examiner") return sendJson(response, 403, { error: "PIN is only used for Candidate/Examiner QR links" });
    if (!session.qr_token_id) return sendJson(response, 200, { ok: true, stored: false });

    const digits = String(pin ?? "").trim();
    if (!/^\d{3}$/.test(digits)) return sendJson(response, 400, { error: "PIN must be 3 digits" });

    // Only ever set once per token - a device that already knows the old PIN could otherwise
    // silently change it. Regenerating the QR link (a fresh token) is the intended way to reset it.
    const existing = await supabase(`qr_tokens?id=eq.${encodeURIComponent(session.qr_token_id)}&select=pin_hash&limit=1`);
    if (existing[0]?.pin_hash) return sendJson(response, 200, { ok: true, stored: false, alreadySet: true });
    auditAuth({ ip: requestIp(request), userAgent: request.headers?.["user-agent"], actorType: String(session.role || "").toLowerCase(), actorId: session.subject_id || session.subjectId, action: "pin_created" });

    await supabase(`qr_tokens?id=eq.${encodeURIComponent(session.qr_token_id)}`, {
      method: "PATCH",
      body: JSON.stringify((() => {
        const salt = newPinSalt();
        return { pin_hash: hashPin(digits, salt), pin_salt: salt, pin_algo: "scrypt", pin_created_at: new Date().toISOString(), ...clearedPinState() };
      })()),
    });

    return sendJson(response, 200, { ok: true, stored: true });
  } catch (error) {
    console.error("QR set-pin failed", error);
    // Fail-open in spirit: the PIN just doesn't get set this time, login itself is unaffected.
    return sendJson(response, 200, { ok: true, stored: false });
  }
}
