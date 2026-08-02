async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  } catch (networkError) {
    // fetch() itself threw: no response reached us at all (offline, DNS failure, LAN server
    // down). Callers use this flag to decide whether a local/offline fallback is appropriate.
    const error = new Error(networkError?.message || "Network request failed");
    error.isBackendUnavailable = true;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    // 404 means this deployment simply has no backend implementing this API (e.g. plain `vite
    // dev` without the Vercel/Supabase or LAN-portable backend) -- that's "unavailable", not a
    // rejection, so local/offline fallback is still appropriate. Any other non-2xx (401, 403,
    // 400, 500...) means a real backend looked at the request and explicitly said no; callers
    // must respect that and must NOT fall back to local/offline access as if it had just been
    // unreachable.
    const message = typeof body === "object" && body?.error ? body.error : `Request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.isBackendUnavailable = response.status === 404;
    // Carries any extra flags a handler sent alongside its error (e.g. requiresPin,
    // deviceLimitReached on /api/qr/resolve) so callers can react without re-parsing.
    if (typeof body === "object" && body) error.body = body;
    throw error;
  }

  return body;
}

export function resolveQrToken(token, { deviceId, pin } = {}) {
  return requestJson("/api/qr/resolve", {
    method: "POST",
    body: JSON.stringify({ token, deviceId, pin }),
  });
}

export function setQrPin(sessionToken, pin) {
  return requestJson("/api/qr/set-pin", {
    method: "POST",
    body: JSON.stringify({ sessionToken, pin }),
  });
}

export function resetQrPin(sessionToken, role, subjectId) {
  return requestJson("/api/centre/reset-qr-pin", {
    method: "POST",
    body: JSON.stringify({ sessionToken, role, subjectId }),
  });
}

export function bootstrapSession(sessionToken) {
  return requestJson("/api/session/bootstrap", {
    method: "POST",
    body: JSON.stringify({ sessionToken }),
  });
}

export function loadCentreSetup(sessionToken) {
  return requestJson("/api/centre/setup", {
    method: "POST",
    body: JSON.stringify({ sessionToken, action: "load" }),
  });
}

export function saveCentreSetup(sessionToken, { candidates, examiners, assignments }) {
  return requestJson("/api/centre/setup", {
    method: "POST",
    body: JSON.stringify({ sessionToken, action: "save", candidates, examiners, assignments }),
  });
}

export function syncBatch(sessionToken, events) {
  return requestJson("/api/sync/batch", {
    method: "POST",
    body: JSON.stringify({ sessionToken, events }),
  });
}

export function fetchCandidateEvaluation(sessionToken, candidateId) {
  return requestJson("/api/evaluation/candidate", {
    method: "POST",
    body: JSON.stringify({ sessionToken, candidateId }),
  });
}

export function exportCandidateEvaluation(sessionToken, candidateId, format = "xls") {
  return requestJson("/api/evaluation/export", {
    method: "POST",
    body: JSON.stringify({ sessionToken, candidateId, format }),
  });
}

export function exportCentreAuditPackage(sessionToken, format = "xls") {
  return requestJson("/api/centre/audit-export", {
    method: "POST",
    body: JSON.stringify({ sessionToken, format }),
  });
}

// The persistent, exam-wide activity log - every addAudit() call on any device (Candidate,
// Examiner, Centre) also syncs as an "audit.logged" event; this reads it back so the Centre's own
// audit view survives a page reload instead of only showing what happened in the current tab.
export function fetchCentreAudit(sessionToken) {
  return requestJson("/api/centre/audit", {
    method: "POST",
    body: JSON.stringify({ sessionToken }),
  });
}

export function downloadBase64File({ base64, filename, mimeType }) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename || "VetBara_Evaluation_Draft.xls";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

// --- Exam media (voice recordings + report/field photos) -------------------

// Ask the backend for a signed upload URL for one media object. Returns
// { ok, stored, demo?, uploadUrl?, path?, id? }. When `stored` is false the
// backend is not configured (demo/offline) and the caller keeps the local copy.
export function requestMediaUploadUrl(sessionToken, media) {
  return requestJson("/api/media/upload-url", {
    method: "POST",
    body: JSON.stringify({ sessionToken, media }),
  });
}

// Upload the raw bytes straight to Supabase Storage using the signed URL.
// This bypasses the serverless body-size limit, so long voice recordings work.
export async function uploadMediaBytes(uploadUrl, blob) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" },
        body: blob,
      });
    } catch (networkError) {
      // fetch() itself threw: no HTTP response reached us at all - most often the tablet's WiFi
      // hiccupping right as a large (14-27MB) recording's upload was finishing, which can drop
      // the connection just as the storage server is sending its response back even though it
      // already received every byte and saved the file. The upload target path is deterministic
      // from clientMediaId and x-upsert:true makes a re-PUT of the same bytes a no-op either way,
      // so a couple of automatic retries are safe and turn most of these into a quiet success
      // instead of a scary, untranslated "TypeError: Load failed" the examiner can't act on.
      if (attempt === maxAttempts) throw networkError;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      continue;
    }
    if (response.ok) return true;
    // A real HTTP error response (bad request, size limit, expired signature, ...) - retrying
    // the same request won't change the outcome, so it's reported immediately instead.
    // Storage's own error body carries the actual reason (e.g. "The object exceeded the
    // maximum allowed size") — without it every failure just says "Media upload failed: 400"
    // and there is no way to tell a bucket size limit apart from an expired signed URL.
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    let reason = detail;
    try { reason = JSON.parse(detail)?.message || JSON.parse(detail)?.error || detail; } catch { /* not JSON */ }
    const error = new Error(reason ? `Media upload failed (${response.status}): ${reason}` : `Media upload failed: ${response.status}`);
    error.status = response.status;
    error.reason = reason || null;
    throw error;
  }
  return true;
}

// Full best-effort upload: get a signed URL, then push the bytes. Resolves to
// { stored: boolean, demo?: boolean, id?, path? }. Never throws for the demo
// case; throws only on an unexpected backend/storage error.
export async function uploadExamMedia(sessionToken, media, blob) {
  const signed = await requestMediaUploadUrl(sessionToken, media);
  if (!signed?.stored || !signed.uploadUrl) {
    return { stored: false, demo: Boolean(signed?.demo) };
  }
  await uploadMediaBytes(signed.uploadUrl, blob);
  return { stored: true, id: signed.id ?? null, path: signed.path ?? null };
}

// Centre-only: list stored media with signed download URLs. Returns
// { ok, stored, demo?, media: [] }.
export function listExamMedia(sessionToken) {
  return requestJson("/api/media/list", {
    method: "POST",
    body: JSON.stringify({ sessionToken }),
  });
}

// Centre-only: permanently delete one exam media object (storage bytes + row).
export function deleteExamMedia(sessionToken, id) {
  return requestJson("/api/media/delete", {
    method: "POST",
    body: JSON.stringify({ sessionToken, id }),
  });
}

export async function generateEvaluation(sessionToken, payload) {
  const response = await fetch("/api/evaluation/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Evaluation failed: ${response.status}`);
  }

  return response.blob();
}
