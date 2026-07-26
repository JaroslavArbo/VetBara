import crypto from "node:crypto";
import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";
import { validateAuthoringDraft, summarizeAuthoringDraft } from "../_lib/packages.mjs";

// Save a structured authoring draft (Admin).
export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Backend not configured" });

  const { sessionToken, draft: incoming } = request.body ?? {};
  if (!(await resolveAdminSession(sessionToken))) return sendJson(response, 401, { error: "Admin session required" });

  try {
    validateAuthoringDraft(incoming);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  const storedAt = new Date().toISOString();
  const draftId = incoming.draftId || `vetbara-authoring-draft-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const draft = { ...incoming, draftId, updatedAt: incoming.updatedAt || storedAt, storedAt };

  try {
    await supabase("authoring_drafts?on_conflict=draft_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ draft_id: draftId, stored_at: storedAt, updated_at: draft.updatedAt, data: draft }),
    });
    return sendJson(response, 201, { ok: true, draft, summary: summarizeAuthoringDraft(draft) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Draft save failed" });
  }
}
