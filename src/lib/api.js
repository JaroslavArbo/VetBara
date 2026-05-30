async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "object" && body?.error ? body.error : `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return body;
}

export function resolveQrToken(token) {
  return requestJson("/api/qr/resolve", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function bootstrapSession(sessionToken) {
  return requestJson("/api/session/bootstrap", {
    method: "POST",
    body: JSON.stringify({ sessionToken }),
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
