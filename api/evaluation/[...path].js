// Consolidated evaluation API router → handlers in api/_impl.
import calculate from "../_impl/evaluation-calculate.mjs";
import candidate from "../_impl/evaluation-candidate.mjs";
import exportEvaluation from "../_impl/evaluation-export.mjs";

const routes = {
  calculate,
  candidate,
  export: exportEvaluation,
};

export default async function handler(request, response) {
  const raw = request.query?.path;
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/").filter(Boolean);
  const key = parts.join("/");
  const fn = routes[key];
  if (!fn) return response.status(404).json({ error: `Unknown evaluation route: ${key}` });
  return fn(request, response);
}
