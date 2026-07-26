import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamMedia } from "../lib/api";
import { listLocalMedia, downloadBlob } from "../lib/mediaStore";

function tr(t, key, fallback) {
  const value = typeof t === "function" ? t(key) : null;
  return value && value !== key ? value : fallback;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(ms) {
  if (!ms) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Merge the backend (Supabase) list with the local (IndexedDB) list, keyed by
// clientMediaId, so each recording/photo shows exactly once with the sources it
// is available from.
function mergeMedia(remote, local) {
  const map = new Map();
  local.forEach((item) => {
    map.set(item.clientMediaId, {
      clientMediaId: item.clientMediaId,
      mediaType: item.mediaType,
      candidateId: item.candidateId,
      examinerId: item.examinerId,
      examId: item.examId,
      sectionKey: item.sectionKey,
      tree: item.tree,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      durationMs: item.durationMs,
      caption: item.caption,
      createdAt: item.createdAt,
      hasLocal: true,
      blob: item.blob,
      downloadUrl: null,
    });
  });
  remote.forEach((item) => {
    const existing = map.get(item.clientMediaId) ?? {};
    map.set(item.clientMediaId, {
      ...existing,
      clientMediaId: item.clientMediaId,
      mediaType: item.mediaType ?? existing.mediaType,
      candidateId: item.candidateId ?? existing.candidateId,
      examinerId: item.examinerId ?? existing.examinerId,
      examId: item.examId ?? existing.examId,
      sectionKey: item.sectionKey ?? existing.sectionKey,
      tree: item.tree ?? existing.tree,
      fileName: item.fileName ?? existing.fileName,
      mimeType: item.mimeType ?? existing.mimeType,
      sizeBytes: item.sizeBytes ?? existing.sizeBytes,
      durationMs: item.durationMs ?? existing.durationMs,
      caption: item.caption ?? existing.caption,
      createdAt: item.createdAt ?? existing.createdAt,
      hasRemote: true,
      downloadUrl: item.downloadUrl ?? null,
    });
  });
  return Array.from(map.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function MediaLibraryPanel({ sessionToken, SectionTitle, StatusPill, Button, Card, CardContent, FileSpreadsheet, t }) {
  const [remote, setRemote] = useState([]);
  const [local, setLocal] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backendStored, setBackendStored] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const localItems = await listLocalMedia();
    setLocal(localItems);
    try {
      const result = await listExamMedia(sessionToken);
      setRemote(Array.isArray(result?.media) ? result.media : []);
      setBackendStored(Boolean(result?.stored));
    } catch (err) {
      console.warn("Media list from backend failed", err);
      setRemote([]);
      setBackendStored(false);
      setError(tr(t, "media.error.backend", "Backend media list unavailable — showing local recordings only."));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, t]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await refresh();
    })();
    return () => { active = false; };
  }, [refresh]);

  const media = useMemo(() => mergeMedia(remote, local), [remote, local]);

  // Build playable object URLs for locally stored blobs; revoke the previous
  // set whenever the local list changes and on unmount.
  const objectUrls = useMemo(() => {
    const urls = {};
    local.forEach((item) => {
      if (item.blob) urls[item.clientMediaId] = URL.createObjectURL(item.blob);
    });
    return urls;
  }, [local]);

  useEffect(() => () => Object.values(objectUrls).forEach((url) => URL.revokeObjectURL(url)), [objectUrls]);

  const audioItems = media.filter((item) => item.mediaType === "audio");
  const photoItems = media.filter((item) => item.mediaType === "photo");

  function handleDownload(item) {
    if (item.hasLocal && item.blob) {
      downloadBlob(item.blob, item.fileName);
      return;
    }
    if (item.downloadUrl) window.open(item.downloadUrl, "_blank", "noopener");
  }

  function playUrlFor(item) {
    return objectUrls[item.clientMediaId] || item.downloadUrl || null;
  }

  function sourceBadge(item) {
    if (item.hasRemote && item.hasLocal) return tr(t, "media.source.both", "Backend + local");
    if (item.hasRemote) return tr(t, "media.source.backend", "Backend");
    return tr(t, "media.source.local", "Local (this tablet)");
  }

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-3">
      <CardContent className="p-5">
        <SectionTitle
          icon={FileSpreadsheet}
          title={tr(t, "media.title", "Recordings & photos")}
          subtitle={tr(t, "media.subtitle", "Download examiner voice recordings and candidate report photos for further processing.")}
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button onClick={refresh} variant="outline" className="rounded-2xl" disabled={loading}>
            {loading ? tr(t, "media.refreshing", "Refreshing…") : tr(t, "media.refresh", "Refresh")}
          </Button>
          <StatusPill tone={backendStored ? "good" : "warn"}>
            {backendStored ? tr(t, "media.mode.backend", "Backend storage") : tr(t, "media.mode.local", "Local only")}
          </StatusPill>
          <StatusPill>{audioItems.length} {tr(t, "media.recordings", "recordings")}</StatusPill>
          <StatusPill>{photoItems.length} {tr(t, "media.photos", "photos")}</StatusPill>
        </div>

        {error && <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{error}</div>}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">{tr(t, "media.audio.title", "Voice recordings (outdoor)")}</h3>
            <div className="mt-3 space-y-3">
              {audioItems.length === 0 ? (
                <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "media.audio.empty", "No voice recordings yet.")}</div>
              ) : (
                audioItems.map((item) => (
                  <div key={item.clientMediaId} className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{item.candidateId}{item.examinerId ? ` · ${item.examinerId}` : ""}</div>
                      <StatusPill tone={item.hasRemote ? "good" : "default"}>{sourceBadge(item)}</StatusPill>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDuration(item.durationMs) ? `${formatDuration(item.durationMs)} · ` : ""}{formatBytes(item.sizeBytes)}
                      {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}
                    </div>
                    {playUrlFor(item) && <audio controls preload="none" src={playUrlFor(item)} className="mt-2 w-full" />}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button onClick={() => handleDownload(item)} className="rounded-2xl" disabled={!item.hasLocal && !item.downloadUrl}>
                        {tr(t, "media.download", "Download")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">{tr(t, "media.photo.title", "Report photos")}</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {photoItems.length === 0 ? (
                <div className="col-span-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{tr(t, "media.photo.empty", "No report photos yet.")}</div>
              ) : (
                photoItems.map((item) => (
                  <div key={item.clientMediaId} className="rounded-xl border bg-slate-50 p-2 text-xs">
                    {playUrlFor(item) ? (
                      <img src={playUrlFor(item)} alt={item.caption || item.fileName || "photo"} className="h-24 w-full rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-24 w-full items-center justify-center rounded-lg bg-slate-200 text-slate-500">{tr(t, "media.photo.remote", "Stored")}</div>
                    )}
                    <div className="mt-1 truncate font-medium">{item.candidateId || item.examId || (item.sectionKey === "field" || item.sectionKey === "field-prep" ? "Field" : "")}{item.tree ? ` · ${item.tree}` : ""}</div>
                    <div className="text-slate-500">{formatBytes(item.sizeBytes)}</div>
                    <button type="button" onClick={() => handleDownload(item)} disabled={!item.hasLocal && !item.downloadUrl} className="mt-1 w-full rounded-lg border bg-white px-2 py-1 font-medium hover:bg-slate-50 disabled:opacity-50">
                      {tr(t, "media.download", "Download")}
                    </button>
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
