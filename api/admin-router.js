// Consolidated Admin API router (Hobby plan caps serverless functions at 12).
// One function dispatches every /api/admin/* route to its handler in api/_impl
// (underscore dir → not counted as a function by Vercel).
import login from "./_impl/admin-auth-login.mjs";
import changePassword from "./_impl/admin-auth-change-password.mjs";
import draftsSave from "./_impl/admin-authoring-drafts-save.mjs";
import draftsList from "./_impl/admin-authoring-drafts-list.mjs";
import draftsLatest from "./_impl/admin-authoring-drafts-latest.mjs";
import centreLinksRegister from "./_impl/admin-centre-links-register.mjs";
import tpAuthoringSave from "./_impl/admin-test-package-authoring-save.mjs";
import tpApprove from "./_impl/admin-test-package-approve.mjs";
import tpList from "./_impl/admin-test-package-list.mjs";
import tpLatest from "./_impl/admin-test-package-latest.mjs";
import tpApproved from "./_impl/admin-test-package-approved.mjs";

const routes = {
  "auth/login": login,
  "auth/change-password": changePassword,
  "authoring-drafts/save": draftsSave,
  "authoring-drafts/list": draftsList,
  "authoring-drafts/latest": draftsLatest,
  "centre-links/register": centreLinksRegister,
  "test-package/authoring/save": tpAuthoringSave,
  "test-package/approve": tpApprove,
  "test-package/list": tpList,
  "test-package/latest": tpLatest,
  "test-package/approved": tpApproved,
};

export default async function handler(request, response) {
  const raw = request.query?.path;
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/").filter(Boolean);
  const key = parts.join("/");
  const fn = routes[key];
  if (!fn) return response.status(404).json({ error: `Unknown admin route: ${key}` });
  return fn(request, response);
}
