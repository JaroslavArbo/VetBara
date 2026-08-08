import crypto from "node:crypto";
import { verifyPin, hashPin, newPinSalt, pinLockState, nextStateAfterFailure, clearedPinState, PIN_GENERIC_ERROR,
  newPinChallenge, pinChallengeHash, pinChallengeExpiry, isChallengeUsable } from "../_lib/pinsecurity.mjs";

const DEMO_TOKENS = {
  "VETBARA-CENTRE-ARBOR-2026": { role: "Centre", subjectId: "CENTRE-ARBOR" },
  "VETBARA-CANDIDATE-C-001-2026": { role: "Candidate", subjectId: "C-001" },
  "VETBARA-EXAMINER-E-001-2026": { role: "Examiner", subjectId: "E-001" },
};

const SESSION_TTL_SECONDS = 60 * 60 * 8;
// From the 2nd device onward using the SAME QR link at the same time is worth a flag in the audit
// trail (a QR is meant for one person); the 4th is refused outright. Deliberately generous - this
// exists to catch an accidentally-shared link, not to make life hard for someone using both their
// phone and the exam tablet.
const MAX_CONCURRENT_DEVICES = 3;

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  const secret = process.env.VETBARA_SESSION_SECRET || process.env.VETBARA_SEED_SECRET || "vetbara-demo-session-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createDemoSessionToken(access, expiresAt) {
  const payload = base64urlJson({ role: access.role, subjectId: access.subjectId, expiresAt });
  return `demo.${payload}.${sign(payload)}`;
}

function parseToken(input) {
  try {
    const url = new URL(input);
    return url.searchParams.get("token") || input;
  } catch {
    return input;
  }
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

async function createSession(access, deviceId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  if (!envReady()) return { sessionToken: createDemoSessionToken(access, expiresAt), expiresAt };

  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const row = {
    token_hash: hash(sessionToken),
    role: access.role,
    subject_id: access.subjectId,
    qr_token_id: access.qrTokenId ?? null,
    expires_at: expiresAt,
  };
  // device_id is a new (nullable) column - tolerate it not existing yet so this never blocks a
  // real login just because the migration hasn't been applied.
  try {
    await supabase("app_sessions", { method: "POST", body: JSON.stringify({ ...row, device_id: deviceId ?? null }) });
  } catch {
    await supabase("app_sessions", { method: "POST", body: JSON.stringify(row) });
  }

  return { sessionToken, expiresAt };
}

// Clears a Centre token's activation deadline and records the activation in the Admin link history.
// Every step is individually tolerant: the columns are new (20260803 migration) and a deployment
// that has not run it yet must still log in normally.
async function markCentreLinkActivated(access) {
  try {
    await supabase(`qr_tokens?id=eq.${encodeURIComponent(access.qrTokenId)}`, {
      method: "PATCH",
      body: JSON.stringify({ expires_at: null }),
    });
  } catch { /* deadline stays; the link still works until it lapses */ }
  try {
    const now = new Date().toISOString();
    await supabase(`centre_links?subject_id=eq.${encodeURIComponent(access.subjectId)}&activated_at=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ activated_at: now }),
    });
  } catch { /* history stays "generated"; not worth failing a login over */ }
}

// Device-bound QR access for Candidate/Examiner links (see the 20260802 migration). Every branch
// below is wrapped so that ANY failure - a missing table/column because the migration has not run,
// an unexpected error, a malformed row - resolves to { outcome: "allow" }. A bug in this brand-new
// gate must never be able to lock a real candidate or examiner out of their own exam; it may only
// ever fail OPEN, never closed.
async function evaluateDeviceAccess({ qrTokenId, role, deviceId, pin, pinChallenge }) {
  if (!qrTokenId || !deviceId || (role !== "Candidate" && role !== "Examiner")) {
    return { outcome: "allow" };
  }
  try {
    const tokenRows = await supabase(`qr_tokens?id=eq.${encodeURIComponent(qrTokenId)}&select=pin_hash,pin_salt,pin_algo,pin_failed_attempts,pin_locked_until,pin_lockout_count,pin_permanently_locked_at&limit=1`);
    const tokenRow = tokenRows[0] || {};
    const pinHash = tokenRow.pin_hash ?? null;

    const deviceRows = await supabase(`qr_token_devices?qr_token_id=eq.${encodeURIComponent(qrTokenId)}&device_id=eq.${encodeURIComponent(deviceId)}&select=id&limit=1`);
    if (deviceRows.length) {
      const now = new Date().toISOString();
      supabase(`qr_token_devices?id=eq.${encodeURIComponent(deviceRows[0].id)}`, { method: "PATCH", body: JSON.stringify({ last_seen_at: now }) }).catch(() => {});
      return { outcome: "allow" };
    }

    // A device we haven't seen before for this token.
    if (pinHash) {
      // §13.1 - a locked PIN is refused before any comparison happens, so a lockout cannot be
      // burned through by continuing to guess.
      const lock = pinLockState(tokenRow);
      if (lock.locked) return { outcome: "pin-locked", permanent: lock.permanent, until: lock.until };
      if (!pin) {
        // Issue the one-time window the PIN must be submitted inside (§13.3).
        const challenge = newPinChallenge();
        await supabase("pin_challenges", {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ qr_token_id: qrTokenId, challenge_hash: pinChallengeHash(challenge), expires_at: pinChallengeExpiry() }),
        }).catch(() => {});
        return { outcome: "requires-pin", challenge };
      }

      // A PIN submitted without a live challenge for THIS token is refused outright, so the form
      // cannot be replayed or aimed at somebody else's token.
      const challengeRows = await supabase(`pin_challenges?challenge_hash=eq.${pinChallengeHash(String(pinChallenge || ""))}&select=*&limit=1`).catch(() => []);
      const challengeRow = challengeRows[0];
      if (!isChallengeUsable(challengeRow, qrTokenId)) return { outcome: "wrong-pin" };
      await supabase(`pin_challenges?id=eq.${encodeURIComponent(challengeRow.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ consumed_at: new Date().toISOString(), attempts: Number(challengeRow.attempts || 0) + 1 }),
      }).catch(() => {});

      const check = verifyPin(String(pin), tokenRow);
      if (!check.ok) {
        // Escalating lockout: 5 wrong attempts -> 15 min -> 60 min -> manual unlock only.
        const patch = nextStateAfterFailure(tokenRow);
        await supabase(`qr_tokens?id=eq.${encodeURIComponent(qrTokenId)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
        }).catch(() => {});
        return { outcome: "wrong-pin" };
      }

      // Correct: clear the counters, and transparently re-hash a legacy SHA-256 PIN with
      // salt + scrypt so nobody has to reset a PIN that still works (§14).
      const patch = { ...clearedPinState() };
      if (check.needsUpgrade) {
        const salt = newPinSalt();
        patch.pin_salt = salt;
        patch.pin_hash = hashPin(String(pin), salt);
        patch.pin_algo = "scrypt";
      }
      await supabase(`qr_tokens?id=eq.${encodeURIComponent(qrTokenId)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
      }).catch(() => {});
      // Trust this device, fall through to the concurrency check below.
    }

    const activeRows = await supabase(
      `app_sessions?qr_token_id=eq.${encodeURIComponent(qrTokenId)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=device_id`
    );
    const distinctActiveDevices = new Set((activeRows || []).map((row) => row.device_id).filter(Boolean));
    distinctActiveDevices.delete(deviceId);
    if (distinctActiveDevices.size >= MAX_CONCURRENT_DEVICES) {
      return { outcome: "device-limit" };
    }

    await supabase("qr_token_devices", { method: "POST", body: JSON.stringify({ qr_token_id: qrTokenId, device_id: deviceId }) }).catch(() => {});

    return { outcome: "allow", isFirstDevice: !pinHash, isNewDevice: true, concurrentDeviceCount: distinctActiveDevices.size + 1 };
  } catch {
    return { outcome: "allow" };
  }
}

// Fire-and-forget audit entry for a 2nd+ concurrent device on the same link - written directly as
// a sync_events row (same shape the client's addAudit() produces) rather than through the normal
// authenticated sync path, since this device has not finished logging in yet. Never awaited by the
// caller and never allowed to affect the login outcome either way.
function logConcurrentDeviceAlert(access, concurrentDeviceCount) {
  if (!envReady()) return;
  const now = new Date().toISOString();
  const payload = {
    action: "Simultaneous device use detected",
    target: access.subjectId,
    detail: `${concurrentDeviceCount}. zařízení současně na stejném QR odkazu`,
    actorRole: access.role,
    alert: true,
    time: new Date(now).toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    createdAt: now,
  };
  supabase("sync_events", {
    method: "POST",
    body: JSON.stringify({
      client_event_id: `qr-concurrent-${access.qrTokenId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_id: null,
      role: access.role,
      subject_id: access.subjectId,
      event_type: "audit.logged",
      entity_type: "audit_entry",
      entity_id: `concurrent-${access.qrTokenId}-${Date.now()}`,
      candidate_id: access.role === "Candidate" ? access.subjectId : null,
      payload,
      created_at: now,
    }),
  }).catch(() => {});
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  try {
    const token = parseToken(String(request.body?.token || "").trim());
    if (!token) return sendJson(response, 400, { error: "Missing QR token" });
    const deviceId = String(request.body?.deviceId || "").trim() || null;
    const pin = request.body?.pin != null ? String(request.body.pin).trim() : null;
    const pinChallenge = request.body?.pinChallenge != null ? String(request.body.pinChallenge).trim() : null;

    let access = null;

    if (envReady()) {
      const rows = await supabase(`qr_tokens?token_hash=eq.${hash(token)}&revoked_at=is.null&select=id,role,subject_id,expires_at&limit=1`);
      const row = rows[0];
      if (row && (!row.expires_at || new Date(row.expires_at) > new Date())) {
        access = { role: row.role, subjectId: row.subject_id, qrTokenId: row.id };
      }
    }

    // Demo tokens are a local/offline convenience only: once Supabase is configured (envReady),
    // a lookup miss means the token is genuinely invalid/revoked and must not fall back to the
    // well-known demo constants (they are public in this repo). Every other resolveSession() in
    // this codebase already gates its demo path behind !envReady(); this one didn't, which let
    // the hardcoded demo tokens authenticate as Centre/Candidate/Examiner on a live deployment.
    if (!access && !envReady() && process.env.VETBARA_DEMO_MODE !== "false") access = DEMO_TOKENS[token] ?? null;
    if (!access) return sendJson(response, 401, { error: "Invalid or expired QR token" });

    let deviceGate = null;
    if (envReady() && access.qrTokenId) {
      deviceGate = await evaluateDeviceAccess({ qrTokenId: access.qrTokenId, role: access.role, deviceId, pin, pinChallenge });
      if (deviceGate.outcome === "requires-pin") return sendJson(response, 401, { error: PIN_GENERIC_ERROR, requiresPin: true, pinChallenge: deviceGate.challenge });
      // A lockout is a definitive server decision, not an error condition, so unlike the rest of
      // this gate it must NOT fail open - without this the 6th attempt after a lockout sailed
      // straight through, because an unrecognised outcome falls through to "allow" below.
      if (deviceGate.outcome === "pin-locked") {
        return sendJson(response, 429, {
          error: PIN_GENERIC_ERROR, requiresPin: true, pinLocked: true,
          permanent: Boolean(deviceGate.permanent),
          retryAfter: deviceGate.until ? new Date(deviceGate.until).toISOString() : null,
        });
      }
      // §13.4 - the same wording for every failure, so nothing reveals whether the token exists,
      // whether a PIN was set, or how close the guess was.
      if (deviceGate.outcome === "wrong-pin") return sendJson(response, 401, { error: PIN_GENERIC_ERROR, requiresPin: true, wrongPin: true });
      if (deviceGate.outcome === "device-limit") return sendJson(response, 429, { error: "This QR code is already open on 3 devices at once", deviceLimitReached: true });
    }

    // First successful open of a Centre link "activates" it: drop the 3-week activation deadline
    // (an exam that has started must never expire mid-run) and stamp the Admin link history so the
    // Admin list can show it as opened. Best-effort only - a failure here must not block the login.
    if (envReady() && access.role === "Centre" && access.qrTokenId) {
      markCentreLinkActivated(access).catch(() => {});
    }

    const session = await createSession(access, deviceId);
    const extra = {};
    if (deviceGate?.isFirstDevice) extra.promptSetPin = true;
    if (deviceGate?.concurrentDeviceCount >= 2) {
      extra.concurrentDeviceAlert = true;
      logConcurrentDeviceAlert(access, deviceGate.concurrentDeviceCount);
    }
    return sendJson(response, 200, { role: access.role, subjectId: access.subjectId, ...session, ...extra });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "QR resolve failed" });
  }
}
