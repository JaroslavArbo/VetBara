import React from "react";

export function CentreValidationSummary({ issues, StatusPill }) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const sortedIssues = [...issues].sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
  const ready = errorCount === 0;

  return <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">Centre Setup checks</div><div className="mt-1 text-slate-600">{ready ? "Ready for pilot smoke test" : "Action required before pilot smoke test"}</div></div><div className="flex flex-wrap gap-2"><StatusPill tone={issues.length ? "warn" : "good"}>{issues.length} validation issue(s)</StatusPill><StatusPill tone={errorCount ? "bad" : "good"}>{errorCount} error(s)</StatusPill><StatusPill tone={warningCount ? "warn" : "good"}>{warningCount} warning(s)</StatusPill></div></div><p className="mt-2 text-xs text-slate-500">Errors should be fixed before distributing QR links. Warnings can be reviewed during pilot preparation.</p>{issues.length === 0 ? <div className="mt-3 text-slate-600">No validation issues. Setup is ready for pilot smoke test.</div> : <div className="mt-3 space-y-2">{sortedIssues.map((issue, index) => <div key={`${issue.severity}-${index}`} className={`rounded-lg border p-2 ${issue.severity === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}><span className="font-medium">{issue.severity === "error" ? "Error" : "Warning"}:</span> {issue.message}</div>)}</div>}</div>;
}

export function PilotReadinessGuardrails({ centreValidationIssues, centreSetupDirty, testImportSummary, dataMode, StatusPill }) {
  const warnings = [
    ...(centreValidationIssues.some((issue) => issue.severity === "error") ? ["Fix validation errors before distributing QR links."] : []),
    ...(centreSetupDirty ? ["Save Centre Setup before distributing QR links."] : []),
    ...(!testImportSummary ? ["Import/select a test package before written test pilot runs."] : []),
    ...(dataMode === "demo" ? ["Load backend Centre Setup before pilot testing with real users."] : []),
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot readiness guardrails</h3><p className="mt-1 text-slate-600">These guardrails do not block demo testing, but they should be resolved before a real pilot run.</p></div><StatusPill tone={warnings.length ? "warn" : "good"}>{warnings.length ? `${warnings.length} warning(s)` : "ready"}</StatusPill></div>{warnings.length === 0 ? <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900">Pilot readiness looks good.</div> : <div className="mt-3 space-y-2">{warnings.map((warning) => <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">{warning}</div>)}</div>}</div>;
}

export function PilotRunSummary({ centreValidationIssues, centreSetupDirty, testImportSummary, dataMode, StatusPill }) {
  const hasValidationErrors = centreValidationIssues.some((issue) => issue.severity === "error");
  const qrDistributionReady = dataMode === "backend" && !centreSetupDirty;
  const rows = [
    ["Data mode", dataMode === "backend" ? "backend-loaded pilot data" : "demo fallback data", dataMode === "backend" ? "good" : "warn"],
    ["Centre Setup", centreSetupDirty ? "Unsaved local changes" : "Saved / no local changes", centreSetupDirty ? "warn" : "good"],
    ["Validation", hasValidationErrors ? "Action required" : "Ready for pilot smoke test", hasValidationErrors ? "bad" : "good"],
    ["Test package", testImportSummary ? "Imported" : "Missing", testImportSummary ? "good" : "warn"],
    ["QR distribution", qrDistributionReady ? "Ready after setup is saved and backend-loaded" : "Review guardrails", qrDistributionReady ? "good" : "warn"],
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot run summary</h3><p className="mt-1 text-slate-600">Use this summary before sharing Candidate or Examiner QR links.</p></div><StatusPill tone={qrDistributionReady && !hasValidationErrors && testImportSummary ? "good" : "warn"}>{qrDistributionReady && !hasValidationErrors && testImportSummary ? "ready" : "review"}</StatusPill></div><div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-5">{rows.map(([label, value, tone]) => <div key={label} className="rounded-xl bg-slate-100 p-3"><div className="mb-2 text-xs font-medium text-slate-500">{label}</div><StatusPill tone={tone}>{value}</StatusPill></div>)}</div></div>;
}

