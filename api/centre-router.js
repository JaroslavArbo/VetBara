// Consolidated Centre API router → handlers in api/_impl. Folded five separate api/centre/* files
// into one function to stay under the Vercel Hobby 12-serverless-function cap (they had pushed the
// count to 15, which made the build succeed but "Deploying outputs" fail, so nothing reached
// production). vercel.json rewrites /api/centre/(.*) → /api/centre-router?path=$1; the dev API
// plugin mirrors the same rewrite from vercel.json.
import setup from "./_impl/centre-setup.mjs";
import audit from "./_impl/centre-audit.mjs";
import auditExport from "./_impl/centre-audit-export.mjs";
import resetQrPin from "./_impl/centre-reset-qr-pin.mjs";
import testPackageActive from "./_impl/centre-test-package-active.mjs";
import accounts from "./_impl/centre-accounts.mjs";

const routes = {
  setup,
  audit,
  "audit-export": auditExport,
  "reset-qr-pin": resetQrPin,
  "test-package/active": testPackageActive,
  accounts,
};

export default async function handler(request, response) {
  const raw = request.query?.path;
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/").filter(Boolean);
  const key = parts.join("/");
  const fn = routes[key];
  if (!fn) return response.status(404).json({ error: `Unknown centre route: ${key}` });
  return fn(request, response);
}
