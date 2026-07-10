import { useMemo, useState } from "react";
import {
  VetBaraErrorBoundary,
  Button,
  StatusPill,
  CloudOff,
  FileSpreadsheet,
  ShieldCheck,
  Languages,
  portableLanOrigin,
  CENTRE_ACCESS_TOKEN,
  CENTRE_QR_ID,
  AdminDashboardSection,
  AdminStructuredPackagePanel,
  AdminExamOpeningPanel,
  AdminTranslationPanel,
} from "../App.jsx";
import { LANGUAGES as UI_LANGUAGES, makeTranslator } from "../i18n";

function FolderSearch({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v3" />
      <path d="M4 4v15a1 1 0 0 0 1 1h8" />
      <path d="M20 8H4" />
      <circle cx="16.5" cy="16.5" r="3.2" />
      <path d="M19 19l2.5 2.5" />
    </svg>
  );
}

function centreAccessUrl() {
  try {
    const origin = portableLanOrigin() || window.location.origin;
    const url = new URL("/", origin);
    url.searchParams.set("role", "Centre");
    url.searchParams.set("id", CENTRE_QR_ID);
    url.searchParams.set("token", CENTRE_ACCESS_TOKEN);
    return url.toString();
  } catch {
    return "";
  }
}

function AdminCentreImportViewer({ t }) {
  const [imports, setImports] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedDocId, setExpandedDocId] = useState(null);
  const [error, setError] = useState("");
  const active = imports[activeIndex] || null;

  function handleFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setError("");
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ""));
          if (data?.kind !== "vetbara.centreArchive.v1") throw new Error(`${file.name}: ${t("admin.importViewer.invalidFile")}`);
          setImports((prev) => [{ ...data, _fileName: file.name }, ...prev]);
          setActiveIndex(0);
          setExpandedDocId(null);
        } catch (err) {
          setError(err.message || String(err));
        }
      };
      reader.onerror = () => setError(t("admin.importViewer.readError"));
      reader.readAsText(file);
    });
  }

  function removeImport(index) {
    setImports((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex(0);
    setExpandedDocId(null);
  }

  function downloadDocument(doc) {
    const blob = new Blob([JSON.stringify(doc.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.filename || `${doc.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const categories = active ? [...new Set((active.documents || []).map((doc) => doc.category))] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="rounded-2xl border bg-white p-4">
        <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-2xl border bg-slate-950 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800">
          {t("admin.importViewer.importButton")}
          <input type="file" accept=".vet,application/json" multiple className="hidden" onChange={handleFiles} />
        </label>
        {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{error}</div>}
        <div className="mt-4 space-y-2">
          {imports.length === 0 && <div className="rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">{t("admin.importViewer.empty")}</div>}
          {imports.map((imp, index) => (
            <button
              key={`${imp._fileName}-${index}`}
              type="button"
              onClick={() => { setActiveIndex(index); setExpandedDocId(null); }}
              className={`w-full rounded-xl border p-3 text-left text-sm ${activeIndex === index ? "border-slate-950 bg-slate-100" : "bg-white hover:bg-slate-50"}`}
            >
              <div className="font-semibold">{imp.place || "-"}</div>
              <div className="text-xs text-slate-600">{imp.centreCode || "-"} · {imp.examDate || "-"}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {!active && <div className="rounded-2xl border border-dashed bg-slate-50 p-6 text-sm text-slate-500">{t("admin.importViewer.selectHint")}</div>}
        {active && (
          <>
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold">{active.place || "-"}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("admin.importViewer.centre")}: {active.centreCode || "-"} · {t("admin.importViewer.examDate")}: {active.examDate || "-"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{t("admin.importViewer.closedAt")}: {active.closedAt ? new Date(active.closedAt).toLocaleString() : "-"}</p>
                </div>
                <Button onClick={() => removeImport(activeIndex)} variant="outline" className="rounded-xl">{t("admin.importViewer.remove")}</Button>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">{t("admin.importViewer.candidates")} ({(active.candidates || []).length})</h4>
                  <div className="mt-2 space-y-1">
                    {(active.candidates || []).map((c) => (
                      <div key={c.id || c.name} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">{c.name || c.id} {c.level && <span className="text-slate-500">· {c.level}</span>}</div>
                    ))}
                    {!(active.candidates || []).length && <div className="text-sm text-slate-400">-</div>}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">{t("admin.importViewer.examiners")} ({(active.examiners || []).length})</h4>
                  <div className="mt-2 space-y-1">
                    {(active.examiners || []).map((e) => (
                      <div key={e.id || e.name} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">{e.name || e.id}</div>
                    ))}
                    {!(active.examiners || []).length && <div className="text-sm text-slate-400">-</div>}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <h4 className="font-semibold">{t("admin.importViewer.documents")} ({(active.documents || []).length})</h4>
              {categories.map((category) => (
                <div key={category} className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{category}</div>
                  <div className="mt-2 space-y-2">
                    {(active.documents || []).filter((doc) => doc.category === category).map((doc) => (
                      <div key={doc.id} className="rounded-xl border bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{doc.label}</div>
                          <div className="flex gap-2">
                            <Button onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)} variant="outline" className="rounded-lg px-3 py-1 text-xs">
                              {expandedDocId === doc.id ? t("common.close") : t("admin.importViewer.view")}
                            </Button>
                            <Button onClick={() => downloadDocument(doc)} variant="outline" className="rounded-lg px-3 py-1 text-xs">{t("admin.importViewer.download")}</Button>
                          </div>
                        </div>
                        {expandedDocId === doc.id && (
                          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-800">{JSON.stringify(doc.data, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [uiLanguage, setUiLanguage] = useState("cs");
  const t = makeTranslator(uiLanguage);

  const [centre, setCentre] = useState("Arboricultural Academy");
  const [examDate, setExamDate] = useState("2026-03-31");
  const [place, setPlace] = useState("Buchlovice");
  const [examLanguage, setExamLanguage] = useState("EN");

  const [adminPdfPackageLatest, setAdminPdfPackageLatest] = useState(null);
  const [adminPdfPackageStatus, setAdminPdfPackageStatus] = useState("");
  const [adminPdfPackageError, setAdminPdfPackageError] = useState("");

  const [status, setStatus] = useState("");
  const [activeSection, setActiveSection] = useState("package-authoring");

  const centreQr = useMemo(() => centreAccessUrl(), []);

  function handleScanRequest() {
    setStatus(t("admin.importViewer.scanUnavailable"));
  }

  return (
    <VetBaraErrorBoundary>
      <main className="mx-auto max-w-6xl p-4 md:p-8">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
            <img src="/brand/vetcert-logo.jpg" alt="VETcert Certified Veteran Tree Specialist" className="h-14 w-14 shrink-0 rounded-full border bg-white object-contain p-1 shadow-sm md:h-16 md:w-16" />
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="rounded-2xl bg-slate-950 px-3 py-1 text-sm font-semibold text-white">{t("app.title")}</div>
                <StatusPill><CloudOff className="mr-1 h-3.5 w-3.5" /> {t("admin.standaloneBadge")}</StatusPill>
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{t("admin.appHeroTitle")}</h1>
            </div>
          </div>
          <label className="text-xs font-medium text-slate-500">
            {t("language.label")}
            <select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value)} className="ml-2 rounded-xl border bg-white p-2 text-sm text-slate-950">
              {UI_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.draft ? `${lang.label} - draft` : lang.label}</option>)}
            </select>
          </label>
        </header>

        {status && <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{status}</div>}
        {adminPdfPackageStatus && <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{adminPdfPackageStatus}</div>}
        {adminPdfPackageError && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{adminPdfPackageError}</div>}

        <div className="grid gap-4">
          <AdminDashboardSection id="package-authoring" icon={FileSpreadsheet} t={t} title={t("admin.dashboard.authoring.title")} description={t("admin.dashboard.authoring.description")} activeSection={activeSection} setActiveSection={setActiveSection}>
            <AdminStructuredPackagePanel adminPdfPackageLatest={adminPdfPackageLatest} setAdminPdfPackageLatest={setAdminPdfPackageLatest} setAdminPdfPackageStatus={setAdminPdfPackageStatus} setAdminPdfPackageError={setAdminPdfPackageError} centre={centre} t={t} />
          </AdminDashboardSection>

          <AdminDashboardSection id="exam-opening" icon={ShieldCheck} t={t} title={t("admin.dashboard.examOpening.title")} description={t("admin.dashboard.examOpening.description")} activeSection={activeSection} setActiveSection={setActiveSection}>
            <AdminExamOpeningPanel centre={centre} setCentre={setCentre} examDate={examDate} setExamDate={setExamDate} place={place} setPlace={setPlace} language={examLanguage} setLanguage={setExamLanguage} centreQr={centreQr} setStatus={setStatus} addAudit={() => {}} setScannerMode={handleScanRequest} t={t} />
          </AdminDashboardSection>

          <AdminDashboardSection id="import-viewer" icon={FolderSearch} t={t} title={t("admin.dashboard.importViewer.title")} description={t("admin.dashboard.importViewer.description")} activeSection={activeSection} setActiveSection={setActiveSection}>
            <AdminCentreImportViewer t={t} />
          </AdminDashboardSection>

          <AdminDashboardSection id="translation" icon={Languages} t={t} title={t("admin.dashboard.translation.title")} description={t("admin.dashboard.translation.description")} activeSection={activeSection} setActiveSection={setActiveSection}>
            <AdminTranslationPanel t={t} />
          </AdminDashboardSection>
        </div>
      </main>
    </VetBaraErrorBoundary>
  );
}
