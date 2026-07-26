import crypto from "node:crypto";
import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";
import { validateCertificationPackage, summarizeCertificationPackage } from "../_lib/packages.mjs";

// Save an authored certification package (Admin). Supabase-backed replacement
// for the dev-only file mock.
export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Backend not configured" });

  const { sessionToken, package: incoming } = request.body ?? {};
  if (!(await resolveAdminSession(sessionToken))) return sendJson(response, 401, { error: "Admin session required" });
  if (!incoming || incoming.kind !== "vetbara.certificationPackage.v1") {
    return sendJson(response, 400, { error: "Invalid VetBara certification package" });
  }

  const packageId = incoming.packageId || `vetbara-authored-package-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const createdAt = new Date().toISOString();
  const data = { ...incoming, packageId, createdAt, contentSource: incoming.contentSource || "admin-structured-authoring" };
  data.validation = validateCertificationPackage(data);

  try {
    await supabase("certification_packages?on_conflict=package_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        package_id: packageId,
        created_at: createdAt,
        content_source: data.contentSource,
        validation: data.validation,
        active_for_centre: false,
        data,
        updated_at: createdAt,
      }),
    });
    return sendJson(response, 201, { ok: true, package: data, summary: summarizeCertificationPackage(data) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Save failed" });
  }
}
