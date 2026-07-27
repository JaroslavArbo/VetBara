import { envReady, supabase, sendJson, resolveAdminSession } from "../_lib/backend.mjs";
import { summarizeCertificationPackage } from "../_lib/packages.mjs";
import { makeCertificationPackage } from "./pdf-package.mjs";

// Convert 4 exam PDFs into a certification package. Clean JSON transport: the
// client sends each PDF base64-encoded (no multipart), so it is verifiable and
// portable to Vercel. Admin session required.
//
// pdf-parse is imported lazily (only when a PDF is actually decoded) so it never
// loads on the auth/empty-payload paths and so any load/runtime failure surfaces
// as a JSON error inside the handler's try/catch instead of a platform 500.
async function pdfText(base64) {
  if (!base64) return "";
  const b64 = String(base64).includes(",") ? String(base64).split(",").pop() : base64;
  const buffer = Buffer.from(b64, "base64");
  if (!buffer.length) return "";
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || "";
  } finally {
    await parser.destroy?.();
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 503, { error: "Backend not configured" });
  if (!(await resolveAdminSession(request.body?.sessionToken))) return sendJson(response, 401, { error: "Admin session required" });

  const files = request.body?.files || {};
  if (!files.practicingWritten && !files.consultingWritten && !files.practicingOutdoor && !files.consultingOutdoor) {
    return sendJson(response, 400, { error: "No PDF files provided" });
  }

  try {
    const [practicingWrittenText, consultingWrittenText, practicingOutdoorText, consultingOutdoorText] = await Promise.all([
      pdfText(files.practicingWritten),
      pdfText(files.consultingWritten),
      pdfText(files.practicingOutdoor),
      pdfText(files.consultingOutdoor),
    ]);

    const sourceFiles = request.body?.sourceFiles || {
      practicingWritten: files.practicingWritten ? "practicing-written.pdf" : "",
      consultingWritten: files.consultingWritten ? "consulting-written.pdf" : "",
      practicingOutdoor: files.practicingOutdoor ? "practicing-outdoor.pdf" : "",
      consultingOutdoor: files.consultingOutdoor ? "consulting-outdoor.pdf" : "",
    };

    const data = makeCertificationPackage({ practicingWrittenText, consultingWrittenText, practicingOutdoorText, consultingOutdoorText, sourceFiles });
    data.contentSource = "admin-pdf-convert";

    await supabase("certification_packages?on_conflict=package_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        package_id: data.packageId,
        created_at: data.createdAt,
        content_source: data.contentSource,
        validation: data.validation,
        active_for_centre: false,
        data,
        updated_at: data.createdAt,
      }),
    });

    return sendJson(response, 201, { ok: true, package: data, summary: summarizeCertificationPackage(data) });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "PDF conversion failed" });
  }
}
