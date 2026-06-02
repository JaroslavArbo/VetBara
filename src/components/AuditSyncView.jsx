function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

export function AuditSyncView({ sync, setSync, audit, CloudOff, SectionTitle, StatusPill, Button, Card, CardContent, t }) {
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
                    <div className="mt-1 text-xs text-slate-500">{item.time}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">{tr(t, "auditSync.audit", "Audit trail")}</h3>
            <div className="mt-3 space-y-2">
              {audit.length === 0 ? (
                <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "auditSync.emptyAudit", "No audit entries yet.")}</div>
              ) : (
                audit.slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded-xl bg-slate-100 p-3 text-sm">
                    <div className="font-medium">{item.type}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.time}</div>
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
