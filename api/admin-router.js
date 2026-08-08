// Consolidated Admin API router (Hobby plan caps serverless functions at 12).
// One function dispatches every /api/admin/* route to its handler in api/_impl
// (underscore dir → not counted as a function by Vercel).
import login from "./_impl/admin-auth-login.mjs";
import changePassword from "./_impl/admin-auth-change-password.mjs";
import activate from "./_impl/admin-auth-activate.mjs";
import activity from "./_impl/admin-activity.mjs";
import outdoorPacing from "./_impl/outdoor-pacing.mjs";
import authSession from "./_impl/admin-auth-session.mjs";
import draftsSave from "./_impl/admin-authoring-drafts-save.mjs";
import draftsList from "./_impl/admin-authoring-drafts-list.mjs";
import draftsLatest from "./_impl/admin-authoring-drafts-latest.mjs";
import centreLinksRegister from "./_impl/admin-centre-links-register.mjs";
import tpAuthoringSave from "./_impl/admin-test-package-authoring-save.mjs";
import tpApprove from "./_impl/admin-test-package-approve.mjs";
import tpList from "./_impl/admin-test-package-list.mjs";
import tpLatest from "./_impl/admin-test-package-latest.mjs";
import tpApproved from "./_impl/admin-test-package-approved.mjs";
import draftsGet from "./_impl/admin-authoring-drafts-get.mjs";
import packageHistory from "./_impl/admin-package-history.mjs";
import centreLinks from "./_impl/admin-centre-links.mjs";
import translations from "./_impl/admin-translations.mjs";
import tpConvert from "./_impl/admin-test-package-convert.mjs";

const routes = {
  "auth/login": login,
  "auth/change-password": changePassword,
  "auth/activate": activate,
  activity,
  "outdoor-pacing": outdoorPacing,
  "auth/session": authSession,
  "authoring-drafts/save": draftsSave,
  "authoring-drafts/list": draftsList,
  "authoring-drafts/latest": draftsLatest,
  "centre-links/register": centreLinksRegister,
  "centre-links/list": centreLinks,
  "centre-links/save": centreLinks,
  "centre-links/delete": centreLinks,
  // Called by a CENTRE session (not Admin) to report that its exam was closed/archived.
  "centre-links/mark": centreLinks,
  "test-package/authoring/save": tpAuthoringSave,
  "test-package/convert": tpConvert,
  "test-package/approve": tpApprove,
  "test-package/list": tpList,
  "test-package/latest": tpLatest,
  "test-package/approved": tpApproved,
  "translations/overrides": translations,
};

export default async function handler(request, response) {
  const raw = request.query?.path;
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/").filter(Boolean);
  const key = parts.join("/");

  // Exact static routes first.
  let fn = routes[key];
  // Then dynamic patterns.
  if (!fn && (key === "package-history" || key.startsWith("package-history/"))) fn = packageHistory;
  if (!fn && key.startsWith("authoring-drafts/")) fn = draftsGet; // /<id> (save|list|latest handled above)
  if (!fn) return response.status(404).json({ error: `Unknown admin route: ${key}` });
  return fn(request, response);
}
