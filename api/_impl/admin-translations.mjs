import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";

// Translation overrides. GET is public (the app reads overrides at startup for
// every user); POST (write) requires an Admin session. Path "translations/overrides".
async function readOverrides() {
  const rows = await supabase("translation_overrides?select=lang,key,value");
  const map = {};
  for (const row of rows) {
    if (!map[row.lang]) map[row.lang] = {};
    map[row.lang][row.key] = row.value;
  }
  return map;
}

export default async function handler(request, response) {
  if (!envReady()) return sendJson(response, 200, { ok: true, overrides: {} });
  try {
    if (request.method === "GET") {
      return sendJson(response, 200, { ok: true, overrides: await readOverrides() });
    }
    if (request.method === "POST") {
      if (!(await resolveAdminSession(request.body?.sessionToken))) return sendJson(response, 401, { ok: false, error: "Admin session required" });
      const lang = String(request.body?.lang || "").trim();
      if (!lang) return sendJson(response, 400, { ok: false, error: "lang is required" });

      // Reset a whole language back to the built-in translations by deleting every override for it.
      // Used to recover from importing the wrong language over an existing one.
      if (request.body?.action === "reset") {
        await supabase(`translation_overrides?lang=eq.${encodeURIComponent(lang)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return sendJson(response, 200, { ok: true, reset: lang, overrides: await readOverrides() });
      }

      // Batch upsert from a CSV import: entries = [{ key, value }]. Empty values are IGNORED here
      // (not deleted), so re-importing a sheet with blank cells never silently wipes an existing
      // translation - clearing is done one row at a time in the UI on purpose.
      if (Array.isArray(request.body?.entries)) {
        const seen = new Set();
        const upserts = [];
        for (const entry of request.body.entries) {
          const entryKey = String(entry?.key || "").trim();
          const entryValue = typeof entry?.value === "string" ? entry.value.trim() : "";
          if (!entryKey || !entryValue || seen.has(entryKey)) continue;
          seen.add(entryKey);
          upserts.push({ lang, key: entryKey, value: entryValue, updated_at: new Date().toISOString() });
        }
        if (upserts.length) {
          await supabase("translation_overrides?on_conflict=lang,key", {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(upserts),
          });
        }
        return sendJson(response, 200, { ok: true, upserted: upserts.length, overrides: await readOverrides() });
      }

      const key = String(request.body?.key || "").trim();
      if (!key) return sendJson(response, 400, { ok: false, error: "lang and key are required" });
      const value = typeof request.body?.value === "string" ? request.body.value.trim() : "";
      if (value) {
        await supabase("translation_overrides?on_conflict=lang,key", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ lang, key, value, updated_at: new Date().toISOString() }),
        });
      } else {
        await supabase(`translation_overrides?lang=eq.${encodeURIComponent(lang)}&key=eq.${encodeURIComponent(key)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      return sendJson(response, 200, { ok: true, overrides: await readOverrides() });
    }
    return sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return sendJson(response, 500, { ok: false, error: error.message || "Translation overrides failed" });
  }
}
