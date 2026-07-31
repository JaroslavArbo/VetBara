import { useMemo, useState } from "react";

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

// Leaving the exam interface is the one thing a remote invigilator has to notice immediately, so
// these two actions are pulled out of the stream visually rather than being one row among hundreds.
const ALERT_ACTIONS = new Set(["Exited fullscreen", "Switched away from app"]);

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
      return {
        kind: "candidate",
        id: candidate.id,
        label: tr(t, "auditSync.personCandidate", "Candidate {number} - {name}").replace("{number}", number).replace("{name}", candidate.name || candidate.id || ""),
      };
    }
    const examiner = (examiners || []).find((e) => String(e.id || "").toLowerCase() === needle || String(e.name || "").toLowerCase() === needle);
    if (examiner) {
      return {
        kind: "examiner",
        id: examiner.id,
        label: tr(t, "auditSync.personExaminer", "Examiner - {name}").replace("{name}", examiner.name || examiner.id || ""),
      };
    }
  }
  return { kind: "centre", id: "__centre__", label: tr(t, "auditSync.personCentre", "Center administrator") };
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

// Live per-candidate supervision state derived from the stream: which section each person currently
// has open, and whether they are outside the exam interface right now. The audit list is newest
// first, so the first matching entry per person is their current state.
function buildLiveState(rows) {
  const state = new Map();
  [...rows].reverse().forEach((row) => {
    const key = row.person.id;
    const entry = state.get(key) || { person: row.person, openSection: "", away: false, lastAt: null, alerts: 0 };
    if (row.item.action === "Candidate section opened" || row.item.action === "Candidate section reopened") entry.openSection = row.item.detail || "";
    if (row.item.action === "Candidate section closed") entry.openSection = "";
    if (row.item.action === "Switched away from app" || row.item.action === "Exited fullscreen") { entry.away = true; entry.alerts += 1; }
    if (row.item.action === "Returned to app" || row.item.action === "Entered fullscreen") entry.away = false;
    entry.lastAt = row.item.createdAt || entry.lastAt;
    state.set(key, entry);
  });
  return [...state.values()].filter((entry) => entry.person.kind !== "centre");
}

export function AuditSyncView({ audit, candidates, examiners, CloudOff, SectionTitle, StatusPill, Button, Card, CardContent, t }) {
  const [personFilter, setPersonFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Resolve once: every filter, the live panel and the rendered rows all need the same person.
  const rows = useMemo(
    () => (audit || []).map((item) => ({ item, person: resolveAuditPerson(t, item.target, candidates, examiners) })),
    [audit, candidates, examiners, t]
  );

  const people = useMemo(() => {
    const seen = new Map();
    rows.forEach((row) => { if (!seen.has(row.person.id)) seen.set(row.person.id, row.person); });
    return [...seen.values()];
  }, [rows]);

  const actions = useMemo(() => [...new Set(rows.map((row) => row.item.action))].sort(), [rows]);

  const filtered = rows.filter((row) => {
    if (personFilter !== "all" && row.person.id !== personFilter) return false;
    if (actionFilter !== "all" && row.item.action !== actionFilter) return false;
    if (alertsOnly && !ALERT_ACTIONS.has(row.item.action)) return false;
    if (search.trim()) {
      const haystack = `${row.person.label} ${translateAuditAction(t, row.item.action)} ${row.item.detail ?? ""}`.toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  const liveState = useMemo(() => buildLiveState(rows), [rows]);
  const alertCount = rows.filter((row) => ALERT_ACTIONS.has(row.item.action)).length;
  const auditGroups = groupAuditByDate(filtered.slice(0, 400).map((row) => row.item));
  const personOf = new Map(filtered.map((row) => [row.item.id, row.person]));
  const timeOf = (item) => (item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : item.time);

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-3">
      <CardContent className="p-5">
        <SectionTitle
          icon={CloudOff}
          title={tr(t, "auditSync.title", "Audit trail")}
          subtitle={tr(t, "auditSync.subtitle", "Live record of everything that happens during the exam.")}
        />

        {/* Who is where, right now — the question an invigilator actually asks. */}
        {liveState.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {liveState.map((entry) => (
              <div key={entry.person.id} className={`rounded-2xl border p-3 text-sm ${entry.away ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
                <div className="font-semibold">{entry.person.label}</div>
                <div className="mt-1 text-xs text-slate-600">
                  {entry.openSection
                    ? `${tr(t, "auditSync.live.openSection", "Open section")}: ${entry.openSection}`
                    : tr(t, "auditSync.live.noOpenSection", "No open section")}
                </div>
                {entry.away && <div className="mt-1 text-xs font-bold text-amber-900">{tr(t, "auditSync.live.away", "Outside the exam interface")}</div>}
                {entry.alerts > 0 && <div className="mt-1 text-xs text-slate-500">{tr(t, "auditSync.live.alerts", "Alerts")}: {entry.alerts}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border bg-slate-50 p-3">
          <label className="text-xs font-semibold text-slate-600">
            {tr(t, "auditSync.filter.person", "Person")}
            <select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)} className="mt-1 block rounded-xl border bg-white p-2 text-sm font-normal text-slate-950">
              <option value="all">{tr(t, "auditSync.filter.all", "All")}</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            {tr(t, "auditSync.filter.action", "Action")}
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="mt-1 block rounded-xl border bg-white p-2 text-sm font-normal text-slate-950">
              <option value="all">{tr(t, "auditSync.filter.all", "All")}</option>
              {actions.map((action) => <option key={action} value={action}>{translateAuditAction(t, action)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            {tr(t, "auditSync.filter.search", "Search")}
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block rounded-xl border bg-white p-2 text-sm font-normal text-slate-950" />
          </label>
          <Button onClick={() => setAlertsOnly((current) => !current)} variant={alertsOnly ? "default" : "outline"} className="rounded-2xl">
            {tr(t, "auditSync.filter.alertsOnly", "Alerts only")} ({alertCount})
          </Button>
          <Button onClick={() => { setPersonFilter("all"); setActionFilter("all"); setAlertsOnly(false); setSearch(""); }} variant="outline" className="rounded-2xl">
            {tr(t, "auditSync.filter.reset", "Reset filters")}
          </Button>
          <StatusPill>{tr(t, "auditSync.filter.shown", "Shown")}: {filtered.length} / {rows.length}</StatusPill>
        </div>

        <div className="rounded-2xl border bg-white p-4">
          <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
            {filtered.length === 0 ? (
              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "auditSync.emptyAudit", "No audit entries yet.")}</div>
            ) : (
              auditGroups.map((group) => (
                <div key={group.dateKey}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.dateKey}</div>
                  <div className="space-y-1">
                    {group.entries.map((item) => {
                      const person = personOf.get(item.id);
                      const alert = ALERT_ACTIONS.has(item.action);
                      return (
                        <div
                          key={item.id}
                          className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-lg px-2 py-1.5 text-xs leading-snug sm:grid-cols-[auto_14rem_minmax(0,1fr)] ${alert ? "border border-amber-300 bg-amber-50 font-semibold text-amber-950" : "hover:bg-slate-50"}`}
                        >
                          <span className="font-mono text-slate-500">{timeOf(item)}</span>
                          <span className={alert ? "" : "font-medium text-slate-800"}>{person?.label}</span>
                          <span className="min-w-0">
                            <span className={alert ? "" : "text-slate-700"}>{translateAuditAction(t, item.action)}</span>
                            {item.detail && <span className={alert ? " font-normal" : " text-slate-400"}> ({item.detail})</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
