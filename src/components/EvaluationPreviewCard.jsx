import React from "react";

export function EvaluationPreviewCard({ preview }) {
  const summary = preview?.summary ?? {};
  const sections = preview?.sections ?? [];
  const outdoorScores = preview?.outdoorScores ?? [];
  const reportSummary = preview?.reportSummary ?? null;
  if (!preview) return null;

  return (
    <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Evaluation preview</div>
          <div className="mt-1 text-slate-600">
            {preview.candidate?.name ?? preview.candidateId} / {preview.candidate?.id ?? preview.candidateId} / {preview.candidate?.level ?? "-"}
          </div>
        </div>
        <StatusPill tone="good">JSON read model</StatusPill>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <div className="rounded-xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Sections</div>
          <div className="font-semibold">{summary.sectionsClosed ?? 0} / {summary.sectionsTotal ?? 0} closed</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Test responses</div>
          <div className="font-semibold">{summary.testResponsesTotal ?? 0}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Outdoor scores</div>
          <div className="font-semibold">{summary.outdoorScoresTotal ?? 0}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Outdoor total / avg</div>
          <div className="font-semibold">{summary.outdoorScoreSum ?? 0} / {summary.outdoorScoreAverage ?? "-"}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <StatusPill tone={summary.hasPrimaryExaminerScores ? "good" : "default"}>Primary scores: {summary.hasPrimaryExaminerScores ? "yes" : "no"}</StatusPill>
        <StatusPill tone={summary.hasSecondaryExaminerScores ? "good" : "default"}>Secondary scores: {summary.hasSecondaryExaminerScores ? "yes" : "no"}</StatusPill>
      </div>

      {reportSummary && (
        <div className="mt-4">
          <div className="mb-2 font-medium">Report draft summary</div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Report draft</div>
              <div className="font-semibold">{reportSummary.hasReportDraft ? "yes" : "no"}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Trees with content</div>
              <div className="font-semibold">{reportSummary.treesWithContent ?? 0} / {reportSummary.treesTotal ?? 0}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Field notes filled</div>
              <div className="font-semibold">{reportSummary.fieldNotesFilled ?? 0}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Final sections filled</div>
              <div className="font-semibold">{reportSummary.finalSectionsFilled ?? 0}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Photo placeholders</div>
              <div className="font-semibold">{reportSummary.photoPlaceholdersTotal ?? 0}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Submitted</div>
              <div className="font-semibold">{reportSummary.isSubmitted ? "yes" : "no"}</div>
            </div>
          </div>
        </div>
      )}

      {sections.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-medium">Sections</div>
          <div className="space-y-2">
            {sections.slice(0, 6).map((section) => (
              <div key={section.id ?? `${section.candidate_id}:${section.section_key}`} className="flex justify-between gap-3 rounded-xl bg-slate-100 p-2">
                <span>{section.section_key}</span>
                <StatusPill tone={section.status === "closed" ? "good" : "warn"}>{section.status}</StatusPill>
              </div>
            ))}
          </div>
        </div>
      )}

      {outdoorScores.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-medium">Outdoor scores</div>
          <div className="space-y-2">
            {outdoorScores.slice(0, 8).map((score) => (
              <div key={score.id ?? `${score.candidate_id}:${score.examiner_id}:${score.item_id}`} className="grid gap-2 rounded-xl bg-slate-100 p-2 md:grid-cols-4">
                <span>{score.item_id}</span>
                <span>{score.examiner_id}</span>
                <span>{score.payload?.mode ?? "-"}</span>
                <strong>{score.score ?? "-"}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
