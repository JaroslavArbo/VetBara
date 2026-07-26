import { envReady, supabase, sendJson } from "../_lib/backend.mjs";

// Same active/approved package as /api/centre/test-package/active, for the Admin surface.
export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 404, { error: "No approved active test package found" });
  try {
    const rows = await supabase("certification_packages?active_for_centre=eq.true&select=data&limit=1");
    if (!rows[0]) return sendJson(response, 404, { error: "No approved active test package found" });
    return sendJson(response, 200, rows[0].data);
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Active package lookup failed" });
  }
}
