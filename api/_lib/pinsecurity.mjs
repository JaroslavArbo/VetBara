import crypto from "node:crypto";

// Three-digit QR PIN: storage and brute-force protection (§13, §14).
//
// The PIN is NOT authentication by itself - 1000 combinations - it confirms the holder of an
// already-valid QR token when opening it on a further device. That is exactly why it needs both a
// slow salted hash (so a database leak cannot enumerate all 1000 offline) and a hard online attempt
// limit.

// §11.2 - exactly three digits, kept as a STRING so leading zeros ("007") survive.
export function normalisePin(value) {
  const digits = String(value ?? "").trim();
  return /^\d{3}$/.test(digits) ? digits : null;
}

// A server-side pepper means a leaked database alone is not enough to test candidate PINs; the
// attacker also needs the application environment. Falls back to the session secret so an existing
// deployment keeps working, but a dedicated VETBARA_PIN_PEPPER is preferred.
function pepper() {
  return process.env.VETBARA_PIN_PEPPER || process.env.VETBARA_SESSION_SECRET || "vetbara-pin-pepper";
}

export function newPinSalt() {
  return crypto.randomBytes(16).toString("hex");
}

// scrypt with an explicit cost - §14 allows the platform's existing strong password hashing rather
// than mandating Argon2id, and scrypt is memory-hard and built into Node (no new dependency in a
// serverless bundle).
export function hashPin(pin, salt) {
  return crypto.scryptSync(`${pepper()}:${pin}`, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
}

function legacySha256(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Verifies against whichever scheme the row was written with. A legacy SHA-256 row that verifies is
// reported as needing an upgrade, so the caller can silently re-hash it with salt+scrypt - existing
// candidates never have to reset a working PIN just because the scheme improved.
export function verifyPin(pin, row) {
  const stored = row?.pin_hash;
  if (!stored) return { ok: false, needsUpgrade: false };
  if (row.pin_algo === "scrypt" && row.pin_salt) {
    return { ok: timingSafeEqualHex(hashPin(pin, row.pin_salt), stored), needsUpgrade: false };
  }
  const ok = timingSafeEqualHex(legacySha256(pin), stored);
  return { ok, needsUpgrade: ok };
}

// §13.1 - 5 wrong attempts per cycle, then 15 min, then 60 min, then only a human can clear it.
export const PIN_MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = [15, 60];

export function pinLockState(row, now = new Date()) {
  if (row?.pin_permanently_locked_at) return { locked: true, permanent: true, until: null };
  const until = row?.pin_locked_until ? new Date(row.pin_locked_until) : null;
  if (until && until > now) return { locked: true, permanent: false, until };
  return { locked: false, permanent: false, until: null };
}

// Works out the row patch for one wrong PIN, without writing it - keeps the escalation rules
// testable in isolation from the database.
export function nextStateAfterFailure(row, now = new Date()) {
  const attempts = Number(row?.pin_failed_attempts || 0) + 1;
  if (attempts < PIN_MAX_ATTEMPTS) return { pin_failed_attempts: attempts };
  const lockoutCount = Number(row?.pin_lockout_count || 0);
  if (lockoutCount >= LOCKOUT_MINUTES.length) {
    return {
      pin_failed_attempts: 0,
      pin_lockout_count: lockoutCount + 1,
      pin_permanently_locked_at: now.toISOString(),
      pin_locked_until: null,
    };
  }
  return {
    pin_failed_attempts: 0,
    pin_lockout_count: lockoutCount + 1,
    pin_locked_until: new Date(now.getTime() + LOCKOUT_MINUTES[lockoutCount] * 60000).toISOString(),
  };
}

export function clearedPinState() {
  return { pin_failed_attempts: 0, pin_locked_until: null, pin_lockout_count: 0, pin_permanently_locked_at: null };
}

// §13.4 - one message for every failure mode. It must not reveal whether the QR token exists,
// whether a PIN has been set, how close the guess was, or whether the subject is a candidate or an
// examiner. Callers should return this verbatim.
export const PIN_GENERIC_ERROR = "PIN is not correct, or the access could not be verified.";
