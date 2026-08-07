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
