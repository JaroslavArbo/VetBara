import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";

// Centre-link history list/save (token itself is registered by centre-links/register).
function toClient(row) {
  return { id: row.id, createdAt: row.created_at, place: row.place || "", examDate: row.exam_date || "", centre: row.centre || "", token: row.token || "", url: row.url || "" };
}

export default async function handler(request, response) {
  if (!envReady()) return sendJson(response, 200, { ok: true, links: [] });
  if (!(await resolveAdminSession(request.headers?.["x-vetbara-session"] || request.body?.sessionToken))) return sendJson(response, 401, { ok: false, error: "Admin session required" });
  const raw = request.query?.path;
  const parts = (Array.isArray(raw) ? raw.join("/") : String(raw || "")).split("/").filter(Boolean);
  const action = parts[1];

  try {
    if (request.method === "GET" && action === "list") {
      const rows = await supabase("centre_links?select=*&order=created_at.desc");
      return sendJson(response, 200, { ok: true, links: rows.map(toClient) });
    }
    if (request.method === "POST" && action === "save") {
      if (!(await resolveAdminSession(request.body?.sessionToken))) return sendJson(response, 401, { ok: false, error: "Admin session required" });
      const body = request.body ?? {};
      const createdAt = new Date().toISOString();
      const id = `link-${Date.parse(createdAt)}`;
      const row = { id, created_at: createdAt, place: body.place || "", exam_date: body.examDate || "", centre: body.centre || "", token: body.token || "", url: body.url || "" };
      await supabase("centre_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
      return sendJson(response, 200, { ok: true, entry: toClient(row) });
    }
    // Delete a single history entry. This removes the Centre link from the Admin's list only —
    // the exam event, its roster and any results stay in place; it is a tidy-up of the link
    // history, not a way to erase an exam.
    if (request.method === "POST" && action === "delete") {
      if (!(await resolveAdminSession(request.body?.sessionToken))) return sendJson(response, 401, { ok: false, error: "Admin session required" });
      const id = String(request.body?.id || "").trim();
      if (!id) return sendJson(response, 400, { ok: false, error: "Missing centre link id" });
      await supabase(`centre_links?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return sendJson(response, 200, { ok: true, id });
    }
    return sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return sendJson(response, 500, { ok: false, error: error.message || "Centre links failed" });
  }
}
