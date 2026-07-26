// Pure validation/summary helpers for exam packages and authoring drafts.
// Kept identical to the dev-server logic in vite.config.js so dev and prod agree.

export function validateCertificationPackage(data) {
  const issues = [];

  const pwCount = data?.written?.Practicing?.questions?.length ?? 0;
  const pwMax = data?.variants?.Practicing?.writtenMax ?? 0;
  const cwCount = data?.written?.Consulting?.questions?.length ?? 0;
  const cwMax = data?.variants?.Consulting?.writtenMax ?? 0;

  if (pwCount !== 34 || Number(pwMax) !== 46) {
    issues.push(`Practicing written expected 34 questions / 46 marks, got ${pwCount} / ${pwMax}`);
  }
  if (cwCount !== 45 || Number(cwMax) !== 97) {
    issues.push(`Consulting written expected 45 questions / 97 marks, got ${cwCount} / ${cwMax}`);
  }

  return { status: issues.length ? "requires_review" : "valid", issues, checkedAt: new Date().toISOString() };
}

export function summarizeCertificationPackage(data, filename = "") {
  return {
    packageId: data.packageId,
    createdAt: data.createdAt,
    filename,
    variants: data.variants,
    sourceFiles: data.sourceFiles,
    validation: data.validation,
    approval: data.approval,
  };
}

export function validateAuthoringDraft(draft) {
  if (!draft || draft.kind !== "vetbara.structuredAuthoringDraft.v1") {
    throw new Error("Invalid VetBara structured authoring draft");
  }
  if (!draft.documents || typeof draft.documents !== "object") {
    throw new Error("Authoring draft is missing documents");
  }
}

export function summarizeAuthoringDraft(draft, filename = "") {
  const docs = draft?.documents || {};
  const docSummaries = {};
  for (const [key, doc] of Object.entries(docs)) {
    const list = Array.isArray(doc?.questions) ? doc.questions : Array.isArray(doc?.exercises) ? doc.exercises : [];
    docSummaries[key] = { count: list.length, max: list.reduce((sum, item) => sum + Number(item?.max || 0), 0) };
  }
  return {
    draftId: draft?.draftId || draft?.packageId,
    packageId: draft?.packageId,
    title: draft?.title,
    version: draft?.version,
    language: draft?.language,
    createdAt: draft?.createdAt,
    updatedAt: draft?.updatedAt,
    storedAt: draft?.storedAt,
    filename,
    documents: docSummaries,
  };
}
