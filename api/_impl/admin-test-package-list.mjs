import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";
import { summarizeCertificationPackage } from "../_lib/packages.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { packages: [] });
  if (!(await resolveAdminSession(request.headers?.["x-vetbara-session"]))) return sendJson(response, 401, { error: "Admin session required" });
  try {
    const rows = await supabase("certification_packages?select=data&order=created_at.desc");
    return sendJson(response, 200, { packages: rows.map((row) => summarizeCertificationPackage(row.data)) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "List failed" });
  }
}
