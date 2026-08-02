import React from "react";

function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

// ONLY a server-minted access URL may be shown here. The old fallback synthesised
// `VETBARA-<ROLE>-<ID>-2026`, which is a real token for exactly two seeded demo subjects
// (C-001 / E-001) and an invalid one for everybody else — yet it looked completely plausible,
// so the Centre handed out dead links (e.g. the E-002 link that resolved to "Invalid or expired
// QR token"). A missing link must read as missing, never as a guess.
function accessUrlFor(id, realUrlLookup) {
  return String(realUrlLookup(id) || "");
}

function DeliveryModeToggle({ mode, onChange, t }) {
  return (
    <div className="inline-flex rounded-2xl border bg-slate-50 p-0.5 text-xs font-semibold">
      <button type="button" onClick={() => onChange("print")} className={`rounded-2xl px-3 py-1 ${mode === "print" ? "bg-white shadow-sm" : "text-slate-500"}`}>{tr(t, "qr.delivery.print", "Tištěné podklady")}</button>
      <button type="button" onClick={() => onChange("tablet")} className={`rounded-2xl px-3 py-1 ${mode === "tablet" ? "bg-white shadow-sm" : "text-slate-500"}`}>{tr(t, "qr.delivery.tablet", "Tablet")}</button>
    </div>
  );
}

export function CentreQrAccessPack({ candidates, examiners, candidateQrUrl, examinerQrUrl, candidateQrFor, examinerQrFor, copiedQr, copyQrLink, QrCodeIcon, SectionTitle, StatusPill, Button, RealQr, t, onPrintAllQr, onPrintAllTests, onPrintCandidateTest }) {
  // Per-person, not per-section: a Centre handing out links often mixes delivery for the same
  // roster (e.g. one candidate already has their own tablet, the rest get a printed QR) - a single
  // toggle for the whole list couldn't represent that.
  const [candidateModes, setCandidateModes] = React.useState({});
  const [examinerModes, setExaminerModes] = React.useState({});
  return (
    <div className="mt-4 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          icon={QrCodeIcon}
          title={tr(t, "qr.title", "Centre / QR access pack")}
          subtitle={tr(t, "qr.subtitle", "Give each Candidate or Examiner only their own Candidate QR or Examiner QR link.")}
        />
        <div className="flex flex-wrap gap-2">
          {onPrintAllQr && (
            <Button onClick={onPrintAllQr} className="rounded-2xl">
              {tr(t, "qr.printAll", "Tisk všech QR kódů")}
            </Button>
          )}
          {onPrintAllTests && (
            <Button onClick={onPrintAllTests} variant="outline" className="rounded-2xl">
              {tr(t, "qr.printAllTests", "Tisk všech testů")}
            </Button>
          )}
        </div>
      </div>
      {copiedQr && <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{copiedQr}</div>}
      <div className="space-y-6">
        <div>
          <div className="mb-3">
            <h3 className="font-semibold">{tr(t, "qr.candidateLinks", "Candidate QR links")}</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {candidates.map((c) => {
              const accessUrl = accessUrlFor(c.id, candidateQrUrl);
              const mode = candidateModes[c.id] ?? "print";
              // Consulting candidates get a second, dedicated link for the mobile report field-data
              // page (photos + audio for Tree A/B) - meant to be scanned with their own phone while
              // their main candidate session for Test/Outdoor stays on the shared exam tablet.
              const mobileFieldUrl = c.level === "Consulting" && accessUrl
                ? (() => { try { const u = new URL(accessUrl); u.searchParams.set("mode", "consulting-field"); return u.toString(); } catch { return ""; } })()
                : "";
              return (
                <div key={c.id} className="rounded-2xl border bg-white p-3">
                  <div className="mb-2">
                    <div className="font-semibold">{c.id} / {c.name}</div>
                    <div className="mt-1 flex justify-end">
                      <DeliveryModeToggle mode={mode} onChange={(m) => setCandidateModes((prev) => ({ ...prev, [c.id]: m }))} t={t} />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {mode === "print"
                      ? (accessUrl ? <RealQr value={accessUrl} size={96} /> : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-amber-400 bg-amber-50 p-1 text-center text-[10px] font-semibold text-amber-800">{tr(t, "qr.missingShort", "No link yet")}</div>)
                      : null}
                    <div className="min-w-0">
                      <div className="text-sm text-slate-600">{c.level}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mode === "tablet"
                          ? <Button onClick={() => accessUrl && window.open(accessUrl, "_blank", "noopener")} disabled={!accessUrl} className="rounded-2xl">{tr(t, "qr.openOnTablet", "Otevřít na tabletu")}</Button>
                          : null}
                        <Button onClick={() => copyQrLink(c.id, accessUrl)} disabled={!accessUrl} variant="outline" className="rounded-2xl">{tr(t, "qr.copy", "Copy link")}</Button>
                        {onPrintCandidateTest && <Button onClick={() => onPrintCandidateTest(c)} variant="outline" className="rounded-2xl">{tr(t, "qr.printTest", "Tisk testu")}</Button>}
                      </div>
                      {accessUrl
                        ? <div className="mt-2 break-all font-mono text-[10px] text-slate-500">{accessUrl}</div>
                        : <div className="mt-2 text-[11px] font-medium text-amber-800">{tr(t, "qr.missing", "Save the Centre setup to issue this person's access link.")}</div>}
                    </div>
                  </div>
                  {mobileFieldUrl && (
                    <div className="mt-3 flex items-center gap-3 border-t pt-3">
                      <RealQr value={mobileFieldUrl} size={64} />
                      <div className="min-w-0">
                        <div className="mb-1 text-xs font-semibold text-slate-600">{tr(t, "qr.consultingField.label", "Mobilní sběr dat (report)")}</div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => window.open(mobileFieldUrl, "_blank", "noopener")} variant="outline" className="rounded-2xl">{tr(t, "qr.consultingField.open", "Otevřít")}</Button>
                          <Button onClick={() => copyQrLink(`${c.id}-field`, mobileFieldUrl)} variant="outline" className="rounded-2xl">{tr(t, "qr.copy", "Copy link")}</Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-3">
            <h3 className="font-semibold">{tr(t, "qr.examinerLinks", "Examiner QR links")}</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {examiners.map((ex) => {
              const accessUrl = accessUrlFor(ex.id, examinerQrUrl);
              const mode = examinerModes[ex.id] ?? "print";
              return (
                <div key={ex.id} className="rounded-2xl border bg-white p-3">
                  <div className="mb-2">
                    <div className="font-semibold">{ex.id} / {ex.name}</div>
                    <div className="mt-1 flex justify-end">
                      <DeliveryModeToggle mode={mode} onChange={(m) => setExaminerModes((prev) => ({ ...prev, [ex.id]: m }))} t={t} />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {mode === "print"
                      ? (accessUrl ? <RealQr value={accessUrl} size={96} /> : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-amber-400 bg-amber-50 p-1 text-center text-[10px] font-semibold text-amber-800">{tr(t, "qr.missingShort", "No link yet")}</div>)
                      : null}
                    <div className="min-w-0">
                      <div className="text-sm text-slate-600">{ex.registrationId}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mode === "tablet"
                          ? <Button onClick={() => accessUrl && window.open(accessUrl, "_blank", "noopener")} disabled={!accessUrl} className="rounded-2xl">{tr(t, "qr.openOnTablet", "Otevřít na tabletu")}</Button>
                          : null}
                        <Button onClick={() => copyQrLink(ex.id, accessUrl)} disabled={!accessUrl} variant="outline" className="rounded-2xl">{tr(t, "qr.copy", "Copy link")}</Button>
                      </div>
                      {accessUrl
                        ? <div className="mt-2 break-all font-mono text-[10px] text-slate-500">{accessUrl}</div>
                        : <div className="mt-2 text-[11px] font-medium text-amber-800">{tr(t, "qr.missing", "Save the Centre setup to issue this person's access link.")}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
