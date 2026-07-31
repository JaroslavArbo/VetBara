// Consolidated media API router → handlers in api/_impl.
import uploadUrl from "./_impl/media-upload-url.mjs";
import list from "./_impl/media-list.mjs";
import del from "./_impl/media-delete.mjs";

const routes = {
  "upload-url": uploadUrl,
  list,
  delete: del,
};

export default async function handler(request, response) {
  const raw = request.query?.path;
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/").filter(Boolean);
  const key = parts.join("/");
  const fn = routes[key];
  if (!fn) return response.status(404).json({ error: `Unknown media route: ${key}` });
  return fn(request, response);
}
