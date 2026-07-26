import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";
import { summarizeCertificationPackage } from "../_lib/packages.mjs";

// Approve a package and make it the single active package for Centre/Candidate.
export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Backend not configured" });

  const { sessionToken, packageId, allowRequiresReview, reason } = request.body ?? {};
  if (!(await resolveAdminSession(sessionToken))) return sendJson(response, 401, { error: "Admin session required" });
  if (!packageId) return sendJson(response, 400, { error: "Missing packageId" });

  try {
    const rows = await supabase(`certification_packages?package_id=eq.${encodeURIComponent(packageId)}&select=data,validation&limit=1`);
    const found = rows[0];
    if (!found) return sendJson(response, 404, { error: `Package not found: ${packageId}` });

    const validationStatus = found.validation?.status || found.data?.validation?.status || "unknown";
    const override = Boolean(allowRequiresReview);
    const reasonText = String(reason || "").trim();

    if (validationStatus !== "valid" && !override) {
      return sendJson(response, 409, { error: "Package requires review and cannot be approved without explicit override", validation: found.data?.validation });
    }
    if (validationStatus !== "valid" && !reasonText) {
      return sendJson(response, 400, { error: "Override reason is required for requires_review package", validation: found.data?.validation });
    }

    const approvedAt = new Date().toISOString();
    const approval = { status: "approved", approvedAt, approvedForCentre: true, allowRequiresReview: override, reason: reasonText };
    const approved = { ...found.data, approval, activeForCentre: true };

    // Exactly one active package: clear the current active, then set this one.
    await supabase("certification_packages?active_for_centre=eq.true", { method: "PATCH", body: JSON.stringify({ active_for_centre: false }) });
    await supabase(`certification_packages?package_id=eq.${encodeURIComponent(packageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ approval, active_for_centre: true, data: approved, updated_at: approvedAt }),
    });

    return sendJson(response, 200, { ok: true, package: approved, summary: summarizeCertificationPackage(approved) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Approve failed" });
  }
}
