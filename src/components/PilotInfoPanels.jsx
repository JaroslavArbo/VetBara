import React from "react";

export function PilotSmokeTestChecklist({ StatusPill }) {
  const items = [
    "Load Centre Setup",
    "Confirm candidates and examiners are visible",
    "Import or verify test package",
    "Open Candidate QR and save a written test answer",
    "For Consulting Candidate, save report draft and pilot/archive placeholder",
    "Open Examiner QR and save outdoor score and note",
    "Load Evaluation Preview",
    "Download Draft Export",
    "Download Centre Audit Package",
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot smoke-test checklist</h3><p className="mt-1 text-sm text-slate-600">Use this after each deploy to confirm the pilot workflow still works.</p></div><div className="flex flex-wrap gap-2"><StatusPill>Pilot</StatusPill><StatusPill>Manual</StatusPill></div></div><div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{items.map((item) => <div key={item} className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{item}</div>)}</div></div>;
}


export function PilotReleaseNotesPanel({ StatusPill }) {
  const available = [
    "Centre Setup save/load",
    "Candidate and Examiner QR workspaces",
    "CSV/JSON test package import",
    "sample CSV/JSON downloads",
    "Candidate written test persistence",
    "Consulting report draft persistence",
    "Examiner outdoor score and note persistence",
    "Evaluation preview",
    "Draft Export",
    "Centre Audit Package",
    "Pilot workflow dashboard and smoke-test checklist",
  ];

  const notIncluded = [
    "official VETcert final certificate/result",
    "final PASS/FAIL decision workflow",
    "official VETcert export template",
    "real image upload/storage",
    "full multilingual production translation review",
    "production-grade user management",
    "offline conflict resolution UI",
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot release notes</h3><p className="mt-1 text-sm text-slate-600">This panel describes the pilot scope. It is not the official VETcert certification output.</p></div><StatusPill>Pilot scope</StatusPill></div><div className="grid gap-4 lg:grid-cols-2"><div><h4 className="mb-2 text-sm font-semibold">Available in this pilot</h4><div className="space-y-2">{available.map((item) => <div key={item} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{item}</div>)}</div></div><div><h4 className="mb-2 text-sm font-semibold">Not included yet</h4><div className="space-y-2">{notIncluded.map((item) => <div key={item} className="rounded-xl bg-amber-50 p-2 text-sm text-amber-950">{item}</div>)}</div></div></div></div>;
}

export function CandidateQuickHelp() {
  const points = [
    "Scan your personal Candidate QR issued by the Centre.",
    "Confirm your identity before opening sections.",
    "Written test answers autosave to the sync queue.",
    "Consulting report photo entries are pilot/archive placeholders, not real uploads yet.",
    "If something looks wrong, ask Centre staff before final submit.",
  ];

  return <div className="mb-4 rounded-2xl border bg-white p-4 text-sm"><h3 className="font-semibold">Candidate quick help</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{points.map((point) => <li key={point}>{point}</li>)}</ul></div>;
}

export function ExaminerQuickHelp() {
  const points = [
    "Scan your personal Examiner QR issued by the Centre.",
    "Confirm your identity before opening outdoor forms.",
    "Only assigned Candidates are shown.",
    "Primary Examiner completes the full outdoor form; Secondary input is supporting.",
    "Scores and notes autosave to the sync queue.",
    "If assigned Candidates are missing, ask the Centre to assign and save Centre Setup.",
  ];

  return <div className="mb-4 rounded-2xl border bg-white p-4 text-sm"><h3 className="font-semibold">Examiner quick help</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{points.map((point) => <li key={point}>{point}</li>)}</ul></div>;
}

