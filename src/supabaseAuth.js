import { createClient } from "@supabase/supabase-js";

// Supabase Auth client for the ADMIN area only.
//
// Admin identities live in Supabase Auth so we get its native MFA (TOTP now, passkeys next) instead
// of hand-rolling either. Everything else in the app still talks only to our own /api routes - the
// browser never reads exam data straight from Supabase.
//
// The session it issues is not the app's session: once the user reaches AAL2 (password + TOTP) the
// access token is exchanged at /api/admin/auth/session for the ordinary app_sessions Admin token
// that every existing admin endpoint already authorises against.

const url = import.meta.env?.VITE_SUPABASE_URL || "";
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

// Publishable ("anon") key only - it is designed to be shipped to browsers and carries no privilege
// beyond what row-level security allows. The service-role key must never reach the client.
export const supabaseAuthConfigured = Boolean(url && anonKey);

let client = null;
export function supabaseAuth() {
  if (!supabaseAuthConfigured) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "vetbara.adminAuth",
        // The admin area is opened from plain links; there is no OAuth redirect to parse.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

// --- helpers used by the admin login / activation screens -------------------------------------

export async function adminSignInWithPassword(email, password) {
  const supabase = supabaseAuth();
  if (!supabase) throw new Error("Supabase Auth is not configured");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// AAL1 = first factor only, AAL2 = a second factor has been satisfied this session.
export async function adminAuthLevels() {
  const supabase = supabaseAuth();
  if (!supabase) return { current: null, next: null };
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return { current: data?.currentLevel ?? null, next: data?.nextLevel ?? null };
}

export async function adminListFactors() {
  const supabase = supabaseAuth();
  if (!supabase) return [];
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all ?? []).filter((factor) => factor.factor_type === "totp");
}

// Starts TOTP enrolment: returns the otpauth URI + shared secret to show as a QR code and as text
// for manual entry (§6.2).
export async function adminEnrollTotp(friendlyName) {
  const supabase = supabaseAuth();
  if (!supabase) throw new Error("Supabase Auth is not configured");

  // Drop factors from earlier, abandoned attempts first. Supabase keeps an unverified factor around
  // and enforces a unique friendly name per user, so retrying enrolment would otherwise fail with a
  // duplicate-key error rather than a useful message.
  try {
    const { data: existing } = await supabase.auth.mfa.listFactors();
    const stale = (existing?.all ?? []).filter((factor) => factor.factor_type === "totp" && factor.status !== "verified");
    for (const factor of stale) await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {});
  } catch { /* nothing enrolled yet */ }

  // Distinct name per attempt for the same reason. Random, not a timestamp: two attempts in the
  // same minute would otherwise still collide. §6.4 lets an admin add further named factors later.
  const stamp = Math.random().toString(36).slice(2, 8);
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `${friendlyName || "VetBara admin"} ${stamp}`,
    issuer: "VetBara",
  });
  if (error) throw error;
  return { factorId: data.id, qrUri: data.totp?.uri || "", secret: data.totp?.secret || "" };
}

// Verifies a six-digit code against a factor. Used both to finish enrolment and to satisfy the
// second factor at login - Supabase treats both as challenge + verify.
export async function adminVerifyTotp(factorId, code) {
  const supabase = supabaseAuth();
  if (!supabase) throw new Error("Supabase Auth is not configured");
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: String(code).trim(),
  });
  if (error) throw error;
  return data;
}

export async function adminUnenrollTotp(factorId) {
  const supabase = supabaseAuth();
  if (!supabase) throw new Error("Supabase Auth is not configured");
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function adminAccessToken() {
  const supabase = supabaseAuth();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function adminSignOut() {
  const supabase = supabaseAuth();
  if (!supabase) return;
  await supabase.auth.signOut().catch(() => {});
}

// --- Passkeys / WebAuthn (phase 3, §7) ---------------------------------------------------------
// Deliberately confined to this file. Supabase's passkey API is marked experimental, so when it
// changes only this layer moves - and per §25 the whole feature sits behind a flag with TOTP as the
// always-present fallback. Turning the flag off hides the UI but never deletes enrolled passkeys.

const passkeyFlag = String(import.meta.env?.VITE_VETBARA_PASSKEY_ENABLED ?? "").toLowerCase() === "true";

// A passkey is only offered when the operator enabled it AND the browser can actually do WebAuthn -
// §7.2 requires handling devices without support rather than showing a button that cannot work.
export function passkeysAvailable() {
  if (!passkeyFlag || !supabaseAuthConfigured) return false;
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export function passkeysEnabledByFlag() {
  return passkeyFlag;
}

function webauthnApi() {
  const supabase = supabaseAuth();
  const api = supabase?.auth?.mfa?.webauthn;
  if (!api) throw new Error("Passkeys are not supported by this build");
  return api;
}

// Registers a passkey for the CURRENT signed-in admin (§7.3: the account must already exist and be
// signed in - the WebAuthn ceremony comes after the password, never instead of creating the account).
export async function adminRegisterPasskey(friendlyName) {
  const api = webauthnApi();
  const stamp = Math.random().toString(36).slice(2, 8);
  const { data, error } = await api.register({
    friendlyName: `${friendlyName || "VetBara passkey"} ${stamp}`,
    webauthn: { rpId: window.location.hostname, rpOrigins: [window.location.origin] },
  });
  if (error) throw error;
  return data;
}

// Signs in with a discoverable credential (§7.4): the authenticator identifies the account itself,
// so no username is typed first.
export async function adminSignInWithPasskey() {
  const api = webauthnApi();
  const { data, error } = await api.authenticate({
    webauthn: { rpId: window.location.hostname, rpOrigins: [window.location.origin] },
  });
  if (error) throw error;
  return data;
}

// §7.5 - passkeys the admin can see and manage, alongside their TOTP factors.
export async function adminListPasskeys() {
  const supabase = supabaseAuth();
  if (!supabase) return [];
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all ?? []).filter((factor) => factor.factor_type === "webauthn");
}

// Removing the LAST remaining verified factor is refused (§7.5, §8): an admin account must never be
// left reachable by password alone.
export async function adminRemoveFactor(factorId) {
  const supabase = supabaseAuth();
  if (!supabase) throw new Error("Supabase Auth is not configured");
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const verified = (data?.all ?? []).filter((factor) => factor.status === "verified");
  if (verified.length <= 1 && verified.some((factor) => factor.id === factorId)) {
    throw new Error("This is your only security factor - add another one before removing it.");
  }
  const result = await supabase.auth.mfa.unenroll({ factorId });
  if (result.error) throw result.error;
}
