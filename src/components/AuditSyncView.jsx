function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

// addAudit() call sites across the app pass a fixed set of English action phrases (some are
// built with a dynamic prefix, e.g. "${source} test package imported" — those aren't in this
// map and fall through to the raw string, which is an acceptable rarer case since they're
// import-tool-internal source labels, not everyday UI copy).
const AUDIT_ACTION_KEYS = {
  "QR resolve failed": "audit.action.qrResolveFailed",
  "Backend unavailable": "audit.action.backendUnavailable",
  "Centre workspace opened": "audit.action.centreWorkspaceOpened",
  "QR role blocked": "audit.action.qrRoleBlocked",
  "Offline candidate package imported": "audit.action.offlineCandidatePackageImported",
  "Candidate state restored": "audit.action.candidateStateRestored",
  "Outdoor state restored": "audit.action.outdoorStateRestored",
  "Centre access failed": "audit.action.centreAccessFailed",
  "Candidate logged in": "audit.action.candidateLoggedIn",
  "Candidate identity confirmed": "audit.action.candidateIdentityConfirmed",
  "Candidate section reopened": "audit.action.candidateSectionReopened",
  "Candidate section opened": "audit.action.candidateSectionOpened",
  "Candidate reopen request denied": "audit.action.candidateReopenRequestDenied",
  "Candidate section closed": "audit.action.candidateSectionClosed",
  "Examiner logged in": "audit.action.examinerLoggedIn",
  "Examiner identity confirmed": "audit.action.examinerIdentityConfirmed",
  "Outdoor form opened": "audit.action.outdoorFormOpened",
  "Outdoor assessment submitted": "audit.action.outdoorAssessmentSubmitted",
  "Entered fullscreen": "audit.action.enteredFullscreen",
  "Exited fullscreen": "audit.action.exitedFullscreen",
  "Switched away from app": "audit.action.switchedAwayFromApp",
  "Returned to app": "audit.action.returnedToApp",
};
export function translateAuditAction(t, action) {
  const key = AUDIT_ACTION_KEYS[action];
  return key ? tr(t, key, action) : action;
}

// addAudit()'s `target` is whichever person/entity the event concerns (not necessarily who
// clicked something — e.g. an examiner opening a candidate's outdoor form logs the candidate as
// target, which is exactly what should show here). Matched against the live candidate/examiner
// lists by id or name; anything that doesn't match either is treated as a Centre/system-level
// event.
function resolveAuditPerson(t, target, candidates, examiners) {
  const needle = String(target || "").trim().toLowerCase();
  if (needle) {
    const candidate = (candidates || []).find((c) => String(c.id || "").toLowerCase() === needle || String(c.name || "").toLowerCase() === needle);
    if (candidate) {
      const numberMatch = String(candidate.id || "").match(/\d+/);
      const number = numberMatch ? String(Number(numberMatch[0])) : "";
      return tr(t, "auditSync.personCandidate", "Candidate {number} - {name}").replace("{number}", number).replace("{name}", candidate.name || candidate.id || "");
    }
    const examiner = (examiners || []).find((e) => String(e.id || "").toLowerCase() === needle || String(e.name || "").toLowerCase() === needle);
    if (examiner) {
      return tr(t, "auditSync.personExaminer", "Examiner - {name}").replace("{name}", examiner.name || examiner.id || "");
    }
  }
  return tr(t, "auditSync.personCentre", "Center administrator");
}

// Groups already-descending-by-time entries by calendar day, so the date only needs to be shown
// once per group instead of on every single row.
function groupAuditByDate(entries) {
  const groups = [];
  let current = null;
  (entries || []).forEach((entry) => {
    const dateKey = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : entry.time;
    if (!current || current.dateKey !== dateKey) {
      current = { dateKey, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  });
  return groups;
}

export function AuditSyncView({ sync, setSync, audit, candidates, examiners, CloudOff, SectionTitle, StatusPill, Button, Card, CardContent, t }) {
  const auditGroups = groupAuditByDate(audit.slice(0, 100));
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-3">
      <CardContent className="p-5">
        <SectionTitle
          icon={CloudOff}
          title={tr(t, "auditSync.title", "Sync queue / audit trail")}
          subtitle={tr(t, "auditSync.subtitle", "Sync queue shows local actions waiting for backend confirmation or already recorded during this session.")}
        />

        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            onClick={() => setSync((prev) => prev.map((x) => ({ ...x, status: "Synced" })))}
            variant="outline"
            className="rounded-2xl"
          >
            {tr(t, "auditSync.markAllSynced", "Mark all synced")}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">{tr(t, "auditSync.queue", "Sync queue")}</h3>
            <div className="mt-3 space-y-2">
              {sync.length === 0 ? (
                <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "auditSync.emptyQueue", "No sync queue items.")}</div>
              ) : (
                sync.map((item) => (
                  <div key={item.id} className="rounded-xl bg-slate-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{item.type}</div>
                      <StatusPill tone={item.status === "Synced" ? "good" : "warn"}>{item.status}</StatusPill>
                    </div>
                    {item.detail && <div className="mt-1 text-xs text-slate-500">{item.detail}</div>}
                    {item.time && <div className="mt-1 text-xs text-slate-500">{item.time}</div>}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">{tr(t, "auditSync.audit", "Audit trail")}</h3>
            <div className="mt-3 max-h-[600px] space-y-3 overflow-auto pr-1">
              {audit.length === 0 ? (
                <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "auditSync.emptyAudit", "No audit entries yet.")}</div>
              ) : (
                auditGroups.map((group) => (
                  <div key={group.dateKey}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.dateKey}</div>
                    <div className="space-y-1 rounded-xl bg-slate-100 p-2">
                      {group.entries.map((item) => {
                        const timeLabel = item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : item.time;
                        return (
                          <div key={item.id} className="rounded-lg px-2 py-1 text-xs leading-snug hover:bg-white">
                            <span className="font-mono text-slate-500">{timeLabel}</span>
                            {" — "}
                            <span className="font-medium text-slate-800">{resolveAuditPerson(t, item.target, candidates, examiners)}</span>
                            {" — "}
                            <span className="text-slate-700">{translateAuditAction(t, item.action)}</span>
                            {item.detail && <span className="text-slate-400"> ({item.detail})</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
