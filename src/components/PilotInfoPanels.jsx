import { useState } from "react";

function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function DismissButton({ onClick, t, labelKey = "common.close", labelFallback = "Close" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tr(t, labelKey, labelFallback)}
      className="shrink-0 rounded-full p-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      ×
    </button>
  );
}

export function CandidateQuickHelp({ t }) {
  // Minimizes rather than dismisses (the candidate may want to check it again mid-exam) - a small
  // reopenable pill instead of losing the panel outright.
  const [minimized, setMinimized] = useState(false);
  const items = [
    ["help.candidate.qr", "Scan your personal Candidate QR issued by the Centre."],
    ["help.candidate.identity", "Confirm your identity before opening sections."],
    ["help.candidate.fullscreen", "Do not leave fullscreen mode during the exam."],
    ["help.candidate.finish", "When you finish, send your data to the server and log out."],
    ["help.candidate.ask", "If something looks wrong, ask Centre staff before final submit."],
  ];

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="mb-4 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        {tr(t, "help.candidate.title", "Candidate quick help")}
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{tr(t, "help.candidate.title", "Candidate quick help")}</h3>
        <DismissButton onClick={() => setMinimized(true)} t={t} labelKey="help.minimize" labelFallback="Minimize" />
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
