import { sendJson } from "../_lib/backend.mjs";

// Retired (phase 2). Admin credentials live in Supabase Auth now, so the first factor is verified
// by Supabase in the browser and the resulting session is exchanged at /api/admin/auth/session,
// which additionally requires AAL2. Keeping the old scrypt path alive would be a password-only
// bypass of the second factor, so it is refused outright rather than left as a fallback.
export default async function handler(request, response) {
  return sendJson(response, 410, {
    error: "Password sign-in moved to Supabase Auth. Reload the admin page and sign in there.",
    movedTo: "/api/admin/auth/session",
  });
}
