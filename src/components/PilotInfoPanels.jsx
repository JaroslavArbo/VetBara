import { useState } from "react";

function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function DismissButton({ onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tr(t, "common.close", "Close")}
      className="shrink-0 rounded-full p-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      ×
    </button>
  );
}

export function CandidateQuickHelp({ t }) {
  const [dismissed, setDismissed] = useState(false);
  const items = [
    ["help.candidate.qr", "Scan your personal Candidate QR issued by the Centre."],
    ["help.candidate.identity", "Confirm your identity before opening sections."],
    ["help.candidate.ask", "If something looks wrong, ask Centre staff before final submit."],
  ];

  if (dismissed) return null;

  return (
    <div className="mb-4 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{tr(t, "help.candidate.title", "Candidate quick help")}</h3>
        <DismissButton onClick={() => setDismissed(true)} t={t} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([key, fallback]) => <div key={key} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{tr(t, key, fallback)}</div>)}
      </div>
    </div>
  );
}

export function ExaminerQuickHelp({ t }) {
  const [dismissed, setDismissed] = useState(false);
  const items = [
    ["help.examiner.qr", "Scan your personal Examiner QR issued by the Centre."],
    ["help.examiner.identity", "Confirm your identity before opening outdoor forms."],
    ["help.examiner.assigned", "Only assigned Candidates are shown."],
    ["help.examiner.primary", "Primary Examiner completes the full outdoor form; Secondary input is supporting."],
    ["help.examiner.missing", "If assigned Candidates are missing, ask the Centre to assign and save Centre Setup."],
  ];

  if (dismissed) return null;

  return (
    <div className="mb-4 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{tr(t, "help.examiner.title", "Examiner quick help")}</h3>
        <DismissButton onClick={() => setDismissed(true)} t={t} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([key, fallback]) => <div key={key} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{tr(t, key, fallback)}</div>)}
      </div>
    </div>
  );
}
