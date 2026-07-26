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
      const key = String(request.body?.key || "").trim();
      if (!lang || !key) return sendJson(response, 400, { ok: false, error: "lang and key are required" });
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
