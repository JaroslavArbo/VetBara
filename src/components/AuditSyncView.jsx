import React from "react";

export function AuditSyncView({ sync, setSync, audit, CloudOff, SectionTitle, StatusPill, Button, Card, CardContent }) {
  const syncStatusCounts = sync.reduce((counts, item) => {
    const status = String(item.status ?? "").toLowerCase();
    return {
      total: counts.total + 1,
      error: counts.error + (status.includes("error") ? 1 : 0),
      pending: counts.pending + (status.includes("queued") || status.includes("pending") || status.includes("ready") ? 1 : 0),
      synced: counts.synced + (status.includes("synced") || status.includes("saved") || status.includes("ok") ? 1 : 0),
    };
  }, { total: 0, error: 0, pending: 0, synced: 0 });

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={CloudOff} title="Audit trail and offline sync" subtitle="Sync queue shows local actions waiting for backend confirmation or already recorded during this session." /><div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-slate-600"><p>Failed sync does not erase visible local work on this tablet.</p><p className="mt-1">If sync errors persist, reopen the personal QR session and retry the action.</p></div><div className="mb-4 grid gap-2 md:grid-cols-4"><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Total sync items</div><div className="font-semibold">{syncStatusCounts.total}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Pending / ready</div><div className="font-semibold">{syncStatusCounts.pending}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Synced / saved</div><div className="font-semibold">{syncStatusCounts.synced}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Sync errors</div><div className="font-semibold">{syncStatusCounts.error}</div></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Sync queue</h3><Button onClick={() => setSync((prev) => prev.map((x) => ({ ...x, status: "Synced" })))} variant="outline" className="rounded-2xl">Mark all synced</Button></div><div className="space-y-2 text-sm">{sync.slice(0, 6).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-100 p-3"><div><div className="font-medium">{item.type}</div><div className="text-xs text-slate-500">{item.detail ?? item.id}</div></div><StatusPill tone={String(item.status ?? "").toLowerCase().includes("error") ? "bad" : item.status === "Synced" ? "good" : "warn"}>{item.status}</StatusPill></div>)}</div></div><div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Audit log</h3><div className="max-h-72 space-y-2 overflow-auto text-sm">{audit.slice(0, 8).map((entry) => <div key={entry.id} className="rounded-xl border p-3"><div className="flex justify-between gap-3"><div className="font-medium">{entry.action}</div><div className="text-xs text-slate-500">{entry.time}</div></div><div className="text-slate-600">{entry.target}</div><div className="text-xs text-slate-500">{entry.detail}</div></div>)}</div></div></div></CardContent></Card>;
}


