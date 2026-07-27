import crypto from "node:crypto";
import { envReady, supabase, sendJson } from "./_lib/backend.mjs";
import { validateFieldPreparation, mergeTabletSyncIntoPreparation, candidatePackage } from "./_impl/field-prep.mjs";

// Field-preparation + field-tablet sync, Supabase-backed. vercel.json rewrites
// /api/exams/* onto this router (?path=<examId>/<route>). Public (the field
// tablet has no app session) — matches the dev mock; gate later if needed.

async function readPreparation(examId) {
  const rows = await supabase(`field_preparations?exam_id=eq.${encodeURIComponent(examId)}&select=data&limit=1`);
  return rows[0]?.data ?? null;
}

async function writePreparation(examId, data) {
  await supabase("field_preparations?on_conflict=exam_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ exam_id: examId, data, updated_at: new Date().toISOString() }),
  });
}

async function readLatestSync(examId) {
  const rows = await supabase(`field_tablet_syncs?exam_id=eq.${encodeURIComponent(examId)}&select=payload&order=received_at.desc&limit=1`);
  return rows[0]?.payload ?? null;
}

export default async function handler(request, response) {
  if (!envReady()) return sendJson(response, 503, { error: "Backend not configured" });
  const raw = request.query?.path;
  const parts = (Array.isArray(raw) ? raw.join("/") : String(raw || "")).split("/").filter(Boolean);
  const examId = decodeURIComponent(parts[0] || "");
  const route = parts.slice(1).join("/");
  if (!examId) return sendJson(response, 400, { error: "Missing exam id" });

  try {
    if (request.method === "GET" && route === "field-preparation") {
      const data = await readPreparation(examId);
      if (!data) return sendJson(response, 404, { error: "Field preparation not found" });
      return sendJson(response, 200, { fieldPreparation: data });
    }

    if (request.method === "PUT" && route === "field-preparation") {
      const incoming = request.body?.fieldPreparation || request.body;
      if (!incoming || typeof incoming !== "object") return sendJson(response, 400, { error: "Invalid field preparation payload" });
      const stored = { ...incoming, examId: incoming.examId || examId, updatedAt: new Date().toISOString() };
      await writePreparation(examId, stored);
      return sendJson(response, 200, { ok: true, fieldPreparation: stored, validation: validateFieldPreparation(stored) });
    }

    if (request.method === "POST" && route === "field-preparation/validate") {
      const data = await readPreparation(examId);
      if (!data) return sendJson(response, 404, { error: "Field preparation not found" });
      return sendJson(response, 200, validateFieldPreparation(data));
    }

    if (request.method === "GET" && route.startsWith("field-package/")) {
      const level = route.split("/")[1];
      const data = await readPreparation(examId);
      if (!data) return sendJson(response, 404, { error: "Field preparation not found" });
      return sendJson(response, 200, candidatePackage(data, level, examId));
    }

    if (request.method === "GET" && route === "field-tablet-sync/latest") {
      const current = await readPreparation(examId);
      if (!current) return sendJson(response, 404, { error: "Field preparation not found" });
      const latest = await readLatestSync(examId);
      if (!latest) return sendJson(response, 200, { ok: true, fieldPreparation: current, syncId: null, message: "No tablet sync package found" });
      const merged = mergeTabletSyncIntoPreparation(current, latest, examId);
      await writePreparation(examId, merged);
      return sendJson(response, 200, { ok: true, syncId: latest.syncId || null, fieldPreparationUpdated: true, fieldPreparation: merged });
    }

    // Scan-inbox: phone (scan-capture) uploads photos; Centre polls + deletes.
    if (route === "scan-inbox" && request.method === "POST") {
      const dataUrl = request.body?.dataUrl;
      if (typeof dataUrl !== "string" || !dataUrl) return sendJson(response, 400, { error: "Missing dataUrl" });
      const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      await supabase("scan_inbox", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id, exam_id: examId, data_url: dataUrl, captured_at: request.body?.capturedAt || new Date().toISOString(), received_at: new Date().toISOString() }) });
      return sendJson(response, 200, { ok: true, id });
    }
    if (route === "scan-inbox" && request.method === "GET") {
      const rows = await supabase(`scan_inbox?exam_id=eq.${encodeURIComponent(examId)}&select=id,data_url,captured_at,received_at&order=received_at.asc`);
      return sendJson(response, 200, { items: rows.map((r) => ({ id: r.id, dataUrl: r.data_url, capturedAt: r.captured_at, receivedAt: r.received_at })) });
    }
    if (route.startsWith("scan-inbox/") && request.method === "DELETE") {
      const id = decodeURIComponent(route.split("/")[1] || "");
      await supabase(`scan_inbox?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && route === "field-tablet-sync") {
      const body = request.body;
      if (!body || typeof body !== "object") return sendJson(response, 400, { error: "Invalid tablet sync payload" });
      const syncId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${examId.replace(/[^a-z0-9_-]/gi, "_")}-${crypto.randomBytes(4).toString("hex")}`;
      const receivedAt = new Date().toISOString();
      const stored = { ...body, examId: body.examId || examId, syncId, receivedAt };
      await supabase("field_tablet_syncs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sync_id: syncId, exam_id: examId, payload: stored, received_at: receivedAt }) });
      const current = await readPreparation(examId);
      let fieldPreparation = current;
      if (current) {
        fieldPreparation = mergeTabletSyncIntoPreparation(current, stored, examId);
        await writePreparation(examId, fieldPreparation);
      }
      return sendJson(response, 200, { ok: true, syncId, receivedAt, fieldPreparationUpdated: Boolean(current), fieldPreparation });
    }

    return sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Field preparation API failed" });
  }
}
