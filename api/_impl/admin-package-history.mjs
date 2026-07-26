import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";

// Package history CRUD (was dev file mock). Path is "package-history[/<id>[/note|delete]]".
function summary(row) {
  return { id: row.id, savedAt: row.saved_at, language: row.language || "", centre: row.centre || "", note: row.note || "", packageId: row.package_id || "", vetFilename: row.vet_filename || "" };
}

export default async function handler(request, response) {
  if (!envReady()) return sendJson(response, 200, { ok: true, history: [] });
  const raw = request.query?.path;
  const parts = (Array.isArray(raw) ? raw.join("/") : String(raw || "")).split("/").filter(Boolean);
  const tail = parts.slice(1); // drop "package-history"
  const method = request.method;

  try {
    if (method === "GET" && tail.length === 1 && tail[0] === "list") {
      const rows = await supabase("package_history?select=*&order=saved_at.desc");
      return sendJson(response, 200, { ok: true, history: rows.map(summary) });
    }

    // Writes require an Admin session.
    if (method === "POST") {
      if (!(await resolveAdminSession(request.body?.sessionToken))) return sendJson(response, 401, { error: "Admin session required" });
    }

    if (method === "POST" && tail.length === 1 && tail[0] === "save") {
      const body = request.body ?? {};
      const savedAt = new Date().toISOString();
      const id = `hist-${Date.parse(savedAt)}`;
      const row = { id, saved_at: savedAt, language: body.language || "", centre: body.centre || "", note: body.note || "", package_id: body.packageId || "", vet_filename: body.vetFilename || "", package: body.package || null };
      await supabase("package_history", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...row, data: { id, savedAt, ...body } }) });
      return sendJson(response, 200, { ok: true, entry: summary(row) });
    }

    const id = tail[0] ? decodeURIComponent(tail[0]) : null;

    if (method === "GET" && tail.length === 1 && id) {
      const rows = await supabase(`package_history?id=eq.${encodeURIComponent(id)}&select=data&limit=1`);
      if (!rows[0]) return sendJson(response, 404, { ok: false, error: `Package history entry not found: ${id}` });
      return sendJson(response, 200, { ok: true, entry: rows[0].data });
    }

    if (method === "POST" && tail.length === 2 && tail[1] === "note" && id) {
      const rows = await supabase(`package_history?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      if (!rows[0]) return sendJson(response, 404, { ok: false, error: `Package history entry not found: ${id}` });
      const note = request.body?.note || "";
      const updated = await supabase(`package_history?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ note, data: { ...(rows[0].data || {}), note } }) });
      return sendJson(response, 200, { ok: true, entry: summary(updated[0] || { ...rows[0], note }) });
    }

    if (method === "POST" && tail.length === 2 && tail[1] === "delete" && id) {
      await supabase(`package_history?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return sendJson(response, 200, { ok: true });
    }

    return sendJson(response, 200, { ok: true });
  } catch (error) {
    return sendJson(response, 500, { ok: false, error: error.message || "Package history failed" });
  }
}
