function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

export function CandidateQuickHelp({ t }) {
  const items = [
    ["help.candidate.qr", "Scan your personal Candidate QR issued by the Centre."],
    ["help.candidate.identity", "Confirm your identity before opening sections."],
    ["help.candidate.autosave", "Written test answers autosave to the sync queue."],
    ["help.candidate.photos", "Consulting report photo entries are pilot/archive placeholders, not real uploads yet."],
    ["help.candidate.ask", "If something looks wrong, ask Centre staff before final submit."],
  ];

  return (
    <div className="mb-4 rounded-2xl border bg-white p-4">
      <h3 className="font-semibold">{tr(t, "help.candidate.title", "Candidate quick help")}</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([key, fallback]) => <div key={key} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{tr(t, key, fallback)}</div>)}
      </div>
    </div>
  );
}

export function ExaminerQuickHelp({ t }) {
  const items = [
    ["help.examiner.qr", "Scan your personal Examiner QR issued by the Centre."],
    ["help.examiner.identity", "Confirm your identity before opening outdoor forms."],
    ["help.examiner.assigned", "Only assigned Candidates are shown."],
    ["help.examiner.primary", "Primary Examiner completes the full outdoor form; Secondary input is supporting."],
    ["help.examiner.autosave", "Scores and notes autosave to the sync queue."],
    ["help.examiner.missing", "If assigned Candidates are missing, ask the Centre to assign and save Centre Setup."],
  ];

  return (
    <div className="mb-4 rounded-2xl border bg-white p-4">
      <h3 className="font-semibold">{tr(t, "help.examiner.title", "Examiner quick help")}</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([key, fallback]) => <div key={key} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{tr(t, key, fallback)}</div>)}
      </div>
    </div>
  );
}
