import { envReady, supabase, sendJson } from "../_lib/backend.mjs";
import { summarizeAuthoringDraft } from "../_lib/packages.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { drafts: [] });
  try {
    const rows = await supabase("authoring_drafts?select=data&order=stored_at.desc");
    return sendJson(response, 200, { drafts: rows.map((row) => summarizeAuthoringDraft(row.data)) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Draft list failed" });
  }
}
