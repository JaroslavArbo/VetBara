// Fetches Admin-edited translation overrides once at boot, before the app renders, so there is
// no flash of untranslated/fallback text. Guarded with a short timeout and a catch-all fallback —
// a slow or unreachable backend (e.g. a Candidate/Examiner device that briefly lost the LAN) must
// never block the app from rendering at all, it should just render with whatever is baked in.
export async function loadTranslationOverrides() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const response = await fetch("/api/translations/overrides", { cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return {};
    const data = await response.json();
    return data?.overrides && typeof data.overrides === "object" ? data.overrides : {};
  } catch {
    return {};
  }
}
