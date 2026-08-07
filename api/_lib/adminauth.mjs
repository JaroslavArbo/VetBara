import crypto from "node:crypto";
import { supabase } from "./backend.mjs";

// Shared admin-identity helpers (Phase 1 of the auth overhaul): password policy, credential
// hashing, activation tokens and the security audit trail. No secret is ever stored in source -
// hashes are computed here, plaintext only ever lives in the request being handled.

export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8; // one admin shift
export const ACTIVATION_TTL_SECONDS = 60 * 60 * 24;   // 4.2 - 24 hours

// §5 - minimum requirements. Max length is deliberately NOT capped below 64 so a password manager
// can paste a long passphrase.
const MIN_PASSWORD_LENGTH = 14;
const FORBIDDEN_FRAGMENTS = ["vetbara2026", "vetbara202", "vetbara!", "vetbara1", "password", "passw0rd", "123456", "qwerty", "letmein", "admin123"];

export function validateAdminPassword(password, username = "") {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (value.length > 200) return "Password is too long";
  if (!/[a-z]/.test(value)) return "Password must contain a lower-case letter";
  if (!/[A-Z]/.test(value)) return "Password must contain an upper-case letter";
  if (!/\d/.test(value)) return "Password must contain a digit";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must contain a special character";
  const lowered = value.toLowerCase();
  const user = String(username ?? "").trim().toLowerCase();
  if (user && (lowered === user || lowered.includes(user))) return "Password must not contain the username";
  // §5 - the retired default and its obvious variants, plus a small common-password deny list.
  if (FORBIDDEN_FRAGMENTS.some((fragment) => lowered.includes(fragment))) return "This password is too easy to guess - choose a different one";
  return null;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function hashPasswordWithSalt(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

export function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

export function passwordMatches(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashPasswordWithSalt(password, salt), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// §17 - audit every security-relevant action. Never pass a secret in: callers hand over ids and
// short non-reversible references only. Best-effort so auditing can never block a login.
export async function auditAuth(entry) {
  try {
    await supabase("auth_audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        actor_type: entry.actorType || "system",
        actor_id: entry.actorId ?? null,
        action: entry.action,
        result: entry.result || "success",
        exam_event_id: entry.examEventId ?? null,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        ip_address_or_hash: entry.ip ? sha256(entry.ip).slice(0, 32) : null,
        user_agent: entry.userAgent ? String(entry.userAgent).slice(0, 200) : null,
        metadata: entry.metadata ?? null,
      }),
    });
  } catch (error) {
    console.warn("auth audit write failed", error?.message || error);
  }
}

export function requestIp(request) {
  const forwarded = request?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return request?.headers?.["x-real-ip"] || null;
}

export async function findAdminProfile(username) {
  const rows = await supabase(`user_profiles?username=eq.${encodeURIComponent(String(username))}&select=*&limit=1`);
  return rows[0] || null;
}

// Mints a one-time activation link token. Only the hash is stored; the plaintext is returned once to
// the caller (a secured service procedure, never public UI) and cannot be recovered afterwards.
export async function createActivationToken(profileId, createdBy = "service") {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_SECONDS * 1000).toISOString();
  await supabase("admin_activation_tokens", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_profile_id: profileId, token_hash: sha256(token), expires_at: expiresAt, created_by: createdBy }),
  });
  return { token, expiresAt };
}

// Resolves a plaintext activation token to its (still valid, unused) row + profile.
export async function resolveActivationToken(token) {
  if (!token) return null;
  const rows = await supabase(`admin_activation_tokens?token_hash=eq.${sha256(token)}&used_at=is.null&select=*&limit=1`);
  const row = rows[0];
  if (!row || new Date(row.expires_at) <= new Date()) return null;
  const profiles = await supabase(`user_profiles?id=eq.${encodeURIComponent(row.user_profile_id)}&select=*&limit=1`);
  const profile = profiles[0];
  if (!profile) return null;
  return { row, profile };
}

export async function createAdminSession(profile) {
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString();
  await supabase("app_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ token_hash: sha256(sessionToken), role: "Admin", subject_id: profile.username, expires_at: expiresAt }),
  });
  return { sessionToken, expiresAt };
}

// --- Supabase Auth bridge (phase 2) -----------------------------------------------------------
// Admin identities live in Supabase Auth so we get its native MFA. Supabase owns the credentials
// and the factors; this app still owns its own app_sessions, which every admin endpoint already
// authorises against. The bridge below turns a Supabase session that has satisfied a second factor
// (AAL2) into one of our Admin sessions.

// Admins sign in with an address, not a username. These are synthetic and deliberately not real
// mailboxes: §20 makes account recovery the other administrator's job, so adding an email-reset
// channel would only weaken the account. Override per account by setting user_profiles.auth_email.
export function adminEmailForUsername(username) {
  return `${String(username).trim().toLowerCase()}@vetbara.internal`;
}

function authBase() {
  return `${process.env.SUPABASE_URL}/auth/v1`;
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

// Creates the Supabase Auth user for an admin, or resets its password if it already exists.
// email_confirm is set so no confirmation mail is ever sent (the addresses are not real).
export async function upsertAdminAuthUser(email, password) {
  const create = await fetch(`${authBase()}/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (create.ok) return (await create.json())?.id ?? null;

  // Already exists - find it and set the new password instead.
  const listed = await fetch(`${authBase()}/admin/users?per_page=200`, { headers: serviceHeaders() });
  if (!listed.ok) throw new Error(`Could not look up the admin auth user (${listed.status})`);
  const users = (await listed.json())?.users ?? [];
  const existing = users.find((user) => String(user.email).toLowerCase() === String(email).toLowerCase());
  if (!existing) throw new Error(await create.text());
  const updated = await fetch(`${authBase()}/admin/users/${existing.id}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!updated.ok) throw new Error(`Could not update the admin auth user (${updated.status})`);
  return existing.id;
}

// Validates a Supabase access token against Supabase itself (never by trusting the client), then
// reads the assurance level out of the now-known-good token payload.
export async function verifySupabaseAccessToken(accessToken) {
  if (!accessToken) return null;
  const response = await fetch(`${authBase()}/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  let aal = null;
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split(".")[1], "base64url").toString("utf8"));
    aal = payload?.aal ?? null;
  } catch { /* claim is optional; treated as not-AAL2 below */ }
  return { id: user?.id ?? null, email: user?.email ?? null, aal };
}

export async function listAdminAuthFactors(authUserId) {
  const response = await fetch(`${authBase()}/admin/users/${authUserId}`, { headers: serviceHeaders() });
  if (!response.ok) return [];
  const user = await response.json();
  return (user?.factors ?? []).filter((factor) => factor.status === "verified");
}
