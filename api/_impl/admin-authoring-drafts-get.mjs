import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";

// GET one authoring draft by draftId (or packageId fallback). Path "authoring-drafts/<id>".
export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 404, { error: "No structured authoring draft found" });
  if (!(await resolveAdminSession(request.headers?.["x-vetbara-session"]))) return sendJson(response, 401, { error: "Admin session required" });
  const raw = request.query?.path;
  const parts = (Array.isArray(raw) ? raw.join("/") : String(raw || "")).split("/").filter(Boolean);
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;
  if (!id) return sendJson(response, 400, { error: "Missing draft id" });
  try {
    let rows = await supabase(`authoring_drafts?draft_id=eq.${encodeURIComponent(id)}&select=data&limit=1`);
    if (!rows[0]) rows = await supabase(`authoring_drafts?data->>packageId=eq.${encodeURIComponent(id)}&select=data&limit=1`);
    if (!rows[0]) return sendJson(response, 404, { error: `Authoring draft not found: ${id}` });
    return sendJson(response, 200, rows[0].data);
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Draft lookup failed" });
  }
}
