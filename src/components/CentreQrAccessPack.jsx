import React from "react";

function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function candidateAccessUrl(candidate, candidateQrUrl, candidateQrFor) {
  return String(candidateQrUrl(candidate.id) || candidateQrFor(candidate.id) || "");
}

function examinerAccessUrl(examiner, examinerQrUrl, examinerQrFor) {
  return String(examinerQrUrl(examiner.id) || examinerQrFor(examiner.id) || "");
}

export function CentreQrAccessPack({ candidates, examiners, candidateQrUrl, examinerQrUrl, candidateQrFor, examinerQrFor, copiedQr, copyQrLink, QrCodeIcon, SectionTitle, StatusPill, Button, RealQr, t, onPrintAllQr, onPrintCandidateTest }) {
  return (
    <div className="mt-4 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          icon={QrCodeIcon}
          title={tr(t, "qr.title", "Centre / QR access pack")}
          subtitle={tr(t, "qr.subtitle", "Give each Candidate or Examiner only their own Candidate QR or Examiner QR link.")}
        />
        {onPrintAllQr && (
          <Button onClick={onPrintAllQr} className="rounded-2xl">
            {tr(t, "qr.printAll", "Tisk všech QR kódů")}
          </Button>
        )}
      </div>
      {copiedQr && <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{copiedQr}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 font-semibold">{tr(t, "qr.candidateLinks", "Candidate QR links")}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {candidates.map((c) => {
              const accessUrl = candidateAccessUrl(c, candidateQrUrl, candidateQrFor);
              return (
                <div key={c.id} className="rounded-2xl border bg-white p-3">
                  <div className="flex gap-3">
                    <RealQr value={accessUrl} size={96} />
                    <div className="min-w-0">
                      <div className="font-semibold">{c.id} / {c.name}</div>
                      <div className="text-sm text-slate-600">{c.level}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button onClick={() => copyQrLink(c.id, accessUrl)} variant="outline" className="rounded-2xl">{tr(t, "qr.copy", "Copy link")}</Button>
                        {onPrintCandidateTest && <Button onClick={() => onPrintCandidateTest(c)} variant="outline" className="rounded-2xl">{tr(t, "qr.printTest", "Tisk testu")}</Button>}
                      </div>
                      <div className="mt-2 break-all font-mono text-[10px] text-slate-500">{accessUrl}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-semibold">{tr(t, "qr.examinerLinks", "Examiner QR links")}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {examiners.map((ex) => {
              const accessUrl = examinerAccessUrl(ex, examinerQrUrl, examinerQrFor);
              return (
                <div key={ex.id} className="rounded-2xl border bg-white p-3">
                  <div className="flex gap-3">
                    <RealQr value={accessUrl} size={96} />
                    <div className="min-w-0">
                      <div className="font-semibold">{ex.id} / {ex.name}</div>
                      <div className="text-sm text-slate-600">{ex.registrationId}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button onClick={() => copyQrLink(ex.id, accessUrl)} variant="outline" className="rounded-2xl">{tr(t, "qr.copy", "Copy link")}</Button>
                      </div>
                      <div className="mt-2 break-all font-mono text-[10px] text-slate-500">{accessUrl}</div>
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
