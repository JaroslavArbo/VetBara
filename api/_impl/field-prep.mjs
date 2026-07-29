// Pure field-preparation helpers, ported verbatim from vite.config.js so dev and
// prod behave identically. examId is passed in (was a closure in the dev mock).

export function validateFieldPreparation(prep) {
  const issues = [];
  const hasNumber = (value) => Number.isFinite(Number(value));
  if (!hasNumber(prep?.examCenter?.point?.lat) || !hasNumber(prep?.examCenter?.point?.lng)) {
    issues.push({ severity: "error", code: "MISSING_CENTER_COORDINATES", message: "Zkušební centrum nemá platné GPS souřadnice." });
  }
  const levels = ["Practicing", "Consulting"];
  const codes = ["A", "B", "C", "D"];
  for (const level of levels) {
    for (const code of codes) {
      const matches = (prep?.trees || []).filter((tree) => (tree.assignments || []).some((assignment) => assignment.level === level && assignment.code === code));
      if (!matches.length) issues.push({ severity: "error", code: `MISSING_${level.toUpperCase()}_${code}`, message: `Chybí ${level} strom ${code}.` });
      if (matches.length > 1) issues.push({ severity: "warning", code: `DUPLICATE_${level.toUpperCase()}_${code}`, message: `${level} strom ${code} je přiřazen více než jednou.` });
    }
  }
  const practicingA = (prep?.trees || []).find((tree) => (tree.assignments || []).some((assignment) => assignment.level === "Practicing" && assignment.code === "A"));
  const data = practicingA?.practicingTreeAData;
  if (!data) issues.push({ severity: "error", code: "MISSING_PRACTICING_A_DATA", message: "Practicing A nemá vyplněná management data." });
  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}

function applyFieldPreparationSnapshot(prep, syncPayload, examId) {
  const snapshot = syncPayload?.fieldPreparationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const now = new Date().toISOString();
  const current = prep && typeof prep === "object" ? prep : {};
  const centre = snapshot.examCenter && typeof snapshot.examCenter === "object" ? snapshot.examCenter : {};
  const centrePoint = centre.point && typeof centre.point === "object" ? centre.point : {};
  const centreLat = Number(centrePoint.lat ?? centrePoint.latitude ?? centre.latitude ?? centre.lat);
  const centreLng = Number(centrePoint.lng ?? centrePoint.longitude ?? centre.longitude ?? centre.lng);
  const referenceLatitude = Number(snapshot.referenceLatitude ?? snapshot.mapView?.center?.lat ?? current.referenceLatitude ?? centreLat);
  const referenceLongitude = Number(snapshot.referenceLongitude ?? snapshot.mapView?.center?.lng ?? current.referenceLongitude ?? centreLng);
  const trees = Array.isArray(snapshot.trees) ? snapshot.trees : [];
  return {
    ...current,
    examId: snapshot.examId || current.examId || examId,
    siteName: snapshot.siteName || current.siteName || "",
    referenceLatitude,
    referenceLongitude,
    updatedAt: now,
    updatedBy: "Field tablet sync",
    lastTabletSyncId: syncPayload?.syncId || null,
    lastTabletSyncAt: syncPayload?.receivedAt || syncPayload?.syncedAt || now,
    examCenter: {
      ...(current.examCenter || {}),
      ...centre,
      point: { ...(current.examCenter?.point || {}), ...(centrePoint || {}), lat: centreLat, lng: centreLng },
    },
    trees: trees.map((tree, index) => {
      const point = tree.point && typeof tree.point === "object" ? tree.point : {};
      const lat = Number(point.lat ?? point.latitude ?? tree.latitude ?? tree.lat);
      const lng = Number(point.lng ?? point.longitude ?? tree.longitude ?? tree.lng);
      const assignments = Array.isArray(tree.assignments) && tree.assignments.length
        ? tree.assignments
        : [{ level: tree.level || "Practicing", code: tree.code || String.fromCharCode(65 + (index % 4)), visibleToCandidate: true }];
      return {
        ...tree,
        id: tree.id || `field-tree-${index + 1}`,
        name: tree.name || `Strom ${index + 1}`,
        assignments,
        point: { ...(point || {}), lat, lng },
        candidateNote: tree.candidateNote || "",
        practicingTreeAData: tree.practicingTreeAData || tree.managementData || { interventions: [] },
        labelDirection: tree.labelDirection || "n",
        labelOffsetX: Number(tree.labelOffsetX || 0),
        labelOffsetY: Number(tree.labelOffsetY || 0),
        photos: Array.isArray(tree.photos) ? tree.photos.filter((photo) => photo && (photo.url || photo.dataUrl)) : [],
      };
    }),
  };
}

export function mergeTabletSyncIntoPreparation(prep, syncPayload, examId) {
  const snapshotApplied = applyFieldPreparationSnapshot(prep, syncPayload, examId);
  if (snapshotApplied) return snapshotApplied;
  if (!prep || typeof prep !== "object") return prep;
  const draft = syncPayload?.draft && typeof syncPayload.draft === "object" ? syncPayload.draft : {};
  const treeNotes = draft.treeNotes && typeof draft.treeNotes === "object" ? draft.treeNotes : {};
  const packageSnapshot = syncPayload?.packageSnapshot && typeof syncPayload.packageSnapshot === "object" ? syncPayload.packageSnapshot : {};
  const packageTrees = Array.isArray(packageSnapshot.trees) ? packageSnapshot.trees : [];
  const now = new Date().toISOString();

  function treeKey(level, code) {
    const normalizedLevel = String(level || "Practicing").toLowerCase() === "consulting" ? "Consulting" : "Practicing";
    return `${normalizedLevel}:${String(code || "").trim().toUpperCase()}`;
  }
  function noteFor(level, code) {
    const codeOnly = String(code || "").trim().toUpperCase();
    const normalizedLevel = String(level || "Practicing").toLowerCase() === "consulting" ? "Consulting" : "Practicing";
    // The tablet keys its draft notes "Level-CODE" (fieldTreeKey); accept that alongside the
    // legacy "Level:CODE" and bare-code shapes — the colon-only lookup silently dropped every
    // tablet note when a payload arrived without a full fieldPreparationSnapshot.
    return treeNotes[`${normalizedLevel}:${codeOnly}`] || treeNotes[`${normalizedLevel}-${codeOnly}`] || treeNotes[codeOnly] || null;
  }
  function snapshotFor(level, code) {
    const wanted = treeKey(level, code);
    return packageTrees.find((tree) => treeKey(tree.level || level, tree.code) === wanted) || null;
  }

  const next = { ...prep, updatedAt: now, updatedBy: "Field tablet sync" };

  const centerDraft = draft.examCenter && typeof draft.examCenter === "object" ? draft.examCenter : {};
  const centerLat = Number(centerDraft.latitude ?? centerDraft.lat);
  const centerLng = Number(centerDraft.longitude ?? centerDraft.lng);
  if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
    next.examCenter = {
      ...(next.examCenter || {}),
      point: {
        ...(next.examCenter?.point || {}),
        lat: centerLat,
        lng: centerLng,
        x: Math.min(96, Math.max(4, 50 + ((centerLng - Number(next.referenceLongitude || centerLng)) / 0.000026))),
        y: Math.min(92, Math.max(8, 50 - ((centerLat - Number(next.referenceLatitude || centerLat)) / 0.000018))),
      },
    };
  }

  next.trees = (Array.isArray(prep.trees) ? prep.trees : []).map((tree) => {
    const assignments = Array.isArray(tree.assignments) ? tree.assignments : [];
    let merged = { ...tree };
    for (const assignment of assignments) {
      const n = noteFor(assignment.level, assignment.code);
      const snapshot = snapshotFor(assignment.level, assignment.code);
      const lat = Number(n?.latitude ?? snapshot?.latitude);
      const lng = Number(n?.longitude ?? snapshot?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const refLat = Number(next.referenceLatitude ?? next.examCenter?.point?.lat);
        const refLng = Number(next.referenceLongitude ?? next.examCenter?.point?.lng);
        const x = Number.isFinite(refLng) ? Math.min(96, Math.max(4, 50 + ((lng - refLng) / 0.000026))) : merged.point?.x;
        const y = Number.isFinite(refLat) ? Math.min(92, Math.max(8, 50 - ((lat - refLat) / 0.000018))) : merged.point?.y;
        merged = { ...merged, point: { ...(merged.point || {}), lat, lng, x, y } };
      }
      if (n?.treeName) merged.name = n.treeName;
      if (n?.candidateNote !== undefined) merged.candidateNote = n.candidateNote;
      if (n?.managementData && typeof n.managementData === "object") {
        merged.practicingTreeAData = { ...(merged.practicingTreeAData || {}), ...n.managementData };
      }
      if (n?.labelDirection) merged.labelDirection = n.labelDirection;
      if (n?.labelOffsetX !== undefined) merged.labelOffsetX = Number(n.labelOffsetX || 0);
      if (n?.labelOffsetY !== undefined) merged.labelOffsetY = Number(n.labelOffsetY || 0);
    }
    return merged;
  });

  return next;
}

export function candidatePackage(prep, level, examId) {
  const normalizedLevel = level === "practicing" ? "Practicing" : "Consulting";
  const trees = (prep?.trees || []).flatMap((tree) => (tree.assignments || [])
    .filter((assignment) => assignment.level === normalizedLevel && assignment.visibleToCandidate !== false)
    .map((assignment) => ({
      id: tree.id,
      code: assignment.code,
      name: tree.name,
      latitude: Number(tree.point?.lat),
      longitude: Number(tree.point?.lng),
      candidateNote: tree.candidateNote || "",
      photos: (tree.photos || []).map((photo) => ({ id: photo.id, fileName: photo.fileName || photo.name, url: photo.url, thumbnailUrl: photo.thumbnailUrl, caption: photo.caption || "" })),
      practicingTreeAData: tree.practicingTreeAData,
    })));
  return {
    packageType: "vetbara-field-exam",
    packageVersion: "1.0",
    examId: prep.examId || examId,
    level: normalizedLevel.toUpperCase(),
    siteName: prep.siteName,
    createdAt: new Date().toISOString(),
    examCenter: {
      latitude: Number(prep.examCenter?.point?.lat),
      longitude: Number(prep.examCenter?.point?.lng),
      candidateNote: prep.examCenter?.candidateNote || "",
      photos: prep.examCenter?.photos || [],
    },
    trees: trees.sort((a, b) => String(a.code).localeCompare(String(b.code))),
  };
}
