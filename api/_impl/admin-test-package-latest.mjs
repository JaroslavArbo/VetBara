import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 404, { error: "No local test package found" });
  if (!(await resolveAdminSession(request.headers?.["x-vetbara-session"]))) return sendJson(response, 401, { error: "Admin session required" });
  try {
    const rows = await supabase("certification_packages?select=data&order=created_at.desc&limit=1");
    if (!rows[0]) return sendJson(response, 404, { error: "No local test package found" });
    return sendJson(response, 200, rows[0].data);
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Latest failed" });
  }
}
