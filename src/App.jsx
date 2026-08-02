import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Html5QrcodeScanner } from "html5-qrcode";
import { bootstrapSession, resolveQrToken, syncBatch, fetchCandidateEvaluation, exportCentreAuditPackage, fetchCentreAudit, setQrPin, resetQrPin, downloadBase64File, loadCentreSetup } from "./lib/api";
import { CandidateQuickHelp, ExaminerQuickHelp } from "./components/PilotInfoPanels";
import { AuditSyncView, translateAuditAction } from "./components/AuditSyncView";
import { CentreQrAccessPack } from "./components/CentreQrAccessPack";
import { HandwritingPad } from "./components/HandwritingPad";
import { decodeAllQrCodes, parseScanSortPayload, mapOffsetToPhoto, classifyMark, resolveQuestionMark } from "./lib/scanMarkDetection";
import { cropScoreBox, recognizeScore } from "./lib/scanScoreDetection";
import { LANGUAGES as UI_LANGUAGES, makeTranslator, allTranslationKeys, translationFor, englishSourceFor, applyTranslationOverrides } from "./i18n";
import { QRCodeSVG } from "qrcode.react";
import { uploadExamMedia, listExamMedia } from "./lib/api";
import { OutdoorVoiceRecorder, isRecordingSupported } from "./lib/audioRecorder";
import { OUTDOOR_AI_DRAFT_NOTES } from "./lib/outdoorAiDraftNotes";
import { saveLocalMedia, updateLocalMedia, listLocalMedia, getLocalMedia, downloadBlob } from "./lib/mediaStore";
import { MediaLibraryPanel } from "./components/MediaLibraryPanel";
import { readVetPackage } from "./lib/vetArchive";
import JSZip from "jszip";
import { buildExamWorkbook } from "./lib/examWorkbooks";
import jsPDF from "jspdf";

async function saveCentreSetupWithTestPackage(sessionToken, { candidates, examiners, assignments, testPackage, harmonogramSettings }) {
  const response = await fetch("/api/centre/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, action: "save", candidates, examiners, assignments, testPackage, harmonogramSettings }),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "object" && body?.error ? body.error : `Request failed: ${response.status}`);
  return body;
}

export function Button({ children, className = "", variant = "default", ...props }) {
  const base = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none";
  const styles = variant === "outline" ? "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "bg-slate-950 text-white hover:bg-slate-800";
  return <button className={`${base} ${styles} ${className}`} {...props}>{children}</button>;
}
export function Card({ children, className = "" }) { return <div className={`border bg-white ${className}`}>{children}</div>; }
export function CardContent({ children, className = "" }) { return <div className={className}>{children}</div>; }

export class VetBaraErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      // Deliberately bilingual (EN+CZ), not routed through t(): the error boundary can be
      // triggered by a crash anywhere below it, including inside the translation system itself,
      // so it must not depend on that system to be readable.
      return (
        <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-5 shadow-sm">
            <h1 className="text-2xl font-bold text-rose-950">VetBara runtime error / chyba</h1>
            <p className="mt-2 text-sm text-rose-900">Please send this text to the developer. / Pošlete tento text vývojáři.</p>
            <pre className="mt-4 overflow-auto rounded-xl bg-white p-4 text-xs text-rose-950">
              {String(this.state.error?.message || this.state.error || "Unknown error / Neznámá chyba")}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}


function RuntimeCrashScreen({ error }) {
  // Same bilingual, translation-independent fallback as VetBaraErrorBoundary above.
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-rose-950">VetBara runtime error / chyba</h1>
        <p className="mt-2 text-sm text-rose-900">
          The app caught an error instead of showing a blank screen. Please send this text to the developer. / Aplikace nespadla do bílé obrazovky, ale zachytila chybu. Pošlete tento text vývojáři.
        </p>
        <pre className="mt-4 overflow-auto rounded-xl bg-white p-4 text-xs text-rose-950">
          {String(error?.message || error || "Unknown error / Neznámá chyba")}
        </pre>
      </div>
    </main>
  );
}

function VetCertRulesReference({ t }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{t("vetcertRules.title")}</div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("common.close")}
          className="shrink-0 rounded-full p-1 text-lg leading-none text-amber-700 hover:bg-amber-100"
        >
          ×
        </button>
      </div>
      <p className="mt-1">{t("vetcertRules.body1")}</p>
      <p className="mt-2 text-xs">{t("vetcertRules.body2")}</p>
    </div>
  );
}

export function StatusPill({ children, tone = "default", icon: Icon }) {
  const cls = { good: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-rose-100 text-rose-800", default: "bg-slate-100 text-slate-700" }[tone] || "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{Icon && <Icon className="h-3.5 w-3.5" />}{children}</span>;
}
export function IconBase({ children, className = "h-5 w-5" }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>; }
function BadgeCheck({ className }) { return <IconBase className={className}><path d="M8 12.5l2.5 2.5L16 9" /><path d="M12 2l2.1 2.2 3-.4.8 2.9 2.7 1.4-1.4 2.7.4 3-2.9.8-1.4 2.7-3-.4L12 22l-2.1-2.2-3 .4-.8-2.9-2.7-1.4 1.4-2.7-.4-3 2.9-.8 1.4-2.7 3 .4L12 2z" /></IconBase>; }
export function CloudOff({ className }) { return <IconBase className={className}><path d="M3 3l18 18" /><path d="M17.5 17H8a5 5 0 0 1-.8-9.9A6.5 6.5 0 0 1 18.7 9" /><path d="M20 16.5A3.5 3.5 0 0 0 18.5 10" /></IconBase>; }
function LogOut({ className }) { return <IconBase className={className}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></IconBase>; }
export function FileSpreadsheet({ className }) { return <IconBase className={className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h8" /><path d="M11 10v9" /></IconBase>; }
export function Languages({ className }) { return <IconBase className={className}><path d="M4 5h8" /><path d="M8 5v12" /><path d="M4 17c3-2 5-5 6-12" /><path d="M12 17c-2-1-4-3-6-6" /><path d="M15 19l3-7 3 7" /><path d="M16 17h4" /></IconBase>; }
function Lock({ className }) { return <IconBase className={className}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></IconBase>; }
export function ShieldCheck({ className }) { return <IconBase className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-5" /></IconBase>; }
function Tablet({ className }) { return <IconBase className={className}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></IconBase>; }
function Users({ className }) { return <IconBase className={className}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></IconBase>; }
function QrCodeIcon({ className }) { return <IconBase className={className}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h2v2h-2z" /><path d="M18 14h3" /><path d="M14 18h3" /><path d="M19 18h2v3h-3" /></IconBase>; }
function Info({ className }) { return <IconBase className={className}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></IconBase>; }
function AlertTriangle({ className }) { return <IconBase className={className}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></IconBase>; }
function Camera({ className }) { return <IconBase className={className}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></IconBase>; }
function MapPin({ className }) { return <IconBase className={className}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></IconBase>; }
function Relocate({ className }) { return <IconBase className={className}><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="3" /></IconBase>; }
function ChevronDown({ className }) { return <IconBase className={className}><path d="M6 9l6 6 6-6" /></IconBase>; }
function Check({ className }) { return <IconBase className={className}><path d="M20 6L9 17l-5-5" /></IconBase>; }
function X({ className }) { return <IconBase className={className}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></IconBase>; }
function Maximize({ className }) { return <IconBase className={className}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></IconBase>; }
function Wifi({ className }) { return <IconBase className={className}><path d="M5 12.5a11 11 0 0 1 14 0" /><path d="M8.5 16a6 6 0 0 1 7 0" /><path d="M12 19.5h.01" /></IconBase>; }
function Search({ className }) { return <IconBase className={className}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></IconBase>; }
function ZoomIn({ className }) { return <IconBase className={className}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></IconBase>; }
function ZoomOut({ className }) { return <IconBase className={className}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M8 11h6" /></IconBase>; }
function Layers({ className }) { return <IconBase className={className}><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></IconBase>; }
function Minimize({ className }) { return <IconBase className={className}><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></IconBase>; }
function RefreshCw({ className }) { return <IconBase className={className}><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" /><path d="M3 16v4h4" /><path d="M21 8V4h-4" /></IconBase>; }
function Eraser({ className }) { return <IconBase className={className}><path d="M7 21H4a1 1 0 0 1-.7-1.7l10-10a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L15 21" /><path d="M22 21H7" /><path d="m5 12 5 5" /></IconBase>; }
function Undo({ className }) { return <IconBase className={className}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" /></IconBase>; }
function Pencil({ className }) { return <IconBase className={className}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></IconBase>; }
function Printer({ className }) { return <IconBase className={className}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></IconBase>; }
function SectionTitle({ icon: Icon, title, subtitle, tooltip }) { return <div className="mb-4 flex items-start gap-3"><div className="rounded-2xl bg-slate-100 p-2"><Icon className="h-5 w-5" /></div><div className="min-w-0"><div className="flex items-center gap-1.5"><h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>{tooltip && <InfoTooltip text={tooltip} />}</div><p className="text-sm text-slate-500">{subtitle}</p></div></div>; }

// Tap-to-toggle explanation bubble (not hover-based: this app runs on touch tablets, which have
// no hover state). Closes on outside click/tap or Escape so it never gets stuck open.
function InfoTooltip({ text, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onOutside(event) { if (ref.current && !ref.current.contains(event.target)) setOpen(false); }
    function onKey(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onOutside); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!text) return null;
  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label || "Info"}
        aria-expanded={open}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-xl border bg-slate-950 p-3 text-xs leading-relaxed text-white shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

const LANGUAGES = ["EN", "CZ", "PL", "DE", "NL"];
const EXAM_LEVELS = ["Practicing", "Consulting"];
const ROLES = ["Admin", "Centre", "Candidate", "Examiner"];
const CENTRES = ["Arboricultural Academy", "VETcert Centre Poland", "VETcert Centre Germany", "VETcert Centre Netherlands"];
export const CENTRE_ACCESS_TOKEN = "VETBARA-CENTRE-ARBOR-2026";
export const CENTRE_QR_ID = "ARBOR-2026";

// The exam id is used as a single path segment in /api/exams/<examId>/<route>. If it ever becomes
// a whole URL (e.g. an operator pastes a Centre access link into the unlock/Exam-ID field, or a
// bad value gets persisted), the embedded "/" ":" "?" "&" split the path and NO route matches, so
// the field-tablet / field-preparation calls return "Method not allowed" (405). Normalise it to a
// safe, stable single segment: pull the token/id out of a pasted URL first, then keep only URL/
// path-safe characters. Idempotent, and a no-op for already-clean ids (e.g. "ARBOR-2026").
export function safeExamId(value, depth = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return CENTRE_QR_ID;
  // Pasted links can nest (examId=<a URL that itself carries token=/id=/examId=>). Peel the URL
  // to its token/id/examId and recurse a bounded number of times before slugging what's left.
  if (/^https?:\/\//i.test(raw) && depth < 4) {
    try {
      const url = new URL(raw);
      const inner = url.searchParams.get("token") || url.searchParams.get("id") || url.searchParams.get("examId");
      if (inner) return safeExamId(inner, depth + 1);
      const path = url.pathname.replace(/\//g, "-");
      if (path && path !== "-") return safeExamId(path, depth + 1);
    } catch { /* fall through to slugging the raw string */ }
  }
  const slug = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || CENTRE_QR_ID;
}

const DEMO_QR_TOKENS = {
  Centre: CENTRE_ACCESS_TOKEN,
  Candidate: "VETBARA-CANDIDATE-C-001-2026",
  Examiner: "VETBARA-EXAMINER-E-001-2026",
};
// The roster is always the real one loaded from the Centre setup — there is deliberately no seed
// roster. Placeholder people ("Candidate 1", "Examiner 2", EX-DEMO-00x) used to be the initial
// state and were indistinguishable from real entries, so a failed setup load left the operator
// issuing QR links for candidates who do not exist.
const EXAMINERS = [];
const START_CANDIDATES = [];
const START_ASSIGNMENTS = {};
const TEST_VARIANTS = [
  { code: "PRACTICING_2026_V1_EN", level: "Practicing", language: "EN", status: "Approved" },
  { code: "PRACTICING_2026_V1_CZ", level: "Practicing", language: "CZ", status: "Approved" },
  { code: "PRACTICING_2026_V2_EN", level: "Practicing", language: "EN", status: "Approved" },
  { code: "CONSULTING_2026_V1_EN", level: "Consulting", language: "EN", status: "Approved" },
  { code: "CONSULTING_2026_V2_EN", level: "Consulting", language: "EN", status: "Approved" },
];

function variantLanguageFromCode(code) {
  const match = String(code || "").match(/_([A-Z]{2})$/);
  return match ? match[1] : "";
}

function pickVariantForLevel(availableVariants, level, language) {
  const variants = Array.isArray(availableVariants) ? availableVariants : [];
  const exact = variants.find((variant) =>
    variant.level === level &&
    variant.language === language &&
    variant.status !== "Disabled"
  );

  if (exact) return exact.code;

  const byCodeLanguage = variants.find((variant) =>
    variant.level === level &&
    variantLanguageFromCode(variant.code) === language &&
    variant.status !== "Disabled"
  );

  if (byCodeLanguage) return byCodeLanguage.code;

  const anyForLevel = variants.find((variant) =>
    variant.level === level &&
    variant.status !== "Disabled"
  );

  return anyForLevel?.code || "";
}

function normalizeExamVariants(availableVariants, language, current = {}) {
  return {
    Practicing: pickVariantForLevel(availableVariants, "Practicing", language) || current.Practicing || "",
    Consulting: pickVariantForLevel(availableVariants, "Consulting", language) || current.Consulting || "",
  };
}

const DEFAULT_TEST_BANK = {
  PRACTICING_2026_V1_CZ: [
  { id: "P-CZ-A01", type: "single_choice", section: "Část A", points: 1, text: "Co jsou „funkční jednotky“ ve vztahu k fyziologickým a mechanickým funkcím stromu?", options: ["Semi-autonomní jednotka spojující kořeny, kmen a výhony (větve).", "Soubor pletiv, který v uspořádaném tvaru vytváří předem určený orgán.", "Buňky, které se vytváří v případě vzniku poškození.", "Část kmene, která se nachází pod tzv. hlavou."] },
  { id: "P-CZ-A02", type: "single_choice", section: "Část A", points: 1, text: "Proč jsou funkční jednotky důležité v péči o senescentní stromy?", options: ["Protože nejsou viditelné na povrchu kmene.", "Jedná se o místo, kde dochází k růstu sekundárních výhonů z tzv. hlav.", "Tyto buňky se vytváří po řezu.", "Funkční jednotky musí být hodnoceny individuálně v případě navrhování pěstebních opatření."] },
  { id: "P-CZ-A03", type: "single_choice", section: "Část A", points: 1, text: "Rozdílné taxony mají rozdílné charakteristiky, které ovlivňují dopad poškození a hniloby. Jak může znalost jádrových dřevin ovlivnit management/péči o senescentní stromy?", options: ["Stromy bez odolného jádrového dřeva by neměly být řezány v zimě.", "Stromy bez odolného jádrového dřeva by neměly být řezány v létě.", "Odolné jádrové dřevo poskytuje pasivní obranu, která napomáhá zpomalit šíření hniloby, které může nastat po ořezu.", "Odolné jádrové dřevo poskytuje aktivní obranu, která napomáhá zpomalit šíření hniloby, které může nastat po ořezu."] },
  { id: "P-CZ-A04", type: "single_choice", section: "Část A", points: 1, text: "Jak rostou kořeny senescentních stromů, ve smyslu obecné definice?", options: ["Jako zrcadlový obraz nadzemní části stromu.", "Jako „báze vinné sklenice“, rozprostírá se více do šířky než do hloubky.", "Rovnoměrně po celém dostupném objemu půdy.", "Kořeny rostou primárně do hloubky, kde hledají vodu."] },
  { id: "P-CZ-A05", type: "single_choice", section: "Část A", points: 1, text: "Jak ořez nadzemní části stromu (koruny) ovlivňuje kořeny senescentních stromů?", options: ["Podpoří zvýšený růst kořenů.", "Způsobí zánik některých kořenů.", "Ořez nebude mít na kořeny žádný vliv.", "Způsobí hnilobu strukturálních kořenů."] },
  { id: "P-CZ-A06", type: "single_choice", section: "Část A", points: 1, text: "Jakou roli hrají mykorrhizní houby v ekosystému?", options: ["Podílejí se na rozkladu dřeva.", "Soutěží se stromy o zdroje.", "Parazitují na kořenech stromů.", "Napomáhají kořenům absorbovat vodu a živiny."] },
  { id: "P-CZ-A07", type: "single_choice", section: "Část A", points: 1, text: "Proč je, z pohledu ekologie, důležité mít v blízkosti senescentních stromů kvetoucí rostliny?", options: ["Vytvářejí atraktivnější krajinu.", "Larvální stadium bezobratlých často vyžaduje zdroj nektaru.", "Dospělí jedinci bezobratlých často vyžadují zdroj nektaru.", "Lákají druhy doprovodných organizmů a napomáhají jim najít senescentní stromy."] },
  { id: "P-CZ-A08", type: "single_choice", section: "Část A", points: 1, text: "Jak velký by měl být chráněný kořenový prostor senescentních stromů dle příručky Ancient Tree Forum?", options: ["10krát průměr kmene v 1,5 m.", "12krát průměr kmene v 1,5 m.", "15krát průměr kmene v 1,5 m.", "17krát průměr kmene v 1,5 m."] },
  { id: "P-CZ-A09", type: "single_choice", section: "Část A", points: 1, text: "Co byste neměli dělat v chráněné kořenové zóně senescentních stromů?", options: ["Měnit úroveň terénu.", "Provádět pěstební opatření.", "Aplikovat mulč.", "Provádět průzkum kořenů."] },
  { id: "P-CZ-A10", type: "single_choice", section: "Část A", points: 1, text: "Jaké budou následky vysoké míry mortality senescentních stromů v dané lokalitě?", options: ["Zvýšenou finanční náročnost péče.", "Zvýšený požadavek na bezpečnost při práci na stromech.", "Dopad na udržitelnost populace senescentních stromů.", "Škodlivý dopad na půdní prostředí."] },

  { id: "P-CZ-B01", type: "open_text", section: "Část B – Vývoj a proces stárnutí stromů", points: 2, text: "Široké spektrum faktorů ovlivňuje růst stromu. Vyjmenujte 2 abiotické (externí) faktory a 2 faktory z oblasti managementu stromů, které mohou ovlivňovat růst senescentních stromů." },
  { id: "P-CZ-B02", type: "open_text", section: "Část B – Vývoj a proces stárnutí stromů", points: 1, text: "Řez stromů má negativní vliv na jeho fyziologické funkce. Pokud je větev senescentního stromu odstraněna, co je hlavním činitelem, který vstupuje do funkčního dřeva a způsobuje, že se stává nefunkčním?" },
  { id: "P-CZ-B03", type: "open_text", section: "Část B – Vývoj a proces stárnutí stromů", points: 1, text: "Senescentní stromy mají pasivní a aktivní obranné mechanizmy, jimiž reagují na stres či poškození. Uveďte 2 příklady pasivní obrany." },
  { id: "P-CZ-B04", type: "open_text", section: "Část B – Kořeny senescentních stromů a půdní prostředí", points: 1, text: "Zdravé půdní prostředí je základem pro zdraví (dobrý stav) senescentních stromů. Proč?" },
  { id: "P-CZ-B05", type: "open_text", section: "Část B – Kořeny senescentních stromů a půdní prostředí", points: 2, text: "Popište charakteristiky písčité půdy s ohledem na schopnost zadržování vody a provzdušnění." },
  { id: "P-CZ-B06", type: "open_text", section: "Část B – Kořeny senescentních stromů a půdní prostředí", points: 1, text: "Nadměrný obsah moči a hnůj hospodářských zvířat v kořenovém prostoru senescentních stromů budou mít negativní vliv na senescentní stromy. Proč?" },
  { id: "P-CZ-B07", type: "open_text", section: "Část B – Kořeny senescentních stromů a půdní prostředí", points: 2, text: "Stromy jsou citlivé na změny půdního prostředí. Popište, jaký dopad mohou mít na kořeny stromů uvedené změny: 1. zhutnění, 2. změny v úrovni terénu." },
  { id: "P-CZ-B08", type: "open_text", section: "Část B – Kořeny senescentních stromů a půdní prostředí", points: 2, text: "Chráněný kořenový prostor je využíván k ochraně kořenů a půdy v okolí senescentních stromů v případě, že není známá skutečná pozice kořenů. Vyjmenujte 2 faktory, které ovlivňují aktuální pozici kořenů (tvar/architekturu kořenového systému)." },
  { id: "P-CZ-B09", type: "open_text", section: "Část B – Hodnota senescentních stromů", points: 2, text: "Přítomnost senescentních stromů v dnešní době ukazuje, že přežívají v krajině po dlouhý časový úsek. Uveďte 2 kulturní faktory, které mohly hrát roli při zachování senescentních stromů v krajině." },
  { id: "P-CZ-B10", type: "open_text", section: "Část B – Hodnota senescentních stromů", points: 1, text: "Obecně, čím déle jsou senescentní stromy v krajině přítomné, tím vyšší je jejich ekologická hodnota. Vysvětlete proč." },
  { id: "P-CZ-B11", type: "open_text", section: "Část B – Hodnota senescentních stromů", points: 3, text: "Uveďte 3 příklady, proč se habitaty (prvky s biologickým potenciálem) na senescentních stromech mohou lišit i přesto, že jsou stromy na stejném stanovišti." },
  { id: "P-CZ-B12", type: "open_text", section: "Část B – Hodnota senescentních stromů", points: 1, text: "Vysvětlete, jak může vzdálenost mezi senescentními stromy ovlivnit jejich ekologickou hodnotu." },
  { id: "P-CZ-B13", type: "open_text", section: "Část B – Legislativa a oficiální metodiky vztahující se k senescentním stromům", points: 2, text: "Existují různé legislativní požadavky (předpisy), které by měly být zváženy při péči o senescentní stromy. Popište z pohledu praktika, co musíte udělat, abyste dodrželi následující okruhy legislativních požadavků: zákony vztahující se k ochraně živočichů a rostlin; zákony vztahující se k ochraně kulturního dědictví." },
  { id: "P-CZ-B14", type: "open_text", section: "Část B – Legislativa a oficiální metodiky vztahující se k senescentním stromům", points: 1, text: "Jaké faktory byste měli zvážit, pokud budete pečovat o senescentní stromy v jiné zemi/regionu?" },
  { id: "P-CZ-B15", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Popište, jaký je hlavní záměr péče o senescentní stromy." },
  { id: "P-CZ-B16", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Co byste měli zvážit na prvním místě, pokud rozhodujete o péči/managementu na senescentních stromech?" },
  { id: "P-CZ-B17", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Uveďte 2 příklady toho, jak se péče o senescentní stromy odlišuje od péče o mladší stromy." },
  { id: "P-CZ-B18", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Pro příklady uvedené výše vysvětlete, proč tomu tak je." },
  { id: "P-CZ-B19", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Uveďte 2 důvody, proč je důležité provádět monitoring (záznam) péče o senescentní stromy." },
  { id: "P-CZ-B20", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Jste požádáni, abyste instalovali vazby na senescentní strom s již staršími instalovanými vazbami. Vyjmenujte 2 věci, které byste měli zvážit před instalací nových vazeb." },
  { id: "P-CZ-B21", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Plán pěstebních opatření vyžaduje instalaci podpěry větve. Uveďte 2 opatření, které můžete provést, abyste zabránili/minimalizovali poškození stromu při instalaci podpěry stromu." },
  { id: "P-CZ-B22", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Uveďte 2 důvody, proč je důležité mít podporu veřejnosti při ochraně a péči o senescentní stromy." },
  { id: "P-CZ-B23", type: "open_text", section: "Část B – Management/Péče o senescentní stromy", points: 1, text: "Klient vyžaduje psanou zprávu (posudek) na stav senescentního stromu. Co byste doporučil jako praktik?" },
  { id: "P-CZ-B24", type: "open_text", section: "Část B – Otázky specifické pro ČR", points: 5, text: "Které stromy mají podle zákona 114/1992 Sb. a prováděcích vyhlášek stanovený zvláštní režim ochrany?" },
],
  PRACTICING_2026_V1_EN: [
    { id: "P1-Q1", type: "single_choice", points: 1, text: "In relation to the physiological and structural function of a tree, what is a functional unit?", options: ["A semi-autonomous unit comprising roots, trunk and shoots.", "A collection of tissues operating only in the current annual ring.", "The cells that form only when a wound is created.", "The section of trunk below the pollard knuckle."], correctAnswer: "A semi-autonomous unit comprising roots, trunk and shoots." },
    { id: "P1-Q2", type: "single_choice", points: 1, text: "Which action is generally most compatible with protecting a veteran tree rooting environment?", options: ["Raising soil level around the stem", "Compacting the access route", "Mulching with appropriate material", "Removing all fallen deadwood"], correctAnswer: "Mulching with appropriate material" },
    { id: "P1-Q3", type: "single_choice", points: 1, text: "Why can crown retrenchment be beneficial to a veteran tree?", options: ["It reduces biomechanical loading and can shorten transport distances.", "It removes all decay from the stem.", "It prevents reiteration.", "It makes root protection unnecessary."], correctAnswer: "It reduces biomechanical loading and can shorten transport distances." },
    { id: "P1-Q4", type: "written", points: 2, text: "List two measures you would take to reduce the risk of spreading pests and diseases during veteran tree work." },
    { id: "P1-Q5", type: "written", points: 3, text: "Give three veteran tree features that should be considered before deciding how to access the crown." },
    { id: "P1-Q6", type: "written", points: 4, text: "Describe how you would protect the rooting environment of a veteran tree during practical work." },
    { id: "P1-Q7", type: "written", points: 4, text: "Explain how cut material may be managed on site and give advantages or disadvantages of your chosen approach." },
    { id: "P1-Q8", type: "written", points: 5, text: "Describe how you would interpret the health / vitality of a veteran tree using visible evidence." },
  ],
  PRACTICING_2026_V2_EN: [
    { id: "P2-Q1", type: "single_choice", points: 1, text: "Which feature is commonly associated with veteran tree habitat value?", options: ["Hollowing and decaying wood", "Uniform nursery pruning only", "Absence of fungi", "Complete removal of deadwood"], correctAnswer: "Hollowing and decaying wood" },
    { id: "P2-Q2", type: "single_choice", points: 1, text: "What is the best first response if the work instruction may damage a sensitive habitat feature?", options: ["Stop and seek clarification", "Proceed quickly", "Remove the feature", "Ignore it if small"], correctAnswer: "Stop and seek clarification" },
    { id: "P2-Q3", type: "single_choice", points: 1, text: "Why is phased halo release often preferred?", options: ["It reduces sudden physiological and environmental shock", "It removes all competition immediately", "It prevents monitoring", "It eliminates future veteran trees"], correctAnswer: "It reduces sudden physiological and environmental shock" },
    { id: "P2-Q4", type: "written", points: 3, text: "Describe three indicators of past management on a veteran tree." },
    { id: "P2-Q5", type: "written", points: 4, text: "Explain how you would plan access to a veteran tree while avoiding damage to roots and habitat features." },
    { id: "P2-Q6", type: "written", points: 4, text: "Describe how mulch may be used around a veteran tree and what risks should be avoided." },
    { id: "P2-Q7", type: "written", points: 5, text: "Explain how wildlife features may change your practical work method." },
    { id: "P2-Q8", type: "written", points: 5, text: "Describe a suitable management response to one threat affecting a veteran tree and explain why it is proportionate." },
  ],
  CONSULTING_2026_V1_EN: [
    { id: "C1-Q1", type: "written", points: 4, text: "Describe how veteran trees naturally hollow over time and explain why hollowing is not automatically a reason for removal." },
    { id: "C1-Q2", type: "written", points: 6, text: "Provide three types of soil damage that can affect veteran trees and describe the likely physiological or structural consequences of each." },
    { id: "C1-Q3", type: "written", points: 6, text: "Describe one diagnostic tool for assessing structural integrity and explain at least two limitations when applying it to veteran trees." },
    { id: "C1-Q4", type: "written", points: 5, text: "Explain why a risk-benefit approach is especially important when managing veteran trees in public spaces." },
    { id: "C1-Q5", type: "written", points: 6, text: "Describe how fungal decay can be both structurally significant and ecologically valuable. Include examples of information you would record." },
    { id: "C1-Q6", type: "written", points: 6, text: "Describe the process you would use to specify phased halo release around a veteran tree and explain why phasing may be necessary." },
    { id: "C1-Q7", type: "written", points: 6, text: "Explain how you would assess targets, occupancy and consequences when evaluating risk from a veteran tree." },
    { id: "C1-Q8", type: "written", points: 8, text: "Write a concise justification for a management recommendation that balances tree value, risk, conservation objectives and practical feasibility." },
  ],
  CONSULTING_2026_V2_EN: [
    { id: "C2-Q1", type: "written", points: 4, text: "Explain how historic management such as pollarding or lapsed pollarding influences present management decisions." },
    { id: "C2-Q2", type: "written", points: 6, text: "Describe how you would assess health and vitality in different functional units of a veteran tree." },
    { id: "C2-Q3", type: "written", points: 6, text: "Describe how protected species, habitat continuity and statutory constraints influence veteran tree management." },
    { id: "C2-Q4", type: "written", points: 6, text: "Give examples of management options for a veteran tree with a significant biomechanical defect, including advantages and disadvantages." },
    { id: "C2-Q5", type: "written", points: 6, text: "Describe how you would prepare a long-term management plan for a veteran tree population on a site." },
    { id: "C2-Q6", type: "written", points: 6, text: "Explain how you would prioritise management when a veteran tree has high ecological value but also a credible safety concern." },
    { id: "C2-Q7", type: "written", points: 6, text: "Describe what information should be included in a professional veteran tree report to make recommendations auditable and repeatable." },
    { id: "C2-Q8", type: "written", points: 8, text: "Write a short client-facing explanation of why a veteran tree should not be managed only as a conventional risk object." },
  ],
};
const REPORT_TREES = ["Tree A", "Tree B"];
// title/description are translation KEYS, not display text — module scope has no t(). Resolve
// via sectionTitle(t, entry) / sectionDescription(t, entry) at render time.
const REPORT_SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"].map((key) => ({ key, titleKey: `reportSections.${key}` }));

// Candidate-facing summary of what the written management plan is marked on (as opposed to
// REPORT_MARKING_SECTIONS below, which is the examiner's internal per-band scoring guidance).
// Kept visible throughout field data collection so a Consulting candidate always knows what
// their photos/notes need to support, and seeded into "Field notes" (see CONSULTING_FIELD_NOTES_TEMPLATE)
// since that field never enters the report itself and is safe to pre-fill as a reminder.
const CONSULTING_REPORT_CRITERIA = [
  { key: "health", marks: 20, title: "Health and vitality of the tree", description: "Please ensure you explain what factors you have taken into consideration when assessing the health and vitality of the tree." },
  { key: "structure", marks: 20, title: "Structural condition (biomechanics) of the tree", description: "Please ensure you explain what factors you have taken into consideration when assessing the structural condition of the tree." },
  { key: "values", marks: 12, title: "Wildlife, historical, cultural or social values of the tree", description: "You only need to write about two of these four options, but please pick the two most relevant and explain how these values apply to your tree." },
  { key: "threats", marks: 12, title: "Threats to the tree", description: "Please describe the most significant threats to the tree, including their potential impact, and also including what will happen if you do nothing." },
  { key: "plan", marks: 24, title: "Management plan", description: "Please provide a management plan for this tree with a timetable, work specifications and monitoring. This should include sufficient detail to allow the work to be planned, from start to finish, and ensuring that a contractor or site manager knows exactly how to undertake the work. Feel free to use photos to illustrate your specifications." },
  { key: "justification", marks: 20, title: "Management justification summary", description: "Considering everything you have assessed and described above, please provide a short summary justifying why you think your management plan is the most appropriate for the tree. This summary should include both positive and negative impacts for the tree. Upon reading this summary, the tree owner should feel convinced and compelled to follow your advice." },
];

function buildConsultingFieldNotesTemplate() {
  const intro = "The items below are the headings under which the management plan will be marked along with the potential marks available. Any management specifications should be adequately described so that the person undertaking the work clearly understands what should be done. Photos may be used to illustrate your plan.";
  const body = CONSULTING_REPORT_CRITERIA.map((section, index) => `${index + 1}. ${section.title} (${section.marks} marks)\n${section.description}`).join("\n\n");
  return `${intro}\n\n${body}`;
}
const CONSULTING_FIELD_NOTES_TEMPLATE = buildConsultingFieldNotesTemplate();

// VETcert Consulting "Veteran tree management plan - model answer", version April 2020: the marking
// scheme the examiner works to. 7 per-tree sections scored for Tree A and Tree B (59 marks each),
// plus 9 marks for overall clarity of the whole plan = 127. `guidance` is the marking band text from
// the model answer, shown next to the score box so the examiner does not need the paper document.
const REPORT_MARKING_SECTIONS = [
  {
    key: "basic",
    title: "Section 1 - Basic information regarding the tree",
    perTreeMax: 5,
    guidance: [
      "1 mark for any of the following:",
      "Correct tree species identification.",
      "Accurate measurements (girth, crown spread, height).",
      "Correct identification of tree form.",
      "Providing a tree number / recording tag number.",
      "Grid reference / tree locations illustrated on a plan.",
      "Correct identification of the conditions in which the tree is located (avenue, wood pasture, park, ...).",
      "Photograph clearly showing the tree enabling it to be located easily.",
      "Topography.",
      "Soil.",
    ],
  },
  {
    key: "health",
    title: "Section 2 - Health and vitality of the tree",
    perTreeMax: 10,
    guidance: [
      "2 marks (poor) - correct 'condition score' only.",
      "4 marks (fair) - condition score and up to 2 pieces of supporting information.",
      "6 marks (good) - as above and at least 3 pieces of supporting information.",
      "8 marks (very good) - as above, at least 4 pieces, and must consider different condition/age of the crown/functional units.",
      "10 marks (excellent) - as above, at least 5 pieces, and must consider different condition/age of the crown/functional units.",
      "Supporting information: leaf/bud density, leaf size/colour, extension growth, branch ramification, size of living crown, woundwood/occlusion, adaptive growth, epicormic growth.",
    ],
  },
  {
    key: "structure",
    title: "Section 3 - Structural condition (biomechanics) of the tree",
    perTreeMax: 10,
    guidance: [
      "2 marks (poor) - correct 'condition score' only.",
      "4 marks (fair) - condition score and at least 1 piece of supporting information.",
      "6 marks (good) - condition score and at least 2 pieces of supporting information.",
      "8 marks (very good) - as above and must consider how long the tree has been like that.",
      "10 marks (excellent) - as above and must consider how the tree has responded (adaptive growth).",
      "Supporting information: biomechanical defects (cavities, splits, fibre buckling, weak forks, root plate movement, previous failures), fungal fruiting bodies, history and lapses of management, different functional units.",
    ],
  },
  {
    key: "values",
    title: "Section 4 - Wildlife, historical, cultural or social values of the tree",
    perTreeMax: 6,
    guidance: [
      "Marks under 2 headings only (wildlife, historical, cultural, social values); maximum 3 marks per heading.",
      "1 mark (poor) - basic description of the value.",
      "2 marks (fair) - semi-detailed description of the value.",
      "3 marks (good) - detailed description of the value.",
    ],
  },
  {
    key: "threats",
    title: "Section 5 - Threats to the tree",
    perTreeMax: 6,
    guidance: [
      "3 marks for describing the threat, 3 marks for discussing 'do nothing'.",
      "Threat: correct identification of the threat, of its cause, which parts of the tree it affects, how long it has been posing a threat.",
      "Do nothing: impact on health, on structural condition, on a sensitive feature, whether the impact is increasing, its significance and timescale, whether it is reversible.",
      "Where more than one threat is reported, the examiner may give an average score.",
    ],
  },
  {
    key: "plan",
    title: "Section 6 - Management plan / detailed work specification",
    perTreeMax: 12,
    guidance: [
      "Brief overview of management (vision/end point), who will undertake the work, and the detailed specification.",
      "Most items carry 1 mark; some carry 2 or 3. More than 12 marks are listed in the model answer so the examiner has a range of options - cap the section at 12.",
      "If the candidate proposes no cutting for either tree, mark both using the 'do nothing' tables.",
    ],
  },
  {
    key: "justification",
    title: "Section 7 - Management justification summary",
    perTreeMax: 10,
    guidance: [
      "3 marks for the justification (good 3, fair 2, poor 1, none 0).",
      "3 marks for consideration of positive impacts on the tree.",
      "3 marks for consideration of negative impacts on the tree.",
      "1 mark for convincing the tree owner.",
    ],
  },
];

// Section 6 (the "plan" entry above) splits into two mutually exclusive item tables, matching
// the model answer: one for a candidate who proposes cutting/soil/shade management, one for a
// candidate who recommends doing nothing. Each table lists more marks than the 12-mark cap on
// purpose (a range of options for the examiner) - the section score is the sum of whichever
// table's items are filled in, capped at REPORT_PLAN_CAP.
const REPORT_PLAN_CAP = 12;

const REPORT_PLAN_MANAGEMENT_ITEMS = [
  { key: "overview", title: "Brief overview of management (vision/end point).", max: 1 },
  { key: "who", title: "Who will undertake the management work.", max: 1 },
  { key: "sensitiveFeatures", title: "Identification of sensitive features to be retained / not damaged during works.", max: 1 },
  { key: "climate", title: "Consideration of climate, historic management, recent weather conditions and likely future conditions.", max: 1 },
  { key: "timing", title: "Timing (season) / priority of work.", max: 1 },
  { key: "timetable", title: "A suitable timetable given where work should be phased, or management actions repeated (e.g. pollarding). If shade clearance is proposed - how quickly should the shade be removed? For soil amelioration - how much of the soil area will be treated in one operation? 2 marks only given if the timetable has a longer timescale and several phases.", max: 2 },
  { key: "workSpec", title: "Clear work specification including: details of where to mark final cuts / how much foliage is to be removed / trees to be removed / area of soil to be treated.", max: 1 },
  { key: "appropriateChoice", title: "Appropriate choice of management. Does the management address the threats (1 mark)? Will the management extend the life of the tree or retain its value (1 mark)?", max: 2 },
  { key: "machinery", title: "Type of machinery to bring to site and access routes.", max: 1 },
  { key: "finishingCut", title: "Detail of finishing cut (e.g. retention of stubs, natural fracture / rip cuts, target pruning) and/or techniques used (e.g. when clearing for shade, ringbarking, veteranisation).", max: 1 },
  { key: "arisings", title: "Treatment of arisings.", max: 1 },
  { key: "monitoring", title: "Requirement for monitoring (including what is to be monitored and when). 1 mark for mentioning monitoring, 2 marks only awarded if they include what or when, 3 marks for what and when.", max: 3 },
  { key: "limitations", title: "Limitations (e.g. further survey work required).", max: 1 },
];

const REPORT_PLAN_DO_NOTHING_ITEMS = [
  { key: "doNothingAppropriate", title: "'Do nothing' considered appropriate. 2 marks if the candidate recommends 'do nothing' but gives no justification (the examiner must agree it is an appropriate recommendation). 4 marks if only a basic justification is given (examiner must agree). 6 marks if a full, detailed justification is given (examiner must agree).", max: 6 },
  { key: "overview", title: "Brief overview of management (vision/end point).", max: 1 },
  { key: "climate", title: "Consideration of climate, historic management, recent weather conditions and likely future conditions.", max: 1 },
  { key: "limitations", title: "Limitations (e.g. further survey work required).", max: 1 },
  { key: "monitoring", title: "Requirement for monitoring (including what is to be monitored and when).", max: 3 },
];

function reportPlanItemsForMode(mode) {
  return mode === "doNothing" ? REPORT_PLAN_DO_NOTHING_ITEMS : REPORT_PLAN_MANAGEMENT_ITEMS;
}

// Derives the "plan" section's score from its item breakdown - falls back to the old flat
// `.score` for marks saved before this itemization existed, so nothing already scored resets to 0.
function reportPlanScore(mark) {
  if (!mark) return 0;
  if (mark.items && typeof mark.items === "object") {
    const items = reportPlanItemsForMode(mark.mode);
    const sum = items.reduce((total, item) => total + (Number(mark.items[item.key]) || 0), 0);
    return Math.min(REPORT_PLAN_CAP, sum);
  }
  return Number(mark.score) || 0;
}

// Whole-plan marks, not per tree: 3 each, 9 in total.
const REPORT_CLARITY_ITEMS = [
  { key: "spelling", title: "Spelling and grammar", max: 3 },
  { key: "layout", title: "Layout / formatting", max: 3 },
  { key: "photographs", title: "Use of photographs to supplement text", max: 3 },
];

const REPORT_MARKING_INTRO = [
  "Candidates are asked to survey two veteran trees and produce a management plan detailing their findings. A total of 127 marks are available for this element of the VETcert exam. The model answer provides structure and guidance whilst assessing the management plan. The model answer is separated into 7 sections, these are detailed below.",
  "Section 1 - Basic information regarding the trees (10 marks)",
  "Section 2 - Health and vitality of the tree (20 marks)",
  "Section 3 - Structural condition (biomechanics) of the tree (20 marks)",
  "Section 4 - Wildlife, historical, cultural or social values of the tree (12 marks)",
  "Section 5 - Threats to the tree (12 marks)",
  "Section 6 - Management plan (24 marks)",
  "Section 7 - Management justification summary (20 marks)",
  "In addition to the above marks, there are a further 9 marks available for overall clarity of the management plan.",
  "This document has been produced to provide a framework for awarding marks for this element of the exam. Please note that this document is a guide and examiner discretion is permitted.",
];

const REPORT_MARKING_TOTAL = REPORT_MARKING_SECTIONS.reduce((sum, section) => sum + section.perTreeMax * 2, 0)
  + REPORT_CLARITY_ITEMS.reduce((sum, item) => sum + item.max, 0);

const CANDIDATE_SECTIONS = {
  // Tree preparation stays Practicing-only: kept removed for Consulting per an earlier request,
  // restored here for Practicing (it was pulled from both levels only because it crashed - see
  // syncCandidatePreparation below for the actual fix).
  Practicing: [
    { key: "field-orientation", titleKey: "candidateSections.orientation.title", descriptionKey: "candidateSections.orientation.description" },
    { key: "field-trees", titleKey: "candidateSections.trees.title", descriptionKey: "candidateSections.trees.description" },
    { key: "test", titleKey: "candidateSections.writtenTest.title", descriptionKey: "candidateSections.writtenTest.practicingDescription" },
  ],
  Consulting: [
    { key: "field-orientation", titleKey: "candidateSections.orientation.title", descriptionKey: "candidateSections.orientation.description" },
    { key: "test", titleKey: "candidateSections.writtenTest.title", descriptionKey: "candidateSections.writtenTest.consultingDescription" },
    { key: "report", titleKey: "candidateSections.report.title", descriptionKey: "candidateSections.report.description" },
  ],
};
function sectionTitle(t, entry) { return entry?.titleKey ? t(entry.titleKey) : (entry?.title || ""); }
function sectionDescription(t, entry) { return entry?.descriptionKey ? t(entry.descriptionKey) : (entry?.description || ""); }
const OUTDOOR_SECTIONS = {
  Practicing: ["generic", "prework", "threats", "history", "risk"],
  Consulting: ["generic", "history", "risk"],
};

const OUTDOOR_TITLES = {
  generic: "Část 1 - Pohovor / všeobecné otázky",
  prework: "Část 2 - Strom A - Cvičení 1 - Zhodnocení situace před započetím prací",
  threats: "Část 2 - Strom B - Cvičení 2 - Vyhodnocení hrozeb",
  history: "Historie stromu a stanoviště",
  risk: "Vyhodnocení rizik / provozní bezpečnost",
};

const OUTDOOR_ITEMS = {
  Practicing: {
    generic: [
      { id: "P-G-01", text: "Můžete popsat 3 základní charakteristiky senescentního stromu?", max: 1, notes: "1 bod za 3 charakteristiky, 0.5 bodu za dvě. Příklady: vysoký věk s ohledem na druh, ústup koruny, historie managementu, nadprůměrná dimenze kmene, komplexní struktura/funkční jednotky, dutiny či rozkládající se dřevo." },
      { id: "P-G-02", text: "Můžete popsat, jaká je hodnota tohoto stromu?", max: 1, notes: "1 bod za 3 charakteristiky, 0.5 bodu za dvě. Historická hodnota, ekologická hodnota / doprovodné organizmy, kulturně historická hodnota, estetické kvality." },
      { id: "P-G-03", text: "Popište 3 charakteristické znaky stromů, které jim umožňují dlouhověký růst.", max: 3, notes: "Neukončený přírůst, každoroční nové vrstvy dřeva, schopnost reiterace, hřížení/fénix/výmladky, vytváření dutin, ústup primární koruny a tvorba sekundární koruny." },
      { id: "P-G-04", text: "Z jakého důvodu může být pro strom prospěšná hniloba kmene?", max: 1, notes: "Recyklace živin dříve uzamčených v centrální části kmene; stimulace vnitřních kořenů a vznik oddělených funkčních jednotek." },
      { id: "P-G-05", text: "Jak může být přínosem pro strom ústup jeho koruny (retrenchment)?", max: 1, notes: "Menší koruna znamená menší zatížení větrem; kratší vzdálenost mezi kořeny a listy; ztráta apikální dominance umožňuje reiteraci." },
      { id: "P-G-06", text: "Prosím identifikujte typ hniloby.", max: 1, notes: "Bílá, hnědá nebo měkká hniloba. Požadován jeden správný příklad." },
      { id: "P-G-07", text: "Popište proces rozkladu dřeva pro příklad uvedený výše.", max: 1, notes: "Bílá hniloba: rozklad ligninu jako první nebo celulózy a ligninu ve stejném rozsahu. Hnědá hniloba: nejdříve celulóza. Měkká hniloba: celulóza rozkladem buněčných stěn." },
      { id: "P-G-08", text: "Můžete identifikovat druh houby, která může vytvářet tento typ hniloby?", max: 1, notes: "1 bod za odpovídající druh houby." },
      { id: "P-G-09", text: "Vyberte skupinu doprovodných organizmů a popište druh/skupinu, habitatové požadavky a dopad na plán péče.", max: 4, notes: "1 bod za správný druh/skupinu, 1 bod za stanoviště/habitat, 2 body za vhodnou úpravu či přizpůsobení pěstebních opatření." },
      { id: "P-G-10", text: "Můžete uvést 4 příklady postupů pro zlepšení či udržení habitatů na tomto stanovišti?", max: 4, notes: "Příklady: pokračovat ve stávající péči, vytvořit nové stromy s podobnou funkcí, zachovat potenciální senescentní stromy, výsadby/přirozená regenerace, podpora nektarodárných rostlin a keřů, ponechání mrtvého dřeva, speciální opatření pro kontinuitu habitatů, management zastíněné borky, pastva, zmírnění zhutnění půdy, veteranizace s navazující otázkou." },
      { id: "P-G-11", text: "Vyberte typ nářadí a popište výhody a nevýhody jeho použití ve vztahu k péči o senescentní stromy.", max: 2, notes: "Ruční pilka, elektrická řetězová pila nebo motorová řetězová pila. 0.5 bodu za výhodu či nevýhodu; pro více než 1 bod musí kandidát uvést výhody i nevýhody." },
      { id: "P-G-12", text: "Pokud plán péče nespecifikuje, co provést s ořezanými větvemi apod., co byste udělali? Uveďte výhody a nevýhody.", max: 2, notes: "Možnosti: ponechat na místě, vytvořit hromadu a ponechat na místě, štěpkování. 0.5 bodu za výhodu či nevýhodu; pro více než 1 bod musí kandidát uvést výhody i nevýhody." },
      { id: "P-G-13", text: "Můžete uvést, co byste měli zvážit v případě mulčování senescentního stromu?", max: 2, notes: "0.5 bodu za každou poznámku. Např. potřeba vylepšení půdy, zdroj organického materiálu, druh štěpky, částečné rozložení, aplikace, rozsah a hloubka, vyhnout se hromadění u báze, údržba, odstranění drnu, bylinná vrstva, sledování reakce stromu." },
      { id: "P-G-14", text: "Můžete uvést preventivní opatření pro omezení šíření škůdců a chorob před, během a po ukončení prací?", max: 2, notes: "0.5 bodu za každou poznámku. Např. parkování mimo stanoviště, jen nutné vybavení, čištění a dezinfekce, ruční nářadí, ponechání materiálu na místě, omezení přesunu půdy a rostlinného materiálu, zakrytí transportovaného materiálu, vhodná doba řezu." },
    ],

    prework: [
      { id: "P-PW-01", text: "Prosím řekněte, jaká je vitalita tohoto stromu. Jak jste to určil?", max: 10, notes: "2 body: správný stupeň bez ukazatelů. 4 body: stupeň + 2 ukazatele. 6 bodů: stupeň + 3 ukazatele. 8 bodů: stupeň + nejméně 4 ukazatele a zvážení odlišných podmínek/věku koruny/funkční jednotky. 10 bodů: stupeň + nejméně 5 ukazatelů a zvážení odlišných podmínek/věku koruny/funkční jednotky. Možné 0.5 body." },
      { id: "P-PW-02", text: "Prosím řekněte, jaký je zdravotní stav a stabilita tohoto stromu. Jak jste to určil?", max: 10, notes: "2 body: správný stupeň bez ukazatelů. 4 body: stupeň + 1 ukazatel. 6 bodů: stupeň + 2 ukazatele. 8 bodů: 2 ukazatele a zvážení délky trvání stavu. 10 bodů: 2 ukazatele a zvážení reakce stromu/adaptivního růstu. Možné 0.5 body." },
      { id: "P-PW-03", text: "Podle plánu kandidáta zhodnoťte vhodnou pozici pro vjezd/výjezd, vybavení, parkování, plnění, trasy vozidel a další stroje.", max: 2, notes: "0.5 bodu za každou odpovídající odpověď. Zahrnout ochranu půdy a citlivých habitatů." },
      { id: "P-PW-04", text: "Jak budete vystupovat do koruny a jak minimalizujete poškození stromu a citlivých prvků?", max: 10, notes: "Směr 1 lezení: vybavení pro minimalizaci poškození, kotevní bod a výstupová cesta, vyhnutí se citlivým prvkům. Směr 2 plošina: typ plošiny, umístění, vyhnutí se poškození půdy a habitatů. Až 10 bodů." },
      { id: "P-PW-05", text: "Můžete popsat, kde budete provádět konkrétní řezy a vysvětlit proč, typ finálního řezu, očekávaný dopad a pravděpodobnost dobré reakce stromu?", max: 10, notes: "Zohlednit velikost a typ rány, druh stromu a jádrové dřevo, pozici vzhledem k postranním větvím/výhonům, schopnost sekundárních výhonů, vitalitu/zdravotní stav, CODIT, nutnost pokračování ošetření a typ finálního řezu." },
      { id: "P-PW-06", text: "Proč byste měl mít pod kontrolou pád ořezaných částí a jak toho dosáhnete?", max: 1, notes: "1 bod za vhodný návrh opatření." },
    ],

    threats: [
      { id: "P-TH-01", text: "Strom B - vyhodnocení hrozeb: zastínění nebo zhoršené půdní prostředí.", max: 8, notes: "Varianta zastínění: až 2 body za identifikaci stínu/zastínění, až 2 body za uvolnění z porostu, až 4 body za popis provedení a úvahy. Varianta půda: až 2 body za zhoršené půdní podmínky, až 2 body za řešení, až 4 body za praktické kroky ke zlepšení půdy. Pokud kandidát správně neidentifikuje hrozbu, v navazujících otázkách nepokračovat." },
    ],

    history: [
      { id: "P-HI-01", text: "Prosím řekněte nám informace o historii tohoto stromu.", max: 8, notes: "Forma/tvar stromu, evidence zásahů/managementu, různé typy či fáze péče, přerušená/pokračující péče, evidence poškození, změny v prostředí, změny stromu v čase, tree body language. Zkoušející může použít vlastní uvážení." },
      { id: "P-HI-02", text: "Prosím řekněte mi informace o historii krajiny, ve které se nacházíme.", max: 8, notes: "Věk/stáří krajiny, věk/stáří stromů, věková struktura populace, druhová diverzita, formy stromů, chybějící úseky či změny managementu, využívání stromů/krajiny, integrita historie, vrstvy historie, fragmentace." },
    ],

    risk: [
      { id: "P-RI-01", text: "Můžete identifikovat 2 biomechanické prvky na tomto stromě, které mohou způsobit zvýšení rizika jeho selhání?", max: 2, notes: "2 body za dva relevantní biomechanické defekty. Snížit hodnocení, pokud identifikované prvky nepředstavují opravdové riziko." },
      { id: "P-RI-02", text: "Jaké jsou výhody a nevýhody ponechání těchto prvků na stromě?", max: 2, notes: "Kandidát prokáže znalost rovnováhy mezi rizikem a benefitem, například estetickou nebo ekologickou hodnotou." },
      { id: "P-RI-03", text: "Co je to cíl pádu z pohledu provozní bezpečnosti a jaký rozdíl je dán stanovištěm stromu?", max: 2, notes: "Cíl pádu je předmět poranění či poškození v mezích potenciálního ohrožení. Pokud je cíl pádu rozdílný, mění se i riziko; bez cíle není riziko." },
      { id: "P-RI-04", text: "Jak odpovíte laikovi, který je znepokojen bezpečností „umírajícího stromu“ a doporučuje pokácení?", max: 3, notes: "Až 3 body: strom neumírá, rozlišení rizika a havarijního stavu, vysoká hodnota stromu, proč je strom ponechaný/udržovaný na místě." },
    ],
  },

  Consulting: {
    generic: [
      { id: "C-G-01", text: "Můžete říci 3 základní charakteristiky senescentního stromu?", max: 1, notes: "1 bod za 3 charakteristiky, 0.5 bodu za dvě. Příklady: vysoký věk, ústup koruny, historie managementu, nadprůměrná dimenze, komplexní struktura/funkční jednotky, dutiny či rozkládající se dřevo." },
      { id: "C-G-02", text: "Popište 3 charakteristické znaky stromů, které jim umožňují dlouhověký růst.", max: 3, notes: "Neukončený přírůst, nové vrstvy dřeva, reiterace, hřížení/fénix/výmladky, vytváření dutin, ústup primární koruny a tvorba sekundární koruny." },
      { id: "C-G-03", text: "V čem je ústup jeho koruny (retrenchment) přínosem pro strom?", max: 1, notes: "Menší zatížení větrem, kratší vzdálenost mezi kořeny a listy, ztráta apikální dominance umožňuje reiteraci." },
      { id: "C-G-04", text: "Prosím identifikujte typ hniloby.", max: 1, notes: "Bílá, hnědá nebo měkká hniloba. Jeden příklad." },
      { id: "C-G-05", text: "Popište, jak probíhá proces rozkladu dřeva dřevními houbami.", max: 1, notes: "Bílá hniloba rozkládá lignin a hemicelulózy jako první nebo celulózu, hemicelulózy a lignin ve stejném rozsahu; měkká hniloba rozkládá celulózu buněčných stěn; hnědá hniloba nejdříve celulózu." },
      { id: "C-G-06", text: "Můžete vyjmenovat dva druhy hub, které mohou vytvářet tento typ hniloby?", max: 1, notes: "0.5 bodu za každý odpovídající druh houby, celkem 1 bod." },
      { id: "C-G-07", text: "Můžete popsat vztah mezi těmito houbami a hostitelským senescentním stromem?", max: 4, notes: "Dva příklady, až 2 body za každý: místo růstu plodnice, rozsah a dopad na stabilitu, reakce/adaptace stromu, ekologická hodnota." },
      { id: "C-G-08", text: "Vyberte skupinu doprovodných organizmů a popište druh/skupinu, habitat, životní cyklus, průzkum/ID a vliv na plán péče.", max: 6, notes: "1 bod za správný druh, 1 bod za habitat, 1 bod za životní cyklus, 1 bod za průzkum/ID, 2 body za vhodnou úpravu nebo přizpůsobení pěstebních opatření." },
      { id: "C-G-09", text: "Můžete uvést 6 příkladů pro zlepšení či udržení hodnoty habitatu na tomto stanovišti?", max: 6, notes: "Max. 6 bodů. Příklady: pokračovat v péči, nové stromy s podobnou funkcí, zachovat potenciální senescentní stromy, výsadby/regenerace, nektarodárné rostliny, keře, mrtvé dřevo, habitatové hromady, stojící mrtvé stromy, kontinuita habitatů, zastíněná borka, pastva, zmírnění zhutnění, veteranizace s navazující otázkou." },
      { id: "C-G-10", text: "Co vám může napovědět vegetace v blízkosti báze kmene senescentních stromů a jaký může mít vliv?", max: 2, notes: "Obohacení živinami; možné zvýšení růstu v krátkém období; potenciální dopad na symbiózu, absorpci a dostupnost vody a živin v dlouhodobém horizontu." },
    ],

    history: [
      { id: "C-HI-01", text: "Prosím prezentujte informace o historii tohoto stromu.", max: 10, notes: "Forma/tvar stromu, známky předchozích zásahů/managementu, různé typy nebo fáze péče, přerušená/pokračující péče, známky poškození, změny prostředí, změny stromu v čase, tree body language. Zkoušející může použít vlastní uvážení." },
      { id: "C-HI-02", text: "Prosím prezentujte informace o historii krajiny, ve které se nacházíme.", max: 10, notes: "Věk/stáří krajiny, věk/stáří stromů, věková struktura stromové populace, druhová diverzita, formy/tvary stromů, chybějící úseky v managementu, integrita historické krajiny, vrstvy historie, fragmentace." },
    ],

    risk: [
      { id: "C-RI-01", text: "Můžete identifikovat 1 biomechanický prvek na tomto stromě, který může zvýšit riziko selhání, a tři klíčové aspekty pro vyhodnocení provozní bezpečnosti?", max: 2, notes: "0.5 bodu za správný biomechanický prvek a 0.5 bodu za každý klíčový aspekt: typ selhání, pravděpodobnost selhání v časové škále, závažnost, cíl pádu, kompenzační růst." },
      { id: "C-RI-02", text: "Jaké jsou výhody a nevýhody ponechání takového prvku na stromě?", max: 1, notes: "Kandidát prokáže znalost rovnováhy mezi rizikem a benefitem, například estetickou nebo ekologickou hodnotou." },
      { id: "C-RI-03", text: "Co je to cíl pádu z pohledu provozní bezpečnosti a jak toto může ovlivnit risk management?", max: 1, notes: "Cíl pádu je předmět poranění či poškození v mezích potenciálního ohrožení. Pokud je cíl pádu rozdílný, riziko se mění; bez cíle není riziko." },
      { id: "C-RI-04", text: "Vysvětlete, jak byste vyhodnotil frekvenci pohybu či hodnotu majetku.", max: 1, notes: "Stálý cíl, vysoký pohyb osob, měnící se cíl, sezónní cíl, bez cíle pádu, metody jako QTRA, TRAQ, VALID, THREATS." },
      { id: "C-RI-05", text: "Můžete uvést 3 návrhy opatření/ošetření zaměřená na zajištění provozní bezpečnosti stanoviště?", max: 3, notes: "Ideální odpověď: přesunout cíl pádu, nedělat nic, zvážit zásah na stromě. 1 bod za každou vhodnou možnost. Pokud kandidát navrhne pokácení jako jednu z možností, max. 2 body. Pokud chybí možnost „posunout cíl pádu“, za celou otázku 0 bodů." },
      { id: "C-RI-06", text: "Pro preferovanou variantu poskytněte 2 výhody a 2 nevýhody.", max: 2, notes: "0.5 bodu za každou vhodnou možnost, max. 2 body. Pokud je preferovanou možností pokácení stromu, 0 bodů za celou otázku." },
      { id: "C-RI-07", text: "Jak odpovíte laikovi, který je znepokojen bezpečností „umírajícího stromu“ a doporučuje pokácení?", max: 2, notes: "Max. 2 body: strom neumírá, rozlišení rizika a skutečného ohrožení, hodnota stromu, proč je strom ponechaný/udržovaný na místě." },
    ],
  },
};

function parseCsvRows(text) {
  const rows = [];
  let current = [];
  let cell = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    const code = char.charCodeAt(0);
    const nextCode = next ? next.charCodeAt(0) : 0;

    if (char === '"' && insideQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      current.push(cell.trim());
      cell = "";
    } else if ((code === 10 || code === 13) && !insideQuotes) {
      if (code === 13 && nextCode === 10) i += 1;
      current.push(cell.trim());
      if (current.some(Boolean)) rows.push(current);
      current = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  current.push(cell.trim());
  if (current.some(Boolean)) rows.push(current);
  return rows;
}

function normalizeQuestion(raw, variantCode, context) {
  const questionId = String(raw.questionId ?? raw.id ?? "").trim();
  const type = String(raw.type ?? "").trim();
  const text = String(raw.text ?? "").trim();
  const points = Number(raw.points);
  const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option).trim()).filter(Boolean) : [];

  if (!variantCode) throw new Error(`${context}: missing variantCode.`);
  if (!questionId) throw new Error(`${context}: missing questionId.`);
  if (!type) throw new Error(`${context}: missing type.`);
  if (!text) throw new Error(`${context}: missing question text.`);
  if (!Number.isFinite(points)) throw new Error(`${context}: points must be numeric.`);
  if (type === "single_choice" && options.length === 0) throw new Error(`${context}: single_choice questions need options.`);

  return {
    id: questionId,
    questionId,
    type,
    points,
    text,
    options,
    correctAnswer: raw.correctAnswer ?? raw.correct_answer ?? "",
  };
}

function normalizeVariant(raw, context) {
  const code = String(raw.code ?? raw.variantCode ?? "").trim();
  const level = String(raw.level ?? "").trim();
  const language = String(raw.language ?? "").trim();

  if (!code) throw new Error(`${context}: missing variant code.`);
  if (!level) throw new Error(`${context}: missing level.`);
  if (!language) throw new Error(`${context}: missing language.`);

  return {
    code,
    level,
    language,
    title: raw.title || code,
    status: raw.status || "Approved",
  };
}

function computeWrittenTestReview(candidate, variants, testBank, testResponses) {
  const variantCode = variants?.[candidate?.level] ?? "";
  const questions = testBank?.[variantCode] ?? [];
  const responses = testResponses?.[candidate?.id] ?? {};
  const items = questions.map((question) => {
    const answer = responses[question.id] ?? "";
    const hasAnswer = String(answer).trim() !== "";
    const hasCorrectAnswer = String(question.correctAnswer ?? "").trim() !== "";
    const correct = hasAnswer && hasCorrectAnswer && String(answer).trim() === String(question.correctAnswer).trim();

    return {
      question,
      answer,
      hasAnswer,
      hasCorrectAnswer,
      correct,
      pointsAwarded: correct ? Number(question.points) || 0 : 0,
    };
  });

  return {
    variantCode,
    items,
    autoGradableItems: items.filter((item) => item.hasCorrectAnswer),
    unansweredCount: items.filter((item) => !item.hasAnswer).length,
    correctCount: items.filter((item) => item.correct).length,
    computedScore: items.reduce((sum, item) => sum + item.pointsAwarded, 0),
    computedMax: items.reduce((sum, item) => sum + (item.hasCorrectAnswer ? Number(item.question.points) || 0 : 0), 0),
    totalMax: items.reduce((sum, item) => sum + (Number(item.question.points) || 0), 0),
  };
}

function parseTestPackageJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.variants)) throw new Error("JSON must contain a variants array.");
  if (!parsed.questions || typeof parsed.questions !== "object" || Array.isArray(parsed.questions)) throw new Error("JSON must contain a questions object.");

  const variants = parsed.variants.map((variant, index) => normalizeVariant(variant, `Variant ${index + 1}`));
  const questions = {};

  variants.forEach((variant) => {
    const rows = parsed.questions[variant.code];
    if (!Array.isArray(rows)) throw new Error(`${variant.code}: questions must be an array.`);
    questions[variant.code] = rows.map((question, index) => normalizeQuestion(question, variant.code, `${variant.code} question ${index + 1}`));
  });

  return { variants, questions };
}

function parseTestPackageCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one question row.");

  const header = rows.shift().map((item) => item.trim());
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = ["variantCode", "level", "language", "questionId", "type", "points", "text"];
  required.forEach((column) => {
    if (!(column in index)) throw new Error(`Missing CSV column: ${column}`);
  });

  const variantMap = new Map();
  const questions = {};

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const variantCode = String(row[index.variantCode] || "").trim();
    const variant = normalizeVariant({
      code: variantCode,
      level: row[index.level],
      language: row[index.language],
      title: variantCode,
    }, `CSV row ${rowNumber}`);
    variantMap.set(variant.code, variant);

    const options = ["optionA", "optionB", "optionC", "optionD"].map((column) => (column in index ? row[index[column]] : "")).filter(Boolean);
    const question = normalizeQuestion({
      questionId: row[index.questionId],
      type: row[index.type],
      points: row[index.points],
      text: row[index.text],
      options,
      correctAnswer: "correctAnswer" in index ? row[index.correctAnswer] : "",
    }, variant.code, `CSV row ${rowNumber}`);

    questions[variant.code] = [...(questions[variant.code] || []), question];
  });

  return { variants: Array.from(variantMap.values()), questions };
}

function parseTestPackage(text, fileName = "", mimeType = "") {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The import file is empty.");

  const lowerName = fileName.toLowerCase();
  const isJson = lowerName.endsWith(".json") || mimeType.includes("json") || trimmed.startsWith("{");
  const imported = isJson ? parseTestPackageJson(trimmed) : parseTestPackageCsv(trimmed);
  const questionCount = Object.values(imported.questions).reduce((total, rows) => total + rows.length, 0);

  if (imported.variants.length === 0) throw new Error("The import file does not contain any variants.");
  if (questionCount === 0) throw new Error("The import file does not contain any questions.");

  return { ...imported, questionCount };
}

// Maps a readVetPackage() failure to a localized, actionable message. The technical detail is
// kept so a genuinely malformed file stays debuggable. The most common cause is an unreadable
// file (a OneDrive/iCloud "online-only" copy handed to the browser empty), not a bad package.
function vetReadErrorMessage(error, t) {
  const byCode = {
    empty: t("vet.readError.empty"),
    unreadable: t("vet.readError.unreadable"),
    badzip: t("vet.readError.badzip"),
    badjson: t("vet.readError.badjson"),
    nopackage: t("vet.readError.nopackage"),
  };
  const base = error?.code && byCode[error.code];
  if (base) return error?.message ? `${base} (${error.message})` : base;
  return error?.message || t("vet.readError.generic");
}

// Written question text imported from PDFs mixes two kinds of line breaks: genuine structure
// (bulleted sub-items, numbered/lettered lists, a list intro ending in a colon, blank-line
// paragraph breaks) and accidental ones (the source PDF wrapped a sentence across lines). This
// keeps the genuine breaks and rejoins the accidental mid-sentence wraps, so questions read as
// clean paragraphs while real lists still stack. Shared by the candidate test and the examiner
// review so both show the same thing. Pair with `whitespace-pre-wrap` in the markup.
function cleanQuestionText(text) {
  const raw = String(text ?? "");
  if (!raw.includes("\n")) return raw.trim();
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  // A line that begins a list item: •/‣/◦/▪/·, or "- "/"* " (dash/star + space), or an
  // enumerator like "1." "2)" "a)" "(i)" — i.e. a real, intentional new line.
  const listStart = /^(?:[•‣◦▪·]|[-–*]\s|\(?[0-9]{1,3}[.)]\s|\(?[a-z][.)]\s|\(?[ivxlcdm]{1,4}[.)]\s)/i;
  // A previous line that legitimately ends a line: sentence punctuation or a list-intro colon.
  const keepBreakAfter = /[.!?:;]$/;
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0) { out.push(line); continue; }
    const prev = out.length ? out[out.length - 1] : "";
    if (line === "" || prev === "" || listStart.test(line) || keepBreakAfter.test(prev)) {
      out.push(line);
    } else {
      // Accidental mid-sentence wrap → rejoin with the previous line.
      out[out.length - 1] = `${prev} ${line}`.replace(/\s{2,}/g, " ").trim();
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nowStamp() { return new Date().toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
// Session-integrity sync events → the exact audit actions the supervision console keys off
// (AuditSyncView's ALERT_ACTIONS and its live "away" state), so an alert raised on a candidate's
// tablet reads identically in the Centre's own trail.
const INTEGRITY_EVENT_ACTIONS = {
  "session.fullscreen_exited": "Exited fullscreen",
  "session.fullscreen_entered": "Entered fullscreen",
  "session.app_backgrounded": "Switched away from app",
  "session.app_foregrounded": "Returned to app",
};
export function tomorrowIsoDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function createReportDraft() { return REPORT_TREES.reduce((acc, tree) => ({ ...acc, [tree]: { fieldNotes: "", photos: [], finalSections: REPORT_SECTIONS.reduce((s, sec) => ({ ...s, [sec.key]: "" }), {}) } }), {}); }
function createSectionStatus(level) { return CANDIDATE_SECTIONS[level].reduce((acc, sec) => ({ ...acc, [sec.key]: "locked" }), {}); }
function scoreLimits(level) { return level === "Consulting" ? { writtenMax: 97, outdoorMax: 58, reportMax: 117 } : { writtenMax: 46, outdoorMax: 102, reportMax: 0 }; }
// Pass mark for the outdoor part — the candidate passes at ≥ 70 % of the outdoor maximum
// (confirmed by the certification lead, 2026-07-29). Drives the PASSED/NOT PASSED indicator
// next to the examiner's Exam summary; the formal decision still happens in the Centre.
const OUTDOOR_PASS_RATE = 0.7;
function sumQuestionBankMax(questions) { return Array.isArray(questions) ? questions.reduce((sum, question) => sum + writtenQuestionMax(question), 0) : 0; }
// Either/or exercises (two sections sharing a base name, e.g. "…Threats exercise (halo)" vs
// "(soil)") count only ONCE toward the outdoor maximum — the candidate does a single variant.
function sumOutdoorItemsMax(itemsBySection) {
  const sections = Object.keys(itemsBySection ?? {});
  return sections
    .filter((section) => !outdoorSectionExcluded(sections, undefined, section))
    .reduce((sum, section) => sum + (itemsBySection[section] ?? []).reduce((s, item) => s + Number(item?.max ?? 0), 0), 0);
}
function scoreLimitsForCandidate(candidate, variants, testBank, outdoorItemsByLevel) {
  const fallback = scoreLimits(candidate?.level);
  const variantCode = variants?.[candidate?.level];
  const writtenMax = sumQuestionBankMax(testBank?.[variantCode]) || fallback.writtenMax;
  const outdoorMax = sumOutdoorItemsMax(effectiveOutdoorItemsForLevel(outdoorItemsByLevel, candidate?.level)) || fallback.outdoorMax;
  return { ...fallback, writtenMax, outdoorMax };
}
function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function storedAnswerValue(row) { const answer = row?.answer; return isObject(answer) ? answer.selectedAnswer ?? answer.answer ?? answer.value ?? "" : answer ?? ""; }
function dataUrlToBlob(dataUrl) {
  const [header = "", data = ""] = String(dataUrl).split(",");
  const mime = (/data:([^;]+)/.exec(header) || [])[1] || "application/octet-stream";
  const binary = header.includes("base64") ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
// Photos rehydrated from a signed storage URL are converted to a base64 data: URI (rather than
// kept as the remote URL) so every existing consumer of photo.dataUrl - annotation canvas,
// crop, PDF/ZIP export - keeps working unmodified. A raw cross-origin URL would also taint the
// HandwritingPad canvas (canvas.toDataURL throws SecurityError on a tainted canvas).
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function isBackendPersistenceUnavailable(error) {
  const message = String(error?.message ?? error ?? "");
  return error?.status === 503 || /503/.test(message) || /Backend persistence is not configured/i.test(message);
}

function approxDataUrlBytes(dataUrl) {
  const comma = String(dataUrl).indexOf(",");
  const b64 = comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl);
  return Math.ceil((b64.length * 3) / 4);
}

// Downscale + recompress any captured image (a File or a data URL) so it stays well under ~1 MB
// before it is stored/uploaded — modern phone/tablet cameras produce 3–8 MB JPEGs that bloat the
// draft, the sync payload and Supabase Storage. Long edge is capped and JPEG quality is stepped
// down until the byte budget is met. Used by every photo capture path (report, field tablet,
// examiner archive, handwriting export).
async function compressImageToDataUrl(source, { maxBytes = 1_000_000, maxDim = 2000 } = {}) {
  const sourceDataUrl = typeof source === "string"
    ? source
    : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(source);
      });
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = sourceDataUrl;
    });
  } catch {
    return sourceDataUrl; // not a decodable image (or HEIC without support) — keep original
  }
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) return sourceDataUrl;
  const draw = (scale) => {
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  };
  let scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  let canvas = draw(scale);
  let quality = 0.85;
  let out = canvas.toDataURL("image/jpeg", quality);
  // First lower quality, then shrink dimensions, until under budget (bounded loop).
  for (let i = 0; i < 6 && approxDataUrlBytes(out) > maxBytes; i += 1) {
    if (quality > 0.45) {
      quality -= 0.12;
    } else {
      scale *= 0.75;
      canvas = draw(scale);
      quality = 0.7;
    }
    out = canvas.toDataURL("image/jpeg", quality);
  }
  // Only use the recompressed version if it is actually smaller than the source.
  return approxDataUrlBytes(out) < approxDataUrlBytes(sourceDataUrl) ? out : sourceDataUrl;
}

// Synchronously renders a QR code to a standalone <svg>...</svg> markup string, for embedding
// into print windows built via document.write (a separate document, so React components/props
// can't be handed to it directly — only raw HTML/markup).
function renderQrSvgMarkup(value, size = 160, { includeMargin = false, level = "M" } = {}) {
  const safeValue = String(value ?? "");
  if (!safeValue) return "";
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => {
    root.render(<QRCodeSVG value={safeValue} size={size} level={level} includeMargin={includeMargin} />);
  });
  const markup = container.querySelector("svg")?.outerHTML || "";
  root.unmount();
  return markup;
}

export function RealQr({ value, size = 112 }) {
  const safeValue = String(value ?? "");

  return (
    <div
      className="shrink-0 rounded-xl bg-white p-2 shadow-inner"
      style={{ width: size, height: size }}
      title={safeValue}
    >
      {safeValue ? (
        <QRCodeSVG
          value={safeValue}
          size={Math.max(size - 16, 64)}
          level="M"
          includeMargin={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-lg border text-xs text-slate-400">
          QR není dostupný
        </div>
      )}
    </div>
  );
}

function parseQrPayload(payload) { try { const url = new URL(payload); return { role: url.searchParams.get("role"), id: url.searchParams.get("id"), token: url.searchParams.get("token"), name: url.searchParams.get("name"), level: url.searchParams.get("level"),  }; } catch { const [role, id, token] = String(payload).split("|"); return { role, id, token }; } }
function parseOfflineCandidatePackage(payload) {
  try {
    const data = JSON.parse(String(payload));
    if (
      (data?.kind === "vetbara.offlineCandidatePackage.v1" || data?.kind === "vetbara.offlineTestResponses.v1") &&
      data.candidateId
    ) return data;
  } catch {
    return null;
  }

  return null;
}

function QrScannerPanel({ title, onScan, onClose, t }) {
  const [manualPayload, setManualPayload] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const scannedRef = useRef(false);

  // Live camera QR scanning (HTTPS secure context is verified in production, so getUserMedia is
  // available). Falls back to manual paste only if the camera can't be opened.
  useEffect(() => {
    let stream = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement("canvas");

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setCameraError(t("qrScanner.cameraUnavailable")); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setScanning(true);
        const tick = () => {
          if (cancelled || scannedRef.current) return;
          const v = videoRef.current;
          if (v && v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
            try {
              const data = decodeAllQrCodes(canvas, 1)?.[0]?.data;
              if (data) { scannedRef.current = true; onScan(String(data)); return; }
            } catch { /* keep scanning */ }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCameraError(t("qrScanner.cameraError"));
      }
    }
    start();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManualPayload() {
    const value = manualPayload.trim();
    if (!value) {
      window.alert(t("qrScanner.enterPayloadAlert"));
      return;
    }
    onScan(value);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-slate-600">{t("qrScanner.helper")}</p>
          </div>
          <Button onClick={onClose} variant="outline" className="rounded-2xl">
            <X className="mr-1 h-4 w-4" />{t("common.close")}
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-slate-950">
          <video ref={videoRef} playsInline muted className="h-72 w-full bg-black object-cover" />
        </div>
        {cameraError
          ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{cameraError}</div>
          : <p className="mt-2 text-center text-xs text-slate-500">{scanning ? t("qrScanner.scanning") : t("qrScanner.starting")}</p>}

        <details className="mt-4 rounded-2xl border bg-white p-4" open={Boolean(cameraError)}>
          <summary className="cursor-pointer font-semibold">{t("qrScanner.manualPayloadTitle")}</summary>
          <p className="mt-1 text-sm text-slate-600">{t("qrScanner.manualPayloadHelper")}</p>
          <textarea
            value={manualPayload}
            onChange={(e) => setManualPayload(e.target.value)}
            placeholder={t("qrScanner.manualPayloadPlaceholder")}
            className="mt-3 min-h-32 w-full rounded-xl border bg-white p-3 text-sm font-mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={submitManualPayload} className="rounded-2xl">{t("qrScanner.loadPayload")}</Button>
            <Button onClick={() => setManualPayload("")} variant="outline" className="rounded-2xl">{t("qrScanner.clearPayload")}</Button>
          </div>
        </details>
      </div>
    </div>
  );
}

function ReopenSectionModal({ sectionKey, error, onConfirm, onCancel, t }) {
  const [password, setPassword] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">{t("reopenModal.title")}</h3>
        <p className="mt-2 text-sm text-slate-600">
          {t("reopenModal.bodyBefore")} <strong>{sectionKey}</strong> {t("reopenModal.bodyAfter")}
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(password); }}
          placeholder={t("reopenModal.passwordPlaceholder")}
          className="mt-3 w-full rounded-xl border bg-white p-2 font-mono text-sm"
        />
        {error && <p className="mt-2 flex items-center gap-2 rounded-xl bg-rose-50 p-2 text-sm font-medium text-rose-900"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => onConfirm(password)} className="rounded-2xl">{t("reopenModal.confirm")}</Button>
          <Button onClick={onCancel} variant="outline" className="rounded-2xl">{t("reopenModal.cancel")}</Button>
        </div>
      </div>
    </div>
  );
}


function VetBaraPrototype() {
  const [runtimeError] = useState(null);
  const fieldTabletMode = (() => {
    try {
      const query = new URLSearchParams(window.location.search);
      return query.get("mode") === "field-tablet" || query.get("role") === "FieldTablet";
    } catch {
      return false;
    }
  })();

  if (fieldTabletMode) return <FieldTabletPage />;

  const scanCaptureMode = (() => {
    try {
      const query = new URLSearchParams(window.location.search);
      return query.get("mode") === "scan-capture" || query.get("role") === "ScanCapture";
    } catch {
      return false;
    }
  })();

  if (scanCaptureMode) return <ScanCaptureMobilePage />;

  const consultingFieldMode = (() => {
    try {
      const query = new URLSearchParams(window.location.search);
      return query.get("mode") === "consulting-field" || query.get("role") === "ConsultingField";
    } catch {
      return false;
    }
  })();

  if (consultingFieldMode) return <ConsultingFieldMobilePage />;

  const [uiLanguage, setUiLanguage] = useState("cs");
  const selectedUiLanguage = UI_LANGUAGES.find((lang) => lang.code === uiLanguage);
  const draftPreviewActive = Boolean(selectedUiLanguage?.draft);
  const t = makeTranslator(uiLanguage);
  const tf = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      t(key)
    );
  const roleLabel = (value) => ({ Admin: "Admin", Centre: t("role.centre"), Candidate: t("role.candidate"), Examiner: t("role.examiner") }[value] ?? value);
  const [portalRole] = useState(() => {
    const requestedRole = new URLSearchParams(window.location.search).get("role");
    return ROLES.includes(requestedRole) ? requestedRole : null;
  });
  // The requested role from the URL only picks which shell renders first; it grants no access
  // by itself. Centre unlock / Examiner login / Candidate login only happen once the server has
  // verified the token (see the openQrSession effect below), never from the URL alone.
  const [role, setRole] = useState(() => portalRole ?? "Admin");
  // Draft/machine-translated languages are for translator/Centre review, not for a live exam:
  // a Candidate must not be able to sit the exam in a language whose text hasn't been through
  // the human review workflow in docs/i18n/translation-review-workflow.md. Admin/Centre/Examiner
  // keep full access so they can review and test draft content before it gets promoted.
  const uiLanguageChoices = role === "Candidate" ? UI_LANGUAGES.filter((lang) => !lang.draft) : UI_LANGUAGES;
  useEffect(() => {
    if (role !== "Candidate") return;
    if (!UI_LANGUAGES.find((lang) => lang.code === uiLanguage)?.draft) return;
    setUiLanguage("en");
  }, [role, uiLanguage]);
  const [centre, setCentre] = useState(CENTRES[0]);
  const [examDate, setExamDate] = useState(tomorrowIsoDate);
  const [place, setPlace] = useState("Buchlovice");
  const [language, setLanguage] = useState("EN");
  const [enabledLevels, setEnabledLevels] = useState(["Practicing", "Consulting"]);
  const [availableVariants, setAvailableVariants] = useState(TEST_VARIANTS);
  const [testBank, setTestBank] = useState(DEFAULT_TEST_BANK);
  const [activeCertificationPackage, setActiveCertificationPackage] = useState(null);
  const [activeCertificationPackageStatus, setActiveCertificationPackageStatus] = useState("");
  const [activeCertificationPackageError, setActiveCertificationPackageError] = useState("");
  const [testImportStatus, setTestImportStatus] = useState("");
  const [testImportError, setTestImportError] = useState("");
  const [testImportSummary, setTestImportSummary] = useState(null);
  const [adminPdfPackageStatus, setAdminPdfPackageStatus] = useState("");
  const [adminPdfPackageError, setAdminPdfPackageError] = useState("");
  const [adminPdfPackageLatest, setAdminPdfPackageLatest] = useState(null);
  const [variants, setVariants] = useState({ Practicing: "PRACTICING_2026_V1_CZ", Consulting: "CONSULTING_2026_V1_EN" });
  const [status, setStatus] = useState("Draft by Admin");
  const [centreUnlocked, setCentreUnlocked] = useState(false);
  const [centreCode, setCentreCode] = useState("");
  // The certification's own id (Centre session subject). Field preparation is stored per exam id,
  // and this used to fall back to the shared CENTRE_QR_ID constant for every certification opened
  // by link — so two certifications silently shared one site setup, its trees and their photos.
  const [centreExamId, setCentreExamId] = useState("");
  // A rejected QR/link used to fail silently: the audit trail recorded it, but the person holding
  // the link just saw the empty "no examiner logged in" portal with no hint that their LINK was
  // the problem (e.g. a hand-made link guessed from another examiner's pattern). Surface it.
  const [accessError, setAccessError] = useState("");
  const [candidates, setCandidates] = useState(START_CANDIDATES);
  const [examiners, setExaminers] = useState(EXAMINERS);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [loggedCandidateId, setLoggedCandidateId] = useState(null);
  const [candidateConfirmed, setCandidateConfirmed] = useState({});
  const [candidateStatus, setCandidateStatus] = useState({});
  const [candidateTimes, setCandidateTimes] = useState({});
  const [activeCandidateSection, setActiveCandidateSection] = useState("landing");
  const [testResponses, setTestResponses] = useState({});
  const [importedCandidatePackages, setImportedCandidatePackages] = useState({});
  const [reportDrafts, setReportDrafts] = useState({});
  // candidatePreparations[candidateId][treeKey] = { note, sketch } — what the candidate wrote and
  // drew for each tree before the outdoor exam, pulled back from the server for the Centre.
  const [candidatePreparations, setCandidatePreparations] = useState({});
  // outdoorByExaminer[candidateId][examinerId] = { mode, scores, notes, noteDrawings, examSummary,
  // submittedAt }. The flat `outdoor` state merges every examiner together, which is fine for a
  // total but loses who scored what — section E needs the primary and secondary side by side.
  const [outdoorByExaminer, setOutdoorByExaminer] = useState({});
  // Section E corrections to a CLOSED written test / Consulting report, keyed the same way as
  // outdoorByExaminer: writtenScoresByExaminer[candidateId][examinerId] = { scores: {questionId:
  // points} }; reportMarksByExaminer[candidateId][examinerId] = { marks: <same shape as
  // readReportMarks/writeReportMarks> }. Hydrated from the examiner_score.saved events the
  // correction sends (see applyWrittenCorrection/applyReportCorrection), and from whatever the
  // examiner's own device already submitted (hydrateCentreResults).
  const [writtenScoresByExaminer, setWrittenScoresByExaminer] = useState({});
  const [reportMarksByExaminer, setReportMarksByExaminer] = useState({});
  const [activeReportTree, setActiveReportTree] = useState("Tree A");
  // Examiner login id is set only after the openQrSession effect verifies the token with the
  // server (via resolveAccessWithFallback -> applyResolvedAccess -> loginExaminer). It used to
  // also be set directly from the URL here, checking only that the token started with the
  // string "VETBARA-EXAMINER" — that accepted any suffix and never asked the server.
  const [loggedExaminerId, setLoggedExaminerId] = useState(null);

  const [examinerConfirmed, setExaminerConfirmed] = useState({});
  const [activeExaminerPage, setActiveExaminerPage] = useState("landing");
  const [assignments, setAssignments] = useState(START_ASSIGNMENTS);
  const [outdoor, setOutdoor] = useState({});
  const [outdoorNotes, setOutdoorNotes] = useState({});
  const [outdoorNoteDrawings, setOutdoorNoteDrawings] = useState({});
  // Which variant the examiner picked for each either/or outdoor exercise, per candidate:
  // { [candidateId]: { [sectionBase]: chosenSectionName } }. Only the chosen variant is scored.
  const [outdoorVariantChoice, setOutdoorVariantChoice] = useState({});
  // Primary examiner's closing "Exam summary" (candidate strengths & weaknesses), per candidate.
  // Travels to the Centre in the outdoor_assessment.submitted payload and into the grading PDF.
  const [outdoorExamSummaries, setOutdoorExamSummaries] = useState({});
  const [outdoorItemsByLevel, setOutdoorItemsByLevel] = useState({});
  const [activeAdminPackageMeta, setActiveAdminPackageMeta] = useState(null);
  const [activeOutdoorSection, setActiveOutdoorSection] = useState("generic");
  const [examinerTimes, setExaminerTimes] = useState({});
  const [practicingArchive, setPracticingArchive] = useState({});
  const [audit, setAudit] = useState([{ id: "A-001", action: "Exam event opened", target: "Exam event", time: "09:00", detail: "Initial offline package prepared" }]);
  const [sync, setSync] = useState([{ id: "S-001", type: "Exam package", status: "Ready offline" }]);
  const [scannerMode, setScannerMode] = useState(null);
  // Set right before setScannerMode when "End exam" triggers a re-scan (see endExaminerSession /
  // endCandidateSession) so the scanner shows a re-entry title instead of the normal first-login
  // "Scan {role} QR" one — same panel, different wording for a genuinely different moment.
  const [scannerReentry, setScannerReentry] = useState(false);
  const [authenticatedPortalRole, setAuthenticatedPortalRole] = useState(null);
  // Device-bound QR PIN (see resolveAccessWithFallback/requestQrPin): qrPinChallenge holds the
  // in-flight promise resolver while a new device is being asked for the PIN; qrSetPinPrompt holds
  // the freshly-issued session token while the FIRST device on a token is being asked to choose one.
  const [qrPinChallenge, setQrPinChallenge] = useState(null);
  const [qrSetPinPrompt, setQrSetPinPrompt] = useState(null);
  const [activeSessionToken, setActiveSessionToken] = useState(null);
  const [reopenRequest, setReopenRequest] = useState(null);
  const [centreSetupLoading, setCentreSetupLoading] = useState(false);
  const [centreSetupSaving, setCentreSetupSaving] = useState(false);
  const [centreSetupError, setCentreSetupError] = useState("");
  const [centreSetupStatus, setCentreSetupStatus] = useState("");
  const [centreAuditExportLoading, setCentreAuditExportLoading] = useState(false);
  const [centreAuditExportError, setCentreAuditExportError] = useState("");
  const [centreQrAccess, setCentreQrAccess] = useState({ candidates: [], examiners: [] });
  const [centreValidationIssues, setCentreValidationIssues] = useState([]);
  const [centreSetupDirty, setCentreSetupDirty] = useState(false);
  // Exam-schedule ("harmonogram") settings, lifted here (rather than owned by CentreScheduleBuilder)
  // so they can travel through the same save/load-Centre-setup round trip as the rest of the roster
  // and be read back on a Candidate's own device to render its individual schedule widget.
  const [harmonogramSettings, setHarmonogramSettings] = useState(HARMONOGRAM_DEFAULT_SETTINGS);
  useEffect(() => {
    setHarmonogramSettings(readHarmonogramSettings());
  }, [centreExamId]);
  useEffect(() => {
    writeHarmonogramSettings(harmonogramSettings);
  }, [harmonogramSettings]);
  // Examiner outdoor voice recording. status: idle | recording | processing | saved | error
  const voiceRecorderRef = useRef(null);
  const mediaRetryBusyRef = useRef(false);
  const [voiceRecording, setVoiceRecording] = useState({ status: "idle", candidateId: null, startedAt: null, elapsedMs: 0, error: "", detail: "", lastSaved: null });
  const voiceRecordingSupported = useMemo(() => isRecordingSupported(), []);

  // Silent background safety net replacing the removed manual "Uložit Centre Setup" button:
  // periodically persists candidates/examiners/assignments once Centre is unlocked, so closing
  // the tab doesn't lose setup work. Errors are swallowed on purpose (best-effort, retried next tick).
  const centreAutosaveStateRef = useRef({ dirty: centreSetupDirty, save: null });
  useEffect(() => { centreAutosaveStateRef.current.dirty = centreSetupDirty; }, [centreSetupDirty]);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (centreAutosaveStateRef.current.dirty && activeSessionToken) {
        Promise.resolve(centreAutosaveStateRef.current.save?.()).catch(() => {});
      }
    }, 120000);
    return () => window.clearInterval(intervalId);
  }, [activeSessionToken]);

  const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId) ?? candidates[0];
  const loggedCandidate = candidates.find((c) => c.id === loggedCandidateId) ?? null;
  const loggedExaminer = examiners.find((e) => e.id === loggedExaminerId) ?? null;
  const assignedCandidates = loggedExaminer ? candidates.filter((c) => [assignments[c.id]?.primary, assignments[c.id]?.secondary].includes(loggedExaminer.id)) : [];
  const selectedMode = loggedExaminer && assignments[selectedCandidate.id]?.primary === loggedExaminer.id ? "primary" : loggedExaminer && assignments[selectedCandidate.id]?.secondary === loggedExaminer.id ? "secondary" : "unassigned";
  const activeScoreLimits = useMemo(() => scoreLimitsForCandidate(selectedCandidate, variants, testBank, outdoorItemsByLevel), [selectedCandidate, variants, testBank, outdoorItemsByLevel]);
  const summary = useMemo(() => ({ total: candidates.length, practicing: candidates.filter((c) => c.level === "Practicing").length, consulting: candidates.filter((c) => c.level === "Consulting").length }), [candidates]);
  // Persists alongside the local, instant-display state below: every call also fires an
  // "audit.logged" sync event (see AUDIT_EVENT_TYPE in api/sync/batch.js), so the trail survives a
  // page reload and reads the same from any Centre device - not just the tab that happened to
  // witness the action. candidateId is only set for a logged-in Candidate's own actions; Centre-
  // and Examiner-authored entries (corrections, identify, logins) are scoped by their own
  // subject_id/role on read instead (see api/centre/audit.js), so they need no candidate id here.
  const addAudit = (action, target, detail = "") => {
    const createdAt = new Date().toISOString();
    const id = `A-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAudit((prev) => [{ id, action, target, detail, time: nowStamp(), createdAt }, ...prev]);
    if (activeSessionToken) {
      const actorRole = loggedCandidate ? "Candidate" : loggedExaminer ? "Examiner" : "Centre";
      sendSyncEvent({
        clientEventId: localEventId(`audit-${id}`),
        type: "audit.logged",
        entityType: "audit_entry",
        entityId: id,
        candidateId: loggedCandidate?.id || null,
        // localId travels in the payload (not just as entityId) so a Centre reading its OWN
        // entries back from the server can recognise "I already have this one locally" and skip
        // it, instead of showing every one of its own actions twice once the poll catches up.
        payload: { action, target, detail, actorRole, time: nowStamp(), createdAt, localId: id },
        createdAt,
      });
    }
  };
  // Audit entries that happened on ANOTHER device (or this same Centre device, read back from its
  // own persisted addAudit() calls) and arrive later through the read model. They carry their own
  // timestamp, so they are merged into the (newest-first) list by time rather than prepended.
  // Deduped twice: mergedAuditIdsRef skips re-processing the same poll result across ticks, and the
  // setAudit updater also drops anything whose id already exists in the CURRENT list - the id an
  // entry arrives with is the ORIGINAL client-generated one (see addAudit's payload.localId /
  // api/centre/audit.js), so a Centre's own action - already shown instantly via its own addAudit
  // call - is recognised as the same entry once the poll echoes it back, instead of showing twice.
  const mergedAuditIdsRef = useRef(new Set());
  const mergeRemoteAudit = (entries) => {
    const fresh = (entries ?? []).filter((entry) => entry.id && !mergedAuditIdsRef.current.has(entry.id));
    if (!fresh.length) return;
    fresh.forEach((entry) => mergedAuditIdsRef.current.add(entry.id));
    setAudit((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const toAdd = fresh.filter((entry) => !existingIds.has(entry.id)).map((entry) => ({
        id: entry.id,
        action: entry.action,
        target: entry.target,
        detail: entry.detail ?? "",
        alert: entry.alert === true,
        time: entry.createdAt ? new Date(entry.createdAt).toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : nowStamp(),
        createdAt: entry.createdAt ?? new Date().toISOString(),
      }));
      if (!toAdd.length) return prev;
      return [...toAdd, ...prev].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    });
  };
  const queue = (type, detail = "") => setSync((prev) => [{ id: `S-${prev.length + 1}`, type, detail, status: "Pending sync" }, ...prev]);
  const payload = (roleName, id, token = `VETBARA-${roleName.toUpperCase()}-${id}-2026`) => {
    const url = new URL(window.location.pathname || "/", portableLanOrigin() || window.location.origin);
    url.searchParams.set("role", roleName);
    url.searchParams.set("id", id);
    url.searchParams.set("token", token);

    if (roleName === "Candidate") {
      const candidate = candidates.find((item) => item.id === id);
      if (candidate) {
        url.searchParams.set("name", candidate.name ?? "");
        url.searchParams.set("level", candidate.level ?? "");
      }
    }

    return url.toString();
  };
  const sectionTone = (v) => v === "closed" ? "good" : v === "open" ? "warn" : "default";
  const lockedPortalRole = portalRole ?? authenticatedPortalRole;
  const localEventId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const knownCandidate = (id) => candidates.some((candidate) => candidate.id === id);
  // Check the LIVE examiner roster, not the 3-entry demo constant — a fourth examiner added in
  // the Centre could never log in against the constant ("QR role blocked" after scanning).
  const knownExaminer = (id) => examiners.some((examiner) => examiner.id === id);

  // Session integrity monitoring: while a Candidate or Examiner is actively logged in, track
  // fullscreen exits and app/tab switching (both real signs someone left the exam interface).
  // Logged both to the local audit list and pushed server-side via sendSyncEvent, so the Centre
  // — a separate device on the real portable LAN deployment — can see it in its own audit trail.
  useEffect(() => {
    const activeSubject = loggedCandidate
      ? { kind: "candidate", id: loggedCandidate.id, name: loggedCandidate.name }
      : loggedExaminer
        ? { kind: "examiner", id: loggedExaminer.id, name: loggedExaminer.name }
        : null;
    if (!activeSubject) return undefined;

    // Best-effort: some browsers (notably iOS Safari) refuse fullscreen without a fresh user
    // gesture, or don't support it at all. Silent failure is fine — the listeners below still
    // catch fullscreen entered/exited via any other means (F11, browser chrome, etc.).
    try { document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.(); } catch { /* not fatal */ }

    function logSessionEvent(type, label) {
      const now = new Date().toISOString();
      addAudit(label, activeSubject.name, activeSubject.kind === "candidate" ? "Candidate" : "Examiner");
      sendSyncEvent({
        clientEventId: localEventId(`session-${type}-${activeSubject.id}`),
        type: `session.${type}`,
        entityType: "session",
        entityId: activeSubject.id,
        candidateId: activeSubject.kind === "candidate" ? activeSubject.id : undefined,
        payload: { subjectKind: activeSubject.kind, subjectId: activeSubject.id, subjectName: activeSubject.name, at: now },
        createdAt: now,
      });
    }
    function onFullscreenChange() {
      const inFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      logSessionEvent(inFullscreen ? "fullscreen_entered" : "fullscreen_exited", inFullscreen ? "Entered fullscreen" : "Exited fullscreen");
    }
    function onVisibilityChange() {
      logSessionEvent(document.hidden ? "app_backgrounded" : "app_foregrounded", document.hidden ? "Switched away from app" : "Returned to app");
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedCandidate?.id, loggedExaminer?.id]);

  // Connectivity + session-boundary logging for WHICHEVER role is active - Candidate, Examiner, or
  // Centre alike, unlike the fullscreen/backgrounding tracking above (exam-integrity signals that
  // only make sense for a candidate actually taking the exam). "Went offline"/"back online" and
  // "closed the workspace" apply to all three, and are exactly what a clean, auditable exam needs
  // to show: not just what someone did, but when they briefly lost connection or walked away.
  useEffect(() => {
    const activeSubject = loggedCandidate
      ? { name: loggedCandidate.name, role: "Candidate" }
      : loggedExaminer
        ? { name: loggedExaminer.name, role: "Examiner" }
        : role === "Centre"
          ? { name: centreExamId || "Centre", role: "Centre" }
          : null;
    if (!activeSubject) return undefined;

    function onOffline() { addAudit("Connection lost", activeSubject.name, activeSubject.role); }
    function onOnline() { addAudit("Connection restored", activeSubject.name, activeSubject.role); }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // beforeunload cannot await a normal fetch - the page is already tearing down - so this uses
    // sendBeacon, which the browser guarantees to deliver even as the tab closes. Best-effort: if
    // sendBeacon itself is unavailable, the workspace-closed moment is simply not logged, same as
    // today (never worse than before this effect existed).
    function onBeforeUnload() {
      if (!activeSessionToken || !navigator.sendBeacon) return;
      const now = new Date().toISOString();
      const label = activeSubject.role === "Centre" ? "Centre workspace closed" : `${activeSubject.role} workspace closed`;
      const event = {
        clientEventId: localEventId(`audit-close-${activeSubject.role}`),
        type: "audit.logged",
        entityType: "audit_entry",
        entityId: `close-${activeSubject.role}-${Date.now()}`,
        candidateId: activeSubject.role === "Candidate" ? loggedCandidate?.id : null,
        payload: { action: label, target: activeSubject.name, detail: "", actorRole: activeSubject.role, time: nowStamp(), createdAt: now },
        createdAt: now,
      };
      try {
        navigator.sendBeacon("/api/sync/batch", new Blob([JSON.stringify({ sessionToken: activeSessionToken, events: [event] })], { type: "application/json" }));
      } catch { /* best-effort */ }
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedCandidate?.id, loggedExaminer?.id, role, activeSessionToken]);

  // Centre runs on its own device, so the results overview (Section E) only ever saw work done
  // in THIS browser (local state + localStorage). Outdoor assessments an examiner submits on a
  // tablet, written answers a candidate saves on theirs, etc. live in the backend read-model and
  // never reach the Centre's Section E on their own. Poll the per-candidate evaluation package
  // and merge Outdoor / test / report results back into the state Section E reads, so every
  // device's submissions show up here. Best-effort + polled, like the audit poll above.
  const centreResultsRosterRef = useRef(candidates);
  centreResultsRosterRef.current = candidates;
  useEffect(() => {
    if (role !== "Centre" || !activeSessionToken) return undefined;
    let cancelled = false;
    async function hydrateCentreResults() {
      const roster = centreResultsRosterRef.current ?? [];
      for (const candidate of roster) {
        if (cancelled) return;
        try {
          const result = await fetchCandidateEvaluation(activeSessionToken, candidate.id);
          if (cancelled) return;
          if (result._scopeRecoveryDebug) {
            console.warn("Candidate evaluation exam-event scope mismatch", candidate.id, result._scopeRecoveryDebug);
          }
          // Each submitted Outdoor assessment (one per examiner/mode) → Centre results store,
          // which drives the "closed" total shown per examiner in the Outdoor column.
          (Array.isArray(result.outdoorAssessments) ? result.outdoorAssessments : [])
            .filter((row) => row.submitted_at || row.submittedAt || row.payload?.submittedAt)
            .forEach((row) => {
              const p = row.payload ?? {};
              writeOutdoorCentreResult({
                candidateId: candidate.id,
                candidateName: candidate.name,
                level: candidate.level,
                examinerId: row.examiner_id ?? row.examinerId ?? null,
                mode: row.mode ?? p.mode ?? "primary",
                role: row.mode ?? p.mode ?? "primary",
                total: p.total ?? null,
                value: p.total ?? null,
                max: p.max ?? null,
                scores: p.scores ?? {},
                notes: p.notes ?? {},
                noteDrawings: p.noteDrawings ?? {},
                examSummary: p.examSummary ?? "",
                submittedAt: row.submitted_at ?? row.submittedAt ?? p.submittedAt ?? null,
                closedAt: p.closedAtLabel ?? null,
                closed: true,
                field: "outdoor",
                updatedAt: row.updated_at ?? row.submitted_at ?? p.submittedAt ?? null,
              });
            });
          // Per-examiner split: scores/notes come from outdoor_scores rows (which carry examiner_id),
          // sketches and the closing summary from that examiner's submitted assessment payload.
          const assessmentRows = Array.isArray(result.outdoorAssessments) ? result.outdoorAssessments : [];
          const perExaminer = {};
          const examinerBucket = (examinerId) => {
            if (!perExaminer[examinerId]) perExaminer[examinerId] = { examinerId, mode: "", scores: {}, notes: {}, noteDrawings: {}, itemTimestamps: {}, examSummary: "", submittedAt: null };
            return perExaminer[examinerId];
          };
          (Array.isArray(result.outdoorScores) ? result.outdoorScores : []).forEach((row) => {
            const examinerId = row.examiner_id ?? row.examinerId;
            const itemId = row.item_id ?? row.itemId;
            if (!examinerId || !itemId) return;
            const bucket = examinerBucket(examinerId);
            const raw = row.score ?? row.payload?.score ?? "";
            if (raw !== "" && raw !== null && raw !== undefined) {
              const num = Number(raw);
              bucket.scores[itemId] = Number.isFinite(num) ? num : raw;
            }
            const note = row.note ?? row.payload?.note ?? row.payload?.comment ?? "";
            if (note) bucket.notes[itemId] = note;
            // Per-item sketch, synced immediately alongside score/note (see updateOutdoorNoteDrawing)
            // rather than only arriving in the bulk submit payload below.
            const drawing = row.payload?.noteDrawing;
            if (drawing) bucket.noteDrawings[itemId] = drawing;
            // When this item's score/note was actually saved - a rough proxy for when the
            // candidate was answering it, since scoring during an oral exam happens close to live
            // (see OutdoorAiNotePanel, which lines this up against the recording's own start time).
            const savedAt = row.client_updated_at || row.updated_at || row.payload?.updatedAt;
            if (savedAt) bucket.itemTimestamps[itemId] = savedAt;
            if (!bucket.mode) bucket.mode = row.payload?.mode || row.mode || "";
          });
          assessmentRows.forEach((row) => {
            const examinerId = row.examiner_id ?? row.examinerId;
            if (!examinerId) return;
            const bucket = examinerBucket(examinerId);
            const p = row.payload ?? {};
            bucket.mode = row.mode ?? p.mode ?? bucket.mode;
            if (p.noteDrawings && typeof p.noteDrawings === "object") bucket.noteDrawings = { ...bucket.noteDrawings, ...p.noteDrawings };
            if (p.notes && typeof p.notes === "object") bucket.notes = { ...p.notes, ...bucket.notes };
            if (p.examSummary) bucket.examSummary = p.examSummary;
            bucket.submittedAt = row.submitted_at ?? row.submittedAt ?? p.submittedAt ?? bucket.submittedAt;
          });
          if (Object.keys(perExaminer).length) {
            setOutdoorByExaminer((prev) => ({ ...prev, [candidate.id]: perExaminer }));
          }

          // Per-item Outdoor scores (also covers in-progress, pre-submit editing).
          const scoreRows = Array.isArray(result.outdoorScores) ? result.outdoorScores : [];
          if (scoreRows.length) {
            setOutdoor((prev) => ({
              ...prev,
              [candidate.id]: scoreRows.reduce((next, score) => {
                const itemId = score.item_id ?? score.itemId;
                const raw = score.score ?? score.payload?.score ?? "";
                if (!itemId || raw === "" || raw === null || raw === undefined) return next;
                const num = Number(raw);
                return { ...next, [itemId]: Number.isFinite(num) ? num : raw };
              }, { ...(prev[candidate.id] ?? {}) }),
            }));
          }
          // Written answers → the auto test-result column.
          const responseRows = Array.isArray(result.testResponses) ? result.testResponses : [];
          if (responseRows.length) {
            setTestResponses((prev) => ({
              ...prev,
              [candidate.id]: responseRows.reduce((next, row) => {
                const questionId = row.question_id ?? row.questionId;
                return questionId ? { ...next, [questionId]: storedAnswerValue(row) } : next;
              }, { ...(prev[candidate.id] ?? {}) }),
            }));
          }
          // What the candidate prepared per tree before going out (notes + sketch).
          const preparationRows = Array.isArray(result.preparations) ? result.preparations : [];
          if (preparationRows.length) {
            setCandidatePreparations((prev) => ({
              ...prev,
              [candidate.id]: preparationRows.reduce((next, row) => {
                const treeKey = row.tree_key ?? row.treeKey;
                if (!treeKey) return next;
                return { ...next, [treeKey]: { note: row.note ?? "", sketch: row.sketch ?? "" } };
              }, {}),
            }));
          }

          // Report draft → the Consulting report column.
          if (result.reportDraft && typeof result.reportDraft === "object") {
            setReportDrafts((prev) => ({
              ...prev,
              [candidate.id]: { ...createReportDraft(), ...result.reportDraft },
            }));
          }
          // Examiner-entered written/report scores (submitted on the examiner's own tablet) →
          // the examiner-results store that Section E / the results overview read.
          (Array.isArray(result.examinerScores) ? result.examinerScores : []).forEach((row) => {
            if (!row?.field) return;
            writeExaminerResultLocal({
              candidateId: candidate.id,
              candidateName: candidate.name,
              level: candidate.level,
              examinerId: row.examinerId ?? null,
              role: row.role ?? row.mode ?? null,
              mode: row.mode ?? row.role ?? null,
              field: row.field,
              value: row.value,
              max: row.max,
              closed: Boolean(row.closed),
              closedAt: row.closedAt ?? null,
              submittedAt: row.submittedAt ?? null,
              scores: row.scores ?? null,
              marks: row.marks ?? null,
              updatedAt: row.updatedAt ?? null,
            });
            // Same rows, split into the per-question / per-section stores Section E's correction
            // UI reads and edits (CentreReviewModal) — whatever the examiner's own device already
            // submitted, or an earlier correction made from the Centre on a different session.
            if (row.field === "written" && row.examinerId && row.scores && typeof row.scores === "object") {
              setWrittenScoresByExaminer((prev) => ({
                ...prev,
                [candidate.id]: { ...(prev[candidate.id] ?? {}), [row.examinerId]: { examinerId: row.examinerId, scores: row.scores, updatedAt: row.updatedAt ?? null } },
              }));
            }
            if (row.field === "report" && row.examinerId && row.marks && typeof row.marks === "object") {
              setReportMarksByExaminer((prev) => ({
                ...prev,
                [candidate.id]: { ...(prev[candidate.id] ?? {}), [row.examinerId]: { examinerId: row.examinerId, marks: row.marks, updatedAt: row.updatedAt ?? null } },
              }));
            }
          });
          // Fullscreen exits and app switching recorded on the candidate's own device → the
          // Centre's audit trail, which is where the supervision console reads them from.
          mergeRemoteAudit((Array.isArray(result.integrityEvents) ? result.integrityEvents : [])
            .filter((row) => INTEGRITY_EVENT_ACTIONS[row.type])
            .map((row) => ({
              id: row.id,
              action: INTEGRITY_EVENT_ACTIONS[row.type],
              target: row.subjectName || candidate.name || candidate.id,
              detail: row.subjectId || candidate.id,
              createdAt: row.at,
            })));
          // Candidate section status/times (opened/closed on the candidate's device) → the
          // Section E review status table, which reads candidateStatus/candidateTimes.
          const sectionRows = Array.isArray(result.sections) ? result.sections : [];
          if (sectionRows.length) {
            setCandidateStatus((prev) => ({
              ...prev,
              [candidate.id]: sectionRows.reduce((next, section) => {
                const sectionKey = section.section_key ?? section.sectionKey;
                return sectionKey ? { ...next, [sectionKey]: section.status || next[sectionKey] || "locked" } : next;
              }, { ...(prev[candidate.id] ?? createSectionStatus(candidate.level ?? "Practicing")) }),
            }));
            setCandidateTimes((prev) => ({
              ...prev,
              [candidate.id]: sectionRows.reduce((next, section) => {
                const sectionKey = section.section_key ?? section.sectionKey;
                if (!sectionKey) return next;
                const openedAt = section.opened_at ?? section.openedAt ?? next[sectionKey]?.openedAt ?? "";
                const closedAt = section.closed_at ?? section.closedAt ?? next[sectionKey]?.closedAt ?? "";
                return { ...next, [sectionKey]: { ...(next[sectionKey] ?? {}), openedAt, openedAtIso: openedAt, closedAt, closedAtIso: closedAt } };
              }, { ...(prev[candidate.id] ?? {}) }),
            }));
          }
        } catch (error) {
          // Best-effort; the next tick retries. Dev server / no backend just no-ops here. Logged
          // (not swallowed silently) so a candidate whose evaluation read model keeps failing -
          // e.g. their report text never appearing in the Section E review form - is visible in
          // the console instead of just quietly never populating reportDrafts for that one person.
          console.warn("Centre results hydrate failed for candidate", candidate.id, error);
        }
      }
    }
    hydrateCentreResults();
    const intervalId = window.setInterval(hydrateCentreResults, 12000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeSessionToken]);

  // Pulls in the persisted audit trail (every device's addAudit() calls, see api/centre/audit.js)
  // so the Centre's own view isn't limited to what happened in this one browser tab since its last
  // reload - a Candidate's or Examiner's own device entries (logins, section opens, identify)
  // arrive here the same way outdoor scores/report drafts do above.
  useEffect(() => {
    if (role !== "Centre" || !activeSessionToken) return undefined;
    let cancelled = false;
    async function hydrateCentreAudit() {
      try {
        const result = await fetchCentreAudit(activeSessionToken);
        if (cancelled) return;
        mergeRemoteAudit(Array.isArray(result?.entries) ? result.entries : []);
      } catch {
        // Best-effort; the next tick retries.
      }
    }
    hydrateCentreAudit();
    const intervalId = window.setInterval(hydrateCentreAudit, 15000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeSessionToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveAdminOutdoorAtStartup() {
      try {
        const response = await fetch("/api/centre/test-package/active", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) return;

        const normalized = normalizeAdminOutdoorPackage(data);
        if (!hasRuntimeOutdoorLevel(normalized?.Practicing) && !hasRuntimeOutdoorLevel(normalized?.Consulting)) return;

        if (!cancelled) {
          setOutdoorItemsByLevel(normalized);
          setActiveAdminPackageMeta(activePackageRuntimeMeta(data));
        }
      } catch {
        // Keep the demo fallback available when no local Admin package endpoint is running.
      }
    }

    loadActiveAdminOutdoorAtStartup();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function openQrSession() {
      const parsed = parseQrPayload(window.location.href);
      if (parsed.role === "Admin") return;
      if (!parsed.role && !parsed.token) return;
      const access = await resolveAccessWithFallback(parsed, "Direct QR session accepted");
      if (cancelled || !access) return;
      applyResolvedAccess(access, "Direct QR session accepted");
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    openQrSession();
    return () => { cancelled = true; };
  }, []);

  function applyActiveCertificationPackage(data, { markDirty = false } = {}) {
    const practicingCode = data?.variants?.Practicing?.code || "PRACTICING_ADMIN_PACKAGE";
    const consultingCode = data?.variants?.Consulting?.code || "CONSULTING_ADMIN_PACKAGE";
    const practicingQuestions = Array.isArray(data?.written?.Practicing?.questions)
      ? data.written.Practicing.questions
      : [];
    const consultingQuestions = Array.isArray(data?.written?.Consulting?.questions)
      ? data.written.Consulting.questions
      : [];

    setActiveCertificationPackage(data);
    setOutdoorItemsByLevel(normalizeAdminOutdoorPackage(data));
    setActiveAdminPackageMeta(activePackageRuntimeMeta(data));

    setTestBank((prev) => ({
      ...prev,
      [practicingCode]: practicingQuestions,
      [consultingCode]: consultingQuestions,
    }));

    setAvailableVariants((prev) => {
      const existing = Array.isArray(prev) ? prev : [];
      const adminCodes = new Set([practicingCode, consultingCode]);

      return [
        ...existing.filter((variant) => !adminCodes.has(variant.code)),
        {
          code: practicingCode,
          level: "Practicing",
          language,
          status: "Approved",
          source: "active-admin-json",
        },
        {
          code: consultingCode,
          level: "Consulting",
          language,
          status: "Approved",
          source: "active-admin-json",
        },
      ];
    });

    setVariants((prev) => ({
      ...prev,
      Practicing: practicingCode,
      Consulting: consultingCode,
    }));

    setTestImportSummary({
      variants: 2,
      questions: practicingQuestions.length + consultingQuestions.length,
      source: "active-admin-json",
      packageId: data.packageId,
    });

    if (markDirty) setCentreSetupDirty(true);
  }

  async function loadActiveCertificationPackageForCentre() {
    setActiveCertificationPackageError("");
    setActiveCertificationPackageStatus("Načítám aktivní Admin JSON balíček...");

    try {
      const response = await fetch("/api/centre/test-package/active");
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      const nextBank = buildTestBankFromCertificationPackage(data);
      const nextVariants = buildVariantsFromCertificationPackage(data);

      if (!nextBank.PRACTICING_ADMIN_PACKAGE?.length && !nextBank.CONSULTING_ADMIN_PACKAGE?.length) {
        throw new Error("Aktivní balíček neobsahuje žádné written questions.");
      }

      setActiveCertificationPackage(data);
      setOutdoorItemsByLevel(normalizeAdminOutdoorPackage(data));
      setActiveAdminPackageMeta(activePackageRuntimeMeta(data));
      setTestBank((prev) => ({ ...prev, ...nextBank }));

      if (nextVariants) {
        setVariants((prev) => ({
          ...prev,
          ...nextVariants,
        }));
      }

      setTestImportSummary({
        variants: Object.keys(data.variants || {}).length,
        questions:
          (data.written?.Practicing?.questions?.length || 0) +
          (data.written?.Consulting?.questions?.length || 0),
        source: "active-admin-json",
      });

      setActiveCertificationPackageStatus(tf("centre.activePackage.autoLoaded", { packageId: data.packageId }));
    } catch (error) {
      setActiveCertificationPackageError(error.message || t("centre.activePackage.autoLoadFailed"));
      setActiveCertificationPackageStatus("");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadActivePackageOnStartup() {
      try {
        const response = await fetch("/api/centre/test-package/active");
        const data = await response.json();

        if (!response.ok) return;
        if (cancelled) return;

        applyActiveCertificationPackage(data, { markDirty: false });
        setActiveCertificationPackageStatus(tf("centre.activePackage.autoLoadedOnStartup", { packageId: data.packageId }));
        setActiveCertificationPackageError("");
      } catch {
        // Bez aktivního Admin balíčku ponecháme demo/default data.
      }
    }

    loadActivePackageOnStartup();

    return () => {
      cancelled = true;
    };
  }, []);

  function importTestPackage(event, source = "Centre") {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    setTestImportStatus("");
    setTestImportError("");
    setTestImportSummary(null);
    reader.onload = () => {
      try {
        const imported = parseTestPackage(String(reader.result || ""), file.name, file.type || "");
        setAvailableVariants(imported.variants);
        setTestBank(imported.questions);
        setVariants((previous) => {
          const next = { ...previous };
          EXAM_LEVELS.forEach((level) => {
            const firstForLevel = imported.variants.find((variant) => variant.level === level && variant.language === language && variant.status === "Approved");
            if (firstForLevel) next[level] = firstForLevel.code;
          });
          return next;
        });
        setTestImportSummary({ variants: imported.variants.length, questions: imported.questionCount });
        setTestImportStatus(tf(source === "Admin" ? "status.testImport.adminImportedFull" : "status.testImport.importedFull", { variants: imported.variants.length, questions: imported.questionCount }));
        setCentreSetupDirty(true);
        addAudit(`${source} test package imported`, file.name, `${imported.variants.length} variant(s), ${imported.questionCount} question(s)`);
        queue(`${source} test package import`, file.name);
      } catch (error) {
        console.error("Test import failed", error);
        setTestImportError(tf("status.testImport.failedWithMessage", { message: error.message }));
        addAudit(`${source} test package import failed`, file.name, error.message);
      }
    };
    reader.onerror = () => {
      setTestImportError(t("status.testImport.fileReadFailed"));
      addAudit(`${source} test package import failed`, file.name, "File could not be read");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  // Pauses resolution and shows a PIN-entry dialog; resolves to whatever the user submits (a PIN
  // string), or null if they cancel. Kept as its own promise bridge so resolveAccessWithFallback
  // below can just `await` it inline and retry - none of its three call sites need to know a PIN
  // was ever involved.
  function requestQrPin(context) {
    return new Promise((resolve) => {
      setQrPinChallenge({ ...context, resolve });
    });
  }

  async function resolveAccessWithFallback(parsed, detail) {
    const token = parsed.token || parsed.raw || window.location.href;
    const deviceId = getOrCreateDeviceId();
    let pin;
    // Bounded retry loop: a wrong PIN re-prompts (with wrongPin:true) rather than failing outright,
    // up to 5 tries, so a typo doesn't force starting the whole scan over.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const resolved = await resolveQrToken(token, { deviceId, pin });
        const session = await bootstrapSession(resolved.sessionToken);
        if (resolved.promptSetPin) setQrSetPinPrompt({ sessionToken: resolved.sessionToken });
        return { ...resolved, ...session, sessionToken: resolved.sessionToken };
      } catch (error) {
        if (error?.body?.requiresPin) {
          pin = await requestQrPin({ wrongPin: Boolean(error?.body?.wrongPin) });
          if (pin === null || pin === undefined) return null;
          continue;
        }
        if (error?.body?.deviceLimitReached) {
          setAccessError(t("qr.deviceLimit"));
          return null;
        }
        // Only fall back to local demo matching when there was no backend to authoritatively
        // answer at all (offline LAN use, plain `vite dev` with no API, network down). A
        // definitive server answer (e.g. 401 invalid token) must be respected as-is —
        // otherwise anyone could present one of the public demo-token constants and get the
        // client to grant access locally even though the server explicitly rejected it, which
        // is exactly the gap this fixes.
        if (!error?.isBackendUnavailable) {
          console.warn("QR/session request rejected by server", error);
          addAudit("QR resolve failed", parsed.id ?? "Unknown QR", error?.message || "The QR could not be verified.");
          setAccessError(`${t("access.error.rejected")} ${error?.message ? `(${error.message})` : ""}`.trim());
          return null;
        }
        console.error("Backend unreachable; using local demo fallback when available", error);
        const fallback = demoAccess(parsed);
        if (fallback) {
          addAudit("Backend unavailable", fallback.subjectId ?? fallback.role, `${detail}; local demo fallback used`);
          return fallback;
        }
        addAudit("QR resolve failed", parsed.id ?? "Unknown QR", "The QR could not be verified.");
        setAccessError(t("access.error.rejected"));
        return null;
      }
    }
    return null;
  }

  function demoAccess(parsed) {
    if (
      parsed.role === "Centre" &&
      (
        parsed.token === DEMO_QR_TOKENS.Centre ||
        parsed.token === CENTRE_ACCESS_TOKEN ||
        parsed.token === "VETBARA-CENTRE-ARBOR-2026"
      )
    ) return { role: "Centre", subjectId: centre, mode: "demo" };
    if (
      parsed.role === "Candidate" &&
      (
        parsed.token === DEMO_QR_TOKENS.Candidate ||
        parsed.token === `VETBARA-CANDIDATE-${parsed.id}-2026`
      )
    ) return { role: "Candidate", subjectId: parsed.id, mode: "demo", profile: { name: parsed.name, level: parsed.level } };
    if (
      parsed.role === "Examiner" &&
      knownExaminer(parsed.id) &&
      (
        parsed.token === DEMO_QR_TOKENS.Examiner ||
        String(parsed.token || "").startsWith("VETBARA-EXAMINER")
      )
    ) return { role: "Examiner", subjectId: parsed.id, mode: "demo" };
    return null;
  }

  function applyResolvedAccess(access, detail) {
    setAuthenticatedPortalRole(access.role);
    setActiveSessionToken(access.sessionToken ?? null);

    // Every role opens this on its own separate page load (a different device, most of the
    // time), so it can't inherit whatever the Centre operator already has in local memory —
    // it only knows what's been persisted server-side. Apply that now, for every role, so an
    // Examiner or Candidate whose Centre already imported+saved an Admin.vet package actually
    // sees its questions instead of an empty test bank.
    if (isObject(access.centreSetup?.testPackage)) {
      applyTestPackagePayload(access.centreSetup.testPackage);
    }

    // Scope this browser's per-exam caches to the certification we just authenticated into:
    // its exam event (Centre without an event yet falls back to its own centre id, which is
    // already unique per certification).
    setAccessError("");
    setActiveExamScope(access.centreSetup?.examEventId || (access.role === "Centre" ? access.subjectId : ""));
    if (access.role === "Centre" && access.subjectId) setCentreExamId(String(access.subjectId));

    // Same as the roster below: a Candidate/Examiner device has never seen the Centre's own
    // harmonogram settings, only what the Centre already saved server-side.
    if (isObject(access.centreSetup?.harmonogramSettings)) {
      setHarmonogramSettings({ ...HARMONOGRAM_DEFAULT_SETTINGS, ...access.centreSetup.harmonogramSettings });
    }

    // Apply the real Centre roster (names, e-mails, assignments) persisted server-side, so an
    // Examiner/Candidate on their own device shows the actual people instead of the demo roster.
    const centreRoster = access.centreSetup;
    if (isObject(centreRoster)) {
      if (Array.isArray(centreRoster.candidates) && centreRoster.candidates.length) {
        setCandidates(centreRoster.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name || candidate.id,
          level: candidate.level || "Practicing",
          birthDate: candidate.birthDate ?? "",
          documentId: candidate.documentId ?? "",
          email: candidate.email ?? "",
          status: "Ready",
          written: null,
          outdoor: null,
          report: null,
        })));
      }
      if (Array.isArray(centreRoster.examiners) && centreRoster.examiners.length) {
        setExaminers(centreRoster.examiners.map((examiner) => ({
          id: examiner.id,
          name: examiner.name || examiner.id,
          birthDate: examiner.birthDate ?? "",
          registrationId: examiner.registrationId ?? "",
          email: examiner.email ?? "",
        })));
      }
      if (Array.isArray(centreRoster.assignments) && centreRoster.assignments.length) {
        setAssignments(centreRoster.assignments.reduce((map, row) => {
          const current = map[row.candidateId] ?? {};
          if (row.role === "primary") current.primary = row.examinerId;
          else if (row.role === "secondary") current.secondary = row.examinerId;
          map[row.candidateId] = current;
          return map;
        }, {}));
      }
    }

    if (access.role === "Centre") {
      setCentreUnlocked(true);
      setRole("Centre");
      addAudit("Centre workspace opened", centre, detail);
      return;
    }

    // The known* checks read this render's (stale) state — the roster applied a few lines above
    // has not flushed yet, so a subject that only exists in the freshly delivered roster (e.g. a
    // 4th examiner or a 5th candidate added in the Centre) must be accepted via the roster in the
    // access payload itself. A server-verified session (access.sessionToken) is trusted too: the
    // backend already authenticated the QR, the local demo roster must not veto it.
    const rosterHasCandidate = Array.isArray(access.centreSetup?.candidates) && access.centreSetup.candidates.some((candidate) => candidate.id === access.subjectId);
    const rosterHasExaminer = Array.isArray(access.centreSetup?.examiners) && access.centreSetup.examiners.some((examiner) => examiner.id === access.subjectId);

    if (access.role === "Candidate") {
      if (access.profile && Object.values(access.profile).some((value) => String(value ?? "").trim())) {
        setCandidates((previous) => previous.map((candidate) => candidate.id === access.subjectId ? { ...candidate, ...Object.fromEntries(Object.entries(access.profile).filter(([, value]) => String(value ?? "").trim())) } : candidate));
      }

      if (knownCandidate(access.subjectId) || rosterHasCandidate || access.sessionToken) {
        if (!knownCandidate(access.subjectId) && !rosterHasCandidate) {
          setCandidates((prev) => prev.some((candidate) => candidate.id === access.subjectId) ? prev : [...prev, { id: access.subjectId, name: access.profile?.name || access.subjectId, level: access.profile?.level || "Practicing", status: "Ready", written: null, outdoor: null, report: null }]);
        }
        setRole("Candidate");
        loginCandidate(access.subjectId);
        hydrateCandidateProgress(access.sessionToken, access.subjectId);
        return;
      }
    }

    if (access.role === "Examiner" && (knownExaminer(access.subjectId) || rosterHasExaminer || access.sessionToken)) {
      if (!knownExaminer(access.subjectId) && !rosterHasExaminer) {
        setExaminers((prev) => prev.some((examiner) => examiner.id === access.subjectId) ? prev : [...prev, { id: access.subjectId, name: access.subjectId, registrationId: "", email: "" }]);
      }
      setRole("Examiner");
      loginExaminer(access.subjectId);
      hydrateExaminerOutdoorProgress(access.sessionToken, access.subjectId);
      return;
    }

    addAudit("QR role blocked", access.role ?? "Unknown role", "Resolved role or subject does not match this portal package");
    setAccessError(t("access.error.roleBlocked"));
  }

  // Centre unlock for a ?role=Centre&token=... direct link is handled by the openQrSession
  // effect above (server-verified), not here. This used to also unlock straight from the URL
  // by comparing the token to the single hardcoded CENTRE_ACCESS_TOKEN client-side.

  async function handleQrScan(text) {
    const p = { ...parseQrPayload(text), raw: text };
    const access = await resolveAccessWithFallback(p, "QR accepted");
    if (access) applyResolvedAccess(access, "QR accepted");
    setScannerMode(null);
  }

  function importOfflineCandidatePackage(offlinePackage) {
    if (!offlinePackage?.candidateId) return false;

    const candidateId = offlinePackage.candidateId;
    const responses = offlinePackage.responses ?? {};
    const answerCount = Object.keys(responses).length;
    const reportDraft = offlinePackage.reportDraft ?? null;
    const reportPhotoCount = reportDraft ? countReportPhotos(reportDraft) : 0;

    if (Object.keys(responses).length) {
      setTestResponses((prev) => ({
        ...prev,
        [candidateId]: {
          ...(prev[candidateId] ?? {}),
          ...responses,
        },
      }));
    }

    if (reportDraft) {
      setReportDrafts((prev) => ({
        ...prev,
        [candidateId]: reportDraft,
      }));
    }

    setImportedCandidatePackages((prev) => ({
      ...prev,
      [candidateId]: offlinePackage,
    }));

    if (isObject(offlinePackage.outdoorItemsByLevelSnapshot)) {
      setOutdoorItemsByLevel((prev) => ({
        ...(isObject(prev) ? prev : {}),
        ...offlinePackage.outdoorItemsByLevelSnapshot,
      }));
    }

    if (isObject(offlinePackage.activeAdminPackage)) {
      setActiveAdminPackageMeta(offlinePackage.activeAdminPackage);
    }

    setSelectedCandidateId(candidateId);
    setActiveExaminerPage(reportDraft ? "reportReview" : "writtenReview");
    setStatus(`Offline candidate package imported: ${answerCount} answer(s), ${reportPhotoCount} report photo(s)`);
    addAudit("Offline candidate package imported", offlinePackage.candidateName || candidateId, `${answerCount} answer(s), ${reportPhotoCount} report photo(s) / ${offlinePackage.variantCode || "-"}`);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
    return true;
  }

  function importOfflineCandidatePackageData(data) {
    if (!parseOfflineCandidatePackage(JSON.stringify(data))) {
      setStatus("Invalid offline candidate package");
      return false;
    }

    return importOfflineCandidatePackage(normalizeOfflineCandidatePackageForImport(data, testBank));
  }

  function importOfflineCandidatePackageFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? ""));
        if (!parseOfflineCandidatePackage(JSON.stringify(data))) throw new Error("Invalid offline package");
        importOfflineCandidatePackage(data);
        event.target.value = "";
      } catch (error) {
        console.error("Offline package import failed", error);
        setStatus("Offline package import failed");
        event.target.value = "";
      }
    };

    reader.onerror = () => {
      setStatus("Offline package file could not be read");
      event.target.value = "";
    };

    reader.readAsText(file);
  }

  async function sendSyncEvent(event) {
    if (!activeSessionToken) return;
    const syncId = event.clientEventId;
    setSync((prev) => [{ id: syncId, type: event.type, detail: event.entityId, status: "Pending sync" }, ...prev]);
    try {
      await syncBatch(activeSessionToken, [event]);
      setSync((prev) => prev.map((item) => item.id === syncId ? { ...item, status: "Synced" } : item));
    } catch (error) {
      console.error("Backend sync failed; keeping local tablet state", error);
      setSync((prev) => prev.map((item) => item.id === syncId ? { ...item, status: "Sync error - local work remains visible; reopen QR before final submission" } : item));
    }
  }

  async function hydrateCandidateProgress(sessionToken, candidateId) {
    if (!sessionToken || !candidateId) return;

    try {
      const result = await fetchCandidateEvaluation(sessionToken, candidateId);
      const restoredSections = Array.isArray(result.sections) ? result.sections : [];
      const restoredResponses = Array.isArray(result.testResponses) ? result.testResponses : [];
      const candidate = candidates.find((item) => item.id === candidateId);

      if (restoredSections.length > 0) {
        setCandidateStatus((prev) => ({
          ...prev,
          [candidateId]: restoredSections.reduce((next, section) => {
            const sectionKey = section.section_key ?? section.sectionKey;
            return sectionKey ? { ...next, [sectionKey]: section.status || next[sectionKey] || "locked" } : next;
          }, { ...(prev[candidateId] ?? createSectionStatus(candidate?.level ?? "Practicing")) }),
        }));
        setCandidateTimes((prev) => ({
          ...prev,
          [candidateId]: restoredSections.reduce((next, section) => {
            const sectionKey = section.section_key ?? section.sectionKey;
            if (!sectionKey) return next;
            const openedAt = section.opened_at ?? section.openedAt ?? next[sectionKey]?.openedAt ?? "";
            const closedAt = section.closed_at ?? section.closedAt ?? next[sectionKey]?.closedAt ?? "";
            return { ...next, [sectionKey]: { ...(next[sectionKey] ?? {}), openedAt, openedAtIso: openedAt, closedAt, closedAtIso: closedAt } };
          }, { ...(prev[candidateId] ?? {}) }),
        }));
      }

      if (restoredResponses.length > 0) {
        setTestResponses((prev) => ({
          ...prev,
          [candidateId]: restoredResponses.reduce((next, row) => {
            const questionId = row.question_id ?? row.questionId;
            return questionId ? { ...next, [questionId]: storedAnswerValue(row) } : next;
          }, { ...(prev[candidateId] ?? {}) }),
        }));
      }

      if (result.reportDraft && typeof result.reportDraft === "object") {
        setReportDrafts((prev) => ({
          ...prev,
          [candidateId]: {
            ...createReportDraft(),
            ...result.reportDraft,
          },
        }));
      }

      if (restoredSections.length > 0 || restoredResponses.length > 0 || result.reportDraft) addAudit("Candidate state restored", candidateId, `${restoredSections.length} section(s), ${restoredResponses.length} response(s)`);
    } catch (error) {
      console.error("Candidate state restore failed", error);
      queue("Candidate state restore", `${candidateId} / sync error`);
    }
  }

  async function hydrateOutdoorProgress(sessionToken, examinerId, candidateId) {
    if (!sessionToken || !examinerId || !candidateId) return;
    const assignment = assignments[candidateId] ?? {};
    const mode = assignment.primary === examinerId ? "primary" : assignment.secondary === examinerId ? "secondary" : "unassigned";
    if (mode === "unassigned") return;

    try {
      const result = await fetchCandidateEvaluation(sessionToken, candidateId);
      const restoredScores = (Array.isArray(result.outdoorScores) ? result.outdoorScores : []).filter((score) => (score.examiner_id ?? score.examinerId) === examinerId);
      const restoredAssessments = (Array.isArray(result.outdoorAssessments) ? result.outdoorAssessments : []).filter((assessment) => (assessment.examiner_id ?? assessment.examinerId) === examinerId);

      if (restoredScores.length > 0) {
        setOutdoor((prev) => ({
          ...prev,
          [candidateId]: restoredScores.reduce((next, score) => {
            const itemId = score.item_id ?? score.itemId;
            const rawScore = score.score ?? score.payload?.score ?? "";
            const value = rawScore === null || rawScore === "" ? "" : Number(rawScore);
            return itemId ? { ...next, [itemId]: value === "" ? "" : Number.isFinite(value) ? value : rawScore } : next;
          }, { ...(prev[candidateId] ?? {}) }),
        }));
      }

      if (restoredScores.length > 0) {
        setOutdoorNotes((prev) => ({
          ...prev,
          [candidateId]: restoredScores.reduce((next, score) => {
            const itemId = score.item_id ?? score.itemId;
            const note = score.note ?? score.payload?.note ?? score.payload?.comment ?? "";
            return itemId ? { ...next, [itemId]: note } : next;
          }, { ...(prev[candidateId] ?? {}) }),
        }));
      }

      const assessment = restoredAssessments.find((row) => (row.section_key ?? row.sectionKey) === "outdoor") ?? restoredAssessments[0];
      const restoredDrawings = assessment?.payload?.noteDrawings;
      if (restoredDrawings && typeof restoredDrawings === "object") {
        setOutdoorNoteDrawings((prev) => ({
          ...prev,
          [candidateId]: { ...(prev[candidateId] ?? {}), ...restoredDrawings },
        }));
      }
      const restoredSummary = assessment?.payload?.examSummary;
      if (typeof restoredSummary === "string" && restoredSummary) {
        setOutdoorExamSummaries((prev) => ({ ...prev, [candidateId]: restoredSummary }));
      }
      if (assessment) {
        setExaminerTimes((prev) => ({
          ...prev,
          [examinerId]: {
            ...(prev[examinerId] ?? {}),
            [candidateId]: {
              ...(prev[examinerId]?.[candidateId] ?? {}),
              outdoor: {
                ...(prev[examinerId]?.[candidateId]?.outdoor ?? {}),
                openedAt: assessment.payload?.openedAtLabel || assessment.payload?.openedAt || prev[examinerId]?.[candidateId]?.outdoor?.openedAt || "",
                openedAtIso: assessment.payload?.openedAt || prev[examinerId]?.[candidateId]?.outdoor?.openedAtIso || null,
                closedAt: assessment.payload?.closedAtLabel || assessment.submitted_at || assessment.submittedAt || prev[examinerId]?.[candidateId]?.outdoor?.closedAt || "",
                closedAtIso: assessment.submitted_at || assessment.submittedAt || assessment.payload?.submittedAt || prev[examinerId]?.[candidateId]?.outdoor?.closedAtIso || null,
              },
            },
          },
        }));
      }

      if (restoredScores.length > 0 || assessment) addAudit("Outdoor state restored", candidateId, `${examinerId} / ${restoredScores.length} score(s)`);
    } catch (error) {
      console.error("Outdoor state restore failed", error);
      queue("Outdoor state restore", `${candidateId} / sync error`);
    }
  }

  async function hydrateExaminerOutdoorProgress(sessionToken, examinerId) {
    if (!sessionToken || !examinerId) return;
    const assigned = candidates.filter((candidate) => [assignments[candidate.id]?.primary, assignments[candidate.id]?.secondary].includes(examinerId));
    await Promise.all(assigned.map((candidate) => hydrateOutdoorProgress(sessionToken, examinerId, candidate.id)));
  }

  function updateCandidate(id, patch) {
    setCentreSetupDirty(true);
    setCandidates((prev) => prev.map((candidate) => (
      candidate.id === id ? { ...candidate, ...patch } : candidate
    )));
  }

  function updateExaminer(id, patch) {
    setCentreSetupDirty(true);
    setExaminers((prev) => prev.map((examiner) => examiner.id === id ? { ...examiner, ...patch } : examiner));
  }

  function addExaminer() {
    setCentreSetupDirty(true);
    const used = new Set(examiners.map((examiner) => examiner.id));
    let nextNumber = examiners.length + 1;
    let id = `E-${String(nextNumber).padStart(3, "0")}`;
    while (used.has(id)) {
      nextNumber += 1;
      id = `E-${String(nextNumber).padStart(3, "0")}`;
    }

    setExaminers((prev) => [...prev, {
      id,
      name: `Examiner ${nextNumber}`,
      birthDate: "",
      registrationId: `EX-DEMO-${String(nextNumber).padStart(3, "0")}`,
      email: "",
    }]);
  }

  // Shared by applyCentreSetup (Centre's own explicit "Load Centre Setup" click) and
  // applyResolvedAccess (every role's QR/token bootstrap) — a Centre operator who imports an
  // Admin.vet file locally (importTestPackage) only updates their own browser's state; that
  // only reaches other devices once "Save Centre Setup" persists it into centre-setup.json,
  // and only becomes visible to them once this same merge runs against that saved snapshot.
  function applyTestPackagePayload(testPackage) {
    if (!isObject(testPackage)) return;
    if (Array.isArray(testPackage.availableVariants)) setAvailableVariants(testPackage.availableVariants);
    if (isObject(testPackage.variants)) setVariants((previous) => ({ ...previous, ...testPackage.variants }));
    if (isObject(testPackage.testBank)) setTestBank(testPackage.testBank);
    if (isObject(testPackage.outdoorItemsByLevel)) {
      const storedOutdoorItemsByLevel = testPackage.outdoorItemsByLevel;
      if (!isHardcodedOutdoorFallbackBank(storedOutdoorItemsByLevel)) {
        setOutdoorItemsByLevel(storedOutdoorItemsByLevel);
      }
    }
    if (isObject(testPackage.activeAdminPackageMeta)) setActiveAdminPackageMeta(testPackage.activeAdminPackageMeta);
    const summary = testPackage.summary ?? testPackage.testImportSummary ?? null;
    if (summary) setTestImportSummary(summary);
    setTestImportError("");
    setTestImportStatus(summary?.variants && summary?.questions
      ? tf("status.testImport.loadedStoredFull", { variants: summary.variants, questions: summary.questions })
      : t("status.testImport.loadedStored"));
  }

  // Section E correction by the identified primary examiner: update the per-examiner view, persist
  // it as an outdoor_score.saved event (the Centre role is allowed exactly this one event type),
  // and record it in the exam audit log — every edit is traceable to who made it.
  function applyOutdoorCorrection(candidate, examinerId, itemId, patch) {
    if (!candidate?.id || !examinerId || !itemId) return;
    const updatedAt = new Date().toISOString();
    let nextScore = null;
    let nextNote = null;

    setOutdoorByExaminer((prev) => {
      const forCandidate = prev[candidate.id] ?? {};
      const bucket = forCandidate[examinerId] ?? { examinerId, mode: "primary", scores: {}, notes: {}, noteDrawings: {}, examSummary: "", submittedAt: null };
      const scores = { ...bucket.scores };
      const notes = { ...bucket.notes };
      if (patch.score !== undefined) {
        scores[itemId] = patch.score === "" ? "" : Number(patch.score);
      }
      if (patch.note !== undefined) notes[itemId] = patch.note;
      nextScore = scores[itemId] ?? "";
      nextNote = notes[itemId] ?? "";
      return { ...prev, [candidate.id]: { ...forCandidate, [examinerId]: { ...bucket, scores, notes } } };
    });

    // Keep the flat per-candidate total in step so section D's overview reflects the correction.
    if (patch.score !== undefined) {
      setOutdoor((prev) => ({
        ...prev,
        [candidate.id]: { ...(prev[candidate.id] ?? {}), [itemId]: patch.score === "" ? "" : Number(patch.score) },
      }));
    }

    const examinerName = examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId;
    const what = patch.score !== undefined ? `score → ${patch.score === "" ? "-" : patch.score}` : `note edited (${String(patch.note ?? "").length} chars)`;
    addAudit("Outdoor corrected in Centre", `${candidate.name} / ${itemId}`, `${examinerName} · ${what}`);

    sendSyncEvent({
      clientEventId: localEventId(`outdoor-correction-${candidate.id}-${examinerId}-${itemId}-${updatedAt}`),
      type: "outdoor_score.saved",
      entityType: "outdoor_score",
      entityId: `${candidate.id}:${itemId}`,
      candidateId: candidate.id,
      payload: {
        candidateId: candidate.id,
        examinerId,
        mode: "primary",
        role: "primary",
        sectionKey: "outdoor",
        itemId,
        score: patch.score !== undefined ? (patch.score === "" ? null : Number(patch.score)) : nextScore,
        note: patch.note !== undefined ? patch.note : nextNote,
        comment: patch.note !== undefined ? patch.note : nextNote,
        correctedInCentre: true,
        updatedAt,
      },
      createdAt: updatedAt,
    });
  }

  // Closing the scan-marking window feeds the marks into the candidate's written classification the
  // same way an examiner's own review does — one examiner_score.saved event per candidate carrying
  // the total, plus an audit entry naming who marked it.
  function applyScanGrading(candidate, scores, identifiedExaminer) {
    if (!candidate?.id) return;
    const total = Object.values(scores).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const updatedAt = new Date().toISOString();
    const examinerId = identifiedExaminer?.id || null;

    setCandidates((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, written: total } : item)));
    addAudit("Scanned test graded", candidate.name, `${total} points · ${identifiedExaminer?.name || "unidentified"}`);

    if (!examinerId) return;
    sendSyncEvent({
      clientEventId: localEventId(`scan-grading-${candidate.id}-${examinerId}-${updatedAt}`),
      type: "examiner_score.saved",
      entityType: "examiner_score",
      entityId: `${candidate.id}:written`,
      candidateId: candidate.id,
      payload: { candidateId: candidate.id, examinerId, mode: "primary", role: "primary", field: "written", value: total, scores, source: "scan", updatedAt },
      createdAt: updatedAt,
    });
  }

  // The examiner's report marks roll up to one number on the candidate's record, so section D/E and
  // the archive see the same total the examiner is looking at.
  function applyReportMarking(candidate, marks) {
    if (!candidate?.id) return;
    const total = reportMarksTotal(marks);
    setCandidates((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, report: total } : item)));
    if (!loggedExaminer?.id) return;
    const updatedAt = new Date().toISOString();
    sendSyncEvent({
      clientEventId: localEventId(`report-marking-${candidate.id}-${loggedExaminer.id}-${updatedAt}`),
      type: "examiner_score.saved",
      entityType: "examiner_score",
      entityId: `${candidate.id}:report`,
      candidateId: candidate.id,
      payload: { candidateId: candidate.id, examinerId: loggedExaminer.id, mode: "primary", role: "primary", field: "report", value: total, max: REPORT_MARKING_TOTAL, marks, updatedAt },
      createdAt: updatedAt,
    });
  }

  // Section E correction of a closed written test / Consulting report by the identified examiner
  // (mirrors applyOutdoorCorrection below): a candidate-closed section has no route back to the
  // examiner's own device, so the Centre is the only place left to fix a mis-marked question or
  // report section. Sent as the same "examiner_score.saved" event applyScanGrading/applyReportMarking
  // already use, full scores/marks map each time (the Centre role is allowed exactly this one event
  // type for exactly this reason — see api/sync/batch.js EVENT_TYPES_BY_ROLE.Centre).
  function applyWrittenCorrection(candidate, examinerId, questionId, points) {
    if (!candidate?.id || !examinerId || !questionId) return;
    const updatedAt = new Date().toISOString();
    let nextScores = null;
    setWrittenScoresByExaminer((prev) => {
      const forCandidate = prev[candidate.id] ?? {};
      const bucket = forCandidate[examinerId] ?? { examinerId, scores: {} };
      const scores = { ...bucket.scores, [questionId]: points === "" ? "" : Number(points) };
      nextScores = scores;
      return { ...prev, [candidate.id]: { ...forCandidate, [examinerId]: { ...bucket, scores, updatedAt } } };
    });
    const total = computeWrittenTestReview(candidate, variants, testBank, testResponses).items
      .reduce((sum, item) => {
        const override = nextScores[item.question.id];
        const value = override !== undefined && override !== "" ? Number(override) : item.pointsAwarded;
        return sum + (Number(value) || 0);
      }, 0);
    setCandidates((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, written: total } : item)));
    const examinerName = examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId;
    addAudit("Written test corrected in Centre", `${candidate.name} / ${questionId}`, `${examinerName} · score → ${points === "" ? "-" : points}`);
    sendSyncEvent({
      clientEventId: localEventId(`written-correction-${candidate.id}-${examinerId}-${questionId}-${updatedAt}`),
      type: "examiner_score.saved",
      entityType: "examiner_score",
      entityId: `${candidate.id}:written`,
      candidateId: candidate.id,
      payload: { candidateId: candidate.id, examinerId, mode: "primary", role: "primary", field: "written", value: total, scores: nextScores, source: "centre-correction", updatedAt },
      createdAt: updatedAt,
    });
  }

  function applyReportCorrection(candidate, examinerId, treeName, sectionOrItemKey, patch, scope = "section") {
    if (!candidate?.id || !examinerId || !sectionOrItemKey) return;
    const updatedAt = new Date().toISOString();
    let nextMarks = null;
    setReportMarksByExaminer((prev) => {
      const forCandidate = prev[candidate.id] ?? {};
      const bucket = forCandidate[examinerId] ?? { examinerId, marks: {} };
      const marks = scope === "clarity"
        ? { ...bucket.marks, clarity: { ...(bucket.marks.clarity || {}), [sectionOrItemKey]: patch } }
        : { ...bucket.marks, [treeName]: { ...(bucket.marks[treeName] || {}), [sectionOrItemKey]: { ...(bucket.marks[treeName]?.[sectionOrItemKey] || {}), ...patch } } };
      nextMarks = marks;
      return { ...prev, [candidate.id]: { ...forCandidate, [examinerId]: { ...bucket, marks, updatedAt } } };
    });
    const total = reportMarksTotal(nextMarks);
    setCandidates((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, report: total } : item)));
    const examinerName = examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId;
    addAudit("Report corrected in Centre", `${candidate.name} / ${treeName || "clarity"}:${sectionOrItemKey}`, examinerName);
    sendSyncEvent({
      clientEventId: localEventId(`report-correction-${candidate.id}-${examinerId}-${treeName || "clarity"}-${sectionOrItemKey}-${updatedAt}`),
      type: "examiner_score.saved",
      entityType: "examiner_score",
      entityId: `${candidate.id}:report`,
      candidateId: candidate.id,
      payload: { candidateId: candidate.id, examinerId, mode: "primary", role: "primary", field: "report", value: total, max: REPORT_MARKING_TOTAL, marks: nextMarks, source: "centre-correction", updatedAt },
      createdAt: updatedAt,
    });
  }

  function applyCentreSetup(result) {
    if (Array.isArray(result.candidates)) {
      setCandidates(result.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name || candidate.payload?.name || candidate.id,
        birthDate: candidate.birthDate || candidate.birth_date || candidate.payload?.birthDate || candidate.payload?.birth_date || "",
        documentId: candidate.documentId || candidate.document_id || candidate.payload?.documentId || candidate.payload?.document_id || "",
        email: candidate.email || candidate.payload?.email || "",
        level: candidate.level || candidate.payload?.level || "Practicing",
        status: candidate.payload?.status || "Ready",
        written: candidate.payload?.written ?? null,
        outdoor: candidate.payload?.outdoor ?? null,
        report: candidate.payload?.report ?? null,
      })));
    }
    if (Array.isArray(result.examiners)) {
          setExaminers(result.examiners.map((examiner) => ({
        id: examiner.id,
        name: examiner.name || examiner.payload?.name || examiner.id,
        birthDate: examiner.birthDate || examiner.birth_date || examiner.payload?.birthDate || examiner.payload?.birth_date || "",
        registrationId: examiner.registrationId || examiner.registration_id || examiner.payload?.registrationId || examiner.payload?.registration_id || examiner.id,
        email: examiner.email || examiner.payload?.email || "",
      })));
    }
    if (Array.isArray(result.assignments)) {
      const nextAssignments = result.assignments.reduce((next, assignment) => {
        const candidateId = assignment.candidateId || assignment.candidate_id;
        const role = assignment.role;
        const examinerId = assignment.examinerId || assignment.examiner_id;
        if (!candidateId || !role || !examinerId) return next;
        return { ...next, [candidateId]: { ...(next[candidateId] ?? {}), [role]: examinerId } };
      }, {});
      setAssignments(nextAssignments);
    }

    setCentreQrAccess(result.qrAccess ?? { candidates: [], examiners: [] });

    if (isObject(result.harmonogramSettings)) {
      setHarmonogramSettings({ ...HARMONOGRAM_DEFAULT_SETTINGS, ...result.harmonogramSettings });
    }

    applyTestPackagePayload(result.testPackage);
  }

  function validateCentreSetup() {
    const issues = [];
    const candidateIds = new Set();
    const duplicateCandidateIds = new Set();
    const examinerIds = new Set();
    const duplicateExaminerIds = new Set();

    candidates.forEach((candidate, index) => {
      const label = candidate.name || candidate.id || `Candidate ${index + 1}`;
      const id = String(candidate.id || "").trim();

      if (!id) issues.push({ severity: "error", message: `${label}: candidate id is missing.` });
      if (!String(candidate.name || "").trim()) issues.push({ severity: "error", message: `${id || label}: candidate name is missing.` });
      if (!String(candidate.level || "").trim()) issues.push({ severity: "error", message: `${id || label}: candidate level is missing.` });

      if (id) {
        if (candidateIds.has(id)) duplicateCandidateIds.add(id);
        candidateIds.add(id);
      }
    });

    duplicateCandidateIds.forEach((id) => {
      issues.push({ severity: "error", message: `Duplicate candidate id: ${id}.` });
    });

    examiners.forEach((examiner, index) => {
      const label = examiner.name || examiner.id || `Examiner ${index + 1}`;
      const id = String(examiner.id || "").trim();

      if (!id) issues.push({ severity: "error", message: `${label}: examiner id is missing.` });
      if (!String(examiner.name || "").trim()) issues.push({ severity: "error", message: `${id || label}: examiner name is missing.` });
      if (!String(examiner.registrationId || "").trim()) issues.push({ severity: "warning", message: `${id || label}: examiner registration ID is missing.` });

      if (id) {
        if (examinerIds.has(id)) duplicateExaminerIds.add(id);
        examinerIds.add(id);
      }
    });

    duplicateExaminerIds.forEach((id) => {
      issues.push({ severity: "error", message: `Duplicate examiner id: ${id}.` });
    });

    candidates.forEach((candidate) => {
      const candidateId = String(candidate.id || "").trim();
      if (!candidateId) return;

      const assignment = assignments[candidateId] ?? {};
      const primary = String(assignment.primary || "").trim();
      const secondary = String(assignment.secondary || "").trim();

      if (!primary) issues.push({ severity: "error", message: `${candidateId}: primary examiner is missing.` });
      if (primary && !examinerIds.has(primary)) issues.push({ severity: "error", message: `${candidateId}: primary examiner does not exist.` });
      if (secondary && !examinerIds.has(secondary)) issues.push({ severity: "error", message: `${candidateId}: secondary examiner does not exist.` });
      if (primary && secondary && primary === secondary) issues.push({ severity: "error", message: `${candidateId}: primary and secondary examiner must be different.` });
    });

    return issues;
  }

  // The Centre's access links only exist after the setup has been loaded from the backend
  // (that response carries qrAccess). Until then the QR pack had nothing to show. Load it
  // automatically once per Centre session — before the operator edits anything, so this can
  // never overwrite unsaved work.
  const centreAutoLoadedRef = useRef(null);
  useEffect(() => {
    if (role !== "Centre" || !activeSessionToken) return;
    if (centreAutoLoadedRef.current === activeSessionToken) return;
    centreAutoLoadedRef.current = activeSessionToken;
    handleLoadCentreSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeSessionToken]);

  async function handleLoadCentreSetup() {
    if (!activeSessionToken) {
      setCentreSetupError(t("status.centreQrRequired"));
      return;
    }

    setCentreSetupLoading(true);
    setCentreSetupError("");
    setCentreSetupStatus("");

    try {
      const result = await loadCentreSetup(activeSessionToken);
      applyCentreSetup(result);
      setCentreValidationIssues([]);
      setCentreSetupDirty(false);
      setCentreSetupStatus(tf("status.centreSetup.loadedEvent", { event: result.examEventId || "current" }));
    } catch (error) {
      console.error("Centre Setup load failed", error);
      setCentreSetupError(isBackendPersistenceUnavailable(error) ? t("status.backendPersistenceUnavailable") : t("status.centreSetup.loadFailed"));
    } finally {
      setCentreSetupLoading(false);
    }
  }

  async function handleSaveCentreSetup() {
    if (!activeSessionToken) {
      setCentreSetupError(t("status.centreQrRequired"));
      return false;
    }

    const issues = validateCentreSetup();
    setCentreValidationIssues(issues);

    const assignmentList = candidates.map((candidate) => ({
      candidateId: candidate.id,
      primary: assignments[candidate.id]?.primary || "",
      secondary: assignments[candidate.id]?.secondary || "",
    }));

    setCentreSetupSaving(true);
    setCentreSetupError("");
    setCentreSetupStatus("");

    try {
      const persistableOutdoorItemsByLevel = isHardcodedOutdoorFallbackBank(outdoorItemsByLevel) ? {} : outdoorItemsByLevel;
      const testPackage = testImportSummary ? {
        availableVariants,
        variants,
        testBank,
        outdoorItemsByLevel: persistableOutdoorItemsByLevel,
        activeAdminPackageMeta,
        summary: testImportSummary,
      } : undefined;
      const result = await saveCentreSetupWithTestPackage(activeSessionToken, {
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          level: candidate.level,
          birthDate: candidate.birthDate ?? "",
          documentId: candidate.documentId ?? "",
          email: candidate.email ?? "",
        })),
        examiners: examiners.map((examiner) => ({
          id: examiner.id,
          name: examiner.name,
          birthDate: examiner.birthDate ?? "",
          registrationId: examiner.registrationId ?? "",
          email: examiner.email ?? "",
        })),
        assignments: assignmentList,
        testPackage,
        harmonogramSettings,
      });
      setCentreQrAccess(result.qrAccess ?? { candidates: [], examiners: [] });
      setCentreSetupDirty(false);
      setCentreSetupStatus(tf("status.centreSetup.savedEvent", { event: result.examEventId || "current" }));
      return true;
    } catch (error) {
      console.error("Centre Setup save failed", error);
      setCentreSetupError(isBackendPersistenceUnavailable(error) ? t("status.backendPersistenceUnavailable") : t("status.centreSetup.saveFailed"));
      return false;
    } finally {
      setCentreSetupSaving(false);
    }
  }
  centreAutosaveStateRef.current.save = handleSaveCentreSetup;

  async function handleDownloadCentreAuditPackage() {
    if (!activeSessionToken) {
      setCentreAuditExportError(t("status.centreAuditExport.sessionRequired"));
      return;
    }

    setCentreAuditExportLoading(true);
    setCentreAuditExportError("");

    try {
      const result = await exportCentreAuditPackage(activeSessionToken, "xls");
      downloadBase64File(result);
    } catch (error) {
      console.error("Centre audit export failed", error);
      setCentreAuditExportError(isBackendPersistenceUnavailable(error) ? t("status.backendPersistenceUnavailable") : t("status.centreAuditExport.unavailable"));
    } finally {
      setCentreAuditExportLoading(false);
    }
  }

  async function unlockCentre() {
    const raw = centreCode.trim();
    if (!raw) return addAudit("Centre access failed", centre, "empty code");
    let token = raw;
    try {
      const parsed = new URL(raw);
      token = parsed.searchParams.get("token") || raw;
    } catch {
      token = raw;
    }
    // Verified through the same server-side path as a scanned QR link, instead of comparing
    // the typed code to the single hardcoded CENTRE_ACCESS_TOKEN in the browser.
    const access = await resolveAccessWithFallback({ role: "Centre", token, id: CENTRE_QR_ID }, "Delegated token accepted");
    if (access && access.role === "Centre") {
      applyResolvedAccess(access, "Delegated token accepted");
      return;
    }
    addAudit("Centre access failed", centre, raw);
  }
  function toggleLevel(level) { setCentreSetupDirty(true); setEnabledLevels((prev) => prev.includes(level) && prev.length > 1 ? prev.filter((x) => x !== level) : prev.includes(level) ? prev : [...prev, level]); }
  function addCandidate() {
    setCentreSetupDirty(true);
    // Next free id must avoid COLLISIONS, not just be length+1: after a candidate is removed (or when
    // the roster was loaded with non-contiguous ids) length+1 can equal an id already in use, and two
    // candidates sharing an id make the server upsert fail ("ON CONFLICT ... cannot affect row a second
    // time") → the whole Centre save 400s → the roster never confirms → sections D-F stay locked. Same
    // guard addExaminer already uses.
    const used = new Set(candidates.map((candidate) => candidate.id));
    let nextNumber = candidates.length + 1;
    let id = `C-${String(nextNumber).padStart(3, "0")}`;
    while (used.has(id)) { nextNumber += 1; id = `C-${String(nextNumber).padStart(3, "0")}`; }
    const level = enabledLevels[0] ?? "Practicing";
    const c = { id, name: `New candidate ${nextNumber}`, level, status: "Ready", written: null, outdoor: null, report: null };
    setCandidates((prev) => [...prev, c]);
    setCandidateStatus((prev) => ({ ...prev, [id]: createSectionStatus(level) }));
    setAssignments((prev) => ({ ...prev, [id]: { primary: examiners[0]?.id ?? "", secondary: examiners[1]?.id ?? "" } }));
    setSelectedCandidateId(id);
  }
  function removeCandidate(candidateId) {
    // Keep exactly one candidate as the floor: the UI reads selectedCandidate unconditionally in
    // many places, so an empty roster would crash — but the operator must be able to clear out an
    // old certification's people (the old minimum of 2 left "two candidates that cannot be
    // deleted"). To replace everyone: delete down to one, overwrite that one's details, add the rest.
    if (candidates.length <= 1) {
      window.alert(t("centre.people.minCandidatesAlert"));
      return;
    }

    const candidate = candidates.find((item) => item.id === candidateId);
    if (!window.confirm(tf("centre.people.removeCandidateConfirm", { name: candidate?.name ?? candidateId }))) return;

    setCandidates((prev) => prev.filter((item) => item.id !== candidateId));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    setSelectedCandidateId((prev) => prev === candidateId ? candidates.find((item) => item.id !== candidateId)?.id ?? prev : prev);
    setCentreSetupDirty(true);
  }

  function removeExaminer(examinerId) {
    if (examiners.length <= 2) {
      window.alert(t("centre.people.minExaminersAlert"));
      return;
    }

    const examiner = examiners.find((item) => item.id === examinerId);
    if (!window.confirm(tf("centre.people.removeExaminerConfirm", { name: examiner?.name ?? examinerId }))) return;

    const fallback = examiners.find((item) => item.id !== examinerId)?.id ?? "";
    setExaminers((prev) => prev.filter((item) => item.id !== examinerId));
    setAssignments((prev) => Object.fromEntries(Object.entries(prev).map(([candidateId, slots]) => [
      candidateId,
      {
        primary: slots.primary === examinerId ? fallback : slots.primary,
        secondary: slots.secondary === examinerId ? fallback : slots.secondary,
      },
    ])));
    setCentreSetupDirty(true);
  }

  function loginCandidate(id) { setLoggedCandidateId(id); setSelectedCandidateId(id); setActiveCandidateSection("landing"); addAudit("Candidate logged in", candidates.find((c) => c.id === id)?.name ?? id, "QR accepted"); }
  function confirmCandidate() { if (!loggedCandidate) return; setCandidateConfirmed((prev) => ({ ...prev, [loggedCandidate.id]: true })); addAudit("Candidate identity confirmed", loggedCandidate.name, `${loggedCandidate.birthDate} / ${loggedCandidate.documentId}`); }
  function unconfirmCandidate() {
    if (!loggedCandidate) return;
    setCandidateConfirmed((prev) => ({ ...prev, [loggedCandidate.id]: false }));
    addAudit("Candidate returned to identity screen", loggedCandidate.name, "Left the report section");
  }

  // Manual "send to server": re-emits the candidate's answers and report draft so nothing is left
  // waiting on this device. Returns false when there is no session, so the button stays white
  // rather than claiming a transfer that never happened.
  async function resendCandidateData() {
    if (!loggedCandidate || !activeSessionToken) return false;
    const candidateId = loggedCandidate.id;
    const updatedAt = new Date().toISOString();
    const events = [];

    Object.entries(testResponses[candidateId] ?? {}).forEach(([questionId, answer]) => {
      events.push({
        clientEventId: localEventId(`test-response-resend-${candidateId}-${questionId}-${updatedAt}`),
        type: "test_response.saved",
        entityType: "test_response",
        entityId: `${candidateId}:test:${questionId}`,
        candidateId,
        payload: { sectionKey: "test", questionId, answer, selectedAnswer: answer, variantCode: variants[loggedCandidate.level] ?? null, updatedAt },
        createdAt: updatedAt,
      });
    });

    Object.entries(reportDrafts[candidateId] ?? {}).forEach(([treeKey, tree]) => {
      if (!tree || typeof tree !== "object") return;
      if (tree.fieldNotes !== undefined) {
        events.push({
          clientEventId: localEventId(`report-draft-resend-${candidateId}-${treeKey}-fieldNotes-${updatedAt}`),
          type: "report_draft.saved",
          entityType: "report_draft",
          entityId: `${candidateId}:report:${treeKey}:fieldNotes`,
          candidateId,
          payload: { candidateId, sectionKey: "report", treeId: treeKey, fieldKey: "fieldNotes", fieldType: "fieldNotes", value: tree.fieldNotes ?? "", updatedAt },
          createdAt: updatedAt,
        });
      }
      Object.entries(tree.finalSections ?? {}).forEach(([fieldKey, value]) => {
        events.push({
          clientEventId: localEventId(`report-draft-resend-${candidateId}-${treeKey}-${fieldKey}-${updatedAt}`),
          type: "report_draft.saved",
          entityType: "report_draft",
          entityId: `${candidateId}:report:${treeKey}:${fieldKey}`,
          candidateId,
          payload: { candidateId, sectionKey: "report", treeId: treeKey, fieldKey, fieldType: "finalSection", value, updatedAt },
          createdAt: updatedAt,
        });
      });
    });

    if (!events.length) return true;
    await syncBatch(activeSessionToken, events);
    addAudit("Candidate data sent to server", loggedCandidate.name, `${events.length} record(s)`);
    return true;
  }

  function openCandidateSection(key) {
    if (!loggedCandidate || !candidateConfirmed[loggedCandidate.id]) return;
    const current = candidateStatus[loggedCandidate.id]?.[key];
    if (current === "closed") {
      // Reopening a closed section needs proctor approval on the spot, so this is shown as a
      // blocking in-app dialog with a clear message (not a native browser prompt/alert) —
      // both the ask itself and a wrong-password result are visible to the candidate/proctor.
      setReopenRequest({ key, error: "" });
      return;
    }
    performOpenCandidateSection(key, current);
  }

  // Report photos (including handwritten notes and annotations, which are baked into a photo via
  // saveHandwritingAsPhoto/saveAnnotatedPhoto) live only in this tab's in-memory reportDrafts plus
  // this device's IndexedDB - reopening on a different device, or after local storage was cleared,
  // otherwise shows an empty report even though the images are safely in Supabase Storage. Only
  // fills in a tree whose LOCAL photo list is still empty, so it never clobbers photos already
  // present from this same session.
  async function hydrateReportPhotosFromMedia(candidateId) {
    if (!activeSessionToken) return;
    let result;
    try {
      result = await listExamMedia(activeSessionToken);
    } catch (error) {
      console.warn("Report media hydration failed", error);
      return;
    }
    if (!result?.stored || !Array.isArray(result.media)) return;
    const ownPhotos = result.media.filter((item) => item.mediaType === "photo" && item.sectionKey === "report" && item.candidateId === candidateId && item.downloadUrl);
    if (!ownPhotos.length) return;

    const currentDraft = reportDrafts[candidateId] ?? createReportDraft();
    const treesNeedingHydration = REPORT_TREES.filter((tree) => !(currentDraft[tree]?.photos ?? []).length && ownPhotos.some((item) => item.tree === tree));
    if (!treesNeedingHydration.length) return;

    const hydratedByTree = {};
    for (const tree of treesNeedingHydration) {
      const photos = [];
      for (const item of ownPhotos.filter((entry) => entry.tree === tree)) {
        try {
          const response = await fetch(item.downloadUrl);
          const blob = await response.blob();
          const dataUrl = await blobToDataUrl(blob);
          photos.push({
            id: item.clientMediaId || `M-${item.id}`,
            name: item.fileName || tree,
            type: item.mimeType || blob.type,
            size: item.sizeBytes ?? blob.size,
            dataUrl,
            description: "",
            useInReport: true,
            caption: item.caption || item.fileName || tree,
            capturedAt: item.createdAt,
            createdAt: item.createdAt,
          });
        } catch (error) {
          console.warn("Report photo download failed during hydration", error);
        }
      }
      if (photos.length) hydratedByTree[tree] = photos;
    }
    if (!Object.keys(hydratedByTree).length) return;

    setReportDrafts((prev) => {
      const draft = prev[candidateId] ?? createReportDraft();
      const nextDraft = { ...draft };
      let changed = false;
      Object.entries(hydratedByTree).forEach(([tree, photos]) => {
        if ((nextDraft[tree]?.photos ?? []).length) return;
        nextDraft[tree] = { ...nextDraft[tree], photos };
        changed = true;
      });
      if (!changed) return prev;
      return { ...prev, [candidateId]: nextDraft };
    });
  }

  function performOpenCandidateSection(key, previousStatus) {
    const openedAt = nowStamp();
    const openedAtIso = new Date().toISOString();
    setCandidateStatus((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level)), [key]: "open" } }));
    setCandidateTimes((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? {}), [key]: { ...(prev[loggedCandidate.id]?.[key] ?? {}), openedAt, openedAtIso, closedAt: null, closedAtIso: null } } }));
    setActiveCandidateSection(key);
    addAudit(previousStatus === "closed" ? "Candidate section reopened" : "Candidate section opened", loggedCandidate.name, `${key} / ${openedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`candidate-section-opened-${loggedCandidate.id}-${key}`), type: previousStatus === "closed" ? "candidate_section.reopened" : "candidate_section.opened", entityType: "candidate_section", entityId: `${loggedCandidate.id}:${key}`, candidateId: loggedCandidate.id, payload: { sectionKey: key, openedAt: openedAtIso, openedAtLabel: openedAt }, createdAt: openedAtIso });
    if (key === "report" && previousStatus === "closed") {
      hydrateReportPhotosFromMedia(loggedCandidate.id);
    }
  }

  function confirmReopenRequest(password) {
    if (!reopenRequest) return;
    if (password !== "Vetarbo") {
      setReopenRequest((prev) => prev && { ...prev, error: t("reopenModal.invalidPassword") });
      addAudit("Candidate reopen request denied", loggedCandidate?.name ?? "-", `${reopenRequest.key} / wrong password`);
      return;
    }
    performOpenCandidateSection(reopenRequest.key, "closed");
    setReopenRequest(null);
  }
  function closeCandidateSection(key) {
    if (!loggedCandidate) return;
    const closedAt = nowStamp();
    const closedAtIso = new Date().toISOString();
    const priorTime = candidateTimes[loggedCandidate.id]?.[key] ?? {};
    setCandidateStatus((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level)), [key]: "closed" } }));
    setCandidateTimes((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? {}), [key]: { ...(prev[loggedCandidate.id]?.[key] ?? {}), closedAt, closedAtIso } } }));
    setActiveCandidateSection("landing");
    addAudit("Candidate section closed", loggedCandidate.name, `${key} / ${closedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`candidate-section-closed-${loggedCandidate.id}-${key}`), type: "candidate_section.closed", entityType: "candidate_section", entityId: `${loggedCandidate.id}:${key}`, candidateId: loggedCandidate.id, payload: { sectionKey: key, openedAt: priorTime.openedAtIso ?? priorTime.openedAt ?? null, closedAt: closedAtIso, closedAtLabel: closedAt }, createdAt: closedAtIso });
  }
  function updateTest(qid, value) {
    if (!loggedCandidate) return;
    const variantCode = variants[loggedCandidate.level] ?? "";
    const updatedAt = new Date().toISOString();
    setTestResponses((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? {}), [qid]: value } }));
    queue("Candidate test autosave", `${loggedCandidate.name} / ${qid}`);
    sendSyncEvent({ clientEventId: localEventId(`test-response-saved-${loggedCandidate.id}-${qid}`), type: "test_response.saved", entityType: "test_response", entityId: `${loggedCandidate.id}:test:${qid}`, candidateId: loggedCandidate.id, payload: { sectionKey: "test", questionId: qid, answer: value, selectedAnswer: value, variantCode, updatedAt }, createdAt: updatedAt });
  }
  function submitTest() { if (!loggedCandidate) return; setCandidates((prev) => prev.map((c) => c.id === loggedCandidate.id ? { ...c, status: "Written test submitted" } : c)); closeCandidateSection("test"); }
    function updateReport(tree, key, value, field = "section") {
    if (!loggedCandidate) return;
    const updatedAt = new Date().toISOString();

    setReportDrafts((prev) => {
      const draft = prev[loggedCandidate.id] ?? createReportDraft();
      return {
        ...prev,
        [loggedCandidate.id]: {
          ...draft,
          [tree]: field === "fieldNotes"
            ? { ...draft[tree], fieldNotes: value }
            : { ...draft[tree], finalSections: { ...draft[tree].finalSections, [key]: value } },
        },
      };
    });

    sendSyncEvent({
      clientEventId: localEventId(`report-draft-saved-${loggedCandidate.id}-${tree}-${key}`),
      type: "report_draft.saved",
      entityType: "report_draft",
      entityId: `${loggedCandidate.id}:report:${tree}:${key}`,
      candidateId: loggedCandidate.id,
      payload: {
        candidateId: loggedCandidate.id,
        sectionKey: "report",
        treeId: tree,
        fieldKey: key,
        fieldType: field === "fieldNotes" ? "fieldNotes" : "finalSection",
        value,
        updatedAt,
      },
      createdAt: updatedAt,
    });
  }

   function addReportPhoto(tree, filePhoto) {
    if (!loggedCandidate || !filePhoto) return;
    const capturedAt = filePhoto.createdAt ?? new Date().toISOString();
    const draft = reportDrafts[loggedCandidate.id] ?? createReportDraft();
    const photos = draft[tree]?.photos ?? [];
    // Auto-named ("Picture 1", "Picture 2", ...) rather than the source file's own name - a
    // camera/gallery filename like "IMG_20260801_143022.jpg" was neither meaningful to the
    // candidate nor consistent between capture methods (camera vs. handwriting vs. annotation).
    const autoName = tf("report.photo.autoName", { index: photos.length + 1 });
    const photo = {
      id: `P-${photos.length + 1}`,
      name: autoName,
      type: filePhoto.type,
      size: filePhoto.size,
      dataUrl: filePhoto.dataUrl,
      description: filePhoto.description ?? "",
      useInReport: filePhoto.useInReport ?? true,
      caption: autoName,
      capturedAt,
      createdAt: capturedAt,
    };

    setReportDrafts((prev) => {
      const current = prev[loggedCandidate.id] ?? createReportDraft();
      const currentPhotos = current[tree]?.photos ?? [];
      return {
        ...prev,
        [loggedCandidate.id]: {
          ...current,
          [tree]: {
            ...current[tree],
            photos: [...currentPhotos, photo],
          },
        },
      };
    });

    sendSyncEvent({
      clientEventId: localEventId(`report-photo-added-${loggedCandidate.id}-${tree}-${photo.id}`),
      type: "report_photo.added",
      entityType: "report_photo",
      entityId: `${loggedCandidate.id}:report:${tree}:${photo.id}`,
      candidateId: loggedCandidate.id,
      payload: {
        candidateId: loggedCandidate.id,
        sectionKey: "report",
        treeId: tree,
        photoId: photo.id,
        name: photo.name,
        type: photo.type,
        size: photo.size,
        hasDataUrl: Boolean(photo.dataUrl),
        description: photo.description ?? "",
        useInReport: photo.useInReport ?? true,
        caption: photo.caption,
        capturedAt,
      },
      createdAt: capturedAt,
    });

    // Store the actual image bytes in the system (local IndexedDB + best-effort
    // Supabase Storage upload), not just the metadata event above.
    persistReportPhotoMedia(loggedCandidate.id, tree, photo, capturedAt);
  }

  async function persistReportPhotoMedia(candidateId, tree, photo, capturedAt) {
    if (!photo?.dataUrl) return;
    let blob;
    try {
      blob = dataUrlToBlob(photo.dataUrl);
    } catch (error) {
      console.warn("Report photo could not be decoded for storage", error);
      return;
    }
    if (!blob || blob.size === 0) return;
    // Deterministic id (NOT localEventId, which appends a timestamp + random suffix): the Centre's
    // report review rebuilds this exact string as `photo-${candidateId}-${tree}-${photoId}` to match
    // an uploaded image back to the draft's metadata-only photo entry (see reportPhotoUrls). A random
    // suffix here uploaded the bytes to durable storage but under an id the Centre could never match,
    // so shared-tablet report photos silently never appeared in review - the same bare key the mobile
    // field-capture flow (ConsultingFieldCapture.handlePhotoFile) already builds.
    const clientMediaId = `photo-${candidateId}-${tree}-${photo.id}`;
    const meta = {
      clientMediaId, type: "photo", mediaType: "photo", candidateId, examinerId: null,
      sectionKey: "report", tree, fileName: photo.name || `${candidateId}_${tree}_${photo.id}.jpg`,
      mimeType: blob.type, sizeBytes: blob.size, durationMs: null, cleaned: false,
      caption: photo.caption ?? "", description: photo.description ?? "",
    };
    await saveLocalMedia({ ...meta, blob, createdAt: capturedAt ?? new Date().toISOString() });
    if (!activeSessionToken) return;
    try {
      const uploaded = await uploadExamMedia(activeSessionToken, meta, blob);
      await updateLocalMedia(clientMediaId, { uploadState: uploaded.stored ? "uploaded" : "local", remoteId: uploaded.id ?? null });
    } catch (error) {
      console.warn("Report photo upload failed; local copy kept", error);
      await updateLocalMedia(clientMediaId, { uploadState: "local" });
    }
  }
  function updateReportPhoto(tree, photoId, updates) {
    if (!loggedCandidate) return;
    setReportDrafts((prev) => {
      const draft = prev[loggedCandidate.id] ?? createReportDraft();
      const currentTree = draft[tree] ?? createReportDraft()[tree];
      const photos = (currentTree.photos ?? []).map((photo) =>
        photo.id === photoId ? { ...photo, ...updates } : photo
      );

      return {
        ...prev,
        [loggedCandidate.id]: {
          ...draft,
          [tree]: {
            ...currentTree,
            photos,
          },
        },
      };
    });
    queue("Report photo updated", `${loggedCandidate.id} ${tree} ${photoId}`);
  }

  // Moves a photo to the other tree's own photo list - e.g. a candidate photographed one tree's
  // detail but had the wrong tab active. The photo itself (id, dataUrl, description, ...) is
  // unchanged; only which tree's report it belongs to changes.
  function moveReportPhoto(fromTree, photoId, toTree) {
    if (!loggedCandidate || fromTree === toTree) return;
    const draftNow = reportDrafts[loggedCandidate.id] ?? createReportDraft();
    const movingPhoto = (draftNow[fromTree]?.photos ?? []).find((p) => p.id === photoId);
    if (!movingPhoto) return;
    // A moved photo gets a fresh id: both trees number their photos from P-1, so keeping the id
    // would collide with the destination's own P-1 - the Centre's dedup-by-id projection would drop
    // the moved photo and React keys would clash locally. The new id also becomes the media key's
    // photo component below, so everything stays consistent under the destination tree.
    const movedId = `${photoId}-mv-${Date.now().toString(36)}`;
    const movedPhoto = { ...movingPhoto, id: movedId };
    const movedAt = new Date().toISOString();

    setReportDrafts((prev) => {
      const draft = prev[loggedCandidate.id] ?? createReportDraft();
      const fromPhotos = draft[fromTree]?.photos ?? [];
      if (!fromPhotos.some((p) => p.id === photoId)) return prev;
      const toPhotos = draft[toTree]?.photos ?? [];
      return {
        ...prev,
        [loggedCandidate.id]: {
          ...draft,
          [fromTree]: { ...draft[fromTree], photos: fromPhotos.filter((p) => p.id !== photoId) },
          [toTree]: { ...draft[toTree], photos: [...toPhotos, movedPhoto] },
        },
      };
    });

    // Tell the server the photo changed trees. Without this the Centre review (which rebuilds the
    // report draft from report_photo.added events alone) keeps showing the photo under its original
    // capture tree, never where the candidate moved it. See the report_photo.moved projection in
    // evaluation-candidate.mjs / evaluation-export.mjs / centre/audit-export.js.
    sendSyncEvent({
      clientEventId: localEventId(`report-photo-moved-${loggedCandidate.id}-${photoId}-${toTree}`),
      type: "report_photo.moved",
      entityType: "report_photo",
      entityId: `${loggedCandidate.id}:report:${toTree}:${movedId}`,
      candidateId: loggedCandidate.id,
      payload: {
        candidateId: loggedCandidate.id, sectionKey: "report",
        photoId, fromTree, toTree, treeId: toTree, newPhotoId: movedId,
        name: movedPhoto.name, caption: movedPhoto.caption ?? "",
        capturedAt: movedPhoto.capturedAt ?? movedAt, movedAt,
      },
      createdAt: movedAt,
    });

    // Re-store the image bytes under the destination-tree + new-id media key so the Centre's
    // reconstructed `photo-${candidateId}-${toTree}-${movedId}` lookup finds the image (the original
    // upload used the source tree + old id, which the moved photo no longer resolves to).
    if (movedPhoto.dataUrl) persistReportPhotoMedia(loggedCandidate.id, toTree, movedPhoto, movedPhoto.capturedAt ?? movedAt);

    queue("Report photo moved", `${loggedCandidate.id} ${photoId} ${fromTree} -> ${toTree}`);
  }

  function submitReport() { if (!loggedCandidate) return; setCandidates((prev) => prev.map((c) => c.id === loggedCandidate.id ? { ...c, status: "Report submitted" } : c)); closeCandidateSection("report"); }

  // --- Examiner outdoor voice recording -----------------------------------
  useEffect(() => {
    if (voiceRecording.status !== "recording" || !voiceRecording.startedAt) return undefined;
    const timer = window.setInterval(() => {
      setVoiceRecording((prev) => (prev.status === "recording" && prev.startedAt ? { ...prev, elapsedMs: Date.now() - prev.startedAt } : prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [voiceRecording.status, voiceRecording.startedAt]);

  // Stop the microphone if the component unmounts mid-recording.
  useEffect(() => () => { voiceRecorderRef.current?.cleanupStream(); }, []);

  // Drain stranded media uploads (e.g. a large voice recording whose first upload failed) on load,
  // when the device comes back online, and periodically while a session is open.
  useEffect(() => {
    if (!activeSessionToken) return undefined;
    retryPendingMediaUploads();
    const onOnline = () => retryPendingMediaUploads();
    window.addEventListener("online", onOnline);
    const id = window.setInterval(() => retryPendingMediaUploads(), 60000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionToken]);

  async function startVoiceRecording() {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    if (!voiceRecordingSupported) {
      setVoiceRecording((prev) => ({ ...prev, status: "error", error: t("voice.error.unsupported") }));
      return;
    }
    if (voiceRecorderRef.current) return;
    try {
      const recorder = new OutdoorVoiceRecorder();
      await recorder.start();
      voiceRecorderRef.current = recorder;
      setVoiceRecording({ status: "recording", candidateId: selectedCandidate.id, startedAt: Date.now(), elapsedMs: 0, error: "", detail: "", lastSaved: null });
      addAudit("Voice recording started", selectedCandidate.name, loggedExaminer.name);
    } catch (error) {
      console.error("Voice recording could not start", error);
      voiceRecorderRef.current = null;
      const message = error?.name === "NotAllowedError" ? t("voice.error.permission") : t("voice.error.start");
      setVoiceRecording((prev) => ({ ...prev, status: "error", error: message }));
    }
  }

  async function finalizeVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return null;
    voiceRecorderRef.current = null;
    const candidateId = voiceRecording.candidateId ?? selectedCandidate.id;
    const candidate = candidates.find((c) => c.id === candidateId) ?? selectedCandidate;
    setVoiceRecording((prev) => ({ ...prev, status: "processing", detail: t("voice.status.processing") }));
    try {
      const result = await recorder.stop();
      if (!result || !result.blob || result.blob.size === 0) {
        setVoiceRecording({ status: "idle", candidateId: null, startedAt: null, elapsedMs: 0, error: "", detail: "", lastSaved: null });
        return null;
      }
      const examinerId = loggedExaminer?.id ?? "E";
      const clientMediaId = localEventId(`voice-${candidateId}-${examinerId}`);
      const ext = result.mimeType.includes("mp4") ? "m4a" : result.mimeType.includes("ogg") ? "ogg" : "webm";
      const fileName = `outdoor_${candidateId}_${examinerId}_${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      // exam_id scopes the recording to this certification at the Centre alongside candidate_id, so
      // the media list finds it even if the roster read misses (see media-list scoping).
      const examId = centreExamIdFromScope(getActiveExamScope()) || getActiveExamScope() || null;
      const meta = {
        clientMediaId, type: "audio", mediaType: "audio", candidateId, examinerId: loggedExaminer?.id ?? null,
        examId, sectionKey: "outdoor", fileName, mimeType: result.mimeType, sizeBytes: result.blob.size,
        durationMs: result.durationMs, cleaned: true, caption: `${candidate?.name ?? candidateId} — outdoor`,
        // Wall-clock time the recording actually started (not when it was uploaded/finalized) -
        // lets the Centre later line up an outdoor question's own score-save timestamp against
        // roughly where in the recording it was answered (see media-list.mjs's recordingStartedAt
        // and OutdoorAiNotePanel's offset calculation). No per-word precision, but real data
        // instead of the placeholder paragraph indices a manual transcript alone can offer.
        payload: { recordingStartedAt: voiceRecording.startedAt ? new Date(voiceRecording.startedAt).toISOString() : null },
      };
      // Offline-first: always keep a local copy first.
      await saveLocalMedia({ ...meta, blob: result.blob });
      addAudit("Voice recording saved", candidate?.name ?? candidateId, `${Math.round(result.durationMs / 1000)} s / ${(result.blob.size / 1048576).toFixed(1)} MB`);
      // Best-effort upload to Supabase Storage.
      let uploadState = "local";
      if (activeSessionToken) {
        try {
          const uploaded = await uploadExamMedia(activeSessionToken, meta, result.blob);
          uploadState = uploaded.stored ? "uploaded" : "local";
          await updateLocalMedia(clientMediaId, { uploadState, remoteId: uploaded.id ?? null });
        } catch (error) {
          console.warn("Voice recording upload failed; local copy kept, will retry", error);
          await updateLocalMedia(clientMediaId, { uploadState: "local" });
        }
      }
      setVoiceRecording({ status: "saved", candidateId: null, startedAt: null, elapsedMs: 0, error: "", detail: uploadState === "uploaded" ? t("voice.status.uploaded") : t("voice.status.savedLocal"), lastSaved: { clientMediaId, fileName, uploadState } });
      return { clientMediaId, fileName, uploadState };
    } catch (error) {
      console.error("Voice recording finalize failed", error);
      setVoiceRecording((prev) => ({ ...prev, status: "error", detail: "", error: t("voice.error.save") }));
      return null;
    }
  }

  // Large voice recordings can fail their first upload (a flaky field connection, a slow PUT); the
  // bytes then sit only in this tablet's IndexedDB and the Centre never sees them. Re-push anything
  // still marked non-"uploaded" whenever there is a session and we are online.
  async function retryPendingMediaUploads() {
    if (mediaRetryBusyRef.current || !activeSessionToken) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    mediaRetryBusyRef.current = true;
    try {
      const records = await listLocalMedia();
      const pending = (records || []).filter((record) => record.uploadState !== "uploaded" && record.clientMediaId);
      for (const record of pending) {
        const full = await getLocalMedia(record.clientMediaId);
        if (!full?.blob) continue;
        const { blob, uploadState, remoteId, id, lastError, lastErrorAt, ...meta } = full;
        try {
          const uploaded = await uploadExamMedia(activeSessionToken, meta, blob);
          if (uploaded.stored) await updateLocalMedia(record.clientMediaId, { uploadState: "uploaded", remoteId: uploaded.id ?? null, lastError: null });
        } catch (error) {
          console.warn("Pending media upload retry failed; will try again later", record.clientMediaId, error);
          // Recorded so ExaminerLocalMediaPanel can show the real reason (expired session vs.
          // storage limit vs. a dropped connection) instead of nothing — this loop runs silently
          // every 60s, so a manual "Upload now" click may not be the attempt that actually failed.
          // error.message for a plain network failure is a raw, untranslated engine string (e.g.
          // Safari's fetch() throws "TypeError: Load failed" for a connection dropped mid-upload,
          // which the file DOES sometimes still land from - see uploadMediaBytes' own retry) and is
          // not useful to show an examiner, so it is never used here — see examinerUploadErrorText
          // for why a raw error.reason isn't always safe to show either.
          await updateLocalMedia(record.clientMediaId, { lastError: examinerUploadErrorText(error, t), lastErrorAt: new Date().toISOString() });
        }
      }
    } catch (error) {
      console.warn("Could not scan local media for retry", error);
    } finally {
      mediaRetryBusyRef.current = false;
    }
  }

  function pauseVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder || voiceRecording.status !== "recording") return;
    if (recorder.pause()) {
      // Freeze the clock at the elapsed-so-far; the paused span is excluded from the final duration.
      setVoiceRecording((prev) => ({ ...prev, status: "paused", elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : prev.elapsedMs, detail: t("voice.status.paused") }));
      addAudit("Voice recording paused", selectedCandidate?.name ?? "", loggedExaminer?.name ?? "");
    }
  }
  function resumeVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder || voiceRecording.status !== "paused") return;
    if (recorder.resume()) {
      // Re-anchor startedAt so the ticker continues from where it froze (pause time not counted).
      setVoiceRecording((prev) => ({ ...prev, status: "recording", startedAt: Date.now() - (prev.elapsedMs || 0), detail: "" }));
    }
  }
  // Poll target for the live histogram (returns 0..1 bar heights while recording).
  function voiceLevelBins() {
    return voiceRecorderRef.current?.getFrequencyBins?.() ?? [];
  }

  function toggleVoiceRecording() {
    if (voiceRecording.status === "recording" || voiceRecording.status === "paused") finalizeVoiceRecording();
    else startVoiceRecording();
  }
  function loginExaminer(id) { setLoggedExaminerId(id); setActiveExaminerPage("landing"); const first = candidates.find((c) => [assignments[c.id]?.primary, assignments[c.id]?.secondary].includes(id)); if (first) setSelectedCandidateId(first.id); addAudit("Examiner logged in", examiners.find((e) => e.id === id)?.name ?? id, "QR accepted"); }
  function confirmExaminer() { if (!loggedExaminer) return; setExaminerConfirmed((prev) => ({ ...prev, [loggedExaminer.id]: true })); addAudit("Examiner identity confirmed", loggedExaminer.name, loggedExaminer.registrationId); }
  function setPrimary(candidateId, examinerId, primary) { setAssignments((prev) => { const current = prev[candidateId] ?? {}; return { ...prev, [candidateId]: primary ? { primary: examinerId, secondary: current.primary && current.primary !== examinerId ? current.primary : current.secondary } : { ...current, secondary: examinerId, primary: current.primary === examinerId ? current.secondary : current.primary } }; }); }
  async function openOutdoor(candidateId) {
    const c = candidates.find((x) => x.id === candidateId);
    if (!c || !loggedExaminer) return;
    const assignment = assignments[candidateId] ?? {};
    const mode = assignment.primary === loggedExaminer.id ? "primary" : assignment.secondary === loggedExaminer.id ? "secondary" : "unassigned";
    if (mode === "unassigned") return;
    const prior = examinerTimes[loggedExaminer.id]?.[candidateId]?.outdoor;
    if (prior?.closedAt && !confirmedReopenAllowed(t("examiner.reopenLabel.outdoor"), t)) return;
    const openedAt = nowStamp();
    const openedAtIso = new Date().toISOString();
    let outdoorBankForOpen = outdoorItemsByLevel;
    const needsActiveOutdoor =
      !hasRuntimeOutdoorLevel(outdoorBankForOpen?.[c.level]) ||
      isHardcodedOutdoorFallbackLevel(c.level, outdoorBankForOpen?.[c.level]);

    if (needsActiveOutdoor) {
      try {
        const response = await fetch("/api/centre/test-package/active", { cache: "no-store" });
        const data = await response.json();

        if (response.ok) {
          const normalized = normalizeAdminOutdoorPackage(data);

          if (hasRuntimeOutdoorLevel(normalized?.[c.level])) {
            outdoorBankForOpen = normalized;
            setOutdoorItemsByLevel(normalized);
            setActiveAdminPackageMeta(activePackageRuntimeMeta(data));
          }
        }
      } catch (error) {
        console.warn("Active Admin outdoor package could not be loaded before opening outdoor form", error);
      }
    }

    setSelectedCandidateId(candidateId);
    setActiveOutdoorSection(effectiveOutdoorSectionsForLevel(outdoorBankForOpen, c.level)[0] ?? "generic");
    setActiveExaminerPage("outdoor");
    setExaminerTimes((prev) => ({ ...prev, [loggedExaminer.id]: { ...(prev[loggedExaminer.id] ?? {}), [candidateId]: { ...(prev[loggedExaminer.id]?.[candidateId] ?? {}), outdoor: { openedAt, openedAtIso, closedAt: null, closedAtIso: null } } } }));
    addAudit("Outdoor form opened", c.name, `${loggedExaminer.name} / ${openedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`outdoor-assessment-opened-${candidateId}-${loggedExaminer.id}`), type: "outdoor_assessment.opened", entityType: "outdoor_assessment", entityId: `${candidateId}:outdoor`, candidateId, payload: { candidateId, examinerId: loggedExaminer.id, mode, role: mode, sectionKey: "outdoor", openedAt: openedAtIso, openedAtLabel: openedAt }, createdAt: openedAtIso });
    hydrateOutdoorProgress(activeSessionToken, loggedExaminer.id, candidateId);
  }
  function openExaminerWrittenReview(candidateId) {
    if (loggedExaminer && examinerTimes[loggedExaminer.id]?.[candidateId]?.written?.closedAt && !confirmedReopenAllowed(t("examiner.reopenLabel.writtenReview"), t)) return;
    setSelectedCandidateId(candidateId);
    setActiveExaminerPage("writtenReview");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function openExaminerReportReview(candidateId) {
    if (loggedExaminer && examinerTimes[loggedExaminer.id]?.[candidateId]?.report?.closedAt && !confirmedReopenAllowed(t("examiner.reopenLabel.reportReview"), t)) return;
    setSelectedCandidateId(candidateId);
    setActiveExaminerPage("reportReview");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function updateOutdoor(itemId, value) {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const items = Object.values(effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level)).flat();
    const item = items.find((x) => x.id === itemId);
    const points = clampHalfPointScore(value, item?.max ?? 0);
    const updatedAt = new Date().toISOString();
    setOutdoor((prev) => ({ ...prev, [selectedCandidate.id]: { ...(prev[selectedCandidate.id] ?? {}), [itemId]: points } }));
    queue("Outdoor assessment", `${selectedCandidate.name} / ${itemId}`);
    // Each per-item save upserts the SAME outdoor_scores row (on_conflict candidate/examiner/
    // item), which REPLACES its whole payload — so a save that only sends the field it changed
    // would silently wipe out whichever of the other two (score/note/sketch) was saved earlier.
    // Every save resends the other two from current state to stay non-destructive.
    const note = outdoorNotes[selectedCandidate.id]?.[itemId] ?? null;
    const noteDrawing = outdoorNoteDrawings[selectedCandidate.id]?.[itemId] ?? null;
    sendSyncEvent({ clientEventId: localEventId(`outdoor-score-saved-${selectedCandidate.id}-${loggedExaminer.id}-${itemId}`), type: "outdoor_score.saved", entityType: "outdoor_score", entityId: `${selectedCandidate.id}:${itemId}`, candidateId: selectedCandidate.id, payload: { candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, sectionKey: activeOutdoorSection, itemId, score: points, note, comment: note, noteDrawing, updatedAt }, createdAt: updatedAt });
  }

  function updateOutdoorNote(itemId, note) {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const updatedAt = new Date().toISOString();
    const currentScore = outdoor[selectedCandidate.id]?.[itemId] ?? null;
    const currentDrawing = outdoorNoteDrawings[selectedCandidate.id]?.[itemId] ?? null;

    setOutdoorNotes((prev) => ({
      ...prev,
      [selectedCandidate.id]: {
        ...(prev[selectedCandidate.id] ?? {}),
        [itemId]: note,
      },
    }));

    queue("Outdoor note", `${selectedCandidate.name} / ${itemId}`);
    sendSyncEvent({
      clientEventId: localEventId(`outdoor-score-note-saved-${selectedCandidate.id}-${loggedExaminer.id}-${itemId}`),
      type: "outdoor_score.saved",
      entityType: "outdoor_score",
      entityId: `${selectedCandidate.id}:${itemId}`,
      candidateId: selectedCandidate.id,
      payload: {
        candidateId: selectedCandidate.id,
        examinerId: loggedExaminer.id,
        mode: selectedMode,
        role: selectedMode,
        sectionKey: activeOutdoorSection,
        itemId,
        score: currentScore,
        note,
        comment: note,
        noteDrawing: currentDrawing,
        updatedAt,
      },
      createdAt: updatedAt,
    });
  }

  // Examiner's handwritten sketch for an outdoor item (e.g. a quick tree diagram), stored
  // alongside the typed note. Used to only travel in the final outdoor_assessment.submitted
  // payload — but outdoorNoteDrawings is plain in-memory state, so a sketch drawn hours before
  // final submit (a real span on an outdoor exam) was gone without a trace if the tablet
  // reloaded or lost power before then, with nothing in the Centre's review to show for it. Now
  // synced the same way a score or note already was: immediately, per item.
  async function updateOutdoorNoteDrawing(itemId, dataUrl) {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    // Compress on the way in, so both localStorage and the submit payload stay small. Clearing a
    // sketch passes an empty string, which must not be run through the compressor.
    const stored = dataUrl ? await compressImageToDataUrl(dataUrl, { maxBytes: 150_000, maxDim: 1400 }) : dataUrl;
    setOutdoorNoteDrawings((prev) => ({
      ...prev,
      [selectedCandidate.id]: {
        ...(prev[selectedCandidate.id] ?? {}),
        [itemId]: stored,
      },
    }));
    queue("Outdoor note sketch", `${selectedCandidate.name} / ${itemId}`);
    const updatedAt = new Date().toISOString();
    const currentScore = outdoor[selectedCandidate.id]?.[itemId] ?? null;
    const currentNote = outdoorNotes[selectedCandidate.id]?.[itemId] ?? null;
    sendSyncEvent({
      clientEventId: localEventId(`outdoor-score-sketch-saved-${selectedCandidate.id}-${loggedExaminer.id}-${itemId}-${updatedAt}`),
      type: "outdoor_score.saved",
      entityType: "outdoor_score",
      entityId: `${selectedCandidate.id}:${itemId}`,
      candidateId: selectedCandidate.id,
      payload: {
        candidateId: selectedCandidate.id,
        examinerId: loggedExaminer.id,
        mode: selectedMode,
        role: selectedMode,
        sectionKey: activeOutdoorSection,
        itemId,
        score: currentScore,
        note: currentNote,
        comment: currentNote,
        noteDrawing: stored,
        updatedAt,
      },
      createdAt: updatedAt,
    });
  }

  // Even compressed, a full set of sketches can exceed the request cap, and a 413 loses the whole
  // assessment. Shrink them further in steps until the encoded body fits, so the submission always
  // gets through — degraded sketches beat a failed submit.
  async function boundedOutdoorSubmitPayload(basePayload) {
    const budgets = [null, 90_000, 45_000, 20_000];
    let last = basePayload;
    for (const maxBytes of budgets) {
      let payload = basePayload;
      if (maxBytes) {
        const entries = await Promise.all(Object.entries(basePayload.noteDrawings || {}).map(async ([itemId, url]) => (
          url ? [itemId, await compressImageToDataUrl(url, { maxBytes, maxDim: maxBytes > 50_000 ? 1100 : 800 })] : [itemId, url]
        )));
        payload = { ...basePayload, noteDrawings: Object.fromEntries(entries) };
      }
      last = payload;
      if (new Blob([JSON.stringify(payload)]).size <= 3_500_000) return payload;
    }
    return last;
  }

  function updateOutdoorExamSummary(text) {
    // Only the PRIMARY examiner writes the closing summary (the secondary's input is supporting).
    if (!loggedExaminer || selectedMode !== "primary") return;
    setOutdoorExamSummaries((prev) => ({ ...prev, [selectedCandidate.id]: text }));
  }

  function outdoorTotal(candidateId, level, section) {
    const values = outdoor[candidateId] ?? {};
    return (effectiveOutdoorItemsForLevel(outdoorItemsByLevel, level)?.[section] ?? []).reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0);
  }

  function outdoorMax(level, section) {
    return (effectiveOutdoorItemsForLevel(outdoorItemsByLevel, level)?.[section] ?? []).reduce((sum, item) => sum + Number(item.max ?? 0), 0);
  }

  async function submitOutdoor() {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const values = outdoor[selectedCandidate.id] ?? {};
    // Only the chosen variant of each either/or exercise counts toward the score and the max.
    const levelItemsMap = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level) ?? {};
    const sectionKeys = Object.keys(levelItemsMap);
    const choiceForCandidate = outdoorVariantChoice[selectedCandidate.id];
    const items = sectionKeys
      .filter((section) => !outdoorSectionExcluded(sectionKeys, choiceForCandidate, section))
      .flatMap((section) => levelItemsMap[section] ?? []);
    const total = items.reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0);
    const max = items.reduce((sum, item) => sum + Number(item.max ?? 0), 0) || activeScoreLimits.outdoorMax;
    const closedAt = nowStamp();
    const submittedAt = new Date().toISOString();
    const cappedTotal = Math.min(total, max);
    const ok = window.confirm(tf("outdoor.submitCloseConfirm", { name: selectedCandidate.name, total: cappedTotal, max }));
    if (!ok) return;
    setCandidates((prev) => prev.map((c) => c.id === selectedCandidate.id ? { ...c, outdoor: cappedTotal, status: "Outdoor submitted" } : c));
    const outdoorResultRecord = {
      candidateId: selectedCandidate.id,
      candidateName: selectedCandidate.name,
      level: selectedCandidate.level,
      examinerId: loggedExaminer.id,
      examinerName: loggedExaminer.name,
      mode: selectedMode,
      role: selectedMode,
      total: cappedTotal,
      value: cappedTotal,
      max,
      scores: values,
      notes: outdoorNotes[selectedCandidate.id] ?? {},
      noteDrawings: outdoorNoteDrawings[selectedCandidate.id] ?? {},
      examSummary: outdoorExamSummaries[selectedCandidate.id] ?? "",
      submittedAt,
      closedAt,
      closed: true,
      field: "outdoor",
      updatedAt: submittedAt,
    };
    writeOutdoorCentreResult(outdoorResultRecord);
    saveExaminerResultToLocalServer(outdoorResultRecord);
    setExaminerTimes((prev) => ({ ...prev, [loggedExaminer.id]: { ...(prev[loggedExaminer.id] ?? {}), [selectedCandidate.id]: { ...(prev[loggedExaminer.id]?.[selectedCandidate.id] ?? {}), outdoor: { ...(prev[loggedExaminer.id]?.[selectedCandidate.id]?.outdoor ?? {}), closedAt, closedAtIso: submittedAt } } } }));
    addAudit("Outdoor assessment submitted", selectedCandidate.name, `${total} points / ${closedAt}`);
    const outdoorSubmitPayload = await boundedOutdoorSubmitPayload({ candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, sectionKey: "outdoor", submittedAt, closedAtLabel: closedAt, total: cappedTotal, max, scores: values, notes: outdoorNotes[selectedCandidate.id] ?? {}, noteDrawings: outdoorNoteDrawings[selectedCandidate.id] ?? {}, examSummary: outdoorExamSummaries[selectedCandidate.id] ?? "" });
    sendSyncEvent({ clientEventId: localEventId(`outdoor-assessment-submitted-${selectedCandidate.id}-${loggedExaminer.id}`), type: "outdoor_assessment.submitted", entityType: "outdoor_assessment", entityId: `${selectedCandidate.id}:outdoor`, candidateId: selectedCandidate.id, payload: outdoorSubmitPayload, createdAt: submittedAt });
    // Closing the section automatically finalizes (cleans + stores) any running voice recording.
    if (voiceRecorderRef.current) await finalizeVoiceRecording();
    setActiveExaminerPage("landing");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }
  function archivePlan(files) {
    if (!loggedExaminer || selectedCandidate.level !== "Practicing") return;
    const fileList = Array.from(files ?? []);
    if (!fileList.length) return;
    fileList.forEach(async (file) => {
      const dataUrl = await compressImageToDataUrl(file);
      setPracticingArchive((prev) => ({
        ...prev,
        [selectedCandidate.id]: [...(prev[selectedCandidate.id] ?? []), {
          id: `MP-${(prev[selectedCandidate.id] ?? []).length + 1}`,
          capturedBy: loggedExaminer.name,
          capturedAt: new Date().toISOString(),
          name: file.name || `management-plan-${Date.now()}.jpg`,
          dataUrl,
        }],
      }));
    });
  }
  function updateScore(field, value, options = {}) {
    const limits = activeScoreLimits;
    const max = limits?.[`${field}Max`] ?? scoreLimits(selectedCandidate.level)?.[`${field}Max`] ?? 0;
    const numericValue = value === "" ? null : Math.min(Math.max(Number(value), 0), max);
    const updatedAt = new Date().toISOString();
    const closedAt = options.closed ? nowStamp() : null;

    setCandidates((prev) => prev.map((c) => {
      const rowLimits = c.id === selectedCandidate.id ? limits : scoreLimitsForCandidate(c, variants, testBank, outdoorItemsByLevel);
      const rowMax = rowLimits?.[`${field}Max`] ?? max;
      const rowValue = value === "" ? null : Math.min(Math.max(Number(value), 0), rowMax);
      return c.id === selectedCandidate.id ? { ...c, [field]: rowValue, status: options.closed ? `${field} submitted` : "In evaluation" } : c;
    }));

    if (loggedExaminer && selectedCandidate?.id) {
      const examinerScoreRecord = {
        candidateId: selectedCandidate.id,
        candidateName: selectedCandidate.name,
        level: selectedCandidate.level,
        examinerId: loggedExaminer.id,
        examinerName: loggedExaminer.name,
        role: selectedMode,
        mode: selectedMode,
        field,
        value: numericValue,
        max,
        closed: Boolean(options.closed),
        closedAt,
        submittedAt: options.closed ? updatedAt : null,
        updatedAt,
      };
      // Local/LAN copy (offline runtime) …
      saveExaminerResultToLocalServer(examinerScoreRecord);
      // … PLUS the backend sync event, so the examiner's written/report score reaches the Centre
      // over Supabase (the Centre runs on another device and reads it back via the evaluation
      // read-model into Section E). Without this the score only ever lived on this tablet.
      sendSyncEvent({
        clientEventId: localEventId(`examiner-score-saved-${selectedCandidate.id}-${loggedExaminer.id}-${field}`),
        type: "examiner_score.saved",
        entityType: "examiner_score",
        entityId: `${selectedCandidate.id}:${field}`,
        candidateId: selectedCandidate.id,
        payload: { candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, field, value: numericValue, max, closed: Boolean(options.closed), closedAt, submittedAt: options.closed ? updatedAt : null, updatedAt },
        createdAt: updatedAt,
      });
    }

    if (options.closed && loggedExaminer && selectedCandidate?.id) {
      setExaminerTimes((prev) => ({
        ...prev,
        [loggedExaminer.id]: {
          ...(prev[loggedExaminer.id] ?? {}),
          [selectedCandidate.id]: {
            ...(prev[loggedExaminer.id]?.[selectedCandidate.id] ?? {}),
            [field]: { ...(prev[loggedExaminer.id]?.[selectedCandidate.id]?.[field] ?? {}), closedAt, closedAtIso: updatedAt },
          },
        },
      }));
      setActiveExaminerPage("landing");
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
    }
  }
  const centreDataMode = centreSetupStatus || centreQrAccess?.candidates?.length || centreQrAccess?.examiners?.length ? "backend" : "demo";

  if (runtimeError) return <RuntimeCrashScreen error={runtimeError} />;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-7xl">
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div className="flex items-start gap-4"><img src="/brand/vetcert-logo.jpg" alt="VETcert Certified Veteran Tree Specialist" className="h-14 w-14 shrink-0 rounded-full border bg-white object-contain p-1 shadow-sm md:h-16 md:w-16" /><div><div className="mb-2 flex flex-wrap items-center gap-2"><div className="rounded-2xl bg-slate-950 px-3 py-1 text-sm font-semibold text-white">{t("app.title")}</div></div><h1 className="text-3xl font-bold tracking-tight md:text-5xl">{t("app.heroTitle")}</h1><p className="mt-2 max-w-3xl text-slate-600">{t("app.subtitle")}</p></div></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-medium text-slate-500">{t("language.label")}<select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value)} className="ml-2 rounded-xl border bg-white p-2 text-sm text-slate-950">{uiLanguageChoices.map((lang) => <option key={lang.code} value={lang.code}>{lang.draft ? `${lang.label} - draft` : lang.label}</option>)}</select></label>{lockedPortalRole ? null : role === "Admin" ? <StatusPill tone="good">Admin</StatusPill> : ROLES.map((r) => <Button key={r} onClick={() => setRole(r)} variant={role === r ? "default" : "outline"} className="rounded-2xl">{roleLabel(r)}</Button>)}</div></header>
    {draftPreviewActive && <div role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950 shadow-sm">{t("language.draftPreviewWarning")}</div>}
    {accessError && <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-950 shadow-sm"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><div>{accessError}</div><div className="mt-1 font-normal">{t("access.error.help")}</div></div></div>}
    <div className="grid gap-4 lg:grid-cols-3">
      {role === "Admin" && <div className="lg:col-span-3"><AdminLoginGate t={t} addAudit={addAudit}><AdminView centre={centre} setCentre={setCentre} examDate={examDate} setExamDate={setExamDate} place={place} setPlace={setPlace} language={language} setLanguage={setLanguage} availableVariants={availableVariants} variants={variants} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} importTestPackage={importTestPackage} setStatus={setStatus} addAudit={addAudit} uiLanguage={uiLanguage} t={t}  adminPdfPackageLatest={adminPdfPackageLatest} setAdminPdfPackageStatus={setAdminPdfPackageStatus} setAdminPdfPackageError={setAdminPdfPackageError} setAdminPdfPackageLatest={setAdminPdfPackageLatest} /></AdminLoginGate></div>}
      {role === "Centre" && <CentreView centreUnlocked={centreUnlocked} centreCode={centreCode} setCentreCode={setCentreCode} centreExamId={centreExamId} unlockCentre={unlockCentre} enabledLevels={enabledLevels} toggleLevel={toggleLevel} language={language} availableVariants={availableVariants} variants={variants} setVariants={setVariants} setAvailableVariants={setAvailableVariants} testBank={testBank} setTestBank={setTestBank} setTestImportSummary={setTestImportSummary} outdoorItemsByLevel={outdoorItemsByLevel} setOutdoorItemsByLevel={setOutdoorItemsByLevel} activeAdminPackageMeta={activeAdminPackageMeta} setActiveAdminPackageMeta={setActiveAdminPackageMeta} importTestPackage={importTestPackage} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} candidates={candidates} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} addCandidate={addCandidate} updateCandidate={updateCandidate} assignments={assignments} setAssignments={setAssignments} examiners={examiners} candidateQrFor={(id) => payload("Candidate", id)} examinerQrFor={(id) => payload("Examiner", id)} centreSetupLoading={centreSetupLoading} centreSetupSaving={centreSetupSaving} centreSetupError={centreSetupError} centreSetupStatus={centreSetupStatus} centreAuditExportLoading={centreAuditExportLoading} centreAuditExportError={centreAuditExportError} centreQrAccess={centreQrAccess} centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} setCentreSetupDirty={setCentreSetupDirty} harmonogramSettings={harmonogramSettings} setHarmonogramSettings={setHarmonogramSettings} dataMode={centreDataMode} activeSessionToken={activeSessionToken} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} setTestResponses={setTestResponses} reportDrafts={reportDrafts} outdoor={outdoor} outdoorByExaminer={outdoorByExaminer} applyOutdoorCorrection={applyOutdoorCorrection} applyScanGrading={applyScanGrading} writtenScoresByExaminer={writtenScoresByExaminer} reportMarksByExaminer={reportMarksByExaminer} applyWrittenCorrection={applyWrittenCorrection} applyReportCorrection={applyReportCorrection} outdoorNotes={outdoorNotes} audit={audit} examDate={examDate} place={place} handleLoadCentreSetup={handleLoadCentreSetup} handleSaveCentreSetup={handleSaveCentreSetup} handleDownloadCentreAuditPackage={handleDownloadCentreAuditPackage} updateExaminer={updateExaminer} addExaminer={addExaminer} removeCandidate={removeCandidate} removeExaminer={removeExaminer} addAudit={addAudit} t={t} />}
      {role === "Candidate" && <CandidateView candidates={candidates} examiners={examiners} harmonogramSettings={harmonogramSettings} loggedCandidate={loggedCandidate} confirmed={loggedCandidate ? candidateConfirmed[loggedCandidate.id] : false} loginCandidate={loginCandidate} logoutCandidate={() => setLoggedCandidateId(null)} confirmCandidate={confirmCandidate} unconfirmCandidate={unconfirmCandidate} resendCandidateData={resendCandidateData} sections={loggedCandidate ? CANDIDATE_SECTIONS[loggedCandidate.level] : []} sectionStatus={loggedCandidate ? candidateStatus[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level) : {}} sectionTimes={loggedCandidate ? candidateTimes[loggedCandidate.id] ?? {} : {}} sectionTone={sectionTone} openSection={openCandidateSection} activeSection={activeCandidateSection} setActiveSection={setActiveCandidateSection} testResponses={testResponses} updateTest={updateTest} submitTest={submitTest} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} updateReportPhoto={updateReportPhoto} moveReportPhoto={moveReportPhoto} submitReport={submitReport} variants={variants} testBank={testBank} activeAdminPackageMeta={activeAdminPackageMeta} outdoorItemsByLevel={outdoorItemsByLevel} qrFor={(id) => payload("Candidate", id)} setScannerMode={setScannerMode} setScannerReentry={setScannerReentry} activeSessionToken={activeSessionToken} sendSyncEvent={sendSyncEvent} localEventId={localEventId} t={t} />}
      {role === "Examiner" && <ExaminerView examiners={examiners} loggedExaminer={loggedExaminer} confirmed={loggedExaminer ? examinerConfirmed[loggedExaminer.id] : false} loginExaminer={loginExaminer} logoutExaminer={() => setLoggedExaminerId(null)} confirmExaminer={confirmExaminer} assignedCandidates={assignedCandidates} assignments={assignments} setPrimary={setPrimary} activePage={activeExaminerPage} setActivePage={setActiveExaminerPage} openOutdoor={openOutdoor} openWrittenReview={openExaminerWrittenReview} openReportReview={openExaminerReportReview} selectedCandidate={selectedCandidate} setSelectedCandidateId={setSelectedCandidateId} selectedMode={selectedMode} activeOutdoorSection={activeOutdoorSection} setActiveOutdoorSection={setActiveOutdoorSection} outdoor={outdoor} outdoorNotes={outdoorNotes} outdoorNoteDrawings={outdoorNoteDrawings} outdoorVariantChoice={outdoorVariantChoice} setOutdoorVariantChoice={setOutdoorVariantChoice} outdoorExamSummaries={outdoorExamSummaries} updateOutdoorExamSummary={updateOutdoorExamSummary} outdoorItemsByLevel={outdoorItemsByLevel} setOutdoorItemsByLevel={setOutdoorItemsByLevel} updateOutdoor={updateOutdoor} updateOutdoorNote={updateOutdoorNote} updateOutdoorNoteDrawing={updateOutdoorNoteDrawing} outdoorTotal={outdoorTotal} outdoorMax={outdoorMax} submitOutdoor={submitOutdoor} voiceRecording={voiceRecording} toggleVoiceRecording={toggleVoiceRecording} pauseVoiceRecording={pauseVoiceRecording} resumeVoiceRecording={resumeVoiceRecording} getVoiceLevels={voiceLevelBins} voiceRecordingSupported={voiceRecordingSupported} archivePlan={archivePlan} practicingArchive={practicingArchive} activeScoreLimits={activeScoreLimits} updateScore={updateScore} variants={variants} testBank={testBank} testResponses={testResponses} reportDrafts={reportDrafts} importedCandidatePackages={importedCandidatePackages} setImportedCandidatePackages={setImportedCandidatePackages} qrFor={(id) => payload("Examiner", id)} setScannerMode={setScannerMode} setScannerReentry={setScannerReentry} importOfflineCandidatePackageFile={importOfflineCandidatePackageFile} importOfflineCandidatePackageData={importOfflineCandidatePackageData} examinerTimes={loggedExaminer ? examinerTimes[loggedExaminer.id] ?? {} : {}} activeAdminPackageMeta={activeAdminPackageMeta} activeSessionToken={activeSessionToken} onReportMarked={applyReportMarking} t={t} />}
      {role === "Centre" && <AuditSyncView audit={audit} candidates={candidates} examiners={examiners} CloudOff={CloudOff} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} Card={Card} CardContent={CardContent} t={t} />}
    </div>
    {scannerMode && <QrScannerPanel title={scannerReentry ? t("qrScanner.reentryTitle") : tf("qrScanner.scan", { role: roleLabel(scannerMode) })} onScan={handleQrScan} onClose={() => { setScannerMode(null); setScannerReentry(false); }} t={t} />}
    {reopenRequest && <ReopenSectionModal sectionKey={reopenRequest.key} error={reopenRequest.error} onConfirm={confirmReopenRequest} onCancel={() => setReopenRequest(null)} t={t} />}
    {qrPinChallenge && (
      <QrPinModal
        mode="enter"
        wrongPin={qrPinChallenge.wrongPin}
        onSubmit={(pin) => { const resolve = qrPinChallenge.resolve; setQrPinChallenge(null); resolve(pin); }}
        onCancel={() => { const resolve = qrPinChallenge.resolve; setQrPinChallenge(null); resolve(null); }}
        t={t}
      />
    )}
    {qrSetPinPrompt && (
      <QrPinModal
        mode="set"
        onSubmit={async (pin) => {
          try { await setQrPin(qrSetPinPrompt.sessionToken, pin); } catch (error) { console.warn("Setting QR PIN failed", error); }
          setQrSetPinPrompt(null);
        }}
        onCancel={() => setQrSetPinPrompt(null)}
        t={t}
      />
    )}
  </div></main>;
}

// Two roles, one dialog: "enter" is shown to a device the token doesn't recognise yet (once a PIN
// is set), "set" is shown once, right after the very FIRST device ever resolves a token. onSubmit
// resolving is what unblocks resolveAccessWithFallback's retry loop for "enter" mode.
function QrPinModal({ mode, wrongPin, onSubmit, onCancel, t }) {
  const [value, setValue] = useState("");
  const isSet = mode === "set";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5">
        <h3 className="text-lg font-bold">{isSet ? t("qr.pin.setTitle") : t("qr.pin.enterTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{isSet ? t("qr.pin.setHelper") : t("qr.pin.enterHelper")}</p>
        {!isSet && wrongPin && <p className="mt-2 text-sm font-semibold text-rose-700">{t("qr.pin.wrong")}</p>}
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder={isSet ? t("qr.pin.setPlaceholder") : t("qr.pin.enterPlaceholder")}
          className="mt-4 w-full rounded-xl border p-3 text-center text-2xl font-bold tracking-[0.3em]"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {isSet && <Button onClick={onCancel} variant="outline" className="rounded-2xl">{t("qr.pin.setSkip")}</Button>}
          {!isSet && <Button onClick={onCancel} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>}
          <Button
            onClick={() => onSubmit(value)}
            disabled={isSet ? value.length < 4 : !value}
            className="rounded-2xl"
          >
            {isSet ? t("qr.pin.setConfirm") : t("qr.pin.enterConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Titles use a translated key, but "AUTHORING_DOCS" itself is a plain module-level array (no t()
// available at module scope), so the doc list holds a translation KEY here; components resolve it
// via authoringDocTitle(t, doc) below.
const AUTHORING_DOCS = [
  { key: "writtenPracticing", level: "Practicing", kind: "written", titleKey: "authoringDocs.writtenPracticing" },
  { key: "writtenConsulting", level: "Consulting", kind: "written", titleKey: "authoringDocs.writtenConsulting" },
  { key: "outdoorPracticing", level: "Practicing", kind: "outdoor", titleKey: "authoringDocs.outdoorPracticing" },
  { key: "outdoorConsulting", level: "Consulting", kind: "outdoor", titleKey: "authoringDocs.outdoorConsulting" },
];
function authoringDocTitle(t, doc) {
  return doc?.titleKey ? t(doc.titleKey) : (doc?.title || "");
}


const AUTHORING_DOCUMENT_DEFAULTS = {
  writtenPracticing: {
    preface: "Section A contains multiple choice questions. Section B contains written-answer questions grouped into themes. Each question carries the stated number of marks.",
    candidateIntro: "Choose the best answer for multiple-choice questions and answer all written questions as fully as possible.",
  },
  writtenConsulting: {
    preface: "This written exam paper contains questions requiring written answers. Questions are grouped into themes and each question carries the stated number of marks.",
    candidateIntro: "Answer all questions. Provide concise technical answers and include examples where the question asks for them.",
  },
  outdoorPracticing: {
    preface: "Practising level outdoor exercises. Examiner copy. The paper includes generic oral questions and tree-based exercises; the section and mark structure is edited here as the source of truth.",
    candidateIntro: "The outdoor session lasts approximately 120 minutes. Candidates should attempt all questions and follow examiner instructions at each tree.",
  },
  outdoorConsulting: {
    preface: "Consulting level outdoor exercises including oral questions. Examiner copy. Generic questions and tree/site exercises are edited here as the source of truth.",
    candidateIntro: "Candidates have 120 minutes to complete the exercises and answer oral questions. Most oral questions are mandatory; some follow-up questions are asked only when triggered by the candidate's answer.",
  },
};

// English default document titles, used only to seed a brand-new document's editable "title"
// field (see AdminStructuredPackagePanel's "Document name" input) — not rendered as fixed UI
// chrome itself, so it does not need t() here.
const AUTHORING_DOC_ENGLISH_DEFAULT_TITLES = {
  writtenPracticing: "Practicing written answers",
  writtenConsulting: "Consulting written answers",
  outdoorPracticing: "Practicing outdoor exercises",
  outdoorConsulting: "Consulting outdoor exercises",
};
function defaultAuthoringDocumentMeta(key) {
  const doc = AUTHORING_DOCS.find((item) => item.key === key) || AUTHORING_DOCS[0];
  const defaults = AUTHORING_DOCUMENT_DEFAULTS[key] || {};
  return {
    level: doc.level,
    kind: doc.kind,
    title: AUTHORING_DOC_ENGLISH_DEFAULT_TITLES[doc.key] || "",
    preface: defaults.preface || "",
    candidateIntro: defaults.candidateIntro || "",
  };
}

function normalizedAuthoringDocument(key, document = {}) {
  const meta = defaultAuthoringDocumentMeta(key);
  const itemsKey = meta.kind === "outdoor" ? "exercises" : "questions";
  return {
    ...meta,
    ...document,
    title: document.title || meta.title,
    preface: document.preface ?? document.preamble ?? meta.preface,
    candidateIntro: document.candidateIntro ?? document.instructions ?? meta.candidateIntro,
    [itemsKey]: Array.isArray(document[itemsKey]) ? document[itemsKey] : [],
  };
}

function authoringSections(items) {
  const seen = new Set();
  const sections = [];
  for (const item of Array.isArray(items) ? items : []) {
    const section = String(item?.section || item?.theme || "Unsectioned").trim() || "Unsectioned";
    if (!seen.has(section)) {
      seen.add(section);
      sections.push(section);
    }
  }
  return sections;
}

function emptyAuthoringQuestion(level, kind, index = 0) {
  const prefix = level === "Consulting" ? "C" : "P";
  return kind === "outdoor"
    ? {
        id: `${prefix}-OUT-Q${index + 1}`,
        number: String(index + 1),
        section: "",
        question: "",
        examinerGuidance: "",
        max: 1,
      }
    : {
        id: `${prefix}-W-Q${String(index + 1).padStart(2, "0")}`,
        number: index + 1,
        section: level === "Practicing" ? "Section B" : "",
        theme: "",
        type: "written",
        text: "",
        options: [],
        correctAnswer: "",
        scoringHelp: "",
        max: 1,
      };
}

function createEmptyAuthoringDraft() {
  return {
    kind: "vetbara.structuredAuthoringDraft.v1",
    packageId: "",
    title: "VETCERT examination package",
    version: new Date().toISOString().slice(0, 10),
    language: "English",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    documents: {
      writtenPracticing: normalizedAuthoringDocument("writtenPracticing"),
      writtenConsulting: normalizedAuthoringDocument("writtenConsulting"),
      outdoorPracticing: normalizedAuthoringDocument("outdoorPracticing"),
      outdoorConsulting: normalizedAuthoringDocument("outdoorConsulting"),
    },
  };
}

function authoringDraftFromCertificationPackage(pkg) {
  const draft = createEmptyAuthoringDraft();
  const sourceId = pkg?.packageId || "";
  const packageDocs = pkg?.authoring?.documents || {};

  function fromPackageDoc(key, packageDoc, itemsKey, items) {
    return normalizedAuthoringDocument(key, {
      ...(packageDocs[key] || {}),
      ...(packageDoc || {}),
      [itemsKey]: Array.isArray(items) ? items : [],
    });
  }

  return {
    ...draft,
    packageId: sourceId ? `${sourceId}-authoring` : "",
    title: pkg?.authoring?.title || "VETCERT examination package",
    version: pkg?.authoring?.version || (pkg?.createdAt ? String(pkg.createdAt).slice(0, 10) : draft.version),
    language: pkg?.authoring?.language || draft.language,
    createdAt: pkg?.createdAt || draft.createdAt,
    updatedAt: new Date().toISOString(),
    documents: {
      writtenPracticing: fromPackageDoc("writtenPracticing", pkg?.written?.Practicing, "questions", pkg?.written?.Practicing?.questions),
      writtenConsulting: fromPackageDoc("writtenConsulting", pkg?.written?.Consulting, "questions", pkg?.written?.Consulting?.questions),
      outdoorPracticing: fromPackageDoc("outdoorPracticing", pkg?.outdoor?.Practicing, "exercises", pkg?.outdoor?.Practicing?.exercises),
      outdoorConsulting: fromPackageDoc("outdoorConsulting", pkg?.outdoor?.Consulting, "exercises", pkg?.outdoor?.Consulting?.exercises),
    },
  };
}

function normalizeAuthoringNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeAuthoringItems(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    count: list.length,
    max: list.reduce((sum, item) => sum + normalizeAuthoringNumber(item?.max, 0), 0),
  };
}

function certificationPackageFromAuthoringDraft(draft) {
  const createdAt = new Date().toISOString();
  const docWP = normalizedAuthoringDocument("writtenPracticing", draft?.documents?.writtenPracticing);
  const docWC = normalizedAuthoringDocument("writtenConsulting", draft?.documents?.writtenConsulting);
  const docOP = normalizedAuthoringDocument("outdoorPracticing", draft?.documents?.outdoorPracticing);
  const docOC = normalizedAuthoringDocument("outdoorConsulting", draft?.documents?.outdoorConsulting);
  const wp = Array.isArray(docWP.questions) ? docWP.questions : [];
  const wc = Array.isArray(docWC.questions) ? docWC.questions : [];
  const op = Array.isArray(docOP.exercises) ? docOP.exercises : [];
  const oc = Array.isArray(docOC.exercises) ? docOC.exercises : [];
  const wpSummary = summarizeAuthoringItems(wp);
  const wcSummary = summarizeAuthoringItems(wc);
  const opSummary = summarizeAuthoringItems(op);
  const ocSummary = summarizeAuthoringItems(oc);

  return {
    kind: "vetbara.certificationPackage.v1",
    packageId: draft?.packageId?.trim() || `vetbara-authored-package-${Date.now()}`,
    createdAt,
    sourceFiles: {
      source: "Admin structured authoring interface",
      version: draft?.version || "",
    },
    contentSource: "admin-structured-authoring",
    uiLanguageIndependent: true,
    authoring: {
      title: draft?.title || "VETCERT examination package",
      version: draft?.version || "",
      language: draft?.language || "English",
      updatedAt: createdAt,
      documents: {
        writtenPracticing: { title: docWP.title, preface: docWP.preface, candidateIntro: docWP.candidateIntro },
        writtenConsulting: { title: docWC.title, preface: docWC.preface, candidateIntro: docWC.candidateIntro },
        outdoorPracticing: { title: docOP.title, preface: docOP.preface, candidateIntro: docOP.candidateIntro },
        outdoorConsulting: { title: docOC.title, preface: docOC.preface, candidateIntro: docOC.candidateIntro },
      },
    },
    variants: {
      Practicing: {
        code: "PRACTICING_ADMIN_PACKAGE",
        level: "Practicing",
        writtenQuestionCount: wpSummary.count,
        writtenMax: wpSummary.max,
        outdoorItemCount: opSummary.count,
        outdoorMax: opSummary.max,
      },
      Consulting: {
        code: "CONSULTING_ADMIN_PACKAGE",
        level: "Consulting",
        writtenQuestionCount: wcSummary.count,
        writtenMax: wcSummary.max,
        outdoorItemCount: ocSummary.count,
        outdoorMax: ocSummary.max,
      },
    },
    written: {
      Practicing: { level: "Practicing", title: docWP.title, preface: docWP.preface, candidateIntro: docWP.candidateIntro, questions: wp },
      Consulting: { level: "Consulting", title: docWC.title, preface: docWC.preface, candidateIntro: docWC.candidateIntro, questions: wc },
    },
    outdoor: {
      Practicing: { level: "Practicing", title: docOP.title, preface: docOP.preface, candidateIntro: docOP.candidateIntro, exercises: op },
      Consulting: { level: "Consulting", title: docOC.title, preface: docOC.preface, candidateIntro: docOC.candidateIntro, exercises: oc },
    },
  };
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const LANGUAGE_ABBREV_MAP = {
  english: "EN", czech: "CZ", "čeština": "CZ", cestina: "CZ", polish: "PL", polski: "PL",
  german: "DE", deutsch: "DE", dutch: "NL", nederlands: "NL",
};

// Maps a UI language code (from i18n.js's LANGUAGES, e.g. "cs", "de") to every English-language
// or native name a free-text "content language" field might reasonably contain for it, so the
// Admin authoring/translation mismatch check below works regardless of whether that field was
// typed in English ("Czech") or the language's own name ("Čeština").
const UI_LANGUAGE_NAME_SYNONYMS = {
  cs: ["czech", "čeština", "cestina"],
  en: ["english"],
  de: ["german", "deutsch"],
  it: ["italian", "italiano"],
  sv: ["swedish", "svenska"],
  hr: ["croatian", "hrvatski"],
  nl: ["dutch", "nederlands"],
  no: ["norwegian", "norsk"],
  fr: ["french", "français", "francais"],
  es: ["spanish", "español", "espanol"],
  ro: ["romanian", "română", "romana"],
};

// Non-blocking check (see AdminStructuredPackagePanel/AdminTranslationPanel): whether a
// free-text content-language field plausibly names the same language as the interface's own
// uiLanguage code. An empty field isn't a mismatch — there's nothing to compare yet.
function contentLanguageMatchesUiLanguage(uiLanguageCode, contentLanguageText) {
  const normalized = String(contentLanguageText || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === String(uiLanguageCode || "").toLowerCase()) return true;
  const synonyms = UI_LANGUAGE_NAME_SYNONYMS[uiLanguageCode] || [];
  return synonyms.some((name) => normalized === name || normalized.startsWith(name));
}
function languageAbbrev(language) {
  const raw = String(language || "").trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const mapped = LANGUAGE_ABBREV_MAP[raw.toLowerCase()];
  if (mapped) return mapped;
  return raw.slice(0, 2).toUpperCase() || "XX";
}

// yyyy-mm-dd-hh-mm in local wall-clock time, since the filename is for a human to recognize
// ("today around 4pm"), not for machine sorting across time zones.
function vetFilenameStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function slugForFilename(value) {
  return String(value || "").trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "misto";
}

// Generic text-document PDF renderer for the Centre archive (Section F) — every archived
// document (candidate output, examiner grading, audit log) is shaped as {heading, rows:
// [{label, text}]} sections and rendered through this single layout so the archive doesn't
// need a bespoke jsPDF layout per document type. Not meant to visually match the HTML/CSS
// print templates used elsewhere in the app; it only needs to be a readable, real PDF file.
function buildArchiveSectionsPdfBlob(title, metaLines, sections) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 16;
  const pageHeight = 297;
  const maxWidth = 210 - marginX * 2;
  let y = 20;

  function ensureSpace(lineHeight) {
    if (y + lineHeight > pageHeight - 16) {
      doc.addPage();
      y = 20;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.splitTextToSize(title, maxWidth).forEach((line) => { ensureSpace(7); doc.text(line, marginX, y); y += 7; });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 95);
  metaLines.forEach((line) => { ensureSpace(5); doc.text(line, marginX, y); y += 5; });
  doc.setTextColor(20, 30, 25);
  y += 4;

  (sections || []).forEach((section) => {
    if (section.heading) {
      ensureSpace(8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.splitTextToSize(section.heading, maxWidth).forEach((line) => { ensureSpace(6); doc.text(line, marginX, y); y += 6; });
      y += 1;
    }
    (section.rows || []).forEach((row) => {
      if (row.label) {
        ensureSpace(5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(String(row.label), marginX, y);
        y += 4.5;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.splitTextToSize(String(row.text ?? "-"), maxWidth).forEach((line) => { ensureSpace(5); doc.text(line, marginX, y); y += 5; });
      y += 3;
    });
    y += 2;
  });

  return doc.output("blob");
}

function archiveWrittenTestSections(candidate, variants, testBank, testResponses, includeGrading, t) {
  const review = computeWrittenTestReview(candidate, variants, testBank, testResponses);
  return (review.items || []).map((item) => ({
    heading: `${item.question?.id || "-"}${includeGrading ? ` (${item.pointsAwarded ?? 0} / ${item.question?.points ?? "-"} ${t("archive.pointsAbbrev")})` : ""}`,
    rows: [
      { label: t("archive.question"), text: item.question?.text || "-" },
      { label: t("archive.candidateAnswer"), text: item.hasAnswer ? String(item.answer ?? "") : t("archive.noAnswer") },
      ...(includeGrading ? [{ label: t("archive.points"), text: `${item.pointsAwarded ?? 0} / ${item.question?.points ?? "-"}` }] : []),
    ],
  }));
}

function archiveOutdoorSections(candidate, outdoor, outdoorNotes, outdoorItemsByLevel, t) {
  const scores = outdoor?.[candidate.id] ?? {};
  const notes = outdoorNotes?.[candidate.id] ?? {};
  const sections = effectiveOutdoorSectionsForLevel(outdoorItemsByLevel, candidate.level);
  return sections.flatMap((section) => {
    const items = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, candidate.level)?.[section] ?? [];
    return items.map((item) => ({
      heading: `${item.id} — ${outdoorSectionTitle(section)}`,
      rows: [
        { label: t("archive.question"), text: item.text || "-" },
        { label: t("archive.points"), text: `${scores[item.id] ?? "-"} / ${item.max}` },
        ...(notes[item.id] ? [{ label: t("archive.examinerNote"), text: notes[item.id] }] : []),
      ],
    }));
  });
}

function archiveReportSections(candidate, reportDrafts, t) {
  const draft = reportDrafts?.[candidate.id] ?? createReportDraft();
  return REPORT_TREES.map((treeName) => {
    const tree = draft[treeName] ?? {};
    const rows = [{ label: t("archive.fieldNotes"), text: tree.fieldNotes || "-" }];
    REPORT_SECTIONS.forEach((section) => rows.push({ label: sectionTitle(t, section), text: tree.finalSections?.[section.key] || "-" }));
    return { heading: treeName, rows };
  });
}

function archiveAuditSections(audit, t) {
  return [{
    heading: t("archive.auditTrail"),
    rows: (audit || []).map((entry) => ({
      label: `${entry.time || "-"} — ${translateAuditAction(t, entry.action) || "-"}`,
      text: [entry.target, entry.detail].filter(Boolean).join(" · ") || "-",
    })),
  }];
}

// Every certification document produced during the exam, grouped into the categories the
// Centre lead reviews before final closure. Each entry knows how to serialize itself both as
// JSON (machine-readable, embedded in the Centrum.vet manifest) and as a simple PDF (for the
// human-readable copy in the ZIP) — see buildArchiveSectionsPdfBlob.
function buildArchiveDocuments({ candidates, activeAdminPackage, variants, testBank, testResponses, reportDrafts, outdoor, outdoorNotes, outdoorItemsByLevel, audit, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const docs = [];
  const categoryInputMaterials = t("archive.category.inputMaterials");
  const categoryCandidateOutputs = t("archive.category.candidateOutputs");
  const categoryExaminerGrading = t("archive.category.examinerGrading");
  const categoryLog = t("archive.category.log");

  docs.push({
    id: "admin-package",
    category: categoryInputMaterials,
    label: t("archive.label.adminPackage"),
    jsonFilename: "Admin_balicek.json",
    pdfTitle: t("archive.label.adminPackage"),
    getJson: () => activeAdminPackage || {},
    getPdfSections: () => [{
      heading: t("archive.package"),
      rows: [
        { label: "Package ID", text: activeAdminPackage?.packageId || "-" },
        { label: t("archive.version"), text: activeAdminPackage?.version || "-" },
        { label: t("archive.language"), text: activeAdminPackage?.language || "-" },
      ],
    }],
  });

  candidates.forEach((c) => {
    docs.push({
      id: `candidate-test-${c.id}`,
      category: categoryCandidateOutputs,
      label: tf("archive.label.candidateTest", { id: c.id }),
      jsonFilename: `${c.id}_test_odpovedi.json`,
      pdfTitle: tf("archive.pdfTitle.candidateTest", { name: c.name || c.id }),
      getJson: () => testResponses?.[c.id] ?? {},
      getPdfSections: () => archiveWrittenTestSections(c, variants, testBank, testResponses, false, t),
    });
    if (c.level === "Consulting") {
      docs.push({
        id: `candidate-report-${c.id}`,
        category: categoryCandidateOutputs,
        label: tf("archive.label.candidateReport", { id: c.id }),
        jsonFilename: `${c.id}_report.json`,
        pdfTitle: tf("archive.pdfTitle.candidateReport", { name: c.name || c.id }),
        getJson: () => reportDrafts?.[c.id] ?? {},
        getPdfSections: () => archiveReportSections(c, reportDrafts, t),
      });
    }
  });

  candidates.forEach((c) => {
    docs.push({
      id: `examiner-test-${c.id}`,
      category: categoryExaminerGrading,
      label: tf("archive.label.examinerTest", { id: c.id }),
      jsonFilename: `${c.id}_test_hodnoceni.json`,
      pdfTitle: tf("archive.pdfTitle.examinerTest", { name: c.name || c.id }),
      getJson: () => computeWrittenTestReview(c, variants, testBank, testResponses),
      getPdfSections: () => archiveWrittenTestSections(c, variants, testBank, testResponses, true, t),
    });
    docs.push({
      id: `examiner-outdoor-${c.id}`,
      category: categoryExaminerGrading,
      label: tf("archive.label.examinerOutdoor", { id: c.id }),
      jsonFilename: `${c.id}_outdoor_hodnoceni.json`,
      pdfTitle: tf("archive.pdfTitle.examinerOutdoor", { name: c.name || c.id }),
      getJson: () => outdoor?.[c.id] ?? {},
      getPdfSections: () => archiveOutdoorSections(c, outdoor, outdoorNotes, outdoorItemsByLevel, t),
    });
    if (c.level === "Consulting") {
      docs.push({
        id: `examiner-report-${c.id}`,
        category: categoryExaminerGrading,
        label: tf("archive.label.examinerReport", { id: c.id }),
        jsonFilename: `${c.id}_report_kontrola.json`,
        pdfTitle: tf("archive.pdfTitle.examinerReport", { name: c.name || c.id }),
        getJson: () => reportDrafts?.[c.id] ?? {},
        getPdfSections: () => archiveReportSections(c, reportDrafts, t),
      });
    }
  });

  docs.push({
    id: "audit-log",
    category: categoryLog,
    label: t("archive.label.auditLog"),
    jsonFilename: "auditni_stopa.json",
    pdfTitle: t("archive.auditTrail"),
    getJson: () => audit || [],
    getPdfSections: () => archiveAuditSections(audit, t),
  });

  return docs;
}

function buildArchiveReadme(docs, vetFilename, t) {
  const lines = [
    t("archive.readme.title"),
    `${t("archive.readme.generatedAt")}: ${new Date().toLocaleString()}`,
    "",
    t("archive.readme.structureHeading"),
    `- ${vetFilename}: ${t("archive.readme.vetFileLine1")}`,
    `  ${t("archive.readme.vetFileLine2")}`,
    `  ${t("archive.readme.vetFileLine3")}`,
    `- README.txt: ${t("archive.readme.readmeLine")}`,
    `- ${t("archive.readme.categoryFolderLine1")}`,
    `  ${t("archive.readme.categoryFolderLine2")}`,
    "",
    t("archive.readme.contentsHeading"),
  ];
  const byCategory = {};
  docs.forEach((d) => { (byCategory[d.category] ||= []).push(d); });
  Object.entries(byCategory).forEach(([category, items]) => {
    lines.push(`\n${category}/`);
    items.forEach((d) => lines.push(`  - ${d.label}\n    (${d.jsonFilename}, ${d.jsonFilename.replace(/\.json$/, ".pdf")})`));
  });
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Opens print/PDF preview HTML in a new tab via a Blob URL instead of the older
// window.open("about:blank") + document.write() pattern, then a Blob-URL popup — both still
// produced a blank *saved PDF* on real devices even though the on-screen preview looked fine:
// printing a popup window (whether populated by document.write or navigated to a blob: URL)
// goes through a separate top-level browsing context, and WebKit's "Save as PDF" pipeline for
// that kind of window has repeatedly proven unreliable on exactly the tablets this app targets.
// A same-page hidden <iframe> avoids the popup layer entirely — its document is a normal part
// of the current page's frame tree, so printing it goes through the same, reliably-working
// print path as printing the page itself.
function openPrintDocument(html, onBlocked) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    iframe.addEventListener("load", () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        onBlocked?.();
      }
    });
    // Keep the iframe around after the dialog opens (Safari can re-enter print from the
    // in-document button too), then clean it up well after any reasonable print/save flow.
    setTimeout(() => { iframe.remove(); }, 120000);
    iframe.srcdoc = html;
    return iframe;
  } catch {
    onBlocked?.();
    return null;
  }
}

function linesToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

// Shared page shell for the Examiner's "PDF s hodnocením" exports (written test, Consulting
// report, outdoor form) — one printable record of a candidate's work plus the examiner's own
// grading and handwritten notes, for the certification centre's archive.
function examinerPdfShellHtml({ docTitle, candidate, examinerName, metaLine, bodyHtml }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(docTitle)} - ${escapeHtml(candidate.id)}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018;font-size:10.5pt}
    header.exam-header{border-bottom:2px solid #102018;padding-bottom:5mm;margin-bottom:6mm}
    header.exam-header h1{margin:0;font-size:16pt}
    header.exam-header p{margin:2mm 0 0;font-size:9.5pt;color:#516158}
    .exam-examiner{margin-top:2mm;font-weight:700;font-size:10pt;color:#0f3d2e}
    .exam-block{break-inside:avoid;margin-bottom:5mm;padding-bottom:4mm;border-bottom:1px solid #dbe3dd}
    .exam-block-head{display:flex;flex-wrap:wrap;gap:3mm;align-items:baseline;font-family:ui-monospace,monospace;font-size:8pt;color:#8a978f;margin-bottom:1.5mm}
    .exam-title{font-weight:700;margin-bottom:2.5mm;font-size:11.5pt}
    .exam-answer{border-radius:8px;padding:3mm;margin:2mm 0;background:#f6faf7;font-size:10pt;white-space:pre-wrap}
    .exam-answer.correct{background:#eafaf0;border:1px solid #bfe8cf}
    .exam-answer.incorrect{background:#fdf1f1;border:1px solid #f3c9c9}
    .exam-help{font-size:8.5pt;color:#8a978f;margin-top:1.5mm}
    .exam-score{display:inline-block;border-radius:999px;padding:1.5mm 4mm;font-weight:700;background:#eef5ef;color:#173021}
    .exam-sketch{max-width:70mm;max-height:45mm;border:1px solid #dbe3dd;border-radius:6px;margin-top:2mm}
    .exam-total{margin-top:6mm;padding-top:4mm;border-top:2px solid #102018;font-size:12pt;font-weight:700}
    @media print{.actions{display:none}}
    .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
  </style></head><body>
    <div class="actions"><button onclick="window.print()">Tisk / PDF</button></div>
    <header class="exam-header">
      <h1>${escapeHtml(docTitle)}</h1>
      <p>${escapeHtml(candidate.name || candidate.id)} · ${escapeHtml(candidate.id)} · ${escapeHtml(candidate.level || "")}</p>
      ${metaLine ? `<p>${escapeHtml(metaLine)}</p>` : ""}
      <div class="exam-examiner">Hodnotil: ${escapeHtml(examinerName || "-")} · ${escapeHtml(new Date().toLocaleString())}</div>
    </header>
    <main>${bodyHtml}</main>
  </body></html>`;
}

function guidanceToFlowHtml(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = [];
  lines.forEach((line) => {
    const isBullet = /^[\u2022\u25cf\-*]\s+/.test(line);
    const isHeading = !isBullet && line.length <= 80 && /^[A-Z][A-Za-z0-9 /(),.-]+:?$/.test(line) && !/[.!?]$/.test(line);
    if (!blocks.length || isBullet || isHeading) {
      blocks.push({ type: isBullet ? "bullet" : isHeading ? "heading" : "paragraph", text: line });
      return;
    }
    blocks[blocks.length - 1].text = `${blocks[blocks.length - 1].text} ${line}`.replace(/\s+/g, " ").trim();
  });
  return blocks.map((block) => {
    if (block.type === "bullet") {
      return `<div class="guidance-bullet">• ${escapeHtml(block.text.replace(/^[\u2022\u25cf\-*]\s+/, ""))}</div>`;
    }
    if (block.type === "heading") {
      return `<div class="guidance-heading">${escapeHtml(block.text)}</div>`;
    }
    return `<div class="guidance-paragraph">${escapeHtml(block.text)}</div>`;
  }).join("");
}

function authoringPrintHtml(draft, t) {
  const pkg = certificationPackageFromAuthoringDraft(draft);

  function isMultipleChoiceItem(doc, item) {
    return doc.kind === "written" && Array.isArray(item.options) && item.options.some((option) => String(option ?? "").trim());
  }

  function normalizeChoiceOption(option) {
    return String(option ?? "").replace(/^\s*[A-Z][\.)]\s+/, "").trim();
  }

  function renderAuthoringPrintRow(doc, item, index) {
    const question = doc.kind === "outdoor" ? item.question : item.text;
    const guidance = doc.kind === "outdoor" ? item.examinerGuidance : item.scoringHelp;
    const isMultipleChoice = isMultipleChoiceItem(doc, item);
    const options = Array.isArray(item.options)
      ? item.options.map((option) => normalizeChoiceOption(option)).filter((option) => option)
      : [];
    const optionHtml = isMultipleChoice
      ? `<ol class="choice-list" type="A">${options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol>`
      : "";
    const guidanceParts = [];
    if (isMultipleChoice) {
      guidanceParts.push(`<div class="correct-answer"><strong>${escapeHtml(t("admin.authoringPrint.correctAnswer"))}:</strong> ${escapeHtml(item.correctAnswer || "-")}</div>`);
    }
    if (String(guidance ?? "").trim()) {
      guidanceParts.push(`<div class="guidance-text">${guidanceToFlowHtml(guidance)}</div>`);
    }
    const typeLabel = isMultipleChoice ? t("admin.authoringPrint.multipleChoice") : doc.kind === "outdoor" ? t("admin.authoringPrint.outdoorOral") : t("admin.authoringPrint.writtenAnswer");
    return `<tr class="${isMultipleChoice ? "choice-row" : "written-row"}"><td class="q"><div class="qid"><strong>${escapeHtml(item.id || `${t("archive.question")} ${index + 1}`)}</strong><span>${escapeHtml(typeLabel)}</span></div><div class="question-text">${linesToHtml(question)}</div>${optionHtml}</td><td class="guidance">${guidanceParts.join("") || "&nbsp;"}</td><td class="marks">/${escapeHtml(item.max || 0)}</td></tr>`;
  }

  const docs = AUTHORING_DOCS.map((doc) => {
    const data = normalizedAuthoringDocument(doc.key, draft.documents[doc.key]);
    const items = doc.kind === "outdoor" ? data.exercises : data.questions;
    const summary = summarizeAuthoringItems(items);
    const sections = authoringSections(items);
    const sectionHtml = sections.map((section) => {
      const sectionItems = items.filter((item) => (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === section);
      const rows = sectionItems.map((item, index) => renderAuthoringPrintRow(doc, item, index)).join("");
      const isChoiceSection = sectionItems.length > 0 && sectionItems.every((item) => isMultipleChoiceItem(doc, item));
      return `<h3>${escapeHtml(section)}</h3><table class="${[doc.kind === "written" ? "test-question-table" : "", isChoiceSection ? "choice-section-table" : "standard-section-table"].filter(Boolean).join(" ")}"><thead><tr><th>${escapeHtml(t("archive.question"))}</th><th>${escapeHtml(t("admin.authoringPrint.notesGuidance"))}</th><th>${escapeHtml(t("archive.points"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
    return `<section class="doc"><h2>${escapeHtml(data.title || AUTHORING_DOC_ENGLISH_DEFAULT_TITLES[doc.key] || "")}</h2><p>${escapeHtml(doc.level)} / ${escapeHtml(doc.kind)} / ${summary.count} ${escapeHtml(t("admin.authoringPrint.items"))} / ${summary.max} ${escapeHtml(t("admin.authoringPrint.marks"))}</p>${data.preface ? `<div class="preface"><strong>${escapeHtml(t("admin.authoringPrint.preface"))}</strong><br />${linesToHtml(data.preface)}</div>` : ""}${data.candidateIntro ? `<div class="intro"><strong>${escapeHtml(t("admin.authoringPrint.candidateIntro"))}</strong><br />${linesToHtml(data.candidateIntro)}</div>` : ""}${sectionHtml}</section>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(pkg.packageId)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{font-size:26px}h2{page-break-before:always;margin-top:32px}.doc:first-of-type h2{page-break-before:auto}h3{margin-top:20px;font-size:15px}.preface,.intro,.meta{border:1px solid #cbd5e1;background:#f8fafc;padding:12px;margin:10px 0 14px}table{border-collapse:collapse;width:100%;font-size:12px;break-inside:auto}tr{break-inside:avoid;break-after:auto}th,td{border:1px solid #111827;padding:8px;vertical-align:top}th{background:#f1f5f9}.q{width:34%}.guidance{width:auto}.marks{width:60px;text-align:right;font-weight:bold}.test-question-table .q{width:44%}.test-question-table .guidance{width:auto;padding-left:6px;padding-right:6px}.test-question-table .marks{width:48px}.choice-section-table .q{width:46%}.test-question-table.choice-section-table .q{width:54%}.choice-section-table .guidance{width:auto}.qid{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:5px}.qid span{border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;color:#475569;font-size:10px;font-weight:700;padding:2px 7px;white-space:nowrap}.question-text{font-weight:600;margin-bottom:8px}.choice-list{margin:8px 0 0 18px;padding:0}.choice-list li{margin:3px 0;padding-left:3px}.choice-row .q{background:#f8fafc}.choice-row .question-text{font-weight:700}.correct-answer{border:1px solid #bbf7d0;background:#f0fdf4;color:#064e3b;border-radius:8px;padding:8px;margin-bottom:8px}.guidance-text{white-space:normal;width:100%;max-width:none;line-height:1.25}.test-question-table .guidance-text{display:block}.guidance-heading{font-weight:700;margin:0 0 3px}.guidance-paragraph{margin:0 0 5px}.guidance-bullet{margin:0 0 2px;padding-left:0.9em;text-indent:-0.9em}.written-row .guidance-text{color:#334155}@media print{button{display:none}body{margin:12mm}}</style></head><body><button onclick="window.print()">${escapeHtml(t("admin.authoringPrint.printButton"))}</button><h1>${escapeHtml(draft.title || t("admin.authoringPrint.defaultTitle"))}</h1><div class="meta"><div>Package ID: ${escapeHtml(pkg.packageId)}</div><div>${escapeHtml(t("archive.version"))}: ${escapeHtml(draft.version || "")}</div><div>${escapeHtml(t("archive.language"))}: ${escapeHtml(draft.language || "English")}</div><div>${escapeHtml(t("admin.authoringPrint.generated"))}: ${escapeHtml(pkg.createdAt)}</div></div>${docs}</body></html>`;
}

export function AdminStructuredPackagePanel({ adminPdfPackageLatest, setAdminPdfPackageLatest, setAdminPdfPackageStatus, setAdminPdfPackageError, centre, uiLanguage, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  // Admin session (from AdminLoginGate) — required by the write endpoints.
  const admin = React.useContext(AdminSessionContext);
  const [draft, setDraft] = useState(() => createEmptyAuthoringDraft());
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  // The structured editor only models written/outdoor/language content. Package-level fields it
  // doesn't know about (rulesDocuments, packageKind, ...) must still survive a load -> edit ->
  // save round trip instead of being silently dropped, so we keep the last loaded raw package
  // here and merge any of its unknown top-level fields back in before every save.
  const sourcePackageRef = useRef(null);
  const [activeDocKey, setActiveDocKey] = useState("writtenPracticing");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSectionFilter, setActiveSectionFilter] = useState("__all__");
  const [localStatus, setLocalStatus] = useState("");
  const [localError, setLocalError] = useState("");
  const [pdfFiles, setPdfFiles] = useState({});
  const [converting, setConverting] = useState(false);

  const activeDocMeta = AUTHORING_DOCS.find((doc) => doc.key === activeDocKey) || AUTHORING_DOCS[0];
  const activeDoc = draft.documents[activeDocKey] || {};
  const itemsKey = activeDocMeta.kind === "outdoor" ? "exercises" : "questions";
  const items = Array.isArray(activeDoc[itemsKey]) ? activeDoc[itemsKey] : [];
  const selectedItem = items[selectedIndex] || null;
  const activeSummary = summarizeAuthoringItems(items);
  const sections = authoringSections(items);
  const visibleItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => activeSectionFilter === "__all__" || (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === activeSectionFilter);

  function setDraftField(field, value) {
    setDraft((current) => ({ ...current, [field]: value, updatedAt: new Date().toISOString() }));
  }

  function setActiveDocumentField(field, value) {
    setDraft((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      documents: {
        ...current.documents,
        [activeDocKey]: {
          ...normalizedAuthoringDocument(activeDocKey, current.documents[activeDocKey]),
          [field]: value,
        },
      },
    }));
  }

  function renameSection(oldName, newName) {
    const cleanOld = String(oldName || "").trim();
    const cleanNew = String(newName || "").trim();
    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return;
    const next = items.map((item) => {
      const currentSection = String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned";
      return currentSection === cleanOld ? { ...item, section: cleanNew } : item;
    });
    setItems(next);
    setActiveSectionFilter(cleanNew);
  }

  function setSelectedSection(value) {
    const next = items.map((item, index) => {
      if (index !== selectedIndex) return item;
      const updated = { ...item, section: value };
      if (activeDocMeta.kind === "written" && !item.theme) updated.theme = value;
      return updated;
    });
    setItems(next);
  }

  function setItems(nextItems) {
    setDraft((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      documents: {
        ...current.documents,
        [activeDocKey]: {
          ...current.documents[activeDocKey],
          [itemsKey]: nextItems,
        },
      },
    }));
  }

  function updateSelected(field, value) {
    const next = items.map((item, index) => index === selectedIndex ? { ...item, [field]: value } : item);
    setItems(next);
  }

  function addItem() {
    const next = [...items, emptyAuthoringQuestion(activeDocMeta.level, activeDocMeta.kind, items.length)];
    setItems(next);
    setSelectedIndex(next.length - 1);
  }

  function duplicateItem() {
    if (!selectedItem) return;
    const copy = { ...selectedItem, id: `${selectedItem.id || "ITEM"}-COPY` };
    const next = [...items.slice(0, selectedIndex + 1), copy, ...items.slice(selectedIndex + 1)];
    setItems(next);
    setSelectedIndex(selectedIndex + 1);
  }

  function removeItem() {
    if (!selectedItem) return;
    const next = items.filter((_, index) => index !== selectedIndex);
    setItems(next);
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  }

  function loadFromPackage(pkg) {
    if (!pkg?.kind) return;
    sourcePackageRef.current = pkg;
    setDraft(authoringDraftFromCertificationPackage(pkg));
    setSelectedIndex(0);
    setActiveSectionFilter("__all__");
    setLocalStatus(tf("admin.authoring.loadedIntoEditor", { packageId: pkg.packageId || t("admin.authoring.packageNoId") }));
    setLocalError("");
  }

  // Silent background safety net (no button, no UI): periodically persists the in-progress
  // draft server-side so a crashed/closed tab doesn't lose everything back to the last time
  // someone clicked "Vytvořit Admin.vet". Errors are swallowed — this must never surface a
  // scary message or touch editor state while someone is mid-edit.
  async function autosaveDraft(currentDraft) {
    try {
      await fetch("/api/admin/authoring-drafts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: currentDraft, sessionToken: admin?.sessionToken }),
      });
    } catch {
      // Best-effort only; the next periodic tick will retry.
    }
  }

  async function fetchJsonIfOk(url) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { "x-vetbara-session": admin?.sessionToken || "" } });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { error: text || `HTTP ${response.status}` };
      }
      return { ok: response.ok, status: response.status, data, url };
    } catch (error) {
      return { ok: false, status: 0, data: { error: error.message || "Fetch failed" }, url };
    }
  }

  function packageHasAuthoringContent(pkg) {
    const writtenPracticing = pkg?.written?.Practicing?.questions;
    const writtenConsulting = pkg?.written?.Consulting?.questions;
    const outdoorPracticing = pkg?.outdoor?.Practicing?.exercises || pkg?.outdoor?.Practicing?.items || pkg?.outdoor?.Practicing;
    const outdoorConsulting = pkg?.outdoor?.Consulting?.exercises || pkg?.outdoor?.Consulting?.items || pkg?.outdoor?.Consulting;
    return [writtenPracticing, writtenConsulting, outdoorPracticing, outdoorConsulting].some((list) => Array.isArray(list) && list.length > 0);
  }

  async function loadActivePackage({ silent = false } = {}) {
    if (!silent) setLocalStatus(t("admin.authoring.loadingIntoEditor"));
    setLocalError("");

    const attempts = [
      { url: "/api/admin/test-package/approved", label: t("admin.authoring.attempt.approved") },
      { url: "/api/centre/test-package/active", label: t("admin.authoring.attempt.centreActive") },
      { url: "/api/admin/test-package/latest", label: t("admin.authoring.attempt.lastSaved") },
    ];

    const failures = [];

    for (const attempt of attempts) {
      const result = await fetchJsonIfOk(attempt.url);
      if (result.ok && packageHasAuthoringContent(result.data)) {
        loadFromPackage(result.data);
        setLocalStatus(tf("admin.authoring.loadedAttempt", { label: attempt.label, packageId: result.data.packageId || t("admin.authoring.packageNoId") }));
        return;
      }
      failures.push(`${attempt.label}: ${result.data?.error || `HTTP ${result.status}`}`);
    }

    if (!silent) {
      setLocalError(tf("admin.authoring.loadAnyFailed", { details: failures.join(" | ") }));
      setLocalStatus("");
    }
  }

  async function handleOpenAdminVetFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLocalStatus(t("admin.authoring.loadingFromFile"));
    setLocalError("");
    try {
      // Accepts both a legacy plain-JSON .vet and the newer ZIP .vet archive.
      const data = await readVetPackage(file);
      if (!packageHasAuthoringContent(data)) throw new Error(t("admin.authoring.fileNoContent"));
      loadFromPackage(data);
      setLocalStatus(tf("admin.authoring.loadedFromFile", { fileName: file.name, packageId: data.packageId || t("admin.authoring.packageNoId") }));
    } catch (error) {
      setLocalError(vetReadErrorMessage(error, t));
      setLocalStatus("");
    }
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",").pop());
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  // Import 4 exam PDFs → server extracts questions → load the built package into
  // the editor. PDFs are sent base64 in JSON (no multipart).
  async function convertPdfs() {
    const slots = ["practicingWritten", "consultingWritten", "practicingOutdoor", "consultingOutdoor"];
    const chosen = slots.filter((slot) => pdfFiles[slot]);
    if (!chosen.length) { setLocalError(t("admin.pdfConvert.noFiles")); return; }
    setConverting(true);
    setLocalError("");
    setLocalStatus(t("admin.pdfConvert.working"));
    try {
      const files = {};
      for (const slot of chosen) files[slot] = await readFileBase64(pdfFiles[slot]);
      const response = await fetch("/api/admin/test-package/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: admin?.sessionToken, files }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      loadFromPackage(data.package);
      setPdfFiles({});
      setLocalStatus(tf("admin.pdfConvert.done", { packageId: data.package?.packageId || "" }));
    } catch (error) {
      setLocalError(error.message || t("admin.pdfConvert.failed"));
      setLocalStatus("");
    } finally {
      setConverting(false);
    }
  }

  async function saveAsPackage() {
    setLocalStatus(t("admin.authoring.savingAsPackage"));
    setLocalError("");
    try {
      const builtPkg = certificationPackageFromAuthoringDraft(draft);
      // Carry forward any package-level field the editor doesn't model (rulesDocuments,
      // packageKind, ...) from whatever package was last loaded, so it isn't lost on save.
      const sourcePkg = sourcePackageRef.current || {};
      const pkg = { ...Object.fromEntries(Object.entries(sourcePkg).filter(([key]) => !(key in builtPkg))), ...builtPkg };
      const response = await fetch("/api/admin/test-package/authoring/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg, sessionToken: admin?.sessionToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      // Saving only writes the draft/"latest" file. Centre and candidates read a separate
      // "active/approved" file, so without this call the save above would silently never
      // reach a live exam.
      setLocalStatus(t("admin.authoring.approvingAsActive"));
      const approveResponse = await fetch("/api/admin/test-package/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.packageId, allowRequiresReview: true, reason: "Published from Admin authoring", sessionToken: admin?.sessionToken }),
      });
      const approveData = await approveResponse.json();
      if (!approveResponse.ok) throw new Error(approveData.error || `HTTP ${approveResponse.status}`);

      const savedPackage = approveData.package || data.package || pkg;
      sourcePackageRef.current = savedPackage;
      const vetFilename = `Admin_${languageAbbrev(draft.language)}_${vetFilenameStamp()}.vet`;
      downloadJsonFile(vetFilename, savedPackage);
      setAdminPdfPackageLatest?.(savedPackage);
      setAdminPdfPackageStatus?.(tf("admin.authoring.savedAndApproved", { fileName: vetFilename }));
      setLocalStatus(tf("admin.authoring.savedAndApprovedShort", { fileName: vetFilename }));

      try {
        await fetch("/api/admin/package-history/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: admin?.sessionToken, language: draft.language, centre: centre || "", packageId: savedPackage.packageId, vetFilename, package: savedPackage }),
        });
        loadHistory();
      } catch {
        // Best-effort: history is a convenience list, must never block the actual save above.
      }
    } catch (error) {
      setLocalError(error.message || t("admin.authoring.saveFailed"));
      setAdminPdfPackageError?.(error.message || t("admin.authoring.savePackageFailed"));
      setLocalStatus("");
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/admin/package-history/list", { cache: "no-store", headers: { "x-vetbara-session": admin?.sessionToken || "" } });
      const data = await response.json();
      const entries = Array.isArray(data.history) ? data.history : [];
      entries.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
      setHistory(entries);
    } catch {
      // Best-effort; leave the previous list in place.
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { loadHistory(); }, []);

  async function deleteHistoryEntry(id) {
    if (!window.confirm(t("admin.authoring.historyDeleteConfirm"))) return;
    try {
      await fetch(`/api/admin/package-history/${encodeURIComponent(id)}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionToken: admin?.sessionToken }) });
      setHistory((prev) => prev.filter((entry) => entry.id !== id));
    } catch (error) {
      setLocalError(error.message || t("admin.authoring.deleteFailed"));
    }
  }

  async function saveHistoryNote(id) {
    try {
      await fetch(`/api/admin/package-history/${encodeURIComponent(id)}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: admin?.sessionToken, note: noteDraft }),
      });
      setHistory((prev) => prev.map((entry) => entry.id === id ? { ...entry, note: noteDraft } : entry));
    } catch (error) {
      setLocalError(error.message || t("admin.authoring.saveNoteFailed"));
    } finally {
      setEditingNoteId(null);
    }
  }

  async function copyHistoryEntry(id) {
    setLocalError("");
    try {
      const response = await fetch(`/api/admin/package-history/${encodeURIComponent(id)}`, { cache: "no-store", headers: { "x-vetbara-session": admin?.sessionToken || "" } });
      const data = await response.json();
      if (!response.ok || !data?.entry?.package) throw new Error(data.error || t("admin.authoring.historyLoadFailed"));
      loadFromPackage(data.entry.package);
      setLocalStatus(t("admin.authoring.historyCopied"));
    } catch (error) {
      setLocalError(error.message || t("admin.authoring.historyLoadFailed"));
    }
  }

  function printPackage() {
    openPrintDocument(authoringPrintHtml(draft, t), () => setLocalError(t("admin.authoring.printBlocked")));
  }

  useEffect(() => {
    const hasAnyItems = AUTHORING_DOCS.some((doc) => {
      const data = draft.documents?.[doc.key] || {};
      const list = doc.kind === "outdoor" ? data.exercises : data.questions;
      return Array.isArray(list) && list.length > 0;
    });
    if (!hasAnyItems && !adminPdfPackageLatest) loadActivePackage({ silent: true });
    if (!hasAnyItems && adminPdfPackageLatest) loadFromPackage(adminPdfPackageLatest);
    // Run once on mount; the editor can then be controlled manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    const intervalId = window.setInterval(() => autosaveDraft(draftRef.current), 120000);
    return () => window.clearInterval(intervalId);
  }, []);

  const allSummaries = AUTHORING_DOCS.map((doc) => {
    const data = draft.documents[doc.key] || {};
    const list = doc.kind === "outdoor" ? data.exercises : data.questions;
    return { ...doc, ...summarizeAuthoringItems(list) };
  });

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-2">
      <CardContent className="p-5">
        <div className="rounded-2xl border bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-bold">{t("admin.authoring.historyTitle")}</h4>
              <p className="text-sm text-slate-600">{t("admin.authoring.historyHelper")}</p>
            </div>
            {historyLoading && <span className="text-xs text-slate-500">{t("admin.authoring.historyLoading")}</span>}
          </div>
          <div className="mt-3 space-y-2">
            {!historyLoading && !history.length && (
              <div className="rounded-xl border border-dashed bg-white p-3 text-sm text-slate-500">{t("admin.authoring.historyEmpty")}</div>
            )}
            {history.map((entry) => (
              <div key={entry.id} className="rounded-xl border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div><span className="text-xs text-slate-500">{t("admin.authoring.historyDate")}: </span>{entry.savedAt ? new Date(entry.savedAt).toLocaleString() : "-"}</div>
                  <div><span className="text-xs text-slate-500">{t("admin.authoring.historyLanguage")}: </span>{entry.language || "-"}</div>
                  <div><span className="text-xs text-slate-500">{t("admin.authoring.historySentTo")}: </span>{entry.centre || "-"}</div>
                </div>
                <div className="mt-2">
                  {editingNoteId === entry.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        autoFocus
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveHistoryNote(entry.id); if (e.key === "Escape") setEditingNoteId(null); }}
                        placeholder={t("admin.authoring.historyNotePlaceholder")}
                        className="min-w-[220px] flex-1 rounded-lg border bg-white p-1.5 text-sm"
                      />
                      <Button onClick={() => saveHistoryNote(entry.id)} className="rounded-lg px-3 py-1 text-xs">{t("common.save")}</Button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setEditingNoteId(entry.id); setNoteDraft(entry.note || ""); }} className="text-left text-sm text-slate-700 hover:underline">
                      {entry.note ? entry.note : <span className="text-slate-400">{t("admin.authoring.historyNotePlaceholder")}</span>}
                    </button>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => copyHistoryEntry(entry.id)} variant="outline" className="rounded-lg px-3 py-1 text-xs">{t("admin.authoring.historyCopy")}</Button>
                  <Button onClick={() => deleteHistoryEntry(entry.id)} variant="outline" className="rounded-lg px-3 py-1 text-xs">{t("admin.authoring.historyDelete")}</Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold">{t("admin.authoring.panelTitle")}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {t("admin.authoring.panelSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border bg-white px-4 py-2 text-sm font-medium text-slate-950 hover:bg-slate-50">
              {t("admin.authoring.openCurrent")}
              <input type="file" accept=".vet,application/json" className="hidden" onChange={handleOpenAdminVetFile} />
            </label>
            <Button onClick={saveAsPackage} className="rounded-2xl">{t("admin.authoring.createPackage")}</Button>
            <Button onClick={printPackage} variant="outline" className="rounded-2xl">{t("admin.authoring.print")}</Button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
          <h4 className="text-sm font-semibold text-slate-900">{t("admin.pdfConvert.title")}</h4>
          <p className="mt-1 text-xs text-slate-600">{t("admin.pdfConvert.helper")}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {[["practicingWritten", "admin.pdfConvert.practicingWritten"], ["consultingWritten", "admin.pdfConvert.consultingWritten"], ["practicingOutdoor", "admin.pdfConvert.practicingOutdoor"], ["consultingOutdoor", "admin.pdfConvert.consultingOutdoor"]].map(([slot, label]) => (
              <label key={slot} className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                <span>{t(label)}{pdfFiles[slot] ? " ✓" : ""}</span>
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => setPdfFiles((prev) => ({ ...prev, [slot]: e.target.files?.[0] || undefined }))} className="text-xs" />
              </label>
            ))}
          </div>
          <Button onClick={convertPdfs} disabled={converting} className="mt-3 rounded-2xl">{converting ? t("admin.pdfConvert.working") : t("admin.pdfConvert.button")}</Button>
        </div>

        {localStatus && <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{localStatus}</div>}
        {localError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{localError}</div>}

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm font-medium md:col-span-2">Package title
            <input value={draft.title || ""} onChange={(e) => setDraftField("title", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
          </label>
          <label className="text-sm font-medium">Version
            <input value={draft.version || ""} onChange={(e) => setDraftField("version", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
          </label>
          <label className="text-sm font-medium">Language
            <input value={draft.language || ""} onChange={(e) => setDraftField("language", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
          </label>
        </div>

        {!contentLanguageMatchesUiLanguage(uiLanguage, draft.language) && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            {tf("admin.authoring.languageMismatch", { ui: UI_LANGUAGES.find((lang) => lang.code === uiLanguage)?.label || uiLanguage, content: draft.language })}
          </div>
        )}

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {allSummaries.map((doc) => (
            <button key={doc.key} onClick={() => { setActiveDocKey(doc.key); setSelectedIndex(0); setActiveSectionFilter("__all__"); }} className={`rounded-xl border p-3 text-left text-sm ${activeDocKey === doc.key ? "border-slate-950 bg-slate-100" : "bg-white hover:bg-slate-50"}`}>
              <div className="font-semibold">{authoringDocTitle(t, doc)}</div>
              <div className="mt-1 text-xs text-slate-600">{doc.count} {t("admin.authoring.itemsUnit")} / {doc.max} {t("common.points")}</div>
            </button>
          ))}
        </div>


        <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h4 className="font-bold">{t("admin.authoring.manualReviewHeading")}</h4>
              <p className="text-sm text-slate-600">{t("admin.authoring.manualReviewHelper")}</p>
            </div>
            <label className="text-sm font-medium">{t("admin.authoring.filterSection")}
              <select value={activeSectionFilter} onChange={(e) => { setActiveSectionFilter(e.target.value); setSelectedIndex(0); }} className="mt-1 w-full rounded-xl border bg-white p-2 md:w-80">
                <option value="__all__">{t("admin.authoring.allSections")}</option>
                {sections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium md:col-span-2">{t("admin.authoring.documentName")}
              <input value={activeDoc.title || ""} onChange={(e) => setActiveDocumentField("title", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
            </label>
            <label className="text-sm font-medium">{t("admin.authoring.prefaceLabel")}
              <textarea value={activeDoc.preface || ""} onChange={(e) => setActiveDocumentField("preface", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
            </label>
            <label className="text-sm font-medium">{t("admin.authoring.candidateIntroLabel")}
              <textarea value={activeDoc.candidateIntro || ""} onChange={(e) => setActiveDocumentField("candidateIntro", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
            </label>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {sections.map((section) => {
              const sectionItems = items.filter((item) => (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === section);
              const sectionSummary = summarizeAuthoringItems(sectionItems);
              // Outdoor either/or pairs (same base name, "(halo)" vs "(soil)"): flag both variants
              // so it is obvious the examiner picks ONE at the exam and only one counts.
              const isVariant = String(activeDocKey).startsWith("outdoor") && outdoorVariantGroups(sections).has(outdoorSectionBaseAndVariant(section).base);
              return (
                <button key={section} type="button" onClick={() => { setActiveSectionFilter(section); const first = items.findIndex((item) => (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === section); setSelectedIndex(Math.max(0, first)); }} className={`rounded-xl border p-3 text-left text-sm ${activeSectionFilter === section ? "border-slate-950 bg-white" : "bg-white hover:bg-slate-100"}`}>
                  <div className="flex items-start justify-between gap-2"><div className="font-semibold">{section}</div>{isVariant && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{t("admin.authoring.variantBadge")}</span>}</div>
                  <div className="mt-1 text-xs text-slate-600">{sectionSummary.count} {t("admin.authoring.questionsUnit")} / {sectionSummary.max} {t("common.points")}{isVariant ? ` · ${t("admin.authoring.variantHint")}` : ""}</div>
                </button>
              );
            })}
            {!sections.length && <div className="rounded-xl border border-dashed bg-white p-3 text-sm text-slate-500">{t("admin.authoring.noSectionsYet")}</div>}
          </div>
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{authoringDocTitle(t, activeDocMeta)}</div>
                <div className="text-xs text-slate-600">{activeSummary.count} {t("admin.authoring.itemsUnit")} / {activeSummary.max} {t("common.points")}</div>
              </div>
              <Button onClick={addItem} variant="outline" className="rounded-xl px-3 py-1">{t("admin.authoring.addItem")}</Button>
            </div>
            <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
              {visibleItems.map(({ item, index }) => (
                <button key={`${item.id}-${index}`} onClick={() => setSelectedIndex(index)} className={`w-full rounded-xl border p-2 text-left text-sm ${selectedIndex === index ? "border-slate-950 bg-white" : "bg-white hover:bg-slate-50"}`}>
                  <div className="font-mono text-xs text-slate-500">{item.id || `#${index + 1}`}</div>
                  <div className="line-clamp-2 font-medium">{activeDocMeta.kind === "outdoor" ? item.question : item.text}</div>
                  <div className="mt-1 text-xs text-slate-500">/{item.max || 0} {t("common.points")}</div>
                </button>
              ))}
              {!items.length && <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-500">{t("admin.authoring.noItemsInDocument")}</div>}
              {items.length > 0 && !visibleItems.length && <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-500">{t("admin.authoring.noItemsInSection")}</div>}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            {selectedItem ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-bold">{t("admin.authoring.editItem")}</h4>
                  <div className="flex gap-2">
                    <Button onClick={duplicateItem} variant="outline" className="rounded-xl">{t("admin.authoring.duplicate")}</Button>
                    <Button onClick={removeItem} variant="outline" className="rounded-xl">{t("admin.authoring.delete")}</Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="text-sm font-medium">ID
                    <input value={selectedItem.id || ""} onChange={(e) => updateSelected("id", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2 font-mono text-sm" />
                  </label>
                  <label className="text-sm font-medium">Number
                    <input value={selectedItem.number || ""} onChange={(e) => updateSelected("number", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                  </label>
                  <label className="text-sm font-medium">{t("admin.authoring.maxScore")}
                    <input type="number" step="0.5" value={selectedItem.max ?? 0} onChange={(e) => updateSelected("max", normalizeAuthoringNumber(e.target.value, 0))} className="mt-1 w-full rounded-xl border bg-white p-2" />
                  </label>
                  {activeDocMeta.kind === "written" && (
                    <label className="text-sm font-medium">Type
                      <select value={selectedItem.type || "written"} onChange={(e) => updateSelected("type", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">
                        <option value="written">written</option>
                        <option value="multipleChoice">multipleChoice</option>
                      </select>
                    </label>
                  )}
                </div>

                {activeDocMeta.kind === "outdoor" ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="block text-sm font-medium">{t("admin.authoring.section")}
                        <input value={selectedItem.section || ""} onChange={(e) => setSelectedSection(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                      <Button type="button" onClick={() => renameSection(activeSectionFilter, selectedItem.section)} variant="outline" className="rounded-xl" disabled={activeSectionFilter === "__all__" || !selectedItem.section}>{t("admin.authoring.renameSection")}</Button>
                    </div>
                    <label className="block text-sm font-medium">{t("admin.authoring.questionBodyOutdoor")}
                      <textarea value={selectedItem.question || ""} onChange={(e) => updateSelected("question", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                    <label className="block text-sm font-medium">{t("admin.authoring.examinerGuidance")}
                      <textarea value={selectedItem.examinerGuidance || ""} onChange={(e) => updateSelected("examinerGuidance", e.target.value)} rows={10} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-sm font-medium">{t("admin.authoring.section")}
                        <input value={selectedItem.section || ""} onChange={(e) => setSelectedSection(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                      <label className="block text-sm font-medium">{t("admin.authoring.theme")}
                        <input value={selectedItem.theme || ""} onChange={(e) => updateSelected("theme", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">{t("admin.authoring.questionBody")}
                      <textarea value={selectedItem.text || ""} onChange={(e) => updateSelected("text", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                    {selectedItem.type === "multipleChoice" && (
                      <>
                        <label className="block text-sm font-medium">Options, one per line, e.g. A. ...
                          <textarea value={(selectedItem.options || []).join("\n")} onChange={(e) => updateSelected("options", e.target.value.split(/\r?\n/).filter(Boolean))} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
                        </label>
                        <label className="block text-sm font-medium">Correct answer
                          <input value={selectedItem.correctAnswer || ""} onChange={(e) => updateSelected("correctAnswer", e.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border bg-white p-2" />
                        </label>
                      </>
                    )}
                    <label className="block text-sm font-medium">{t("admin.authoring.scoringHelp")}
                      <textarea value={selectedItem.scoringHelp || ""} onChange={(e) => updateSelected("scoringHelp", e.target.value)} rows={10} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-sm text-slate-500">{t("admin.authoring.selectOrAdd")}</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboardSection({ id, icon: Icon, title, description, activeSection, setActiveSection, t, children, locked, lockedMessage, onUnlock, unlockLabel }) {
  const isOpen = !locked && activeSection === id;
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-3">
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => { if (locked) return; setActiveSection(isOpen ? "" : id); }}
          aria-disabled={locked || undefined}
          className={`flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between ${locked ? "cursor-not-allowed" : ""}`}
        >
          <div className={`flex items-start gap-3 ${locked ? "opacity-60" : ""}`}>
            {Icon && <div className="rounded-2xl bg-slate-100 p-2"><Icon className="h-5 w-5" /></div>}
            <div>
              <h3 className="text-xl font-bold tracking-tight">{title}</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
              {locked && lockedMessage && <p className="mt-2 inline-block max-w-3xl rounded-xl bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900">{lockedMessage}</p>}
            </div>
          </div>
          {!locked && (
            <span className="inline-flex rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              {isOpen ? t("common.close") : t("common.open")}
            </span>
          )}
        </button>
        {/* When a section is locked because the exam has been closed, the operator can reopen it
            with the closing password — rendered outside the header button so it is a real,
            clickable control rather than an (invalid) nested button. */}
        {locked && onUnlock && (
          <div className="mt-4">
            <button
              type="button"
              onClick={onUnlock}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Lock className="h-4 w-4" />
              {unlockLabel || t("centre.unlock.button")}
            </button>
          </div>
        )}
        {isOpen && <div className="mt-5 border-t pt-5">{children}</div>}
      </CardContent>
    </Card>
  );
}

// Builds a Centre access URL carrying a token unique to this one (place, examDate) opening — see
// generateCentreAccessLink below. tokenAccess() server-side derives role/id purely from the URL's
// own query params (this is a portable-LAN pilot, not a hosted auth service), so the token isn't
// a security boundary; its value being unique per exam is what lets Admin tell generated links
// apart in the history list and know which one went to which centre/date.
function centreAccessLinkFor(place, examDate, centre) {
  const idSlug = `${slugForFilename(place)}-${examDate || "date"}`;
  const token = `CENTRE-${slugForFilename(place).toUpperCase()}-${examDate || "DATE"}-${vetbaraUid("").toUpperCase()}`;
  // Always the networked app's own root, never the current page's path — this link needs to
  // reach the Centre entry point (index.html) regardless of whether it was generated from the
  // standalone admin.html or the networked app's own Admin role view.
  const url = new URL("/", portableLanOrigin() || window.location.origin);
  url.searchParams.set("role", "Centre");
  url.searchParams.set("id", idSlug);
  url.searchParams.set("token", token);
  return { id: idSlug, token, url: url.toString(), place, examDate, centre };
}

// Shared admin session used by the login gate and by panels that mint tokens.
export const AdminSessionContext = React.createContext({ sessionToken: null, username: null, logout: () => {} });

function useAdminSessionState(t, addAudit) {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("vetbara-admin-session") || "null"); } catch { return null; }
  });
  const isAuthed = Boolean(session?.sessionToken && (!session.expiresAt || new Date(session.expiresAt) > new Date()));

  function persist(next) {
    setSession(next);
    try {
      if (next) window.localStorage.setItem("vetbara-admin-session", JSON.stringify(next));
      else window.localStorage.removeItem("vetbara-admin-session");
    } catch { /* ignore storage errors */ }
  }

  async function login(username, password) {
    const response = await fetch("/api/admin/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t("adminAuth.loginFailed"));
    persist({ sessionToken: data.sessionToken, username: data.username, expiresAt: data.expiresAt });
    addAudit?.("Admin logged in", data.username, "");
  }

  function logout() { persist(null); }

  async function changeCredentials({ currentPassword, newUsername, newPassword }) {
    const response = await fetch("/api/admin/auth/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: session?.sessionToken, currentPassword, newUsername: newUsername || undefined, newPassword: newPassword || undefined }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t("adminAuth.changeFailed"));
    persist({ ...session, username: data.username });
    addAudit?.("Admin credentials changed", data.username, "");
    return data;
  }

  return { session, isAuthed, login, logout, changeCredentials };
}

// Gates the whole Admin area behind a login. First login: Bara / VetBara2026.
export function AdminLoginGate({ t, addAudit, children }) {
  const auth = useAdminSessionState(t, addAudit);
  const [form, setForm] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeForm, setChangeForm] = useState({ currentPassword: "", newUsername: "", newPassword: "" });
  const [changeMsg, setChangeMsg] = useState("");

  async function submitLogin(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await auth.login(form.username, form.password); setForm({ username: "", password: "" }); }
    catch (err) { setError(err.message || t("adminAuth.loginFailed")); }
    finally { setBusy(false); }
  }

  async function submitChange(event) {
    event.preventDefault();
    setChangeMsg("");
    try { await auth.changeCredentials(changeForm); setChangeForm({ currentPassword: "", newUsername: "", newPassword: "" }); setChangeMsg(t("adminAuth.changed")); }
    catch (err) { setChangeMsg(err.message || t("adminAuth.changeFailed")); }
  }

  if (!auth.isAuthed) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Lock className="h-5 w-5" /> {t("adminAuth.loginTitle")}</div>
        <p className="mt-1 text-sm text-slate-500">{t("adminAuth.loginHelper")}</p>
        <form onSubmit={submitLogin} className="mt-4">
          <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder={t("adminAuth.username")} autoComplete="username" className="w-full rounded-xl border bg-white p-2 text-sm" />
          <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} type="password" placeholder={t("adminAuth.password")} autoComplete="current-password" className="mt-2 w-full rounded-xl border bg-white p-2 text-sm" />
          {error && <div className="mt-2 text-sm font-medium text-rose-700">{error}</div>}
          <Button type="submit" disabled={busy} className="mt-4 w-full rounded-2xl">{busy ? t("adminAuth.loggingIn") : t("adminAuth.login")}</Button>
        </form>
      </div>
    );
  }

  return (
    <AdminSessionContext.Provider value={{ sessionToken: auth.session.sessionToken, username: auth.session.username, logout: auth.logout }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-white px-4 py-2 text-sm">
        <div className="text-slate-600">{(t("adminAuth.signedInAs") || "Signed in as {name}").replace("{name}", auth.session.username || "-")}</div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { setChangeOpen((v) => !v); setChangeMsg(""); }} className="font-medium text-slate-700 hover:underline">{t("adminAuth.changeCredentials")}</button>
          <button type="button" onClick={auth.logout} className="font-medium text-slate-700 hover:underline">{t("adminAuth.logout")}</button>
        </div>
      </div>
      {changeOpen && (
        <form onSubmit={submitChange} className="mb-4 rounded-2xl border bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-800">{t("adminAuth.changeTitle")}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input value={changeForm.currentPassword} onChange={(e) => setChangeForm((f) => ({ ...f, currentPassword: e.target.value }))} type="password" placeholder={t("adminAuth.currentPassword")} autoComplete="current-password" className="rounded-xl border bg-white p-2 text-sm" />
            <input value={changeForm.newUsername} onChange={(e) => setChangeForm((f) => ({ ...f, newUsername: e.target.value }))} placeholder={t("adminAuth.newUsername")} autoComplete="username" className="rounded-xl border bg-white p-2 text-sm" />
            <input value={changeForm.newPassword} onChange={(e) => setChangeForm((f) => ({ ...f, newPassword: e.target.value }))} type="password" placeholder={t("adminAuth.newPassword")} autoComplete="new-password" className="rounded-xl border bg-white p-2 text-sm" />
          </div>
          {changeMsg && <div className="mt-2 text-xs font-medium text-slate-700">{changeMsg}</div>}
          <Button type="submit" className="mt-3 rounded-2xl">{t("adminAuth.saveCredentials")}</Button>
        </form>
      )}
      {children}
    </AdminSessionContext.Provider>
  );
}

export function AdminExamOpeningPanel({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, setStatus, addAudit, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [latestLink, setLatestLink] = useState(null);

  // --- Admin session (gates generating/minting Centre access tokens) --------
  // Admin session comes from the AdminLoginGate that wraps the whole Admin area.
  const admin = React.useContext(AdminSessionContext);
  const [authError, setAuthError] = useState("");

  async function loadCentreLinks() {
    setLinksLoading(true);
    try {
      const response = await fetch("/api/admin/centre-links/list", { cache: "no-store", headers: { "x-vetbara-session": admin?.sessionToken || "" } });
      const data = await response.json();
      setLinks(Array.isArray(data.links) ? data.links : []);
    } catch {
      // Best-effort; leave the previous list in place.
    } finally {
      setLinksLoading(false);
    }
  }

  useEffect(() => { loadCentreLinks(); }, []);

  async function deleteCentreLink(link) {
    if (!window.confirm(tf("admin.centreAccess.deleteConfirm", { place: link.place || "-", date: link.examDate || "-" }))) return;
    setAuthError("");
    try {
      const response = await fetch("/api/admin/centre-links/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: link.id, sessionToken: admin?.sessionToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { admin?.logout?.(); setAuthError(t("adminAuth.expired")); return; }
      if (!response.ok) throw new Error(data.error || t("admin.centreAccess.deleteFailed"));
      setLinks((prev) => prev.filter((item) => item.id !== link.id));
    } catch (error) {
      setAuthError(error.message || t("admin.centreAccess.deleteFailed"));
    }
  }

  async function generateCentreAccessLink() {
    const entry = centreAccessLinkFor(place, examDate, centre);
    setAuthError("");
    // Register the token in the backend (Admin session required) so the strict
    // Supabase-backed /api/qr/resolve accepts it. Only surface the link once the
    // token is actually valid, so a Centre never receives a dead link.
    try {
      const response = await fetch("/api/admin/centre-links/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...entry, sessionToken: admin?.sessionToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { admin?.logout?.(); setAuthError(t("adminAuth.expired")); return; }
      if (!response.ok && data?.registered !== false) throw new Error(data.error || t("adminAuth.generateFailed"));
    } catch (error) {
      setAuthError(error.message || t("adminAuth.generateFailed"));
      return;
    }
    setLatestLink(entry);
    setLinks((prev) => [{ ...entry, createdAt: new Date().toISOString() }, ...prev]);
    setStatus(tf("status.centreAccessGenerated", { place, date: examDate }));
    addAudit(t("audit.centreAccessGenerated"), centre, entry.url);
    fetch("/api/admin/centre-links/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, sessionToken: admin?.sessionToken }),
    }).catch(() => {});
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border bg-white p-4">
        <SectionTitle icon={ShieldCheck} title={t("admin.openExam.title")} subtitle={t("admin.openExam.subtitle")} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">{t("admin.centre")}<select value={centre} onChange={(e) => setCentre(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{CENTRES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="text-sm font-medium">{t("admin.examLanguage")}<select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="text-sm font-medium">{t("admin.examDate")}<input value={examDate} onChange={(e) => setExamDate(e.target.value)} type="date" className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
          <label className="text-sm font-medium">{t("admin.place")}<input value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold">{t("admin.centreAccess.title")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("admin.centreAccess.helper")}</p>
        {authError && <div className="mt-3 rounded-xl bg-rose-50 p-2 text-xs font-medium text-rose-700">{authError}</div>}
        <Button onClick={generateCentreAccessLink} className="mt-3 rounded-2xl">{t("admin.centreAccess.generate")}</Button>
        {latestLink && (
          <div className="mt-4 flex flex-col gap-4 rounded-xl bg-slate-50 p-3 md:flex-row md:items-center">
            <RealQr value={latestLink.url} />
            <div>
              <div className="text-xs font-semibold text-slate-500">{tf("admin.centreAccess.generatedFor", { place: latestLink.place || "-", date: latestLink.examDate || "-" })}</div>
              <div className="mt-1 break-all font-mono text-xs text-slate-600">{latestLink.url}</div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-4 lg:col-span-2">
        <h3 className="font-semibold">{t("admin.centreAccess.historyTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("admin.centreAccess.historyHelper")}</p>
        <div className="mt-3 overflow-x-auto">
          {linksLoading ? (
            <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{t("admin.centreAccess.historyLoading")}</div>
          ) : links.length === 0 ? (
            <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{t("admin.centreAccess.historyEmpty")}</div>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-3">{t("admin.centreAccess.columnDate")}</th>
                  <th className="py-2 pr-3">{t("admin.centreAccess.columnPlace")}</th>
                  <th className="py-2 pr-3">CC</th>
                  <th className="py-2 pr-3">{t("admin.centreAccess.columnLink")}</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id + link.createdAt} className="border-b align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{link.examDate || "-"}</td>
                    <td className="py-2 pr-3">{link.place || "-"}</td>
                    <td className="py-2 pr-3">{link.centre || "-"}</td>
                    <td className="py-2 pr-3 break-all font-mono text-xs text-slate-600">{link.url}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => navigator.clipboard?.writeText(link.url)} variant="outline" className="rounded-xl px-3 py-1 text-xs">{t("admin.centreAccess.copyLink")}</Button>
                        <Button onClick={() => deleteCentreLink(link)} variant="outline" className="rounded-xl px-3 py-1 text-xs text-rose-700">{t("admin.centreAccess.delete")}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminTranslationPanel({ uiLanguage, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const admin = React.useContext(AdminSessionContext);
  const targetLanguages = UI_LANGUAGES.filter((lang) => lang.code !== "en");
  const [selectedLang, setSelectedLang] = useState(targetLanguages[0]?.code || "cs");
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const savedTimeoutRef = useRef(null);

  const allKeys = useMemo(() => allTranslationKeys(), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => allKeys.map((key) => ({
    key,
    en: englishSourceFor(key) ?? "",
    value: translationFor(selectedLang, key) ?? "",
    missing: translationFor(selectedLang, key) == null,
  })), [allKeys, selectedLang, refreshTick]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyMissing && !row.missing) return false;
      if (!needle) return true;
      return row.key.toLowerCase().includes(needle) || row.en.toLowerCase().includes(needle) || row.value.toLowerCase().includes(needle);
    });
  }, [rows, search, onlyMissing]);

  const translatedCount = rows.length - rows.filter((row) => row.missing).length;
  const coveragePct = rows.length ? Math.round((translatedCount / rows.length) * 100) : 0;

  async function saveTranslation(key, value) {
    setSavingKey(key);
    try {
      await fetch("/api/translations/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: admin?.sessionToken, lang: selectedLang, key, value }),
      });
      applyTranslationOverrides({ [selectedLang]: { [key]: value } });
      setRefreshTick((tick) => tick + 1);
      setSavedKey(key);
      clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setSavedKey(null), 1500);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <SectionTitle icon={Languages} title={t("admin.multilingual.title")} subtitle={t("admin.multilingual.subtitle")} />
      <p className="mb-4 text-sm text-slate-600">{t("admin.multilingual.helper")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">{t("admin.multilingual.language")}
          <select value={selectedLang} onChange={(e) => setSelectedLang(e.target.value)} className="mt-1 block w-56 rounded-xl border bg-white p-2">
            {targetLanguages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-sm font-medium">{t("admin.multilingual.search")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.multilingual.searchPlaceholder")} className="mt-1 w-full rounded-xl border bg-white p-2" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm font-medium">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          {t("admin.multilingual.onlyMissing")}
        </label>
        <div className="pb-2 text-sm text-slate-600">
          {tf("admin.multilingual.coverage", { count: translatedCount, total: rows.length, pct: coveragePct })}
        </div>
      </div>

      {uiLanguage && uiLanguage !== selectedLang && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {tf("admin.multilingual.languageMismatch", {
            ui: UI_LANGUAGES.find((lang) => lang.code === uiLanguage)?.label || uiLanguage,
            target: targetLanguages.find((lang) => lang.code === selectedLang)?.label || selectedLang,
          })}
        </div>
      )}

      <div className="mt-4 max-h-[600px] space-y-2 overflow-auto pr-1">
        {filteredRows.map((row) => (
          <div key={row.key} className="rounded-xl border bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-xs text-slate-500">{row.key}</div>
              <div className="flex items-center gap-2">
                {savedKey === row.key && <StatusPill tone="good"><Check className="mr-1 h-3 w-3" />{t("admin.multilingual.saved")}</StatusPill>}
                {row.missing && savedKey !== row.key && <StatusPill tone="warn">{t("admin.multilingual.needsReview")}</StatusPill>}
              </div>
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{row.en}</div>
              <input
                defaultValue={row.value}
                key={`${row.key}-${refreshTick}`}
                disabled={savingKey === row.key}
                onBlur={(e) => { if (e.target.value !== row.value) saveTranslation(row.key, e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                placeholder={t("admin.multilingual.targetPlaceholder")}
                className="w-full rounded-xl border bg-white p-2"
              />
            </div>
          </div>
        ))}
        {!filteredRows.length && <div className="rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">{t("admin.multilingual.noResults")}</div>}
      </div>
    </div>
  );
}

function AdminView({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, availableVariants, variants, testImportStatus, testImportError, testImportSummary, importTestPackage, setStatus, addAudit, uiLanguage, t, adminPdfPackageLatest, setAdminPdfPackageStatus, setAdminPdfPackageError, setAdminPdfPackageLatest }) {
  const [activeAdminSection, setActiveAdminSection] = useState("package-authoring");

  return (
    <>
      <AdminDashboardSection
        id="package-authoring"
        icon={FileSpreadsheet}
        t={t}
        title={t("admin.dashboard.authoring.title")}
        description={t("admin.dashboard.authoring.description")}
        activeSection={activeAdminSection}
        setActiveSection={setActiveAdminSection}
      >
        <AdminStructuredPackagePanel
          adminPdfPackageLatest={adminPdfPackageLatest}
          setAdminPdfPackageLatest={setAdminPdfPackageLatest}
          setAdminPdfPackageStatus={setAdminPdfPackageStatus}
          setAdminPdfPackageError={setAdminPdfPackageError}
          centre={centre}
          uiLanguage={uiLanguage}
          t={t}
        />
      </AdminDashboardSection>

      <AdminDashboardSection
        id="exam-opening"
        icon={ShieldCheck}
        t={t}
        title={t("admin.dashboard.examOpening.title")}
        description={t("admin.dashboard.examOpening.description")}
        activeSection={activeAdminSection}
        setActiveSection={setActiveAdminSection}
      >
        <AdminExamOpeningPanel
          centre={centre}
          setCentre={setCentre}
          examDate={examDate}
          setExamDate={setExamDate}
          place={place}
          setPlace={setPlace}
          language={language}
          setLanguage={setLanguage}
          setStatus={setStatus}
          addAudit={addAudit}
          t={t}
        />
      </AdminDashboardSection>

      <AdminDashboardSection
        id="translation"
        icon={Languages}
        t={t}
        title={t("admin.dashboard.translation.title")}
        description={t("admin.dashboard.translation.description")}
        activeSection={activeAdminSection}
        setActiveSection={setActiveAdminSection}
      >
        <AdminTranslationPanel uiLanguage={uiLanguage} t={t} />
      </AdminDashboardSection>
    </>
  );
}


const OUTDOOR_CENTRE_RESULT_KEY = "vetbara.outdoorCentreResults.v1";
const EXAMINER_RESULT_KEY = "vetbara.examinerResults.v1";
const WRITTEN_QUESTION_SCORES_KEY = "vetbara.writtenQuestionScores.v1";
// How many physical pages a candidate's printed test runs to, keyed by candidate id. Nothing in
// the browser can report an exact page count back from window.print() (pagination is realized
// only by the print/PDF renderer, never exposed to JS), so this has to come from the operator —
// but it is the SAME number every time the same candidate's already-printed test is scanned, so
// it is persisted here instead of resetting to blank (forcing a re-type) on every Centre reload.
const SCAN_EXPECTED_PAGES_KEY = "vetbara.scanExpectedPages.v1";

// Examiner's marks for the Consulting report, per candidate:
// { [treeName]: { [sectionKey]: { score, comment } }, clarity: { [itemKey]: score } }.
const REPORT_MARKS_KEY = "vetbara.reportMarks.v1";

function readReportMarks(candidateId) {
  if (typeof window === "undefined" || !candidateId) return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedCacheKey(REPORT_MARKS_KEY)) || "{}");
    const row = all?.[candidateId];
    return row && typeof row === "object" && !Array.isArray(row) ? row : {};
  } catch {
    return {};
  }
}

function writeReportMarks(candidateId, marks) {
  if (typeof window === "undefined" || !candidateId) return;
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedCacheKey(REPORT_MARKS_KEY)) || "{}");
    window.localStorage.setItem(scopedCacheKey(REPORT_MARKS_KEY), JSON.stringify({ ...all, [candidateId]: marks }));
  } catch { /* private mode - marks stay in component state for this session */ }
}

function reportMarksTotal(marks) {
  const perTree = REPORT_TREES.reduce((sum, treeName) => sum
    + REPORT_MARKING_SECTIONS.reduce((inner, section) => {
      const mark = marks?.[treeName]?.[section.key];
      return inner + (section.key === "plan" ? reportPlanScore(mark) : (Number(mark?.score) || 0));
    }, 0), 0);
  const clarity = REPORT_CLARITY_ITEMS.reduce((sum, item) => sum + (Number(marks?.clarity?.[item.key]) || 0), 0);
  return perTree + clarity;
}

// These browser caches used to be keyed by candidate id alone, so opening two certifications in
// the same browser mixed their results (candidate ids repeat across exams — C-001 exists in both).
// Every cache key is now suffixed with the active exam, set when a session is resolved.
let activeExamScope = "";
function setActiveExamScope(scope) {
  activeExamScope = String(scope || "").replace(/[^A-Za-z0-9._-]+/g, "-");
}
function getActiveExamScope() {
  return activeExamScope;
}
function scopedCacheKey(baseKey) {
  return activeExamScope ? `${baseKey}.${activeExamScope}` : baseKey;
}
const EXAMINER_FORM_UNLOCK_PASSWORD = "Vetarbo";

// Per-question written-test marks the examiner enters, kept per candidate so they survive leaving
// and re-opening the review (otherwise the local component state reset to {} and every mark showed
// as 0 on return).
function readWrittenQuestionScores(candidateId) {
  if (typeof window === "undefined" || !candidateId) return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedCacheKey(WRITTEN_QUESTION_SCORES_KEY)) || "{}");
    const row = all?.[candidateId];
    return row && typeof row === "object" && !Array.isArray(row) ? row : {};
  } catch {
    return {};
  }
}

function writeWrittenQuestionScores(candidateId, scores) {
  if (typeof window === "undefined" || !candidateId) return;
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedCacheKey(WRITTEN_QUESTION_SCORES_KEY)) || "{}");
    const next = { ...(all && typeof all === "object" && !Array.isArray(all) ? all : {}), [candidateId]: scores || {} };
    window.localStorage.setItem(scopedCacheKey(WRITTEN_QUESTION_SCORES_KEY), JSON.stringify(next));
  } catch {
    /* ignore quota/serialization errors — the in-memory copy still works this session */
  }
}

function readExaminerResultsLocal() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(scopedCacheKey(EXAMINER_RESULT_KEY));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeExaminerResultLocal(record) {
  if (typeof window === "undefined" || !record?.candidateId || !record?.field) return readExaminerResultsLocal();
  const current = readExaminerResultsLocal();
  const candidateId = String(record.candidateId);
  const field = String(record.field);
  const candidateRows = current[candidateId] && typeof current[candidateId] === "object" ? current[candidateId] : {};
  const prior = candidateRows[field] && typeof candidateRows[field] === "object" ? candidateRows[field] : {};
  const next = {
    ...current,
    [candidateId]: {
      ...candidateRows,
      [field]: {
        ...prior,
        ...record,
        candidateId,
        field,
        value: record.value === "" || record.value === null || record.value === undefined ? null : Number(record.value),
        max: record.max === "" || record.max === null || record.max === undefined ? prior.max ?? null : Number(record.max),
        updatedAt: record.updatedAt || new Date().toISOString(),
      },
    },
  };
  window.localStorage.setItem(scopedCacheKey(EXAMINER_RESULT_KEY), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("vetbara:examiner-results", { detail: next }));
  return next;
}

async function saveExaminerResultToLocalServer(record) {
  if (!record?.candidateId || !record?.field) return null;
  writeExaminerResultLocal(record);
  try {
    const response = await fetch("/api/local-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data?.results) {
      window.localStorage.setItem(scopedCacheKey(EXAMINER_RESULT_KEY), JSON.stringify(data.results));
      window.dispatchEvent(new CustomEvent("vetbara:examiner-results", { detail: data.results }));
    }
    return data;
  } catch (error) {
    console.warn("Local examiner result save failed; browser cache copy remains available", error);
    return null;
  }
}

async function fetchExaminerResultsFromLocalServer() {
  try {
    const response = await fetch("/api/local-results", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const results = data?.results && typeof data.results === "object" && !Array.isArray(data.results) ? data.results : {};
    if (typeof window !== "undefined") {
      window.localStorage.setItem(scopedCacheKey(EXAMINER_RESULT_KEY), JSON.stringify(results));
      window.dispatchEvent(new CustomEvent("vetbara:examiner-results", { detail: results }));
    }
    return results;
  } catch (error) {
    console.warn("Local examiner result load failed; using browser cache", error);
    return readExaminerResultsLocal();
  }
}

function examinerResultFor(results, candidateId, field) {
  const row = results?.[candidateId]?.[field];
  return row && typeof row === "object" ? row : null;
}

// Reopening a closed examiner form used to demand a shared unlock password, which just blocked
// examiners mid-exam (they legitimately reopen a section to correct an entry). Reopening is
// always allowed now; every change is still audited and synced.
function confirmedReopenAllowed() {
  return true;
}

function readOutdoorCentreResults() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(scopedCacheKey(OUTDOOR_CENTRE_RESULT_KEY));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOutdoorCentreResult(record) {
  if (typeof window === "undefined" || !record?.candidateId) return;
  const current = readOutdoorCentreResults();
  const candidateRows = current[record.candidateId] && typeof current[record.candidateId] === "object" ? current[record.candidateId] : {};
  const examinerKey = record.examinerId || record.mode || "unknown";
  const next = {
    ...current,
    [record.candidateId]: {
      ...candidateRows,
      [examinerKey]: {
        ...candidateRows[examinerKey],
        ...record,
        updatedAt: record.updatedAt || new Date().toISOString(),
      },
    },
  };
  window.localStorage.setItem(scopedCacheKey(OUTDOOR_CENTRE_RESULT_KEY), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("vetbara:outdoor-centre-results", { detail: next }));
}

function outdoorCentreScoresForCandidate(candidateId, storedResults) {
  const rows = storedResults?.[candidateId];
  if (!rows || typeof rows !== "object") return {};
  return Object.values(rows).reduce((next, row) => {
    const scores = row?.scores && typeof row.scores === "object" ? row.scores : {};
    Object.entries(scores).forEach(([itemId, value]) => {
      if (value !== "" && value !== null && value !== undefined) next[itemId] = value;
    });
    return next;
  }, {});
}

function outdoorCentreSubmittedForCandidate(candidateId, storedResults) {
  const rows = storedResults?.[candidateId];
  if (!rows || typeof rows !== "object") return [];
  return Object.values(rows).filter((row) => row?.submittedAt || row?.closedAt);
}

function countReportPhotos(reportDraft) {
  return Object.values(reportDraft ?? {}).reduce((total, tree) => total + (Array.isArray(tree?.photos) ? tree.photos.length : 0), 0);
}

function computeReportReview(reportDraft) {
  const trees = REPORT_TREES.map((treeName) => {
    const tree = reportDraft?.[treeName] ?? { fieldNotes: "", photos: [], finalSections: {} };
    const finalSections = REPORT_SECTIONS.map((section) => ({
      ...section,
      value: tree.finalSections?.[section.key] ?? "",
      filled: Boolean(String(tree.finalSections?.[section.key] ?? "").trim()),
    }));
    const filledSections = finalSections.filter((section) => section.filled).length;

    return {
      treeName,
      fieldNotes: tree.fieldNotes ?? "",
      photos: Array.isArray(tree.photos) ? tree.photos : [],
      finalSections,
      filledSections,
      totalSections: REPORT_SECTIONS.length,
    };
  });

  const filledSections = trees.reduce((sum, tree) => sum + tree.filledSections, 0);
  const totalSections = trees.reduce((sum, tree) => sum + tree.totalSections, 0);
  const photos = trees.reduce((sum, tree) => sum + tree.photos.length, 0);

  return {
    trees,
    filledSections,
    totalSections,
    photos,
    completeness: totalSections ? Math.round((filledSections / totalSections) * 100) : 0,
  };
}

function examinerNameById(examiners, examinerId) {
  return examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId || "-";
}

function repairSplitOutdoorQuestion(rawText, rawNotes) {
  const text = String(rawText || "").trim();
  const notes = String(rawNotes || "").trim();

  if (!text || !notes || text.includes("?")) {
    return { text, notes };
  }

  const questionMarkIndex = notes.indexOf("?");
  if (questionMarkIndex < 0 || questionMarkIndex > 240) {
    return { text, notes };
  }

  const continuation = notes.slice(0, questionMarkIndex + 1).trim();
  const remainingNotes = notes.slice(questionMarkIndex + 1).trim();

  if (!continuation) {
    return { text, notes };
  }

  return {
    text: `${text} ${continuation}`.replace(/\s+/g, " ").trim(),
    notes: remainingNotes,
  };
}

function normalizeAdminOutdoorItem(item, level, index) {
  const section = String(
    item?.section ??
    item?.sectionTitle ??
    item?.exercise ??
    item?.category ??
    "generic"
  ).trim() || "generic";

  const id = String(
    item?.id ??
    item?.itemId ??
    item?.questionId ??
    `${level === "Consulting" ? "C" : "P"}-OUT-${String(index + 1).padStart(2, "0")}`
  );

  const rawText =
    item?.text ??
    item?.question ??
    item?.title ??
    item?.prompt ??
    "";

  const rawNotes =
    item?.notes ??
    item?.examinerGuidance ??
    item?.scoringHelp ??
    item?.guidance ??
    "";

  const repaired = repairSplitOutdoorQuestion(rawText, rawNotes);
  const max = Number(item?.max ?? item?.points ?? item?.marks ?? 0);

  return {
    id,
    section,
    text: repaired.text,
    max: Number.isFinite(max) ? max : 0,
    notes: repaired.notes,
    raw: item,
  };
}

function normalizeAdminOutdoorLevel(outdoorLevel, level) {
  if (!outdoorLevel) return {};

  const sourceItems = Array.isArray(outdoorLevel)
    ? outdoorLevel
    : Array.isArray(outdoorLevel.items)
      ? outdoorLevel.items
      : Array.isArray(outdoorLevel.questions)
        ? outdoorLevel.questions
        : Array.isArray(outdoorLevel.exercises)
          ? outdoorLevel.exercises
          : [];

  const grouped = {};

  if (sourceItems.length > 0) {
    sourceItems
      .map((item, index) => normalizeAdminOutdoorItem(item, level, index))
      .filter((item) => item.text || item.notes)
      .forEach((item) => {
        const key = item.section || "generic";
        grouped[key] = [...(grouped[key] ?? []), item];
      });
  } else if (outdoorLevel && typeof outdoorLevel === "object") {
    Object.entries(outdoorLevel)
      .filter(([key, value]) => !["level", "max", "total", "outdoorMax"].includes(key) && Array.isArray(value))
      .forEach(([section, items]) => {
        const normalizedItems = items
          .map((item, index) => normalizeAdminOutdoorItem({ ...item, section: item?.section ?? section }, level, index))
          .filter((item) => item.text || item.notes);
        if (normalizedItems.length > 0) grouped[section] = normalizedItems;
      });
  }

  // Guard against duplicate item ids across sections. Some authored packages copy-paste an
  // exercise and keep the same id (e.g. Consulting had C-OUT-Q1 three times). Scores are keyed by
  // item.id, so a duplicate makes a score entered in one section show up in every item that shares
  // that id — "type a mark in section 1 and it appears in sections 2 and 3" — and corrupts the
  // total. Give every colliding item a unique, stable runtime id (deterministic by encounter order
  // so saved scores still line up on reload).
  const seenIds = new Map();
  for (const section of Object.keys(grouped)) {
    grouped[section] = grouped[section].map((item) => {
      const baseId = item.id || "item";
      const seen = seenIds.get(baseId) ?? 0;
      seenIds.set(baseId, seen + 1);
      return seen === 0 ? item : { ...item, id: `${baseId}#${seen + 1}` };
    });
  }

  return grouped;
}

function normalizeAdminOutdoorPackage(data) {
  return {
    Practicing: normalizeAdminOutdoorLevel(data?.outdoor?.Practicing, "Practicing"),
    Consulting: normalizeAdminOutdoorLevel(data?.outdoor?.Consulting, "Consulting"),
  };
}

function hasRuntimeOutdoorLevel(levelItems) {
  return Boolean(levelItems && typeof levelItems === "object" && !Array.isArray(levelItems) && Object.values(levelItems).some((items) => Array.isArray(items) && items.length > 0));
}

function isHardcodedOutdoorFallbackLevel(level, levelItems) {
  if (!hasRuntimeOutdoorLevel(levelItems)) return false;
  const fallbackKeys = new Set(Object.keys(OUTDOOR_ITEMS[level] ?? {}));
  const keys = Object.keys(levelItems);
  if (!keys.length || keys.some((key) => !fallbackKeys.has(key))) return false;
  const firstItem = Object.values(levelItems).flat().find(Boolean);
  const firstFallbackItem = Object.values(OUTDOOR_ITEMS[level] ?? {}).flat().find(Boolean);
  return Boolean(firstItem?.id && firstFallbackItem?.id && firstItem.id === firstFallbackItem.id);
}

function isHardcodedOutdoorFallbackBank(bank) {
  return EXAM_LEVELS.some((level) => isHardcodedOutdoorFallbackLevel(level, bank?.[level]));
}

function effectiveOutdoorItemsForLevel(activeOutdoorItems, level) {
  const active = activeOutdoorItems?.[level];
  return hasRuntimeOutdoorLevel(active) ? active : OUTDOOR_ITEMS[level] ?? {};
}

function clampHalfPointScore(value, max) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  const limit = Math.max(0, Number(max ?? 0) || 0);
  const clamped = Math.min(Math.max(parsed, 0), limit);
  return Math.round(clamped * 2) / 2;
}

function outdoorHalfPointOptions(max) {
  const limit = Math.max(0, Number(max ?? 0) || 0);
  const options = [];
  for (let value = 0; value <= limit + 0.0001; value += 0.5) {
    options.push(Math.round(value * 2) / 2);
  }
  const last = options[options.length - 1] ?? 0;
  if (Math.abs(last - limit) > 0.0001) options.push(limit);
  return options;
}

function formatHalfPointScore(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

// Fixed running order for the outdoor session, regardless of the order sections happen to sit
// in the imported package: general oral questions first, then any numbered "Part/Část N"
// (incl. plain "Exercise N"), then the per-tree sections A → B → C → D, then anything else, with
// the catch-all "generic" bucket last. Ties keep their original order (e.g. two Tree B parts).
function outdoorSectionRank(section) {
  const s = String(section || "").toLowerCase();
  if (/oral/.test(s)) return 0;
  const tree = s.match(/(?:^|[^\p{L}])(?:tree|strom)\s*([a-d])(?![\p{L}])/u);
  if (tree) return 200 + (tree[1].charCodeAt(0) - 97);
  // Word-start prefix instead of \b: \b does not work before non-ASCII words like "část".
  const part = s.match(/(?:^|[^\p{L}])(?:part|část|cast|čast|exercise|cvičení|cviceni|úkol|ukol)\s*(\d+)/u);
  if (part) return 100 + Number(part[1]);
  if (s === "generic") return 900;
  return 500;
}

function sortOutdoorSections(sections) {
  return sections
    .map((section, index) => ({ section, index, rank: outdoorSectionRank(section) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.section);
}

function effectiveOutdoorSectionsForLevel(activeOutdoorItems, level) {
  const levelItems = effectiveOutdoorItemsForLevel(activeOutdoorItems, level);
  const sections = Object.keys(levelItems);
  return sections.length ? sortOutdoorSections(sections) : OUTDOOR_SECTIONS[level] ?? [];
}

function outdoorSectionTitle(section) {
  return OUTDOOR_TITLES[section] || section;
}

// Some outdoor exercises are EITHER/OR: the package ships two sections that share the same base
// name and differ only by a trailing parenthetical, e.g.
//   "Tree B - Exercise 2 – Threats exercise (halo)"  vs  "… (soil)".
// The candidate does only ONE variant, so only the examiner-chosen variant may count toward the
// score AND the max (summing both double-counts). These helpers detect such groups by name and
// resolve which variant is active for a candidate.
function outdoorSectionBaseAndVariant(section) {
  const match = String(section ?? "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return match ? { base: match[1].trim(), variant: match[2].trim() } : { base: String(section ?? "").trim(), variant: null };
}

function outdoorVariantGroups(sections) {
  const byBase = new Map();
  for (const section of sections) {
    const { base } = outdoorSectionBaseAndVariant(section);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(section);
  }
  const groups = new Map();
  for (const [base, list] of byBase) {
    if (list.length > 1 && list.some((section) => outdoorSectionBaseAndVariant(section).variant)) groups.set(base, list);
  }
  return groups;
}

function chosenOutdoorVariant(choiceForCandidate, base, groupSections) {
  const chosen = choiceForCandidate?.[base];
  return chosen && groupSections.includes(chosen) ? chosen : groupSections[0];
}

// A section is excluded (not scored) when it belongs to a variant group and is not the chosen one.
function outdoorSectionExcluded(sections, choiceForCandidate, section) {
  const { base } = outdoorSectionBaseAndVariant(section);
  const group = outdoorVariantGroups(sections).get(base);
  if (!group) return false;
  return section !== chosenOutdoorVariant(choiceForCandidate, base, group);
}


const FIELD_LEVELS = ["Practicing", "Consulting"];
const FIELD_TREE_CODES = ["A", "B", "C", "D"];
const FIELD_REQUIRED_ASSIGNMENTS = FIELD_LEVELS.flatMap((level) => FIELD_TREE_CODES.map((code) => ({ level, code })));
// Trees A and B can optionally get a second instance (A2/B2) per level — e.g. two candidates
// working the same exercise on separate trees. Toggled per exam in the tablet's "Přehled stromů"
// section; off by default so nothing changes unless the field team opts in.
// Consulting no longer offers second trees; only Practicing A/B can be doubled. A draft saved
// while the Consulting toggles still existed simply stops producing those extra trees, because
// both the toggle list and `extraFieldTrees` are derived from this one array.
const FIELD_EXTRA_TREE_TOGGLE_KEYS = ["Practicing-A2", "Practicing-B2"];

// Management data (taxon/dimensions/interventions) is only meaningful for the trees the exam
// actually grades that data on: Practicing A (including its doubled A1/A2 instance) and
// Consulting A and B. Every other tree/code hides the section entirely.
function fieldTreeShowsManagementData(level, code) {
  const normalizedLevel = normalizeFieldLevel(level);
  const normalizedCode = String(code || "").toUpperCase();
  if (normalizedLevel === "Practicing") return normalizedCode === "A" || normalizedCode === "A2";
  return normalizedCode === "A" || normalizedCode === "B";
}

// --- Map tile memory cache -------------------------------------------------------------------
// Tiles used to be fetched again every time a pan pushed them out of the rendered window or a zoom
// change rebuilt the whole set, which is what made the field map stutter and flash blank. Holding a
// decoded Image per URL keeps the bytes in the browser's memory cache, so re-creating an <img> for
// that URL paints immediately instead of hitting the network.
const FIELD_TILE_CACHE = new Map();
// ~3 zoom levels of a 9x7 window plus room for whatever the operator pans over.
const FIELD_TILE_CACHE_LIMIT = 900;
// The window kept warm around the exam centre, matching the rendered tile window.
const FIELD_TILE_HALF_X = 4;
const FIELD_TILE_HALF_Y = 3;
// The deepest zoom the tablet allows and the two above it — the band the examiner works in when
// walking between trees, and where re-fetching hurts most (each level has 4x the tiles).
const FIELD_PREFETCH_ZOOMS = [21, 20, 19];

function retainFieldTile(url) {
  if (!url) return null;
  const cached = FIELD_TILE_CACHE.get(url);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  FIELD_TILE_CACHE.set(url, image);
  while (FIELD_TILE_CACHE.size > FIELD_TILE_CACHE_LIMIT) {
    const oldest = FIELD_TILE_CACHE.keys().next().value;
    FIELD_TILE_CACHE.delete(oldest);
  }
  return image;
}

// Warm the cache a few tiles at a time: firing ~190 requests at once would saturate the tablet's
// connection pool and stall the tiles the operator is actually looking at.
async function prefetchFieldTiles(urls, { concurrency = 6, control } = {}) {
  const queue = urls.filter((url) => !FIELD_TILE_CACHE.has(url));
  let index = 0;
  const worker = async () => {
    while (index < queue.length && !control?.aborted) {
      const url = queue[index];
      index += 1;
      await new Promise((resolve) => {
        const image = retainFieldTile(url);
        if (!image || image.complete) { resolve(); return; }
        // A tile request that neither loads nor errors (a throttling tile server, a flaky field
        // connection) would otherwise pin one of the few workers forever and stall the whole
        // warm-up — observed as the prefetch stopping part-way through a zoom level.
        const timer = window.setTimeout(finish, 10000);
        function finish() { window.clearTimeout(timer); resolve(); }
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

function overviewTreeLabel(tree, extraToggles = {}) {
  const levelPrefix = normalizeFieldLevel(tree.level)[0];
  const code = String(tree.code || "").toUpperCase();
  if (code === "A" || code === "B") {
    const toggleKey = `${normalizeFieldLevel(tree.level)}-${code}2`;
    if (FIELD_EXTRA_TREE_TOGGLE_KEYS.includes(toggleKey) && extraToggles[toggleKey]) return `${levelPrefix}-${code}1`;
  }
  return `${levelPrefix}-${code}`;
}

function normalizeFieldLevel(level) {
  return String(level || "Practicing").toLowerCase() === "consulting" ? "Consulting" : "Practicing";
}

function fieldTreeKey(treeOrLevel, maybeCode) {
  const level = typeof treeOrLevel === "object" ? treeOrLevel?.level : treeOrLevel;
  const code = typeof treeOrLevel === "object" ? treeOrLevel?.code : maybeCode;
  return `${normalizeFieldLevel(level)}-${String(code || "A").toUpperCase()}`;
}

function fieldTreeLabel(level, code) {
  return `${normalizeFieldLevel(level)[0]}-${String(code || "A").toUpperCase()}`;
}


// Field tablet text now lives in src/i18n.js under the "fieldTablet.*" namespace (single
// translation source for the whole app). This stays as a thin lookup so the ~30 existing
// tt("key") call sites throughout FieldTabletPage don't need to change.
function fieldTabletText(t, key) {
  return t(`fieldTablet.${key}`);
}

function formatLatLngPair(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return "";
  return `${latNum}, ${lngNum}`;
}

function parseLatLngPair(text) {
  const match = String(text || "").trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function copyPlainTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path used on http:// LAN addresses.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch {
    // Some tablet browsers reject programmatic clipboard access on insecure LAN URLs.
  }
  return false;
}

// Top-level (not nested in FieldTabletPage) so it keeps its identity across re-renders and
// never loses focus mid-edit. Uses defaultValue + onBlur-commit instead of a fully controlled
// value so typing isn't fought by the parent re-rendering on every keystroke; the `key` prop
// resyncs the field only when the underlying lat/lng actually changes (drag, GPS, paste-elsewhere).
function FieldCoordsCopyField({ lat, lng, onApply, onCopyResult, tt }) {
  const inputRef = useRef(null);
  const displayValue = formatLatLngPair(lat, lng);
  const [copyState, setCopyState] = useState("idle");

  function commit(rawValue) {
    const parsed = parseLatLngPair(rawValue);
    if (parsed) {
      onApply(parsed);
    } else if (inputRef.current) {
      inputRef.current.value = displayValue;
    }
  }

  return (
    <label className="field-detail-field">
      <span>{tt("copyCoords")}</span>
      <div className="field-copy-row">
        <input
          ref={inputRef}
          key={displayValue}
          defaultValue={displayValue}
          placeholder="49.1607651629466, 16.37570057063239"
          onFocus={(event) => event.target.select()}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(event.target.value); } }}
        />
        <button type="button" onClick={() => commit(inputRef.current?.value)}>
          {tt("apply")}
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyPlainTextToClipboard(inputRef.current?.value || displayValue);
            onCopyResult?.(ok);
            setCopyState(ok ? "copied" : "failed");
            window.setTimeout(() => setCopyState("idle"), 1800);
          }}
        >
          {copyState === "copied" ? `✓ ${tt("copy")}` : tt("copy")}
        </button>
      </div>
    </label>
  );
}

const FIELD_LABEL_DIRECTIONS = [
  ["n", "Above"],
  ["ne", "Above right"],
  ["e", "Right"],
  ["se", "Below right"],
  ["s", "Below"],
  ["sw", "Below left"],
  ["w", "Left"],
  ["nw", "Above left"],
];

const FIELD_MARKER_LABEL_OFFSETS = {
  n: { x: 0, y: -54 },
  ne: { x: 54, y: -54 },
  e: { x: 66, y: 0 },
  se: { x: 54, y: 54 },
  s: { x: 0, y: 54 },
  sw: { x: -54, y: 54 },
  w: { x: -66, y: 0 },
  nw: { x: -54, y: -54 },
};

function fieldMarkerVisualStyle(direction = "n", offsetX = 0, offsetY = 0) {
  const base = FIELD_MARKER_LABEL_OFFSETS[direction] || FIELD_MARKER_LABEL_OFFSETS.n;
  const x = base.x + (Number(offsetX) || 0);
  const y = base.y + (Number(offsetY) || 0);
  const distance = Math.hypot(x, y);
  return {
    "--label-x": `${x}px`,
    "--label-y": `${y}px`,
    "--stem-length": `${Math.max(14, distance - 26)}px`,
    "--stem-angle": `${Math.atan2(y, x) * 180 / Math.PI}deg`,
  };
}

function findMissingFieldAssignment(prep) {
  const trees = fieldEnsureArray(prep?.trees);
  return FIELD_REQUIRED_ASSIGNMENTS.find(({ level, code }) => !trees.some((tree) => fieldEnsureArray(tree.assignments).some((assignment) => assignment.level === level && assignment.code === code))) || null;
}

// Standard row layout of the 8 required trees around the exam centre (degrees). Used for
// placeholder trees and as the recovery layout in "Move all trees here" when a tree's stored
// coordinates are corrupt or absurdly far from the centre.
const FIELD_STANDARD_TREE_OFFSETS = {
  "Practicing-A": { lat: 0.00025, lng: 0.00025 },
  "Practicing-B": { lat: 0.00045, lng: 0.00055 },
  "Practicing-C": { lat: 0.00015, lng: 0.00078 },
  "Practicing-D": { lat: -0.00018, lng: 0.00055 },
  "Consulting-A": { lat: 0.00005, lng: -0.00025 },
  "Consulting-B": { lat: 0.00033, lng: -0.00048 },
  "Consulting-C": { lat: -0.00012, lng: -0.00062 },
  "Consulting-D": { lat: -0.00038, lng: -0.00028 },
};

// Fallback offset for any tree key, including second-tree instances ("Practicing-A2" → the base
// "Practicing-A" offset nudged slightly aside so the two don't overlap).
function fieldStandardOffsetForKey(key) {
  const direct = FIELD_STANDARD_TREE_OFFSETS[key];
  if (direct) return direct;
  const match = String(key || "").match(/^(Practicing|Consulting)-([A-D])\d*$/);
  const base = match ? FIELD_STANDARD_TREE_OFFSETS[`${match[1]}-${match[2]}`] : null;
  if (base) return { lat: base.lat + 0.00007, lng: base.lng + 0.00007 };
  return { lat: 0.0002, lng: 0.0002 };
}

function limitFieldTreesToRequiredCodes(trees, level = "Practicing", center = {}) {
  const source = fieldEnsureArray(trees);
  const includeAll = String(level || "").toLowerCase() === "all";
  const levels = includeAll ? FIELD_LEVELS : [normalizeFieldLevel(level)];
  const centerLat = Number(center?.latitude ?? center?.lat);
  const centerLng = Number(center?.longitude ?? center?.lng);
  const baseLat = Number.isFinite(centerLat) ? centerLat : 49.405888;
  const baseLng = Number.isFinite(centerLng) ? centerLng : 15.128912;
  const offsets = FIELD_STANDARD_TREE_OFFSETS;
  return levels.flatMap((requiredLevel) => FIELD_TREE_CODES.map((code) => {
    const key = fieldTreeKey(requiredLevel, code);
    const existing = source.find((tree) => fieldTreeKey(tree) === key || (String(tree.code || "").toUpperCase() === code && normalizeFieldLevel(tree.level || requiredLevel) === requiredLevel));
    if (existing) return { ...existing, level: requiredLevel, code, key };
    const offset = offsets[key] || { lat: 0, lng: 0 };
    return {
      id: `required-${requiredLevel.toLowerCase()}-${code}`,
      key,
      level: requiredLevel,
      code,
      name: `${requiredLevel} ${code}`,
      latitude: baseLat + offset.lat,
      longitude: baseLng + offset.lng,
      candidateNote: "",
      photos: [],
      managementData: { interventions: [] },
      labelDirection: "n",
      labelOffsetX: 0,
      labelOffsetY: 0,
      placeholder: true,
    };
  }));
}

function vetbaraUid(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// A stable per-BROWSER (not per-session) identifier for the device-bound QR PIN feature (see the
// 20260802 migration / api/qr/resolve.js) - generated once, kept in localStorage indefinitely, so
// the SAME phone/tablet is recognised as the same device across logins, exam days and reloads,
// and only a genuinely different browser/device ever has to deal with the PIN prompt at all.
function getOrCreateDeviceId() {
  try {
    const key = "vetbara-device-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const fresh = vetbaraUid("device");
    window.localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private browsing / storage blocked: a fresh id every call means this device will always
    // look "new" to the PIN gate. Acceptable - fail-open in evaluateDeviceAccess means it can
    // only ever add PIN friction, never lock this device out.
    return vetbaraUid("device");
  }
}

function parseFieldCoordinates(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// The CUZK orthophoto tile service only covers Czech territory (it returns blank/error tiles
// everywhere else), so any map that might be positioned outside CZ needs to fall back to a
// general-coverage provider (OpenStreetMap) instead. Bounding box is intentionally a bit
// generous around the real CZ borders (roughly 48.5-51.06 N, 12.09-18.87 E) to avoid flipping
// providers right at the border.
function isWithinCzechRepublic(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return true;
  return latNum >= 48.3 && latNum <= 51.3 && lngNum >= 11.8 && lngNum <= 19.1;
}

function formatFieldCoordinates(point) {
  if (!Number.isFinite(Number(point?.lat)) || !Number.isFinite(Number(point?.lng))) return "-";
  return `${Number(point.lat).toFixed(9)}, ${Number(point.lng).toFixed(9)}`;
}

function createFieldAssignment(level = "Practicing", code = "A") {
  return { id: vetbaraUid("field-assignment"), level, code, visibleToCandidate: true };
}

function createFieldTree(index = 1, assignment = createFieldAssignment("Practicing", "A")) {
  return {
    id: vetbaraUid("field-tree"),
    name: `Tree ${index}`,
    point: { x: Math.min(86, 20 + index * 12), y: Math.min(78, 22 + index * 8), lat: 49.406706323273454 + index * 0.00008, lng: 15.129055089456797 + index * 0.00008 },
    candidateNote: "",
    internalNote: "",
    photos: [],
    assignments: [assignment],
    practicingTreeAData: assignment.level === "Practicing" && assignment.code === "A" ? createPracticingTreeAData() : null,
  };
}

function createPracticingTreeAData() {
  return {
    taxon: "",
    heightM: "",
    stemDiameterCm: "",
    crownSpreadM: "",
    note: "",
    interventions: [{ id: vetbaraUid("intervention"), technology: "", description: "", orderIndex: 1 }],
  };
}

function createDefaultFieldPreparation({ examId = "ARBOR-2026", centre = "Arboricultural Academy", language = "EN" } = {}) {
  return {
    kind: "vetbara.fieldPreparation.v1",
    id: vetbaraUid("field-prep"),
    examId,
    siteName: `${centre} - field site`,
    referenceLatitude: 49.406706323273454,
    referenceLongitude: 15.129055089456797,
    mapProvider: "CUZK_ORTHO",
    status: "DRAFT",
    language,
    updatedAt: new Date().toISOString(),
    updatedBy: "Centre",
    examCenter: {
      id: vetbaraUid("field-center"),
      name: "Exam centre / registration",
      point: { x: 12, y: 18, lat: 49.405888298283934, lng: 15.128912434693621 },
      candidateNote: "Candidate meeting point.",
      internalNote: "",
      photos: [],
    },
    trees: [
      createFieldTree(1, createFieldAssignment("Practicing", "A")),
      createFieldTree(2, createFieldAssignment("Practicing", "B")),
      createFieldTree(3, createFieldAssignment("Practicing", "C")),
      createFieldTree(4, createFieldAssignment("Practicing", "D")),
      createFieldTree(5, createFieldAssignment("Consulting", "A")),
      createFieldTree(6, createFieldAssignment("Consulting", "B")),
      createFieldTree(7, createFieldAssignment("Consulting", "C")),
      createFieldTree(8, createFieldAssignment("Consulting", "D")),
    ],
  };
}

function fieldTreeDisplayName(tree) {
  const labels = fieldTreeLabels(tree);
  if (labels.length) return labels.join(" / ");
  const level = normalizeFieldLevel(tree?.level)[0];
  const code = String(tree?.code || "").toUpperCase();
  return code ? `${level}-${code}` : "";
}

function fieldTreeLabels(tree) {
  return (tree.assignments || []).map((assignment) => `${assignment.level === "Practicing" ? "P" : "C"}-${assignment.code}`);
}

function fieldPreparationValidationIssues(prep, t) {
  const issues = [];
  const center = prep?.examCenter;
  if (!center?.point || !Number.isFinite(Number(center.point.lat)) || !Number.isFinite(Number(center.point.lng))) {
    issues.push({ severity: "error", message: t("fieldPrep.issue.centerNoCoords") });
  }

  for (const tree of prep?.trees || []) {
    if (!Number.isFinite(Number(tree.point?.lat)) || !Number.isFinite(Number(tree.point?.lng))) {
      issues.push({ severity: "error", message: `${tree.name || t("fieldPrep.tree")} ${t("fieldPrep.issue.treeNoCoordsSuffix")}` });
    }
  }

  for (const level of FIELD_LEVELS) {
    for (const code of FIELD_TREE_CODES) {
      const matches = (prep?.trees || []).filter((tree) => (tree.assignments || []).some((assignment) => assignment.level === level && assignment.code === code));
      if (matches.length === 0) issues.push({ severity: "error", message: `${t("fieldPrep.issue.missingTreePrefix")} ${level} ${t("fieldPrep.tree")} ${code}.` });
      if (matches.length > 1) issues.push({ severity: "warning", message: `${level} ${t("fieldPrep.tree")} ${code} ${t("fieldPrep.issue.assignedMoreThanOnce")}` });
    }
  }

  const practicingA = (prep?.trees || []).find((tree) => (tree.assignments || []).some((assignment) => assignment.level === "Practicing" && assignment.code === "A"));
  const data = practicingA?.practicingTreeAData;
  if (!data) {
    issues.push({ severity: "error", message: t("fieldPrep.issue.practicingANoData") });
  } else {
    if (!String(data.taxon || "").trim()) issues.push({ severity: "error", message: t("fieldPrep.issue.practicingAMissingTaxon") });
    if (data.heightM === "" || data.heightM === null || data.heightM === undefined) issues.push({ severity: "error", message: t("fieldPrep.issue.practicingAMissingHeight") });
    if (data.stemDiameterCm === "" || data.stemDiameterCm === null || data.stemDiameterCm === undefined) issues.push({ severity: "error", message: t("fieldPrep.issue.practicingAMissingDiameter") });
    if (data.crownSpreadM === "" || data.crownSpreadM === null || data.crownSpreadM === undefined) issues.push({ severity: "error", message: t("fieldPrep.issue.practicingAMissingCrown") });
    if (!Array.isArray(data.interventions) || data.interventions.length === 0 || data.interventions.every((item) => !String(item.technology || "").trim())) {
      issues.push({ severity: "error", message: t("fieldPrep.issue.practicingAMissingIntervention") });
    }
  }

  return issues;
}

function createFieldCandidatePackage(prep, level) {
  const normalizedLevel = normalizeFieldLevel(level);
  const sourceTrees = fieldEnsureArray(prep?.trees);
  const visibleTrees = FIELD_TREE_CODES.map((code) => {
    const tree = sourceTrees.find((item) => fieldEnsureArray(item.assignments).some((assignment) => assignment.level === normalizedLevel && assignment.code === code && assignment.visibleToCandidate !== false));
    if (!tree) return null;
    return {
      id: tree.id,
      code,
      name: tree.name,
      latitude: Number(tree.point?.lat),
      longitude: Number(tree.point?.lng),
      candidateNote: tree.candidateNote || "",
      photos: fieldEnsureArray(tree.photos).map((photo) => ({ id: photo.id, fileName: photo.fileName || photo.name, url: photo.url, thumbnailUrl: photo.thumbnailUrl, caption: photo.caption || "" })),
      practicingTreeAData: normalizedLevel === "Practicing" && code === "A" ? tree.practicingTreeAData : undefined,
    };
  }).filter(Boolean);

  return {
    packageType: "vetbara-field-exam",
    packageVersion: "1.0",
    examId: prep.examId,
    level: normalizedLevel.toUpperCase(),
    siteName: prep.siteName,
    createdAt: new Date().toISOString(),
    examCenter: {
      latitude: Number(prep.examCenter?.point?.lat),
      longitude: Number(prep.examCenter?.point?.lng),
      candidateNote: prep.examCenter?.candidateNote || "",
      photos: prep.examCenter?.photos || [],
    },
    trees: visibleTrees,
  };
}

function downloadFieldJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fieldTabletStorageKey(type, examId, level) {
  return `vetbara.fieldTablet.${type}.${examId || "exam"}.${level || "Practicing"}`;
}

function fieldTabletQueueKey() {
  return "vetbara.fieldTablet.syncQueue";
}

// The portable LAN server (server.cjs) injects window.__VETBARA_PORTABLE__.baseUrl with the
// LAN IP it detected, regardless of which host (localhost, 127.0.0.1, or the LAN IP) the
// operator's own browser happens to be on. Preferring it over window.location keeps generated
// QR links/URLs scannable from other devices even when the operator opened this page via
// localhost — otherwise the link bakes in "localhost", which on a tablet means the tablet itself.
export function portableLanOrigin() {
  try {
    const base = typeof window !== "undefined" && window.__VETBARA_PORTABLE__?.baseUrl;
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

function fieldTabletUrl({ examId, level = "Practicing", token = CENTRE_ACCESS_TOKEN } = {}) {
  const url = new URL(window.location.href);
  const lanOrigin = portableLanOrigin();
  if (lanOrigin) url.href = lanOrigin;
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "field-tablet");
  url.searchParams.set("examId", safeExamId(examId));
  url.searchParams.set("level", level);
  url.searchParams.set("token", token || CENTRE_ACCESS_TOKEN);
  return url.toString();
}

function readJsonLocalStorage(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function isQuotaExceededError(error) {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22);
}

// Cache keys scoped per exam (see scopedCacheKey) mean a device reused across certifications - the
// same shared tablet, exam after exam - keeps accumulating one full field-map package per past
// exam, none of which are ever read again. That alone can exhaust this origin's whole localStorage
// quota, which surfaced as "Field map package could not be downloaded: The quota has been exceeded"
// on a candidate who had done nothing wrong. On QuotaExceededError, drop this same key's OTHER
// exam-scoped copies (same candidate+level, different exam) before retrying once - always safe,
// since only the current exam's copy is ever read back.
function writeJsonLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    try {
      const siblingPrefix = key.replace(/\.[^.]*$/, "");
      for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
        const existingKey = window.localStorage.key(i);
        if (existingKey && existingKey !== key && existingKey.startsWith(siblingPrefix)) {
          window.localStorage.removeItem(existingKey);
        }
      }
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      throw error;
    }
  }
}

function appendFieldTabletSyncQueue(entry) {
  const key = fieldTabletQueueKey();
  const current = readJsonLocalStorage(key, []);
  writeJsonLocalStorage(key, [...(Array.isArray(current) ? current : []), entry]);
}

function readFieldTabletSyncQueue() {
  const value = readJsonLocalStorage(fieldTabletQueueKey(), []);
  return Array.isArray(value) ? value : [];
}

function clearFieldTabletSyncQueue() {
  writeJsonLocalStorage(fieldTabletQueueKey(), []);
}

function fieldEnsureArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.values(value).filter((item) => item && typeof item === "object");
}

function centreMapPointFromLatLng(point, referenceLatitude, referenceLongitude) {
  const refLat = Number(referenceLatitude);
  const refLng = Number(referenceLongitude);
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);
  if (!Number.isFinite(refLat) || !Number.isFinite(refLng) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { x: Number(point?.x ?? 50), y: Number(point?.y ?? 50), lat, lng };
  }
  return {
    ...point,
    lat,
    lng,
    x: Math.min(96, Math.max(4, 50 + ((lng - refLng) / 0.000026))),
    y: Math.min(92, Math.max(8, 50 - ((lat - refLat) / 0.000018))),
  };
}

function normalizeFieldPreparationForCentreMap(preparation) {
  const prep = preparation && typeof preparation === "object" ? preparation : {};
  const centerSource = prep.examCenter || {};
  const centerPointSource = centerSource.point || {};
  const referenceLatitude = Number(prep.referenceLatitude ?? centerPointSource.lat ?? centerPointSource.latitude ?? centerSource.latitude ?? centerSource.lat ?? 49.40670632327345);
  const referenceLongitude = Number(prep.referenceLongitude ?? centerPointSource.lng ?? centerPointSource.longitude ?? centerSource.longitude ?? centerSource.lng ?? 15.129135089456797);
  const normalized = {
    ...prep,
    referenceLatitude,
    referenceLongitude,
    examCenter: {
      ...(prep.examCenter || {}),
      point: centreMapPointFromLatLng({
        ...(centerPointSource || {}),
        lat: centerPointSource.lat ?? centerPointSource.latitude ?? centerSource.latitude ?? centerSource.lat,
        lng: centerPointSource.lng ?? centerPointSource.longitude ?? centerSource.longitude ?? centerSource.lng,
      }, referenceLatitude, referenceLongitude),
    },
    trees: fieldEnsureArray(prep.trees).map((tree) => {
      const pointSource = tree.point || {};
      return {
        ...tree,
        point: centreMapPointFromLatLng({
          ...(pointSource || {}),
          lat: pointSource.lat ?? pointSource.latitude ?? tree.latitude ?? tree.lat,
          lng: pointSource.lng ?? pointSource.longitude ?? tree.longitude ?? tree.lng,
        }, referenceLatitude, referenceLongitude),
      };
    }),
  };
  return normalized;
}


function CentreFieldPreparationModule({ prep, setPrep, autoLoadRef, centreCode, language, sessionToken, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [selectedTreeId, setSelectedTreeId] = useState(() => fieldEnsureArray(prep.trees)[0]?.id || "");
  const [coordinateInput, setCoordinateInput] = useState(`${prep.referenceLatitude}, ${prep.referenceLongitude}`);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tabletLevel, setTabletLevel] = useState("Practicing");
  const [tabletSyncLoadedAt, setTabletSyncLoadedAt] = useState("");
  const [mapLayer, setMapLayer] = useState(() => (isWithinCzechRepublic(prep.referenceLatitude, prep.referenceLongitude) ? "cuzk" : "esri"));
  const mapLayerManualRef = useRef(false);
  // The Centre map was locked at zoom 18, so the operator had no way to frame the site before
  // printing it. This zoom drives the live tiles, the marker positions, marker dragging AND the
  // printed map, so what is framed on screen is what lands in the PDF.
  const [centreMapZoom, setCentreMapZoom] = useState(18);
  const changeCentreMapZoom = (delta) => setCentreMapZoom((current) => Math.max(13, Math.min(19, current + delta)));
  // The map container's onPointerDown starts a pan drag (startCentreDrag) unconditionally on
  // anything pressed inside it. Marker buttons already stop propagation on their own pointerDown,
  // which is how they avoid also starting a pan - the zoom +/- buttons never got the same guard, so
  // a press on them was captured as a pan gesture (preventDefault + setPointerCapture on the
  // container) that frequently ate the click before React's onClick fired. Stops the same class of
  // pointer events the map's own pan/drag handlers listen for, before they can reach the container.
  function stopMapControlEvent(event) {
    event.stopPropagation();
  }
  // World-pixel pan offset at centreMapZoom, on top of the reference-coordinate center - a purely
  // visual "look elsewhere on the map" that never touches prep.referenceLatitude/Longitude or any
  // marker's recorded position. Reset whenever the reference point or zoom changes, so re-centering
  // (via "Najít"/Find) or zooming always returns to a centered view rather than compounding an old pan.
  const [centreViewOffset, setCentreViewOffset] = useState({ x: 0, y: 0 });
  useEffect(() => { setCentreViewOffset({ x: 0, y: 0 }); }, [prep.referenceLatitude, prep.referenceLongitude, centreMapZoom]);
  // Keeps the Reference coordinates field showing the Centre marker's own current position (not a
  // stale value from whatever was searched/typed earlier), so "Najít" naturally re-centers the view
  // on the Centre - see applyCoordinateSearch, which recognizes this as a pure re-center rather than
  // a request to physically relocate the whole site.
  useEffect(() => {
    const point = prep.examCenter?.point;
    const lat = Number(point?.lat ?? point?.latitude);
    const lng = Number(point?.lng ?? point?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setCoordinateInput(formatFieldCoordinates({ lat, lng }));
  }, [prep.examCenter?.point?.lat, prep.examCenter?.point?.lng, prep.examCenter?.point?.latitude, prep.examCenter?.point?.longitude]);
  // ČÚZK only has Czech coverage; if the reference point moves outside CZ, switch to Esri World
  // Imagery (orthophoto across Europe/globe) automatically — unless the operator already picked a
  // layer by hand, which always wins.
  useEffect(() => {
    if (mapLayerManualRef.current) return;
    setMapLayer(isWithinCzechRepublic(prep.referenceLatitude, prep.referenceLongitude) ? "cuzk" : "esri");
  }, [prep.referenceLatitude, prep.referenceLongitude]);
  function selectMapLayer(layer) {
    mapLayerManualRef.current = true;
    setMapLayer(layer);
  }
  const centreMapRef = useRef(null);
  const centreDragRef = useRef(null);
  const centreFieldTrees = fieldEnsureArray(prep.trees);
  const selectedTree = centreFieldTrees.find((tree) => tree.id === selectedTreeId) || null;
  const issues = useMemo(() => fieldPreparationValidationIssues(prep, t), [prep, t]);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const missingAssignment = findMissingFieldAssignment(prep);
  const requiredReadyCount = FIELD_REQUIRED_ASSIGNMENTS.length - FIELD_REQUIRED_ASSIGNMENTS.filter(({ level, code }) => !centreFieldTrees.some((tree) => fieldEnsureArray(tree.assignments).some((assignment) => assignment.level === level && assignment.code === code))).length;

  function updatePrep(patch) {
    setPrep((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }

  function updateTree(treeId, updater) {
    setPrep((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      trees: fieldEnsureArray(current.trees).map((tree) => tree.id === treeId ? (typeof updater === "function" ? updater(tree) : { ...tree, ...updater }) : tree),
    }));
  }

  function addTree() {
    const missing = findMissingFieldAssignment(prep);
    if (!missing) {
      setError(t("fieldPrep.allRequiredTreesReady"));
      return;
    }
    const tree = createFieldTree(centreFieldTrees.length + 1, createFieldAssignment(missing.level, missing.code));
    setPrep((current) => ({ ...current, updatedAt: new Date().toISOString(), trees: [...fieldEnsureArray(current.trees), tree] }));
    setSelectedTreeId(tree.id);
  }

  function removeTree(treeId) {
    setPrep((current) => ({ ...current, updatedAt: new Date().toISOString(), trees: fieldEnsureArray(current.trees).filter((tree) => tree.id !== treeId) }));
    setSelectedTreeId(centreFieldTrees.find((tree) => tree.id !== treeId)?.id || "");
  }

  // Add an extra tree — e.g. a SECOND instance of an exercise (two candidates working the same
  // Practicing/Consulting code on separate trees). Duplicates the selected tree's assignment and
  // offsets its position; unlike the old addTree() this always adds (it never blocks once all the
  // required A–D trees exist), which is what the Centre operator needs to place a second tree.
  function addAnotherTree() {
    const base = selectedTree && selectedTree.id !== "__center__" ? selectedTree : centreFieldTrees[centreFieldTrees.length - 1] || null;
    const index = centreFieldTrees.length + 1;
    const assignment = base?.assignments?.[0]
      ? createFieldAssignment(base.assignments[0].level, base.assignments[0].code)
      : createFieldAssignment("Practicing", "A");
    const template = createFieldTree(index, assignment);
    const point = base?.point
      ? { x: Math.min(92, Number(base.point.x ?? 40) + 6), y: Math.min(84, Number(base.point.y ?? 40) + 6), lat: Number(base.point.lat ?? prep.referenceLatitude) + 0.00006, lng: Number(base.point.lng ?? prep.referenceLongitude) + 0.00006 }
      : template.point;
    const tree = { ...template, point };
    setPrep((current) => ({ ...current, updatedAt: new Date().toISOString(), trees: [...fieldEnsureArray(current.trees), tree] }));
    setSelectedTreeId(tree.id);
    setError("");
  }

  // Pull the stored preparation as soon as the section is available, so what the tablet synced
  // is what the operator sees. Runs once per exam id (the ref lives in CentreView, which stays
  // mounted), so it can never clobber edits made after that first load.
  useEffect(() => {
    const examId = safeExamId(prep.examId || centreCode || CENTRE_QR_ID);
    if (!autoLoadRef || autoLoadRef.current === examId) return;
    autoLoadRef.current = examId;
    loadFieldPreparation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFieldPreparation() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(safeExamId(prep.examId || centreCode || CENTRE_QR_ID))}/field-preparation`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("fieldPrep.loadFailed"));
      const loaded = normalizeFieldPreparationForCentreMap(data.fieldPreparation || data);
      setPrep(loaded);
      setCoordinateInput(`${loaded.referenceLatitude}, ${loaded.referenceLongitude}`);
      setSelectedTreeId(fieldEnsureArray(loaded.trees)?.[0]?.id || "");
      setStatus(t("fieldPrep.loaded"));
    } catch (err) {
      setError(err.message || t("fieldPrep.loadFailed"));
    }
  }

  async function loadTabletChanges() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(safeExamId(prep.examId || centreCode || CENTRE_QR_ID))}/field-tablet-sync/latest`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("fieldPrep.tabletChangesLoadFailed"));
      const loaded = normalizeFieldPreparationForCentreMap(data.fieldPreparation || data);
      setPrep(loaded);
      setCoordinateInput(`${loaded.referenceLatitude}, ${loaded.referenceLongitude}`);
      setSelectedTreeId(fieldEnsureArray(loaded.trees)?.[0]?.id || "__center__");
      const loadedAt = new Date().toISOString();
      setTabletSyncLoadedAt(loadedAt);
      setStatus(data?.syncId ? tf("fieldPrep.tabletChangesLoadedWithId", { syncId: data.syncId }) : t("fieldPrep.tabletChangesLoaded"));
    } catch (err) {
      setError(err.message || t("fieldPrep.tabletChangesLoadFailed"));
    }
  }

  async function saveFieldPreparation() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(safeExamId(prep.examId || centreCode || CENTRE_QR_ID))}/field-preparation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldPreparation: prep }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("fieldPrep.saveFailed"));
      setPrep(data.fieldPreparation || prep);
      setStatus(t("fieldPrep.saved"));
    } catch (err) {
      setError(err.message || t("fieldPrep.saveFailed"));
    }
  }

  function applyCoordinateSearch(event) {
    event?.preventDefault();
    const parsed = parseFieldCoordinates(coordinateInput);
    if (!parsed) {
      setError(t("fieldPrep.coordinateFormatError"));
      return;
    }
    setError("");

    // The field is kept synced to the Centre marker's own position (see the sync effect above),
    // so "Najít" on an untouched field is just "re-center the view on the Centre", not a request
    // to physically relocate the site - skip the relocate-everything confirm for that case.
    const centerPoint = prep.examCenter?.point || {};
    const centerLat = Number(centerPoint.lat ?? centerPoint.latitude);
    const centerLng = Number(centerPoint.lng ?? centerPoint.longitude);
    const isCentrePoint = Number.isFinite(centerLat) && Number.isFinite(centerLng) && Math.abs(centerLat - parsed.lat) < 1e-9 && Math.abs(centerLng - parsed.lng) < 1e-9;
    if (isCentrePoint) {
      // Reset the pan directly rather than relying on the reference-changed effect: if the
      // reference already equals the Centre's point (nothing panned via search before, only by
      // dragging), the coordinate value here doesn't actually change, so that effect's own
      // dependencies wouldn't fire - "Najít" must still undo a drag-pan even then.
      setCentreViewOffset({ x: 0, y: 0 });
      updatePrep({ referenceLatitude: parsed.lat, referenceLongitude: parsed.lng });
      return;
    }

    const previousLat = Number(prep.referenceLatitude);
    const previousLng = Number(prep.referenceLongitude);
    const hasMoved = Number.isFinite(previousLat) && Number.isFinite(previousLng) && (previousLat !== parsed.lat || previousLng !== parsed.lng);

    if (hasMoved && window.confirm(t("fieldPrep.moveLocationConfirm"))) {
      const deltaLat = parsed.lat - previousLat;
      const deltaLng = parsed.lng - previousLng;
      setPrep((current) => {
        const centerPoint = current.examCenter?.point || {};
        const centerLat = Number(centerPoint.lat ?? centerPoint.latitude);
        const centerLng = Number(centerPoint.lng ?? centerPoint.longitude);
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          referenceLatitude: parsed.lat,
          referenceLongitude: parsed.lng,
          examCenter: {
            ...current.examCenter,
            point: {
              ...centerPoint,
              lat: Number.isFinite(centerLat) ? centerLat + deltaLat : parsed.lat,
              lng: Number.isFinite(centerLng) ? centerLng + deltaLng : parsed.lng,
            },
          },
          trees: fieldEnsureArray(current.trees).map((tree) => {
            const point = tree.point || {};
            const treeLat = Number(point.lat ?? point.latitude);
            const treeLng = Number(point.lng ?? point.longitude);
            return {
              ...tree,
              point: {
                ...point,
                lat: Number.isFinite(treeLat) ? treeLat + deltaLat : parsed.lat,
                lng: Number.isFinite(treeLng) ? treeLng + deltaLng : parsed.lng,
              },
            };
          }),
        };
      });
      return;
    }

    updatePrep({ referenceLatitude: parsed.lat, referenceLongitude: parsed.lng });
  }

  function addAssignment(treeId) {
    updateTree(treeId, (tree) => ({ ...tree, assignments: [...(tree.assignments || []), createFieldAssignment("Practicing", "A")] }));
  }

  function updateAssignment(treeId, assignmentId, patch) {
    updateTree(treeId, (tree) => {
      const assignments = (tree.assignments || []).map((assignment) => assignment.id === assignmentId ? { ...assignment, ...patch } : assignment);
      const isPracticingA = assignments.some((assignment) => assignment.level === "Practicing" && assignment.code === "A");
      return { ...tree, assignments, practicingTreeAData: isPracticingA ? (tree.practicingTreeAData || createPracticingTreeAData()) : tree.practicingTreeAData };
    });
  }

  function removeAssignment(treeId, assignmentId) {
    updateTree(treeId, (tree) => ({ ...tree, assignments: (tree.assignments || []).filter((assignment) => assignment.id !== assignmentId) }));
  }

  function updatePracticingAData(treeId, patch) {
    updateTree(treeId, (tree) => ({ ...tree, practicingTreeAData: { ...(tree.practicingTreeAData || createPracticingTreeAData()), ...patch } }));
  }

  function updateIntervention(treeId, interventionId, patch) {
    const data = selectedTree?.practicingTreeAData || createPracticingTreeAData();
    updatePracticingAData(treeId, {
      interventions: data.interventions.map((item) => item.id === interventionId ? { ...item, ...patch } : item),
    });
  }

  function addIntervention(treeId) {
    const data = selectedTree?.practicingTreeAData || createPracticingTreeAData();
    updatePracticingAData(treeId, {
      interventions: [...data.interventions, { id: vetbaraUid("intervention"), technology: "", description: "", note: "", orderIndex: data.interventions.length + 1 }],
    });
  }

  function removeIntervention(treeId, interventionId) {
    const data = selectedTree?.practicingTreeAData || createPracticingTreeAData();
    updatePracticingAData(treeId, {
      interventions: (data.interventions || []).filter((item) => item.id !== interventionId),
    });
  }

  function handlePhotoUpload(treeId, files) {
    const fileList = Array.from(files ?? []);
    if (!fileList.length) return;
    // Read as base64 data URLs (not ephemeral blob URLs) so photos survive save,
    // reload and field-preparation sync — then push them into the media system.
    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const photo = { id: vetbaraUid("photo"), fileName: file.name, name: file.name, url: dataUrl, dataUrl, caption: "", uploadedAt: new Date().toISOString() };
        updateTree(treeId, (tree) => ({ ...tree, photos: [...(tree.photos || []), photo] }));
        persistFieldPhotoMedia(treeId, photo);
      };
      reader.readAsDataURL(file);
    });
  }

  async function persistFieldPhotoMedia(treeId, photo) {
    let blob;
    try {
      blob = dataUrlToBlob(photo.dataUrl);
    } catch (error) {
      console.warn("Field photo could not be decoded for storage", error);
      return;
    }
    if (!blob || blob.size === 0) return;
    const examId = prep.examId || centreCode || CENTRE_QR_ID;
    const treeObj = fieldEnsureArray(prep.trees).find((tree) => tree.id === treeId);
    const treeCode = treeObj?.assignments?.[0]?.code || treeObj?.code || treeId;
    const clientMediaId = `field-${examId}-${treeId}-${photo.id}`;
    const meta = {
      clientMediaId, type: "photo", mediaType: "photo", candidateId: null, examId,
      sectionKey: "field", tree: treeCode, fileName: photo.fileName || `${examId}_${treeCode}.jpg`,
      mimeType: blob.type, sizeBytes: blob.size, cleaned: false, caption: photo.caption || "",
    };
    await saveLocalMedia({ ...meta, blob, createdAt: photo.uploadedAt });
    if (!sessionToken) return;
    try {
      const uploaded = await uploadExamMedia(sessionToken, meta, blob);
      await updateLocalMedia(clientMediaId, { uploadState: uploaded.stored ? "uploaded" : "local", remoteId: uploaded.id ?? null });
    } catch (error) {
      console.warn("Field photo upload failed; local copy kept", error);
      await updateLocalMedia(clientMediaId, { uploadState: "local" });
    }
  }

  function currentFieldTabletUrl(level = tabletLevel) {
    return fieldTabletUrl({ examId: prep.examId || centreCode || CENTRE_QR_ID, level, token: CENTRE_ACCESS_TOKEN });
  }

  async function openFieldTablet(level = tabletLevel) {
    if (tabletSyncLoadedAt) {
      const password = window.prompt(t("fieldPrep.tabletReopenPrompt"));
      if (password !== "Vetarbo") {
        setError(t("fieldPrep.tabletLockedError"));
        return;
      }
    }
    await saveFieldPreparation();
    window.open(currentFieldTabletUrl(level), "_blank", "noopener,noreferrer");
  }

  const fieldTabletAccessUrl = currentFieldTabletUrl(tabletLevel);

  function downloadFieldPackage(level = tabletLevel) {
    downloadFieldJson(`field-tablet-package-${String(level).toLowerCase()}.json`, createFieldCandidatePackage(prep, level));
  }

  // The reference lat/lng's own world position, plus the pan offset from dragging the map
  // background - this is the point every tile/marker position and every pointer-to-latLng
  // conversion below treats as screen-center, so panning stays consistent everywhere at once.
  function centreEffectiveCenterWorld() {
    const referenceWorld = centreLatLngToWorld(prep.referenceLatitude, prep.referenceLongitude, centreMapZoom);
    return { x: referenceWorld.x + centreViewOffset.x, y: referenceWorld.y + centreViewOffset.y };
  }

  function pointFromCentreMapEvent(event) {
    const rect = centreMapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const centerWorld = centreEffectiveCenterWorld();
    const worldX = centerWorld.x + (event.clientX - (rect.left + rect.width / 2));
    const worldY = centerWorld.y + (event.clientY - (rect.top + rect.height / 2));
    const { lat, lng } = centreWorldToLatLng(worldX, worldY, centreMapZoom);
    return { lat, lng };
  }

  // kind "pan" drags the map viewport itself (background) rather than a marker - started from the
  // map container's own onPointerDown, which only ever fires for the background: every marker
  // button's onPointerDown already stopPropagation()s, so a marker drag never also starts a pan.
  function startCentreDrag(kind, id, event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    centreDragRef.current = kind === "pan"
      ? { kind, id, moved: false, startClientX: event.clientX, startClientY: event.clientY, startOffset: centreViewOffset }
      : { kind, id, moved: false };
    if (kind === "tree") setSelectedTreeId(id);
    if (kind === "center") setSelectedTreeId("__center__");
  }

  function moveCentreDrag(event) {
    const drag = centreDragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      drag.moved = true;
      setCentreViewOffset({
        x: drag.startOffset.x - (event.clientX - drag.startClientX),
        y: drag.startOffset.y - (event.clientY - drag.startClientY),
      });
      return;
    }
    const point = pointFromCentreMapEvent(event);
    if (!point) return;
    drag.moved = true;
    if (drag.kind === "center") {
      updatePrep({ examCenter: { ...prep.examCenter, point: { ...(prep.examCenter?.point || {}), ...point } } });
    } else {
      updateTree(drag.id, (tree) => ({ ...tree, point: { ...(tree.point || {}), ...point } }));
    }
  }

  function endCentreDrag() {
    centreDragRef.current = null;
  }

  const markerForPoint = (point) => {
    const lat = Number(point?.lat ?? point?.latitude);
    const lng = Number(point?.lng ?? point?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { left: "50%", top: "50%" };
    const centerWorld = centreEffectiveCenterWorld();
    const pointWorld = centreLatLngToWorld(lat, lng, centreMapZoom);
    return {
      left: `calc(50% + ${pointWorld.x - centerWorld.x}px)`,
      top: `calc(50% + ${pointWorld.y - centerWorld.y}px)`,
    };
  };

  function centreLatLngToWorld(latValue, lngValue, zoom = 18) {
    const lat = Math.max(Math.min(Number(latValue), 85.05112878), -85.05112878);
    const lng = Number(lngValue);
    const scale = 256 * 2 ** zoom;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    };
  }

  function centreWorldToLatLng(xValue, yValue, zoom = 18) {
    const scale = 256 * 2 ** zoom;
    const x = Number(xValue);
    const y = Number(yValue);
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return { lat, lng };
  }

  function centreTileUrl(x, y, z = 18) {
    if (mapLayer === "osm") return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    if (mapLayer === "esri") return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    return `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
  }

  function centreMapTiles() {
    const centerWorld = centreEffectiveCenterWorld();
    const centerTileX = Math.floor(centerWorld.x / 256);
    const centerTileY = Math.floor(centerWorld.y / 256);
    const offsetX = centerWorld.x - centerTileX * 256;
    const offsetY = centerWorld.y - centerTileY * 256;
    const tiles = [];
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        tiles.push({
          key: `centre-${mapLayer}-${centreMapZoom}-${x}-${y}`,
          src: centreTileUrl(x, y, centreMapZoom),
          style: { left: `calc(50% + ${dx * 256 - offsetX}px)`, top: `calc(50% + ${dy * 256 - offsetY}px)` },
        });
      }
    }
    return tiles;
  }

  // Fits every point into a widthPx x heightPx box by trying zoom levels from high to low —
  // same Web Mercator math as the live map, just picking the tightest zoom where nothing spills
  // past the print page instead of following the operator's pan/zoom.
  function fitZoomAndCenter(points, widthPx, heightPx, minZoom = 13, maxZoom = 19) {
    if (!points.length) return { zoom: 18, worldX: 0, worldY: 0 };
    const padding = 90;
    for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
      const worldPts = points.map((p) => centreLatLngToWorld(p.lat, p.lng, zoom));
      const minX = Math.min(...worldPts.map((w) => w.x));
      const maxX = Math.max(...worldPts.map((w) => w.x));
      const minY = Math.min(...worldPts.map((w) => w.y));
      const maxY = Math.max(...worldPts.map((w) => w.y));
      if ((maxX - minX) + padding * 2 <= widthPx && (maxY - minY) + padding * 2 <= heightPx) {
        return { zoom, worldX: (minX + maxX) / 2, worldY: (minY + maxY) / 2 };
      }
    }
    const worldPts = points.map((p) => centreLatLngToWorld(p.lat, p.lng, minZoom));
    return {
      zoom: minZoom,
      worldX: worldPts.reduce((sum, w) => sum + w.x, 0) / worldPts.length,
      worldY: worldPts.reduce((sum, w) => sum + w.y, 0) / worldPts.length,
    };
  }

  function printMapPageHtml(levelLabel, points, layer) {
    const widthPx = 680;
    const heightPx = 900;
    // Honour the operator's chosen zoom (that is what the on-screen zoom buttons are for);
    // auto-fit only decides the centre so the whole site stays on the page.
    const autoFit = fitZoomAndCenter(points, widthPx, heightPx);
    const centre = centreLatLngToWorld(prep.referenceLatitude, prep.referenceLongitude, centreMapZoom);
    const fit = Number.isFinite(centre.x) && Number.isFinite(centre.y)
      ? { zoom: centreMapZoom, worldX: centre.x, worldY: centre.y }
      : autoFit;
    const centerTileX = Math.floor(fit.worldX / 256);
    const centerTileY = Math.floor(fit.worldY / 256);
    const offsetX = fit.worldX - centerTileX * 256;
    const offsetY = fit.worldY - centerTileY * 256;
    const tilesXHalf = Math.ceil(widthPx / 256 / 2) + 1;
    const tilesYHalf = Math.ceil(heightPx / 256 / 2) + 1;
    const tileHtmlParts = [];
    for (let dx = -tilesXHalf; dx <= tilesXHalf; dx += 1) {
      for (let dy = -tilesYHalf; dy <= tilesYHalf; dy += 1) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        const left = widthPx / 2 + dx * 256 - offsetX;
        const top = heightPx / 2 + dy * 256 - offsetY;
        const src = layer === "osm" ? `https://tile.openstreetmap.org/${fit.zoom}/${x}/${y}.png` : layer === "esri" ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${fit.zoom}/${y}/${x}` : `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${fit.zoom}/${y}/${x}`;
        tileHtmlParts.push(`<img src="${src}" style="position:absolute;left:${left}px;top:${top}px;width:256px;height:256px" />`);
      }
    }
    const markerHtmlParts = points.map((p) => {
      const w = centreLatLngToWorld(p.lat, p.lng, fit.zoom);
      const left = widthPx / 2 + (w.x - fit.worldX);
      const top = heightPx / 2 + (w.y - fit.worldY);
      const isCentre = p.kind === "centre";
      const colour = isCentre ? "#e11d48" : "#020617";
      const placement = fieldMarkerVisualStyle(p.labelDirection || "n", p.labelOffsetX, p.labelOffsetY);
      const labelX = parseFloat(placement["--label-x"]) || 0;
      const labelY = parseFloat(placement["--label-y"]) || 0;
      const stemLength = parseFloat(placement["--stem-length"]) || 0;
      const stemAngle = parseFloat(placement["--stem-angle"]) || 0;
      const dot = `<div style="position:absolute;left:${left}px;top:${top}px;transform:translate(-50%,-50%);z-index:22;width:11px;height:11px;border-radius:999px;background:${colour};box-shadow:0 0 0 3px #fff"></div>`;
      const stem = stemLength > 0
        ? `<div style="position:absolute;left:${left}px;top:${top}px;transform:rotate(${stemAngle}deg);transform-origin:0 50%;z-index:20;width:${stemLength}px;height:3px;border-radius:999px;background:#fff;box-shadow:0 0 0 1px rgba(2,6,23,.25)"></div>`
        : "";
      const label = `<div style="position:absolute;left:${left + labelX}px;top:${top + labelY}px;transform:translate(-50%,-50%);z-index:21;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${colour};box-shadow:0 0 0 3px #fff;white-space:nowrap">${escapeHtml(p.label)}</div>`;
      return `${stem}${dot}${label}`;
    }).join("");
    return `<section class="print-map-page">
      <h2>${escapeHtml(levelLabel)}</h2>
      <div class="print-map-canvas" style="width:${widthPx}px;height:${heightPx}px">
        ${tileHtmlParts.join("")}
        ${markerHtmlParts}
      </div>
      <div class="print-map-attribution">${layer === "osm" ? "© OpenStreetMap contributors" : "© ČÚZK ORTOFOTO"}</div>
    </section>`;
  }

  function printTreeDetailPageHtml(tree, index) {
    const data = tree.practicingTreeAData || createPracticingTreeAData();
    const interventionsHtml = (data.interventions || []).filter((item) => String(item.technology || item.description || "").trim()).map((item) => `<div class="print-intervention"><strong>${escapeHtml(item.technology || "-")}</strong>${item.description ? `<div>${linesToHtml(item.description)}</div>` : ""}</div>`).join("") || `<div class="print-empty">-</div>`;
    const photosHtml = (tree.photos || []).length
      ? `<div class="print-photo-grid">${tree.photos.map((photo) => `<figure><img src="${photo.url}" alt="" onload="this.parentElement.classList.toggle('portrait', this.naturalHeight > this.naturalWidth)" />${photo.caption ? `<figcaption>${escapeHtml(photo.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`
      : `<div class="print-empty">${escapeHtml(t("fieldPrep.printNoPhotos"))}</div>`;
    return `<section class="print-tree-page">
      <h2>${escapeHtml(fieldTreeLabels(tree).join(" / ") || `A${index + 1}`)} · ${escapeHtml(tree.name || "")}</h2>
      <div class="print-meta">${escapeHtml(formatFieldCoordinates(tree.point))}</div>
      <div class="print-grid">
        <div><strong>Taxon</strong><div>${escapeHtml(data.taxon || "-")}</div></div>
        <div><strong>${escapeHtml(t("fieldPrep.heightM"))}</strong><div>${escapeHtml(String(data.heightM ?? "-"))}</div></div>
        <div><strong>${escapeHtml(t("fieldPrep.stemDiameterCm"))}</strong><div>${escapeHtml(String(data.stemDiameterCm ?? "-"))}</div></div>
        <div><strong>${escapeHtml(t("fieldPrep.crownSpreadM"))}</strong><div>${escapeHtml(String(data.crownSpreadM ?? "-"))}</div></div>
      </div>
      <h3>${escapeHtml(t("fieldPrep.interventionTechnology"))}</h3>
      ${interventionsHtml}
      <h3>${escapeHtml(t("fieldPrep.photos"))}</h3>
      ${photosHtml}
    </section>`;
  }

  function printFieldPreparationPdf() {
    const centreLabel = t("fieldPrep.centre");
    const centerPoint = prep.examCenter?.point;
    const centrePointEntry = Number.isFinite(Number(centerPoint?.lat)) && Number.isFinite(Number(centerPoint?.lng))
      ? [{
          lat: Number(centerPoint.lat),
          lng: Number(centerPoint.lng),
          label: centreLabel,
          kind: "centre",
          labelDirection: prep.examCenter?.labelDirection || "n",
          labelOffsetX: Number(prep.examCenter?.labelOffsetX || 0),
          labelOffsetY: Number(prep.examCenter?.labelOffsetY || 0),
        }]
      : [];

    const mapPages = FIELD_LEVELS.map((level) => {
      const levelTrees = centreFieldTrees.filter((tree) => fieldEnsureArray(tree.assignments).some((a) => a.level === level));
      const points = [
        ...centrePointEntry,
        ...levelTrees
          .filter((tree) => Number.isFinite(Number(tree.point?.lat)) && Number.isFinite(Number(tree.point?.lng)))
          .map((tree) => ({
            lat: Number(tree.point.lat),
            lng: Number(tree.point.lng),
            label: fieldTreeDisplayName(tree),
            kind: "tree",
            labelDirection: tree.labelDirection || "n",
            labelOffsetX: Number(tree.labelOffsetX || 0),
            labelOffsetY: Number(tree.labelOffsetY || 0),
          })),
      ];
      if (!points.length) return "";
      return printMapPageHtml(level, points, mapLayer);
    }).join("");

    const practicingATrees = centreFieldTrees.filter((tree) => fieldEnsureArray(tree.assignments).some((a) => a.level === "Practicing" && a.code === "A"));
    const treePages = practicingATrees.map((tree, index) => printTreeDetailPageHtml(tree, index)).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(prep.siteName || "")}</title><style>
      @page{size:A4 portrait;margin:12mm}
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,sans-serif;color:#102018}
      .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
      section{page-break-after:always}
      section:last-child{page-break-after:auto}
      h2{margin:0 0 3mm;font-size:16pt}
      h3{margin:5mm 0 2mm;font-size:11pt}
      .print-map-canvas{position:relative;overflow:hidden;border:1px solid #cbd5e1;border-radius:4px;background:#e2e8f0}
      .print-map-attribution{margin-top:2mm;font-size:8pt;color:#64748b}
      .print-meta{font-family:ui-monospace,monospace;font-size:9pt;color:#516158;margin-bottom:3mm}
      .print-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;font-size:10pt}
      .print-grid strong{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.03em;color:#64748b;margin-bottom:1mm}
      .print-intervention{border:1px solid #dbe3dd;border-radius:6px;padding:2mm 3mm;margin-bottom:2mm;font-size:10pt}
      .print-note{border:1px solid #dbe3dd;border-radius:6px;padding:2mm 3mm;font-size:10pt;min-height:8mm}
      .print-empty{color:#94a3b8;font-style:italic}
      .print-photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}
      .print-photo-grid figure{margin:0}
      .print-photo-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid #dbe3dd}
      .print-photo-grid figure.portrait img{aspect-ratio:3/4}
      .print-photo-grid figcaption{font-size:8pt;color:#64748b;margin-top:1mm}
      @media print{.actions{display:none}}
    </style></head><body>
      <div class="actions"><button onclick="window.print()">${escapeHtml(t("fieldPrep.printPdf"))}</button></div>
      ${mapPages}
      ${treePages}
    </body></html>`;

    openPrintDocument(html, () => setError(t("fieldPrep.printBlocked")));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <h3 className="font-semibold">{t("fieldPrep.title")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t("fieldPrep.subtitle")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone={errorCount ? "bad" : "good"}>{errorCount ? tf("fieldPrep.errorCount", { count: errorCount }) : t("fieldPrep.noBlockingError")}</StatusPill>
              <StatusPill>{tf("fieldPrep.requiredAssignments", { count: requiredReadyCount, total: FIELD_REQUIRED_ASSIGNMENTS.length })}</StatusPill>
              <StatusPill>{prep.status || "DRAFT"}</StatusPill>
              {tabletSyncLoadedAt && <StatusPill tone="good">{t("fieldPrep.tabletSyncLoaded")}</StatusPill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className={`flex items-center gap-3 rounded-2xl border bg-white p-2 shadow-sm ${tabletSyncLoadedAt ? "border-amber-200 bg-amber-50" : ""}`}>
              <RealQr value={fieldTabletAccessUrl} size={88} />
              <div className="min-w-[13rem] text-sm">
                <div className="font-semibold text-slate-950">{t("fieldPrep.tabletAccess")}</div>
                <div className="mt-1 break-all font-mono text-[11px] leading-snug text-slate-500">{fieldTabletAccessUrl}</div>
                {tabletSyncLoadedAt && <div className="mt-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">{t("fieldPrep.reopenRequiresPassword")}</div>}
              </div>
            </div>
            <Button onClick={() => openFieldTablet(tabletLevel)} variant="outline" className={`rounded-2xl ${tabletSyncLoadedAt ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100" : ""}`}>{t("fieldPrep.openTablet")}</Button>
            <Button onClick={loadTabletChanges} variant="outline" className={`rounded-2xl ${tabletSyncLoadedAt ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200" : ""}`} title={tabletSyncLoadedAt ? tf("fieldPrep.lastSyncLoadedTitle", { time: new Date(tabletSyncLoadedAt).toLocaleString() }) : t("fieldPrep.loadTabletChangesTitle")}>{t("fieldPrep.loadTabletChanges")}</Button>
          </div>
        </div>
      </div>

      {status && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div>}
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-medium">{t("fieldPrep.siteName")}<input value={prep.siteName || ""} onChange={(event) => updatePrep({ siteName: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <label className="text-sm font-medium">Exam ID<input value={prep.examId || ""} onChange={(event) => updatePrep({ examId: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 font-mono text-xs" /></label>
              <form onSubmit={applyCoordinateSearch} className="text-sm font-medium">{t("fieldPrep.referenceCoordinates")}<div className="mt-1 flex gap-2"><input value={coordinateInput} onChange={(event) => setCoordinateInput(event.target.value)} className="w-full rounded-xl border bg-white p-2 font-mono text-xs" /><Button type="submit" variant="outline" className="rounded-xl px-3">{t("fieldPrep.find")}</Button></div></form>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div><h3 className="font-semibold">{t("fieldPrep.mapPreviewTitle")}</h3></div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={mapLayer} onChange={(event) => selectMapLayer(event.target.value)} className="rounded-xl border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700">
                  <option value="cuzk">{t("map.layer.cuzk")}</option>
                  <option value="esri">{t("map.layer.esri")}</option>
                  <option value="osm">{t("map.layer.osm")}</option>
                </select>
                <div className="text-xs text-slate-500">{t("fieldPrep.reference")}: {Number(prep.referenceLatitude).toFixed(6)}, {Number(prep.referenceLongitude).toFixed(6)}</div>
              </div>
            </div>
            <div ref={centreMapRef} onPointerDown={(event) => startCentreDrag("pan", null, event)} onPointerMove={moveCentreDrag} onPointerUp={endCentreDrag} onPointerCancel={endCentreDrag} className="relative h-[520px] touch-none cursor-grab overflow-hidden rounded-2xl border bg-slate-100 active:cursor-grabbing">
              <div className="field-tile-layer" aria-hidden="true">
                {centreMapTiles().map((tile) => <img key={tile.key} src={tile.src} style={tile.style} loading="lazy" alt="" />)}
              </div>
              <div className="absolute left-3 top-3 z-20 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">N ▲</div>
              <div className="absolute left-3 top-12 z-30 flex flex-col gap-1.5" onPointerDown={stopMapControlEvent} onPointerMove={stopMapControlEvent} onPointerUp={stopMapControlEvent} onPointerCancel={stopMapControlEvent} onWheel={stopMapControlEvent} onClick={stopMapControlEvent}>
                <button type="button" onClick={() => changeCentreMapZoom(1)} disabled={centreMapZoom >= 19} title={t("fieldPrep.zoomIn")} aria-label={t("fieldPrep.zoomIn")} className="flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-lg font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-40">+</button>
                <button type="button" onClick={() => changeCentreMapZoom(-1)} disabled={centreMapZoom <= 13} title={t("fieldPrep.zoomOut")} aria-label={t("fieldPrep.zoomOut")} className="flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-lg font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-40">−</button>
                <div className="rounded-full bg-white/90 px-2 py-0.5 text-center text-[10px] font-semibold text-slate-500 shadow-sm">{centreMapZoom}</div>
              </div>
              <div className="absolute bottom-2 right-3 z-20 rounded-full bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm">{mapLayer === "cuzk" ? "© ČÚZK ortofoto" : mapLayer === "esri" ? "© Esri, Maxar, Earthstar Geographics" : "© OpenStreetMap contributors"}</div>
              <span aria-hidden="true" style={markerForPoint(prep.examCenter?.point)} className="pointer-events-none absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600 ring-2 ring-white" />
              <button type="button" onPointerDown={(event) => startCentreDrag("center", "__center__", event)} onClick={() => setSelectedTreeId("__center__")} style={markerForPoint(prep.examCenter?.point)} className="absolute z-30 -translate-x-1/2 -translate-y-[150%] rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg ring-4 ring-white">{t("fieldPrep.centre")}</button>
              {fieldEnsureArray(prep.trees).map((tree) => {
                const selected = tree.id === selectedTreeId;
                const labels = fieldTreeLabels(tree);
                return <span key={`${tree.id}-dot`} aria-hidden="true" style={markerForPoint(tree.point)} className={`pointer-events-none absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${selected ? "bg-slate-950" : "bg-slate-700"}`} />;
              })}
              {fieldEnsureArray(prep.trees).map((tree) => {
                const selected = tree.id === selectedTreeId;
                const labels = fieldTreeLabels(tree);
                return <button type="button" key={tree.id} onPointerDown={(event) => startCentreDrag("tree", tree.id, event)} onClick={() => setSelectedTreeId(tree.id)} style={markerForPoint(tree.point)} className={`absolute z-30 -translate-x-1/2 -translate-y-[150%] rounded-2xl px-2 py-1 text-xs font-bold shadow-lg ring-4 ring-white ${selected ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}>{labels.length ? labels.join(" / ") : t("fieldPrep.tree")}</button>;
              })}
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              <Button type="button" onClick={addAnotherTree} variant="outline" className="rounded-2xl">
                <MapPin className="mr-1 h-4 w-4" />{t("fieldPrep.addTree")}
              </Button>
              <Button type="button" onClick={printFieldPreparationPdf} variant="outline" className="rounded-2xl">
                <Printer className="mr-1 h-4 w-4" />{t("fieldPrep.printPdf")}
              </Button>
            </div>
            {selectedTree && Array.isArray(selectedTree.photos) && selectedTree.photos.length > 0 && (
              <div className="mt-3 rounded-2xl border bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("fieldPrep.treePhotos")} · {fieldTreeDisplayName(selectedTree)}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {selectedTree.photos.map((photo, index) => {
                    const src = photo.url || photo.dataUrl;
                    return src ? <a key={photo.id || index} href={src} target="_blank" rel="noreferrer" className="block"><img src={src} alt={photo.caption || photo.fileName || ""} className="h-20 w-full rounded-lg border object-cover" /></a> : null;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {selectedTreeId === "__center__" ? (
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="font-semibold">{t("fieldPrep.examCentre")}</h3>
              <label className="mt-3 block text-sm font-medium">{t("fieldPrep.name")}<input value={prep.examCenter?.name || ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, name: event.target.value } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">Latitude<input type="number" value={prep.examCenter?.point?.lat ?? ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, point: { ...prep.examCenter.point, lat: Number(event.target.value) } } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                <label className="text-sm font-medium">Longitude<input type="number" value={prep.examCenter?.point?.lng ?? ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, point: { ...prep.examCenter.point, lng: Number(event.target.value) } } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              </div>
              <label className="mt-3 block text-sm font-medium">{t("fieldPrep.candidateNote")}<textarea value={prep.examCenter?.candidateNote || ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, candidateNote: event.target.value } })} rows={3} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
            </div>
          ) : selectedTree ? (
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("fieldPrep.selectedTree")}</div><h3 className="text-lg font-semibold">{fieldTreeDisplayName(selectedTree)}</h3><p className="text-xs text-slate-500">{formatFieldCoordinates(selectedTree.point)}</p></div>
                <Button onClick={() => removeTree(selectedTree.id)} variant="outline" className="rounded-2xl">{t("fieldPrep.delete")}</Button>
              </div>
              <div className="mt-4 flex items-center justify-between"><h4 className="font-semibold">{t("fieldPrep.assignment")}</h4><Button onClick={() => addAssignment(selectedTree.id)} variant="outline" className="rounded-2xl">{t("fieldPrep.addAssignment")}</Button></div>
              <div className="mt-2 space-y-2">
                {(selectedTree.assignments || []).map((assignment) => <div key={assignment.id} className="grid gap-2 rounded-xl border bg-slate-50 p-2 md:grid-cols-[1fr_1fr_auto]">
                  <select value={assignment.level} onChange={(event) => updateAssignment(selectedTree.id, assignment.id, { level: event.target.value })} className="rounded-xl border bg-white p-2 text-sm"><option>Practicing</option><option>Consulting</option></select>
                  <select value={assignment.code} onChange={(event) => updateAssignment(selectedTree.id, assignment.id, { code: event.target.value })} className="rounded-xl border bg-white p-2 text-sm">{FIELD_TREE_CODES.map((code) => <option key={code}>{code}</option>)}</select>
                  <Button onClick={() => removeAssignment(selectedTree.id, assignment.id)} variant="outline" className="rounded-xl">{t("fieldPrep.remove")}</Button>
                </div>)}
              </div>
              {(selectedTree.assignments || []).some((assignment) => fieldTreeShowsManagementData(assignment.level, assignment.code)) && (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <h4 className="font-semibold text-emerald-950">{t("fieldPrep.managementData")}</h4>
                  <label className="mt-2 block text-sm font-medium">Taxon<input value={selectedTree.practicingTreeAData?.taxon || ""} onChange={(event) => updatePracticingAData(selectedTree.id, { taxon: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <label className="text-sm font-medium">{t("fieldPrep.heightM")}<input type="number" value={selectedTree.practicingTreeAData?.heightM ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { heightM: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                    <label className="text-sm font-medium">{t("fieldPrep.stemDiameterCm")}<input type="number" value={selectedTree.practicingTreeAData?.stemDiameterCm ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { stemDiameterCm: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                    <label className="text-sm font-medium">{t("fieldPrep.crownSpreadM")}<input type="number" value={selectedTree.practicingTreeAData?.crownSpreadM ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { crownSpreadM: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                  </div>
                  <div className="mt-3 flex items-center justify-between"><h5 className="font-semibold">{t("fieldPrep.interventionTechnology")}</h5><Button onClick={() => addIntervention(selectedTree.id)} variant="outline" className="rounded-xl">{t("fieldPrep.addTechnology")}</Button></div>
                  <div className="mt-2 space-y-2">
                    {(selectedTree.practicingTreeAData?.interventions || []).map((intervention) => <div key={intervention.id} className="rounded-xl border bg-white p-2"><input value={intervention.technology || ""} onChange={(event) => updateIntervention(selectedTree.id, intervention.id, { technology: event.target.value })} placeholder={t("fieldPrep.technology")} className="w-full rounded-xl border bg-white p-2 text-sm" /><textarea value={intervention.description || ""} onChange={(event) => updateIntervention(selectedTree.id, intervention.id, { description: event.target.value })} placeholder={t("fieldPrep.description")} rows={2} className="mt-2 w-full rounded-xl border bg-white p-2 text-sm" /><div className="mt-2 flex justify-end"><Button onClick={() => removeIntervention(selectedTree.id, intervention.id)} variant="outline" className="rounded-xl text-rose-700"><X className="mr-1 h-4 w-4" />{t("fieldPrep.remove")}</Button></div></div>)}
                  </div>
                </div>
              )}
            </div>
          ) : <div className="rounded-2xl border bg-white p-4 text-sm text-slate-600">{t("fieldPrep.selectTreeOrCentre")}</div>}
        </div>
      </div>

    </div>
  );
}

function normalizeFieldTabletTrees(fieldPackage, level = "Practicing") {
  const includeAll = String(level || "").toLowerCase() === "all";
  const normalizedLevel = includeAll ? "Practicing" : (String(level || "Practicing").toLowerCase() === "consulting" ? "Consulting" : "Practicing");

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value[normalizedLevel])) return value[normalizedLevel];
    if (Array.isArray(value[normalizedLevel.toLowerCase()])) return value[normalizedLevel.toLowerCase()];
    if (Array.isArray(value.trees)) return value.trees;
    if (Array.isArray(value.items)) return value.items;
    if (value[normalizedLevel]?.trees) return asArray(value[normalizedLevel].trees);
    if (value[normalizedLevel.toLowerCase()]?.trees) return asArray(value[normalizedLevel.toLowerCase()].trees);
    return Object.entries(value)
      .filter(([key]) => !["Practicing", "Consulting", "practicing", "consulting"].includes(key))
      .map(([key, tree]) => ({ code: key, ...(tree && typeof tree === "object" ? tree : { name: String(tree || key) }) }));
  }

  const source = fieldPackage?.trees ?? fieldPackage?.fieldPackage?.trees ?? fieldPackage?.fieldPreparation?.trees ?? fieldPackage?.data?.trees ?? [];

  const expanded = asArray(source).flatMap((tree, index) => {
    if (!tree || typeof tree !== "object") return [];

    const assignments = Array.isArray(tree.assignments)
      ? tree.assignments.filter((assignment) => assignment?.visibleToCandidate !== false && (includeAll || normalizeFieldLevel(assignment?.level) === normalizedLevel))
      : [];

    if (assignments.length > 0) {
      return assignments.map((assignment) => ({ ...tree, level: normalizeFieldLevel(assignment.level), code: assignment.code || tree.code || String(index + 1), assignment }));
    }

    return [{ ...tree, level: normalizeFieldLevel(tree.level || tree.assignment?.level || normalizedLevel), code: tree.code || tree.assignment?.code || String(index + 1) }];
  });

  return expanded
    .map((tree, index) => {
      const code = String(tree.code || tree.assignment?.code || index + 1).trim() || String(index + 1);
      const latitude = Number(tree.latitude ?? tree.lat ?? tree.point?.lat ?? tree.coordinates?.lat);
      const longitude = Number(tree.longitude ?? tree.lng ?? tree.point?.lng ?? tree.coordinates?.lng);
      const treeLevel = normalizeFieldLevel(tree.level || tree.assignment?.level || normalizedLevel);
      return {
        id: tree.id || `field-tree-${treeLevel.toLowerCase()}-${code}`,
        key: fieldTreeKey(treeLevel, code),
        level: treeLevel,
        code,
        name: tree.name || tree.title || `${treeLevel} ${code}`,
        latitude,
        longitude,
        candidateNote: tree.candidateNote || tree.publicNote || tree.note || "",
        photos: Array.isArray(tree.photos) ? tree.photos : [],
        managementData: tree.managementData || tree.practicingTreeAData || tree.practicingTreeA || { interventions: [] },
        labelDirection: tree.labelDirection || "n",
        labelOffsetX: Number(tree.labelOffsetX || 0),
        labelOffsetY: Number(tree.labelOffsetY || 0),
      };
    })
    .filter((tree) => tree.code)
    .sort((a, b) => fieldTreeKey(a).localeCompare(fieldTreeKey(b)));
}

function firstFieldTabletTreeCode(fieldPackage, level = "Practicing") {
  return fieldTreeKey(normalizeFieldTabletTrees(fieldPackage, level)?.[0] || { level, code: "A" });
}

// Collapsible wrapper for the field tablet detail panel: the panel used to be one long column
// of always-open sections (assignment, label position, management data, interventions), which
// meant a lot of scrolling on a tablet screen. Each section now folds shut independently.
function FieldCollapsibleSection({ title, defaultOpen = true, className = "", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={className}>
      <button type="button" className="field-collapsible-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h3>{title}</h3>
        <ChevronDown className={`h-4 w-4 field-collapsible-chevron ${open ? "open" : ""}`} />
      </button>
      {open && <div className="field-collapsible-body">{children}</div>}
    </section>
  );
}

function FieldTabletPage() {
  const query = new URLSearchParams(window.location.search);
  const examId = safeExamId(query.get("examId") || CENTRE_QR_ID);
  const level = query.get("level") || "Practicing";
  const token = query.get("token") || "";
  const normalizedLevel = normalizeFieldLevel(level);
  const [fieldTabletLocale, setFieldTabletLocale] = useState(() => (typeof window !== "undefined" && window.localStorage.getItem("vetbara-field-tablet-lang")) || "en");
  const fieldT = makeTranslator(fieldTabletLocale);
  const tt = (key) => fieldTabletText(fieldT, key);
  function changeFieldTabletLocale(next) {
    setFieldTabletLocale(next);
    try { window.localStorage.setItem("vetbara-field-tablet-lang", next); } catch {}
  }
  const packageKey = fieldTabletStorageKey("package", examId, normalizedLevel);
  const draftKey = fieldTabletStorageKey("draft", examId, normalizedLevel);
  const [fieldPackage, setFieldPackage] = useState(() => readJsonLocalStorage(packageKey, null));
  const [draft, setDraft] = useState(() => readJsonLocalStorage(draftKey, null));
  // Photo compression takes seconds on a tablet, and `draft` inside a closure is frozen at the
  // moment the async work started. Committing against that stale snapshot is what silently dropped
  // photos. Every read-modify-write goes through this ref instead, which is advanced synchronously
  // by updateDraft (so two updates in one tick are also safe) and re-synced after every render.
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const [selectedTreeCode, setSelectedTreeCode] = useState(() => firstFieldTabletTreeCode(readJsonLocalStorage(packageKey, null), normalizedLevel));
  const [status, setStatus] = useState(fieldPackage ? "The package is stored locally on this device." : "");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const loadAttemptRef = useRef(0);
  const loadRetryTimerRef = useRef(null);
  const [lastSyncOk, setLastSyncOk] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [activeTabletLevel, setActiveTabletLevel] = useState(normalizedLevel);
  const [mapLayer, setMapLayer] = useState("cuzk");
  // ČÚZK orthophoto only covers the Czech Republic (blank tiles elsewhere — the "map disappears"
  // when the site is abroad, e.g. Italy). Auto-pick Esri World Imagery outside CZ; a manual choice
  // via the layer dropdown always wins from then on.
  const mapLayerManualRef = useRef(false);
  const markerLayerRef = useRef(null);
  const [mapZoom, setMapZoom] = useState(18);
  const [mapCenterOverride, setMapCenterOverride] = useState(null);
  const [gpsPosition, setGpsPosition] = useState(null);
  // GPS is a toggle: on = a live watchPosition feed (dot follows the operator, blue circle shows the
  // reported accuracy), off = the feed is stopped and the dot is hidden. Only the first fix recentres
  // the map, so tracking never fights the operator panning to look somewhere else.
  const [gpsTracking, setGpsTracking] = useState(false);
  const gpsWatchIdRef = useRef(null);
  const gpsFirstFixRef = useRef(false);
  const [moveConfirm, setMoveConfirm] = useState(null);
  const mapGestureRef = useRef({ pointers: new Map(), startCenterWorld: null, startPointer: null, startDistance: 0, startZoom: 18, panDelta: null });
  const treeDragRef = useRef(null);
  const panLayerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement || document.webkitFullscreenElement));
  const [manualCoordsOpen, setManualCoordsOpen] = useState(false);

  function requestTabletFullscreen() {
    const element = document.documentElement;
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    try { request?.call(element); } catch { /* Fullscreen not available on this browser/OS. */ }
  }

  function exitTabletFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { exit?.call(document); } catch { /* Ignore. */ }
  }

  useEffect(() => {
    // Opening the tablet page happens via a real button click (window.open from Centre), so the
    // fresh tab still carries that user-activation and this first call is allowed to succeed.
    // If the browser blocks it (no activation, or no Fullscreen API support, e.g. some iOS
    // versions), the toolbar button below lets the field operator trigger it manually instead.
    requestTabletFullscreen();
    // iPad Safari (and any browser reached by scanning a QR rather than by window.open) has no
    // user activation on load, so the call above is silently rejected there. Retry it on the
    // operator's FIRST touch — the earliest moment the browser will allow it — then stop
    // listening, so it never fights a deliberate exit later on.
    const enterOnFirstGesture = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) requestTabletFullscreen();
      removeGestureListeners();
    };
    const removeGestureListeners = () => {
      document.removeEventListener("pointerdown", enterOnFirstGesture);
      document.removeEventListener("touchend", enterOnFirstGesture);
      document.removeEventListener("click", enterOnFirstGesture);
    };
    document.addEventListener("pointerdown", enterOnFirstGesture);
    document.addEventListener("touchend", enterOnFirstGesture);
    document.addEventListener("click", enterOnFirstGesture);
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      removeGestureListeners();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Auto-load the field package on open so the map is populated and "Poslat data do Centra" works
  // without a separate offline-download step. Runs once; offline it keeps any local copy.
  useEffect(() => {
    if (!fieldPackage) downloadForOffline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A send that failed in the field parks its intent in the sync queue — replay it automatically
  // once the tablet is online again by re-sending the CURRENT snapshot (which supersedes every
  // queued payload; success clears the queue). The queue used to only ever grow, so an operator
  // whose send failed offline lost their "last changes" without knowing.
  const queueFlushAttemptsRef = useRef(0);
  useEffect(() => {
    if (!online || syncing || !fieldPackage || !draft) return undefined;
    if (!readFieldTabletSyncQueue().length) return undefined;
    if (queueFlushAttemptsRef.current >= 3) return undefined;
    const timer = window.setTimeout(() => {
      queueFlushAttemptsRef.current += 1;
      sendDataToCentre();
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, syncing, fieldPackage, draft]);

  useEffect(() => {
    if (fieldPackage && !draft) {
      const initialDraft = {
        kind: "vetbara.fieldTabletDraft.v1",
        examId,
        level: normalizedLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        treeNotes: Object.fromEntries(limitFieldTreesToRequiredCodes(normalizeFieldTabletTrees(fieldPackage, "All"), "All", fieldPackage?.examCenter || {}).map((tree) => [fieldTreeKey(tree), { visited: false, note: "", photos: [], labelDirection: tree.labelDirection || "n", labelOffsetX: Number(tree.labelOffsetX || 0), labelOffsetY: Number(tree.labelOffsetY || 0) }])),
        generalNote: "",
      };
      setDraft(initialDraft);
      writeJsonLocalStorage(draftKey, initialDraft);
    }
  }, [fieldPackage, draft, draftKey, examId, normalizedLevel]);

  async function downloadForOffline() {
    setError("");
    setStatus(tt("loadingData"));
    try {
      const fetchPackage = async (pkgLevel) => {
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/field-package/${pkgLevel.toLowerCase()}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Field package ${pkgLevel} could not be downloaded.`);
        return data;
      };
      // Tolerate one level being absent (a prep may only have Practicing or only Consulting trees);
      // only treat it as "not found" when NEITHER level is available.
      const [practicing, consulting] = await Promise.all([
        fetchPackage("Practicing").catch(() => null),
        fetchPackage("Consulting").catch(() => null),
      ]);
      if (!practicing && !consulting) throw new Error(tt("packageMissingText"));
      const base = practicing || consulting || {};
      const data = {
        ...base,
        level: "ALL",
        levels: ["Practicing", "Consulting"],
        treesByLevel: {
          Practicing: fieldEnsureArray(practicing?.trees),
          Consulting: fieldEnsureArray(consulting?.trees),
        },
        trees: [
          ...fieldEnsureArray(practicing?.trees).map((tree) => ({ ...tree, level: "Practicing" })),
          ...fieldEnsureArray(consulting?.trees).map((tree) => ({ ...tree, level: "Consulting" })),
        ],
      };
      setFieldPackage(data);
      writeJsonLocalStorage(packageKey, data);
      const allTrees = limitFieldTreesToRequiredCodes(normalizeFieldTabletTrees(data, "All"), "All", data?.examCenter || {});
      const firstKey = fieldTreeKey(allTrees[0] || { level: "Practicing", code: "A" });
      setSelectedTreeCode(firstKey);
      // Show both levels right after downloading so nothing looks like it "disappeared" — the
      // level toggle otherwise stays on whatever it was before, hiding the other level's trees.
      setActiveTabletLevel("Both");
      const nextDraft = {
        kind: "vetbara.fieldTabletDraft.v1",
        examId,
        level: "All",
        activeLevel: normalizedLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        treeNotes: Object.fromEntries(allTrees.map((tree) => {
          // Look up by the fully level-qualified key only — a bare-code fallback (e.g. "A") would
          // collide between Practicing-A and Consulting-A and could silently overwrite one level's
          // local notes with the other's.
          const key = fieldTreeKey(tree);
          return [key, draft?.treeNotes?.[key] || { visited: false, note: "", photos: [], labelDirection: tree.labelDirection || "n", labelOffsetX: Number(tree.labelOffsetX || 0), labelOffsetY: Number(tree.labelOffsetY || 0) }];
        })),
        generalNote: draft?.generalNote || "",
      };
      setDraft(nextDraft);
      writeJsonLocalStorage(draftKey, nextDraft);
      setStatus("Package downloaded and stored for offline use.");
    } catch (err) {
      setError(err.message || "Field package could not be downloaded.");
      setStatus(fieldPackage ? "Using the last locally stored package." : "");
      // Auto-retry transient failures (field tablet on flaky field Wi-Fi) a few times before
      // surfacing a manual retry, so the operator doesn't have to tap "download" themselves.
      if (!fieldPackage && loadAttemptRef.current < 4) {
        loadAttemptRef.current += 1;
        window.clearTimeout(loadRetryTimerRef.current);
        loadRetryTimerRef.current = window.setTimeout(() => { downloadForOffline(); }, 3000);
      }
    }
  }

  function updateDraft(updater) {
    const base = draftRef.current || {};
    const next = typeof updater === "function" ? updater(base) : { ...base, ...updater };
    const withMeta = { ...next, examId, level: normalizedLevel, updatedAt: new Date().toISOString() };
    draftRef.current = withMeta;
    setDraft(withMeta);
    writeJsonLocalStorage(draftKey, withMeta);
    setLastSyncOk(false);
    setStatus("Local changes are saved on the tablet and waiting for sync.");
  }

  function updateTreeDraft(code, patch) {
    updateDraft((current) => {
      const currentNote = current.treeNotes?.[code] || {};
      const resolved = typeof patch === "function" ? patch(currentNote) : patch;
      return {
        ...current,
        treeNotes: {
          ...(current.treeNotes || {}),
          [code]: { ...currentNote, ...resolved },
        },
      };
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Stored as base64 data URLs (not blob URLs) so photos survive the offline-first
  // localStorage draft round trip — a blob URL only lives as long as the tab does.
  async function addTreePhotos(code, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setStatus(`Processing ${list.length} photo(s)…`);
    // allSettled, not all: a single unreadable file (a HEIC the reader chokes on) used to reject the
    // whole batch, so every photo in that capture was lost with nothing shown to the operator.
    const results = await Promise.allSettled(list.map(async (file) => ({
      id: vetbaraUid("field-photo"),
      fileName: file.name,
      url: await compressImageToDataUrl(file),
      caption: "",
      uploadedAt: new Date().toISOString(),
    })));
    const uploaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const failed = results.length - uploaded.length;
    if (uploaded.length) {
      updateTreeDraft(code, (currentNote) => ({ photos: [...(currentNote.photos || []), ...uploaded] }));
    }
    setStatus(failed
      ? `${uploaded.length} photo(s) saved, ${failed} could not be read — try again for those.`
      : `${uploaded.length} photo(s) saved on the tablet and waiting for sync.`);
  }

  function removeTreePhoto(code, photoId) {
    updateTreeDraft(code, (currentNote) => ({ photos: (currentNote.photos || []).filter((photo) => photo.id !== photoId) }));
  }

  function updateCenterDraft(patch) {
    updateDraft((current) => ({
      ...current,
      examCenter: {
        ...(fieldPackage?.examCenter || {}),
        ...(current.examCenter || {}),
        ...patch,
      },
    }));
  }

  function switchTabletLevel(nextLevel) {
    const next = String(nextLevel || "Practicing").toLowerCase() === "both" ? "Both" : normalizeFieldLevel(nextLevel);
    setActiveTabletLevel(next);
    const first = next === "Both" ? fieldTrees[0] : fieldTrees.find((tree) => normalizeFieldLevel(tree.level) === next) || fieldTrees[0];
    if (first) setSelectedTreeCode(fieldTreeKey(first));
  }

  function buildFieldPreparationSnapshotForSync() {
    const now = new Date().toISOString();
    const centreLat = Number(center.latitude ?? center.lat);
    const centreLng = Number(center.longitude ?? center.lng);
    const treesForSnapshot = fieldTrees.map((tree) => {
      const key = fieldTreeKey(tree);
      const local = draft?.treeNotes?.[key] || {};
      const data = local.managementData || tree.managementData || tree.practicingTreeAData || { interventions: [] };
      return {
        id: tree.id || `field-tree-${normalizeFieldLevel(tree.level).toLowerCase()}-${tree.code}`,
        name: local.treeName || tree.name || `${normalizeFieldLevel(tree.level)} ${tree.code}`,
        point: {
          lat: Number(tree.latitude),
          lng: Number(tree.longitude),
        },
        latitude: Number(tree.latitude),
        longitude: Number(tree.longitude),
        assignments: [{ level: normalizeFieldLevel(tree.level), code: String(tree.code || "A").toUpperCase(), visibleToCandidate: true }],
        candidateNote: local.candidateNote ?? tree.candidateNote ?? "",
        labelDirection: local.labelDirection || tree.labelDirection || "n",
        labelOffsetX: Number(local.labelOffsetX ?? tree.labelOffsetX ?? 0),
        labelOffsetY: Number(local.labelOffsetY ?? tree.labelOffsetY ?? 0),
        practicingTreeAData: data,
        managementData: data,
        photos: (local.photos ?? tree.photos ?? []).map((photo) => ({ id: photo.id, fileName: photo.fileName || photo.name, url: photo.url || photo.dataUrl, caption: photo.caption || "" })).filter((photo) => photo.url),
        checked: Boolean(local.visited),
      };
    });
    return {
      kind: "vetbara.fieldPreparationSnapshot.v1",
      examId,
      siteName: fieldPackage?.siteName || "",
      referenceLatitude: Number.isFinite(Number(mapCenter?.lat)) ? Number(mapCenter.lat) : (Number.isFinite(centreLat) ? centreLat : Number(treesForSnapshot[0]?.point?.lat)),
      referenceLongitude: Number.isFinite(Number(mapCenter?.lng)) ? Number(mapCenter.lng) : (Number.isFinite(centreLng) ? centreLng : Number(treesForSnapshot[0]?.point?.lng)),
      syncedAt: now,
      mapView: { center: mapCenter, zoom: mapZoom, layer: mapLayer },
      examCenter: {
        ...(fieldPackage?.examCenter || {}),
        ...(draft?.examCenter || {}),
        point: { lat: centreLat, lng: centreLng },
        latitude: centreLat,
        longitude: centreLng,
      },
      trees: treesForSnapshot,
    };
  }

  // "Poslat data do Centra" — a single, always-available push of the current field-prep state to
  // the Centre. Unlike the old sync it does not require the offline-download step first (it loads
  // the package on demand) and it is not gated behind "all trees checked" — station prep must be
  // sendable at any point.
  // Photos are base64 data URLs embedded in JSON, and they used to be serialised THREE times per
  // send (once in packageSnapshot, once in draft.treeNotes, once in fieldPreparationSnapshot).
  // With ~1 MB photos that blew past Vercel's ~4.5 MB request-body limit and the send died with a
  // 413 "FUNCTION_PAYLOAD_TOO_LARGE" after a couple of seconds — which on the tablet just looked
  // like "Sending…" flicking back to "Send data to Centre" with nothing arriving in the Centre.
  // The server rebuilds the preparation from fieldPreparationSnapshot, so that is the ONE copy
  // that has to carry the image data; everywhere else we keep the photo metadata but drop the
  // bytes.
  function stripPhotoBytes(value) {
    if (Array.isArray(value)) return value.map(stripPhotoBytes);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "photos" && Array.isArray(item)) {
        next[key] = item.map((photo) => {
          if (!photo || typeof photo !== "object") return photo;
          const { url, dataUrl, ...rest } = photo;
          return rest;
        });
      } else {
        next[key] = stripPhotoBytes(item);
      }
    }
    return next;
  }

  // Even with a single copy, enough tree photos still exceed the limit, so shrink them further
  // (and only for the transfer — the tablet keeps its originals) until the whole body fits.
  async function buildBoundedSyncPayload() {
    const budgets = [null, 400_000, 220_000, 120_000, 60_000];
    let lastPayload = null;
    for (const maxBytes of budgets) {
      const snapshot = buildFieldPreparationSnapshotForSync();
      if (maxBytes) {
        snapshot.trees = await Promise.all((snapshot.trees || []).map(async (tree) => ({
          ...tree,
          photos: await Promise.all((tree.photos || []).map(async (photo) => (
            photo?.url ? { ...photo, url: await compressImageToDataUrl(photo.url, { maxBytes, maxDim: maxBytes > 200_000 ? 1400 : 1000 }) } : photo
          ))),
        })));
      }
      const payload = {
        kind: "vetbara.fieldTabletSync.v1",
        examId,
        level: normalizedLevel,
        token,
        syncedAt: new Date().toISOString(),
        packageSnapshot: stripPhotoBytes(fieldPackage),
        draft: stripPhotoBytes(draft),
        fieldPreparationSnapshot: snapshot,
      };
      lastPayload = payload;
      // 3.5 MB keeps headroom under the platform's ~4.5 MB cap for headers/encoding overhead.
      if (new Blob([JSON.stringify(payload)]).size <= 3_500_000) return payload;
    }
    return lastPayload;
  }

  async function sendDataToCentre() {
    if (syncing) return;
    if (!fieldPackage || !draft) {
      await downloadForOffline();
      setStatus(tt("packageLoadedNowSend"));
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const payload = await buildBoundedSyncPayload();
      // fetch() has NO built-in timeout — on a weak field connection with a large payload
      // (several MB once tree photos are attached), the browser can sit uploading indefinitely
      // with the button stuck on "Sending..." and no final message ever appearing. Abort after a
      // bounded window so a stuck send fails fast, falls into the local queue below, and the
      // useEffect above auto-retries once the tablet is back online.
      const abortController = new AbortController();
      const timeoutId = window.setTimeout(() => abortController.abort(), 45000);
      let response;
      try {
        response = await fetch(`/api/exams/${encodeURIComponent(examId)}/field-tablet-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || tt("syncFailed"));
      // The snapshot we just sent reflects the CURRENT tablet state, so any older queued sends
      // are superseded — clear them, otherwise the queue lingers forever (it used to never
      // replay at all, which is how "the last tablet changes never reached the Centre").
      clearFieldTabletSyncQueue();
      setLastSyncOk(true);
      setStatus(data?.syncId ? tt("syncedWithId").replace("{syncId}", data.syncId) : tt("syncedNoId"));
    } catch (err) {
      const queued = { id: vetbaraUid("field-sync"), examId, level: normalizedLevel, queuedAt: new Date().toISOString(), fieldPackage, draft };
      appendFieldTabletSyncQueue(queued);
      setLastSyncOk(false);
      const message = err?.name === "AbortError" ? tt("syncTimedOut") : (err.message || tt("syncFailed"));
      setError(`${message} ${tt("savedToLocalQueue")}`);
    } finally {
      setSyncing(false);
    }
  }

  const centerSource = fieldPackage?.examCenter || {};
  const localCenter = draft?.examCenter || {};
  const center = { ...centerSource, ...localCenter };
  const normalizedTrees = normalizeFieldTabletTrees(fieldPackage, "All");
  // Placeholder trees (not yet given their own real coordinates) default to an offset near the
  // exam centre. That default must stay anchored to the centre's original position (centerSource),
  // not the live-dragged one (center) — otherwise dragging the centre marker also drags every
  // still-unplaced tree along with it, which looks like a bug ("some trees move with the centre").
  const baseFieldTrees = limitFieldTreesToRequiredCodes(normalizedTrees, "All", centerSource);
  const requiredFieldTrees = baseFieldTrees.map((tree) => {
    const key = fieldTreeKey(tree);
    const local = draft?.treeNotes?.[key] || {};
    const localLatitude = Number(local.latitude);
    const localLongitude = Number(local.longitude);
    return {
      ...tree,
      key,
      name: local.treeName || tree.name,
      candidateNote: local.candidateNote ?? tree.candidateNote,
      labelDirection: local.labelDirection || tree.labelDirection || "n",
      labelOffsetX: Number(local.labelOffsetX ?? tree.labelOffsetX ?? 0),
      labelOffsetY: Number(local.labelOffsetY ?? tree.labelOffsetY ?? 0),
      latitude: Number.isFinite(localLatitude) ? localLatitude : tree.latitude,
      longitude: Number.isFinite(localLongitude) ? localLongitude : tree.longitude,
      photos: [...(tree.photos || []), ...(local.photos || [])],
    };
  });
  const centerLatForExtras = Number(center.latitude);
  const centerLngForExtras = Number(center.longitude);
  const extraTreeToggles = draft?.extraTrees || {};
  const extraFieldTrees = FIELD_EXTRA_TREE_TOGGLE_KEYS.filter((toggleKey) => extraTreeToggles[toggleKey]).map((toggleKey) => {
    const [level, rawCode] = toggleKey.split("-");
    const baseCode = rawCode[0];
    const normalizedLevel = normalizeFieldLevel(level);
    const key = fieldTreeKey(normalizedLevel, rawCode);
    const baseTree = requiredFieldTrees.find((tree) => normalizeFieldLevel(tree.level) === normalizedLevel && String(tree.code).toUpperCase() === baseCode);
    const local = draft?.treeNotes?.[key] || {};
    const localLatitude = Number(local.latitude);
    const localLongitude = Number(local.longitude);
    return {
      id: `extra-${toggleKey}`,
      key,
      level: normalizedLevel,
      code: rawCode,
      name: local.treeName || `${normalizedLevel} ${rawCode}`,
      candidateNote: local.candidateNote ?? "",
      labelDirection: local.labelDirection || "n",
      labelOffsetX: Number(local.labelOffsetX ?? 0),
      labelOffsetY: Number(local.labelOffsetY ?? 0),
      latitude: Number.isFinite(localLatitude) ? localLatitude : (Number(baseTree?.latitude) || centerLatForExtras || 0) + 0.00006,
      longitude: Number.isFinite(localLongitude) ? localLongitude : (Number(baseTree?.longitude) || centerLngForExtras || 0) + 0.00006,
      managementData: local.managementData || {},
    };
  });
  const fieldTrees = [...requiredFieldTrees, ...extraFieldTrees];
  const visibleFieldTrees = activeTabletLevel === "Both" ? fieldTrees : fieldTrees.filter((tree) => normalizeFieldLevel(tree.level) === activeTabletLevel);
  const selectedTree = fieldTrees.find((tree) => fieldTreeKey(tree) === String(selectedTreeCode)) || visibleFieldTrees[0] || fieldTrees[0] || null;
  const readyOffline = Boolean(fieldPackage && draft);
  const selectedLocal = selectedTree ? (draft?.treeNotes?.[fieldTreeKey(selectedTree)] || {}) : {};

  function toggleExtraTree(toggleKey) {
    updateDraft((current) => ({
      ...current,
      extraTrees: { ...(current.extraTrees || {}), [toggleKey]: !(current.extraTrees || {})[toggleKey] },
    }));
  }
  const visitedCount = visibleFieldTrees.filter((tree) => Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited)).length;
  const allRequiredChecked = requiredFieldTrees.length >= FIELD_REQUIRED_ASSIGNMENTS.length && requiredFieldTrees.every((tree) => Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited));
  const centerLat = Number(center.latitude);
  const centerLng = Number(center.longitude);

  useEffect(() => {
    if (fieldTrees.length && !fieldTrees.some((tree) => fieldTreeKey(tree) === String(selectedTreeCode))) {
      setSelectedTreeCode(fieldTreeKey(fieldTrees[0]));
    }
  }, [fieldTrees, selectedTreeCode]);

  function formatCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(6) : "-";
  }

  const defaultMapCenter = {
    lat: Number.isFinite(centerLat) ? centerLat : Number(fieldTrees[0]?.latitude) || 49.405888,
    lng: Number.isFinite(centerLng) ? centerLng : Number(fieldTrees[0]?.longitude) || 15.128912,
  };
  const mapCenter = mapCenterOverride || defaultMapCenter;

  useEffect(() => {
    if (mapLayerManualRef.current) return;
    setMapLayer(isWithinCzechRepublic(mapCenter.lat, mapCenter.lng) ? "cuzk" : "esri");
  }, [mapCenter.lat, mapCenter.lng]);

  // iOS Safari keeps the composited map layer's cached texture and leaves recentred / newly-added
  // tree markers unpainted — they "vanish" after Move-all-here or after enabling a second tree,
  // even though they are in the DOM at the right spot. Nudge a GPU-layer repaint on the marker
  // layer whenever the centre/zoom/level or the set of visible trees changes.
  useEffect(() => {
    const el = markerLayerRef.current;
    if (!el || typeof window === "undefined") return undefined;
    el.style.transform = "translateZ(0)";
    const raf = window.requestAnimationFrame(() => {
      if (markerLayerRef.current) markerLayerRef.current.style.transform = "";
    });
    return () => window.cancelAnimationFrame(raf);
  }, [mapCenter.lat, mapCenter.lng, mapZoom, activeTabletLevel, visibleFieldTrees.length]);

  // Once the exam centre is placed, quietly pull the whole map window for the three working zoom
  // levels into memory. From then on panning and zooming inside the stanoviste is served from cache,
  // so the map stops re-downloading the same orthophoto every time the operator moves.
  useEffect(() => {
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return undefined;
    const control = { aborted: false };
    const urls = [];
    for (const zoom of FIELD_PREFETCH_ZOOMS) {
      const world = latLngToWorld(centerLat, centerLng, zoom);
      const tileX = Math.floor(world.x / 256);
      const tileY = Math.floor(world.y / 256);
      for (let dx = -FIELD_TILE_HALF_X; dx <= FIELD_TILE_HALF_X; dx += 1) {
        for (let dy = -FIELD_TILE_HALF_Y; dy <= FIELD_TILE_HALF_Y; dy += 1) {
          urls.push(tileUrl(tileX + dx, tileY + dy, zoom));
        }
      }
    }
    prefetchFieldTiles(urls, { control });
    return () => { control.aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerLat, centerLng, mapLayer]);

  function clampMapZoom(value) {
    const zoom = Math.round(Number(value));
    if (!Number.isFinite(zoom)) return 18;
    return Math.max(15, Math.min(21, zoom));
  }

  function latLngToWorld(latValue, lngValue, zoom = mapZoom) {
    const lat = Math.max(Math.min(Number(latValue), 85.05112878), -85.05112878);
    const lng = Number(lngValue);
    const scale = 256 * 2 ** zoom;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    };
  }

  function worldToLatLng(xValue, yValue, zoom = mapZoom) {
    const scale = 256 * 2 ** zoom;
    const x = Number(xValue);
    const y = Number(yValue);
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return { lat, lng };
  }

  function tileUrl(x, y, z = mapZoom) {
    if (mapLayer === "osm") return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    if (mapLayer === "esri") return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    return `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
  }

  // Memoized so a pan/typing re-render doesn't rebuild the whole tile array; the visible
  // window is intentionally wider than the map so a single drag gesture (which pans via a
  // CSS transform without re-rendering — see handleMapPointer*) rarely reaches the buffer edge.
  const mapTiles = useMemo(() => {
    const centerWorld = latLngToWorld(mapCenter.lat, mapCenter.lng, mapZoom);
    const centerTileX = Math.floor(centerWorld.x / 256);
    const centerTileY = Math.floor(centerWorld.y / 256);
    const offsetX = centerWorld.x - centerTileX * 256;
    const offsetY = centerWorld.y - centerTileY * 256;
    const tiles = [];
    for (let dx = -FIELD_TILE_HALF_X; dx <= FIELD_TILE_HALF_X; dx += 1) {
      for (let dy = -FIELD_TILE_HALF_Y; dy <= FIELD_TILE_HALF_Y; dy += 1) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        const src = tileUrl(x, y, mapZoom);
        tiles.push({
          key: `${mapLayer}-${mapZoom}-${x}-${y}`,
          src,
          style: { left: `calc(50% + ${dx * 256 - offsetX}px)`, top: `calc(50% + ${dy * 256 - offsetY}px)` },
        });
      }
    }
    return tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayer, mapZoom, mapCenter.lat, mapCenter.lng]);

  function mapPoint(latValue, lngValue) {
    const lat = Number(latValue);
    const lng = Number(lngValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { left: "50%", top: "50%" };
    const centerWorld = latLngToWorld(mapCenter.lat, mapCenter.lng, mapZoom);
    const pointWorld = latLngToWorld(lat, lng, mapZoom);
    return {
      left: `calc(50% + ${pointWorld.x - centerWorld.x}px)`,
      top: `calc(50% + ${pointWorld.y - centerWorld.y}px)`,
    };
  }

  function pointerDistance(pointers) {
    const values = Array.from(pointers.values());
    if (values.length < 2) return 0;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  }

  function handleMapPointerDown(event) {
    if (treeDragRef.current || event.target?.closest?.(".field-map-marker") || event.target?.closest?.(".field-map-toolbar") || event.target?.closest?.(".field-map-overlay-controls")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointers = mapGestureRef.current.pointers;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    mapGestureRef.current.startCenterWorld = latLngToWorld(mapCenter.lat, mapCenter.lng, mapZoom);
    mapGestureRef.current.startPointer = { x: event.clientX, y: event.clientY };
    mapGestureRef.current.startDistance = pointerDistance(pointers);
    mapGestureRef.current.startZoom = mapZoom;
    mapGestureRef.current.panDelta = null;
  }

  // Panning moves a CSS transform on the tile+marker layer instead of committing map state
  // on every pointermove. That keeps a drag on the compositor (zero React re-renders of this
  // very large component), which is the main fix for the slow redraw. The new centre is
  // committed once on pointer-up; the stale transform is cleared in a layout effect the moment
  // the re-render with the new centre commits, so there is no visible jump.
  function handleMapPointerMove(event) {
    if (treeDragRef.current) return;
    const gesture = mapGestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size >= 2) {
      const distance = pointerDistance(gesture.pointers);
      if (distance > 0 && gesture.startDistance > 0) {
        setMapZoom(clampMapZoom(gesture.startZoom + Math.log2(distance / gesture.startDistance)));
      }
      return;
    }
    if (!gesture.startCenterWorld || !gesture.startPointer) return;
    const dx = event.clientX - gesture.startPointer.x;
    const dy = event.clientY - gesture.startPointer.y;
    gesture.panDelta = { dx, dy };
    if (panLayerRef.current) panLayerRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }

  function handleMapPointerEnd(event) {
    if (treeDragRef.current) return;
    const gesture = mapGestureRef.current;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size > 0) return;
    const delta = gesture.panDelta;
    const startCenterWorld = gesture.startCenterWorld;
    gesture.startCenterWorld = null;
    gesture.startPointer = null;
    gesture.startDistance = 0;
    gesture.startZoom = mapZoom;
    gesture.panDelta = null;
    if (delta && startCenterWorld && (delta.dx !== 0 || delta.dy !== 0)) {
      setMapCenterOverride(worldToLatLng(startCenterWorld.x - delta.dx, startCenterWorld.y - delta.dy, mapZoom));
    } else if (panLayerRef.current) {
      panLayerRef.current.style.transform = "";
    }
  }

  function handleMapWheel(event) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setMapZoom((current) => clampMapZoom(current + direction));
  }

  function stopMapControlEvent(event) {
    event.stopPropagation();
  }

  // Once a committed centre change has been painted, drop the drag transform in the same frame
  // (runs before paint, so tiles/markers are already at the new centre → no flash back to old).
  useLayoutEffect(() => {
    if (panLayerRef.current) panLayerRef.current.style.transform = "";
  }, [mapCenter.lat, mapCenter.lng]);

  function shouldDragMarkerPosition(event) {
    return Boolean(event.target?.closest?.(".field-marker-dot"));
  }

  function pointerMovedFarEnough(drag, event) {
    if (!drag?.startPointer) return true;
    return Math.hypot(event.clientX - drag.startPointer.x, event.clientY - drag.startPointer.y) > 6;
  }

  function latLngFromMapClient(mapElement, clientX, clientY, centerValue = mapCenter, zoomValue = mapZoom) {
    const rect = mapElement?.getBoundingClientRect?.();
    if (!rect) return null;
    const centerWorld = latLngToWorld(centerValue.lat, centerValue.lng, zoomValue);
    const x = centerWorld.x + (clientX - (rect.left + rect.width / 2));
    const y = centerWorld.y + (clientY - (rect.top + rect.height / 2));
    return worldToLatLng(x, y, zoomValue);
  }

  function latLngFromMapPointer(event) {
    const drag = treeDragRef.current;
    const mapElement = drag?.mapElement || event.currentTarget.closest?.(".field-real-map");
    return latLngFromMapClient(mapElement, event.clientX, event.clientY, drag?.mapCenter || mapCenter, drag?.mapZoom || mapZoom);
  }

  function cleanupFieldMarkerDrag() {
    const drag = treeDragRef.current;
    drag?.cleanup?.();
    treeDragRef.current = null;
  }

  function startFieldMarkerDrag(kind, code, event) {
    event.stopPropagation();
    if (kind === "tree") setSelectedTreeCode(String(code));
    if (!shouldDragMarkerPosition(event)) return;
    event.preventDefault();
    mapGestureRef.current.pointers.clear();
    mapGestureRef.current.startCenterWorld = null;
    mapGestureRef.current.startPointer = null;
    const markerElement = event.currentTarget.closest?.(".field-map-marker");
    const mapElement = markerElement?.closest?.(".field-real-map") || event.currentTarget.closest?.(".field-real-map");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const drag = {
      kind,
      code: String(code),
      pointerId: event.pointerId,
      moved: false,
      mapElement,
      mapCenter: { ...mapCenter },
      mapZoom,
      startPointer: { x: event.clientX, y: event.clientY },
      cleanup: null,
    };

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();
      moveEvent.stopPropagation?.();
      if (!pointerMovedFarEnough(drag, moveEvent)) return;
      const next = latLngFromMapClient(drag.mapElement, moveEvent.clientX, moveEvent.clientY, drag.mapCenter, drag.mapZoom);
      if (!next) return;
      drag.moved = true;
      if (drag.kind === "center") {
        updateDraft((current) => ({
          ...current,
          examCenter: {
            ...(fieldPackage?.examCenter || {}),
            ...(current.examCenter || {}),
            latitude: Number(next.lat.toFixed(8)),
            longitude: Number(next.lng.toFixed(8)),
          },
        }));
      } else {
        updateTreeDraft(drag.code, { latitude: Number(next.lat.toFixed(8)), longitude: Number(next.lng.toFixed(8)) });
      }
    };

    const end = (endEvent) => {
      if (endEvent.pointerId !== drag.pointerId) return;
      endEvent.preventDefault();
      endEvent.stopPropagation?.();
      cleanupFieldMarkerDrag();
    };

    drag.cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    treeDragRef.current = drag;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end, { passive: false });
    window.addEventListener("pointercancel", end, { passive: false });
  }

  function startTreeMarkerDrag(code, event) {
    startFieldMarkerDrag("tree", code, event);
  }

  function moveTreeMarkerDrag(event) {
    if (treeDragRef.current?.kind === "tree") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function endTreeMarkerDrag(event) {
    if (treeDragRef.current?.kind === "tree") {
      event.preventDefault();
      event.stopPropagation();
      cleanupFieldMarkerDrag();
    }
  }

  function startCenterMarkerDrag(event) {
    startFieldMarkerDrag("center", "__center__", event);
  }

  function moveCenterMarkerDrag(event) {
    if (treeDragRef.current?.kind === "center") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function endCenterMarkerDrag(event) {
    if (treeDragRef.current?.kind === "center") {
      event.preventDefault();
      event.stopPropagation();
      cleanupFieldMarkerDrag();
    }
  }

  function requestGpsPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("GPS is not available in this browser.")); return; }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
      );
    });
  }

  function stopGpsTracking() {
    if (gpsWatchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = null;
    gpsFirstFixRef.current = false;
    setGpsTracking(false);
    setGpsPosition(null);
  }

  function startGpsTracking() {
    if (!navigator.geolocation) {
      setError("GPS is not available in this browser.");
      return;
    }
    setError("");
    setStatus("Requesting GPS permission...");
    gpsFirstFixRef.current = false;
    setGpsTracking(true);
    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
        setGpsPosition(next);
        if (!gpsFirstFixRef.current) {
          gpsFirstFixRef.current = true;
          setMapCenterOverride({ lat: next.lat, lng: next.lng });
        }
        setStatus(`GPS tracking${Number.isFinite(next.accuracy) ? ` · accuracy approx. ${Math.round(next.accuracy)} m` : ""}.`);
      },
      (err) => {
        setError(`GPS could not be loaded: ${err?.message || "permission was denied"}.`);
        stopGpsTracking();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }
    );
  }

  function locateTablet() {
    if (gpsTracking) { stopGpsTracking(); setStatus("GPS tracking is off."); return; }
    startGpsTracking();
  }

  // Web Mercator ground resolution, used to draw the reported accuracy at true scale on the map.
  function gpsAccuracyRadiusPx(position) {
    const accuracy = Number(position?.accuracy);
    if (!Number.isFinite(accuracy) || accuracy <= 0) return 0;
    const metresPerPixel = (156543.03392 * Math.cos((Number(position.lat) * Math.PI) / 180)) / 2 ** mapZoom;
    if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 0;
    return Math.min(accuracy / metresPerPixel, 4000);
  }

  // Rigidly translates the whole standard setup — exam centre + every tree in the row — so the
  // centre lands on the given point while all relative offsets (the row geometry) are kept.
  function applyMoveEntireSetup(targetLat, targetLng) {
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
      setError(tt("moveAllNoCentre"));
      return;
    }
    const treesSnapshot = fieldTrees.map((tree) => ({
      key: fieldTreeKey(tree),
      lat: Number(tree.latitude),
      lng: Number(tree.longitude),
    }));
    updateDraft((current) => {
      const treeNotes = { ...(current.treeNotes || {}) };
      treesSnapshot.forEach(({ key, lat, lng }) => {
        // Keep each tree's offset from the current centre — unless it is invalid or absurdly far
        // (stale/corrupted preps have held trees thousands of km from the centre, e.g. parked in
        // the Atlantic; shifting those by the same delta kept them invisible and made Move-all
        // look like it "only moved the centre"). Anything beyond ~2 km falls back to the standard
        // row layout so every tree ALWAYS lands next to the target.
        let offsetLat = lat - centerLat;
        let offsetLng = lng - centerLng;
        if (!Number.isFinite(offsetLat) || !Number.isFinite(offsetLng) || Math.abs(offsetLat) > 0.02 || Math.abs(offsetLng) > 0.03) {
          const standard = fieldStandardOffsetForKey(key);
          offsetLat = standard.lat;
          offsetLng = standard.lng;
        }
        treeNotes[key] = {
          ...(treeNotes[key] || {}),
          latitude: Number((targetLat + offsetLat).toFixed(8)),
          longitude: Number((targetLng + offsetLng).toFixed(8)),
        };
      });
      return {
        ...current,
        examCenter: {
          ...(fieldPackage?.examCenter || {}),
          ...(current.examCenter || {}),
          latitude: Number(targetLat.toFixed(8)),
          longitude: Number(targetLng.toFixed(8)),
        },
        treeNotes,
      };
    });
    setMapCenterOverride({ lat: targetLat, lng: targetLng });
    setStatus(tt("moveAllDone"));
  }

  // "Move all trees here" — always works. Prefer a fresh GPS fix; if GPS is denied/unavailable
  // (common on tablets), fall back to the current map centre so the operator can pan the map to
  // the real spot and still relocate the whole setup. Confirmation is an in-app modal (native
  // window.confirm is silently suppressed in some tablet browsers, which made this look dead).
  async function moveEntireSetupToGps() {
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
      setError(tt("moveAllNoCentre"));
      return;
    }
    setError("");
    setStatus(tt("moveAllLocating"));
    let target;
    try {
      const pos = await requestGpsPosition();
      setGpsPosition(pos);
      target = { lat: Number(pos.lat), lng: Number(pos.lng), source: "gps" };
    } catch {
      target = { lat: Number(mapCenter.lat), lng: Number(mapCenter.lng), source: "map" };
    }
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) {
      setError(tt("moveAllNoGps"));
      return;
    }
    setStatus("");
    setMoveConfirm(target);
  }

  function confirmMoveEntireSetup() {
    const target = moveConfirm;
    setMoveConfirm(null);
    if (target) applyMoveEntireSetup(Number(target.lat), Number(target.lng));
  }

  function updateSelectedManagementData(patch) {
    if (!selectedTree) return;
    const base = selectedTree.practicingTreeAData || {};
    const local = selectedLocal.managementData || {};
    updateTreeDraft(fieldTreeKey(selectedTree), { managementData: { ...base, ...local, ...patch } });
  }

  function selectedInterventions() {
    const interventions = selectedManagementData.interventions;
    return Array.isArray(interventions) ? interventions : [];
  }

  function updateSelectedIntervention(index, patch) {
    const interventions = selectedInterventions().map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    updateSelectedManagementData({ interventions });
  }

  function addSelectedIntervention() {
    const interventions = [...selectedInterventions(), { id: vetbaraUid("field-tech"), technology: "", description: "" }];
    updateSelectedManagementData({ interventions });
  }

  function removeSelectedIntervention(index) {
    const interventions = selectedInterventions().filter((item, itemIndex) => itemIndex !== index);
    updateSelectedManagementData({ interventions });
  }

  function buildPrintableFieldMap(levelName) {
    const trees = fieldTrees.filter((tree) => normalizeFieldLevel(tree.level) === levelName);
    const centre = { lat: centerLat, lng: centerLng };
    const mapCentre = {
      lat: Number.isFinite(Number(mapCenter?.lat)) ? Number(mapCenter.lat) : (Number(trees[0]?.latitude) || defaultMapCenter.lat),
      lng: Number.isFinite(Number(mapCenter?.lng)) ? Number(mapCenter.lng) : (Number(trees[0]?.longitude) || defaultMapCenter.lng),
    };
    const printZoom = clampMapZoom(mapZoom);
    const centreWorld = latLngToWorld(mapCentre.lat, mapCentre.lng, printZoom);
    const centreTileX = Math.floor(centreWorld.x / 256);
    const centreTileY = Math.floor(centreWorld.y / 256);
    const offsetX = centreWorld.x - centreTileX * 256;
    const offsetY = centreWorld.y - centreTileY * 256;
    const tiles = [];
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const x = centreTileX + dx;
        const y = centreTileY + dy;
        tiles.push(`<img src="${tileUrl(x, y, printZoom)}" style="left:calc(50% + ${dx * 256 - offsetX}px);top:calc(50% + ${dy * 256 - offsetY}px)" />`);
      }
    }
    const point = (lat, lng) => {
      const pointWorld = latLngToWorld(lat, lng, printZoom);
      return { x: pointWorld.x - centreWorld.x, y: pointWorld.y - centreWorld.y };
    };
    const centreMarker = Number.isFinite(centerLat) && Number.isFinite(centerLng) ? (() => {
      const p = point(centerLat, centerLng);
      return `<div class="pdf-marker centre" style="left:calc(50% + ${p.x}px);top:calc(50% + ${p.y}px)"><span class="dot"></span><span class="label">Exam centre</span></div>`;
    })() : "";
    const treeMarkers = trees.map((tree) => {
      const p = point(tree.latitude, tree.longitude);
      const checked = Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited);
      return `<div class="pdf-marker tree ${checked ? "checked" : ""}" style="left:calc(50% + ${p.x}px);top:calc(50% + ${p.y}px)"><span class="dot"></span><span class="label">${fieldTreeLabel(tree.level, tree.code)}</span></div>`;
    }).join("");
    return `<section class="pdf-map"><h2>${levelName}</h2><div class="pdf-map-canvas">${tiles.join("")}${centreMarker}${treeMarkers}</div></section>`;
  }

  function managementDataForTree(tree) {
    if (!tree) return {};
    const key = fieldTreeKey(tree);
    const local = draft?.treeNotes?.[key] || {};
    const base = tree.managementData || tree.practicingTreeAData || {};
    return { ...base, ...(local.managementData || {}) };
  }

  function buildTreeDetailHtml(tree) {
    if (!tree) return "";
    const key = fieldTreeKey(tree);
    const local = draft?.treeNotes?.[key] || {};
    const data = managementDataForTree(tree);
    const interventions = Array.isArray(data.interventions) ? data.interventions : [];
    const label = overviewTreeLabel(tree, extraTreeToggles);
    const name = local.treeName || tree.name || label;
    return `<section class="pdf-tree-detail">
      <h2>${escapeHtml(label)} · ${escapeHtml(name)}</h2>
      <p class="pdf-tree-coords">${escapeHtml(formatCoord(tree.latitude))}, ${escapeHtml(formatCoord(tree.longitude))}</p>
      <div class="pdf-tree-grid">
        <div><strong>${escapeHtml(tt("taxon"))}</strong><span>${escapeHtml(data.taxon || "-")}</span></div>
        <div><strong>${escapeHtml(tt("heightM"))}</strong><span>${escapeHtml(String(data.heightM ?? "") || "-")}</span></div>
        <div><strong>${escapeHtml(tt("stemDiameterCm"))}</strong><span>${escapeHtml(String(data.stemDiameterCm ?? "") || "-")}</span></div>
        <div><strong>${escapeHtml(tt("crownSpreadM"))}</strong><span>${escapeHtml(String(data.crownSpreadM ?? "") || "-")}</span></div>
      </div>
      ${data.note ? `<div class="pdf-tree-note"><strong>${escapeHtml(tt("managementNote"))}</strong><p>${escapeHtml(data.note)}</p></div>` : ""}
      <div class="pdf-tree-interventions">
        <strong>${escapeHtml(tt("interventions"))}</strong>
        ${interventions.length ? `<ul>${interventions.map((iv) => `<li><strong>${escapeHtml(iv.technology || "-")}</strong>: ${escapeHtml(iv.description || "-")}</li>`).join("")}</ul>` : `<p class="pdf-muted">${escapeHtml(tt("noTechnologies"))}</p>`}
      </div>
    </section>`;
  }

  function openFieldLevelPdf(levelName) {
    const treesForLevel = fieldTrees.filter((tree) => normalizeFieldLevel(tree.level) === levelName);
    const treeADetails = treesForLevel
      .filter((tree) => String(tree.code || "").toUpperCase().startsWith("A"))
      .map((tree) => buildTreeDetailHtml(tree))
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>VetBara ${escapeHtml(levelName)} field map</title><style>
      @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018}.actions{position:fixed;top:8px;right:10px;z-index:20;display:flex;gap:8px}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}main{display:block}.pdf-map{break-inside:avoid}.pdf-map h2{margin:0 0 5mm;font-size:16pt}.pdf-map-canvas{position:relative;height:120mm;overflow:hidden;border:2px solid #102018;border-radius:10px;background:#e6efe9}.pdf-map-canvas img{position:absolute;width:256px;height:256px}.pdf-marker{position:absolute;width:0;height:0;z-index:5}.pdf-marker .dot{position:absolute;left:0;top:0;width:12px;height:12px;border-radius:999px;background:white;border:3px solid white;transform:translate(-50%,-50%);box-shadow:0 1px 5px rgba(0,0,0,.35)}.pdf-marker .label{position:absolute;left:16px;top:-17px;white-space:nowrap;border-radius:999px;background:white;border:3px solid white;padding:6px 10px;font-weight:900;box-shadow:0 2px 10px rgba(0,0,0,.25)}.pdf-marker.centre .dot,.pdf-marker.centre .label{background:#e7334d;color:white;border-color:white}.pdf-marker.checked .dot{background:#2d6f36}.pdf-marker.checked .label{border-color:#2d6f36;box-shadow:0 0 0 4px rgba(45,111,54,.22),0 2px 10px rgba(0,0,0,.25)}.pdf-tree-detail{margin-top:8mm;break-inside:avoid}.pdf-tree-detail h2{margin:0 0 2mm;font-size:14pt}.pdf-tree-coords{margin:0 0 4mm;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#597469;font-size:10pt}.pdf-tree-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:4mm}.pdf-tree-grid div{border:1px solid #d7e1d8;border-radius:8px;padding:3mm}.pdf-tree-grid strong{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#6b7c72;margin-bottom:1mm}.pdf-tree-note{margin-bottom:4mm}.pdf-tree-note strong{display:block;font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#6b7c72;margin-bottom:1mm}.pdf-tree-note p{margin:0;white-space:pre-wrap}.pdf-tree-interventions strong{display:block;font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#6b7c72;margin-bottom:2mm}.pdf-tree-interventions ul{margin:0;padding-left:5mm}.pdf-muted{color:#8a978f;margin:0}@media print{.actions{display:none}}
    </style></head><body><div class="actions"><button onclick="window.print()">${escapeHtml(tt("printPdf"))}</button><button onclick="if(navigator.share){navigator.share({title:'VetBara ${escapeHtml(levelName)} field map',text:'VetBara ${escapeHtml(levelName)} field map for ${escapeHtml(examId)}'})}">${escapeHtml(tt("share"))}</button></div><main>${buildPrintableFieldMap(levelName)}${treeADetails}</main></body></html>`;
    openPrintDocument(html, () => setError("The PDF window was blocked by the browser."));
  }

  function openFieldMapsPdf() {
    openFieldLevelPdf("Practicing");
    openFieldLevelPdf("Consulting");
  }

  const selectedTreeDisplayName = selectedLocal.treeName || selectedTree?.name || "";
  const selectedManagementData = selectedTree ? { ...(selectedTree.managementData || selectedTree.practicingTreeAData || {}), ...(selectedLocal.managementData || {}) } : {};
  const showManagementData = Boolean(selectedTree) && fieldTreeShowsManagementData(selectedTree.level, selectedTree.code);

  return (
    <main className="field-tablet-shell">
      {moveConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{tt("moveAllHere")}</h3>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {(moveConfirm.source === "gps" ? tt("moveAllConfirm") : tt("moveAllConfirmMap")).replace("{count}", String(fieldTrees.length))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setMoveConfirm(null)} className="field-ghost-button">{tt("cancel")}</button>
              <button type="button" onClick={confirmMoveEntireSetup} className="field-primary-button">{tt("moveAllHere")}</button>
            </div>
          </div>
        </div>
      )}
      <section className="field-tablet-workspace">
        {!fieldPackage ? (
          <section className="field-empty-package">
            {error ? (
              <>
                <div className="field-tablet-status error"><AlertTriangle className="h-4 w-4" />{error}</div>
                <button type="button" onClick={() => { loadAttemptRef.current = 0; downloadForOffline(); }} className="field-primary-button"><RefreshCw className="h-4 w-4" />{tt("retryLoad")}</button>
              </>
            ) : (
              <div className="field-tablet-status"><RefreshCw className="h-4 w-4" />{tt("loadingData")}</div>
            )}
          </section>
        ) : (
          <section className="field-tablet-main-grid">
            <div className="field-left-column">
              <div className="field-map-card">
                <div className="field-map-toolbar field-map-toolbar-above" onPointerDown={stopMapControlEvent} onPointerMove={stopMapControlEvent} onPointerUp={stopMapControlEvent} onPointerCancel={stopMapControlEvent} onWheel={stopMapControlEvent} onClick={stopMapControlEvent}>
                    <div className="field-toolbar-group" role="group" aria-label={tt("level")}>
                      <button type="button" className={activeTabletLevel === "Practicing" ? "active" : ""} onClick={() => switchTabletLevel("Practicing")}>{tt("levelPracticing")}</button>
                      <button type="button" className={activeTabletLevel === "Consulting" ? "active" : ""} onClick={() => switchTabletLevel("Consulting")}>{tt("levelConsulting")}</button>
                      <button type="button" className={activeTabletLevel === "Both" ? "active" : ""} onClick={() => switchTabletLevel("Both")}>{tt("both")}</button>
                    </div>
                    <div className="field-toolbar-group" role="group" aria-label={tt("mapControls")}>
                      <button type="button" className={`field-icon-button ${manualCoordsOpen ? "active" : ""}`} onClick={() => setManualCoordsOpen((current) => !current)} title={tt("manualCoordsTitle")} aria-label={tt("manualCoordsTitle")}><Pencil className="h-4 w-4" /></button>
                      <button type="button" className="field-move-all-button" onClick={moveEntireSetupToGps} title={tt("moveAllHere")}><Relocate className="h-3.5 w-3.5" />{tt("moveAllHere")}</button>
                      <select value={mapLayer} onChange={(event) => { mapLayerManualRef.current = true; setMapLayer(event.target.value); }} title={tt("mapControls")} className="rounded-xl border bg-white px-2 py-1.5 text-sm font-semibold text-slate-700">
                        <option value="cuzk">{fieldT("map.layer.cuzk")}</option>
                        <option value="esri">{fieldT("map.layer.esri")}</option>
                        <option value="osm">{fieldT("map.layer.osm")}</option>
                      </select>
                    </div>
                    <div className="field-toolbar-group" role="group" aria-label={tt("primaryActions")}>
                      <button type="button" onClick={sendDataToCentre} disabled={syncing} className={`field-primary-button ${lastSyncOk ? "field-sync-ok" : ""}`}><RefreshCw className="h-4 w-4" />{syncing ? tt("sending") : tt("sendToCentre")}</button>
                      <button type="button" onClick={openFieldMapsPdf} className="field-ghost-button"><FileSpreadsheet className="h-4 w-4" />{tt("pdf")}</button>
                    </div>
                    <div className="field-toolbar-group field-toolbar-lang" role="group" aria-label={tt("language")}>
                      <button type="button" className="field-icon-button" onClick={isFullscreen ? exitTabletFullscreen : requestTabletFullscreen} title={tt(isFullscreen ? "exitFullscreen" : "fullscreen")} aria-label={tt(isFullscreen ? "exitFullscreen" : "fullscreen")}>{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
                      <button type="button" className={fieldTabletLocale === "en" ? "active" : ""} onClick={() => changeFieldTabletLocale("en")}>EN</button>
                      <button type="button" className={fieldTabletLocale === "cs" ? "active" : ""} onClick={() => changeFieldTabletLocale("cs")}>CS</button>
                    </div>
                  </div>
                <div className="field-real-map" onPointerDown={handleMapPointerDown} onPointerMove={handleMapPointerMove} onPointerUp={handleMapPointerEnd} onPointerCancel={handleMapPointerEnd} onWheel={handleMapWheel}>
                  {error && <div className="field-map-message error"><AlertTriangle className="h-4 w-4" />{error}</div>}
                  <div className="field-pan-layer" ref={panLayerRef}>
                    <div className="field-tile-layer" aria-hidden="true">
                      {mapTiles.map((tile) => <img key={tile.key} src={tile.src} style={tile.style} loading="eager" decoding="async" draggable={false} onLoad={(event) => retainFieldTile(event.currentTarget.src)} alt="" />)}
                    </div>
                    {/* Markers live in their own layer that remounts (via key) whenever the map
                        recenters/zooms — iOS Safari otherwise keeps the composited tile+marker
                        layer's cached texture and leaves repositioned markers unpainted (trees
                        "vanish" right after Move-all). The key does NOT change during a transform
                        pan, so dragging stays smooth. */}
                    <div className="field-marker-layer" ref={markerLayerRef} key={`${mapCenter.lat}:${mapCenter.lng}:${mapZoom}:${activeTabletLevel}:${visibleFieldTrees.length}`}>
                    {Number.isFinite(centerLat) && Number.isFinite(centerLng) && (() => {
                      const p = mapPoint(centerLat, centerLng);
                      return <div className="field-map-marker center" style={{ ...p, ...fieldMarkerVisualStyle(center.labelDirection || "n", center.labelOffsetX, center.labelOffsetY) }}><span className="field-marker-stem" /><span className="field-marker-dot" title="Drag the dot to move the exact position" onPointerDown={startCenterMarkerDrag} /><button type="button" className="field-marker-label" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{tt("examCenter")}</button></div>;
                    })()}
                    {gpsPosition && (() => {
                      const p = mapPoint(gpsPosition.lat, gpsPosition.lng);
                      const radius = gpsAccuracyRadiusPx(gpsPosition);
                      return <>
                        {radius > 0 && <div className="field-map-gps-accuracy" style={{ ...p, width: `${radius * 2}px`, height: `${radius * 2}px` }} />}
                        <div className="field-map-marker gps" style={{ ...p, ...fieldMarkerVisualStyle("n", 0, 0) }} onPointerDown={(event) => event.stopPropagation()}><span className="field-marker-dot" /><span className="field-marker-label">{tt("gps")}</span></div>
                      </>;
                    })()}
                    {visibleFieldTrees.map((tree) => {
                      const p = mapPoint(tree.latitude, tree.longitude);
                      const key = fieldTreeKey(tree);
                      const selected = fieldTreeKey(selectedTree || {}) === key;
                      const visited = Boolean(draft?.treeNotes?.[key]?.visited);
                      const direction = draft?.treeNotes?.[key]?.labelDirection || tree.labelDirection || "n";
                      return <div key={key} className={`field-map-marker tree ${selected ? "selected" : ""} ${visited ? "visited" : ""}`} style={{ ...p, ...fieldMarkerVisualStyle(direction, tree.labelOffsetX, tree.labelOffsetY) }}><span className="field-marker-stem" /><span className="field-marker-dot" title="Drag the dot to move the exact position" onPointerDown={(event) => startTreeMarkerDrag(key, event)} /><button type="button" className="field-marker-label" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedTreeCode(key); if (activeTabletLevel !== "Both") setActiveTabletLevel(normalizeFieldLevel(tree.level)); }}>{fieldTreeLabel(tree.level, tree.code)}</button></div>;
                    })}
                    </div>
                  </div>
                  <div className="field-map-overlay-controls" onPointerDown={stopMapControlEvent} onPointerMove={stopMapControlEvent} onPointerUp={stopMapControlEvent} onPointerCancel={stopMapControlEvent} onWheel={stopMapControlEvent} onClick={stopMapControlEvent}>
                    <button type="button" className="field-map-overlay-button" onClick={() => setMapZoom((current) => clampMapZoom(current + 1))} title={tt("zoomIn")} aria-label={tt("zoomIn")}><ZoomIn className="h-4 w-4" /></button>
                    <button type="button" className="field-map-overlay-button" onClick={() => setMapZoom((current) => clampMapZoom(current - 1))} title={tt("zoomOut")} aria-label={tt("zoomOut")}><ZoomOut className="h-4 w-4" /></button>
                    <button type="button" className={`field-map-overlay-button ${gpsTracking ? "active" : ""}`} onClick={locateTablet} aria-pressed={gpsTracking} title={tt("gps")} aria-label={tt("gps")}><MapPin className="h-4 w-4" /></button>
                  </div>
                  <div className="field-map-attribution">{mapLayer === "cuzk" ? "© ČÚZK ortofoto" : mapLayer === "esri" ? "© Esri, Maxar, Earthstar Geographics" : "© OpenStreetMap contributors"}</div>
                </div>
              </div>
            </div>

            <aside className="field-detail-panel">
              {manualCoordsOpen && (
                <div className="field-manual-coords">
                  <div className="field-detail-header">
                    <div>
                      <span>{tt("examCenter")}</span>
                      <h2>{tt("manualCoordsTitle")}</h2>
                      <p className="field-drag-hint">{tt("manualCoordsHint")}</p>
                    </div>
                  </div>
                  <div className="field-two-cols">
                    <label className="field-detail-field">
                      <span>{tt("latitude")}</span>
                      <input type="number" step="0.000001" value={Number.isFinite(centerLat) ? centerLat : ""} onChange={(event) => updateCenterDraft({ latitude: event.target.value === "" ? "" : Number(event.target.value) })} />
                    </label>
                    <label className="field-detail-field">
                      <span>{tt("longitude")}</span>
                      <input type="number" step="0.000001" value={Number.isFinite(centerLng) ? centerLng : ""} onChange={(event) => updateCenterDraft({ longitude: event.target.value === "" ? "" : Number(event.target.value) })} />
                    </label>
                  </div>
                  <FieldCoordsCopyField
                    lat={centerLat}
                    lng={centerLng}
                    onApply={({ lat, lng }) => updateCenterDraft({ latitude: lat, longitude: lng })}
                    onCopyResult={(ok) => setStatus(ok ? tt("coordsCopied") : tt("coordsCopyFailed"))}
                    tt={tt}
                  />
                  <FieldCollapsibleSection title={tt("labelPosition")} className="field-assignment-box" defaultOpen={false}>
                    <label className="field-detail-field">
                      <span>{tt("labelPosition")}</span>
                      <select value={center.labelDirection || "n"} onChange={(event) => updateCenterDraft({ labelDirection: event.target.value })}>
                        {FIELD_LABEL_DIRECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <div className="field-label-offset-controls">
                      <label><span>{tt("labelOffsetX")}</span><input type="number" step="2" value={center.labelOffsetX ?? 0} onChange={(event) => updateCenterDraft({ labelOffsetX: Number(event.target.value || 0) })} /></label>
                      <label><span>{tt("labelOffsetY")}</span><input type="number" step="2" value={center.labelOffsetY ?? 0} onChange={(event) => updateCenterDraft({ labelOffsetY: Number(event.target.value || 0) })} /></label>
                      <button type="button" onClick={() => updateCenterDraft({ labelOffsetX: 0, labelOffsetY: 0 })}>{tt("resetOffset")}</button>
                    </div>
                  </FieldCollapsibleSection>
                  {selectedTree && (
                    <>
                      <div className="field-detail-header field-manual-coords-tree">
                        <div>
                          <span>{tt("selectedTree")}</span>
                          <h2>{fieldTreeLabel(selectedTree.level, selectedTree.code)}</h2>
                        </div>
                      </div>
                      <div className="field-two-cols">
                        <label className="field-detail-field">
                          <span>{tt("latitude")}</span>
                          <input type="number" step="0.000001" value={Number.isFinite(Number(selectedTree.latitude)) ? Number(selectedTree.latitude) : ""} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { latitude: event.target.value === "" ? "" : Number(event.target.value) })} />
                        </label>
                        <label className="field-detail-field">
                          <span>{tt("longitude")}</span>
                          <input type="number" step="0.000001" value={Number.isFinite(Number(selectedTree.longitude)) ? Number(selectedTree.longitude) : ""} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { longitude: event.target.value === "" ? "" : Number(event.target.value) })} />
                        </label>
                      </div>
                      <FieldCoordsCopyField
                        lat={selectedTree.latitude}
                        lng={selectedTree.longitude}
                        onApply={({ lat, lng }) => updateTreeDraft(fieldTreeKey(selectedTree), { latitude: lat, longitude: lng })}
                        onCopyResult={(ok) => setStatus(ok ? tt("coordsCopied") : tt("coordsCopyFailed"))}
                        tt={tt}
                      />
                    </>
                  )}
                </div>
              )}
              <FieldCollapsibleSection title={tt("treeOverviewTitle")} className="field-assignment-box" defaultOpen>
                <div className="field-extra-tree-toggles">
                  {FIELD_EXTRA_TREE_TOGGLE_KEYS.map((toggleKey) => {
                    const [level, rawCode] = toggleKey.split("-");
                    const baseCode = rawCode[0];
                    return (
                      <label key={toggleKey} className="field-extra-tree-toggle">
                        <input type="checkbox" checked={Boolean(extraTreeToggles[toggleKey])} onChange={() => toggleExtraTree(toggleKey)} />
                        <span>{tt(level === "Practicing" ? "levelPracticing" : "levelConsulting")} – {tt("secondTree")} {baseCode}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="field-tree-overview-list">
                  {fieldTrees.map((tree) => {
                    const key = fieldTreeKey(tree);
                    const local = draft?.treeNotes?.[key] || {};
                    const taxon = local.managementData?.taxon || tree.managementData?.taxon || tree.practicingTreeAData?.taxon || "-";
                    const checked = Boolean(local.visited);
                    const isSelected = selectedTree && fieldTreeKey(selectedTree) === key;
                    return (
                      <button key={key} type="button" className={`field-tree-overview-row ${isSelected ? "selected" : ""}`} onClick={() => { setSelectedTreeCode(key); if (activeTabletLevel !== "Both") setActiveTabletLevel(normalizeFieldLevel(tree.level)); }}>
                        <span className="field-tree-overview-code">{overviewTreeLabel(tree, extraTreeToggles)}</span>
                        <span className="field-tree-overview-taxon">{taxon}</span>
                        <span className={`field-tree-overview-checked ${checked ? "yes" : ""}`}>{checked ? "✓" : "—"}</span>
                      </button>
                    );
                  })}
                </div>
              </FieldCollapsibleSection>
              {selectedTree ? (
                <>
                  <div className="field-detail-header">
                    <div>
                      <span>{tt("selectedTree")}</span>
                      <h2>{fieldTreeLabel(selectedTree.level, selectedTree.code)}</h2>
                      <p>{formatCoord(selectedTree.latitude)}, {formatCoord(selectedTree.longitude)}</p>
                    </div>
                    <label className="field-visited-toggle"><input type="checkbox" checked={Boolean(selectedLocal.visited)} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { visited: event.target.checked })} />{Boolean(selectedLocal.visited) && <Check className="h-3.5 w-3.5" />}{tt("checked")}</label>
                  </div>
                  <FieldCollapsibleSection title={tt("assignmentSection")} className="field-assignment-box" defaultOpen>
                    <div className="field-assignment-row editable">
                      <label><span>{tt("level")}</span><select value={normalizeFieldLevel(selectedTree.level)} onChange={(event) => { const nextLevel = normalizeFieldLevel(event.target.value); setActiveTabletLevel(nextLevel); setSelectedTreeCode(fieldTreeKey(nextLevel, selectedTree.code)); }}><option>Practicing</option><option>Consulting</option></select></label>
                      <label><span>{tt("tree")}</span><select value={selectedTree.code} onChange={(event) => setSelectedTreeCode(fieldTreeKey(selectedTree.level, event.target.value))}>{FIELD_TREE_CODES.map((code) => <option key={code}>{code}</option>)}</select></label>
                    </div>
                  </FieldCollapsibleSection>
                  <div className="field-detail-field">
                    <span><Camera className="mr-1 inline h-3.5 w-3.5" />{tt("photosSection")}</span>
                    <label className="field-photo-add-button">
                      {tt("addPhotos")}
                      <input type="file" accept="image/*" capture="environment" multiple onChange={(event) => { addTreePhotos(fieldTreeKey(selectedTree), event.target.files); event.target.value = ""; }} className="hidden" />
                    </label>
                  </div>
                  {selectedTree.photos?.length > 0 && (
                    <div className="field-photo-grid">
                      {selectedTree.photos.map((photo) => (
                        <figure key={photo.id || photo.url}>
                          <img src={photo.url} alt={photo.caption || photo.fileName || "Photo"} />
                          <figcaption>{photo.caption || photo.fileName}</figcaption>
                          <button type="button" className="field-photo-remove" onClick={() => removeTreePhoto(fieldTreeKey(selectedTree), photo.id)} aria-label={tt("removePhoto")}>×</button>
                        </figure>
                      ))}
                    </div>
                  )}
                  {showManagementData && <FieldCollapsibleSection title={tt("managementSection")} className="field-practicing-box" defaultOpen>
                    <label><span>{tt("taxon")}</span><input value={selectedManagementData.taxon || ""} onChange={(event) => updateSelectedManagementData({ taxon: event.target.value })} /></label>
                    <div className="field-three-cols">
                      <label><span>{tt("heightM")}</span><input value={selectedManagementData.heightM || ""} onChange={(event) => updateSelectedManagementData({ heightM: event.target.value })} /></label>
                      <label><span>{tt("stemDiameterCm")}</span><input value={selectedManagementData.stemDiameterCm || ""} onChange={(event) => updateSelectedManagementData({ stemDiameterCm: event.target.value })} /></label>
                      <label><span>{tt("crownSpreadM")}</span><input value={selectedManagementData.crownSpreadM || ""} onChange={(event) => updateSelectedManagementData({ crownSpreadM: event.target.value })} /></label>
                    </div>
                    <label><span>{tt("managementNote")}</span><textarea value={selectedManagementData.note || ""} onChange={(event) => updateSelectedManagementData({ note: event.target.value })} rows={3} /></label>
                    <div className="field-section-title"><h4>{tt("interventions")}</h4><button type="button" onClick={addSelectedIntervention}>{tt("addTechnology")}</button></div>
                    {selectedInterventions().map((intervention, index) => <div key={intervention.id || index} className="field-intervention editable">
                      <label><span>{tt("technology")}</span><input value={intervention.technology || ""} onChange={(event) => updateSelectedIntervention(index, { technology: event.target.value })} /></label>
                      <label><span>{tt("description")}</span><textarea value={intervention.description || ""} onChange={(event) => updateSelectedIntervention(index, { description: event.target.value })} rows={3} /></label>
                      <button type="button" className="field-remove-button" onClick={() => removeSelectedIntervention(index)}>{tt("removeTechnology")}</button>
                    </div>)}
                    {!selectedInterventions().length && <p className="field-muted">{tt("noTechnologies")}</p>}
                  </FieldCollapsibleSection>}
                  <FieldCollapsibleSection title={tt("labelPosition")} className="field-assignment-box" defaultOpen={false}>
                    <label className="field-detail-field">
                      <span>{tt("labelPosition")}</span>
                      <select value={selectedLocal.labelDirection || selectedTree.labelDirection || "n"} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { labelDirection: event.target.value })}>
                        {FIELD_LABEL_DIRECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <div className="field-label-offset-controls">
                      <label><span>{tt("labelOffsetX")}</span><input type="number" step="2" value={selectedLocal.labelOffsetX ?? selectedTree.labelOffsetX ?? 0} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { labelOffsetX: Number(event.target.value || 0) })} /></label>
                      <label><span>{tt("labelOffsetY")}</span><input type="number" step="2" value={selectedLocal.labelOffsetY ?? selectedTree.labelOffsetY ?? 0} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { labelOffsetY: Number(event.target.value || 0) })} /></label>
                      <button type="button" onClick={() => updateTreeDraft(fieldTreeKey(selectedTree), { labelOffsetX: 0, labelOffsetY: 0 })}>{tt("resetOffset")}</button>
                    </div>
                  </FieldCollapsibleSection>
                  <p className="field-drag-hint"><MapPin className="h-3.5 w-3.5" />{tt("dragHint")}</p>
                </>
              ) : <p>{tt("chooseTree")}</p>}
            </aside>
          </section>
        )}
      </section>
    </main>
  );
}

// Opened by scanning the "Připojit tablet/telefon" QR in Centre's Scan podkladů panel
// (?mode=scan-capture&examId=...). Deliberately dumb: it has no candidate/testBank/variant
// context at all, so it can't decode or sort anything itself — it just captures page photos and
// uploads them to this exam's server-side scan inbox; the Centre browser that showed the QR
// polls that inbox and runs the full identify-and-detect pipeline there, where the exam data
// actually lives (see processScanImage). Capture is a local queue, not one-photo-at-a-time: the
// camera button re-arms the instant a photo is resized and queued (no network wait), so someone
// can shoot through a whole stack of pages in a few seconds while a small number of uploads run
// in the background - what used to be a serial photograph-wait-photograph-wait loop.
const SCAN_CAPTURE_UPLOAD_CONCURRENCY = 2;
const SCAN_CAPTURE_MAX_DIMENSION = 2200;
function ScanCaptureMobilePage() {
  const [uiLanguage] = useState(() => (typeof window !== "undefined" && window.localStorage.getItem("vetbara-field-tablet-lang")) || "cs");
  const t = makeTranslator(uiLanguage);
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const query = new URLSearchParams(window.location.search);
  const examId = query.get("examId") || CENTRE_QR_ID;
  // queue items: { id, dataUrl, status: "queued" | "uploading" | "done" | "error" }
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  queueRef.current = queue;
  const activeUploadsRef = useRef(0);
  const [captureError, setCaptureError] = useState("");

  function updateItem(id, patch) {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function runQueue() {
    while (activeUploadsRef.current < SCAN_CAPTURE_UPLOAD_CONCURRENCY) {
      const next = queueRef.current.find((item) => item.status === "queued");
      if (!next) break;
      activeUploadsRef.current += 1;
      updateItem(next.id, { status: "uploading" });
      fetch(`/api/exams/${encodeURIComponent(examId)}/scan-inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: next.dataUrl, capturedAt: new Date().toISOString() }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
          updateItem(next.id, { status: "done" });
        })
        .catch((uploadError) => {
          console.error("Scan capture upload failed", uploadError);
          updateItem(next.id, { status: "error" });
        })
        .finally(() => {
          activeUploadsRef.current -= 1;
          runQueue();
        });
      // queueRef.current won't reflect the "uploading" patch until the next render, so the loop
      // condition above would otherwise immediately re-pick the same "queued" item.
      queueRef.current = queueRef.current.map((item) => (item.id === next.id ? { ...item, status: "uploading" } : item));
    }
  }

  async function captureFile(file) {
    setCaptureError("");
    const id = vetbaraUid("scan-queue");
    try {
      const image = await loadImageFromFile(file);
      // No auto-enhance here on purpose: it is a heavy full-resolution pass (three-channel
      // histogram + rewrite), pointless to run twice, and processScanImage runs it again once
      // the Centre downloads the page - doing it here only slowed down capture and doubled up
      // the contrast stretch, which does not decode QRs any better.
      const canvas = resizeCanvasToMaxDimension(imageElementToCanvas(image), SCAN_CAPTURE_MAX_DIMENSION);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      setQueue((prev) => [{ id, dataUrl, status: "queued" }, ...prev]);
      queueRef.current = [{ id, dataUrl, status: "queued" }, ...queueRef.current];
      runQueue();
    } catch (captureFailure) {
      console.error("Scan capture failed", captureFailure);
      setCaptureError(t("scanCapture.uploadError"));
    }
  }

  function retryItem(id) {
    updateItem(id, { status: "queued" });
    queueRef.current = queueRef.current.map((item) => (item.id === id ? { ...item, status: "queued" } : item));
    runQueue();
  }

  function retryAllErrors() {
    const erroredIds = new Set(queueRef.current.filter((item) => item.status === "error").map((item) => item.id));
    if (!erroredIds.size) return;
    setQueue((prev) => prev.map((item) => (erroredIds.has(item.id) ? { ...item, status: "queued" } : item)));
    queueRef.current = queueRef.current.map((item) => (erroredIds.has(item.id) ? { ...item, status: "queued" } : item));
    runQueue();
  }

  const doneCount = queue.filter((item) => item.status === "done").length;
  const pendingCount = queue.filter((item) => item.status === "queued" || item.status === "uploading").length;
  const errorCount = queue.filter((item) => item.status === "error").length;
  const statusLabel = { queued: t("scanCapture.status.queued"), uploading: t("scanCapture.status.uploading"), done: t("scanCapture.status.done"), error: t("scanCapture.status.error") };
  const statusTone = { queued: "bg-slate-700 text-slate-200", uploading: "bg-amber-500 text-amber-950", done: "bg-emerald-500 text-emerald-950", error: "bg-rose-500 text-white" };

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-6 w-6" />
          <h1 className="text-xl font-bold">{t("scanCapture.title")}</h1>
        </div>
        <p className="mb-4 text-sm text-slate-300">{t("scanCapture.helper")}</p>

        <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400 text-white">
          <Camera className="h-8 w-8" />
          <span className="text-lg font-semibold">{t("scanCapture.captureButton")}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) captureFile(file); }}
          />
        </label>

        {captureError && <div className="mt-3 rounded-xl border border-rose-500 bg-rose-950 p-3 text-sm text-rose-200">{captureError}</div>}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-300">
          <span>{tf("scanCapture.uploadedCount", { count: doneCount })}</span>
          {pendingCount > 0 && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-amber-950">{tf("scanCapture.pendingCount", { count: pendingCount })}</span>}
          {errorCount > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{tf("scanCapture.errorCount", { count: errorCount })}</span>}
          {errorCount > 0 && (
            <button type="button" onClick={retryAllErrors} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-700">
              {t("scanCapture.retryAll")}
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {queue.map((item) => (
            <div key={item.id} className="relative">
              <img src={item.dataUrl} alt="scanned page" className="h-24 w-full rounded-lg border border-slate-700 object-cover" />
              <span className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>
              {item.status === "error" && (
                <button type="button" onClick={() => retryItem(item.id)} className="absolute inset-x-1 top-1 rounded-full bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {t("scanCapture.retry")}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// Dedicated mobile-only access for Consulting candidates (mode=consulting-field), scanned with
// their own phone rather than the shared exam tablet, so they can capture photos/audio for their
// report while actually standing at the tree. Self-contained (own QR/session resolution, like
// FieldTabletPage/ScanCaptureMobilePage above) rather than routed through CandidateView, since it
// needs none of the Test/Outdoor/Orientation plumbing — only the report_draft/report_photo sync
// events and media storage, called directly here with the same payload shapes ReportSection's
// updateReport/addReportPhoto use, so both entry points write into the exact same report draft.
// Shared field-capture UI for Consulting candidates - Tree A/B switch, photo/audio capture, the
// always-visible marking-criteria panel, and the two-step submit. Takes an ALREADY-resolved
// session as props rather than doing its own auth, so it can run two different ways: standalone
// inside ConsultingFieldMobilePage (its own QR/session resolution, for the dedicated mobile link)
// or embedded inside CandidateView (reusing the session already open in that tab, for the
// "switch to mobile field mode" banner offered on a small screen) - same component, same sync
// events, no separate token ever has to be minted for the in-app case.
function ConsultingFieldCapture({ sessionToken, candidateId, candidateName, t, onClose }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [activeTree, setActiveTree] = useState(REPORT_TREES[0]);
  const [draft, setDraft] = useState(createReportDraft());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [draftLoaded, setDraftLoaded] = useState(false);
  const sectionOpenedRef = useRef(false);
  const [fieldNotesDraft, setFieldNotesDraft] = useState(CONSULTING_FIELD_NOTES_TEMPLATE);
  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");
  const [recordingStatus, setRecordingStatus] = useState("idle");
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingError, setRecordingError] = useState("");
  const recorderRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [submitStep, setSubmitStep] = useState(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const voiceRecordingSupported = isRecordingSupported();

  function sendEvent(type, entityType, entityId, payload) {
    const createdAt = new Date().toISOString();
    return syncBatch(sessionToken, [{
      clientEventId: `${type}-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type, entityType, entityId, candidateId, payload, createdAt,
    }]).catch((error) => console.error("Consulting field sync failed", type, error));
  }

  useEffect(() => {
    let cancelled = false;
    fetchCandidateEvaluation(sessionToken, candidateId)
      .then((result) => {
        if (cancelled) return;
        if (result?.reportDraft && typeof result.reportDraft === "object") {
          setDraft({ ...createReportDraft(), ...result.reportDraft });
        }
        const alreadyOpen = (Array.isArray(result?.sections) ? result.sections : [])
          .some((section) => (section.section_key ?? section.sectionKey) === "report");
        if (!alreadyOpen && !sectionOpenedRef.current) {
          sectionOpenedRef.current = true;
          sendEvent("candidate_section.opened", "candidate_section", `${candidateId}:report`, { sectionKey: "report", openedAt: new Date().toISOString(), openedAtLabel: nowStamp() });
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setDraftLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, candidateId]);

  // Seed the field-notes textarea from the loaded draft (or the criteria template when empty) only
  // when the active tree changes or the draft first finishes loading — not on every draft update,
  // otherwise typing a photo caption elsewhere would blow away notes being typed here.
  useEffect(() => {
    if (!draftLoaded) return;
    const existing = draftRef.current[activeTree]?.fieldNotes;
    setFieldNotesDraft(existing || CONSULTING_FIELD_NOTES_TEMPLATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTree, draftLoaded]);

  function saveFieldNotes(value = fieldNotesDraft) {
    const tree = activeTree;
    setDraft((prev) => ({ ...prev, [tree]: { ...(prev[tree] ?? createReportDraft()[tree]), fieldNotes: value } }));
    sendEvent("report_draft.saved", "report_draft", `${candidateId}:report:${tree}:fieldNotes`, {
      candidateId, sectionKey: "report", treeId: tree, fieldKey: "fieldNotes", fieldType: "fieldNotes", value, updatedAt: new Date().toISOString(),
    });
  }

  // photoBusy only covers the LOCAL part (compress + add to the draft, a few hundred ms) - sending
  // the sync event, saving to IndexedDB, and uploading all continue in the background afterwards,
  // so the candidate can start the next photo immediately instead of waiting for a network round
  // trip every time.
  async function handlePhotoFile(file) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoStatus("");
    const tree = activeTree;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      const existingPhotos = draftRef.current[tree]?.photos ?? [];
      const capturedAt = new Date().toISOString();
      const autoName = tf("report.photo.autoName", { index: existingPhotos.length + 1 });
      const photo = { id: `P-${existingPhotos.length + 1}-${Date.now().toString(36)}`, name: autoName, type: "image/jpeg", size: approxDataUrlBytes(dataUrl), dataUrl, description: "", useInReport: true, caption: autoName, capturedAt, createdAt: capturedAt };

      setDraft((prev) => {
        const current = prev[tree] ?? createReportDraft()[tree];
        return { ...prev, [tree]: { ...current, photos: [...(current.photos ?? []), photo] } };
      });
      setPhotoStatus(t("report.photoAdded"));

      (async () => {
        try {
          await sendEvent("report_photo.added", "report_photo", `${candidateId}:report:${tree}:${photo.id}`, {
            candidateId, sectionKey: "report", treeId: tree, photoId: photo.id, name: photo.name, type: photo.type,
            size: photo.size, hasDataUrl: true, description: "", useInReport: true, caption: photo.caption, capturedAt,
          });
          const blob = dataUrlToBlob(dataUrl);
          const clientMediaId = `photo-${candidateId}-${tree}-${photo.id}`;
          const meta = { clientMediaId, type: "photo", mediaType: "photo", candidateId, examinerId: null, sectionKey: "report", tree, fileName: photo.name, mimeType: blob.type, sizeBytes: blob.size, durationMs: null, cleaned: false, caption: photo.caption, description: "" };
          await saveLocalMedia({ ...meta, blob, createdAt: capturedAt });
          try {
            const uploaded = await uploadExamMedia(sessionToken, meta, blob);
            await updateLocalMedia(clientMediaId, { uploadState: uploaded.stored ? "uploaded" : "local", remoteId: uploaded.id ?? null });
          } catch {
            await updateLocalMedia(clientMediaId, { uploadState: "local" });
          }
        } catch (error) {
          console.warn("Consulting field photo background sync failed", error);
        }
      })();
    } catch (error) {
      console.error("Consulting field photo capture failed", error);
      setPhotoStatus(t("report.photoError"));
    } finally {
      setPhotoBusy(false);
    }
  }

  useEffect(() => {
    if (recordingStatus !== "recording" || !recordingStartedAtRef.current) return undefined;
    const timer = window.setInterval(() => setRecordingElapsedMs(Date.now() - recordingStartedAtRef.current), 1000);
    return () => window.clearInterval(timer);
  }, [recordingStatus]);

  useEffect(() => () => { recorderRef.current?.cleanupStream(); }, []);

  async function startRecording() {
    setRecordingError("");
    if (!voiceRecordingSupported) { setRecordingError(t("voice.error.unsupported")); return; }
    if (recorderRef.current) return;
    try {
      const recorder = new OutdoorVoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setRecordingElapsedMs(0);
      setRecordingStatus("recording");
    } catch (error) {
      recorderRef.current = null;
      setRecordingError(error?.name === "NotAllowedError" ? t("voice.error.permission") : t("voice.error.start"));
    }
  }
  function pauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recordingStatus !== "recording") return;
    if (recorder.pause()) setRecordingStatus("paused");
  }
  function resumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recordingStatus !== "paused") return;
    if (recorder.resume()) setRecordingStatus("recording");
  }
  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecordingStatus("processing");
    const tree = activeTree;
    try {
      const result = await recorder.stop();
      if (!result?.blob || result.blob.size === 0) { setRecordingStatus("idle"); return; }
      const capturedAt = new Date().toISOString();
      const clientMediaId = `report-audio-${candidateId}-${tree}-${Date.now()}`;
      const ext = result.mimeType.includes("mp4") ? "m4a" : result.mimeType.includes("ogg") ? "ogg" : "webm";
      const fileName = `report_${candidateId}_${tree}_${capturedAt.replace(/[:.]/g, "-")}.${ext}`;
      const meta = {
        clientMediaId, type: "audio", mediaType: "audio", candidateId, examinerId: null, sectionKey: "report", tree,
        fileName, mimeType: result.mimeType, sizeBytes: result.blob.size, durationMs: result.durationMs, cleaned: true,
        caption: `${candidateName} — report ${tree}`,
        payload: { recordingStartedAt: recordingStartedAtRef.current ? new Date(recordingStartedAtRef.current).toISOString() : null },
      };
      await saveLocalMedia({ ...meta, blob: result.blob });
      let uploadState = "local";
      try {
        const uploaded = await uploadExamMedia(sessionToken, meta, result.blob);
        uploadState = uploaded.stored ? "uploaded" : "local";
        await updateLocalMedia(clientMediaId, { uploadState, remoteId: uploaded.id ?? null });
      } catch {
        await updateLocalMedia(clientMediaId, { uploadState: "local" });
      }
      await sendEvent("report_audio.added", "report_audio", `${candidateId}:report:${tree}:${clientMediaId}`, {
        candidateId, sectionKey: "report", treeId: tree, clientMediaId, fileName, durationMs: result.durationMs, capturedAt, uploadState,
      });
      setDraft((prev) => {
        const current = prev[tree] ?? createReportDraft()[tree];
        return { ...prev, [tree]: { ...current, recordings: [...(current.recordings ?? []), { id: clientMediaId, fileName, durationMs: result.durationMs, capturedAt, uploadState }] } };
      });
      recordingStartedAtRef.current = null;
      setRecordingStatus("idle");
    } catch (error) {
      console.error("Consulting field recording save failed", error);
      setRecordingStatus("error");
      setRecordingError(t("voice.error.save"));
    }
  }

  async function finalizeSubmit() {
    setSubmitBusy(true);
    saveFieldNotes();
    await sendEvent("candidate_section.closed", "candidate_section", `${candidateId}:report`, {
      sectionKey: "report", closedAt: new Date().toISOString(), closedAtLabel: nowStamp(),
    });
    setSubmitBusy(false);
    setSubmitStep(0);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-sm rounded-2xl border border-emerald-500 bg-emerald-950 p-5 text-center">
          <Check className="mx-auto mb-2 h-8 w-8 text-emerald-300" />
          <p className="text-sm text-emerald-100">{t("consultingField.submitted")}</p>
          {onClose && <button type="button" onClick={onClose} className="mt-4 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950">{t("common.back")}</button>}
        </div>
      </main>
    );
  }

  const treePhotos = draft[activeTree]?.photos ?? [];
  const treeRecordings = draft[activeTree]?.recordings ?? [];
  const recording = recordingStatus === "recording";
  const paused = recordingStatus === "paused";
  const processing = recordingStatus === "processing";

  return (
    <main className="min-h-screen bg-slate-950 pb-28 text-white">
      <div className="mx-auto max-w-md p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">{t("consultingField.title")}</div>
            <div className="text-lg font-bold">{candidateName}</div>
          </div>
          {onClose && <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300">{t("common.back")}</button>}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {REPORT_TREES.map((tree) => (
            <button
              key={tree}
              type="button"
              onClick={() => setActiveTree(tree)}
              className={`rounded-2xl border-2 px-3 py-3 text-sm font-bold ${tree === activeTree ? "border-emerald-400 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}
            >
              {tree} <span className="ml-1 text-xs font-normal text-slate-400">({(draft[tree]?.photos ?? []).length} 📷 · {(draft[tree]?.recordings ?? []).length} 🎙)</span>
            </button>
          ))}
        </div>

        {/* Capture icon row - sticky so it stays reachable while the criteria panel / gallery /
            field notes below get long enough to scroll (photos and recordings accumulate for two
            trees over what can be a long walk between them). */}
        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <label className="flex flex-col items-center gap-1">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${photoBusy ? "bg-emerald-800" : "bg-emerald-600"}`}>
                <Camera className="h-5 w-5" />
              </span>
              <span className="text-[10px] font-semibold text-slate-300">{t("report.takePhoto")}</span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                capture="environment"
                className="hidden"
                disabled={photoBusy}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) handlePhotoFile(file); }}
              />
            </label>

            <button
              type="button"
              onClick={recording || paused ? stopRecording : startRecording}
              disabled={processing || (!recording && !paused && !voiceRecordingSupported)}
              className="flex flex-col items-center gap-1"
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${paused ? "bg-amber-500" : recording ? "animate-pulse bg-red-600" : "bg-sky-600"}`}>
                {recording || paused ? <StopIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
              </span>
              <span className="text-[10px] font-semibold text-slate-300">{t("consultingField.recordAudio")}</span>
            </button>

            {(recording || paused) && (
              <>
                <button
                  type="button"
                  onClick={paused ? resumeRecording : pauseRecording}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900"
                  aria-label={paused ? t("consultingField.resume") : t("consultingField.pause")}
                >
                  {paused ? <PlayIcon className="h-5 w-5" /> : <PauseIcon className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-slate-300">{formatRecordingClock(recordingElapsedMs)}</div>
                  <VoiceHistogram getVoiceLevels={() => recorderRef.current?.getFrequencyBins()} active={recording} />
                </div>
              </>
            )}
          </div>
          {photoStatus && <div className="mt-2 text-xs text-slate-400">{photoStatus}</div>}
          {recordingError && <div className="mt-2 rounded-xl border border-rose-500 bg-rose-950 p-2 text-xs text-rose-200">{recordingError}</div>}
          {!voiceRecordingSupported && <div className="mt-2 rounded-xl border border-amber-500 bg-amber-950 p-2 text-xs text-amber-200">{t("voice.error.unsupported")}</div>}
        </div>

        <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-900">
          <button type="button" onClick={() => setCriteriaOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-semibold text-slate-200">
            {t("consultingField.criteriaTitle")}
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${criteriaOpen ? "rotate-180" : ""}`} />
          </button>
          {criteriaOpen && (
            <div className="space-y-3 border-t border-slate-800 p-3 text-xs leading-relaxed text-slate-300">
              {CONSULTING_REPORT_CRITERIA.map((section, index) => (
                <div key={section.key}>
                  <div className="font-semibold text-slate-100">{index + 1}. {section.title} <span className="font-normal text-slate-400">({section.marks} marks)</span></div>
                  <div className="mt-0.5 text-slate-400">{section.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {treePhotos.length > 0 && (
          <div className="mb-4 grid grid-cols-4 gap-2">
            {[...treePhotos].reverse().map((photo) => (
              <img key={photo.id} src={photo.dataUrl} alt={photo.caption} className="h-16 w-full rounded-lg border border-slate-700 object-cover" />
            ))}
          </div>
        )}
        {treeRecordings.length > 0 && (
          <div className="mb-4 space-y-1 text-xs text-slate-400">
            {treeRecordings.map((recEntry) => (
              <div key={recEntry.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1">
                <MicIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{formatRecordingClock(recEntry.durationMs || 0)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-24">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t("report.fieldNotesPrivate")}</label>
          <textarea
            value={fieldNotesDraft}
            onChange={(event) => setFieldNotesDraft(event.target.value)}
            onBlur={() => saveFieldNotes()}
            rows={8}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-950/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setSubmitStep(1)} className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-slate-950">
            {t("consultingField.closeAndSubmit")}
          </button>
        </div>
      </div>

      {submitStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900">
            <p className="text-sm font-semibold">
              {t("consultingField.confirmBothTrees")}
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setSubmitStep(0)} className="flex-1 rounded-xl border px-3 py-2 text-sm font-semibold">{t("common.back")}</button>
              <button
                type="button"
                disabled={submitBusy}
                onClick={finalizeSubmit}
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              >
                {submitBusy ? t("consultingField.submitting") : t("consultingField.confirmYes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Thin wrapper: resolves its own QR/session (mode=consulting-field, scanned fresh on the
// candidate's own phone) and hands the result to ConsultingFieldCapture. Kept separate from the
// embedded in-app use (the "switch to mobile field mode" banner in CandidateView) so a page
// opened straight from a QR code never needs an existing app session to work.
function ConsultingFieldMobilePage() {
  const [uiLanguage] = useState(() => (typeof window !== "undefined" && window.localStorage.getItem("vetbara-field-tablet-lang")) || "cs");
  const t = makeTranslator(uiLanguage);
  const query = new URLSearchParams(window.location.search);
  const qrToken = query.get("token") || "";
  const candidateIdParam = query.get("id") || "";
  const candidateNameParam = query.get("name") || "";

  const [auth, setAuth] = useState({
    status: qrToken ? "loading" : "error",
    sessionToken: "", candidateId: candidateIdParam, candidateName: candidateNameParam,
    error: qrToken ? "" : t("consultingField.missingToken"),
  });
  // This link carries the SAME qr_token as the candidate's main tablet session (just a different
  // ?mode= for client-side routing) - so opening it on their own phone is, from the device-bound
  // PIN gate's point of view, a genuinely different device asking for the SAME token. Handled the
  // same way the main app's resolveAccessWithFallback does: a PIN challenge, or a one-time "choose
  // a PIN" prompt if this happens to be the very first device to ever use the token.
  const deviceIdRef = useRef(null);
  if (!deviceIdRef.current) deviceIdRef.current = getOrCreateDeviceId();
  const [pinChallenge, setPinChallenge] = useState(null);
  const [setPinPrompt, setSetPinPrompt] = useState(null);

  async function attemptAuth(pin) {
    try {
      const resolved = await resolveQrToken(qrToken, { deviceId: deviceIdRef.current, pin });
      if (resolved.role && resolved.role !== "Candidate") {
        setAuth((prev) => ({ ...prev, status: "error", error: t("consultingField.wrongRole") }));
        return;
      }
      const sessionToken = resolved.sessionToken;
      const boot = await bootstrapSession(sessionToken).catch(() => null);
      const candidateId = resolved.subjectId || candidateIdParam;
      const candidateName = boot?.candidate?.name || candidateNameParam || candidateId;
      setPinChallenge(null);
      setAuth({ status: "ready", sessionToken, candidateId, candidateName, error: "" });
      if (resolved.promptSetPin) setSetPinPrompt(sessionToken);
    } catch (error) {
      if (error?.body?.requiresPin) {
        setPinChallenge({ wrongPin: Boolean(error?.body?.wrongPin) });
        return;
      }
      if (error?.body?.deviceLimitReached) {
        setAuth((prev) => ({ ...prev, status: "error", error: t("qr.deviceLimit") }));
        return;
      }
      setAuth((prev) => ({ ...prev, status: "error", error: error?.message || t("consultingField.authFailed") }));
    }
  }

  useEffect(() => {
    if (!qrToken) return;
    attemptAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  if (pinChallenge) {
    return (
      <QrPinModal
        mode="enter"
        wrongPin={pinChallenge.wrongPin}
        onSubmit={(pin) => attemptAuth(pin)}
        onCancel={() => { setPinChallenge(null); setAuth((prev) => ({ ...prev, status: "error", error: t("consultingField.authFailed") })); }}
        t={t}
      />
    );
  }
  if (setPinPrompt) {
    return (
      <QrPinModal
        mode="set"
        onSubmit={async (pin) => {
          try { await setQrPin(setPinPrompt, pin); } catch (error) { console.warn("Setting QR PIN failed", error); }
          setSetPinPrompt(null);
        }}
        onCancel={() => setSetPinPrompt(null)}
        t={t}
      />
    );
  }

  if (auth.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-sm rounded-2xl border border-rose-500 bg-rose-950 p-5 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-300" />
          <p className="text-sm text-rose-100">{auth.error || t("consultingField.authFailed")}</p>
        </div>
      </main>
    );
  }
  if (auth.status !== "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <p className="text-sm text-slate-300">{t("consultingField.loading")}</p>
      </main>
    );
  }

  return <ConsultingFieldCapture sessionToken={auth.sessionToken} candidateId={auth.candidateId} candidateName={auth.candidateName} t={t} />;
}

function CentreActivePackagePanel({ setVariants, setAvailableVariants, setTestBank, setOutdoorItemsByLevel, setActiveAdminPackageMeta, setTestImportSummary, setCentreSetupDirty, language, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [activePackagePreview, setActivePackagePreview] = useState(null);
  const [activePackagePreviewStatus, setActivePackagePreviewStatus] = useState("");
  const [activePackagePreviewError, setActivePackagePreviewError] = useState("");

  function applyActivePackageData(data) {
    setActivePackagePreview(data);

    const practicingCode = data?.variants?.Practicing?.code || "PRACTICING_ADMIN_PACKAGE";
    const consultingCode = data?.variants?.Consulting?.code || "CONSULTING_ADMIN_PACKAGE";
    const practicingQuestions = Array.isArray(data?.written?.Practicing?.questions)
      ? data.written.Practicing.questions
      : [];
    const consultingQuestions = Array.isArray(data?.written?.Consulting?.questions)
      ? data.written.Consulting.questions
      : [];
    const variantLanguage = language || "EN";

    setTestBank?.((prev) => ({
      ...prev,
      [practicingCode]: practicingQuestions,
      [consultingCode]: consultingQuestions,
    }));

    setTestImportSummary?.({
      variants: 2,
      questions: practicingQuestions.length + consultingQuestions.length,
      source: "admin-vet-file",
      packageId: data.packageId,
    });

    setAvailableVariants?.((prev) => {
      const existing = Array.isArray(prev) ? prev : [];
      const adminCodes = new Set([practicingCode, consultingCode]);

      return [
        ...existing.filter((variant) => !adminCodes.has(variant.code)),
        {
          code: practicingCode,
          level: "Practicing",
          language: variantLanguage,
          status: "Approved",
          source: "admin-vet-file",
        },
        {
          code: consultingCode,
          level: "Consulting",
          language: variantLanguage,
          status: "Approved",
          source: "admin-vet-file",
        },
      ];
    });

    setVariants?.((prev) => ({
      ...prev,
      Practicing: practicingCode,
      Consulting: consultingCode,
    }));

    setOutdoorItemsByLevel?.(normalizeAdminOutdoorPackage(data));
    setActiveAdminPackageMeta?.(activePackageRuntimeMeta(data));

    setCentreSetupDirty?.(true);

    setActivePackagePreviewStatus(tf("centre.activePackage.loadedStatus", { packageId: data.packageId || t("centre.activePackage.noId") }));
  }

  async function handleAdminVetFileSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setActivePackagePreviewError("");
    setActivePackagePreviewStatus(tf("centre.activePackage.loadingFile", { name: file.name }));

    try {
      // Accepts both a legacy plain-JSON .vet and the newer ZIP .vet archive.
      const data = await readVetPackage(file);
      if (!data || typeof data !== "object" || (!data.written && !data.outdoor && !data.variants)) {
        throw new Error(t("centre.activePackage.invalidFile"));
      }
      applyActivePackageData(data);
    } catch (error) {
      setActivePackagePreviewError(vetReadErrorMessage(error, t));
      setActivePackagePreviewStatus("");
    }
  }

  return (
    <div data-vb-active-admin-package-panel="true" className="mb-4 flex flex-wrap items-center gap-3">
      <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
        {t("centre.activePackage.loadButton")}
        <input type="file" accept=".vet,application/json" className="hidden" onChange={handleAdminVetFileSelect} />
      </label>
      {activePackagePreviewStatus && <span className="text-sm text-emerald-900">{activePackagePreviewStatus}</span>}
      {activePackagePreviewError && <span className="text-sm text-amber-950">{activePackagePreviewError}</span>}
    </div>
  );
}

function CandidateEditorCard({ candidate, selectedCandidateId, setSelectedCandidateId, removeCandidate, updateCandidate, candidatesCount, t }) {
  return (
    <div className={`rounded-2xl border bg-white p-3 text-sm ${selectedCandidateId === candidate.id ? "border-slate-950 bg-slate-50" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">{candidate.id}</div>
        <Button onClick={() => removeCandidate(candidate.id)} disabled={candidatesCount <= 2} variant="outline" className="rounded-2xl px-3 py-1 text-xs">{t("centre.candidates.remove")}</Button>
      </div>
      <label className="text-xs font-medium text-slate-500">
        {t("centre.candidateDetails.id")}
        <input value={candidate.id ?? ""} readOnly onFocus={() => setSelectedCandidateId(candidate.id)} className="mt-1 w-full rounded-xl border bg-slate-100 p-2 text-sm text-slate-600" />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-500">
        {t("centre.candidateDetails.name")}
        <input value={candidate.name ?? ""} onFocus={() => setSelectedCandidateId(candidate.id)} onChange={(event) => updateCandidate(candidate.id, { name: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-500">
        {t("centre.candidateDetails.level")}
        <select value={candidate.level ?? "Practicing"} onFocus={() => setSelectedCandidateId(candidate.id)} onChange={(event) => updateCandidate(candidate.id, { level: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950">
          <option value="Practicing">Practicing</option>
          <option value="Consulting">Consulting</option>
        </select>
      </label>
    </div>
  );
}

function ExaminerEditorCard({ examiner, removeExaminer, updateExaminer, examinersCount, t }) {
  return (
    <div className="rounded-2xl border bg-white p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">{examiner.id}</div>
        <Button onClick={() => removeExaminer(examiner.id)} disabled={examinersCount <= 2} variant="outline" className="rounded-2xl px-3 py-1 text-xs">{t("centre.examiners.remove")}</Button>
      </div>
      <label className="text-xs font-medium text-slate-500">
        {t("centre.examinerDetails.id")}
        <input value={examiner.id ?? ""} onChange={(event) => updateExaminer(examiner.id, { id: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-500">
        {t("centre.examinerDetails.name")}
        <input value={examiner.name ?? ""} onChange={(event) => updateExaminer(examiner.id, { name: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-500">
        {t("centre.examinerDetails.email")}
        <input value={examiner.email ?? ""} onChange={(event) => updateExaminer(examiner.id, { email: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" />
      </label>
    </div>
  );
}

// Auto brightness/contrast: per-channel histogram stretch (clips the darkest/lightest 0.5% of
// pixels then linearly stretches the rest across the full 0-255 range) — a simple, fast "auto
// levels" pass that makes a phone-photo of a printed page look closer to a flatbed scan.
function autoEnhanceCanvas(canvas, clipPercent = 0.005) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const totalPixels = canvas.width * canvas.height;
  for (let channel = 0; channel < 3; channel++) {
    const histogram = new Array(256).fill(0);
    for (let i = channel; i < img.data.length; i += 4) histogram[img.data[i]]++;
    const clipCount = Math.floor(totalPixels * clipPercent);
    let lo = 0, hi = 255, seen = 0;
    for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen > clipCount) { lo = v; break; } }
    seen = 0;
    for (let v = 255; v >= 0; v--) { seen += histogram[v]; if (seen > clipCount) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = channel; i < img.data.length; i += 4) {
      img.data[i] = Math.max(0, Math.min(255, ((img.data[i] - lo) / range) * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
function imageElementToCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}
function cloneCanvas(canvas) {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  return copy;
}
// A modern phone camera photo can be 4000-9000px on the long edge, and the corner QR is only a
// few dozen pixels across in it - jsQR needs downscaling to find it reliably most of the time.
// But tested against real scans that a single fixed size+enhance config failed on (see
// decodeAllQrCodesEnsemble below), no one size is reliable enough on its own: the same photo
// that a downscaled pass missed sometimes decodes fine at native resolution, and vice versa -
// motion blur, print DPI and JPEG compression each interact differently with jsQR depending on
// the pixel scale and contrast it's given. The QR-relative checkbox math (mapOffsetToPhoto)
// rebuilds its ruler from the QR's own detected corner distance each time, so it is
// scale-invariant - whichever size ends up decoding the QR, reading checkboxes off that same
// canvas afterwards works the same way.
function resizeCanvasToMaxDimension(canvas, maxDimension) {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDimension) return canvas;
  const scale = maxDimension / longest;
  const resized = document.createElement("canvas");
  resized.width = Math.round(canvas.width * scale);
  resized.height = Math.round(canvas.height * scale);
  resized.getContext("2d").drawImage(canvas, 0, 0, resized.width, resized.height);
  return resized;
}
// Ordered cheapest/most-common-case first. Measured against 15 real scan photos that the old
// single fixed config (2200px + enhance, kept here as the first entry) failed on almost
// entirely (3/15): trying these four in sequence and stopping at the first that decodes
// anything recovered 9/15 - the same coverage as testing seven different size/enhance
// combinations, so the extra three bought nothing once these four were included. The last
// entry (true native resolution, enhanced) is the most expensive and is only reached when
// everything cheaper already failed.
const QR_ENSEMBLE_CONFIGS = [
  { maxDimension: 2200, enhance: true },
  { maxDimension: 1600, enhance: false },
  { maxDimension: null, enhance: false },
  { maxDimension: null, enhance: true },
];
// Tries each config against baseCanvas (never mutated) until one decodes at least one QR code,
// returning the canvas that config actually used - its pixel dimensions are what the caller's
// checkbox math and stored photo need to agree with, so the winning canvas (not baseCanvas) is
// the one to keep using downstream. `enhanced` tells the caller whether that canvas already got
// the histogram stretch, so it doesn't get applied twice.
function decodeAllQrCodesEnsemble(baseCanvas, maxCodes = 12) {
  for (const config of QR_ENSEMBLE_CONFIGS) {
    const resized = config.maxDimension ? resizeCanvasToMaxDimension(baseCanvas, config.maxDimension) : baseCanvas;
    const canvas = config.enhance ? cloneCanvas(resized) : resized;
    if (config.enhance) autoEnhanceCanvas(canvas);
    const results = decodeAllQrCodes(canvas, maxCodes);
    if (results.length) return { canvas, results, enhanced: config.enhance };
  }
  return { canvas: baseCanvas, results: [], enhanced: false };
}

// A rough "where in the recording was this question answered" position: the wall-clock moment
// this item's score/note was last saved, minus the wall-clock moment the recording started. Not
// per-word accurate (score entry can lag the actual answer by however long the examiner takes to
// mark it, and a paused/resumed recording keeps advancing this wall-clock offset even though the
// audio itself didn't), but it costs nothing beyond data already being recorded, unlike running a
// forced-alignment tool (Aeneas/Gentle) or a full re-transcription (Whisper) against the source
// audio - and it only ever nudges playback to roughly the right neighbourhood, never claims exact
// boundaries the way a fabricated timestamp would.
function outdoorAudioOffsetSeconds(recordingStartedAt, itemTimestamp) {
  if (!recordingStartedAt || !itemTimestamp) return null;
  const startMs = new Date(recordingStartedAt).getTime();
  const itemMs = new Date(itemTimestamp).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(itemMs)) return null;
  const offsetSeconds = Math.round((itemMs - startMs) / 1000);
  return offsetSeconds >= 0 ? offsetSeconds : null;
}

// Collapsed by default, next to a question that has a manually-curated draft note (see
// outdoorAiDraftNotes.js). This is reference material for the Centre to weigh alongside the
// examiner's own score - a transcript excerpt and a suggested point value/reasoning drafted from
// the candidate's recording, never written into outdoor_scores itself. Always shown collapsed and
// always labeled as a draft to verify against the linked recording, so it can't be mistaken for an
// automatic or authoritative score.
function OutdoorAiNotePanel({ note, audioUrl, recordingStartedAt, itemTimestamp, t }) {
  const [open, setOpen] = useState(false);
  if (!note) return null;
  const offsetSeconds = outdoorAudioOffsetSeconds(recordingStartedAt, itemTimestamp);
  // The Media Fragments URI spec (#t=seconds) seeks a plain HTML5 <audio> element to that start
  // position on load, no JS wiring needed - but only recordings captured after recordingStartedAt
  // started being stored carry this at all, so older recordings just play from the start as before.
  const seekableUrl = audioUrl && offsetSeconds !== null ? `${audioUrl}#t=${offsetSeconds}` : audioUrl;
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] font-semibold text-amber-900"
      >
        <span>{t("outdoor.review.aiNote.toggle")}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-200 px-2 py-2 text-[11px] text-amber-950">
          <div className="font-semibold text-amber-800">{t("outdoor.review.aiNote.disclaimer")}</div>
          {note.transcript && <p className="italic">&ldquo;{note.transcript}&rdquo;</p>}
          <div className="font-semibold">
            {t("outdoor.review.aiNote.suggested")}: {formatHalfPointScore(note.pointsAwarded)} / {note.pointsMax}
          </div>
          {note.positive && <p><span className="font-semibold">+</span> {note.positive}</p>}
          {note.deduction && <p><span className="font-semibold">&minus;</span> {note.deduction}</p>}
          {audioUrl ? (
            <div>
              {offsetSeconds !== null && (
                <div className="text-amber-700">{t("outdoor.review.aiNote.approxPosition")}: ~{formatRecordingClock(offsetSeconds * 1000)}</div>
              )}
              <audio controls preload="none" src={seekableUrl} className="mt-1 w-full" />
            </div>
          ) : (
            <p className="text-amber-700">{t("outdoor.review.aiNote.noRecording")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Final-review modal: shows every question with the candidate's answer highlighted next to the
// correct answer / scoring help, any scanned handwriting crops assigned to that question, and
// (once an Examiner has identified themselves) a "mark as corrected" action.
// One examiner's column of the Outdoor review. The primary examiner's own column is editable when
// they have identified themselves; sketches are always read-only (they are drawn in the field).
function OutdoorExaminerColumn({ column, items, editable, onChange, candidateId, audioUrl, recordingStartedAt, t }) {
  const [openSketch, setOpenSketch] = useState(null);
  const { scores, notes, noteDrawings, itemTimestamps } = column.data;
  const scoreOf = (item) => (item.excluded ? 0 : Number(scores?.[item.id] ?? 0));
  const total = items.reduce((sum, item) => sum + scoreOf(item), 0);
  const max = items.reduce((sum, item) => sum + (item.excluded ? 0 : Number(item.max || 0)), 0);
  // Group by exercise so the reviewer reads the same running order the examiner worked in,
  // instead of one flat list of question ids.
  const groups = [];
  for (const item of items) {
    const section = item.section ?? "";
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.items.push(item);
    else groups.push({ section, excluded: Boolean(item.excluded), items: [item] });
  }
  return (
    <div className={`min-w-0 rounded-2xl border p-3 ${column.role === "primary" ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t(`centre.review.outdoor.${column.role}`)}</div>
          <div className="break-words font-semibold">{column.examinerName}</div>
        </div>
        <div className="shrink-0 text-sm font-bold">{formatHalfPointScore(total)} / {max} b.</div>
      </div>
      {column.data.examSummary && (
        <div className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-100 p-2 text-xs italic text-slate-700">{column.data.examSummary}</div>
      )}
      <div className="mt-3 space-y-4">
        {groups.map((group) => {
          const groupTotal = group.items.reduce((sum, item) => sum + scoreOf(item), 0);
          const groupMax = group.items.reduce((sum, item) => sum + Number(item.max || 0), 0);
          return (
            <div key={group.section} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-1">
                <div className="min-w-0 break-words text-xs font-bold uppercase tracking-wide text-slate-600">{outdoorSectionTitle(group.section)}</div>
                {group.excluded
                  ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{t("outdoor.variant.excluded")}</span>
                  : <span className="shrink-0 text-xs font-semibold text-slate-500">{formatHalfPointScore(groupTotal)} / {groupMax} b.</span>}
              </div>
              <div className="mt-2 space-y-2">
                {group.items.map((item) => {
                  const sketch = noteDrawings?.[item.id];
                  const note = notes?.[item.id] ?? "";
                  const aiNote = OUTDOOR_AI_DRAFT_NOTES[candidateId]?.[item.id];
                  const score = scores?.[item.id] ?? "";
                  const hasScore = score !== "" && score !== null && score !== undefined;
                  return (
                    <div key={item.id} className={`min-w-0 rounded-xl border bg-white p-2 ${group.excluded ? "opacity-60" : ""}`}>
                      {/* min-w-0 on the text side: without it the item text sets the column's
                          min-content width and the whole review grid overflows to the right,
                          pushing the score boxes off screen. */}
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] text-slate-500">{item.id}</div>
                          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{item.text}</div>
                        </div>
                        <div className="w-24 shrink-0 text-center">
                          {editable && !group.excluded ? (
                            <select
                              value={score}
                              onChange={(event) => onChange(item.id, { score: event.target.value })}
                              className={`w-full rounded-xl border-2 p-1.5 text-sm font-bold ${hasScore ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white"}`}
                            >
                              <option value="">-</option>
                              {outdoorHalfPointOptions(item.max).map((option) => <option key={option} value={option}>{formatHalfPointScore(option)}</option>)}
                            </select>
                          ) : (
                            <div className={`w-full rounded-xl border-2 p-1.5 text-sm font-bold ${hasScore ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                              {hasScore ? formatHalfPointScore(Number(score)) : "-"}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] text-slate-500">{t("outdoor.pointsLabel")} / {item.max}</div>
                        </div>
                      </div>
                      {editable && !group.excluded ? (
                        <textarea
                          value={note}
                          onChange={(event) => onChange(item.id, { note: event.target.value })}
                          rows={2}
                          placeholder={t("outdoor.examinerNotes")}
                          className="mt-2 w-full rounded-lg border p-2 text-xs"
                        />
                      ) : (
                        note && <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{note}</div>
                      )}
                      {sketch && (
                        <div className="mt-2">
                          <button type="button" onClick={() => setOpenSketch(sketch)} className="block w-full">
                            <img src={sketch} alt="" className="max-h-56 w-full rounded-lg border bg-white object-contain hover:opacity-90" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenSketch(sketch)}
                            className="mt-1 inline-flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <ExpandIcon className="h-3 w-3" /> {t("outdoor.review.openSketch")}
                          </button>
                        </div>
                      )}
                      <OutdoorAiNotePanel note={aiNote} audioUrl={audioUrl} recordingStartedAt={recordingStartedAt} itemTimestamp={itemTimestamps?.[item.id]} t={t} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!items.length && <p className="text-sm text-slate-500">{t("centre.review.noOutdoorScores")}</p>}
      </div>
      {openSketch && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setOpenSketch(null)}>
          <img src={openSketch} alt="" className="max-h-full max-w-full rounded-lg" onClick={(event) => event.stopPropagation()} />
          <button type="button" onClick={() => setOpenSketch(null)} className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-slate-950">
            {t("common.close")}
          </button>
        </div>
      )}
    </div>
  );
}

function CentreReviewModal({ candidate, section, snapshot, scanAssignments, scanFlags, identifiedExaminer, onRequireIdentify, onMarkCorrected, onOutdoorCorrection, onWrittenCorrection, onReportCorrection, isCorrected, onClose, sessionToken, t }) {
  // Fetched once per candidate (not per examiner column - both columns share the same recording)
  // so OutdoorAiNotePanel's draft note can link straight to the candidate's own outdoor recording
  // instead of sending the reviewer hunting for it in Records & photos. recordingStartedAt (when
  // present - only recordings captured after that field existed carry it) lets the panel seek
  // close to the right moment instead of always starting from 0:00.
  const [outdoorAudioUrl, setOutdoorAudioUrl] = useState(null);
  const [outdoorRecordingStartedAt, setOutdoorRecordingStartedAt] = useState(null);
  const [activeReportTree, setActiveReportTree] = useState(REPORT_TREES[0]);
  useEffect(() => {
    setOutdoorAudioUrl(null);
    setOutdoorRecordingStartedAt(null);
    if (section.kind !== "outdoor" || !sessionToken) return undefined;
    let cancelled = false;
    listExamMedia(sessionToken)
      .then((result) => {
        if (cancelled) return;
        const media = Array.isArray(result?.media) ? result.media : [];
        const match = media.find((item) => item.mediaType === "audio" && item.sectionKey === "outdoor" && item.candidateId === candidate.id);
        if (match?.downloadUrl) setOutdoorAudioUrl(match.downloadUrl);
        if (match?.recordingStartedAt) setOutdoorRecordingStartedAt(match.recordingStartedAt);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [section.kind, sessionToken, candidate.id]);

  // reportDraft's own photo entries (from report_photo.added sync events) only ever carry
  // metadata (id/caption/capturedAt) - never the actual image - so the photo grid below needs a
  // separate lookup into the media store for a downloadUrl. Matched by clientMediaId, which every
  // upload path builds as `photo-${candidateId}-${tree}-${photoId}` (see handlePhotoFile in
  // ConsultingFieldCapture), so it can be reconstructed from what the draft already has.
  const [reportPhotoUrls, setReportPhotoUrls] = useState({});
  useEffect(() => {
    setReportPhotoUrls({});
    if (section.kind !== "report" || !sessionToken) return undefined;
    let cancelled = false;
    listExamMedia(sessionToken)
      .then((result) => {
        if (cancelled) return;
        const media = Array.isArray(result?.media) ? result.media : [];
        const byClientMediaId = {};
        media
          .filter((item) => item.mediaType === "photo" && item.sectionKey === "report" && item.candidateId === candidate.id && item.downloadUrl)
          .forEach((item) => { byClientMediaId[item.clientMediaId] = item.downloadUrl; });
        setReportPhotoUrls(byClientMediaId);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [section.kind, sessionToken, candidate.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 p-4">
      {/* Outdoor shows two examiner columns side by side and Report shows a 3-column layout per
          section, so both get the wider, near-fullscreen frame. */}
      <div className={`mx-auto flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white ${section.kind === "outdoor" || section.kind === "report" ? "max-w-[95vw]" : "max-w-4xl"}`}>
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-bold">{candidate.name} · {section.label}</h2>
            <p className="text-sm text-slate-600">{candidate.id} · {candidate.level}</p>
          </div>
          <Button onClick={onClose} variant="outline" className="shrink-0 rounded-2xl">{t("common.close")}</Button>
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {section.kind === "written" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-slate-50 p-3 text-sm">
                <span className="font-semibold">{t("centre.review.total")}: {formatHalfPointScore(snapshot.total)} / {snapshot.max} b.</span>
                {identifiedExaminer
                  ? <StatusPill tone="good">{t("centre.review.editing")}</StatusPill>
                  : <span className="text-xs text-slate-500">{t("centre.review.readOnlyIdentify")}</span>}
              </div>
              {snapshot.items.map((item) => {
                const crop = scanAssignments?.[item.question.id];
                const flagged = scanFlags?.[item.question.id];
                return (
                  <div key={item.question.id} className={`rounded-2xl border p-3 ${flagged ? "border-rose-300" : item.corrected ? "border-emerald-300" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-slate-500">{item.question.id}</div>
                        <div className="mt-1 whitespace-pre-wrap font-medium">{item.question.text}</div>
                      </div>
                      <div className="shrink-0 text-center">
                        {identifiedExaminer ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={item.question.points ?? undefined}
                            value={item.pointsAwarded ?? ""}
                            onChange={(event) => onWrittenCorrection?.(candidate, identifiedExaminer.id, item.question.id, event.target.value)}
                            className={`w-20 rounded-lg border-2 p-1.5 text-right text-sm font-bold ${item.corrected ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}
                          />
                        ) : (
                          <span className="text-sm font-semibold">{item.pointsAwarded} / {item.question.points ?? "-"} b.</span>
                        )}
                        {identifiedExaminer && <div className="mt-1 text-[11px] text-slate-500">/ {item.question.points ?? "-"} b.</div>}
                      </div>
                    </div>
                    {flagged && (
                      <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-950">
                        {t("centre.scan.ambiguousMark")}
                      </div>
                    )}
                    <div className={`mt-2 rounded-xl p-2 text-sm ${item.hasCorrectAnswer ? (item.correct ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950") : "bg-slate-50"}`}>
                      <span className="font-semibold">{t("centre.review.candidateAnswer")}: </span>{item.answer || <em>{t("centre.review.noAnswer")}</em>}
                    </div>
                    {item.hasCorrectAnswer && <div className="mt-1 text-xs text-slate-500">{t("centre.review.correctAnswer")}: {item.question.correctAnswer}</div>}
                    {item.question.scoringHelp && <div className="mt-1 text-xs text-slate-500">{t("centre.review.scoringHelp")}: {item.question.scoringHelp}</div>}
                    {crop && (
                      <div className="mt-2">
                        <div className="mb-1 text-xs font-semibold text-slate-500">{t("centre.scan.originalLabel")}</div>
                        <img src={crop} alt="scanned original page" className="max-h-64 rounded-lg border" />
                      </div>
                    )}
                  </div>
                );
              })}
              {!snapshot.items.length && <p className="text-sm text-slate-500">{t("centre.review.noQuestions")}</p>}
            </div>
          )}
          {section.kind === "outdoor" && (() => {
            // Only the candidate's own primary examiner may correct, and only their own column.
            const canEditPrimary = Boolean(identifiedExaminer && snapshot.primary.examinerId && identifiedExaminer.id === snapshot.primary.examinerId);
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{t("centre.review.outdoorTotal")}: {formatHalfPointScore(snapshot.total)} / {snapshot.max} b.</span>
                  {canEditPrimary
                    ? <StatusPill tone="good">{t("centre.review.outdoor.editing")}</StatusPill>
                    : <span className="text-xs text-slate-500">{t("centre.review.outdoor.readOnly")}</span>}
                </div>
                {/* Primary on the left in the wider frame, secondary on the right. minmax(0,…)
                    rather than plain fr: an fr track's implicit min-width is auto, so a long
                    question line would stretch the track and overflow the modal. */}
                <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <OutdoorExaminerColumn
                    column={snapshot.primary}
                    items={snapshot.items}
                    editable={canEditPrimary}
                    onChange={(itemId, patch) => onOutdoorCorrection?.(candidate, snapshot.primary.examinerId, itemId, patch)}
                    candidateId={candidate.id}
                    audioUrl={outdoorAudioUrl}
                    recordingStartedAt={outdoorRecordingStartedAt}
                    t={t}
                  />
                  <OutdoorExaminerColumn column={snapshot.secondary} items={snapshot.items} editable={false} onChange={() => {}} candidateId={candidate.id} audioUrl={outdoorAudioUrl} recordingStartedAt={outdoorRecordingStartedAt} t={t} />
                </div>
              </div>
            );
          })()}
          {section.kind === "report" && (() => {
            const marks = snapshot.marks || {};
            const treeDrafts = Object.fromEntries(snapshot.trees);
            const treeMaxTotal = REPORT_MARKING_SECTIONS.reduce((sum, s) => sum + s.perTreeMax, 0);
            const treeTotalFor = (treeName) => {
              const treeMarks = marks[treeName] || {};
              return REPORT_MARKING_SECTIONS.reduce((sum, s) => {
                const mark = treeMarks[s.key];
                return sum + (s.key === "plan" ? reportPlanScore(mark) : (Number(mark?.score) || 0));
              }, 0);
            };
            const activeTree = treeDrafts[activeReportTree] || {};
            const activeTreeMarks = marks[activeReportTree] || {};
            const allPhotos = REPORT_TREES.flatMap((treeName) => (treeDrafts[treeName]?.photos || []).map((photo) => ({ ...photo, treeName, url: photo.url || photo.dataUrl || reportPhotoUrls[`photo-${candidate.id}-${treeName}-${photo.id}`] })));
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{t("centre.review.total")}: {formatHalfPointScore(snapshot.total)} / {snapshot.max} b.</span>
                  {identifiedExaminer
                    ? <StatusPill tone="good">{t("centre.review.editing")}</StatusPill>
                    : <span className="text-xs text-slate-500">{t("centre.review.readOnlyIdentify")}</span>}
                </div>

                {/* Tree A / Tree B switcher: two cards instead of showing both trees stacked, the
                    active one highlighted so it's obvious which tree the sections below belong to. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {REPORT_TREES.map((treeName) => {
                    const active = treeName === activeReportTree;
                    return (
                      <button
                        key={treeName}
                        type="button"
                        onClick={() => setActiveReportTree(treeName)}
                        className={`rounded-2xl border-2 p-3 text-left transition ${active ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                      >
                        <div className="font-semibold">{treeName}</div>
                        <div className={`mt-1 text-lg font-bold ${active ? "text-emerald-800" : "text-slate-700"}`}>{formatHalfPointScore(treeTotalFor(treeName))} / {treeMaxTotal} b.</div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-4">
                  {REPORT_MARKING_SECTIONS.map((section, index) => {
                    const sectionText = String(activeTree.finalSections?.[REPORT_SECTIONS[index]?.key] ?? "").trim() || (index === 0 ? String(activeTree.fieldNotes ?? "").trim() : "");
                    const mark = activeTreeMarks[section.key] || {};

                    // Section 6 (management plan) splits into an itemized sub-rubric instead of one
                    // combined score - the examiner picks whether the candidate proposed cutting/
                    // soil/shade management or "do nothing", then scores that table's line items.
                    if (section.key === "plan") {
                      const mode = mark.mode === "doNothing" ? "doNothing" : "management";
                      const items = reportPlanItemsForMode(mode);
                      const planScore = reportPlanScore(mark);
                      return (
                        <div key={section.key} className="min-h-[70vh] rounded-2xl border bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-bold uppercase tracking-wide text-slate-500">{section.title}</div>
                            <div className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">{formatHalfPointScore(planScore)} / {REPORT_PLAN_CAP} b.</div>
                          </div>
                          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                            <div className="min-w-0 rounded-xl border bg-white p-3">
                              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("centre.review.candidateAnswer")}</div>
                              <div className="whitespace-pre-wrap text-sm text-slate-800">{sectionText || <em>{t("centre.review.noAnswer")}</em>}</div>
                            </div>
                            <div className="min-w-0 rounded-xl border bg-white p-3">
                              {identifiedExaminer && (
                                <div className="mb-3 inline-flex rounded-2xl border bg-slate-50 p-0.5 text-xs font-semibold">
                                  <button type="button" onClick={() => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, "plan", { mode: "management" })} className={`rounded-2xl px-3 py-1.5 ${mode === "management" ? "bg-white shadow-sm" : "text-slate-500"}`}>{t("report.plan.modeManagement")}</button>
                                  <button type="button" onClick={() => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, "plan", { mode: "doNothing" })} className={`rounded-2xl px-3 py-1.5 ${mode === "doNothing" ? "bg-white shadow-sm" : "text-slate-500"}`}>{t("report.plan.modeDoNothing")}</button>
                                </div>
                              )}
                              <div className="space-y-2">
                                {items.map((item) => (
                                  <div key={item.key} className="flex items-start justify-between gap-3 rounded-lg border bg-slate-50 p-2">
                                    <div className="min-w-0 text-xs text-slate-700">{item.title}</div>
                                    <div className="shrink-0 text-center">
                                      {identifiedExaminer ? (
                                        <input
                                          type="number"
                                          step="0.5"
                                          min="0"
                                          max={item.max}
                                          value={mark.items?.[item.key] ?? ""}
                                          onChange={(event) => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, "plan", { items: { ...(mark.items || {}), [item.key]: event.target.value } })}
                                          className="w-16 rounded-lg border-2 border-slate-300 p-1 text-right text-xs font-bold"
                                        />
                                      ) : (
                                        <span className="text-xs font-semibold">{mark.items?.[item.key] ? formatHalfPointScore(Number(mark.items[item.key])) : "-"}</span>
                                      )}
                                      <div className="text-[10px] text-slate-500">/ {item.max}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          {identifiedExaminer ? (
                            <textarea
                              value={mark.comment ?? ""}
                              onChange={(event) => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, "plan", { comment: event.target.value })}
                              rows={3}
                              placeholder={t("examiner.reportReview.commentPlaceholder")}
                              className="mt-3 w-full rounded-lg border p-2 text-sm"
                            />
                          ) : (
                            mark.comment && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-2 text-sm text-slate-700">{mark.comment}</div>
                          )}
                        </div>
                      );
                    }

                    return (
                      // min-h so each section takes up roughly the full modal height - candidate
                      // text, grading guidance and the score/comment all need room at once.
                      <div key={section.key} className="min-h-[70vh] rounded-2xl border bg-slate-50 p-4">
                        <div className="text-sm font-bold uppercase tracking-wide text-slate-500">{section.title}</div>
                        <div className="mt-3 grid flex-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
                          <div className="min-w-0 rounded-xl border bg-white p-3">
                            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("centre.review.candidateAnswer")}</div>
                            <div className="whitespace-pre-wrap text-sm text-slate-800">{sectionText || <em>{t("centre.review.noAnswer")}</em>}</div>
                          </div>
                          <div className="min-w-0 rounded-xl border bg-white p-3">
                            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("centre.review.scoringHelp")}</div>
                            <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-slate-600">
                              {section.guidance.map((line, guidanceIndex) => <li key={guidanceIndex}>{line}</li>)}
                            </ul>
                          </div>
                          <div className="flex flex-col items-center gap-1 rounded-xl border bg-white p-3">
                            {identifiedExaminer ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max={section.perTreeMax}
                                value={mark.score ?? ""}
                                onChange={(event) => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, section.key, { score: event.target.value })}
                                className={`w-20 rounded-lg border-2 p-1.5 text-right text-sm font-bold ${mark.score ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}
                              />
                            ) : (
                              <span className="text-sm font-semibold">{mark.score ? formatHalfPointScore(Number(mark.score)) : "-"}</span>
                            )}
                            <div className="text-[11px] text-slate-500">/ {section.perTreeMax} b.</div>
                          </div>
                        </div>
                        {identifiedExaminer ? (
                          <textarea
                            value={mark.comment ?? ""}
                            onChange={(event) => onReportCorrection?.(candidate, identifiedExaminer.id, activeReportTree, section.key, { comment: event.target.value })}
                            rows={3}
                            placeholder={t("examiner.reportReview.commentPlaceholder")}
                            className="mt-3 w-full rounded-lg border p-2 text-sm"
                          />
                        ) : (
                          mark.comment && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-2 text-sm text-slate-700">{mark.comment}</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {allPhotos.length > 0 && (
                  <div className="rounded-2xl border bg-slate-50 p-3">
                    <div className="font-semibold">{t("centre.review.reportPhotos")}</div>
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {allPhotos.map((photo) => (
                        <figure key={photo.id} className="rounded-xl border bg-white p-2">
                          <img src={photo.url || photo.dataUrl} alt={photo.caption || photo.treeName} className="h-28 w-full rounded-lg object-cover" />
                          <figcaption className="mt-1 text-xs text-slate-600">{photo.caption || photo.treeName}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border bg-slate-50 p-3">
                  <div className="font-semibold">{t("examiner.reportReview.clarityTitle")}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {REPORT_CLARITY_ITEMS.map((item) => (
                      <label key={item.key} className="rounded-xl border bg-white p-2 text-xs font-medium">
                        {item.title}
                        {identifiedExaminer ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={item.max}
                            value={marks.clarity?.[item.key] ?? ""}
                            onChange={(event) => onReportCorrection?.(candidate, identifiedExaminer.id, null, item.key, event.target.value, "clarity")}
                            className="mt-1 block w-full rounded-lg border p-1 text-right text-sm font-bold"
                          />
                        ) : (
                          <div className="mt-1 text-right text-sm font-bold">{marks.clarity?.[item.key] ? formatHalfPointScore(Number(marks.clarity[item.key])) : "-"}</div>
                        )}
                        <span className="mt-1 block text-right text-[11px] font-normal text-slate-500">/ {item.max}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="border-t p-4">
          {isCorrected ? (
            <StatusPill tone="good">{t("centre.review.corrected")}{identifiedExaminer ? ` · ${identifiedExaminer.name}` : ""}</StatusPill>
          ) : identifiedExaminer ? (
            <Button onClick={onMarkCorrected} className="rounded-2xl">{t("centre.review.markCorrected")}</Button>
          ) : (
            <Button onClick={onRequireIdentify} variant="outline" className="rounded-2xl">{t("centre.review.identifyToScore")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// The corner QR is rendered with includeMargin:true (see scanSortQr in printCandidateTest),
// which bakes a fixed 4-module quiet zone into the SVG's own viewBox — e.g. a 21x21-module QR
// becomes a 29x29 viewBox. jsQR's detected corners bound only the actual module grid (the quiet
// zone isn't part of the symbol by definition), so that inner grid — not the full 15mm rendered
// box — is the ruler a photographed QR actually gives us. QR_MARGIN_MODULES mirrors
// qrcode.react's own SPEC_MARGIN_SIZE constant.
const QR_MARGIN_MODULES = 4;
// Real scanned test photos showed jsQR's success rate on the small per-question corner QR
// dropping sharply at the previous 13mm print size — the 21-module V1 code plus its 4-module
// quiet zone on each side works out to roughly a 0.45mm module, well under the ~1mm most phone
// cameras need to resolve reliably at typical scanning distance/lighting (see the QR ensemble
// retry in decodeAllQrCodesEnsemble, added for the same real-world failures). This drives both
// the print CSS (below and in printCandidateTest) and the offscreen checkbox-layout measurement
// (measureCandidateCheckboxLayout) — both must move together or the two stop agreeing on where a
// question's checkboxes sit relative to its QR.
const SCAN_QR_PRINT_MM = 15;
function qrModuleGridMm(svgMarkup, renderedMm) {
  const match = svgMarkup.match(/viewBox="0 0 (\d+) (\d+)"/);
  const totalUnits = match ? Number(match[1]) : null;
  if (!totalUnits) return renderedMm;
  return (renderedMm * (totalUnits - QR_MARGIN_MODULES * 2)) / totalUnits;
}

// Measures, once per candidate's question set, where each single_choice question's checkboxes
// sit relative to that same question's own corner QR's actual module grid (see qrModuleGridMm
// above) — in millimeters, so the result is scale-invariant and can be re-applied to a QR
// detected at any photo resolution/distance (see mapOffsetToPhoto in lib/scanMarkDetection.js).
// This mirrors printCandidateTest's `.pt-question`/`scanSortQr` markup/CSS closely enough to be
// geometrically accurate; if that print layout's spacing ever changes, this offscreen copy needs
// to change with it.
function measureCandidateCheckboxLayout(questions, testCode, candidateNumber) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "182mm";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.fontSize = "10.5pt";
  container.style.boxSizing = "border-box";
  const style = document.createElement("style");
  style.textContent = `
    #vetbara-scan-measure *{box-sizing:border-box}
    #vetbara-scan-measure .pt-question{margin-bottom:5mm;padding-bottom:3mm}
    #vetbara-scan-measure .pt-question-head{font-size:8pt}
    #vetbara-scan-measure .pt-question-head::after{content:"";display:block;clear:both}
    #vetbara-scan-measure .pt-corner-qr{background:#fff;padding:1mm}
    #vetbara-scan-measure .pt-corner-qr svg{width:${SCAN_QR_PRINT_MM}mm;height:${SCAN_QR_PRINT_MM}mm;display:block}
    #vetbara-scan-measure .pt-corner-qr-options{float:right;display:block;margin:0 0 1.5mm 3mm}
    #vetbara-scan-measure .pt-options::after{content:"";display:block;clear:both}
    #vetbara-scan-measure .pt-qtext{font-weight:700;margin:2.5mm 0;font-size:11.5pt;clear:both}
    #vetbara-scan-measure .pt-options{margin-top:1mm}
    #vetbara-scan-measure .pt-option{margin:1.8mm 0;font-size:10.5pt}
    #vetbara-scan-measure .pt-checkbox{display:inline-block;width:4.5mm;height:4.5mm;border:1.5pt solid #102018;border-radius:1mm;margin-right:3mm;vertical-align:middle}
    #vetbara-scan-measure .pt-score{margin-top:3mm;text-align:right}
    #vetbara-scan-measure .pt-score-box{display:inline-block;width:16mm;height:8mm;border:1.5pt solid #102018;border-radius:1mm;vertical-align:middle}
  `;
  container.id = "vetbara-scan-measure";
  container.appendChild(style);

  const sections = [];
  questions.forEach((question, index) => {
    const isChoice = question.type === "single_choice" && Array.isArray(question.options) && question.options.length;
    const qrValue = `VS-${testCode}-${candidateNumber}-Q${index + 1}`;
    const qrSvg = renderQrSvgMarkup(qrValue, 68, { includeMargin: true });
    const section = document.createElement("section");
    section.className = "pt-question";
    // Mirrors printCandidateTest: the QR sits inside .pt-options (floated to the right of the
    // checkbox column, not up in the question header) — see the comment on questionsHtml there.
    // Both copies must keep the same float/margins or the measured offsets stop matching print.
    // Mirrors printCandidateTest for both shapes: multiple-choice keeps the QR inside .pt-options,
    // everything else carries it in the header — and both end with the examiner's score box, whose
    // offset from the QR is what lets the mark in it be cropped out of a photo later.
    section.innerHTML = isChoice
      ? `
      <div class="pt-qtext">${escapeHtml(question.text || "")}</div>
      <div class="pt-options"><span class="pt-corner-qr pt-corner-qr-options">${qrSvg}</span>${question.options.map(() => `<div class="pt-option"><span class="pt-checkbox"></span></div>`).join("")}</div>
      <div class="pt-score"><span class="pt-score-box"></span></div>
    `
      : `
      <div class="pt-question-head"><span class="pt-corner-qr">${qrSvg}</span></div>
      <div class="pt-qtext">${escapeHtml(question.text || "")}</div>
      <div class="pt-score"><span class="pt-score-box"></span></div>
    `;
    container.appendChild(section);
    sections.push({ question, section, qrSvg });
  });

  document.body.appendChild(container);
  const layout = {};
  sections.forEach(({ question, section, qrSvg }) => {
    // The module grid jsQR actually bounds sits inset from the rendered SCAN_QR_PRINT_MM SVG box
    // by the quiet-zone margin on every side.
    const svgRect = section.querySelector(".pt-corner-qr svg").getBoundingClientRect();
    const pxPerMm = svgRect.width / SCAN_QR_PRINT_MM;
    const moduleGridMm = qrModuleGridMm(qrSvg, SCAN_QR_PRINT_MM);
    const marginMm = (SCAN_QR_PRINT_MM - moduleGridMm) / 2;
    const moduleGridLeft = svgRect.left + marginMm * pxPerMm;
    const moduleGridTop = svgRect.top + marginMm * pxPerMm;
    const options = [...section.querySelectorAll(".pt-checkbox")].map((boxEl, index) => {
      const boxRect = boxEl.getBoundingClientRect();
      return {
        index,
        dxMm: (boxRect.left + boxRect.width / 2 - moduleGridLeft) / pxPerMm,
        dyMm: (boxRect.top + boxRect.height / 2 - moduleGridTop) / pxPerMm,
      };
    });
    const scoreEl = section.querySelector(".pt-score-box");
    const scoreRect = scoreEl ? scoreEl.getBoundingClientRect() : null;
    const scoreBox = scoreRect ? {
      dxMm: (scoreRect.left + scoreRect.width / 2 - moduleGridLeft) / pxPerMm,
      dyMm: (scoreRect.top + scoreRect.height / 2 - moduleGridTop) / pxPerMm,
      widthMm: scoreRect.width / pxPerMm,
      heightMm: scoreRect.height / pxPerMm,
    } : null;
    layout[question.id] = { moduleGridMm, options, scoreBox };
  });
  document.body.removeChild(container);
  return layout;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = (error) => { URL.revokeObjectURL(url); reject(error); };
    image.src = url;
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

const CENTRE_REVIEW_STATUS_COLORS = { locked: "bg-slate-200 text-slate-500", open: "bg-amber-400 text-amber-950", closed: "bg-rose-500 text-white", corrected: "bg-emerald-500 text-white" };

// Marking a consolidated paper test: the scanned pages on the left, and on the right every question
// with its classification aid and a score box. Scores are written to the same per-question store the
// examiner's own written review uses, so closing this feeds straight into the candidate's marks.
function ScanGradingModal({ candidate, pages, questions, initialScores, onSave, onClose, t }) {
  const [scores, setScores] = useState(() => ({ ...initialScores }));
  const total = questions.reduce((sum, question) => sum + (Number(scores[question.id]) || 0), 0);
  const max = questions.reduce((sum, question) => sum + Number(question.points || 0), 0);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/80 p-4">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col rounded-2xl bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-lg font-bold">{candidate.name} · {t("centre.scan.gradingTitle")}</h2>
            <p className="text-sm text-slate-600">{candidate.id} · {candidate.level}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold">{total} / {max} b.</span>
            <Button onClick={() => { onSave(scores); onClose(); }} className="rounded-2xl">{t("centre.scan.saveGrading")}</Button>
            <Button onClick={onClose} variant="outline" className="rounded-2xl">{t("common.close")}</Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
          <div className="min-h-0 overflow-auto rounded-2xl border bg-slate-100 p-3">
            {pages.length === 0
              ? <div className="rounded-xl bg-white p-3 text-sm text-slate-600">{t("centre.scan.emptyState")}</div>
              : pages.map((page, index) => (
                  <img key={page.id} src={page.dataUrl} alt={`scan page ${index + 1}`} className="mb-3 w-full rounded-xl border bg-white" />
                ))}
          </div>

          <div className="min-h-0 space-y-3 overflow-auto pr-1">
            {questions.map((question, index) => (
              <div key={question.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-slate-500">{index + 1}. {question.id}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm font-medium">{cleanQuestionText(question.text)}</div>
                  </div>
                  <label className="shrink-0 text-xs font-semibold text-slate-600">
                    {t("centre.scan.score")} / {question.points ?? "-"}
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={question.points ?? undefined}
                      value={scores[question.id] ?? ""}
                      onChange={(event) => setScores((current) => ({ ...current, [question.id]: event.target.value }))}
                      className="mt-1 block w-24 rounded-lg border p-1 text-right text-sm font-bold"
                    />
                  </label>
                </div>
                {question.correctAnswer && (
                  <div className="mt-2 text-xs text-slate-500">{t("centre.review.correctAnswer")}: {question.correctAnswer}</div>
                )}
                {question.scoringHelp && (
                  <div className="mt-2 whitespace-pre-wrap rounded-xl bg-amber-50 p-2 text-xs text-amber-950">
                    <span className="font-semibold">{t("centre.review.scoringHelp")}: </span>{question.scoringHelp}
                  </div>
                )}
              </div>
            ))}
            {!questions.length && <p className="text-sm text-slate-500">{t("centre.review.noQuestions")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CentreReviewCell({ status, sectionKey, onClick, locked = false, lockedTitle = "", t }) {
  const labelKey = sectionKey === "outdoor" && status === "open" ? "centre.review.status.openExaminer" : `centre.review.status.${status}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      title={locked ? lockedTitle : undefined}
      className={`w-full rounded-xl px-2 py-2 text-center text-xs font-bold ${CENTRE_REVIEW_STATUS_COLORS[status] || CENTRE_REVIEW_STATUS_COLORS.locked} ${locked ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {t(labelKey)}
    </button>
  );
}

function CentreReviewSection({ candidates, examiners, variants, testBank, testResponses, setTestResponses, reportDrafts, outdoor, outdoorByExaminer, assignments, outdoorItemsByLevel, candidateStatus, onOutdoorCorrection, onScanGradingSaved, writtenScoresByExaminer, reportMarksByExaminer, onWrittenCorrection, onReportCorrection, activeSessionToken, centreExamId, centreCode, examDate, place, onExamClosed, examClosed, addAudit, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [identifiedExaminerId, setIdentifiedExaminerId] = useState("");
  const [pendingIdentify, setPendingIdentify] = useState(false);
  const [correctionStatus, setCorrectionStatus] = useState({});
  // scans[candidateId] holds every scanned page for that candidate's written test, in capture
  // order — each page carries its own already-computed mark-detection results (see
  // handleScanFile), so "processing" a candidate is just flattening those results into
  // testResponses/scanAssignments rather than doing any image work itself.
  const [scans, setScans] = useState({});
  const [scanAssignments, setScanAssignments] = useState({});
  const [expectedPageCounts, setExpectedPageCounts] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(scopedCacheKey(SCAN_EXPECTED_PAGES_KEY)) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(scopedCacheKey(SCAN_EXPECTED_PAGES_KEY), JSON.stringify(expectedPageCounts));
    } catch { /* private mode - value stays in memory for this session */ }
  }, [expectedPageCounts]);
  const [processedInfo, setProcessedInfo] = useState({});
  // scanScoreGuesses[candidateId][questionId] = estimated mark read out of the printed score box.
  const [scanScoreGuesses, setScanScoreGuesses] = useState({});
  const [unmatchedScans, setUnmatchedScans] = useState([]);
  const [bulkAssignCandidateId, setBulkAssignCandidateId] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState(null);
  const [showConnectQr, setShowConnectQr] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [scanGradingCandidate, setScanGradingCandidate] = useState(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState(null);

  // Everything an examiner marked, shaped for buildExamWorkbook: the written questions in order and
  // the outdoor questions in order (each as a bare score, blank where unmarked), plus the raw
  // Consulting report marks per tree/section. examWorkbooks.js places these into the exact input
  // cells of the official form; its totals/percentages/pass-fail are template formulas over them.
  function candidateWorkbookRows(candidate) {
    const level = candidateLevel(candidate);
    const asScore = (value) => (value === undefined || value === null || value === "" ? "" : Number(value));

    const snapshot = computeWrittenTestReview(candidate, variants, testBank, testResponses);
    const writtenScores = readWrittenQuestionScores(candidate.id);
    const written = snapshot.items.map((item) => asScore(writtenScores[item.question.id] ?? item.pointsAwarded));

    const outdoorScores = outdoor?.[candidate.id] || {};
    const outside = Object.values(outdoorItemsByLevel?.[level] || {}).flatMap((items) =>
      (items || []).map((item) => asScore(outdoorScores[item.id])));

    const report = level === "Consulting" ? readReportMarks(candidate.id) : undefined;

    return {
      candidate: {
        name: candidate.name,
        email: candidate.email || "",
        gender: candidate.gender || "",
        birthDate: candidate.birthDate || "",
        nationality: candidate.nationality || "",
      },
      prerequisites: candidate.prerequisites !== false,
      written,
      outside,
      report,
    };
  }

  async function generateExamWorkbooks() {
    setGenerating(true);
    try {
      const meta = { centre: centreCode || "", examDate: examDate || "", place: place || "" };
      const examinerNames = examiners.slice(0, 2).map((examiner) => {
        const parts = String(examiner.name || "").trim().split(/\s+/);
        return { first: parts.slice(0, -1).join(" ") || parts[0] || "", last: parts.length > 1 ? parts[parts.length - 1] : "" };
      });
      const files = {};
      for (const level of ["Practicing", "Consulting"]) {
        const forLevel = candidates.filter((candidate) => candidateLevel(candidate) === level).map(candidateWorkbookRows);
        files[level] = {
          blob: await buildExamWorkbook({ level, meta, examiners: examinerNames, candidates: forLevel }),
          fileName: `${level === "Consulting" ? "01_CONSULTING" : "01_PRACTICING"}_${(centreCode || "VETcert").replace(/[^A-Za-z0-9._-]+/g, "-")}_${new Date().toISOString().slice(0, 10)}.xlsx`,
          count: forLevel.length,
        };
      }
      setGeneratedFiles(files);
      onExamClosed?.(files);
    } finally {
      setGenerating(false);
      setCloseConfirmOpen(false);
    }
  }

  function downloadGenerated(level) {
    const entry = generatedFiles?.[level];
    if (!entry) return;
    const url = URL.createObjectURL(entry.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = entry.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  const checkboxLayoutCacheRef = useRef({});
  // pollScanInbox reentrancy guard + a "claimed but not yet confirmed deleted" set: without
  // these, a poll cycle slower than the 4s interval (a handful of full-resolution QR decodes can
  // easily take that long) let a second poll fetch the SAME still-present inbox items before the
  // first poll's deletes had landed, turning every one of them into a duplicate scanned page.
  const pollScanInboxBusyRef = useRef(false);
  const claimedScanInboxIdsRef = useRef(new Set());
  // A phone that scans the "Připojit tablet/telefon" QR uploads photos to this exam's server-side
  // scan inbox (see ScanCaptureMobilePage); this browser's own Centre session polls for new
  // uploads and runs them through the exact same detection pipeline as a locally captured photo.
  // Scoped the same way field-prep already is (fieldPrepExamId in CentreView): this used to be
  // the CENTRE_QR_ID constant unconditionally, so every certification's "Připojit tablet" QR
  // pointed at the SAME shared inbox — two Centres open at once (a real multi-site/multi-day
  // scenario this app already supports) would each poll and race on the other's pages, which
  // reads exactly like "pages appear twice" even with the reentrancy fix above.
  const scanInboxExamId = centreExamId || centreCode || CENTRE_QR_ID;
  const mobileScanCaptureUrl = `${window.location.origin}${window.location.pathname}?mode=scan-capture&examId=${encodeURIComponent(scanInboxExamId)}`;

  const identifiedExaminer = examiners.find((examiner) => examiner.id === identifiedExaminerId) || null;

  function scanErrorQuestionIds(candidateId) {
    const ids = new Set();
    (scans[candidateId] || []).forEach((page) => {
      Object.entries(page.questionResults || {}).forEach(([questionId, result]) => { if (result.error) ids.add(questionId); });
    });
    return ids;
  }

  // Reads one photographed page: decodes every corner QR visible on it (there can be several,
  // since questions aren't forced one-per-page), matches the first one back to a candidate,
  // then — for every question whose QR was found on this page — samples that question's own
  // checkboxes using the QR's own detected corners as a local ruler (mapOffsetToPhoto), so the
  // result is accurate however the page was rotated or tilted in the photo. Shared by the local
  // file-capture button and the remote scan-inbox poller (see the "Připojit tablet/telefon" QR),
  // which both just need to hand it an already-loaded image.
  async function processScanImage(image) {
    const baseCanvas = imageElementToCanvas(image);
    const { canvas: qrCanvas, results: decoded, enhanced } = decodeAllQrCodesEnsemble(baseCanvas);
    // Nothing decoded at any size: fall back to the same small enhanced preview the app always
    // stored here, rather than keeping whatever huge native-resolution canvas the ensemble's
    // last attempt left behind - there's no QR location to make use of that resolution for.
    const canvas = decoded.length ? (enhanced ? qrCanvas : autoEnhanceCanvas(cloneCanvas(qrCanvas))) : autoEnhanceCanvas(resizeCanvasToMaxDimension(baseCanvas, 2200));
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    if (!decoded.length) {
      setUnmatchedScans((prev) => [{ id: vetbaraUid("unmatched"), dataUrl, reason: t("centre.scan.errorNoQr"), capturedAt: new Date().toISOString() }, ...prev]);
      setScanMessage({ type: "error", text: t("centre.scan.errorNoQr") });
      return;
    }

    const parsedList = decoded
      .map((result) => ({ parsed: parseScanSortPayload(result.data), location: result.location }))
      .filter((entry) => entry.parsed);

    if (!parsedList.length) {
      setUnmatchedScans((prev) => [{ id: vetbaraUid("unmatched"), dataUrl, reason: t("centre.scan.errorWrongQr"), capturedAt: new Date().toISOString() }, ...prev]);
      setScanMessage({ type: "error", text: t("centre.scan.errorWrongQr") });
      return;
    }

    const { testCode, candidateNumber } = parsedList[0].parsed;
    const candidate = candidates.find((c) => {
      const snapshot = resolveCandidateWrittenSnapshot({ candidate: c, variants, testBank });
      return candidateScanTestCode(c, snapshot.variantCode) === testCode && candidateScanNumber(c) === candidateNumber;
    });

    if (!candidate) {
      setUnmatchedScans((prev) => [{ id: vetbaraUid("unmatched"), dataUrl, reason: tf("centre.scan.errorUnknownCandidate", { code: `${testCode}-${candidateNumber}` }), capturedAt: new Date().toISOString() }, ...prev]);
      setScanMessage({ type: "error", text: t("centre.scan.errorUnknownCandidate") });
      return;
    }

    const { questions, variantCode } = resolveCandidateWrittenSnapshot({ candidate, variants, testBank });
    if (!checkboxLayoutCacheRef.current[candidate.id]) {
      checkboxLayoutCacheRef.current[candidate.id] = measureCandidateCheckboxLayout(questions, testCode, candidateNumber);
    }
    const layout = checkboxLayoutCacheRef.current[candidate.id];

    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const questionResults = {};
    parsedList.forEach(({ parsed, location }) => {
      const question = questions[parsed.anchorQuestion - 1];
      const entry = question ? layout[question.id] : null;
      if (!question || !entry) return;
      const pxPerMm = Math.hypot(location.topRightCorner.x - location.topLeftCorner.x, location.topRightCorner.y - location.topLeftCorner.y) / entry.moduleGridMm;

      // The examiner's handwritten mark in the score box, read as a pre-fill for the marking window.
      let scoreGuess = null;
      if (entry.scoreBox) {
        const scorePoint = mapOffsetToPhoto(location, entry.scoreBox.dxMm, entry.scoreBox.dyMm, entry.moduleGridMm);
        const crop = cropScoreBox(imageData, scorePoint.x, scorePoint.y, (entry.scoreBox.widthMm / 2) * pxPerMm, (entry.scoreBox.heightMm / 2) * pxPerMm);
        scoreGuess = recognizeScore(crop, question.points);
      }

      if (!entry.options.length) {
        questionResults[question.id] = { scoreGuess };
        return;
      }
      const boxHalfPx = Math.max(4, 4.5 * pxPerMm * 0.4);
      const optionResults = entry.options.map((option) => {
        const point = mapOffsetToPhoto(location, option.dxMm, option.dyMm, entry.moduleGridMm);
        return { index: option.index, ...classifyMark(imageData, point.x, point.y, boxHalfPx) };
      });
      questionResults[question.id] = { ...resolveQuestionMark(optionResults), optionResults, scoreGuess };
    });

    setScans((prev) => ({
      ...prev,
      [candidate.id]: [
        ...(prev[candidate.id] || []),
        { id: vetbaraUid("scan"), dataUrl, capturedAt: new Date().toISOString(), testCode, variantCode, anchorQuestions: parsedList.map((p) => p.parsed.anchorQuestion), questionResults },
      ],
    }));
    setScanMessage({ type: "success", text: tf("centre.scan.pageAdded", { name: candidate.name || candidate.id }) });
  }

  async function handleScanFile(file) {
    setScanBusy(true);
    setScanMessage(null);
    try {
      const image = await loadImageFromFile(file);
      await processScanImage(image);
    } catch (error) {
      console.error("Scan capture failed", error);
      setScanMessage({ type: "error", text: t("centre.scan.errorGeneric") });
    } finally {
      setScanBusy(false);
    }
  }

  // Polls the server-side scan inbox (see the "Připojit tablet/telefon" QR / ScanCaptureMobilePage)
  // for pages a connected phone/tablet has uploaded, runs each one through the same detection
  // pipeline as a locally captured photo, then deletes it from the inbox so it isn't reprocessed.
  async function pollScanInbox() {
    if (pollScanInboxBusyRef.current) return;
    pollScanInboxBusyRef.current = true;
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(scanInboxExamId)}/scan-inbox`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        const deleteUrl = `/api/exams/${encodeURIComponent(scanInboxExamId)}/scan-inbox/${encodeURIComponent(item.id)}`;
        if (claimedScanInboxIdsRef.current.has(item.id)) {
          // Already turned into a scan page on an earlier poll; only its delete didn't land yet
          // (slow connection or a dropped request) - retry the delete, never the processing.
          try { await fetch(deleteUrl, { method: "DELETE" }); claimedScanInboxIdsRef.current.delete(item.id); } catch { /* retry next poll */ }
          continue;
        }
        claimedScanInboxIdsRef.current.add(item.id);
        try {
          const image = await loadImageFromDataUrl(item.dataUrl);
          await processScanImage(image);
        } catch (error) {
          console.error("Remote scan processing failed", error);
        }
        try {
          await fetch(deleteUrl, { method: "DELETE" });
          claimedScanInboxIdsRef.current.delete(item.id);
        } catch {
          // Stays claimed so the next poll retries only the delete, not the (already-added) page.
        }
      }
    } catch {
      // Best-effort background poll; the next tick will retry.
    } finally {
      pollScanInboxBusyRef.current = false;
    }
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => { pollScanInbox(); }, 4000);
    return () => window.clearInterval(intervalId);
  }, [candidates, variants, testBank]);

  function removeScanPage(candidateId, pageId) {
    setScans((prev) => ({ ...prev, [candidateId]: (prev[candidateId] || []).filter((page) => page.id !== pageId) }));
  }

  // Scanning happens in strict page order, so a page whose small per-question QR did not decode
  // (bad focus, an angle, print quality) is still known to belong wherever the operator says it
  // does — there is no auto-detected answer for it, but the photo itself joins that candidate's
  // stack (counts toward the expected page total, and stays visible for reference during manual
  // marking) instead of being stuck unmatched forever. Inserted by capture time rather than
  // appended, so the physical order survives regardless of which unmatched page gets assigned
  // first.
  function assignUnmatchedScan(item, candidateId) {
    if (!candidateId) return;
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return;
    const snapshot = resolveCandidateWrittenSnapshot({ candidate, variants, testBank });
    const page = {
      id: item.id,
      dataUrl: item.dataUrl,
      capturedAt: item.capturedAt || new Date().toISOString(),
      testCode: candidateScanTestCode(candidate, snapshot.variantCode),
      variantCode: snapshot.variantCode,
      anchorQuestions: [],
      questionResults: {},
      manuallyAssigned: true,
    };
    setScans((prev) => {
      const merged = [...(prev[candidateId] || []), page].sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
      return { ...prev, [candidateId]: merged };
    });
    setUnmatchedScans((prev) => prev.filter((x) => x.id !== item.id));
  }

  function assignAllUnmatchedScans(candidateId) {
    if (!candidateId) return;
    unmatchedScans.forEach((item) => assignUnmatchedScan(item, candidateId));
  }

  // Flattens every scanned page's already-computed per-question results into testResponses
  // (so the Examiner's own grading form shows these exactly like a candidate-typed answer) and
  // scanAssignments (so both this Centre review and the Examiner's grading form can show the
  // scanned original next to each question). A question with more than one non-crossed-out mark
  // is left unanswered here and flagged for manual review instead of guessing.
  function processCandidateScans(candidate) {
    const pages = scans[candidate.id] || [];
    const responsesPatch = {};
    const assignPatch = {};
    let errorCount = 0;
    const scorePatch = {};
    pages.forEach((page) => {
      Object.entries(page.questionResults || {}).forEach(([questionId, result]) => {
        assignPatch[questionId] = page.dataUrl;
        if (result.scoreGuess && Number.isFinite(result.scoreGuess.value)) scorePatch[questionId] = result.scoreGuess.value;
        if (result.error) { errorCount += 1; return; }
        if (result.selectedIndex != null) responsesPatch[questionId] = String.fromCharCode(65 + result.selectedIndex);
      });
    });
    if (Object.keys(scorePatch).length) {
      setScanScoreGuesses((prev) => ({ ...prev, [candidate.id]: { ...(prev[candidate.id] || {}), ...scorePatch } }));
    }
    if (Object.keys(responsesPatch).length) {
      setTestResponses((prev) => ({ ...prev, [candidate.id]: { ...(prev[candidate.id] || {}), ...responsesPatch } }));
    }
    setScanAssignments((prev) => ({ ...prev, [candidate.id]: { ...(prev[candidate.id] || {}), ...assignPatch } }));
    setProcessedInfo((prev) => ({ ...prev, [candidate.id]: { at: new Date().toISOString(), pageCount: pages.length, errorCount } }));
  }

  // The examiner must not see a test or report while the candidate is still working on it, so a
  // cell only opens once that section is closed (outdoor is the examiner's own form, so it is
  // reviewable whenever it has been submitted).
  // One pass over everyone who has scanned pages: assemble each candidate's test from their pages
  // and run the same detection that the per-candidate button does, so the Centre does not have to
  // confirm and process every candidate by hand before marking can start.
  function consolidateAllScans() {
    const withPages = candidates.filter((candidate) => (scans[candidate.id] || []).length);
    if (!withPages.length) {
      setScanMessage({ tone: "warn", text: t("centre.scan.emptyState") });
      return;
    }
    withPages.forEach((candidate) => processCandidateScans(candidate));
    setScanMessage({ tone: "good", text: tf("centre.scan.consolidatedInfo", { count: withPages.length }) });
  }

  function cellReviewable(candidate, sectionKey) {
    if (sectionKey === "outdoor") return true;
    return candidateStatus?.[candidate.id]?.[sectionKey] === "closed";
  }

  function cellStatus(candidate, sectionKey) {
    const key = `${candidate.id}:${sectionKey}`;
    if (correctionStatus[key]) return "corrected";
    if (sectionKey === "outdoor") {
      // Driven by per-examiner outdoor_assessments rows (hydrateCentreResults), not the
      // candidate's own local `.outdoor` field, which is only ever set on the same device that
      // ran submitOutdoor() and never updated from the synced/backend data otherwise. Orange means
      // an assigned examiner opened the field form and is mid-grading; red means every assigned
      // examiner (primary, and secondary when one is assigned) has submitted.
      const byExaminer = outdoorByExaminer?.[candidate.id] || {};
      const openedExaminerIds = Object.keys(byExaminer);
      const requiredExaminerIds = [assignments?.[candidate.id]?.primary, assignments?.[candidate.id]?.secondary].filter(Boolean);
      const examinerIdsToCheck = requiredExaminerIds.length ? requiredExaminerIds : openedExaminerIds;
      const allSubmitted = examinerIdsToCheck.length > 0 && examinerIdsToCheck.every((id) => byExaminer[id]?.submittedAt);
      if (allSubmitted) return "closed";
      return openedExaminerIds.length ? "open" : "locked";
    }
    const status = candidateStatus?.[candidate.id]?.[sectionKey];
    if (status === "closed") return "closed";
    if (status === "open") return "open";
    return "locked";
  }

  function buildSnapshot(candidate, sectionKey) {
    if (sectionKey === "test") {
      const auto = computeWrittenTestReview(candidate, variants, testBank, testResponses);
      // A correction overlays the auto-graded score per question, so a free-text question (no
      // correctAnswer, always 0 until an examiner reads it) can be marked at all, and a wrong
      // exact-match auto-grade can be fixed. Prefer the identified examiner's own correction; fall
      // back to whichever examiner's correction already exists (there is normally only one).
      const overrideBucket = writtenScoresByExaminer?.[candidate.id] || {};
      const overrideExaminerId = identifiedExaminer?.id && overrideBucket[identifiedExaminer.id]
        ? identifiedExaminer.id
        : Object.keys(overrideBucket)[0];
      const overrideScores = overrideExaminerId ? overrideBucket[overrideExaminerId]?.scores || {} : {};
      const items = auto.items.map((item) => {
        const override = overrideScores[item.question.id];
        const hasOverride = override !== undefined && override !== null && override !== "";
        return { ...item, pointsAwarded: hasOverride ? Number(override) : item.pointsAwarded, corrected: hasOverride };
      });
      const total = items.reduce((sum, item) => sum + (Number(item.pointsAwarded) || 0), 0);
      return { kind: "written", label: "Test", items, total, max: auto.totalMax, correctionExaminerId: overrideExaminerId || null };
    }
    if (sectionKey === "outdoor") {
      const scores = outdoor?.[candidate.id] || {};
      const entries = Object.entries(scores).filter(([, value]) => value !== "" && value !== null && value !== undefined);
      // Same source and running order the examiner's own form uses: the runtime package when one
      // is loaded, otherwise the built-in items (a raw outdoorItemsByLevel lookup left section E
      // empty whenever no package had been imported).
      const levelItems = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, candidate.level);
      const sectionNames = effectiveOutdoorSectionsForLevel(outdoorItemsByLevel, candidate.level);
      const byExaminer = outdoorByExaminer?.[candidate.id] || {};
      // Either/or exercises: the Centre does not hold the examiner's variant choice, so derive it
      // from the data — the variant they actually scored is the one that counts. Falls back to the
      // same default (first variant) as the examiner form. Both variants stay visible, the one
      // that does not count is marked and excluded from the totals (summing both double-counts).
      const scoredSections = new Set(
        Object.entries(levelItems)
          .filter(([, list]) => (list || []).some((item) => Object.values(byExaminer).some((bucket) => {
            const value = bucket?.scores?.[item.id];
            return value !== "" && value !== null && value !== undefined;
          })))
          .map(([section]) => section),
      );
      const variantChoice = Object.fromEntries(
        [...outdoorVariantGroups(sectionNames)].map(([base, group]) => [base, group.find((section) => scoredSections.has(section)) || group[0]]),
      );
      const items = sectionNames.flatMap((section) => (levelItems[section] || []).map((item) => ({
        ...item,
        section,
        excluded: outdoorSectionExcluded(sectionNames, variantChoice, section),
      })));
      const max = items.reduce((sum, item) => sum + (item.excluded ? 0 : Number(item.max || 0)), 0);
      const excludedIds = new Set(items.filter((item) => item.excluded).map((item) => item.id));
      const total = entries.reduce((sum, [itemId, value]) => sum + (excludedIds.has(itemId) ? 0 : Number(value || 0)), 0);
      const assignment = assignments?.[candidate.id] || {};
      // Fall back to whatever mode each bucket reports when the roster has no explicit assignment,
      // so a column is never dropped just because the assignment table is incomplete.
      const primaryId = assignment.primary || Object.values(byExaminer).find((bucket) => bucket.mode === "primary")?.examinerId || "";
      const secondaryId = assignment.secondary || Object.values(byExaminer).find((bucket) => bucket.mode === "secondary" && bucket.examinerId !== primaryId)?.examinerId || "";
      const columnFor = (examinerId, role) => ({
        role,
        examinerId,
        examinerName: examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId || "-",
        data: byExaminer[examinerId] || { scores: {}, notes: {}, noteDrawings: {}, itemTimestamps: {}, examSummary: "", submittedAt: null },
      });
      return {
        kind: "outdoor",
        label: "Outdoor",
        entries,
        total,
        max,
        items,
        primary: columnFor(primaryId, "primary"),
        secondary: columnFor(secondaryId, "secondary"),
      };
    }
    const draft = reportDrafts?.[candidate.id] || {};
    // Same pattern as the written test: prefer the identified examiner's own marks, fall back to
    // whichever examiner already has some (normally the one primary examiner who marked it).
    const marksBucket = reportMarksByExaminer?.[candidate.id] || {};
    const marksExaminerId = identifiedExaminer?.id && marksBucket[identifiedExaminer.id]
      ? identifiedExaminer.id
      : Object.keys(marksBucket)[0];
    const marks = marksExaminerId ? marksBucket[marksExaminerId]?.marks || {} : {};
    return {
      kind: "report",
      label: "Report",
      trees: Object.entries(draft),
      marks,
      total: reportMarksTotal(marks),
      max: REPORT_MARKING_TOTAL,
      correctionExaminerId: marksExaminerId || null,
    };
  }

  function requireIdentify() { setPendingIdentify(true); }

  function confirmIdentify(examinerId) {
    setIdentifiedExaminerId(examinerId);
    setPendingIdentify(false);
    const examiner = examiners.find((item) => item.id === examinerId);
    addAudit?.(
      "Examiner identified in Centre",
      examiner?.name || examinerId,
      reviewTarget ? `${reviewTarget.candidate?.name ?? reviewTarget.candidate?.id} / ${reviewTarget.sectionKey}` : ""
    );
  }

  function markCorrected() {
    if (!reviewTarget || !identifiedExaminer) return;
    const key = `${reviewTarget.candidate.id}:${reviewTarget.sectionKey}`;
    setCorrectionStatus((current) => ({ ...current, [key]: true }));
    addAudit?.("Correction marked resolved in Centre", `${reviewTarget.candidate?.name ?? reviewTarget.candidate?.id} / ${reviewTarget.sectionKey}`, identifiedExaminer?.name || "");
  }

  const sections = [
    { key: "test", label: "Test" },
    { key: "outdoor", label: "Outdoor" },
    { key: "report", label: "Report", consultingOnly: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
        <div>
          <h3 className="font-semibold">{t("centre.review.identifyTitle")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("centre.review.identifyHelper")}</p>
        </div>
        <div className="flex items-center gap-2">
          {identifiedExaminer ? (
            <>
              <StatusPill tone="good">{identifiedExaminer.name}</StatusPill>
              <Button onClick={() => setIdentifiedExaminerId("")} variant="outline" className="rounded-2xl">{t("common.logout")}</Button>
            </>
          ) : (
            <Button onClick={requireIdentify} className="rounded-2xl">{t("centre.review.identify")}</Button>
          )}
        </div>
      </div>

      {pendingIdentify && (
        // z-[60]: this must render above CentreReviewModal (z-50) — it can be
        // triggered from inside either of those, and a plain inline block would render behind
        // the modal overlay and be invisible (the click would "do nothing" from the user's view).
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setPendingIdentify(false)}>
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("centre.review.selectExaminer")}</p>
              <Button onClick={() => setPendingIdentify(false)} variant="outline" className="rounded-2xl">{t("common.close")}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {examiners.map((examiner) => (
                <Button key={examiner.id} onClick={() => confirmIdentify(examiner.id)} variant="outline" className="rounded-2xl">{examiner.name}</Button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-white p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2 pr-3">{t("centre.workflow.candidate")}</th>
              {sections.map((section) => <th key={section.key} className="py-2 pr-3">{section.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.id} className="border-b align-middle">
                <td className="py-2 pr-3">
                  <div className="font-medium">{candidate.id}</div>
                  <div className="text-xs text-slate-500">{candidate.name} · {candidate.level}</div>
                </td>
                {sections.map((section) => {
                  if (section.consultingOnly && candidate.level !== "Consulting") return <td key={section.key} className="py-2 pr-3 text-center text-slate-300">—</td>;
                  return (
                    <td key={section.key} className="py-2 pr-3">
                      <CentreReviewCell
                        status={cellStatus(candidate, section.key)}
                        sectionKey={section.key}
                        locked={!cellReviewable(candidate, section.key)}
                        lockedTitle={t("centre.review.notSubmittedYet")}
                        t={t}
                        onClick={() => { if (cellReviewable(candidate, section.key)) setReviewTarget({ candidate, sectionKey: section.key }); }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t("centre.scan.panelTitle")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t("centre.scan.panelHelper")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setShowConnectQr(true)} variant="outline" className="rounded-2xl">
              <QrCodeIcon className="mr-1 h-4 w-4" />{t("centre.scan.connectDevice")}
            </Button>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-white ${scanBusy ? "bg-slate-400" : "bg-slate-950"}`}>
              <Camera className="h-4 w-4" />
              {scanBusy ? t("centre.scan.processingPhoto") : t("centre.scan.scanButton")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={scanBusy}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) handleScanFile(file); }}
              />
            </label>
          </div>
        </div>

        {showConnectQr && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setShowConnectQr(false)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="font-semibold">{t("centre.scan.connectDeviceTitle")}</h4>
                <Button onClick={() => setShowConnectQr(false)} variant="outline" className="rounded-2xl">{t("common.close")}</Button>
              </div>
              <p className="mb-3 text-sm text-slate-600">{t("centre.scan.connectDeviceHelper")}</p>
              <div className="flex justify-center">
                <RealQr value={mobileScanCaptureUrl} size={200} />
              </div>
              <div className="mt-3 break-all rounded-xl bg-slate-100 p-2 text-center font-mono text-xs text-slate-500">{mobileScanCaptureUrl}</div>
            </div>
          </div>
        )}

        {scanMessage && (
          <div className={`mt-3 rounded-xl p-3 text-sm ${scanMessage.type === "error" ? "border border-rose-200 bg-rose-50 text-rose-950" : "border border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
            {scanMessage.text}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {candidates.filter((candidate) => (scans[candidate.id] || []).length).map((candidate) => {
            const pages = scans[candidate.id] || [];
            const expected = expectedPageCounts[candidate.id] ?? "";
            const confirmed = Number(expected) > 0 && Number(expected) === pages.length;
            const info = processedInfo[candidate.id];
            return (
              <div key={candidate.id} className="rounded-2xl border bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{candidate.name || candidate.id}</div>
                    <div className="text-xs text-slate-500">{candidate.id} · {candidate.level} · {tf("centre.scan.pagesCount", { count: pages.length })}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-500">
                      {t("centre.scan.expectedPages")}
                      <input
                        type="number"
                        min="1"
                        value={expected}
                        onChange={(event) => setExpectedPageCounts((prev) => ({ ...prev, [candidate.id]: event.target.value }))}
                        className="ml-2 w-16 rounded-lg border bg-white p-1 text-sm"
                      />
                    </label>
                    <Button onClick={() => processCandidateScans(candidate)} disabled={!confirmed} className="rounded-2xl">
                      {t("centre.scan.confirmAndProcess")}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {pages.map((page, index) => (
                    <div key={page.id} className="relative">
                      <img src={page.dataUrl} alt={`scan page ${index + 1}`} className="h-16 w-12 rounded border object-cover" />
                      <button type="button" onClick={() => removeScanPage(candidate.id, page.id)} className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-4 text-white">×</button>
                    </div>
                  ))}
                </div>

                {!confirmed && <div className="mt-2 text-xs text-amber-700">{t("centre.scan.confirmHint")}</div>}
                {info && (
                  <div className="mt-2 text-xs text-emerald-700">
                    {tf("centre.scan.processedInfo", { count: info.pageCount })}
                    {info.errorCount > 0 && <span className="ml-1 font-semibold text-rose-700">{tf("centre.scan.processedErrors", { count: info.errorCount })}</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!candidates.some((candidate) => (scans[candidate.id] || []).length) && (
            <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{t("centre.scan.emptyState")}</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={consolidateAllScans} disabled={!candidates.some((candidate) => (scans[candidate.id] || []).length)} className="rounded-2xl">
            {t("centre.scan.consolidateAll")}
          </Button>
          <span className="text-xs text-slate-500">{t("centre.scan.consolidateAllHelper")}</span>
        </div>

        {unmatchedScans.length > 0 && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-rose-950">{t("centre.scan.unmatchedTitle")}</div>
              {/* Scanning happens in strict page order, so an unmatched run is almost always one
                  candidate's mis-scanned pages in a row - this assigns the whole bucket in one
                  action instead of one dropdown per thumbnail. */}
              <div className="flex flex-wrap items-center gap-2">
                <select value={bulkAssignCandidateId} onChange={(event) => setBulkAssignCandidateId(event.target.value)} className="rounded-lg border bg-white p-1.5 text-xs">
                  <option value="">{t("centre.scan.assignPlaceholder")}</option>
                  {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id} ({candidate.id})</option>)}
                </select>
                <Button
                  onClick={() => { assignAllUnmatchedScans(bulkAssignCandidateId); setBulkAssignCandidateId(""); }}
                  disabled={!bulkAssignCandidateId}
                  variant="outline"
                  className="rounded-2xl"
                >
                  {tf("centre.scan.assignAllTo", { count: unmatchedScans.length })}
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {unmatchedScans.map((item) => (
                <div key={item.id} className="w-28 rounded-lg border border-rose-200 bg-white p-1">
                  <img src={item.dataUrl} alt="unmatched scan" className="h-16 w-full rounded object-cover" />
                  <div className="mt-1 text-[10px] text-rose-700">{item.reason}</div>
                  <select
                    value=""
                    onChange={(event) => assignUnmatchedScan(item, event.target.value)}
                    className="mt-1 w-full rounded border bg-white p-1 text-[10px]"
                  >
                    <option value="">{t("centre.scan.assignPlaceholder")}</option>
                    {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>)}
                  </select>
                  <button type="button" onClick={() => setUnmatchedScans((prev) => prev.filter((x) => x.id !== item.id))} className="mt-1 text-[10px] font-semibold text-rose-700 underline">
                    {t("centre.scan.discard")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Records & photos live with the scan tools: both are the Centre's evidence workspace. */}
      <MediaLibraryPanel sessionToken={activeSessionToken} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} Card={Card} CardContent={CardContent} FileSpreadsheet={FileSpreadsheet} t={t} />

      {/* Closing the exam: generates the two VETcert classification workbooks from the recorded
          results and locks the setup sections behind a password so nothing can shift underneath a
          file that has already been produced. */}
      <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-4">
        <h3 className="text-lg font-bold text-emerald-950">{t("centre.close.title")}</h3>
        <p className="mt-1 text-sm text-emerald-900">{t("centre.close.helper")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => setCloseConfirmOpen(true)} disabled={generating} className="rounded-2xl bg-emerald-700 text-white hover:bg-emerald-800">
            {generating ? t("centre.close.generating") : t("centre.close.button")}
          </Button>
          {examClosed && <StatusPill tone="good">{t("centre.close.closed")}</StatusPill>}
        </div>
        {generatedFiles && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-3">
            <span className="text-sm font-semibold">{t("centre.close.downloadTitle")}</span>
            {["Practicing", "Consulting"].map((level) => (
              <Button key={level} onClick={() => downloadGenerated(level)} variant="outline" className="rounded-2xl">
                <FileSpreadsheet className="mr-1 h-4 w-4" />
                {generatedFiles[level].fileName} ({generatedFiles[level].count})
              </Button>
            ))}
          </div>
        )}
      </div>

      {closeConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("centre.close.confirm")}</h3>
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{t("centre.close.confirmInfo")}</div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button onClick={() => setCloseConfirmOpen(false)} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
              <Button onClick={generateExamWorkbooks} disabled={generating} className="rounded-2xl">{t("common.confirm")}</Button>
            </div>
          </div>
        </div>
      )}

      <CentreCandidateResultsOverview
        candidates={candidates}
        assignments={assignments}
        examiners={examiners}
        variants={variants}
        testBank={testBank}
        testResponses={testResponses}
        reportDrafts={reportDrafts}
        outdoor={outdoor}
        outdoorItemsByLevel={outdoorItemsByLevel}
        scanPagesFor={(candidateId) => scans[candidateId] || []}
        onOpenScanGrading={(candidate) => { if (!identifiedExaminer) { requireIdentify(); return; } setScanGradingCandidate(candidate); }}
        t={t}
      />

      <div className="flex flex-wrap gap-4 rounded-2xl border bg-slate-50 p-3 text-xs text-slate-600">
        <span className="font-semibold">{t("centre.review.legendTitle")}:</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-slate-200" /> {t("centre.review.status.locked")}</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-amber-400" /> {t("centre.review.status.open")}</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-rose-500" /> {t("centre.review.status.closed")}</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-emerald-500" /> {t("centre.review.status.corrected")}</span>
      </div>

      {scanGradingCandidate && (() => {
        const questions = computeWrittenTestReview(scanGradingCandidate, variants, testBank, testResponses).items.map((item) => item.question);
        return (
          <ScanGradingModal
            candidate={scanGradingCandidate}
            pages={scans[scanGradingCandidate.id] || []}
            questions={questions}
            initialScores={{ ...(scanScoreGuesses[scanGradingCandidate.id] || {}), ...readWrittenQuestionScores(scanGradingCandidate.id) }}
            onSave={(scores) => {
              const numeric = Object.fromEntries(Object.entries(scores).map(([id, value]) => [id, value === "" ? "" : Number(value)]));
              writeWrittenQuestionScores(scanGradingCandidate.id, numeric);
              onScanGradingSaved?.(scanGradingCandidate, numeric, identifiedExaminer);
            }}
            onClose={() => setScanGradingCandidate(null)}
            t={t}
          />
        );
      })()}

      {reviewTarget && (
        <CentreReviewModal
          candidate={reviewTarget.candidate}
          section={{ ...sections.find((s) => s.key === reviewTarget.sectionKey), kind: reviewTarget.sectionKey === "test" ? "written" : reviewTarget.sectionKey }}
          snapshot={buildSnapshot(reviewTarget.candidate, reviewTarget.sectionKey)}
          onOutdoorCorrection={onOutdoorCorrection}
          onWrittenCorrection={onWrittenCorrection}
          onReportCorrection={onReportCorrection}
          scanAssignments={scanAssignments[reviewTarget.candidate.id]}
          scanFlags={reviewTarget.sectionKey === "test" ? Object.fromEntries([...scanErrorQuestionIds(reviewTarget.candidate.id)].map((id) => [id, true])) : null}
          identifiedExaminer={identifiedExaminer}
          onRequireIdentify={requireIdentify}
          onMarkCorrected={markCorrected}
          isCorrected={cellStatus(reviewTarget.candidate, reviewTarget.sectionKey) === "corrected"}
          onClose={() => setReviewTarget(null)}
          sessionToken={activeSessionToken}
          t={t}
        />
      )}
    </div>
  );
}

// Section F — Archivace. Lists every document produced during the certification process
// (input package, candidate outputs, examiner gradings, audit log), lets the Centre lead
// decide what to include, and on final closure bundles it all into one ZIP: each document as
// both .json and .pdf, a README, and a Centrum_<místo>_<timestamp>.vet manifest that embeds
// everything so Admin can later re-import and browse it read-only (see Admin section C).
function CentreArchiveSection({ candidates, examiners, variants, testBank, testResponses, reportDrafts, outdoor, outdoorNotes, outdoorItemsByLevel, audit, centreCode, examDate, place, t }) {
  const [activeAdminPackage, setActiveAdminPackage] = useState(null);
  const [included, setIncluded] = useState({});
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/test-package/approved", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data && !data.error) setActiveAdminPackage(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const documents = useMemo(
    () => buildArchiveDocuments({ candidates, activeAdminPackage, variants, testBank, testResponses, reportDrafts, outdoor, outdoorNotes, outdoorItemsByLevel, audit, t }),
    [candidates, activeAdminPackage, variants, testBank, testResponses, reportDrafts, outdoor, outdoorNotes, outdoorItemsByLevel, audit, t]
  );

  useEffect(() => {
    setIncluded((prev) => {
      const next = { ...prev };
      let changed = false;
      documents.forEach((doc) => {
        if (!(doc.id in next)) { next[doc.id] = true; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [documents]);

  const categories = [...new Set(documents.map((doc) => doc.category))];

  function toggleDoc(id) {
    setIncluded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function finalizeExam() {
    const selectedDocs = documents.filter((doc) => included[doc.id] ?? true);
    if (!selectedDocs.length) {
      window.alert(t("centre.archive.noneSelected"));
      return;
    }
    const ok = window.confirm(t("centre.archive.confirmClose").replace("{count}", selectedDocs.length));
    if (!ok) return;

    setClosing(true);
    setStatus(t("centre.archive.generating"));
    setError("");
    try {
      const zip = new JSZip();
      const stamp = vetFilenameStamp();
      const placeSlug = slugForFilename(place);
      const vetFilename = `Centrum_${placeSlug}_${stamp}.vet`;

      const manifest = {
        kind: "vetbara.centreArchive.v1",
        centreCode: centreCode || "-",
        examDate: examDate || "-",
        place: place || "-",
        closedAt: new Date().toISOString(),
        candidates,
        examiners,
        documents: [],
      };

      for (const doc of selectedDocs) {
        const jsonData = doc.getJson();
        zip.file(`${doc.category}/${doc.jsonFilename}`, JSON.stringify(jsonData, null, 2));
        manifest.documents.push({ id: doc.id, category: doc.category, label: doc.label, filename: doc.jsonFilename, data: jsonData });
        try {
          const pdfBlob = buildArchiveSectionsPdfBlob(doc.pdfTitle, [`${t("archive.category")}: ${doc.category}`, `${t("archive.readme.generatedAt")}: ${new Date().toLocaleString()}`], doc.getPdfSections());
          zip.file(`${doc.category}/${doc.jsonFilename.replace(/\.json$/, ".pdf")}`, pdfBlob);
        } catch (pdfError) {
          console.error("Archive PDF generation failed for", doc.id, pdfError);
        }
      }

      zip.file(vetFilename, JSON.stringify(manifest, null, 2));
      zip.file("README.txt", buildArchiveReadme(selectedDocs, vetFilename, t));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Archiv_${placeSlug}_${stamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus(t("centre.archive.done").replace("{filename}", link.download));
    } catch (err) {
      setStatus("");
      setError(err.message || String(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold">{t("centre.archive.documentsTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("centre.archive.documentsHelper")}</p>
        {categories.map((category) => (
          <div key={category} className="mt-4">
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{category}</h4>
            <div className="grid gap-2 md:grid-cols-2">
              {documents.filter((doc) => doc.category === category).map((doc) => (
                <label key={doc.id} className="flex items-center gap-3 rounded-xl border bg-white p-3 text-sm">
                  <input type="checkbox" checked={included[doc.id] ?? true} onChange={() => toggleDoc(doc.id)} />
                  <span>{doc.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-5">
        <h3 className="text-lg font-bold text-rose-950">{t("centre.archive.finalCloseTitle")}</h3>
        <p className="mt-1 text-sm text-rose-900">{t("centre.archive.finalCloseHelper")}</p>
        <Button onClick={finalizeExam} disabled={closing} className="mt-3 rounded-2xl bg-rose-700 text-white hover:bg-rose-800">
          {closing ? t("centre.archive.generating") : t("centre.archive.finalCloseButton")}
        </Button>
        {status && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div>}
        {error && <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3 text-sm text-rose-900">{error}</div>}
      </div>
    </div>
  );
}

const CENTRE_WIFI_ACCESS_KEY = "vetbara.centre.wifiAccess";

// Just a place to jot down the venue's WiFi so it can be shown/read out to candidates and
// examiners on request - not exam data, so it stays local to this device rather than round-
// tripping through the centre setup save/load flow.
function readCentreWifiAccess() {
  if (typeof window === "undefined") return { ssid: "", password: "" };
  try {
    const raw = JSON.parse(window.localStorage.getItem(scopedCacheKey(CENTRE_WIFI_ACCESS_KEY)) || "{}");
    return { ssid: raw.ssid || "", password: raw.password || "" };
  } catch {
    return { ssid: "", password: "" };
  }
}

function CentreWifiAccessBox({ t, centreExamId }) {
  const [wifi, setWifi] = useState(() => readCentreWifiAccess());
  // The exam scope that scopedCacheKey() reads is only set once the QR session resolves
  // (applyResolvedAccess, asynchronous), which lands after this component's first render — so the
  // lazy initializer above can read the cache under the wrong (unscoped) key on a fresh page load.
  // Re-read once centreExamId shows up, since it's set in that same resolution step.
  useEffect(() => {
    setWifi(readCentreWifiAccess());
  }, [centreExamId]);
  function update(patch) {
    const next = { ...wifi, ...patch };
    setWifi(next);
    if (typeof window !== "undefined") window.localStorage.setItem(scopedCacheKey(CENTRE_WIFI_ACCESS_KEY), JSON.stringify(next));
  }
  return (
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="mb-3 font-semibold">{t("centre.wifi.title")}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">{t("centre.wifi.ssid")}<input value={wifi.ssid} onChange={(event) => update({ ssid: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
        <label className="text-sm font-medium">{t("centre.wifi.password")}<input value={wifi.password} onChange={(event) => update({ password: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
      </div>
    </div>
  );
}

// --- Exam scheduling ("harmonogram") ---------------------------------------------------------
// A day's exam programme is built from fixed-length blocks (welcome 30 min, each main activity
// 120 min, breaks/lunch configurable) per candidate pair ("group"), matching the Centre's own
// printed exam-programme sheets (Time / Duration / Activity tables, plus a combined "general
// overview" table). This only proposes a reasonable STARTING arrangement - groups that would
// compete for the same pair of examiners are staggered into "waves"; the coordinator drags
// blocks sideways from there to match the room/examiner reality on the day. Dragging only ever
// changes a block's start time, never its duration.
const HARMONOGRAM_SETTINGS_KEY = "vetbara.centre.harmonogramSettings";
const HARMONOGRAM_WELCOME_DURATION = 30;
const HARMONOGRAM_MAIN_DURATION = 120;
const HARMONOGRAM_DEFAULT_SETTINGS = { dayStartTime: "08:30", days: 1, coffeeBreakMinutes: 30, lunchMinutes: 60 };

function readHarmonogramSettings() {
  if (typeof window === "undefined") return HARMONOGRAM_DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(scopedCacheKey(HARMONOGRAM_SETTINGS_KEY)) || "{}");
    return { ...HARMONOGRAM_DEFAULT_SETTINGS, ...raw };
  } catch {
    return HARMONOGRAM_DEFAULT_SETTINGS;
  }
}

function writeHarmonogramSettings(settings) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(scopedCacheKey(HARMONOGRAM_SETTINGS_KEY), JSON.stringify(settings)); } catch { /* ignore */ }
}

function harmonogramActivityColor(key) {
  return {
    welcome: "#c6e0b4",
    outdoor: "#f4b183",
    written: "#bdd7ee",
    report: "#ffe699",
    break: "#d9d9d9",
    lunch: "#ffd966",
    finish: "#c6e0b4",
  }[key] || "#e5e7eb";
}

function harmonogramTimeLabel(totalMinutes) {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function harmonogramParseTime(value) {
  const [h, m] = String(value || "08:30").split(":").map(Number);
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 30);
}

// Only the two orderings that make sense are offered for Consulting: report-writing always comes
// after the outdoor session that collects the field data it's based on.
function harmonogramSequenceOptions(level) {
  return level === "Practicing"
    ? [["outdoor", "written"], ["written", "outdoor"]]
    : [["written", "outdoor", "report"], ["outdoor", "report", "written"]];
}

function harmonogramBuildGroupBlocks(group, settings, welcomeEnd) {
  // Waves stagger groups competing for the same examiner pair - the welcome itself is shared
  // across every lane (see buildDefaultHarmonogramSchedule), only each wave's own activity
  // sequence starts later.
  const waveOffset = group.wave * (HARMONOGRAM_MAIN_DURATION + settings.coffeeBreakMinutes);
  let cursor = welcomeEnd + waveOffset;
  const blocks = [];
  const sequence = harmonogramSequenceOptions(group.level)[group.groupIndex % harmonogramSequenceOptions(group.level).length];
  sequence.forEach((activity, index) => {
    blocks.push({ id: `${group.id}-${activity}`, activity, start: cursor, duration: HARMONOGRAM_MAIN_DURATION });
    cursor += HARMONOGRAM_MAIN_DURATION;
    if (index < sequence.length - 1) {
      const isLunch = group.level === "Consulting" && index === sequence.length - 2;
      const breakDuration = isLunch ? settings.lunchMinutes : settings.coffeeBreakMinutes;
      blocks.push({ id: `${group.id}-break-${index}`, activity: isLunch ? "lunch" : "break", start: cursor, duration: breakDuration });
      cursor += breakDuration;
    }
  });
  blocks.push({ id: `${group.id}-finish`, activity: "finish", start: cursor, duration: 0 });
  return blocks;
}

// Pairs candidates two-at-a-time per level (matching the reference exam-programme sheets), then
// spreads groups across as many parallel "lanes" as the examiner count supports (one lane needs
// one examiner pair) and, beyond that, across days round-robin.
// Welcome happens once, for the whole cohort together, before anyone splits into their own
// activity rotation - it is a single shared block, not one per group/lane (HarmonogramTimeline
// renders it as its own full-width row above the per-group lanes; dragging it shifts every lane by
// the same delta, since every day's schedule is built around the same "office hour" welcome time).
function buildDefaultHarmonogramSchedule(candidates, examiners, settings) {
  const parallelLanes = Math.max(1, Math.floor((examiners?.length || 2) / 2));
  const levels = ["Practicing", "Consulting"];
  const rawGroups = [];
  levels.forEach((level) => {
    const levelCandidates = candidates.filter((c) => c.level === level);
    for (let i = 0; i < levelCandidates.length; i += 2) {
      rawGroups.push({ level, members: levelCandidates.slice(i, i + 2) });
    }
  });
  const days = Math.max(1, Number(settings.days) || 1);
  const dayStart = harmonogramParseTime(settings.dayStartTime);
  const welcome = { id: "welcome", activity: "welcome", start: dayStart, duration: HARMONOGRAM_WELCOME_DURATION };
  const welcomeEnd = dayStart + HARMONOGRAM_WELCOME_DURATION;
  const groups = rawGroups.map((group, index) => {
    const groupIndex = rawGroups.slice(0, index).filter((g) => g.level === group.level).length;
    const built = {
      ...group,
      id: `group-${index}`,
      groupIndex,
      wave: Math.floor(index / parallelLanes),
      day: index % days,
    };
    return { ...built, blocks: harmonogramBuildGroupBlocks(built, settings, welcomeEnd) };
  });
  return { welcome, groups };
}

function harmonogramGroupLabel(group, t) {
  const names = group.members.map((m) => m.name || m.id).join(", ");
  return `${group.level === "Practicing" ? t("harmonogram.levelPracticing") : t("harmonogram.levelConsulting")} · ${names}`;
}

function printHarmonogramPdf(welcome, groups, days, t) {
  if (!groups.length) return;
  const welcomeRow = `<tr style="background:${harmonogramActivityColor(welcome.activity)}"><td style="border:1px solid #ccc;padding:2mm">${harmonogramTimeLabel(welcome.start)}</td><td style="border:1px solid #ccc;padding:2mm">${welcome.duration} min</td><td style="border:1px solid #ccc;padding:2mm">${escapeHtml(t(`harmonogram.activity.${welcome.activity}`))}</td></tr>`;
  const dayPages = Array.from({ length: days }, (_, day) => {
    const dayGroups = groups.filter((g) => g.day === day);
    if (!dayGroups.length) return "";
    const groupTables = dayGroups.map((group) => {
      const rows = welcomeRow + group.blocks.map((block) => `<tr style="background:${harmonogramActivityColor(block.activity)}"><td style="border:1px solid #ccc;padding:2mm">${harmonogramTimeLabel(block.start)}</td><td style="border:1px solid #ccc;padding:2mm">${block.duration ? `${block.duration} min` : ""}</td><td style="border:1px solid #ccc;padding:2mm">${escapeHtml(t(`harmonogram.activity.${block.activity}`))}</td></tr>`).join("");
      return `<section style="break-inside:avoid;margin-bottom:6mm">
        <div style="font-weight:700;text-decoration:underline">${escapeHtml(group.level)}</div>
        <div style="margin-bottom:2mm">${escapeHtml(group.members.map((m) => m.name || m.id).join(", "))}</div>
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt"><thead><tr style="text-align:left"><th style="border:1px solid #ccc;padding:2mm">${escapeHtml(t("harmonogram.time"))}</th><th style="border:1px solid #ccc;padding:2mm">${escapeHtml(t("harmonogram.duration"))}</th><th style="border:1px solid #ccc;padding:2mm">${escapeHtml(t("harmonogram.activityCol"))}</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </section>`;
    }).join("");

    const allStarts = Array.from(new Set([welcome.start, ...dayGroups.flatMap((g) => g.blocks.map((b) => b.start))])).sort((a, b) => a - b);
    const overviewRows = allStarts.map((start, i) => {
      const nextStart = allStarts[i + 1];
      const duration = nextStart ? nextStart - start : 0;
      const cells = dayGroups.map((g) => {
        const block = [welcome, ...g.blocks].find((b) => b.start <= start && start < b.start + Math.max(b.duration, 1));
        return `<td style="border:1px solid #ccc;padding:2mm;${block ? `background:${harmonogramActivityColor(block.activity)}` : ""}">${block ? escapeHtml(t(`harmonogram.activity.${block.activity}`)) : ""}</td>`;
      }).join("");
      return `<tr><td style="border:1px solid #ccc;padding:2mm">${harmonogramTimeLabel(start)}</td><td style="border:1px solid #ccc;padding:2mm">${duration ? `${duration} min` : ""}</td>${cells}</tr>`;
    }).join("");
    const overviewHeader = dayGroups.map((g) => `<th style="border:1px solid #ccc;padding:2mm">${escapeHtml(g.level)} (${escapeHtml(g.members.map((m) => m.id).join(", "))})</th>`).join("");

    return `<section style="break-after:page">
      <h1 style="font-size:14pt;margin:0 0 6mm">${escapeHtml(t("harmonogram.pdfTitle"))}${days > 1 ? ` · ${escapeHtml(t("harmonogram.dayLabel"))} ${day + 1}` : ""}</h1>
      ${groupTables}
      <h2 style="font-size:12pt">${escapeHtml(t("harmonogram.generalOverview"))}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:9pt"><thead><tr style="text-align:left"><th style="border:1px solid #ccc;padding:2mm">${escapeHtml(t("harmonogram.time"))}</th><th style="border:1px solid #ccc;padding:2mm">${escapeHtml(t("harmonogram.duration"))}</th>${overviewHeader}</tr></thead>
      <tbody>${overviewRows}</tbody></table>
    </section>`;
  }).join("");

  // The exam programme's "detail" half: what each activity on the timeline actually involves, plus
  // the general notes (mirrors the reference Bologna programme's footnotes). Only activities that
  // appear in this schedule are listed, in day order, each with its timeline colour swatch.
  const activityOrder = ["welcome", "outdoor", "written", "report", "break", "lunch", "finish"];
  const usedActivities = Array.from(new Set([welcome.activity, ...groups.flatMap((g) => g.blocks.map((b) => b.activity))]));
  const orderedActivities = activityOrder.filter((a) => usedActivities.includes(a)).concat(usedActivities.filter((a) => !activityOrder.includes(a)));
  const detailRows = orderedActivities.map((activity) => `<tr>
      <td style="border:1px solid #ccc;padding:2mm;white-space:nowrap;font-weight:600"><span style="display:inline-block;width:4mm;height:4mm;border-radius:2px;background:${harmonogramActivityColor(activity)};vertical-align:middle;margin-right:2mm"></span>${escapeHtml(t(`harmonogram.activity.${activity}`))}</td>
      <td style="border:1px solid #ccc;padding:2mm">${escapeHtml(t(`harmonogram.detail.${activity}`))}</td>
    </tr>`).join("");
  const detailsSection = `<section style="break-before:page">
      <h1 style="font-size:14pt;margin:0 0 6mm">${escapeHtml(t("harmonogram.detailsTitle"))}</h1>
      <table style="width:100%;border-collapse:collapse;font-size:9.5pt"><tbody>${detailRows}</tbody></table>
      <h2 style="font-size:12pt;margin-top:6mm">${escapeHtml(t("harmonogram.notesTitle"))}</h2>
      <ul style="font-size:9.5pt;margin:0;padding-left:5mm">
        <li style="margin-bottom:1.5mm">${escapeHtml(t("harmonogram.note.coffee"))}</li>
        <li>${escapeHtml(t("harmonogram.note.weather"))}</li>
      </ul>
    </section>`;

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(t("harmonogram.pdfTitle"))}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018;font-size:10pt}
    @media print{.actions{display:none}}
    .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
  </style></head><body>
    <div class="actions"><button onclick="window.print()">${escapeHtml(t("fieldPrep.printPdf"))}</button></div>
    ${dayPages}
    ${detailsSection}
  </body></html>`;
  openPrintDocument(html, () => window.alert(t("harmonogram.printBlocked")));
}

const HARMONOGRAM_BASE_PX_PER_MINUTE = 3;
const HARMONOGRAM_BASE_ROW_HEIGHT = 40;
const HARMONOGRAM_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
// The visible axis is always at least 07:00-22:00 (extending further only if a coordinator drags
// something outside that window) - the realistic target day runs 08:30-20:00, so this leaves
// comfortable margin on both ends without the ruler jumping around as blocks move.
const HARMONOGRAM_AXIS_START = 7 * 60;
const HARMONOGRAM_AXIS_END = 22 * 60;
const HARMONOGRAM_REALISTIC_END = 20 * 60;

function harmonogramZoomStep(current, direction) {
  const index = HARMONOGRAM_ZOOM_STEPS.reduce((closest, value, i) => (Math.abs(value - current) < Math.abs(HARMONOGRAM_ZOOM_STEPS[closest] - current) ? i : closest), 0);
  const nextIndex = Math.max(0, Math.min(HARMONOGRAM_ZOOM_STEPS.length - 1, index + direction));
  return HARMONOGRAM_ZOOM_STEPS[nextIndex];
}

// Vertical zoom scales row height fully (taps stay easy to hit at high zoom) but font size only by
// its square root, capped - a 4x row-height zoom used to mean 4x-huge text, unreadable well before
// it stopped being useful as a bigger tap target.
function harmonogramFontSize(zoomY, base, min, max) {
  return Math.max(min, Math.min(max, base * Math.sqrt(zoomY)));
}

// Independent horizontal (time scale) and vertical (row height) zoom, since a coordinator might
// want a wide overview of the whole day or a tall, easy-to-tap view for fine-grained dragging on
// a tablet - not always the same tradeoff.
function HarmonogramTimeline({ welcome, groups, onMoveBlock, onMoveWelcome, onResizeBlock, onDeleteBlock, t, maxHeight }) {
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);
  const pxPerMinute = HARMONOGRAM_BASE_PX_PER_MINUTE * zoomX;
  const rowHeight = HARMONOGRAM_BASE_ROW_HEIGHT * zoomY;
  const allStarts = [welcome.start, ...groups.flatMap((g) => g.blocks.map((b) => b.start))];
  const allEnds = [welcome.start + welcome.duration, ...groups.flatMap((g) => g.blocks.map((b) => b.start + b.duration))];
  const minStart = Math.min(HARMONOGRAM_AXIS_START, Math.floor(Math.min(...allStarts) / 60) * 60);
  const maxEnd = Math.max(HARMONOGRAM_AXIS_END, Math.max(...allEnds) + 30);
  const timelineWidth = (maxEnd - minStart) * pxPerMinute;
  const dragRef = useRef(null);
  const scheduleEndsLate = Math.max(...allEnds) > HARMONOGRAM_REALISTIC_END;

  function startDrag(groupId, block, event) {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    dragRef.current = { mode: "move", groupId, blockId: block.id, startClientX: event.clientX, startValue: block.start, pointerId: event.pointerId };
  }
  // Break/lunch blocks only - a drag on this narrow right-edge handle shortens the block instead
  // of moving it; stopPropagation keeps the parent block's own onPointerDown (startDrag/move) from
  // also firing.
  function startResize(groupId, block, event) {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    dragRef.current = { mode: "resize", groupId, blockId: block.id, startClientX: event.clientX, startDuration: block.duration, pointerId: event.pointerId };
  }
  function onMove(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaMinutes = (event.clientX - drag.startClientX) / pxPerMinute;
    if (drag.mode === "resize") {
      const snappedDuration = Math.max(5, Math.round((drag.startDuration + deltaMinutes) / 5) * 5);
      onResizeBlock(drag.groupId, drag.blockId, snappedDuration);
      return;
    }
    const snapped = Math.max(0, Math.round((drag.startValue + deltaMinutes) / 5) * 5);
    // The welcome block isn't part of any group's own blocks array (it's shared across every
    // lane), so it's routed to its own handler via this sentinel id rather than onMoveBlock.
    if (drag.groupId === "__welcome__") onMoveWelcome(snapped);
    else onMoveBlock(drag.groupId, drag.blockId, snapped);
  }
  function endDrag(event) {
    if (dragRef.current && event.pointerId === dragRef.current.pointerId) dragRef.current = null;
  }

  const hourMarks = [];
  for (let m = minStart; m <= maxEnd; m += 60) hourMarks.push(m);

  const hourMarkFontSize = harmonogramFontSize(zoomY, 10, 10, 14);
  const groupLabelFontSize = harmonogramFontSize(zoomY, 12, 11, 15);
  const blockFontSize = harmonogramFontSize(zoomY, 10, 10, 15);

  function renderBlock(groupId, block) {
    const isBreakLike = block.activity === "break" || block.activity === "lunch";
    return (
      <div
        key={block.id}
        onPointerDown={(event) => startDrag(groupId, block, event)}
        className="absolute top-0 flex cursor-grab items-center justify-center overflow-hidden rounded-md border border-white/60 px-1 text-center font-semibold text-slate-900 active:cursor-grabbing"
        style={{
          left: `${(block.start - minStart) * pxPerMinute}px`,
          width: `${Math.max(6, block.duration * pxPerMinute - 2)}px`,
          height: `${rowHeight}px`,
          fontSize: `${blockFontSize}px`,
          background: harmonogramActivityColor(block.activity),
          touchAction: "none",
        }}
        title={`${harmonogramTimeLabel(block.start)} · ${t(`harmonogram.activity.${block.activity}`)} · ${block.duration} min`}
      >
        {block.duration * pxPerMinute > 40 ? t(`harmonogram.activity.${block.activity}`) : ""}
        {isBreakLike && (
          <>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onDeleteBlock(groupId, block.id); }}
              title={t("harmonogram.removeBlock")}
              aria-label={t("harmonogram.removeBlock")}
              className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold leading-none text-white shadow"
            >
              ×
            </button>
            <div
              onPointerDown={(event) => startResize(groupId, block, event)}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
              title={t("harmonogram.resizeBlock")}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border bg-white p-1">
          <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("harmonogram.zoomHorizontal")}</span>
          <button type="button" onClick={() => setZoomX((z) => harmonogramZoomStep(z, -1))} className="rounded-full p-1 hover:bg-slate-100"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoomX((z) => harmonogramZoomStep(z, 1))} className="rounded-full p-1 hover:bg-slate-100"><ZoomIn className="h-4 w-4" /></button>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border bg-white p-1">
          <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("harmonogram.zoomVertical")}</span>
          <button type="button" onClick={() => setZoomY((z) => harmonogramZoomStep(z, -1))} className="rounded-full p-1 hover:bg-slate-100"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoomY((z) => harmonogramZoomStep(z, 1))} className="rounded-full p-1 hover:bg-slate-100"><ZoomIn className="h-4 w-4" /></button>
        </div>
        {(zoomX !== 1 || zoomY !== 1) && (
          <button type="button" onClick={() => { setZoomX(1); setZoomY(1); }} className="text-xs font-semibold text-slate-500 underline">{t("harmonogram.zoomReset")}</button>
        )}
        {scheduleEndsLate && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{t("harmonogram.endTimeWarning")}</span>
        )}
      </div>
      <div className="overflow-auto rounded-xl border bg-slate-50 p-3" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} style={maxHeight ? { maxHeight } : undefined}>
        <div className="relative" style={{ width: `${timelineWidth}px`, minWidth: "100%" }}>
          <div className="relative border-b" style={{ height: `${Math.max(24, rowHeight * 0.6)}px` }}>
            {hourMarks.map((m) => (
              <div key={m} className="absolute top-0 border-l pl-1 font-semibold text-slate-500" style={{ left: `${(m - minStart) * pxPerMinute}px`, fontSize: `${hourMarkFontSize}px` }}>{harmonogramTimeLabel(m)}</div>
            ))}
          </div>
          {/* Welcome is shared across every lane (single row, full width) - dragging it shifts
              every group's blocks below by the same delta (see CentreScheduleBuilder). */}
          <div className="mt-2">
            <div className="mb-1 font-semibold text-slate-600" style={{ fontSize: `${groupLabelFontSize}px` }}>{t("harmonogram.activity.welcome")}</div>
            <div className="relative rounded-lg bg-white" style={{ width: `${timelineWidth}px`, height: `${rowHeight}px` }}>
              {renderBlock("__welcome__", welcome)}
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="mb-1 font-semibold text-slate-600" style={{ fontSize: `${groupLabelFontSize}px` }}>{harmonogramGroupLabel(group, t)}</div>
                <div className="relative rounded-lg bg-white" style={{ width: `${timelineWidth}px`, height: `${rowHeight}px` }}>
                  {group.blocks.filter((b) => b.duration > 0).map((block) => renderBlock(group.id, block))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Settings are lifted to VetBaraPrototype (rather than owned here) so they can be saved to the
// backend alongside the rest of Centre Setup and read back by a Candidate's own device to render
// its individual schedule widget - a plain local useState never leaves this browser tab.
function CentreScheduleBuilder({ candidates, examiners, settings, setSettings, setCentreSetupDirty, t }) {
  const [welcome, setWelcome] = useState(null);
  const [groups, setGroups] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  function updateSettings(updater) {
    setCentreSetupDirty(true);
    setSettings(updater);
  }

  function regenerate() {
    const built = buildDefaultHarmonogramSchedule(candidates, examiners, settings);
    setWelcome(built.welcome);
    setGroups(built.groups);
    setActiveDay(0);
  }

  // Regenerates whenever the roster actually changes shape - level flips matter here just as much
  // as add/remove, since a candidate moving Practicing<->Consulting changes which group (and which
  // block sequence) it belongs to. Depending on candidates.length alone missed that: editing an
  // existing candidate's level kept the same count, so the proposal silently went stale.
  const candidateSignature = candidates.map((c) => `${c.id}:${c.level}`).join("|");
  const examinerSignature = examiners.map((e) => e.id).join("|");
  const settingsSignature = `${settings.dayStartTime}|${settings.days}|${settings.coffeeBreakMinutes}|${settings.lunchMinutes}`;
  useEffect(() => {
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateSignature, examinerSignature, settingsSignature]);

  // Moving (not resizing) a block onto a neighbor's slot swaps the two instead of overlapping -
  // there's no such thing as two activities happening in the same lane at once, and a swap is
  // almost always what dragging one activity "past" another actually meant. Blocks have different
  // durations, so just exchanging their start times isn't enough - "outdoor" (120min) swapping
  // with the very next "break" (30min) can still spill into whatever comes after the break. Only
  // an IMMEDIATE neighbor (in current start-time order) is swapped, and everything from the
  // earlier of the two swapped blocks onward is re-flowed with no gaps, so the swap never creates
  // a second overlap further down the lane. A drag that would overlap a block further away than
  // the immediate neighbor is ignored rather than guessing at a multi-block reshuffle.
  function updateBlockStart(groupId, blockId, newStart) {
    setGroups((prev) => (prev || []).map((group) => {
      if (group.id !== groupId) return group;
      const moving = group.blocks.find((b) => b.id === blockId);
      if (!moving) return group;
      const newEnd = newStart + moving.duration;
      const overlapping = group.blocks.find((b) => b.id !== blockId && newStart < b.start + b.duration && newEnd > b.start);
      if (!overlapping) {
        return { ...group, blocks: group.blocks.map((b) => (b.id === blockId ? { ...b, start: newStart } : b)) };
      }
      const ordered = [...group.blocks].sort((a, b) => a.start - b.start);
      const movingIndex = ordered.findIndex((b) => b.id === blockId);
      const overlapIndex = ordered.findIndex((b) => b.id === overlapping.id);
      if (Math.abs(movingIndex - overlapIndex) !== 1) return group;
      const reordered = [...ordered];
      [reordered[movingIndex], reordered[overlapIndex]] = [reordered[overlapIndex], reordered[movingIndex]];
      const fromIndex = Math.min(movingIndex, overlapIndex);
      let cursor = ordered[fromIndex].start;
      const nextStartById = {};
      for (let i = fromIndex; i < reordered.length; i += 1) {
        nextStartById[reordered[i].id] = cursor;
        cursor += reordered[i].duration;
      }
      return {
        ...group,
        blocks: group.blocks.map((b) => (nextStartById[b.id] !== undefined ? { ...b, start: nextStartById[b.id] } : b)),
      };
    }));
  }

  // Welcome is shared across every lane, so moving it shifts every group's own blocks by the same
  // delta - the whole day slides together rather than only the welcome bar moving on its own.
  function updateWelcomeStart(newStart) {
    if (!welcome || newStart === welcome.start) return;
    const delta = newStart - welcome.start;
    setWelcome((w) => ({ ...w, start: newStart }));
    setGroups((prev) => (prev || []).map((group) => ({
      ...group,
      blocks: group.blocks.map((b) => ({ ...b, start: b.start + delta })),
    })));
  }

  // Break/lunch only: shrinking (or removing) one frees up time that the rest of that lane's day
  // shifts earlier into, same as a real day running ahead of schedule once a break is cut short.
  function resizeBreakBlock(groupId, blockId, newDuration) {
    setGroups((prev) => (prev || []).map((group) => {
      if (group.id !== groupId) return group;
      const block = group.blocks.find((b) => b.id === blockId);
      if (!block) return group;
      const clamped = Math.max(5, newDuration);
      const delta = block.duration - clamped;
      if (delta === 0) return group;
      return {
        ...group,
        blocks: group.blocks.map((b) => {
          if (b.id === blockId) return { ...b, duration: clamped };
          if (b.start > block.start) return { ...b, start: b.start - delta };
          return b;
        }),
      };
    }));
  }

  function deleteBreakBlock(groupId, blockId) {
    setGroups((prev) => (prev || []).map((group) => {
      if (group.id !== groupId) return group;
      const block = group.blocks.find((b) => b.id === blockId);
      if (!block) return group;
      return {
        ...group,
        blocks: group.blocks.filter((b) => b.id !== blockId).map((b) => (b.start > block.start ? { ...b, start: b.start - block.duration } : b)),
      };
    }));
  }

  const days = Math.max(1, Number(settings.days) || 1);
  const visibleGroups = (groups || []).filter((g) => g.day === activeDay);
  const parallelLanes = Math.max(1, Math.floor((examiners?.length || 2) / 2));

  function settingsGrid() {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium">{t("harmonogram.startTime")}
          {/* Realistic target day starts no earlier than 08:30 (see HARMONOGRAM_AXIS_* for the
              wider 07:00-22:00 display window this feeds into). */}
          <input type="time" min="08:30" value={settings.dayStartTime} onChange={(event) => updateSettings((s) => ({ ...s, dayStartTime: event.target.value < "08:30" ? "08:30" : event.target.value }))} className="mt-1 w-full rounded-xl border bg-white p-2" />
        </label>
        <label className="text-sm font-medium">{t("harmonogram.days")}
          <input type="number" min="1" value={settings.days} onChange={(event) => updateSettings((s) => ({ ...s, days: Math.max(1, Number(event.target.value) || 1) }))} className="mt-1 w-full rounded-xl border bg-white p-2" />
        </label>
        <label className="text-sm font-medium">{t("harmonogram.coffeeBreakMinutes")}
          <input type="number" min="0" step="5" value={settings.coffeeBreakMinutes} onChange={(event) => updateSettings((s) => ({ ...s, coffeeBreakMinutes: Math.max(0, Number(event.target.value) || 0) }))} className="mt-1 w-full rounded-xl border bg-white p-2" />
        </label>
        <label className="text-sm font-medium">{t("harmonogram.lunchMinutes")}
          <input type="number" min="0" step="5" value={settings.lunchMinutes} onChange={(event) => updateSettings((s) => ({ ...s, lunchMinutes: Math.max(0, Number(event.target.value) || 0) }))} className="mt-1 w-full rounded-xl border bg-white p-2" />
        </label>
      </div>
    );
  }

  function dayTabs() {
    if (days <= 1) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: days }, (_, day) => (
          <button key={day} type="button" onClick={() => setActiveDay(day)} className={`rounded-2xl border-2 px-3 py-1.5 text-xs font-semibold ${activeDay === day ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            {t("harmonogram.dayLabel")} {day + 1}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("harmonogram.title")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("harmonogram.helper")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={regenerate} variant="outline" className="rounded-2xl">{t("harmonogram.regenerate")}</Button>
          <Button onClick={() => printHarmonogramPdf(welcome, groups || [], days, t)} disabled={!welcome || !groups?.length} variant="outline" className="rounded-2xl">{t("harmonogram.printPdf")}</Button>
          <Button onClick={() => setFullscreenOpen(true)} disabled={!welcome || !groups?.length} className="rounded-2xl">
            <Maximize className="mr-1 h-4 w-4" />{t("harmonogram.openFullscreen")}
          </Button>
        </div>
      </div>

      {settingsGrid()}

      <p className="mt-2 text-xs text-slate-500">{tfHarmonogram(t, "harmonogram.lanesHelper", { lanes: parallelLanes })}</p>

      {dayTabs()}

      {welcome && visibleGroups.length > 0 ? (
        <div className="mt-4">
          <HarmonogramTimeline welcome={welcome} groups={visibleGroups} onMoveBlock={updateBlockStart} onMoveWelcome={updateWelcomeStart} onResizeBlock={resizeBreakBlock} onDeleteBlock={deleteBreakBlock} t={t} maxHeight="40vh" />
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-slate-500">{t("harmonogram.noCandidates")}</div>
      )}

      {/* Same editor, full-screen: the inline card is deliberately height-capped so it doesn't
          dominate the rest of section C, but dragging blocks precisely benefits from more room. */}
      {fullscreenOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div>
              <h3 className="text-lg font-semibold">{t("harmonogram.title")}</h3>
              <p className="mt-1 text-sm text-slate-600">{t("harmonogram.helper")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={regenerate} variant="outline" className="rounded-2xl">{t("harmonogram.regenerate")}</Button>
              <Button onClick={() => printHarmonogramPdf(welcome, groups || [], days, t)} disabled={!welcome || !groups?.length} variant="outline" className="rounded-2xl">{t("harmonogram.printPdf")}</Button>
              <Button onClick={() => setFullscreenOpen(false)} className="rounded-2xl">{t("common.close")}</Button>
            </div>
          </div>

          <div className="mt-3">{settingsGrid()}</div>
          <p className="mt-2 text-xs text-slate-500">{tfHarmonogram(t, "harmonogram.lanesHelper", { lanes: parallelLanes })}</p>
          {dayTabs()}

          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            {welcome && visibleGroups.length > 0 ? (
              <HarmonogramTimeline welcome={welcome} groups={visibleGroups} onMoveBlock={updateBlockStart} onMoveWelcome={updateWelcomeStart} onResizeBlock={resizeBreakBlock} onDeleteBlock={deleteBreakBlock} t={t} maxHeight="65vh" />
            ) : (
              <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">{t("harmonogram.noCandidates")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function tfHarmonogram(t, key, values) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
}

function CentreView({ centreUnlocked, centreCode, setCentreCode, centreExamId, unlockCentre, enabledLevels, toggleLevel, language, availableVariants, variants, setVariants, setAvailableVariants, testBank, setTestBank, setTestImportSummary, outdoorItemsByLevel, setOutdoorItemsByLevel, activeAdminPackageMeta, setActiveAdminPackageMeta, importTestPackage, testImportStatus, testImportError, testImportSummary, candidates, selectedCandidateId, setSelectedCandidateId, addCandidate, updateCandidate, assignments, setAssignments, examiners, candidateQrFor, examinerQrFor, centreSetupLoading, centreSetupSaving, centreSetupError, centreSetupStatus, centreAuditExportLoading, centreAuditExportError, centreQrAccess, centreValidationIssues, centreSetupDirty, setCentreSetupDirty, harmonogramSettings, setHarmonogramSettings, dataMode, activeSessionToken, candidateConfirmed, candidateStatus, candidateTimes, testResponses, setTestResponses, reportDrafts, outdoor, outdoorByExaminer, applyOutdoorCorrection, applyScanGrading, writtenScoresByExaminer, reportMarksByExaminer, applyWrittenCorrection, applyReportCorrection, outdoorNotes, audit, examDate, place, handleLoadCentreSetup, handleSaveCentreSetup, handleDownloadCentreAuditPackage, updateExaminer, addExaminer, removeCandidate, removeExaminer, addAudit, t }) {
  const [copiedQr, setCopiedQr] = useState("");
  const [activeCentreSection, setActiveCentreSection] = useState("setup");
  // Field-preparation draft lives here (not inside CentreFieldPreparationModule) because the
  // dashboard sections mount their children only while open — switching to Candidates/Examiners
  // would otherwise unmount the module and discard unsaved site-prep edits. CentreView stays
  // mounted for the whole Centre session, so the draft survives section navigation.
  // Sections D/E/F depend on the roster being final: access links, the review overview and the
  // archive are all keyed to the people entered in section C, and the QR links are only minted
  // when that roster is saved. So they stay locked until the operator confirms the list, and any
  // change to WHO is on it (adding or removing a candidate/examiner) locks them again.
  const [rosterConfirming, setRosterConfirming] = useState(false);
  const issuedLinkCount = (centreQrAccess?.candidates?.length || 0) + (centreQrAccess?.examiners?.length || 0);
  // Confirmed == every person currently on the roster already has an issued access link. This is
  // derived rather than remembered, so it is right in every case without extra bookkeeping: a
  // fresh certification has no links (locked), a roster loaded from the backend has them all
  // (unlocked), and a newly added candidate/examiner has none yet (locked again until the
  // operator presses the confirm button, which saves the roster and issues the missing links).
  const hasIssuedLink = (list, id) => Boolean(list?.some((item) => (item.subjectId || item.subject_id) === id));
  const rosterConfirmed = candidates.length > 0
    && candidates.every((c) => hasIssuedLink(centreQrAccess?.candidates, c.id))
    && examiners.every((e) => hasIssuedLink(centreQrAccess?.examiners, e.id));

  async function confirmRosterComplete() {
    setRosterConfirming(true);
    try {
      await handleSaveCentreSetup();
    } finally {
      setRosterConfirming(false);
    }
  }

  const fieldPrepExamId = centreExamId || centreCode || CENTRE_QR_ID;
  // Section B used to open on the built-in default template, so a preparation already stored on
  // the server (e.g. everything the tablet synced from the field) looked LOST until someone
  // happened to press "Load". Pull it automatically, once per exam id per Centre session.
  const fieldPrepAutoLoadRef = useRef("");
  const [fieldPrep, setFieldPrep] = useState(() => createDefaultFieldPreparation({ examId: fieldPrepExamId, language }));
  // The Centre session resolves asynchronously, so the draft above may have been created with the
  // fallback id. Re-point an untouched draft once the real certification id arrives — never
  // overwrite an id the operator typed or a preparation already loaded from the server.
  useEffect(() => {
    if (!centreExamId) return;
    setFieldPrep((current) => (current?.examId && current.examId !== CENTRE_QR_ID ? current : { ...current, examId: centreExamId }));
  }, [centreExamId]);

  // Closing the exam (section E): the two VETcert classification workbooks are generated once, and
  // to keep them faithful to the data they were produced from, sections A–D lock afterwards. The
  // "closed" flag is remembered per exam id so the lock survives a reload; reopening a section
  // needs the closing password ("Vetarbo") and is session-only (deliberately a soft, temporary
  // gate for corrections, not a security boundary).
  const examCloseKey = `vetbara.examClosed.${fieldPrepExamId}`;
  const [examClosed, setExamClosed] = useState(false);
  useEffect(() => {
    try { setExamClosed(window.localStorage.getItem(examCloseKey) === "1"); } catch { setExamClosed(false); }
  }, [examCloseKey]);
  const [sectionsUnlocked, setSectionsUnlocked] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const lockClosedSections = examClosed && !sectionsUnlocked;
  function markExamClosed() {
    try { window.localStorage.setItem(examCloseKey, "1"); } catch { /* ignore storage errors */ }
    setExamClosed(true);
  }
  function openUnlockDialog() { setUnlockValue(""); setUnlockError(false); setUnlockOpen(true); }
  function submitUnlock() {
    if (unlockValue === EXAMINER_FORM_UNLOCK_PASSWORD) {
      setSectionsUnlocked(true);
      setUnlockOpen(false);
      setUnlockValue("");
      setUnlockError(false);
    } else {
      setUnlockError(true);
    }
  }

  // Local LAN QR mode: see docs/qr-base-url-design-note.md. Production base URL stays the
  // default; switching to a local base URL is explicit, session-only, and never silently
  // rewrites links unless a validated local URL is set.
  const [qrBaseUrlMode, setQrBaseUrlMode] = useState("production");
  const [localQrBaseUrlInput, setLocalQrBaseUrlInput] = useState("");
  const [localQrBaseUrl, setLocalQrBaseUrl] = useState(null);
  const [localQrBaseUrlError, setLocalQrBaseUrlError] = useState("");
  const candidateQrUrlRaw = (id) => centreQrAccess?.candidates?.find((item) => item.subjectId === id || item.subject_id === id)?.url;
  const examinerQrUrlRaw = (id) => centreQrAccess?.examiners?.find((item) => item.subjectId === id || item.subject_id === id)?.url;

  function rewriteQrBaseUrl(url) {
    if (!url || qrBaseUrlMode !== "local" || !localQrBaseUrl) return url;
    try {
      const original = new URL(url);
      const local = new URL(localQrBaseUrl);
      return `${local.origin}${original.pathname}${original.search}${original.hash}`;
    } catch {
      return url;
    }
  }

  function applyLocalQrBaseUrl() {
    const raw = localQrBaseUrlInput.trim();
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("scheme");
      setLocalQrBaseUrl(raw);
      setLocalQrBaseUrlError("");
    } catch {
      setLocalQrBaseUrlError("Neplatná Local LAN URL. Zadejte celou adresu, např. http://192.168.0.186:3010");
    }
  }

  const candidateQrUrl = (id) => rewriteQrBaseUrl(candidateQrUrlRaw(id));
  const examinerQrUrl = (id) => rewriteQrBaseUrl(examinerQrUrlRaw(id));
  // Printed QR sheets and printed tests must carry the SERVER-MINTED access link. They used to
  // fall back to the synthesised `VETBARA-<ROLE>-<ID>-2026` pattern, which is only a real token
  // for the two seeded demo subjects — so every other printed QR was a dead link.
  const candidateQrForRewritten = (id) => candidateQrUrl(id) || "";
  const examinerQrForRewritten = (id) => examinerQrUrl(id) || "";

  async function copyQrLink(label, value) {
    const text = String(value ?? "").trim();
    if (!text) {
      setCopiedQr(t("centre.copy.unavailable").replace("{label}", label));
      return;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedQr(t("centre.copy.copied").replace("{label}", label));
        return;
      }
    } catch {
      // Fall through to the legacy copy path used on http:// LAN addresses.
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (ok) {
        setCopiedQr(t("centre.copy.copied").replace("{label}", label));
        return;
      }
    } catch {
      // Some tablet browsers reject programmatic clipboard access on insecure LAN URLs.
    }

    window.prompt(t("centre.copy.promptTitle"), text);
    setCopiedQr(t("centre.copy.unavailable").replace("{label}", label));
  }

  function openPrintWindow(html) {
    openPrintDocument(html, () => setCopiedQr(t("centre.print.windowBlocked")));
  }

  // 4-per-page cut-and-distribute sheet: every Candidate and Examiner QR, with their name
  // printed underneath, laid out 2x2 so a pair of scissors gives one QR card per person.
  function printAllQrCodes() {
    const people = [
      ...candidates.map((c) => ({ id: c.id, name: c.name, role: t("role.candidate"), url: candidateQrForRewritten(c.id) })),
      ...examiners.map((ex) => ({ id: ex.id, name: ex.name, role: t("role.examiner"), url: examinerQrForRewritten(ex.id) })),
    ].filter((person) => person.url);
    if (!people.length) { setCopiedQr(t("qr.missing")); return; }
    const cells = people.map((person) => `<div class="qr-print-cell">
      <div class="qr-print-code">${renderQrSvgMarkup(person.url, 220)}</div>
      <div class="qr-print-name">${escapeHtml(person.name || person.id)}</div>
      <div class="qr-print-id">${escapeHtml(person.id)} · ${escapeHtml(person.role)}</div>
    </div>`).join("");
    openPrintWindow(`<!doctype html><html><head><meta charset="utf-8" /><title>VetBara QR codes</title><style>
      @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018}
      .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
      .qr-print-grid{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:135mm}
      .qr-print-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #94a89c;padding:8mm;break-inside:avoid}
      .qr-print-code svg{width:55mm;height:55mm}
      .qr-print-name{margin-top:6mm;font-size:14pt;font-weight:800;text-align:center}
      .qr-print-id{margin-top:2mm;font-size:10pt;color:#516158;text-align:center}
      @media print{.actions{display:none}}
    </style></head><body><div class="actions"><button onclick="window.print()">Tisk / PDF</button></div><div class="qr-print-grid">${cells}</div></body></html>`);
  }

  // Printable written-test paper: candidate header (with the same access QR, so a scanned page
  // can be matched back to the right person) plus every question, each carrying a bracketed
  // reference code — the "control characters" — so answers can be matched back to the right
  // question during manual/scanned evaluation. Multiple-choice gets checkboxes; written
  // questions get ruled lines sized roughly to their point value.
  // Builds one candidate's printable test (header + questions). Shared by the single-candidate
  // print and the "print all tests" pack, so both stay identical in layout.
  function candidateTestSectionHtml(candidate) {
    const snapshot = resolveCandidateWrittenSnapshot({ candidate, variants, testBank });
    const questions = snapshot.questions;
    const qrMarkup = renderQrSvgMarkup(candidateQrForRewritten(candidate.id), 130);
    const candidateNumber = candidateScanNumber(candidate);
    const testCode = candidateScanTestCode(candidate, snapshot.variantCode);
    // Each question keeps its own small scan-sort QR (test/candidate/question encoded) so a
    // stack of scanned pages can still be matched back to the right digital question even if
    // pages get shuffled — but questions are no longer forced one-per-page. They flow normally
    // and only get `break-inside: avoid` so a question and its answer space never split across
    // a page boundary; this keeps the print compact instead of burning a sheet per question.
    // The payload is deliberately minimal (test code, candidate number, question number) — no
    // long IDs — so the QR stays low-density and legible at a small printed size. The physical
    // page number can't be known at this point (pagination happens later, in the browser's print
    // layout), so it is shown separately as plain printed text via a CSS page counter instead.
    function scanSortQr(questionIndex) {
      // Only characters from the QR "alphanumeric" charset (0-9 A-Z space $ % * + - . / :) are
      // used here — mixing in anything outside that set (e.g. a "|") forces the encoder into the
      // much less efficient byte mode, which needs a bigger/denser QR for the same content.
      const value = `VS-${testCode}-${candidateNumber}-Q${questionIndex}`;
      return renderQrSvgMarkup(value, 68, { includeMargin: true });
    }
    // The scan-sort QR for a choice question is placed directly above its own checkbox column
    // (inside .pt-options) rather than up in the question header: a photographed QR's detected
    // corners are only a reliable local ruler for a short distance around it (any small angular
    // detection error scales into real position error over distance), and the header sits far
    // to the right of the checkboxes at the left margin — tens of mm apart on an A4 page. Written
    // (non-choice) questions have no checkboxes to locate, so their QR stays in the header.
    // How much writing room a written question gets. Multi-part questions (asking for several
    // items, e.g. "Describe 2 diagnostic tools ... Provide 2 advantages and disadvantages for
    // each") need roughly double the space of a single-answer question, so they are detected and
    // doubled rather than every question being padded.
    function answerLineCount(question) {
      const text = String(question.text || "");
      const points = Number(question.points) || 0;
      const base = Math.max(3, points > 0 ? Math.ceil(points * 1.5) : 3);
      const asks = (text.match(/\b[2-9]\b/g) || []).length;
      // "Describe 2 tools ... 2 advantages and disadvantages for each ..." asks for several
      // answers in one question, so it gets exactly double the standard writing room.
      const multiPart = asks >= 2 || text.length > 180;
      // Cap high enough that the doubling is never silently clipped, but still short enough that
      // a question block (text + lines + scoring box) fits one A4 page — the block is
      // break-inside:avoid so the scoring box always stays with its question.
      return Math.min(24, multiPart ? base * 2 : base);
    }
    function answerLines(count) {
      return `<div class="pt-lines">${Array.from({ length: count }).map(() => `<div class="pt-line"></div>`).join("")}</div>`;
    }
    // A question that lists bullet points is really several sub-questions (e.g. "Describe what the
    // following pieces of EU Legislation cover" followed by four directives). Give each bullet its
    // own answer field instead of one shared block of lines.
    function splitBullets(text) {
      const lines = String(text || "").split(/\r?\n/);
      const bulletAt = lines.findIndex((line) => /^\s*[•\u2022*\-\u2013]\s+\S/.test(line));
      if (bulletAt < 0) return null;
      const intro = lines.slice(0, bulletAt).join("\n").trim();
      const bullets = [];
      let trailing = [];
      for (const line of lines.slice(bulletAt)) {
        if (/^\s*[•\u2022*\-\u2013]\s+\S/.test(line)) bullets.push(line.replace(/^\s*[•\u2022*\-\u2013]\s+/, "").trim());
        else if (line.trim()) trailing.push(line.trim());
      }
      return bullets.length >= 2 ? { intro, bullets, trailing: trailing.join(" ") } : null;
    }

    let printedSection = null;
    const questionsHtml = questions.map((q, index) => {
      const number = index + 1;
      const qid = q.id || `Q${number}`;
      const isChoice = q.type === "single_choice" && q.options.length;
      const cornerQr = scanSortQr(number);
      const bulletParts = isChoice ? null : splitBullets(q.text);
      const bodyHtml = isChoice
        ? `<div class="pt-options"><span class="pt-corner-qr pt-corner-qr-options">${cornerQr}</span>${q.options.map((opt, i) => `<div class="pt-option"><span class="pt-checkbox"></span>${escapeHtml(String.fromCharCode(65 + i))}. ${escapeHtml(String(opt).replace(/^[A-D][.)]\s*/i, ""))}</div>`).join("")}</div>`
        : bulletParts
          ? bulletParts.bullets.map((bullet) => `<div class="pt-subblock"><div class="pt-subtext">• ${escapeHtml(bullet)}</div>${answerLines(3)}</div>`).join("")
          : answerLines(answerLineCount(q));
      const questionText = bulletParts
        ? [bulletParts.intro, bulletParts.trailing].filter(Boolean).join("\n")
        : (q.text || "");
      // The max mark sits next to the examiner's scoring box under the question (not above it),
      // and the whole <section> is break-inside:avoid, so the box and its max mark can never end
      // up on a different page than the question they belong to.
      const maxPoints = Number(q.points) > 0 ? `${q.points}` : "";
      const scoreHtml = `<div class="pt-score"><span class="pt-score-box"></span>${maxPoints ? `<span class="pt-score-max">/ ${escapeHtml(maxPoints)} b.</span>` : ""}</div>`;
      const sectionName = String(q.section || "").trim();
      let sectionHtml = "";
      if (sectionName && sectionName !== printedSection) {
        printedSection = sectionName;
        sectionHtml = `<h2 class="pt-section">${escapeHtml(sectionName)}</h2>`;
      }
      return `${sectionHtml}<section class="pt-question">
        <div class="pt-question-head">
          <span class="pt-qcode">[[${escapeHtml(qid)}]]</span>
          ${!isChoice ? `<span class="pt-corner-qr">${cornerQr}</span>` : ""}
        </div>
        <div class="pt-qtext"><span class="pt-qnum">${number}.</span> ${linesToHtml(questionText)}</div>
        ${bodyHtml}
        ${scoreHtml}
      </section>`;
    }).join("");
    return `<article class="pt-candidate">
      <header class="pt-header">
        <div class="pt-header-info">
          <h1>${escapeHtml(candidate.name || candidate.id)}</h1>
          <p>${escapeHtml(candidate.id)} · ${escapeHtml(candidateLevel(candidate))} · ${escapeHtml(snapshot.variantCode || "")}</p>
          <div class="pt-header-code">[[CANDIDATE:${escapeHtml(candidate.id)}]] [[VARIANT:${escapeHtml(snapshot.variantCode || "")}]]</div>
        </div>
        <div class="pt-qr">${qrMarkup}</div>
      </header>
      <main>${questionsHtml || `<p>${escapeHtml(t("centre.print.noQuestionsFound"))}</p>`}</main>
    </article>`;
  }

  // Layout for anything inside a `break-inside: avoid` block deliberately avoids flexbox/grid
  // here — printing flex/grid content that also needs page-break fragmentation is a known
  // source of Chromium/WebKit pagination bugs (extra blank trailing pages, content vanishing
  // near a page boundary). Plain block flow + floats paginate reliably everywhere instead.
  function candidateTestDocument(title, innerHtml) {
    return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>
      @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018;font-size:10.5pt}
      .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
      .pt-candidate{break-after:page}
      .pt-candidate:last-child{break-after:auto}
      header.pt-header{border-bottom:2px solid #102018;padding-bottom:5mm;margin-bottom:6mm}
      header.pt-header::after{content:"";display:block;clear:both}
      .pt-header-info{float:left;max-width:70%}
      .pt-header-info h1{margin:0;font-size:15pt}
      .pt-header-info p{margin:1.5mm 0 0;font-size:9.5pt;color:#516158}
      .pt-header-code{font-family:ui-monospace,monospace;font-size:8.5pt;margin-top:1.5mm;color:#516158}
      .pt-qr{float:right}
      .pt-qr svg{width:24mm;height:24mm}
      .pt-question{break-inside:avoid;margin-bottom:5mm;padding-bottom:3mm;border-bottom:1px solid #dbe3dd}
      .pt-question-head{font-family:ui-monospace,monospace;font-size:8pt;color:#8a978f;margin-bottom:1.5mm}
      .pt-question-head::after{content:"";display:block;clear:both}
      .pt-qcode{float:left}
      .pt-corner-qr{float:right;background:#fff;padding:1mm}
      .pt-corner-qr svg{width:${SCAN_QR_PRINT_MM}mm;height:${SCAN_QR_PRINT_MM}mm}
      .pt-corner-qr-options{float:right;display:block;margin:0 0 1.5mm 3mm}
      .pt-section{break-after:avoid;font-size:12pt;margin:7mm 0 3mm;padding-bottom:1.5mm;border-bottom:1.5pt solid #102018;color:#0f3d2e}
      .pt-section:first-child{margin-top:0}
      .pt-qtext{font-weight:700;margin-bottom:2.5mm;font-size:11.5pt;clear:both}
      .pt-qnum{color:#0f3d2e}
      .pt-options{margin-top:1mm}
      .pt-options::after{content:"";display:block;clear:both}
      .pt-option{margin:1.8mm 0;font-size:10.5pt}
      .pt-checkbox{display:inline-block;width:4.5mm;height:4.5mm;border:1.5pt solid #102018;border-radius:1mm;margin-right:3mm;vertical-align:middle}
      .pt-subblock{margin:0 0 3mm}
      .pt-subtext{font-weight:600;font-size:10.5pt;margin-bottom:1mm}
      .pt-lines{margin-top:2mm}
      .pt-line{border-bottom:1px solid #b9c3bb;height:1px;margin-bottom:6mm}
      .pt-score{margin-top:2.5mm;text-align:right;font-size:9pt;color:#516158}
      .pt-score-box{display:inline-block;width:16mm;height:8mm;border:1.5pt solid #102018;border-radius:1mm;vertical-align:middle}
      .pt-score-max{margin-left:2mm;font-weight:700;color:#102018;vertical-align:middle}
      @media print{.actions{display:none}}
    </style></head><body>
      <div class="actions"><button onclick="window.print()">Tisk / PDF</button></div>
      ${innerHtml}
    </body></html>`;
  }

  function printCandidateTest(candidate) {
    openPrintWindow(candidateTestDocument(`VetBara test - ${candidate.id}`, candidateTestSectionHtml(candidate)));
  }

  // One PDF with every candidate's test (both levels), ordered by candidate number, each
  // starting on a fresh page.
  function printAllCandidateTests() {
    const ordered = [...candidates].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: "base" }));
    if (!ordered.length) return;
    openPrintWindow(candidateTestDocument("VetBara - tests", ordered.map(candidateTestSectionHtml).join("")));
  }

  const setupMeta = testImportSummary ? t("centre.status.packageLoaded") : t("centre.status.awaitingPackage");
  const peopleMeta = `${candidates.length} ${t("centre.status.candidatesUnit")} · ${examiners.length} ${t("centre.status.examinersUnit")}`;
  const accessMeta = centreValidationIssues.length ? `${centreValidationIssues.length} ${t("centre.status.issuesUnit")}` : t("centre.status.ready");

  return (
    <>
      {!centreUnlocked && (
        <Card className="rounded-2xl shadow-sm lg:col-span-3">
          <CardContent className="p-5">
            <div className="rounded-2xl border bg-white p-4">
              <SectionTitle icon={QrCodeIcon} title={t("centre.access.title")} subtitle={t("centre.access.subtitle")} />
              <div className="flex flex-col gap-3 md:flex-row">
                <input value={centreCode} onChange={(event) => setCentreCode(event.target.value)} placeholder={t("centre.access.placeholder")} className="w-full rounded-xl border bg-white p-2 font-mono text-sm" />
                <Button onClick={unlockCentre} className="rounded-2xl">{t("centre.access.open")}</Button>
              </div>
              <div className="mt-2 text-xs text-slate-500">{t("centre.access.prototypeToken")}: {CENTRE_ACCESS_TOKEN}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className={`lg:col-span-3 space-y-4 ${centreUnlocked ? "" : "pointer-events-none opacity-40"}`}>
        <AdminDashboardSection
          id="setup"
          icon={ShieldCheck}
          t={t}
          locked={lockClosedSections}
          lockedMessage={lockClosedSections ? t("centre.close.lockedMessage") : undefined}
          onUnlock={lockClosedSections ? openUnlockDialog : undefined}
          title={t("centre.dashboard.setup.title")}
          description={t("centre.dashboard.setup.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <CentreActivePackagePanel setVariants={setVariants} setAvailableVariants={setAvailableVariants} setTestBank={setTestBank} setOutdoorItemsByLevel={setOutdoorItemsByLevel} setActiveAdminPackageMeta={setActiveAdminPackageMeta} setTestImportSummary={setTestImportSummary} setCentreSetupDirty={setCentreSetupDirty} language={language} t={t} />

            <div className="rounded-2xl border bg-white p-4">
              <h3 className="mb-3 font-semibold">{t("centre.levels.title")}</h3>
              {EXAM_LEVELS.map((level) => (
                <label key={level} className="mb-3 flex items-center gap-3 rounded-xl border p-3 text-sm">
                  <input type="checkbox" checked={enabledLevels.includes(level)} onChange={() => toggleLevel(level)} />
                  <span>{level}</span>
                </label>
              ))}
            </div>

            <CentreWifiAccessBox t={t} centreExamId={centreExamId} />

          </div>
        </AdminDashboardSection>

        <AdminDashboardSection
          id="field-preparation"
          icon={MapPin}
          t={t}
          locked={lockClosedSections}
          lockedMessage={lockClosedSections ? t("centre.close.lockedMessage") : undefined}
          onUnlock={lockClosedSections ? openUnlockDialog : undefined}
          title={t("centre.dashboard.fieldPrep.title")}
          description={t("centre.dashboard.fieldPrep.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <CentreFieldPreparationModule prep={fieldPrep} setPrep={setFieldPrep} autoLoadRef={fieldPrepAutoLoadRef} centreCode={fieldPrepExamId} language={language} sessionToken={activeSessionToken} t={t} />
        </AdminDashboardSection>

        <AdminDashboardSection
          id="people"
          icon={Users}
          t={t}
          locked={lockClosedSections}
          lockedMessage={lockClosedSections ? t("centre.close.lockedMessage") : undefined}
          onUnlock={lockClosedSections ? openUnlockDialog : undefined}
          title={t("centre.dashboard.people.title")}
          description={t("centre.dashboard.people.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border bg-white p-4">
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold">{t("centre.candidates.title")}</h3>
                  <p className="mt-1 text-sm text-slate-600">{t("centre.candidates.helper")}</p>
                </div>
                <Button onClick={addCandidate} variant="outline" className="rounded-2xl">{t("centre.candidates.add")}</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {candidates.map((candidate) => <CandidateEditorCard key={candidate.id} candidate={candidate} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} removeCandidate={removeCandidate} updateCandidate={updateCandidate} candidatesCount={candidates.length} t={t} />)}
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold">{t("centre.examiners.title")}</h3>
                  <p className="mt-1 text-sm text-slate-600">{t("centre.examiners.helper")}</p>
                </div>
                <Button onClick={addExaminer} variant="outline" className="rounded-2xl">{t("centre.examiners.add")}</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {examiners.map((examiner) => <ExaminerEditorCard key={examiner.id} examiner={examiner} removeExaminer={removeExaminer} updateExaminer={updateExaminer} examinersCount={examiners.length} t={t} />)}
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <div className="mb-3 flex items-center gap-1.5"><h3 className="font-semibold">{t("centre.assignments.title")}</h3><InfoTooltip text={t("centre.assignments.primarySecondaryHelp")} /></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-3">{t("centre.workflow.candidate")}</th><th className="py-2 pr-3">{t("centre.workflow.level")}</th><th className="py-2 pr-3">{t("centre.workflow.primaryExaminer")}</th><th className="py-2 pr-3">{t("centre.workflow.secondaryExaminer")}</th></tr></thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr key={candidate.id} className="border-b">
                        <td className="py-2 pr-3 font-medium">{candidate.name}</td>
                        <td className="py-2 pr-3">{candidate.level}</td>
                        {["primary", "secondary"].map((slot) => (
                          <td key={slot} className="py-2 pr-3">
                            <select value={assignments[candidate.id]?.[slot] ?? ""} onChange={(event) => { setCentreSetupDirty(true); setAssignments((previous) => ({ ...previous, [candidate.id]: { ...(previous[candidate.id] ?? {}), [slot]: event.target.value } })); }} className="w-full rounded-xl border bg-white p-2">
                              {examiners.map((examiner) => <option key={examiner.id} value={examiner.id}>{examiner.name}</option>)}
                            </select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`rounded-2xl border-2 p-4 ${rosterConfirmed ? "border-emerald-300 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-base font-bold">{t("centre.roster.confirmTitle")}</h3>
                  <p className="mt-1 text-sm text-slate-700">{rosterConfirmed ? t("centre.roster.confirmedHelper") : t("centre.roster.confirmHelper")}</p>
                </div>
                <Button onClick={confirmRosterComplete} disabled={rosterConfirming || centreSetupSaving} className="rounded-2xl px-5 py-3 text-base font-bold">
                  {rosterConfirming ? t("centre.roster.confirming") : t("centre.roster.confirmButton")}
                </Button>
              </div>
              {rosterConfirmed && <div className="mt-2 text-sm font-semibold text-emerald-800">{String(t("centre.roster.linksIssued")).replace("{count}", issuedLinkCount)}</div>}
              {/* Surface a failed confirm right here, next to the button: the save error used to
                  render only in section A, so a failed roster save in section C looked like the
                  button did nothing and the sections "just stayed locked". */}
              {!rosterConfirmed && centreSetupError && <div className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-2 text-sm font-medium text-rose-800">{centreSetupError}</div>}
            </div>

            <CentreScheduleBuilder candidates={candidates} examiners={examiners} settings={harmonogramSettings} setSettings={setHarmonogramSettings} setCentreSetupDirty={setCentreSetupDirty} t={t} />
          </div>
        </AdminDashboardSection>

        <AdminDashboardSection
          id="access"
          icon={QrCodeIcon}
          t={t}
          locked={lockClosedSections || !activeAdminPackageMeta || !rosterConfirmed}
          lockedMessage={lockClosedSections ? t("centre.close.lockedMessage") : (!activeAdminPackageMeta ? t("centre.dashboard.lockedNoAdminPackage") : t("centre.dashboard.lockedRosterUnconfirmed"))}
          onUnlock={lockClosedSections ? openUnlockDialog : undefined}
          title={t("centre.dashboard.access.title")}
          description={t("centre.dashboard.access.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={centreValidationIssues.length ? "warn" : "good"}>{accessMeta}</StatusPill>
              <StatusPill>{peopleMeta}</StatusPill>
            </div>
            <CentreQrAccessPack candidates={candidates} examiners={examiners} candidateQrUrl={candidateQrUrl} examinerQrUrl={examinerQrUrl} candidateQrFor={candidateQrForRewritten} examinerQrFor={examinerQrForRewritten} copiedQr={copiedQr} copyQrLink={copyQrLink} QrCodeIcon={QrCodeIcon} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} RealQr={RealQr} t={t} onPrintAllQr={printAllQrCodes} onPrintAllTests={printAllCandidateTests} onPrintCandidateTest={printCandidateTest} activeSessionToken={activeSessionToken} addAudit={addAudit} />
          </div>
        </AdminDashboardSection>

        <AdminDashboardSection
          id="review"
          icon={ShieldCheck}
          t={t}
          locked={!activeAdminPackageMeta || !rosterConfirmed}
          lockedMessage={!activeAdminPackageMeta ? t("centre.dashboard.lockedNoAdminPackage") : t("centre.dashboard.lockedRosterUnconfirmed")}
          title={t("centre.dashboard.review.title")}
          description={t("centre.dashboard.review.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <CentreReviewSection
            candidates={candidates}
            examiners={examiners}
            assignments={assignments}
            centreExamId={centreExamId}
            outdoorByExaminer={outdoorByExaminer}
            onOutdoorCorrection={applyOutdoorCorrection}
            onScanGradingSaved={applyScanGrading}
            writtenScoresByExaminer={writtenScoresByExaminer}
            reportMarksByExaminer={reportMarksByExaminer}
            onWrittenCorrection={applyWrittenCorrection}
            onReportCorrection={applyReportCorrection}
            activeSessionToken={activeSessionToken}
            variants={variants}
            testBank={testBank}
            testResponses={testResponses}
            setTestResponses={setTestResponses}
            reportDrafts={reportDrafts}
            outdoor={outdoor}
            outdoorItemsByLevel={outdoorItemsByLevel}
            candidateStatus={candidateStatus}
            centreCode={centreCode}
            examDate={examDate}
            place={place}
            examClosed={examClosed}
            onExamClosed={markExamClosed}
            addAudit={addAudit}
            t={t}
          />
        </AdminDashboardSection>

        <AdminDashboardSection
          id="archive"
          icon={FileSpreadsheet}
          t={t}
          locked={!activeAdminPackageMeta || !rosterConfirmed}
          lockedMessage={!activeAdminPackageMeta ? t("centre.dashboard.lockedNoAdminPackage") : t("centre.dashboard.lockedRosterUnconfirmed")}
          title={t("centre.dashboard.archive.title")}
          description={t("centre.dashboard.archive.description")}
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <CentreArchiveSection
            candidates={candidates}
            examiners={examiners}
            variants={variants}
            testBank={testBank}
            testResponses={testResponses}
            reportDrafts={reportDrafts}
            outdoor={outdoor}
            outdoorNotes={outdoorNotes}
            outdoorItemsByLevel={outdoorItemsByLevel}
            audit={audit}
            centreCode={centreCode}
            examDate={examDate}
            place={place}
            t={t}
          />
        </AdminDashboardSection>
      </div>

      {/* Password gate for reopening sections A–D after the exam has been closed. */}
      {unlockOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2"><Lock className="h-5 w-5 text-emerald-700" /><h3 className="text-lg font-semibold">{t("centre.unlock.title")}</h3></div>
            <p className="mt-2 text-sm text-slate-600">{t("centre.unlock.helper")}</p>
            <input
              type="password"
              autoFocus
              value={unlockValue}
              onChange={(event) => { setUnlockValue(event.target.value); setUnlockError(false); }}
              onKeyDown={(event) => { if (event.key === "Enter") submitUnlock(); }}
              placeholder={t("centre.unlock.placeholder")}
              className="mt-3 w-full rounded-xl border p-2"
            />
            {unlockError && <div className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-2 text-sm text-rose-800">{t("centre.unlock.error")}</div>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button onClick={() => setUnlockOpen(false)} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
              <Button onClick={submitUnlock} className="rounded-2xl bg-emerald-700 text-white hover:bg-emerald-800">{t("centre.unlock.confirm")}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function normalizeCandidateQuestionSnapshot(questions) {
  return Array.isArray(questions)
    ? questions.map((question) => normalizeRuntimeQuestionForUi(question)).filter((question) => question?.id || question?.text)
    : [];
}

function resolveCandidateWrittenSnapshot({ candidate, variants, testBank }) {
  if (!candidate) return { variantCode: "", questions: [] };

  const primary = safeQuestionsForCandidate(testBank, candidate, variants);
  if (primary.questions.length) {
    return {
      variantCode: primary.variantCode,
      questions: normalizeCandidateQuestionSnapshot(primary.questions),
    };
  }

  const level = candidateLevel(candidate);
  const fallbackCode = level === "Consulting" ? "CONSULTING_ADMIN_PACKAGE" : "PRACTICING_ADMIN_PACKAGE";
  const fallbackQuestions = questionsForVariantStrict(testBank, fallbackCode);

  return {
    variantCode: fallbackCode,
    questions: normalizeCandidateQuestionSnapshot(fallbackQuestions),
  };
}

function normalizeOfflineCandidatePackageForImport(data, testBank = {}) {
  if (!data || typeof data !== "object") return data;

  const packageQuestions = normalizeCandidateQuestionSnapshot(
    Array.isArray(data.testQuestionsSnapshot)
      ? data.testQuestionsSnapshot
      : Array.isArray(data.testBankSnapshot)
        ? data.testBankSnapshot
        : []
  );

  const fallbackQuestions = packageQuestions.length
    ? []
    : normalizeCandidateQuestionSnapshot(questionsForVariantStrict(testBank, data.variantCode));
  const snapshot = packageQuestions.length ? packageQuestions : fallbackQuestions;

  return {
    ...data,
    testQuestionsSnapshot: snapshot,
    testBankSnapshot: snapshot.length ? snapshot : normalizeCandidateQuestionSnapshot(data.testBankSnapshot),
    snapshotSource: packageQuestions.length
      ? (data.snapshotSource || "candidate-package")
      : snapshot.length
        ? "examiner-current-test-bank-fallback"
        : (data.snapshotSource || "missing"),
  };
}

function createOfflineCandidatePackage({ candidate, variantCode, testBankSnapshot = [], testQuestionsSnapshot = [], responses, reportDraft, outdoorPreparationDraft = null, activeAdminPackageMeta = null, outdoorItemsByLevel = {}, includePhotoData = false }) {
  const normalizedTestQuestionsSnapshot = normalizeCandidateQuestionSnapshot(testQuestionsSnapshot);
  const normalizedTestBankSnapshot = normalizeCandidateQuestionSnapshot(testBankSnapshot);
  const finalQuestionSnapshot = normalizedTestQuestionsSnapshot.length ? normalizedTestQuestionsSnapshot : normalizedTestBankSnapshot;
  const filteredReportDraft = candidate.level === "Consulting"
    ? REPORT_TREES.reduce((acc, treeName) => {
        const sourceTree = reportDraft?.[treeName] ?? createReportDraft()[treeName];
        return {
          ...acc,
          [treeName]: {
            finalSections: sourceTree.finalSections ?? {},
            photos: (sourceTree.photos ?? [])
              .filter((photo) => photo.useInReport ?? true)
              .map((photo) => ({
                id: photo.id,
                name: photo.name,
                type: photo.type,
                size: photo.size,
                ...(includePhotoData ? { dataUrl: photo.dataUrl } : {}),
                description: photo.description ?? "",
                useInReport: true,
                createdAt: photo.createdAt ?? photo.capturedAt ?? null,
              })),
          },
        };
      }, {})
    : null;

  return {
    kind: "vetbara.offlineCandidatePackage.v1",
    candidateId: candidate.id,
    candidateName: candidate.name,
    level: candidate.level,
    variantCode,
    testBankSnapshot: finalQuestionSnapshot,
    testQuestionsSnapshot: finalQuestionSnapshot,
    snapshotRequired: true,
    snapshotQuestionCount: finalQuestionSnapshot.length,
    responses: responses ?? {},
    reportDraft: filteredReportDraft,
    outdoorPreparationDraft,
    activeAdminPackage: activeAdminPackageMeta,
    outdoorItemsByLevelSnapshot: outdoorItemsByLevel?.[candidate.level] ? { [candidate.level]: outdoorItemsByLevel[candidate.level] } : {},
    createdAt: new Date().toISOString(),
  };
}


function candidateFieldPackageStorageKey(candidate) {
  // Scoped by exam (see scopedCacheKey's own comment): candidate ids like "C-001" repeat across
  // exams on the same shared tablet, so without the exam suffix a candidate could load the field
  // map package cached from a PREVIOUS exam and see that exam's trees/location as "the" map.
  return scopedCacheKey(`vetbara.candidateFieldPackage.${candidate?.id || "candidate"}.${candidateLevel(candidate)}`);
}

function candidateTreeAPreparationStorageKey(candidate) {
  return scopedCacheKey(`vetbara.candidateTreeAPreparation.${candidate?.id || "candidate"}.${candidateLevel(candidate)}`);
}

function normalizeCandidateTreePreparationDraft(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      notesByTree: value.notesByTree && typeof value.notesByTree === "object" ? value.notesByTree : {},
      sketchesByTree: value.sketchesByTree && typeof value.sketchesByTree === "object" ? value.sketchesByTree : {},
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { notesByTree: { A: value, "Practicing:A": value, "Consulting:A": value }, sketchesByTree: {} };
  }
  return { notesByTree: {}, sketchesByTree: {} };
}

function candidateTreePreparationNote(preparationDraft, tree) {
  const notes = normalizeCandidateTreePreparationDraft(preparationDraft).notesByTree;
  const key = fieldTreeKey(tree);
  const code = String(tree?.code || "").toUpperCase();
  return notes[key] ?? notes[code] ?? "";
}

function candidateTreePreparationSketch(preparationDraft, tree) {
  const sketches = normalizeCandidateTreePreparationDraft(preparationDraft).sketchesByTree;
  const key = fieldTreeKey(tree);
  const code = String(tree?.code || "").toUpperCase();
  return sketches[key] ?? sketches[code] ?? "";
}

function candidateTreeCharacteristics(tree) {
  const data = tree?.managementData || tree?.practicingTreeAData || tree?.practicingData || tree?.treeData || tree || {};
  const textValue = (...keys) => keys.map((key) => data?.[key] ?? tree?.[key]).find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "-";
  return [
    ["Taxon", textValue("taxon", "species", "treeSpecies")],
    ["Height", textValue("height", "heightM", "treeHeight")],
    ["Stem diameter", textValue("stemDiameter", "stemDiameterCm", "diameter", "dbh")],
    ["Crown spread", textValue("crownSpread", "crownSpreadM", "crownProjection")],
  ];
}


// The Centre saves its field preparation under its OWN subject id (fieldPrepExamId = centreExamId,
// e.g. "Casalgrande_Italy-2026-07-31"), but a candidate/examiner session's resolved scope is the
// exam EVENT id "EXAM-<centreId>-CURRENT" (defaultExamEventId). Recover the centre id from the event
// id so the field package is fetched under the same key section B wrote to.
function centreExamIdFromScope(scope) {
  const match = /^EXAM-(.+)-CURRENT$/.exec(String(scope || ""));
  return match ? match[1] : "";
}

function candidateFieldExamIds() {
  // Order matters: the derived centre id (where the preparation actually lives) is tried first, then
  // the raw scope, then the ARBOR-2026 constants as a last resort. Before this, a candidate's scope
  // was the event id, which never matches the stored preparation, so the fetch 404'd and the
  // Orientation map fell back to the ARBOR site instead of showing the Centre's section B map.
  const scope = getActiveExamScope();
  return Array.from(new Set([centreExamIdFromScope(scope), scope, CENTRE_QR_ID, CENTRE_ACCESS_TOKEN].filter(Boolean)));
}

function normalizeCandidateFieldPackage(data, candidate) {
  const payload = data?.fieldPackage || data?.package || data;
  if (!payload || typeof payload !== "object") return null;
  const level = candidateLevel(candidate);
  const trees = normalizeFieldTabletTrees(payload, level).filter((tree) => normalizeFieldLevel(tree.level) === level);
  return {
    ...payload,
    level: level.toUpperCase(),
    trees,
    examCenter: payload.examCenter || {},
    loadedAt: new Date().toISOString(),
  };
}

async function fetchCandidateFieldPackage(candidate) {
  const level = candidateLevel(candidate).toLowerCase();
  let lastError = null;
  for (const examId of candidateFieldExamIds()) {
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(safeExamId(examId))}/field-package/${level}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      const normalized = normalizeCandidateFieldPackage(data, candidate);
      if (normalized) return { packageData: normalized, examId };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Field package is not available.");
}

function CandidateView({ candidates, examiners, harmonogramSettings, loggedCandidate, confirmed, loginCandidate, logoutCandidate, confirmCandidate, unconfirmCandidate, sections, sectionStatus, sectionTimes, sectionTone, openSection, activeSection, setActiveSection, testResponses, updateTest, submitTest, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, updateReportPhoto, moveReportPhoto, submitReport, resendCandidateData, variants, testBank, activeAdminPackageMeta, outdoorItemsByLevel, qrFor, setScannerMode, setScannerReentry, activeSessionToken, sendSyncEvent, localEventId, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  // "" | "sending" | "done" — the button is white until a transfer succeeds, then green, and goes
  // back to white on the next change so it always reflects the *current* state, never a stale one.
  const [candidateSendState, setCandidateSendState] = useState("");

  // Offers the simplified mobile report-capture screen to a Consulting candidate who opened their
  // ordinary access link on a small screen - a nudge, not a redirect: same standard QR/link works
  // on any device, this just suggests the better fit rather than forcing it (see the "device-
  // responsive vs. a second QR" discussion this was built from). Dismissal is remembered only for
  // this browser tab's session, not forever, so it resets on the next exam day.
  const mobileFieldBannerKey = loggedCandidate ? `vetbara-mobile-field-banner-dismissed-${loggedCandidate.id}` : "";
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  const [mobileFieldBannerDismissed, setMobileFieldBannerDismissed] = useState(() => {
    try { return mobileFieldBannerKey ? sessionStorage.getItem(mobileFieldBannerKey) === "1" : false; } catch { return false; }
  });
  const [showFieldCaptureOverlay, setShowFieldCaptureOverlay] = useState(false);
  useEffect(() => {
    function onResize() { setViewportWidth(window.innerWidth); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  function dismissMobileFieldBanner() {
    setMobileFieldBannerDismissed(true);
    try { if (mobileFieldBannerKey) sessionStorage.setItem(mobileFieldBannerKey, "1"); } catch { /* best-effort */ }
  }
  const showMobileFieldBanner = Boolean(
    loggedCandidate && activeSessionToken && candidateLevel(loggedCandidate) === "Consulting" &&
    viewportWidth < 700 && !mobileFieldBannerDismissed && activeSection === "landing"
  );

  async function sendCandidateDataToServer() {
    setCandidateSendState("sending");
    try {
      const ok = await resendCandidateData?.();
      setCandidateSendState(ok === false ? "" : "done");
    } catch {
      setCandidateSendState("");
    }
  }

  // Any change to the candidate's own answers or report invalidates the green confirmation.
  useEffect(() => { setCandidateSendState(""); }, [testResponses, reportDrafts]);

  // Leaving mid-exam (tab close, browser Back) can strand work that has not reached the server yet.
  // The browser only allows a generic confirmation dialog here — the wording is the browser's, not
  // ours — but it does force a deliberate second decision instead of a single stray click.
  useEffect(() => {
    if (!loggedCandidate) return undefined;
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = t("candidate.leaveWarning"); return event.returnValue; };
    const onPopState = () => {
      if (window.confirm(t("candidate.leaveWarning"))) return;
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [loggedCandidate, t]);

  function returnToIdentity() {
    setActiveSection("landing");
    unconfirmCandidate?.();
  }

  const resolvedWrittenSnapshot = loggedCandidate ? resolveCandidateWrittenSnapshot({ candidate: loggedCandidate, variants, testBank }) : { variantCode: "", questions: [] };
  const selectedVariantCode = resolvedWrittenSnapshot.variantCode || (loggedCandidate ? variants[loggedCandidate.level] : "");
  const candidateQuestionSnapshot = resolvedWrittenSnapshot.questions;
  const candidateSectionClosed = (key) => sectionStatus?.[key] === "closed";
  const [lanPackageStatus, setLanPackageStatus] = useState("");
  const [lanPackageSaving, setLanPackageSaving] = useState(false);
  const [lanPackageSaved, setLanPackageSaved] = useState(false);
  const [candidateFieldPackage, setCandidateFieldPackage] = useState(() => loggedCandidate ? readJsonLocalStorage(candidateFieldPackageStorageKey(loggedCandidate), null) : null);
  const [candidateFieldStatus, setCandidateFieldStatus] = useState("");
  const [candidateFieldError, setCandidateFieldError] = useState("");
  const [candidateTreeAPreparation, setCandidateTreeAPreparation] = useState(() => loggedCandidate ? normalizeCandidateTreePreparationDraft(readJsonLocalStorage(candidateTreeAPreparationStorageKey(loggedCandidate), null)) : normalizeCandidateTreePreparationDraft(null));
  const preparationSyncTimersRef = useRef({});
  // The preparation used to live only in this browser's localStorage, so the Centre never saw it
  // and clearing the browser lost it. Both writers now also emit a sync event; the note is debounced
  // because it fires on every keystroke. sendSyncEvent/localEventId are passed down from
  // VetBaraPrototype (its own closures) rather than referenced directly - this component used to
  // call them as if they were in scope here, which crashed with "Can't find variable: sendSyncEvent"
  // the first time a candidate actually opened Tree preparation.
  function syncCandidatePreparation(key, { note, sketch }) {
    if (!loggedCandidate) return;
    const updatedAt = new Date().toISOString();
    sendSyncEvent({
      clientEventId: localEventId(`candidate-preparation-saved-${loggedCandidate.id}-${key}`),
      type: "candidate_preparation.saved",
      entityType: "candidate_preparation",
      entityId: `${loggedCandidate.id}:preparation:${key}`,
      candidateId: loggedCandidate.id,
      payload: { candidateId: loggedCandidate.id, sectionKey: "preparation", treeKey: key, note, sketch, updatedAt },
      createdAt: updatedAt,
    });
  }

  function updateCandidateTreePreparationNote(tree, value) {
    if (!tree) return;
    const key = fieldTreeKey(tree);
    setCandidateTreeAPreparation((previous) => {
      const normalized = normalizeCandidateTreePreparationDraft(previous);
      const next = { ...normalized, notesByTree: { ...(normalized.notesByTree || {}), [key]: value } };
      if (loggedCandidate) writeJsonLocalStorage(candidateTreeAPreparationStorageKey(loggedCandidate), next);
      window.clearTimeout(preparationSyncTimersRef.current[key]);
      preparationSyncTimersRef.current[key] = window.setTimeout(() => {
        syncCandidatePreparation(key, { note: value, sketch: next.sketchesByTree?.[key] ?? "" });
      }, 1500);
      return next;
    });
  }

  async function updateCandidateTreePreparationSketch(tree, rawDataUrl) {
    if (!tree) return;
    const key = fieldTreeKey(tree);
    const dataUrl = rawDataUrl ? await compressImageToDataUrl(rawDataUrl, { maxBytes: 150_000, maxDim: 1400 }) : rawDataUrl;
    setCandidateTreeAPreparation((previous) => {
      const normalized = normalizeCandidateTreePreparationDraft(previous);
      const sketches = { ...(normalized.sketchesByTree || {}) };
      if (dataUrl) sketches[key] = dataUrl; else delete sketches[key];
      const next = { ...normalized, sketchesByTree: sketches };
      if (loggedCandidate) writeJsonLocalStorage(candidateTreeAPreparationStorageKey(loggedCandidate), next);
      // A sketch is one deliberate save, so it goes straight out rather than being debounced.
      syncCandidatePreparation(key, { note: next.notesByTree?.[key] ?? "", sketch: dataUrl || "" });
      return next;
    });
  }

  const canShowOfflinePackage = Boolean(
    loggedCandidate &&
    candidateSectionClosed("test") &&
    (loggedCandidate.level !== "Consulting" || candidateSectionClosed("report"))
  );
  const offlinePackagePayload = canShowOfflinePackage
    ? JSON.stringify(createOfflineCandidatePackage({
        candidate: loggedCandidate,
        variantCode: selectedVariantCode,
        testBankSnapshot: candidateQuestionSnapshot,
        testQuestionsSnapshot: candidateQuestionSnapshot,
        responses: testResponses[loggedCandidate.id] ?? {},
        reportDraft: reportDrafts[loggedCandidate.id] ?? createReportDraft(),
        outdoorPreparationDraft: { treeNotes: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).notesByTree, sketchesByTree: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).sketchesByTree, fieldPackageSnapshot: candidateFieldPackage },
        activeAdminPackageMeta,
        outdoorItemsByLevel,
        includePhotoData: false,
      }))
    : "";
  const [testIntroAccepted, setTestIntroAccepted] = useState({});
  const testIntroKey = loggedCandidate ? `${loggedCandidate.id}:${candidateLevel(loggedCandidate)}:${selectedVariantCode || "default"}` : "";
  const acceptTestIntro = () => {
    if (!testIntroKey) return;
    setTestIntroAccepted((previous) => ({ ...previous, [testIntroKey]: true }));
  };


  useEffect(() => {
    if (!loggedCandidate) return;
    setCandidateFieldPackage(readJsonLocalStorage(candidateFieldPackageStorageKey(loggedCandidate), null));
    setCandidateTreeAPreparation(normalizeCandidateTreePreparationDraft(readJsonLocalStorage(candidateTreeAPreparationStorageKey(loggedCandidate), null)));
    setCandidateFieldStatus("");
    setCandidateFieldError("");
  }, [loggedCandidate?.id, loggedCandidate?.level]);

  useEffect(() => {
    if (!loggedCandidate || !confirmed) return;
    let cancelled = false;
    const existing = readJsonLocalStorage(candidateFieldPackageStorageKey(loggedCandidate), null);
    if (existing) {
      setCandidateFieldPackage(existing);
      setCandidateFieldStatus("Field map package is stored on this tablet.");
      return;
    }
    setCandidateFieldStatus("Downloading field map package to this tablet...");
    setCandidateFieldError("");
    fetchCandidateFieldPackage(loggedCandidate)
      .then(({ packageData }) => {
        if (cancelled) return;
        writeJsonLocalStorage(candidateFieldPackageStorageKey(loggedCandidate), packageData);
        setCandidateFieldPackage(packageData);
        setCandidateFieldStatus("Field map package downloaded to this tablet.");
      })
      .catch((error) => {
        if (cancelled) return;
        setCandidateFieldPackage(null);
        setCandidateFieldError(`Field map package could not be downloaded: ${error.message || "unknown error"}. Ask the certification centre to save field preparation for this exam.`);
        setCandidateFieldStatus("");
      });
    return () => { cancelled = true; };
  }, [loggedCandidate?.id, loggedCandidate?.level, confirmed]);

  function buildFullOfflineCandidatePackage() {
    if (!loggedCandidate) return null;

    return createOfflineCandidatePackage({
      candidate: loggedCandidate,
      variantCode: selectedVariantCode,
      testBankSnapshot: candidateQuestionSnapshot,
      testQuestionsSnapshot: candidateQuestionSnapshot,
      responses: testResponses[loggedCandidate.id] ?? {},
      reportDraft: reportDrafts[loggedCandidate.id] ?? createReportDraft(),
      outdoorPreparationDraft: { treeNotes: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).notesByTree, sketchesByTree: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).sketchesByTree, fieldPackageSnapshot: candidateFieldPackage },
      activeAdminPackageMeta,
      outdoorItemsByLevel,
      includePhotoData: true,
    });
  }

  function downloadOfflineCandidatePackage() {
    const fullPackage = buildFullOfflineCandidatePackage();
    if (!fullPackage) return;

    const blob = new Blob([JSON.stringify(fullPackage, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vetbara-offline-package-${loggedCandidate.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveOfflineCandidatePackageToLan() {
    const fullPackage = buildFullOfflineCandidatePackage();
    if (!fullPackage) return;

    if (!Array.isArray(fullPackage.testQuestionsSnapshot) || !fullPackage.testQuestionsSnapshot.length) {
      setLanPackageStatus(t("candidate.offlineHandoff.missingSnapshot"));
      return;
    }

    setLanPackageSaving(true);
    setLanPackageSaved(false);
    setLanPackageStatus(t("candidate.offlineHandoff.saving"));

    try {
      const response = await fetch("/api/local-exchange/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullPackage),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      setLanPackageSaved(true);
      setLanPackageStatus(tf("candidate.offlineHandoff.savedStatus", { packageId: result.packageId }));
    } catch (error) {
      console.error("LAN package save failed", error);
      setLanPackageStatus(tf("candidate.offlineHandoff.saveFailed", { message: error.message || "unknown error" }));
    } finally {
      setLanPackageSaving(false);
    }
  }


  if (loggedCandidate && (activeSection === "field-orientation" || activeSection === "field-trees")) {
    return <CandidateFieldResourcesSection candidate={loggedCandidate} fieldPackage={candidateFieldPackage} fieldStatus={candidateFieldStatus} fieldError={candidateFieldError} preparationDraft={candidateTreeAPreparation} updatePreparationNote={updateCandidateTreePreparationNote} updatePreparationSketch={updateCandidateTreePreparationSketch} setActiveSection={setActiveSection} mode={activeSection === "field-trees" ? "trees" : "orientation"} t={t} />;
  }

  if (loggedCandidate && showFieldCaptureOverlay && activeSessionToken) {
    return (
      <ConsultingFieldCapture
        sessionToken={activeSessionToken}
        candidateId={loggedCandidate.id}
        candidateName={loggedCandidate.name}
        t={t}
        onClose={() => setShowFieldCaptureOverlay(false)}
      />
    );
  }

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={QrCodeIcon} title={t("candidate.view.title")} subtitle={t("candidate.view.subtitle")} /><CandidateQuickHelp t={t} /><div className="grid gap-4 lg:grid-cols-3">{!loggedCandidate && <div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{t("candidate.qrAccess.title")}</h3><Button onClick={() => setScannerMode("Candidate")} variant="outline" className="rounded-2xl">{t("common.scanQr")}</Button></div><p className="mt-3 text-sm text-slate-600">{t("candidate.qrAccess.helper")}</p></div>}<div className={`rounded-2xl border bg-white p-4 ${loggedCandidate ? "lg:col-span-3" : "lg:col-span-2"}`}>{!loggedCandidate ? <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{t("candidate.empty")}</div> : <div className="grid gap-4"><div className="rounded-2xl bg-slate-100 p-4"><div className="flex flex-wrap gap-2"><StatusPill tone="good">{t("common.loggedIn")}</StatusPill><StatusPill>{loggedCandidate.level}</StatusPill>{!isInternalVariantCode(selectedVariantCode) && <StatusPill>{selectedVariantCode}</StatusPill>}</div><div className="mt-2 font-semibold">{loggedCandidate.name}</div><div className="mt-3 flex flex-wrap gap-2"><Button onClick={logoutCandidate} variant="outline" className="rounded-2xl">{t("common.logout")}</Button>{activeSection === "report" && <Button onClick={returnToIdentity} variant="outline" className="rounded-2xl">{t("common.back")}</Button>}<Button onClick={sendCandidateDataToServer} variant="outline" className={`rounded-2xl ${candidateSendState === "done" ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}`}>{candidateSendState === "sending" ? t("candidate.sendToServer.sending") : candidateSendState === "done" ? t("candidate.sendToServer.done") : t("candidate.sendToServer")}</Button></div></div>{showMobileFieldBanner && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><p className="min-w-0 flex-1 text-sm text-emerald-950">{t("consultingField.bannerText")}</p><button type="button" onClick={dismissMobileFieldBanner} aria-label={t("common.close")} className="shrink-0 rounded-full p-1 text-lg leading-none text-emerald-700 hover:bg-emerald-100">×</button></div><div className="mt-3"><Button onClick={() => setShowFieldCaptureOverlay(true)} className="rounded-2xl">{t("consultingField.bannerSwitch")}</Button></div></div>}{activeSection === "landing" && <CandidateLanding candidate={loggedCandidate} candidates={candidates} examiners={examiners} harmonogramSettings={harmonogramSettings} confirmed={confirmed} confirmCandidate={confirmCandidate} logoutCandidate={logoutCandidate} setScannerMode={setScannerMode} setScannerReentry={setScannerReentry} sections={sections} status={sectionStatus} times={sectionTimes} tone={sectionTone} openSection={openSection} t={t} />}{activeSection === "test" && <TestSection candidate={loggedCandidate} selectedVariantCode={selectedVariantCode} testBank={testBank} responses={testResponses[loggedCandidate.id] ?? {}} updateTest={updateTest} submitTest={submitTest} setActiveSection={setActiveSection} introAccepted={Boolean(testIntroAccepted[testIntroKey])} acceptIntro={acceptTestIntro} openedAt={sectionTimes?.test?.openedAtIso || sectionTimes?.test?.openedAt || ""} t={t} />}{activeSection === "report" && loggedCandidate.level === "Consulting" && <ReportSection candidate={loggedCandidate} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} updateReportPhoto={updateReportPhoto} moveReportPhoto={moveReportPhoto} submitReport={submitReport} t={t} />}</div>}</div></div></CardContent></Card>;
}

// title's default is never actually shown: every current caller passes showHeader={false},
// which is the only place title renders — kept empty rather than a hardcoded-language default.
function FieldMapTiles({ mapLayer, mapZoom, mapCenter, markers = [], gpsPosition, heightClass = "h-[430px]", allowPan = true, minZoom = 17, maxZoom = 20, title = "", showHeader = true, onLocate = null, gpsActive = false }) {
  const [center, setCenter] = useState(mapCenter);
  const [zoom, setZoom] = useState(mapZoom);
  const gestureRef = useRef({ pointers: new Map(), startCenterWorld: null, startPointer: null, startDistance: 0, startZoom: mapZoom });

  useEffect(() => { setCenter(mapCenter); }, [mapCenter?.lat, mapCenter?.lng]);
  useEffect(() => { setZoom(mapZoom); }, [mapZoom]);

  function clamp(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return minZoom;
    return Math.max(minZoom, Math.min(maxZoom, n));
  }

  function latLngToWorld(latValue, lngValue, z = zoom) {
    const lat = Math.max(Math.min(Number(latValue), 85.05112878), -85.05112878);
    const lng = Number(lngValue);
    const scale = 256 * 2 ** z;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    };
  }

  function worldToLatLng(xValue, yValue, z = zoom) {
    const scale = 256 * 2 ** z;
    const lng = (Number(xValue) / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * Number(yValue)) / scale;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return { lat, lng };
  }

  function tileUrl(x, y, z = zoom) {
    if (mapLayer === "osm") return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    if (mapLayer === "esri") return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    return `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
  }

  function tiles() {
    const centerWorld = latLngToWorld(center.lat, center.lng);
    const centerTileX = Math.floor(centerWorld.x / 256);
    const centerTileY = Math.floor(centerWorld.y / 256);
    const offsetX = centerWorld.x - centerTileX * 256;
    const offsetY = centerWorld.y - centerTileY * 256;
    const result = [];
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        result.push({ key: `${mapLayer}-${zoom}-${x}-${y}`, src: tileUrl(x, y, zoom), style: { left: `calc(50% + ${dx * 256 - offsetX}px)`, top: `calc(50% + ${dy * 256 - offsetY}px)` } });
      }
    }
    return result;
  }

  function pointStyle(latValue, lngValue) {
    const lat = Number(latValue);
    const lng = Number(lngValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { left: "50%", top: "50%" };
    const centerWorld = latLngToWorld(center.lat, center.lng, zoom);
    const pointWorld = latLngToWorld(lat, lng, zoom);
    return { left: `calc(50% + ${pointWorld.x - centerWorld.x}px)`, top: `calc(50% + ${pointWorld.y - centerWorld.y}px)` };
  }

  function pointerDistance(pointers) {
    const values = Array.from(pointers.values());
    if (values.length < 2) return 0;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  }

  function pointerDown(event) {
    if (!allowPan) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointers = gestureRef.current.pointers;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gestureRef.current.startCenterWorld = latLngToWorld(center.lat, center.lng, zoom);
    gestureRef.current.startPointer = { x: event.clientX, y: event.clientY };
    gestureRef.current.startDistance = pointerDistance(pointers);
    gestureRef.current.startZoom = zoom;
  }

  function pointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size >= 2) {
      const distance = pointerDistance(gesture.pointers);
      if (distance > 0 && gesture.startDistance > 0) setZoom(clamp(gesture.startZoom + Math.log2(distance / gesture.startDistance)));
      return;
    }
    if (!allowPan || !gesture.startCenterWorld || !gesture.startPointer) return;
    const dx = event.clientX - gesture.startPointer.x;
    const dy = event.clientY - gesture.startPointer.y;
    setCenter(worldToLatLng(gesture.startCenterWorld.x - dx, gesture.startCenterWorld.y - dy, zoom));
  }

  function pointerEnd(event) {
    const gesture = gestureRef.current;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size === 0) {
      gesture.startCenterWorld = null;
      gesture.startPointer = null;
      gesture.startDistance = 0;
      gesture.startZoom = zoom;
    }
  }

  function wheel(event) {
    event.preventDefault();
    setZoom((current) => clamp(current + (event.deltaY > 0 ? -1 : 1)));
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border bg-slate-900 ${heightClass}`}>
      {showHeader && <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b bg-white p-2">
        <h4 className="font-semibold">{title}</h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setZoom((current) => clamp(current + 1))} className="rounded-xl border bg-white px-3 py-1 text-sm font-bold">+</button>
          <button type="button" onClick={() => setZoom((current) => clamp(current - 1))} className="rounded-xl border bg-white px-3 py-1 text-sm font-bold">−</button>
        </div>
      </div>}
      <div onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onWheel={wheel} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-slate-200">
        {tiles().map((tile) => <img key={tile.key} src={tile.src} alt="" draggable={false} className="absolute h-[256px] w-[256px] select-none" style={tile.style} />)}
        <div className="absolute left-3 top-3 z-30 flex flex-col items-center gap-2">
          <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">N ▲</div>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setZoom((current) => clamp(current + 1))} aria-label="Zoom in" title="Zoom in" className="flex h-10 w-10 items-center justify-center rounded-full border bg-white/95 text-lg font-bold text-slate-700 shadow-sm active:scale-95">+</button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setZoom((current) => clamp(current - 1))} aria-label="Zoom out" title="Zoom out" className="flex h-10 w-10 items-center justify-center rounded-full border bg-white/95 text-lg font-bold text-slate-700 shadow-sm active:scale-95">−</button>
          {onLocate && (
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onLocate} aria-label="GPS" title="GPS" aria-pressed={gpsActive} className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-sm active:scale-95 ${gpsActive ? "border-blue-600 bg-blue-600 text-white" : "bg-white/95 text-slate-700"}`}><MapPin className="h-4 w-4" /></button>
          )}
        </div>
        {markers.map((marker) => (
          <div key={marker.key} className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${marker.kind === "center" ? "text-rose-600" : "text-slate-950"}`} style={pointStyle(marker.latitude, marker.longitude)}>
            <div className={`rounded-full px-3 py-2 text-xs font-black shadow-lg ring-4 ring-white ${marker.kind === "center" ? "bg-rose-600 text-white" : marker.checked ? "bg-white text-slate-950 ring-emerald-600" : "bg-white text-slate-950"}`}>{marker.label}</div>
            <div className={`mx-auto h-7 w-1 ${marker.kind === "center" ? "bg-rose-600" : marker.checked ? "bg-emerald-600" : "bg-white"}`} />
            <div className={`mx-auto h-4 w-4 rounded-full border-4 ${marker.kind === "center" ? "border-rose-600 bg-white" : marker.checked ? "border-emerald-600 bg-white" : "border-white bg-slate-500"}`} />
          </div>
        ))}
        {gpsPosition && Number.isFinite(Number(gpsPosition.lat)) && Number.isFinite(Number(gpsPosition.lng)) && (
          <div className="absolute z-30 -translate-x-1/2 -translate-y-1/2" style={pointStyle(gpsPosition.lat, gpsPosition.lng)}>
            <div className="h-5 w-5 rounded-full border-4 border-white bg-blue-600 shadow-lg" />
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateFieldResourcesSection({ candidate, fieldPackage, fieldStatus, fieldError, preparationDraft, updatePreparationNote, updatePreparationSketch, setActiveSection, mode = "orientation", t }) {
  const [mapLayer, setMapLayer] = useState(mode === "trees" ? "esri" : "osm");
  const [gpsPosition, setGpsPosition] = useState(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [gpsStatus, setGpsStatus] = useState("");
  const [selectedTreeCode, setSelectedTreeCode] = useState("A");
  const level = candidateLevel(candidate);
  const trees = fieldPackage ? normalizeFieldTabletTrees(fieldPackage, level).filter((tree) => normalizeFieldLevel(tree.level) === level) : [];
  const orderedTrees = FIELD_TREE_CODES.map((code) => trees.find((tree) => String(tree.code || "").toUpperCase() === code)).filter(Boolean);
  const selectedTree = orderedTrees.find((tree) => String(tree.code || "").toUpperCase() === selectedTreeCode) || orderedTrees[0] || null;
  const center = fieldPackage?.examCenter || {};
  const centerPoint = { lat: Number(center.latitude ?? center.lat), lng: Number(center.longitude ?? center.lng) };
  const defaultCenter = {
    lat: Number.isFinite(centerPoint.lat) ? centerPoint.lat : (Number(orderedTrees[0]?.latitude) || 49.405888),
    lng: Number.isFinite(centerPoint.lng) ? centerPoint.lng : (Number(orderedTrees[0]?.longitude) || 15.128912),
  };
  const orientationMarkers = [
    ...(Number.isFinite(centerPoint.lat) && Number.isFinite(centerPoint.lng) ? [{ key: "center", kind: "center", label: "Exam centre", latitude: centerPoint.lat, longitude: centerPoint.lng }] : []),
    ...orderedTrees.map((tree) => ({ key: fieldTreeKey(tree), kind: "tree", label: fieldTreeLabel(tree.level, tree.code), latitude: tree.latitude, longitude: tree.longitude })),
  ];
  const selectedTreeCenter = selectedTree && Number.isFinite(Number(selectedTree.latitude)) && Number.isFinite(Number(selectedTree.longitude)) ? { lat: Number(selectedTree.latitude), lng: Number(selectedTree.longitude) } : defaultCenter;
  const selectedTreeMarkers = selectedTree ? [{ key: fieldTreeKey(selectedTree), kind: "tree", label: fieldTreeLabel(selectedTree.level, selectedTree.code), latitude: selectedTree.latitude, longitude: selectedTree.longitude }] : [];

  function locate() {
    setGpsStatus("");
    if (!navigator.geolocation) {
      setGpsStatus("GPS is not available in this browser.");
      return;
    }
    setGpsStatus("Requesting GPS permission...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsPosition({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
        setGpsStatus(`GPS loaded${Number.isFinite(position.coords.accuracy) ? ` · accuracy approx. ${Math.round(position.coords.accuracy)} m` : ""}.`);
      },
      (error) => setGpsStatus(`GPS could not be loaded: ${error.message || "permission was denied"}.`),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b bg-white/95 p-3 shadow-sm">
      <Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">{t("common.back")}</Button>
      <div className="ml-1 mr-3 text-lg font-bold">{mode === "trees" ? t("candidateSections.trees.title") : t("candidateSections.orientation.title")}</div>
      <select value={mapLayer} onChange={(event) => setMapLayer(event.target.value)} className="rounded-2xl border bg-white px-3 py-2 text-sm font-medium text-slate-700">
        <option value="cuzk">{t("map.layer.cuzk")}</option>
        <option value="esri">{t("map.layer.esri")}</option>
        <option value="osm">{t("map.layer.osm")}</option>
      </select>
      {gpsStatus && <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">{gpsStatus}</span>}
    </div>
  );

  if (!fieldPackage) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        {toolbar}
        <div className="p-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{fieldError || t("candidateField.packageUnavailable")}</div>
        </div>
      </div>
    );
  }

  if (mode === "orientation") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {toolbar}
        <div className="min-h-0 flex-1">
          <FieldMapTiles mapLayer={mapLayer} mapZoom={18} mapCenter={defaultCenter} markers={orientationMarkers} gpsPosition={gpsPosition} minZoom={17} maxZoom={20} heightClass="h-full" title={t("candidateSections.orientation.title")} showHeader={false} onLocate={locate} gpsActive={Boolean(gpsPosition)} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <div className="grid h-full gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="h-64 border-b bg-slate-100 lg:h-full lg:border-b-0 lg:border-r">
            <FieldMapTiles mapLayer={mapLayer} mapZoom={20} mapCenter={selectedTreeCenter} markers={selectedTreeMarkers} gpsPosition={gpsPosition} allowPan={false} heightClass="h-full" minZoom={17} maxZoom={21} title={t("candidateField.treePreparation")} showHeader={false} onLocate={locate} gpsActive={Boolean(gpsPosition)} />
          </div>
          <div className="bg-white p-4 lg:min-h-0 lg:overflow-y-auto">
          <div className="mb-4 flex flex-wrap gap-2">
            {FIELD_TREE_CODES.map((code) => {
              const available = orderedTrees.some((tree) => String(tree.code || "").toUpperCase() === code);
              return <Button key={code} onClick={() => setSelectedTreeCode(code)} disabled={!available} variant={selectedTreeCode === code ? "default" : "outline"} className="rounded-2xl">{code}</Button>;
            })}
          </div>
          {selectedTree ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("candidateField.selectedTree")}</div>
                <h3 className="text-2xl font-bold">{fieldTreeLabel(selectedTree.level, selectedTree.code)} · {selectedTree.name || `${t("fieldPrep.tree")} ${selectedTree.code}`}</h3>
                <div className="mt-1 font-mono text-xs text-slate-500">{formatFieldCoordinates({ lat: selectedTree.latitude, lng: selectedTree.longitude })}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {candidateTreeCharacteristics(selectedTree).map(([label, value]) => (
                  <div key={label} className="rounded-2xl border bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-900">{String(value || "-")}</div>
                  </div>
                ))}
              </div>
              <label className="block">
                <span className="text-sm font-semibold">{t("candidateField.candidateNotes")}</span>
                <textarea value={candidateTreePreparationNote(preparationDraft, selectedTree)} onChange={(event) => updatePreparationNote(selectedTree, event.target.value)} rows={6} placeholder={t("candidateField.candidateNotesPlaceholder")} className="mt-2 w-full rounded-2xl border bg-white p-4 text-base leading-relaxed shadow-inner" />
              </label>
              {updatePreparationSketch && (() => {
                const sketch = candidateTreePreparationSketch(preparationDraft, selectedTree);
                return (
                  <div>
                    <span className="text-sm font-semibold">{t("candidateField.sketch")}</span>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {sketch && <img src={sketch} alt="" className="h-20 w-32 rounded-lg border object-cover" />}
                      <Button type="button" onClick={() => setSketchOpen(true)} variant="outline" className="rounded-2xl"><Pencil className="mr-1 h-4 w-4" />{sketch ? t("candidateField.editSketch") : t("candidateField.addSketch")}</Button>
                      {sketch && <Button type="button" onClick={() => updatePreparationSketch(selectedTree, "")} variant="outline" className="rounded-2xl">{t("candidateField.removeSketch")}</Button>}
                    </div>
                    {sketchOpen && (
                      <HandwritingPad
                        onClose={() => setSketchOpen(false)}
                        onSave={(dataUrl) => { updatePreparationSketch(selectedTree, dataUrl); setSketchOpen(false); }}
                        existingImage={sketch || null}
                        title={`${t("candidateField.sketch")} · ${fieldTreeLabel(selectedTree.level, selectedTree.code)}`}
                        helperText={t("candidateField.sketchHelper")}
                        t={t}
                        Button={Button}
                        CloseIcon={X}
                        EraserIcon={Eraser}
                        UndoIcon={Undo}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("candidateField.noTreesAvailable")}</div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}


// Small color-coded read-out of the candidate's own slice of the Centre's exam-schedule
// ("harmonogram") proposal - same deterministic pairing/sequencing function the Centre's own
// Schedule tab uses (CentreScheduleBuilder), so it always matches what the Centre would see for
// this candidate without needing its own synced copy of drag-adjusted block positions.
function CandidateScheduleWidget({ candidate, candidates, examiners, settings, t }) {
  const schedule = useMemo(
    () => (settings && candidates?.length ? buildDefaultHarmonogramSchedule(candidates, examiners || [], settings) : null),
    [candidates, examiners, settings],
  );
  const myGroup = schedule?.groups.find((group) => group.members.some((member) => member.id === candidate.id));
  if (!schedule || !myGroup) return null;
  const myBlocks = [schedule.welcome, ...myGroup.blocks];

  return (
    <div className="mt-3 rounded-2xl border bg-white p-3">
      <h4 className="text-sm font-semibold">{t("candidate.mySchedule.title")}</h4>
      <p className="mt-1 text-xs text-slate-500">{t("candidate.mySchedule.helper")}</p>
      <div className="mt-2 space-y-1.5">
        {myBlocks.map((block) => (
          <div key={block.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs" style={{ background: harmonogramActivityColor(block.activity) }}>
            <span className="font-semibold">{harmonogramTimeLabel(block.start)}</span>
            <span className="flex-1 px-2">{t(`harmonogram.activity.${block.activity}`)}</span>
            <span className="text-slate-700">{block.duration ? `${block.duration} min` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidateLanding({ candidate, candidates, examiners, harmonogramSettings, confirmed, confirmCandidate, logoutCandidate, setScannerMode, setScannerReentry, sections, status, times, tone, openSection, t }) {
  const hasWrittenTest = sections.some((section) => section.key === "test");
  const hasReportSection = sections.some((section) => section.key === "report");
  const readinessItems = [
    [t("candidate.readiness.identity"), confirmed],
    [t("candidate.readiness.writtenTest"), hasWrittenTest],
    ...(candidate.level === "Consulting" ? [[t("candidate.readiness.report"), hasReportSection]] : []),
  ];

  function sectionHelper(state) {
    if (!confirmed) return t("candidate.section.confirmFirst");
    if (state === "closed") return t("candidate.section.closed");
    if (state === "open") return t("candidate.section.open");
    return t("candidate.section.locked");
  }

  // Ends this device's candidate session and immediately re-opens the full-page scanner - used
  // for a shared/kiosk tablet moving on to the next candidate. Irreversible from this screen's
  // point of view (not-yet-synced local state for this candidate becomes unreachable through the
  // UI), hence the confirm.
  function endCandidateSession() {
    if (!window.confirm(t("candidate.identity.endExamConfirm"))) return;
    logoutCandidate?.();
    setScannerReentry?.(true);
    setScannerMode?.("Candidate");
  }

  return <div className="grid gap-4 lg:grid-cols-3"><div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-1" : ""}`}><div className="mb-3 rounded-xl bg-slate-950 p-4 text-white"><div className="text-xs uppercase tracking-wide text-slate-300">{t("candidate.identity.idLabel")}</div><div className="text-3xl font-bold tracking-tight">{candidate.id}</div></div><h3 className="font-semibold">{t("candidate.identity.detailsTitle")}</h3>{[[t("candidate.identity.name"), candidate.name], [t("candidate.identity.examLevel"), candidate.level], [t("candidate.identity.email"), candidate.email]].filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}{!confirmed && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{t("candidate.identity.warning")}</p>}<Button onClick={confirmCandidate} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? t("candidate.identity.confirmed") : t("candidate.identity.confirm")}</Button><Button onClick={endCandidateSession} variant="outline" className="mt-2 w-full rounded-2xl"><LogOut className="mr-2 h-4 w-4" />{t("candidate.identity.endExam")}</Button><CandidateScheduleWidget candidate={candidate} candidates={candidates} examiners={examiners} settings={harmonogramSettings} t={t} /></div><div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-2" : "lg:col-span-2"}`}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">{t("candidate.landing.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("candidate.landing.helper")}</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{sections.map((section) => <div key={section.key} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{sectionTitle(t, section)}</h4><p className="mt-1 text-sm text-slate-600">{sectionDescription(t, section)}</p></div><StatusPill tone={tone(status[section.key])}>{status[section.key]}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{sectionHelper(status[section.key])}</p><div className="mt-3 text-xs text-slate-500"><div>{t("common.opened")}: {times[section.key]?.openedAt || "-"}</div><div>{t("common.closed")}: {times[section.key]?.closedAt || "-"}</div></div><Button onClick={() => openSection(section.key)} disabled={!confirmed} className="mt-4 rounded-2xl">{section.key.startsWith("field-") ? sectionTitle(t, section) : (status[section.key] === "closed" ? t("candidate.section.requestReopen") : t("candidate.sections.open"))}</Button></div>)}</div></div></div>;
}


function buildTestBankFromCertificationPackage(pkg) {
  if (!pkg?.written) return {};

  return {
    PRACTICING_ADMIN_PACKAGE: Array.isArray(pkg.written?.Practicing?.questions)
      ? pkg.written.Practicing.questions
      : [],
    CONSULTING_ADMIN_PACKAGE: Array.isArray(pkg.written?.Consulting?.questions)
      ? pkg.written.Consulting.questions
      : [],
  };
}

function buildVariantsFromCertificationPackage(pkg) {
  if (!pkg?.variants) return null;

  return {
    Practicing: pkg.variants?.Practicing?.code || "PRACTICING_ADMIN_PACKAGE",
    Consulting: pkg.variants?.Consulting?.code || "CONSULTING_ADMIN_PACKAGE",
  };
}

function activePackageSummary(pkg) {
  if (!pkg?.packageId) return null;

  return {
    packageId: pkg.packageId,
    validationStatus: pkg.validation?.status || "unknown",
    approvalStatus: pkg.approval?.status || "not_approved",
    practicingWritten: `${pkg.variants?.Practicing?.writtenQuestionCount ?? "-"} / ${pkg.variants?.Practicing?.writtenMax ?? "-"}`,
    consultingWritten: `${pkg.variants?.Consulting?.writtenQuestionCount ?? "-"} / ${pkg.variants?.Consulting?.writtenMax ?? "-"}`,
  };
}

// The per-level outdoor briefing (title/preface/candidateIntro) is dropped by the outdoor bank
// normalization, so carry it here — this meta object is the one thing that survives all the way
// from the Centre's Admin.vet import through centre-setup persistence and the session bootstrap
// to the Examiner, with no extra plumbing.
function outdoorIntroFromPackage(pkg) {
  const outdoor = pkg?.outdoor && typeof pkg.outdoor === "object" ? pkg.outdoor : {};
  const result = {};
  for (const level of ["Practicing", "Consulting"]) {
    const lvl = outdoor[level];
    if (!lvl || typeof lvl !== "object") continue;
    const title = String(lvl.title || "").trim();
    const preface = String(lvl.preface || "").trim();
    const candidateIntro = String(lvl.candidateIntro || "").trim();
    if (title || preface || candidateIntro) result[level] = { title, preface, candidateIntro };
  }
  return result;
}

function activePackageRuntimeMeta(pkg) {
  if (!pkg?.packageId) return null;

  const levelMeta = (level) => ({
    variantCode: pkg.variants?.[level]?.code || `${level.toUpperCase()}_ADMIN_PACKAGE`,
    writtenQuestionCount: pkg.variants?.[level]?.writtenQuestionCount ?? pkg.written?.[level]?.questions?.length ?? 0,
    writtenMax: pkg.variants?.[level]?.writtenMax ?? 0,
    outdoorItemCount: pkg.variants?.[level]?.outdoorItemCount ?? 0,
    outdoorMax: pkg.variants?.[level]?.outdoorMax ?? 0,
  });

  return {
    packageId: pkg.packageId,
    validationStatus: pkg.validation?.status || "unknown",
    approvalStatus: pkg.approval?.status || "not_approved",
    loadedAt: new Date().toISOString(),
    variants: {
      Practicing: levelMeta("Practicing"),
      Consulting: levelMeta("Consulting"),
    },
    outdoorIntro: outdoorIntroFromPackage(pkg),
  };
}

function candidateLevel(candidate) {
  const level = String(candidate?.level || "").trim().toLowerCase();
  if (level.includes("consult")) return "Consulting";
  return "Practicing";
}

// Shared by the printed test's scan-sort QR (printCandidateTest) and the batch-scan decoder
// (CentreReviewSection) so a printout and a later scan of it always agree on how a candidate
// is identified. Candidates are reduced to their bare number (e.g. "C-014" -> "14") to keep the
// encoded QR payload short — shorter payload means fewer QR modules, which is what actually
// makes a small printed code reliably scannable.
function candidateScanNumber(candidate) {
  const match = String(candidate?.id || "").match(/\d+/);
  return match ? String(Number(match[0])) : String(candidate?.id || "?");
}

// variantCode can be a long internal identifier (e.g. a fallback like "CONSULTING_ADMIN_PACKAGE"
// when a candidate has no real variant assignment yet), which would blow up the QR's module
// count. Reduce it to level initial + variant letter (if any), e.g. "PA" — that's all that's
// needed to identify "which test" and stays short in every case.
function candidateScanTestCode(candidate, variantCode) {
  const levelChar = candidateLevel(candidate) === "Consulting" ? "C" : "P";
  const suffix = String(variantCode || "").match(/[-_]([A-Z])(?:[-_]|$)/i);
  return suffix ? `${levelChar}${suffix[1].toUpperCase()}` : levelChar;
}

function isInternalVariantCode(code) {
  return /_ADMIN_PACKAGE$/.test(String(code || ""));
}

function variantCodeForCandidate(candidate, variants) {
  const level = candidateLevel(candidate);

  if (level === "Consulting") {
    return variants?.Consulting || "CONSULTING_ADMIN_PACKAGE";
  }

  return variants?.Practicing || "PRACTICING_ADMIN_PACKAGE";
}

function variantCodeMatchesCandidateLevel(candidate, variantCode) {
  const level = candidateLevel(candidate);
  const code = String(variantCode || "").toUpperCase();

  if (level === "Practicing") {
    return !code.includes("CONSULTING");
  }

  if (level === "Consulting") {
    return !code.includes("PRACTICING");
  }

  return true;
}

function safeQuestionsForCandidate(testBank, candidate, variants) {
  const requestedCode = variantCodeForCandidate(candidate, variants);
  const safeCode = variantCodeMatchesCandidateLevel(candidate, requestedCode)
    ? requestedCode
    : candidateLevel(candidate) === "Consulting"
      ? "CONSULTING_ADMIN_PACKAGE"
      : "PRACTICING_ADMIN_PACKAGE";

  return {
    variantCode: safeCode,
    questions: questionsForVariantStrict(testBank, safeCode),
  };
}

function normalizeRuntimeQuestionForUi(question) {
  const options = Array.isArray(question?.options)
    ? question.options.filter((option) => String(option ?? "").trim())
    : [];

  const hasOptions = options.length > 0;
  const rawType = String(question?.type || "").trim();

  return {
    ...question,
    options,
    type: hasOptions ? "single_choice" : rawType || "written",
    points: question?.points ?? question?.max ?? 0,
  };
}

function questionsForVariantStrict(testBank, variantCode) {
  const questions = testBank?.[variantCode];
  return Array.isArray(questions) ? questions.map(normalizeRuntimeQuestionForUi) : [];
}

function testIntroCopy(t) {
  return {
    Practicing: {
      title: t("testIntro.practicing.title"),
      sections: [
        {
          heading: t("testIntro.practicing.sectionA.heading"),
          paragraphs: [t("testIntro.practicing.sectionA.p1")],
        },
        {
          heading: t("testIntro.practicing.sectionB.heading"),
          paragraphs: [
            t("testIntro.practicing.sectionB.p1"),
            t("testIntro.practicing.sectionB.p2"),
            t("testIntro.practicing.sectionB.p3"),
          ],
          bullets: [
            t("testIntro.practicing.sectionB.bullet1"),
            t("testIntro.practicing.sectionB.bullet2"),
            t("testIntro.practicing.sectionB.bullet3"),
            t("testIntro.practicing.sectionB.bullet4"),
            t("testIntro.practicing.sectionB.bullet5"),
            t("testIntro.practicing.sectionB.bullet6"),
          ],
        },
      ],
    },
    Consulting: {
      title: t("testIntro.consulting.title"),
      sections: [
        {
          paragraphs: [
            t("testIntro.consulting.section.p1"),
            t("testIntro.consulting.section.p2"),
            t("testIntro.consulting.section.p3"),
          ],
          bullets: [
            t("testIntro.consulting.section.bullet1"),
            t("testIntro.consulting.section.bullet2"),
            t("testIntro.consulting.section.bullet3"),
            t("testIntro.consulting.section.bullet4"),
            t("testIntro.consulting.section.bullet5"),
          ],
        },
      ],
    },
  };
}

function WrittenTestIntroGate({ candidate, onAccept, onBack, t }) {
  const level = candidateLevel(candidate);
  const introCopy = testIntroCopy(t);
  const copy = introCopy[level] ?? introCopy.Practicing;

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{copy.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("testIntro.readCarefully")}</p>
        </div>
        <Button onClick={onBack} variant="outline" className="rounded-2xl">{t("common.back")}</Button>
      </div>

      <div className="mt-4 space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-slate-900">
        {copy.sections.map((section, index) => (
          <section key={section.heading || index}>
            {section.heading && <h4 className="font-bold underline">{section.heading}</h4>}
            <div className={section.heading ? "mt-2 space-y-2" : "space-y-2"}>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            {Array.isArray(section.bullets) && section.bullets.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {section.bullets.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
        {t("testIntro.confirmationNotice")}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAccept} className="rounded-2xl">{t("testIntro.acceptButton")}</Button>
        <Button onClick={onBack} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
      </div>
    </div>
  );
}

// Time indicator for the candidate's timed sections (written test, report writing): an analog clock
// on the current time, the moment the section opened, and the deadline. The deadline block changes
// colour as the window closes — green, amber once `warnMinutes` remain, red for the last five —
// and a short, deliberately quiet tone plays once when the red state is entered, so a candidate
// with their head down still notices without the room being startled.
// Keeps a timed candidate section in fullscreen and reports when it isn't. Leaving fullscreen is
// already written to the audit trail by the session-integrity effect; this is the candidate-facing
// half, so nobody drops out of the exam view without noticing. Browsers only grant fullscreen from a
// user gesture, so a blocked request is retried on the next interaction rather than given up on.
function useExamFullscreen(active) {
  const [inFullscreen, setInFullscreen] = useState(() => (typeof document === "undefined" ? false : Boolean(document.fullscreenElement || document.webkitFullscreenElement)));
  const exitTimerRef = useRef(null);

  function requestFullscreen() {
    const element = document.documentElement;
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    try { request?.call(element); } catch { /* unsupported or blocked - the notice below stays up */ }
  }

  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    // A long/fast scroll on some mobile browsers (notably iOS Safari) briefly reports fullscreen
    // as exited while the browser's own chrome reappears and settles back down a moment later -
    // that must not flash the "you left fullscreen" banner mid-scroll. Re-entering is reflected
    // immediately (no reason to delay good news); only a still-exited state after a short grace
    // period counts as a real exit and shows the notice.
    const sync = () => {
      const nowFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      window.clearTimeout(exitTimerRef.current);
      if (nowFullscreen) {
        setInFullscreen(true);
        return;
      }
      exitTimerRef.current = window.setTimeout(() => {
        setInFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
      }, 1200);
    };
    sync();
    requestFullscreen();
    const onFirstGesture = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) requestFullscreen();
      removeGesture();
    };
    const removeGesture = () => {
      document.removeEventListener("pointerdown", onFirstGesture);
      document.removeEventListener("keydown", onFirstGesture);
    };
    document.addEventListener("pointerdown", onFirstGesture);
    document.addEventListener("keydown", onFirstGesture);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      window.clearTimeout(exitTimerRef.current);
      removeGesture();
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [active]);

  return { inFullscreen, requestFullscreen };
}

function FullscreenExitNotice({ inFullscreen, onReturn, t }) {
  if (inFullscreen) return null;
  // Sticky so it stays visible (and doesn't reflow the page under the reader) regardless of how
  // far down the candidate has scrolled - a real exit should be easy to act on from anywhere.
  return (
    <div role="alert" className="sticky top-0 z-30 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-sm font-semibold text-amber-950 shadow-md">
      <span>{t("candidate.fullscreen.exited")}</span>
      <Button onClick={onReturn} className="rounded-2xl">{t("candidate.fullscreen.return")}</Button>
    </div>
  );
}

function SectionTimerPanel({ openedAt, durationMinutes = 60, warnMinutes = 15, t }) {
  const [now, setNow] = useState(() => new Date());
  const alertedRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const openedDate = openedAt ? new Date(openedAt) : null;
  const validOpen = openedDate && !Number.isNaN(openedDate.getTime());
  const endDate = validOpen ? new Date(openedDate.getTime() + durationMinutes * 60000) : null;
  const minutesLeft = endDate ? (endDate.getTime() - now.getTime()) / 60000 : null;
  const tone = minutesLeft === null ? "neutral" : minutesLeft <= 5 ? "red" : minutesLeft <= warnMinutes ? "amber" : "green";

  useEffect(() => {
    if (tone !== "red" || alertedRef.current) return;
    alertedRef.current = true;
    // Generated rather than loaded: no asset to ship and it still works fully offline.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      // A short three-note rising figure (E5-G5-C6): recognisable as "time is nearly up" without
      // being an alarm, and each note is shaped so it never clicks at the edges.
      const notes = [[659.25, 0], [783.99, 0.18], [1046.5, 0.36]];
      notes.forEach(([frequency, offset], index) => {
        const start = ctx.currentTime + offset;
        const length = index === notes.length - 1 ? 0.55 : 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + length + 0.05);
      });
      window.setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 1400);
    } catch { /* audio blocked or unavailable - the colour change still carries the warning */ }
  }, [tone]);

  const clockTime = (date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  const hand = (angleDeg, length, width, color) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return <line x1="50" y1="50" x2={50 + length * Math.cos(rad)} y2={50 + length * Math.sin(rad)} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  };
  const toneClass = {
    green: "border-emerald-300 bg-emerald-50 text-emerald-950",
    amber: "border-amber-400 bg-amber-100 text-amber-950",
    red: "border-rose-400 bg-rose-100 text-rose-950",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm">
      <svg viewBox="0 0 100 100" className="h-24 w-24" role="img" aria-label={clockTime(now)}>
        <circle cx="50" cy="50" r="47" fill="#fff" stroke="#0f172a" strokeWidth="3" />
        {Array.from({ length: 12 }, (_, i) => {
          const rad = ((i * 30 - 90) * Math.PI) / 180;
          return <circle key={i} cx={50 + 39 * Math.cos(rad)} cy={50 + 39 * Math.sin(rad)} r={i % 3 === 0 ? 2.6 : 1.4} fill="#0f172a" />;
        })}
        {hand(hours * 30, 24, 4.5, "#0f172a")}
        {hand(minutes * 6, 34, 3, "#0f172a")}
        {hand(seconds * 6, 37, 1.4, "#dc2626")}
        <circle cx="50" cy="50" r="3" fill="#0f172a" />
      </svg>
      <div className="w-full space-y-1 text-center text-xs">
        <div className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700">
          {t("candidate.timer.openedAt")}: {validOpen ? clockTime(openedDate) : "-"}
        </div>
        <div className={`rounded-lg border px-2 py-1 font-bold ${toneClass}`}>
          {t("candidate.timer.endsAt")}: {endDate ? clockTime(endDate) : "-"}
        </div>
      </div>
    </div>
  );
}

function TestSection({ candidate, selectedVariantCode, testBank, responses, updateTest, submitTest, setActiveSection, introAccepted, acceptIntro, openedAt, t }) {
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const { inFullscreen, requestFullscreen } = useExamFullscreen(introAccepted);
  const requestedVariantCode = String(selectedVariantCode || "");
  const effectiveVariantCode = variantCodeMatchesCandidateLevel(candidate, requestedVariantCode)
    ? requestedVariantCode
    : candidateLevel(candidate) === "Consulting"
      ? "CONSULTING_ADMIN_PACKAGE"
      : "PRACTICING_ADMIN_PACKAGE";

  const questions = questionsForVariantStrict(testBank, effectiveVariantCode);
  const hasStrictQuestions = questions.length > 0;

  if (!introAccepted) {
    return <WrittenTestIntroGate candidate={candidate} onAccept={acceptIntro} onBack={() => setActiveSection("landing")} t={t} />;
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <FullscreenExitNotice inFullscreen={inFullscreen} onReturn={requestFullscreen} t={t} />
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-start justify-between gap-3 rounded-t-2xl border-b bg-white/95 px-4 pb-3 pt-4 backdrop-blur">
        <div>
          <h3 className="font-semibold">{t("test.title")}</h3>
        </div>
        <div className="flex items-start gap-3">
          <Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">
            {t("common.back")}
          </Button>
          <SectionTimerPanel openedAt={openedAt} durationMinutes={candidateLevel(candidate) === "Consulting" ? 120 : 60} warnMinutes={15} t={t} />
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          <div className="font-semibold">{t("test.noQuestions")}</div>
          <p className="mt-1">{t("test.askCentre")}</p>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {questions.map((q, i) => (
            <div key={q.id} className="rounded-xl border p-3">
              <div className="text-xs text-slate-500">{t("test.question")} {i + 1} / {q.points} {t("common.points")}</div>
              <div className="mt-1 whitespace-pre-wrap font-medium leading-relaxed">{cleanQuestionText(q.text)}</div>
              {Array.isArray(q.options) && q.options.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {q.options.map((option, optionIndex) => {
                    const optionLetter = String.fromCharCode(65 + optionIndex);
                    const optionText = String(option || "").replace(/^[A-D][.)]\s*/i, "");
                    const selectedValue = String(responses[q.id] ?? "");

                    return (
                      <label key={`${q.id}-${optionIndex}`} className="flex gap-2 rounded-xl bg-slate-50 p-2 text-sm">
                        <input
                          type="radio"
                          name={q.id}
                          checked={
                            selectedValue === optionLetter ||
                            selectedValue === String(option || "") ||
                            selectedValue === optionText
                          }
                          onChange={() => updateTest(q.id, optionLetter)}
                        />
                        <span>
                          <strong>{optionLetter}.</strong> {optionText}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  value={responses[q.id] ?? ""}
                  onChange={(e) => updateTest(q.id, e.target.value)}
                  className="mt-2 min-h-24 w-full rounded-xl border bg-white p-3 text-sm"
                  placeholder={t("test.writeAnswer")}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Button onClick={() => setSubmitConfirmOpen(true)} disabled={questions.length === 0} className="mt-4 rounded-2xl">
        <Lock className="mr-2 h-4 w-4" /> {t("test.submit")}
      </Button>

      {submitConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("test.submit")}</h3>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t("test.submitConfirm")}</div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => setSubmitConfirmOpen(false)} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
              <Button type="button" onClick={() => { setSubmitConfirmOpen(false); submitTest(); }} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" />{t("test.submit")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple corner-handle crop tool for a field photo. Percentage-based (fractions of the rendered
// image box), so the same rect maps cleanly onto the source image's natural pixel size regardless
// of how big the preview is on screen. Closing with the rect still at its untouched default (no
// drag happened) just dismisses - only an actual drag counts as "the operator wants a crop" and
// triggers onSaveCrop.
function PhotoCropOverlay({ photo, onClose, onSaveCrop, t }) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const defaultRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  const [rect, setRect] = useState(defaultRect);
  const dragRef = useRef(null);

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function startDrag(corner, event) {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    dragRef.current = { corner, pointerId: event.pointerId };
  }

  function onMove(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    const px = clamp01((event.clientX - box.left) / box.width);
    const py = clamp01((event.clientY - box.top) / box.height);
    setRect((prev) => {
      let { x, y, w, h } = prev;
      const x2 = x + w;
      const y2 = y + h;
      const minSize = 0.05;
      if (drag.corner === "nw") { x = Math.min(px, x2 - minSize); y = Math.min(py, y2 - minSize); w = x2 - x; h = y2 - y; }
      else if (drag.corner === "ne") { const nx2 = Math.max(px, x + minSize); y = Math.min(py, y2 - minSize); w = nx2 - x; h = y2 - y; }
      else if (drag.corner === "sw") { x = Math.min(px, x2 - minSize); const ny2 = Math.max(py, y + minSize); w = x2 - x; h = ny2 - y; }
      else if (drag.corner === "se") { const nx2 = Math.max(px, x + minSize); const ny2 = Math.max(py, y + minSize); w = nx2 - x; h = ny2 - y; }
      return { x: clamp01(x), y: clamp01(y), w, h };
    });
  }

  function endDrag(event) {
    if (dragRef.current && event.pointerId === dragRef.current.pointerId) dragRef.current = null;
  }

  function handleClose() {
    const isUntouched = Math.abs(rect.x - defaultRect.x) < 0.001 && Math.abs(rect.y - defaultRect.y) < 0.001 && Math.abs(rect.w - defaultRect.w) < 0.001 && Math.abs(rect.h - defaultRect.h) < 0.001;
    const img = imgRef.current;
    if (isUntouched || !img || !img.naturalWidth) { onClose(); return; }
    const canvas = document.createElement("canvas");
    const sx = rect.x * img.naturalWidth;
    const sy = rect.y * img.naturalHeight;
    const sw = rect.w * img.naturalWidth;
    const sh = rect.h * img.naturalHeight;
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    onSaveCrop(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 p-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{photo.description || photo.name || photo.id}</h3>
          <p className="text-sm text-slate-300">{t("report.cropHint")}</p>
        </div>
        <Button onClick={handleClose} variant="outline" className="rounded-2xl bg-white text-slate-950">
          {t("common.close")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white p-2">
        <div ref={containerRef} className="relative mx-auto" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <img ref={imgRef} src={photo.dataUrl} alt="" className="block h-auto w-full rounded-xl" draggable={false} />
          <div
            className="absolute border-2 border-emerald-400 bg-emerald-400/10"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
          >
            {["nw", "ne", "sw", "se"].map((corner) => (
              <div
                key={corner}
                onPointerDown={(event) => startDrag(corner, event)}
                className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500"
                style={{
                  left: corner.includes("w") ? 0 : "100%",
                  top: corner.includes("n") ? 0 : "100%",
                  touchAction: "none",
                  cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportSection({ candidate, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, updateReportPhoto, moveReportPhoto, submitReport, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const draft = reportDrafts[candidate.id] ?? createReportDraft();
  const tree = draft[activeReportTree];
  const [photoStatus, setPhotoStatus] = useState("");
  const [reportStep, setReportStep] = useState("field");
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  // Persisted: the 60-minute report window must survive a reload, otherwise a refresh would silently
  // restart the clock. Keyed per candidate so two candidates on one device never share a deadline.
  const reportStartKey = `vetbara-report-writing-started-${candidate.id}`;
  const [reportWritingStartedAt, setReportWritingStartedAt] = useState(() => {
    try { return localStorage.getItem(reportStartKey) || ""; } catch { return ""; }
  });

  const { inFullscreen, requestFullscreen } = useExamFullscreen(reportStep === "write");

  function beginReportWriting() {
    const startedAt = reportWritingStartedAt || new Date().toISOString();
    if (!reportWritingStartedAt) {
      setReportWritingStartedAt(startedAt);
      try { localStorage.setItem(reportStartKey, startedAt); } catch { /* private mode - the clock still runs for this session */ }
    }
    setStartConfirmOpen(false);
    setReportStep("write");
  }
  const [photoViewer, setPhotoViewer] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [fieldNotesDraft, setFieldNotesDraft] = useState(tree.fieldNotes || (candidateLevel(candidate) === "Consulting" ? CONSULTING_FIELD_NOTES_TEMPLATE : ""));
  const [photoDescriptionDrafts, setPhotoDescriptionDrafts] = useState({});
  const [handwritingOpen, setHandwritingOpen] = useState(false);
  const [fullscreenSectionKey, setFullscreenSectionKey] = useState(null);
  const [annotatingPhoto, setAnnotatingPhoto] = useState(null);
  const [cropViewer, setCropViewer] = useState(null);

  const label = (key, fallback) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const localKey = `vetbara-report-field-backup-${candidate.id}-${activeReportTree}`;

  useEffect(() => {
    setFieldNotesDraft(tree.fieldNotes || (candidateLevel(candidate) === "Consulting" ? CONSULTING_FIELD_NOTES_TEMPLATE : ""));
    setPhotoDescriptionDrafts(Object.fromEntries((tree.photos ?? []).map((photo) => [photo.id, photo.description ?? ""])));
  }, [candidate.id, activeReportTree]);

  useEffect(() => {
    const backup = {
      candidateId: candidate.id,
      tree: activeReportTree,
      fieldNotes: tree.fieldNotes ?? "",
      photos: (tree.photos ?? []).map(({ dataUrl, ...photo }) => ({
        ...photo,
        hasImageData: Boolean(dataUrl),
      })),
      savedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(localKey, JSON.stringify(backup));
    } catch (error) {
      console.warn("Report field autosave skipped", error);
    }
  }, [candidate.id, activeReportTree, tree.fieldNotes, tree.photos, localKey]);

  function saveFieldDataLocally() {
    updateReport(activeReportTree, "fieldNotes", fieldNotesDraft, "fieldNotes");

    const backup = {
      candidateId: candidate.id,
      tree: activeReportTree,
      fieldNotes: tree.fieldNotes ?? "",
      photos: (tree.photos ?? []).map(({ dataUrl, ...photo }) => ({
        ...photo,
        hasImageData: Boolean(dataUrl),
      })),
      savedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(localKey, JSON.stringify(backup));
      setPhotoStatus(`${t("report.locallySaved")}: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.warn("Report field manual save skipped", error);
      setPhotoStatus(t("report.locallySavedNoPhotos"));
    }
  }

  function handlePhotoInputChange(event) {
    const input = event.target;
    const files = Array.from(input.files ?? []);

    if (!files.length) {
      input.value = "";
      return;
    }

    let loaded = 0;
    let failed = 0;

    Promise.all(files.map(async (file) => {
      try {
        const dataUrl = await compressImageToDataUrl(file);
        addReportPhoto(activeReportTree, {
          name: file.name || `photo-${Date.now()}`,
          type: "image/jpeg",
          size: approxDataUrlBytes(dataUrl),
          dataUrl,
          description: "",
          useInReport: true,
          createdAt: new Date().toISOString(),
        });
        loaded += 1;
      } catch {
        failed += 1;
      }
    })).then(() => {
      setPhotoStatus(failed && !loaded ? t("report.photoError") : (loaded === 1 ? t("report.photoAdded") : t("report.photosAddedCount").replace("{count}", loaded)));
      input.value = "";
    });
  }

  function handleSubmitReport() {
    // In-app confirmation modal instead of window.confirm — native dialogs are silently
    // suppressed in some tablet/in-app browsers, which made the submit button look dead.
    setSubmitConfirmOpen(true);
  }

  function confirmSubmitReport() {
    setSubmitConfirmOpen(false);
    submitReport();
  }

  function saveHandwritingAsPhoto(dataUrl) {
    addReportPhoto(activeReportTree, {
      name: `handwriting-${activeReportTree}-${Date.now()}.png`,
      type: "image/png",
      size: 0,
      dataUrl,
      description: t("report.handwritingPhotoDescription"),
      useInReport: false,
      createdAt: new Date().toISOString(),
    });

    setPhotoStatus(t("report.handwritingSaved"));
    setHandwritingOpen(false);
  }

  // Saves the annotated version as a NEW photo (the original stays untouched, same as the
  // handwriting sketch above), so a mis-drawn annotation never destroys the original field photo.
  function saveAnnotatedPhoto(dataUrl) {
    addReportPhoto(activeReportTree, {
      name: `annotated-${annotatingPhoto?.name || "photo"}-${Date.now()}.png`,
      type: "image/png",
      size: 0,
      dataUrl,
      description: annotatingPhoto?.description ? `${annotatingPhoto.description} (${t("report.annotated")})` : t("report.annotatedPhotoDescription"),
      useInReport: true,
      createdAt: new Date().toISOString(),
    });
    setPhotoStatus(t("report.annotationSaved"));
    setAnnotatingPhoto(null);
  }

  // Same "new photo, original untouched" pattern as annotation - the crop overlay itself decides
  // whether a save is even warranted (see PhotoCropOverlay's handleClose).
  function saveCroppedPhoto(dataUrl) {
    addReportPhoto(activeReportTree, {
      name: `crop-${cropViewer?.name || "photo"}-${Date.now()}.jpg`,
      type: "image/jpeg",
      size: 0,
      dataUrl,
      description: cropViewer?.description ? `${cropViewer.description} (${t("report.cropped")})` : t("report.croppedPhotoDescription"),
      useInReport: true,
      createdAt: new Date().toISOString(),
    });
    setPhotoStatus(t("report.cropSaved"));
    setCropViewer(null);
  }

  // A fallback for when the digital submission can't go through: exports everything already
  // typed/photographed for both trees to a printable PDF, without closing or submitting the report.
  // Shared by the print/PDF fallback and the in-window Overview preview, so the candidate's final
  // review always shows exactly what the PDF would - one place builds the report's printable HTML.
  function buildReportBodyHtml() {
    return REPORT_TREES.map((treeName) => {
      const treeData = draft[treeName] ?? createReportDraft()[treeName];
      const reportPhotos = (treeData.photos ?? []).filter((photo) => photo.useInReport ?? true);
      const photosHtml = reportPhotos.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:3mm;margin:2mm 0">${reportPhotos.map((photo) => photo.dataUrl ? `<figure style="margin:0"><img src="${photo.dataUrl}" alt="" style="width:38mm;height:28mm;object-fit:cover;border-radius:6px;border:1px solid #dbe3dd" />${photo.description ? `<figcaption style="font-size:7.5pt;color:#64748b;margin-top:1mm;max-width:38mm">${escapeHtml(photo.description)}</figcaption>` : ""}</figure>` : "").join("")}</div>`
        : "";
      const sectionsHtml = REPORT_SECTIONS.map((section) => {
        const value = String(treeData.finalSections?.[section.key] ?? "").trim();
        return `<div style="margin-top:2mm"><div style="font-weight:700;font-size:9pt;color:#516158">${escapeHtml(sectionTitle(t, section))}</div><div style="border-radius:8px;padding:3mm;margin-top:1mm;background:#f6faf7;font-size:10pt;white-space:pre-wrap">${value ? linesToHtml(value) : "-"}</div></div>`;
      }).join("");
      return `<section style="break-inside:avoid;margin-bottom:6mm;padding-bottom:4mm;border-bottom:1px solid #dbe3dd">
        <div style="font-weight:700;font-size:12pt;margin-bottom:2mm">${escapeHtml(treeName)}</div>
        <div style="font-weight:700;font-size:9pt;color:#516158">${escapeHtml(t("report.fieldNotes"))}</div>
        <div style="border-radius:8px;padding:3mm;margin-top:1mm;background:#f6faf7;font-size:10pt;white-space:pre-wrap">${String(treeData.fieldNotes ?? "").trim() ? linesToHtml(treeData.fieldNotes) : "-"}</div>
        ${photosHtml}
        ${sectionsHtml}
      </section>`;
    }).join("");
  }

  function printReportDraftPdf() {
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(t("report.pdfDraftTitle"))} - ${escapeHtml(candidate.id)}</title><style>
      @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018;font-size:10.5pt}
      header{border-bottom:2px solid #102018;padding-bottom:5mm;margin-bottom:6mm}
      header h1{margin:0;font-size:16pt}
      header p{margin:2mm 0 0;font-size:9.5pt;color:#516158}
      @media print{.actions{display:none}}
      .actions{position:fixed;top:8px;right:10px;z-index:20}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}
    </style></head><body>
      <div class="actions"><button onclick="window.print()">${escapeHtml(t("fieldPrep.printPdf"))}</button></div>
      <header><h1>${escapeHtml(t("report.pdfDraftTitle"))}</h1><p>${escapeHtml(candidate.name || candidate.id)} · ${escapeHtml(candidate.id)} · ${escapeHtml(candidate.level || "")}</p><p>${escapeHtml(new Date().toLocaleString())}</p></header>
      <main>${buildReportBodyHtml()}</main>
    </body></html>`;
    openPrintDocument(html, () => setPhotoStatus(t("report.pdfBlocked")));
  }

  function TreeTabs() {
    return (
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {REPORT_TREES.map((treeName) => (
          <button
            key={treeName}
            type="button"
            onClick={() => setActiveReportTree(treeName)}
            className={`rounded-2xl border p-4 text-left text-xl font-bold ${
              activeReportTree === treeName
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-300 bg-white text-slate-950"
            }`}
          >
            {treeName}
            <div className={`mt-1 text-sm font-normal ${activeReportTree === treeName ? "text-slate-200" : "text-slate-500"}`}>
              {t("report.photosCountLabel")}: {(draft[treeName]?.photos ?? []).length} · {t("report.fieldNotes")}: {String(draft[treeName]?.fieldNotes ?? "").trim() ? t("report.notesShortStatusYes") : t("report.notesShortStatusNo")}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function PhotoGrid() {
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(tree.photos ?? []).map((photo) => {
          const description = photoDescriptionDrafts[photo.id] ?? photo.description ?? "";
          const useInReport = photo.useInReport ?? true;

          return (
            <div key={photo.id} className="rounded-xl border bg-white p-3">
              <button type="button" onClick={() => setCropViewer(photo)} className="flex w-full items-center gap-3 text-left">
                <div className="h-20 w-20 overflow-hidden rounded-lg bg-slate-200">
                  {photo.dataUrl ? (
                    <img src={photo.dataUrl} alt={photo.name || photo.id} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{photo.id}</div>
                  )}
                </div>
                <div className="min-w-0 text-xs">
                  <div className="truncate font-medium text-slate-900">{photo.name || photo.id}</div>
                  <div className="text-slate-500">{photo.type || "image"} · {photo.size ? `${Math.round(photo.size / 1024)} KB` : ""}</div>
                </div>
              </button>

              <label className="mt-3 block text-xs font-medium text-slate-600">
                {t("report.photoDescription")}
                <input
                  value={description}
                  maxLength={100}
                  onChange={(e) => setPhotoDescriptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value.slice(0, 100) }))}
                  onBlur={() => updateReportPhoto(activeReportTree, photo.id, { description })}
                  placeholder={t("report.photoDescriptionPlaceholder")}
                  className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950"
                />
                <span className="mt-1 block text-right text-[11px] text-slate-500">{description.length}/100</span>
              </label>

              <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={useInReport}
                  onChange={(e) => updateReportPhoto(activeReportTree, photo.id, { useInReport: e.target.checked })}
                />
                {t("report.photoUseInReport")}
              </label>
            </div>
          );
        })}
      </div>
    );
  }

  function FieldCollectionStep() {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <h3 className="text-2xl font-bold">{t("candidate.report.fieldCollection.title")}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {t("candidate.report.fieldCollection.helper")}
        </p>

        {TreeTabs()}

        <div className="mt-4 rounded-2xl bg-slate-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{t("report.photosCountLabel")}: {(tree.photos ?? []).length}</div>
              <p className="mt-1 text-sm text-slate-600">{t("report.photosSavedLocallyHelper")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => cameraInputRef.current?.click()} variant="outline" className="rounded-2xl">
                {t("report.takePhoto")}
              </Button>
              <Button type="button" onClick={() => galleryInputRef.current?.click()} variant="outline" className="rounded-2xl">
                {t("report.selectFromGallery")}
              </Button>
              <input ref={cameraInputRef} type="file" accept="image/*,.heic,.heif" capture="environment" onChange={handlePhotoInputChange} className="hidden" />
              <input ref={galleryInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handlePhotoInputChange} className="hidden" />
            </div>
          </div>

          {photoStatus && <div className="mt-2 text-xs font-medium text-slate-600">{photoStatus}</div>}
          {(tree.photos ?? []).length > 0 && PhotoGrid()}
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <h4 className="text-lg font-semibold">{t("report.fieldNotesPrivate")}</h4>
          <p className="mt-1 text-sm text-slate-600">{t("report.fieldNotesPrivateHelper")}</p>
          <textarea
            value={fieldNotesDraft}
            onChange={(e) => setFieldNotesDraft(e.target.value)}
            onBlur={() => updateReport(activeReportTree, "fieldNotes", fieldNotesDraft, "fieldNotes")}
            placeholder={t("report.fieldPlaceholder")}
            className="mt-3 min-h-72 w-full rounded-xl border bg-white p-4 text-base text-blue-700"
            style={{ resize: "vertical" }}
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck="true"
          />
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold">{t("report.handwriting.title")}</h4>
              <p className="mt-1 text-sm text-slate-600">{t("report.handwriting.helper")}</p>
            </div>
            <Button type="button" onClick={() => setHandwritingOpen(true)} className="rounded-2xl">
              <Pencil className="mr-1 h-4 w-4" />{t("report.handwriting.open")}
            </Button>
          </div>
        </div>
        {handwritingOpen && (
          <HandwritingPad
            onClose={() => setHandwritingOpen(false)}
            onSave={saveHandwritingAsPhoto}
            title={t("report.handwriting.title")}
            helperText={t("report.handwriting.padHelper")}
            t={t}
            Button={Button}
            CloseIcon={X}
            EraserIcon={Eraser}
            UndoIcon={Undo}
          />
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => setStartConfirmOpen(true)} className="rounded-2xl">
            {t("report.continueWriting")}
          </Button>
        </div>
      </div>
    );
  }

  function ReportWritingStep() {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-white p-5">
        <div className="mx-auto max-w-7xl">
          <FullscreenExitNotice inFullscreen={inFullscreen} onReturn={requestFullscreen} t={t} />
          <div className="sticky top-0 z-10 mb-4 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold">{t("report.writingStepTitle")}</h3>
                <p className="mt-1 text-sm text-slate-600">{candidate.name} · {activeReportTree}</p>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex flex-col items-stretch gap-1.5">
                  <Button onClick={() => setOverviewOpen(true)} variant="outline" className="rounded-2xl">
                    <Search className="mr-2 h-4 w-4" /> {t("report.overview")}
                  </Button>
                  <Button onClick={handleSubmitReport} className="rounded-2xl">
                    <Lock className="mr-2 h-4 w-4" /> {t("report.submitAndClose")}
                  </Button>
                  <Button onClick={printReportDraftPdf} variant="outline" className="rounded-2xl text-xs text-slate-500">
                    {t("report.savePdfFallback")}
                  </Button>
                </div>
                <SectionTimerPanel openedAt={reportWritingStartedAt} durationMinutes={120} warnMinutes={30} t={t} />
              </div>
            </div>
          </div>

          {TreeTabs()}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <h4 className="font-semibold">{t("report.fieldNotes")}</h4>
              <div className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-sm">
                {String(fieldNotesDraft ?? tree.fieldNotes ?? "").trim() || "-"}
              </div>

              <h4 className="mt-4 font-semibold">{t("report.photosForReport")}</h4>
              <div className="mt-2 space-y-3">
                {(tree.photos ?? []).map((photo) => {
                  const description = photoDescriptionDrafts[photo.id] ?? photo.description ?? "";
                  const useInReport = photo.useInReport ?? true;

                  return (
                    <div key={photo.id} className={`rounded-xl border bg-white p-3 ${useInReport ? "" : "opacity-60"}`}>
                      <button type="button" onClick={() => setPhotoViewer(photo)} className="flex w-full items-center gap-3 text-left">
                        <div className="h-14 w-14 overflow-hidden rounded-lg bg-slate-200">
                          {photo.dataUrl && <img src={photo.dataUrl} alt={photo.name || photo.id} className="h-full w-full object-cover" />}
                        </div>
                        <div className="min-w-0 text-xs">
                          <div className="truncate font-medium">{description || photo.name || photo.id}</div>
                          <div className="text-slate-500">{photo.name}</div>
                        </div>
                      </button>

                      <label className="mt-3 block text-xs font-medium text-slate-600">
                        {t("report.photoDescription")}
                        <input
                          value={description}
                          maxLength={100}
                          onChange={(e) => setPhotoDescriptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value.slice(0, 100) }))}
                          onBlur={() => updateReportPhoto(activeReportTree, photo.id, { description })}
                          placeholder={t("report.photoDescriptionPlaceholder")}
                          className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950"
                        />
                        <span className="mt-1 block text-right text-[11px] text-slate-500">{description.length}/100</span>
                      </label>

                      <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={useInReport}
                          onChange={(e) => updateReportPhoto(activeReportTree, photo.id, { useInReport: e.target.checked })}
                        />
                        {t("report.photoUseInReport")}
                      </label>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" onClick={() => setPhotoViewer(photo)} variant="outline" className="rounded-xl px-2 py-1 text-xs font-normal">
                          {t("report.photoZoom")}
                        </Button>
                        <Button type="button" onClick={() => setAnnotatingPhoto(photo)} variant="outline" className="rounded-xl px-2 py-1 text-xs font-normal">
                          <Pencil className="mr-1 h-3 w-3" />{t("report.annotate")}
                        </Button>
                        <Button type="button" onClick={() => setCropViewer(photo)} variant="outline" className="rounded-xl px-2 py-1 text-xs font-normal">
                          {t("report.crop")}
                        </Button>
                        <Button type="button" onClick={() => moveReportPhoto(activeReportTree, photo.id, REPORT_TREES.find((name) => name !== activeReportTree))} variant="outline" className="rounded-xl px-2 py-1 text-xs font-normal">
                          {tf("report.movePhotoToTree", { tree: REPORT_TREES.find((name) => name !== activeReportTree) })}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="grid gap-3 md:grid-cols-2">
                {REPORT_SECTIONS.map((sec) => (
                  <label key={sec.key} className="text-sm font-medium">
                    <div className="flex items-center justify-between gap-2">
                      <span>{sectionTitle(t, sec)}</span>
                      <Button type="button" onClick={() => setFullscreenSectionKey(sec.key)} variant="outline" className="rounded-xl px-2 py-1 text-xs font-normal">
                        <Maximize className="mr-1 h-3 w-3" />{t("report.expandSection")}
                      </Button>
                    </div>
                    <textarea
                      value={tree.finalSections[sec.key] ?? ""}
                      onChange={(e) => updateReport(activeReportTree, sec.key, e.target.value)}
                      placeholder={`${activeReportTree}: ${sectionTitle(t, sec)}`}
                      className="mt-1 min-h-32 w-full rounded-xl border bg-white p-3 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Distraction-free full-screen editing for one section at a time, so a long answer isn't
            written into a cramped grid cell. */}
        {fullscreenSectionKey && (() => {
          const sec = REPORT_SECTIONS.find((s) => s.key === fullscreenSectionKey);
          if (!sec) return null;
          return (
            <div className="fixed inset-0 z-[65] flex flex-col bg-white p-4">
              <div className="flex items-center justify-between gap-3 border-b pb-3">
                <h3 className="text-lg font-semibold">{activeReportTree}: {sectionTitle(t, sec)}</h3>
                <Button onClick={() => setFullscreenSectionKey(null)} className="rounded-2xl">{t("common.close")}</Button>
              </div>
              <textarea
                autoFocus
                value={tree.finalSections[sec.key] ?? ""}
                onChange={(e) => updateReport(activeReportTree, sec.key, e.target.value)}
                placeholder={`${activeReportTree}: ${sectionTitle(t, sec)}`}
                className="mt-4 min-h-0 w-full flex-1 rounded-xl border bg-white p-4 text-base"
              />
            </div>
          );
        })()}

        {annotatingPhoto && (
          <HandwritingPad
            onClose={() => setAnnotatingPhoto(null)}
            onSave={saveAnnotatedPhoto}
            existingImage={annotatingPhoto.dataUrl}
            preserveImageAspect
            hideMaximizeToggle
            title={t("report.annotatePhoto.title")}
            helperText={t("report.annotatePhoto.helper")}
            t={t}
            Button={Button}
            CloseIcon={X}
            EraserIcon={Eraser}
            UndoIcon={Undo}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {reportStep === "field" ? FieldCollectionStep() : ReportWritingStep()}

      {startConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("candidate.report.startConfirm")}</h3>
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              {t("candidate.report.startConfirmInfo")}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button onClick={() => setStartConfirmOpen(false)} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
              <Button onClick={beginReportWriting} className="rounded-2xl">{t("common.confirm")}</Button>
            </div>
          </div>
        </div>
      )}

      {submitConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("report.submitAndClose")}</h3>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t("report.submitConfirmation")}</div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => setSubmitConfirmOpen(false)} variant="outline" className="rounded-2xl">{t("common.cancel")}</Button>
              <Button type="button" onClick={confirmSubmitReport} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" />{t("report.submitAndClose")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Same content the print/PDF fallback builds (buildReportBodyHtml), shown in-window so the
          candidate can do a final read-through - including photos - without leaving the app or
          triggering a print dialog. */}
      {overviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <h3 className="text-lg font-semibold">{t("report.overview")}</h3>
              <Button type="button" onClick={() => setOverviewOpen(false)} variant="outline" className="rounded-2xl">
                <X className="mr-1 h-4 w-4" />{t("common.close")}
              </Button>
            </div>
            <div className="overflow-auto p-5" dangerouslySetInnerHTML={{ __html: buildReportBodyHtml() }} />
          </div>
        </div>
      )}

      {photoViewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 p-4 text-white">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold">{photoViewer.description || photoViewer.name || photoViewer.id}</h3>
              <p className="text-sm text-slate-300">{t("report.photoZoomHint")}</p>
            </div>
            <Button onClick={() => setPhotoViewer(null)} variant="outline" className="rounded-2xl bg-white text-slate-950">
              {t("common.close")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white p-2" style={{ touchAction: "pinch-zoom pan-x pan-y" }}>
            <img src={photoViewer.dataUrl} alt={photoViewer.description || photoViewer.name || photoViewer.id} className="mx-auto h-auto max-w-none rounded-xl" style={{ width: "100%" }} />
          </div>
        </div>
      )}

      {cropViewer && (
        <PhotoCropOverlay
          photo={cropViewer}
          onClose={() => setCropViewer(null)}
          onSaveCrop={saveCroppedPhoto}
          t={t}
        />
      )}
    </>
  );
}

function ExaminerView({
  examiners,
  loggedExaminer,
  confirmed,
  loginExaminer,
  logoutExaminer,
  confirmExaminer,
  assignedCandidates,
  assignments,
  setPrimary,
  activePage,
  setActivePage,
  openOutdoor,
  openWrittenReview,
  openReportReview,
  selectedCandidate, setSelectedCandidateId,
  selectedMode,
  activeOutdoorSection,
  setActiveOutdoorSection,
  outdoor,
  outdoorNotes,
  outdoorNoteDrawings,
  outdoorVariantChoice,
  setOutdoorVariantChoice,
  outdoorExamSummaries,
  updateOutdoorExamSummary,
  outdoorItemsByLevel,
  setOutdoorItemsByLevel,
  updateOutdoor,
  updateOutdoorNote,
  updateOutdoorNoteDrawing,
  outdoorTotal,
  outdoorMax,
  submitOutdoor,
  voiceRecording,
  toggleVoiceRecording,
  pauseVoiceRecording,
  resumeVoiceRecording,
  getVoiceLevels,
  voiceRecordingSupported,
  archivePlan,
  practicingArchive,
  activeScoreLimits,
  updateScore,
  variants,
  testBank,
  testResponses,
  reportDrafts, importedCandidatePackages, setImportedCandidatePackages,
  qrFor,
  setScannerMode,
  setScannerReentry,
  importOfflineCandidatePackageFile,
  importOfflineCandidatePackageData,
  examinerTimes,
  activeAdminPackageMeta,
  activeSessionToken,
  onReportMarked,
  t,
}) {
  return (
    <>
      <Card className="rounded-2xl shadow-sm lg:col-span-3">
        <CardContent className="p-5">
          <SectionTitle
            icon={Tablet}
            title={t("examiner.view.title")}
            subtitle={t("examiner.view.subtitle")}
          />
          <VetCertRulesReference t={t} />
          <ExaminerQuickHelp t={t} />
          <div className="grid gap-4 lg:grid-cols-3">
            {!loggedExaminer && (
              <div className="rounded-2xl border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{t("examiner.qrAccess.title")}</h3>
                  <Button
                    onClick={() => setScannerMode("Examiner")}
                    variant="outline"
                    className="rounded-2xl"
                  >
                    {t("common.scanQr")}
                  </Button>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {t("examiner.qrAccess.helper")}
                </p>
              </div>
            )}

            <div
              className={`rounded-2xl border bg-white p-4 ${
                loggedExaminer ? "lg:col-span-3" : "lg:col-span-2"
              }`}
            >
              {!loggedExaminer ? (
                <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  {t("examiner.empty")}
                </div>
              ) : activePage === "landing" ? (
                <ExaminerLanding
                  examiner={loggedExaminer}
                  confirmed={confirmed}
                  confirmExaminer={confirmExaminer}
                  logoutExaminer={logoutExaminer}
                  assignedCandidates={assignedCandidates}
                  assignments={assignments}
                  setPrimary={setPrimary}
                  openOutdoor={openOutdoor}
                  openWrittenReview={openWrittenReview}
                  openReportReview={openReportReview}
                  importOfflineCandidatePackageFile={importOfflineCandidatePackageFile}
                  importOfflineCandidatePackageData={importOfflineCandidatePackageData}
                  setSelectedCandidateId={setSelectedCandidateId}
                  setImportedCandidatePackages={setImportedCandidatePackages}
                  setActivePage={setActivePage}
                  setScannerMode={setScannerMode}
                  setScannerReentry={setScannerReentry}
                  variants={variants}
                  testBank={testBank}
                  testResponses={testResponses}
                  reportDrafts={reportDrafts}
                  outdoor={outdoor}
                  outdoorItemsByLevel={outdoorItemsByLevel}
                  examinerTimes={examinerTimes}
                  activeSessionToken={activeSessionToken}
                  t={t}
                />
              ) : activePage === "writtenReview" ? (
                <ExaminerWrittenReview
                  selectedCandidate={selectedCandidate}
                  variants={variants}
                  testBank={testBank}
                  testResponses={testResponses}
                  importedCandidatePackages={importedCandidatePackages}
                  scoringLimits={activeScoreLimits}
                  updateScore={updateScore}
                  setActivePage={setActivePage}
                  examinerName={loggedExaminer?.name}
                  activeAdminPackageMeta={activeAdminPackageMeta}
                  t={t}
                />
              ) : activePage === "reportReview" ? (
                <ExaminerReportReview
                  selectedCandidate={selectedCandidate}
                  reportDrafts={reportDrafts}
                  openWrittenReview={openWrittenReview}
                  setActivePage={setActivePage}
                  examinerName={loggedExaminer?.name}
                  activeAdminPackageMeta={activeAdminPackageMeta}
                  t={t}
                  onReportMarked={onReportMarked}
                />
              ) : (
                <OutdoorForm
                  selectedCandidate={selectedCandidate}
                  selectedMode={selectedMode}
                  activeOutdoorSection={activeOutdoorSection}
                  setActiveOutdoorSection={setActiveOutdoorSection}
                  outdoor={outdoor}
                  outdoorNotes={outdoorNotes}
                  outdoorNoteDrawings={outdoorNoteDrawings}
                  outdoorVariantChoice={outdoorVariantChoice}
                  setOutdoorVariantChoice={setOutdoorVariantChoice}
                  outdoorExamSummaries={outdoorExamSummaries}
                  updateOutdoorExamSummary={updateOutdoorExamSummary}
                  outdoorItemsByLevel={outdoorItemsByLevel}
                  setOutdoorItemsByLevel={setOutdoorItemsByLevel}
                  updateOutdoor={updateOutdoor}
                  updateOutdoorNote={updateOutdoorNote}
                  updateOutdoorNoteDrawing={updateOutdoorNoteDrawing}
                  outdoorTotal={outdoorTotal}
                  outdoorMax={outdoorMax}
                  submitOutdoor={submitOutdoor}
                  voiceRecording={voiceRecording}
                  toggleVoiceRecording={toggleVoiceRecording}
                  pauseVoiceRecording={pauseVoiceRecording}
                  resumeVoiceRecording={resumeVoiceRecording}
                  getVoiceLevels={getVoiceLevels}
                  voiceRecordingSupported={voiceRecordingSupported}
                  archivePlan={archivePlan}
                  practicingArchive={practicingArchive}
                  setActivePage={setActivePage}
                  examinerName={loggedExaminer?.name}
                  time={examinerTimes[selectedCandidate.id]?.outdoor}
                  activeAdminPackageMeta={activeAdminPackageMeta}
                  t={t}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

    </>
  );
}
const PRACTICING_WRITTEN_EXAM_INFO = `Section A
This section contains 10 multiple choice questions. For each question choose 1 answer that best answers the question. Each question is worth 1 mark. You should attempt to answer all questions. A total of 10 marks are available for this section.

Section B
This section contains 24 questions that require a written answer. Questions have been grouped into themes, the title of the theme is listed in bold and is underlined.
The number of marks available for each question is shown. You should attempt to answer all questions in this section. A total of 36 marks are available for this section.

Questions are grouped into the following themes:
- The development and aging of trees;
- Roots of veteran trees and the soil environment;
- The values of veteran trees;
- Legislation affecting veteran tree management;
- Veteran tree management; and
- Country specific question(s).`;

const PRACTICING_WRITTEN_SCORING_HELP = {
  "A:1": `Answer A
A functional unit is a semi-autonomous unit comprising roots, trunk and shoots.`,
  "A:2": `Answer D
Functional units need to be considered individually when prescribing management.`,
  "A:3": `Answer C
Durable heartwood has passive defences that help reduce the spread of decay following pruning.`,
  "A:4": `Answer B
Broadly speaking, roots of a veteran tree grow like the base of a wine glass, wider than deep.`,
  "A:5": `Answer B
Pruning the above-ground parts of a veteran tree will cause some roots to die.`,
  "A:6": `Answer D
Mycorrhizal fungi help tree roots take up water and nutrients.`,
  "A:7": `Answer C
Adult stages of invertebrates often require a nectar source.`,
  "A:8": `Answer C
According to Ancient Tree Forum guidance, the root protection area for a veteran tree should be 15 times the diameter at 1.5 m.`,
  "A:9": `Answer A
Do not change the soil level within a root protection area of a veteran tree.`,
  "A:10": `Answer C
A high mortality rate of veteran trees impacts the sustainability of veteran tree populations.`,

  "B:1": `Environmental
Soil, climate, exposure, sunlight/shade including shade from ivy and taking account of the shade-tolerance of the tree species concerned, pollution, wind and other external stimuli.

Biological
Variations between and within tree species, including the health of the individual tree.

Management
Variations in growth form linked to history of management, lapses in management, management in cycle, type of management.`,

  "B:2": `Oxygen.`,

  "B:3": `Passive defence
High moisture content and very low oxygen content of wood.
Bark.
Natural preservatives in heartwood of some species limit the rate of decay.
Existing anatomical boundaries in wood, such as annual rings, latewood and earlywood, rays, etc., act as barriers.
Tylosis / bordered pits.`,

  "B:4": `A healthy soil environment is essential for tree roots to function properly.`,

  "B:5": `Free draining.
Oxygen abundant.
Compaction resistant.`,

  "B:6": `Excessive nutrients can adversely affect the symbiotic relationship with mycorrhizas.`,

  "B:7": `Soil compaction
Reduction or removal of air spaces within soil leading to unfavourable anaerobic conditions.

Change of soil level
Alters aerobic/anaerobic conditions.
Potential to expose and damage roots.`,

  "B:8": `Oxygen availability.
Water availability: lack of water or too much water.
Availability of minerals and nutrients.
Presence of other organisms, e.g. symbiotic relationships with bacteria or mycorrhizas.
pH.
Adverse changes to soil environment.
Previous damage.
Physical barriers.`,

  "B:9": `Cultural heritage: linked to local traditions, management of land, wood products/fodder for livestock, link to historical event or person, sacred trees, etc.
Aesthetic: appearance and context as individuals and in groups of veteran trees, air of stability.
Continuity of land ownership.
Boundary trees.
Recognition of values veteran trees provide.
Too expensive to remove.`,

  "B:10": `Some habitats take a long time to form. The wildlife species dependent on them require stable habitats for a long period of time.`,

  "B:11": `Tree species and different characteristics of parent material, i.e. wood.
Species of fungi involved with decay.
Presence of different types and stages of decay: white rot, brown rot, soft rot, wood mould.
Differences between how quickly the wood became dysfunctional.
Age of tree.
History of management.
History of damage.
Length of time microhabitats have been present.
Interactions between species, e.g. woodpecker holes and bats.
Size and location of decaying wood.`,

  "B:12": `The dispersal range of some wildlife, notably insects and other invertebrates, is limited.`,

  "B:13": `Wildlife legislation
Conduct a survey.
Adjust work plan to take account of species present, e.g. retain habitat rather than remove, time works to avoid sensitive periods such as bird nesting, retain or resurrect decaying wood.

Heritage legislation
Check whether the site, buildings or structure are protected.
Managers of sites with such features must preserve them. Damage may be caused by excavation or trees uprooting.`,

  "B:14": `Different pieces of legislation.
Different things prohibited, protected or permitted.`,

  "B:15": `No avoidable loss of veteran tree, or similar statement.`,

  "B:16": `Does anything need to be done?
Is management required?`,

  "B:17": `Size of root protection areas.
Retention of stubs instead of target pruning, using knowledge of species-dependent epicormic shoot formation.
Allowing natural crown retrenchment / retaining epicormic low down in tree.
Natural fracture cuts.
More emphasis on selecting particular branches for tree work.
Functional units.`,

  "B:18": `Size of root protection areas: precautionary principle to protect a greater area of soil.
Retention of stubs instead of target pruning: to encourage fresh shoot production.
Allowing natural crown retrenchment / retaining epicormic low down in tree: working with the tree's natural strategies for longevity.
Natural fracture cuts: more natural look, greater wood decay resource.
More emphasis on selecting particular branches / functional units: working with the changing dynamics of the tree's vascular system.`,

  "B:19": `Is the management having the desired effect?
If not, does management need to be changed or ceased?`,

  "B:20": `What effect the old bracing is having on the tree.
Where new bracing should be installed relative to old bracing.
Whether old bracing should be removed or retained.`,

  "B:21": `How prop materials are transported to the tree.
Positioning of the prop considers sensitive features in the tree or surrounding land.
How the prop contacts the ground.
Whether foundations are needed and whether the design is sensitive.
How the prop contacts the tree.
Design of prop head: surface area, contact material, pressure.
Prop constructed in sections or extendable to allow adjustment on site.`,

  "B:22": `Funding: easier access to money/funding.
Avoids complaints after management has been undertaken.
Protection is easier if people value veteran trees.`,

  "B:23": `Tell them to contact a VETcert consultant.
Do not produce a written report themselves.`,

  "B:24": `Tree decline.
Big wounding.
Other relevant problems caused by cutting lapsed pollards back to the original bolling may be credited where consistent with the official answer package.`
};

const CONSULTING_WRITTEN_EXAM_INFO = `This exam paper contains 45 questions that require a written answer. Questions have been
grouped into themes, the title of the theme is listed in bold and is underlined.

For each question, the number of marks available is detailed. You should attempt to answer
all questions. A total of 97 marks are available for this paper.

Questions are grouped into the following themes:
- The development and aging of trees;
- Roots of veteran trees and the soil environment;
- The values of veteran trees;
- Legislation affecting veteran tree management; and
- Surveying and managing veteran trees.`;

const CONSULTING_WRITTEN_SCORING_HELP = {
  "C1-Q1": `Abiotic
Soil, climate, exposure, sunlight/shade (including shade from ivy and taking account of the shade-tolerance of the tree species concerned), pollution, wind and other external stimuli.

Management
Variations in growth form linked to history of management, lapses in management, management in cycle, type of management.`,

  "C1-Q2": `Loss of tap root as tree ages.
Hollowing extends from inside to outside, within dysfunctional wood (heartwood/ripewood).`,

  "C1-Q3": `Recycling of minerals and nutrients previously locked-up in dysfunctional wood (heartwood/ripewood).
Tree can produce aerial/internal roots to feed on organic matter released as part of the wood decay process.
May be more flexible when subjected to wind.`,

  "C1-Q4": `Limited resources required for growth and normal function, e.g. water (drought), oxygen (water logging), sunlight (shading), minerals and nutrients (depleted or compromised soil environment).
Browsing or natural disasters removing foliage or causing damage to functional wood.
Damage to functional wood, e.g. pruning or ploughing.
Pests or diseases that disrupt normal function.`,

  "C1-Q5": `Oxygen`,

  "C1-Q6": `Decay following dysfunction.`,

  "C1-Q7": `Passive defence
High moisture content and very low oxygen content of wood.
Bark.
Natural preservatives in heartwood of some species limit the rate of decay.
Existing anatomical boundaries in wood, such as annual rings, latewood and earlywood, rays, etc., act as barriers.
Tylosis / bordered pits.`,

  "C1-Q8": `Candidates must compare and contrast to receive marks.
Example: "Quercus has durable heartwood and Betula has non-durable heartwood" scores 1 mark.
To score 2 marks candidates must provide 2 correct couples of information.

Quercus (oak)
Ring porous, high decay resistance of sapwood, presence of durable heartwood (passively restricts decay), high but variable ability to produce epicormic shoots.

Betula (birch)
Diffuse porous, low decay resistance of sapwood, presence of non-durable heartwood (limited resistance to decay), low ability to produce epicormic shoots unless coppiced.`,

  "C1-Q9": `Fungal spores present in wood.
Proliferate and cause decay when conditions become favourable, such as an increase in oxygen.`,

  "C1-Q10": `Mycorrhizal fungi provide the tree with hard-to-get nutrients, particularly phosphorus, and perhaps some protection from drought, fungal diseases and soil toxins such as heavy metal pollution.
Trees provide mycorrhizal fungi with carbohydrates and other products from the tree.
This relationship is essential to ensure the tree can obtain the nutrients it requires. The fungus can also offer protection from drought and pests/pathogens.`,

  "C1-Q11": `Wood decay fungi
Recycle minerals and nutrients back into soil, supporting carbon and nitrogen cycles as well as a diverse soil flora and fauna.

Bacteria
Nitrogen-fixing bacteria convert atmospheric nitrogen into a form accessible to tree roots/mycorrhizae.
Some bacteria are involved in establishment of mycorrhizal associations with roots.

Detritivores
Aid nutrient cycling through consuming and digesting organic matter.`,

  "C1-Q12": `Free draining.
Oxygen abundant.
Compaction resistant.`,

  "C1-Q13": `Consideration of potential drought stress during periods of hot weather.
Likelihood that roots will travel deeper than on less well-drained soils.
Soil has some natural resistance to compaction compared to a clay soil, for example.`,

  "C1-Q14": `Compaction: reduction or removal of air spaces within soil leading to unfavourable anaerobic conditions.
Erosion: displacement of soil.
Changes in soil level: alters aerobic/anaerobic conditions.
Changes in hydrology: change in water table or ground water conditions alter aerobic/anaerobic conditions.
Cultivation/ploughing: direct damage to roots in upper soil area.
Chemical damage: de-icing salt damage, herbicide, fungicide, veterinary medicines, chemicals used in tree management.

Marking note: 1/2 mark for up to 2 correct sources of damage. 1 mark for 3 correct sources of damage.`,

  "C1-Q15": `Compaction: restricts root growth; soil too dense for roots to penetrate; can cause roots to die due to lack of oxygen.
Erosion: removes soil, exposing roots to air, damaging fine roots and restricting water/nutrient uptake.
Changes in soil level: lowered soil exposes roots or damages roots in the process; raised soil alters aerobic/anaerobic conditions and can cause roots to die due to lack of oxygen.
Changes in hydrology: can cause roots to die due to lack of oxygen.
Cultivation/ploughing: creates wounds and causes dysfunction affecting water and nutrient uptake.
Chemical damage: can be toxic to roots; prevents normal function; reverse osmosis causing drought stress.`,

  "C1-Q16": `Compaction
Avoid: set up a root protection area.
Reduce: use ground protection to spread load; mulch soil around tree to encourage beneficial soil fauna; use physical decompaction tools such as hollow tine aeration or compressed air.

Erosion
Avoid: maintain vegetation cover to hold soil together; avoid large discharges of water; prevent access to rooting area by setting up a root protection area.
Reduce: replace eroded soil if certain this will not cause an adverse effect; cover affected area with mulch.

Changes in soil level
Avoid: set up a root protection area.
Reduce: remove recently deposited soil if fine roots have not grown into raised area; replace removed soil only if certain it will not cause adverse effect; cover affected area with mulch.

Changes in hydrology
Avoid: set up a root protection area.
Reduce: investigate options to reinstate normal hydrology.

Cultivation/ploughing
Avoid: set up a root protection area.
Reduce: if regular ploughing must continue, ensure it is undertaken regularly rather than after a lapse.

Chemical damage
Avoid: set up a root protection area; treat livestock off site and allow chemicals to pass through system before turnout.
Reduce: wash pollutants through soil with water.`,

  "C1-Q17": `Oxygen availability.
Water availability: lack of water or too much water.
Availability of minerals and nutrients.
Presence of other organisms, e.g. symbiotic relationships with bacteria or mycorrhizas.
pH.
Adverse changes to soil environment.
Previous damage.
Physical barriers.`,

  "C1-Q18": `Dig hole.
Ground penetrating radar.
Root tomography.`,

  "C1-Q19": `Dig hole - advantages
Quick and easy if small areas excavated; only basic tools required.
Cheaper than other options.
Definitive proof provided: roots are visible.
Can detect all sizes of roots.
Can be undertaken on sloping ground up to a point.

Dig hole - disadvantages
Only suitable for small-scale investigations.
Potential to damage roots through wounding or desiccation.
Difficult in urban areas or where soil is covered.
Any pictorial representation must be produced manually.
Cannot progress past first roots uncovered without damaging them.

Compressed air excavation - advantages
Quicker than a normal spade.
Less damage than a conventional spade.
Definitive proof provided: roots are visible.
Can detect all sizes of roots.
Can be undertaken on sloping ground up to a point.

Compressed air excavation - disadvantages
More expensive than a conventional spade.
Very messy.
Potentially dangerous to operator and bystanders.
Potential adverse effects of compressor use: soil compaction, fuel spillage, emissions.
Damages fine roots.
Difficult in urban areas or where soil is covered.
Any pictorial representation must be produced manually.
Cannot progress past first roots uncovered without damaging them.

Ground penetrating radar - advantages
Can cover a large area quickly.
Results can be presented pictorially.
Non-invasive.
Can survey down to reasonable depth and map results.

Ground penetrating radar - disadvantages
Can only detect roots over a certain size; no fine roots or mycorrhizae.
Less suitable in urban environments or where soil is covered.
Can give false positives where water pipes are present.
Expensive.
Difficult on sloping ground.

Root tomography - advantages
Can detect roots over a certain size.
Results can be presented pictorially.
Can be undertaken on sloping ground up to a point.
Can survey down to reasonable depth, although roots at different depths cannot be mapped.
Gives indication of whether roots are intact or decayed.

Root tomography - disadvantages
Time consuming.
Expensive.
Difficult in urban areas or where soil is covered.
Can only detect roots over a certain size; no fine roots or mycorrhizae.
Semi-invasive.
Cannot determine whether one or many roots are present.
Limited case studies to validate efficacy.`,

  "C1-Q20": `Young trees rely more on vertical spread and include a tap-root.
Older trees have lost taproot and rely on lateral spread.`,

  "C1-Q21": `Examples of ecosystem services / values:
Aesthetic.
Health and wellbeing.
Air quality.
Cooling effect.
Consultation.
Funding.

Marking note: 1/2 mark for value, 1/2 mark for appropriate answer to how it may affect management.`,

  "C1-Q22": `Worked trees / rights of local people to work trees.
Continuity of land ownership / continuity of management.
Boundary trees.
Recognition of values veteran trees provide.
Too expensive to remove.`,

  "C1-Q23": `Communication and consultation.
Public can act as advocates on your behalf.
Funding opportunities.`,

  "C1-Q24": `Opportunities
Potential funding.
Education / interpretation.

Challenges
Soil compaction / erosion.
Physical damage, e.g. climbing.
Vandalism, trophy hunters, fire.`,

  "C1-Q25": `Formal / designed landscapes
Visual appearance key: does retention of deadwood, standing dead trees, scrub, etc. pose a problem?
In designed landscapes, manage based on designer's ideology or other ideas?
Native or non-native species?
Are non-native species capable of reproducing by natural regeneration or is planting required?
Are several layers of design present?
Is there an age gap in the population?

Agricultural / animal husbandry / grazing areas
Agricultural subsidies.
Soil compaction due to stock density.
Browsing damage.
Veterinary treatments.
Is stock density sufficient to prevent shading of veteran trees?
Does stock density allow growth of scrub and natural regeneration?
Is there an age gap in the population?
Risk of removal due to intensification of agriculture, e.g. larger field sizes.

Churchyards
Cultural importance.
Issues around poisonous trees.
Issues around trees on boundaries.
Need/desire to excavate new graves.
Often limited diversity in tree species and age structure.
Potential damage to old buildings, structures, graves.
There may be procedure to follow or need to obtain permission to manage trees.`,

  "C1-Q26": `High tree mortality rate.
Age gap in population.
Specific tree pests in areas with limited tree species diversity.
Climate change.`,

  "C1-Q27": `Species cannot survive in a single tree indefinitely; lots of old trees required.
Species are able to survive where habitat provision remains stable.
Rate of change is minimal, avoiding need for organisms to adapt to new conditions.
A range of interactions between different species, e.g. woodpeckers and bats; if one is lost, many others may be lost too.`,

  "C1-Q28": `Conservation of Habitats and Species Regulations 2017
Protection of a range of wildlife species. Managers must ensure they do not commit an offence, such as damage/destruction of protected species habitat, or must gain a licence before works commence.
Managers or protected sites with potential to support protected species are required to undertake a survey. If species are present, work must be adapted; consent may be required.
Protection of European designated/protected sites, including management.
Managers of veteran trees on protected sites must ensure work does not damage the site; consent may be required.

Town and Country Planning (Tree Preservation) (England) Regulations 2012
Consolidates tree preservation legislation making it illegal to cut down, top, lop, uproot, wilfully damage or wilfully destroy trees without advance consent.
Managers need to apply for consent before undertaking any of these works.

Ancient Monuments and Archaeological Areas Act 1979
Protects buildings and sites of national importance, including subterranean features.
Managers must preserve such features; damage may be caused by excavation or trees uprooting.

Occupiers Liability Act 1957 and 1984
Places a duty of care on land owners to take reasonable steps to prevent foreseeable harm to anyone foreseen to be present on their land. This can include harm caused by falling trees.
Managers need reasonable measures to reduce risk from falling trees.`,

  "C1-Q29": `Different pieces of legislation.
Different things prohibited, protected or permitted.`,

  "C1-Q30": `No avoidable loss of veteran tree, or similar statement.`,

  "C1-Q31": `Does anything need to be done?
Is management required?`,

  "C1-Q32": `Method: t/R ratio.

Limitations
Only accurate for full-crowned trees; does not apply to retrenched crowns or crowns kept small by management, such as pollards.
Cannot be used for trees with open cavities.
Cannot be used for trees with more than one stem.
Limited evidence that this applies to trees with diameters greater than 0.8 m.`,

  "C1-Q33": `Marking note: 1 mark for 2 correct advantages, 1 mark for 2 correct disadvantages and 1 mark for appropriate answer on when each tool could be used.

Sonic tomography - advantages
Can map areas of dysfunction in stem or large branches.
Results can be displayed pictorially.
Less invasive than resistance drills.

Sonic tomography - use
When there is need to assess extent of decay in a single-stemmed tree or large branch.

Sonic tomography - disadvantages
Only maps dysfunction; additional calculations to determine likelihood of failure are required and may not work on veteran trees.
Can mistake cracks for dysfunction.
Cannot detect certain types of decay.
Provides cross-sectional view only; multiple readings may be required.
Requires training and competent use.
Requires expertise to interpret results.
Cannot detect dysfunction/decay in included unions.
Expensive.

Resistance drill - advantages
Can determine areas of sound wood, dysfunctional wood and whether tree has effectively compartmentalised dysfunction.
Can detect dysfunction and decay in included unions.
More accurate than sonic tomography at detecting cracks.
Less training required than sonic tomography.
Error in readings minimal.
Less expensive than sonic tomography.

Resistance drill - use
Assessing dysfunction/decay in an included union.
Assessing residual wall thickness.

Resistance drill - disadvantages
Invasive; can aid spread of dysfunction and decay.
Cannot detect certain types of decay.
Area assessed with single drilling is minimal; multiple drillings often required, increasing damage and risk of decay spread.
Only maps dysfunction/decay; additional failure calculations may not work on veteran trees.
Requires expertise to identify drilling positions and interpret results.
Expensive.

Sounding mallet - advantages
Can determine areas of sound wood on outside of tree.
Non-invasive.
Quick.

Sounding mallet - use
Assessing seams of dysfunction/decay and sound wood on outside of tree, particularly associated with wood decay fruiting bodies.
Assessing decay in buttresses.

Sounding mallet - disadvantages
Results cannot be presented pictorially.
User needs good hearing and experience.
Cannot map decay in centre of tree.
Not very effective at assessing dysfunction/decay in included unions.
Results must be interpreted by person using the tool.

Static load test / pulling test - advantages
Results presented as safety factor rather than strength loss.
Measured reaction of tree to a real load.
Non-invasive.
Clear and easily understood results.

Static load test - use
Stability test following root damage, e.g. following construction.

Static load test - disadvantages
Can only be applied when assessing whole tree failure.
Not possible to quantify loads on individual limbs.
Time consuming.
Expensive and specialist equipment required.
Potential to test to destruction.`,

  "C1-Q34": `What type of bracing is it and how long has it been in the tree?
Has it altered the biomechanical function of the tree?
Does it need removing, replacing, or additional systems adding?`,

  "C1-Q35": `Alnarpsmodellen 2.2 / CTLA / Stritzkes - limitations
Reduces value for reduced vitality.
Reduces value for wounds/damage.
No consideration of special factors, e.g. cultural, biological or social value.

CAVAT / Koch method / Revised Burnley Method / VAT 03 - limitations
Reduces value for short life expectancy.
Reduces value for reduced vitality.
Reduces value for wounds/damage.
No consideration of special factors, e.g. cultural, biological or social value.

Helliwell system - limitations
Reduces value for short life expectancy.
Reduces value for smaller crowns, e.g. retrenchment, pollards, shred, coppice.

Norma Granada - limitations
Reduces value for short life expectancy.
Reduces value for reduced vitality.
Reduces value for wounds/damage.

STEM - limitations
Reduces value for reduced vitality.
Reduces value for wounds/damage.`,

  "C1-Q36": `Damage to soil, e.g. compaction caused by machinery.
Direct impact damage caused by machinery.
Direct damage to veteran trees when timber trees are felled.
Increased exposure to wind, increasing risk of failure.
Increased exposure to sunlight when neighbouring trees removed.`,

  "C1-Q37": `Finishing cuts: retention of stubs, creation of tear cuts or natural fracture cuts instead of target pruning.
Work may be phased over a long period of time.
Size of root protection areas.
Allowing natural crown retrenchment.
More emphasis on selecting particular branches for tree work rather than general prescriptions such as crown reduce by 1 m all over.
Functional units.`,

  "C1-Q38": `Finishing cuts: whether there is a desire for epicormic shoots to develop after pruning; to reduce desiccation in stem or primary branches.
Phased work: to give the tree time to respond, especially if trees are old and quick change would likely be detrimental.
Larger root protection areas: adopting precautionary principle.
Working with the tree's natural ageing strategies rather than managing for aesthetics.
Undertaking minimum work required to meet objective.
Managing each functional unit separately rather than treating tree as a whole.`,

  "C1-Q39": `Marking note: 1/2 mark per benefit/drawback, up to 1 mark for benefits and 1 mark for drawbacks.

Benefits
Allow / plan for climate change.
Increases species choice and can build resilience.
Can create certain decay habitat niches sooner with short-lived species; suitable short-term solution.
Can select species with abundant flowers to support adult stages of invertebrates or nuts for vertebrates.

Drawbacks
May be detrimental to continuity of tree species on historic sites.
May not support as wide a range of species as native trees.
May not be suited to climate or site conditions.`,

  "C1-Q40": `Is the management having the desired effect?
If not, does management need to be changed or ceased?
To establish rate of loss of veteran trees.`,

  "C1-Q41": `National Planning Policy Framework makes specific mention of ancient and veteran trees:
Development resulting in loss/damage should be refused unless there are wholly exceptional reasons and a suitable compensation strategy exists.

Footnote example of wholly exceptional reasons:
Infrastructure projects, including nationally significant infrastructure projects, orders under the Transport and Works Act and hybrid bills, where public benefit would clearly outweigh loss or deterioration of habitat.`,

  "C1-Q42": `Size helps.
Functional units.
Long life-cycle.
Protective organisms, e.g. endophytes.
Develop resistance / tolerance.
Genetic variation.`,
};

function writtenQuestionMax(question) {
  const explicit = Number(question?.points ?? question?.max);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const match = String(question?.text ?? "").match(/\((\d+(?:\.\d+)?)\s*(?:marks?|points?|bod(?:y|ů)?)\)/i);
  if (match) return Number(match[1]);

  return 1;
}

function collectGuidanceText(value, path = "") {
  if (value === undefined || value === null) return [];

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (!text) return [];

    const key = path.toLowerCase();
    const looksLikeGuidance =
      /scoring|score|marking|guidance|guide|rubric|criteria|criterion|model|expected|assessment|examiner|notes|help|answer/i.test(key);

    return looksLikeGuidance ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectGuidanceText(item, `${path}.${index}`));
  }

  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => collectGuidanceText(nested, path ? `${path}.${key}` : key));
  }

  return [];
}

function directPackageGuidance(question) {
  const directCandidates = [
    question?.scoringHelp,
    question?.scoring_help,
    question?.markingGuidance,
    question?.marking_guidance,
    question?.markingGuide,
    question?.marking_guide,
    question?.examinerGuidance,
    question?.examiner_guidance,
    question?.guidance,
    question?.rubric,
    question?.criteria,
    question?.modelAnswer,
    question?.model_answer,
    question?.expectedAnswer,
    question?.expected_answer,
    question?.assessmentNotes,
    question?.assessment_notes,
    question?.help,
    question?.notes,
  ];

  return [...directCandidates, ...collectGuidanceText(question)]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
    .map((value) => Array.isArray(value) ? value.join("\n") : String(value).trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n\n");
}

function consultingFallbackKey(question, index) {
  const id = String(question?.id ?? "");
  const match = id.match(/Q[-_ ]?0?(\d{1,2})/i) || id.match(/C1[-_ ]?0?(\d{1,2})/i);
  if (match) return `C1-Q${Number(match[1])}`;
  return `C1-Q${index + 1}`;
}

function writtenScoringHelp(question, candidate, index = 0) {
  const fromPackage = directPackageGuidance(question);
  if (fromPackage) return fromPackage;

  if (candidate?.level === "Practicing") {
    return PRACTICING_WRITTEN_SCORING_HELP[practicingFallbackKey(question, index)] || "";
  }

  if (candidate?.level === "Consulting") {
    return CONSULTING_WRITTEN_SCORING_HELP[consultingFallbackKey(question, index)] || CONSULTING_WRITTEN_SCORING_HELP[question?.id] || "";
  }

  return CONSULTING_WRITTEN_SCORING_HELP[question?.id] || "";
}

function writtenExamInfo(level) {
  return level === "Practicing" ? PRACTICING_WRITTEN_EXAM_INFO : CONSULTING_WRITTEN_EXAM_INFO;
}

const PRACTICING_SECTION_A_CORRECT = {
  "A:1": "A",
  "A:2": "D",
  "A:3": "C",
  "A:4": "B",
  "A:5": "B",
  "A:6": "D",
  "A:7": "C",
  "A:8": "C",
  "A:9": "A",
  "A:10": "C",
};

function cleanChoiceText(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[A-D][\).:\s-]*/i, "")
    .replace(/^\d+[\).:\s-]*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeChoiceValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^answer\s+/i, "")
    .replace(/^[\(\[]?([A-D])[\)\].:-]?.*$/i, "$1")
    .toUpperCase();
}

function optionLetter(option, index) {
  const raw = String(option ?? "").trim();
  const match = raw.match(/^([A-D])[\).:\s-]/i);
  return match ? match[1].toUpperCase() : String.fromCharCode(65 + index);
}

function packageCorrectAnswer(question) {
  return (
    question?.correctAnswer ??
    question?.correct_answer ??
    question?.answerKey ??
    question?.answer_key ??
    question?.expectedChoice ??
    question?.expected_choice ??
    question?.expectedAnswer ??
    question?.expected_answer ??
    question?.solution ??
    ""
  );
}

function optionMatchesAnswer(option, answer, index) {
  const optionText = cleanChoiceText(option);
  const answerText = cleanChoiceText(answer);
  const letter = optionLetter(option, index);

  if (!answerText) return false;
  if (normalizeChoiceValue(answer) === letter) return true;
  if (answerText === optionText) return true;
  if (optionText && answerText.includes(optionText)) return true;
  if (answerText && optionText.includes(answerText)) return true;

  return false;
}

function selectedOptionIndexes(question, answer) {
  const answers = Array.isArray(answer) ? answer : [answer];

  return (question?.options ?? [])
    .map((option, index) => answers.some((value) => optionMatchesAnswer(option, value, index)) ? index : -1)
    .filter((index) => index >= 0);
}

function practicingFallbackKey(question, index) {
  const id = String(question?.id ?? "");
  const section = String(question?.section ?? "");
  const combined = `${id} ${section}`;

  const aMatch =
    combined.match(/\bA[-_ ]?0?(\d{1,2})\b/i) ||
    combined.match(/P-[A-Z]{2}-A0?(\d{1,2})/i) ||
    combined.match(/A0?(\d{1,2})/i);

  if (aMatch) return `A:${Number(aMatch[1])}`;

  const bMatch =
    combined.match(/\bB[-_ ]?0?(\d{1,2})\b/i) ||
    combined.match(/P-[A-Z]{2}-B0?(\d{1,2})/i) ||
    combined.match(/B0?(\d{1,2})/i);

  if (bMatch) return `B:${Number(bMatch[1])}`;

  if (Array.isArray(question?.options) && question.options.length && index < 10) return `A:${index + 1}`;

  return `B:${index + 1}`;
}

function isPracticingSectionAQuestion(question, candidate, index) {
  if (candidate?.level !== "Practicing") return false;

  const id = String(question?.id ?? "");
  const section = String(question?.section ?? "");
  const hasOptions = Array.isArray(question?.options) && question.options.length > 0;

  return hasOptions || /^P-[A-Z]{2}-A/i.test(id) || /section\s*A|část\s*A/i.test(section) || index < 10;
}

function correctOptionIndexesFromPackage(question, candidate, index) {
  const correctFromPackage = packageCorrectAnswer(question);

  if (correctFromPackage) {
    const direct = (question?.options ?? [])
      .map((option, optionIndex) => optionMatchesAnswer(option, correctFromPackage, optionIndex) ? optionIndex : -1)
      .filter((optionIndex) => optionIndex >= 0);

    if (direct.length) return direct;
  }

  if (candidate?.level === "Practicing" && isPracticingSectionAQuestion(question, candidate, index)) {
    const fallback = PRACTICING_SECTION_A_CORRECT?.[practicingFallbackKey(question, index)];
    if (fallback) {
      return (question?.options ?? [])
        .map((option, optionIndex) => optionMatchesAnswer(option, fallback, optionIndex) ? optionIndex : -1)
        .filter((optionIndex) => optionIndex >= 0);
    }
  }

  return [];
}

function choiceScoreForQuestion(question, candidate, index, answer) {
  if (!isPracticingSectionAQuestion(question, candidate, index)) return null;

  const correctIndexes = correctOptionIndexesFromPackage(question, candidate, index);
  const selectedIndexes = selectedOptionIndexes(question, answer);
  const max = writtenQuestionMax(question);

  if (!correctIndexes.length || !selectedIndexes.length) return 0;

  const correctSelected = selectedIndexes.filter((selectedIndex) => correctIndexes.includes(selectedIndex)).length;
  const allCorrect = correctSelected === correctIndexes.length && selectedIndexes.length === correctIndexes.length;

  if (allCorrect) return max;
  if (correctSelected > 0) return max / 2;

  return 0;
}

function choiceLetter(index) {
  return String.fromCharCode(65 + index);
}

function isCandidateChoice(option, optionIndex, candidateValue) {
  const letter = choiceLetter(optionIndex);
  const raw = String(candidateValue ?? "").trim();
  const normalized = normalizeChoiceValue(raw);
  const optionText = String(option ?? "").trim();
  const normalizedOption = normalizeChoiceValue(optionText);

  return (
    raw === letter ||
    raw.toUpperCase() === letter ||
    raw === optionText ||
    normalized === normalizedOption
  );
}

function isCorrectChoice(option, optionIndex, correctAnswer) {
  const letter = choiceLetter(optionIndex);
  const raw = String(correctAnswer ?? "").trim();
  const normalized = normalizeChoiceValue(raw);
  const optionText = String(option ?? "").trim();
  const normalizedOption = normalizeChoiceValue(optionText);

  return (
    raw === letter ||
    raw.toUpperCase() === letter ||
    raw === optionText ||
    normalized === normalizedOption
  );
}

function normalizeExaminerChoiceText(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[A-D][.)\s:-]*/i, "")
    .toLowerCase();
}

function examinerChoiceMatchesOption(option, optionIndex, value) {
  const letter = String.fromCharCode(65 + optionIndex);
  const raw = String(value ?? "").trim();
  const normalizedRaw = normalizeExaminerChoiceText(raw);
  const optionText = String(option ?? "").trim();
  const normalizedOption = normalizeExaminerChoiceText(optionText);

  return (
    raw === letter ||
    raw.toUpperCase() === letter ||
    raw === optionText ||
    normalizedRaw === normalizedOption
  );
}

function examinerSelectedChoiceIndexes(question, value) {
  const fromExisting = selectedOptionIndexes(question, value);
  const fromLetters = (question?.options ?? [])
    .map((option, optionIndex) => examinerChoiceMatchesOption(option, optionIndex, value) ? optionIndex : -1)
    .filter((optionIndex) => optionIndex >= 0);

  return [...new Set([...fromExisting, ...fromLetters])];
}

function examinerChoiceAnswerIsFullyCorrect(question, candidate, index, value) {
  const selectedIndexes = examinerSelectedChoiceIndexes(question, value);
  const correctIndexes = correctOptionIndexesFromPackage(question, candidate, index);

  if (!selectedIndexes.length || !correctIndexes.length) return false;

  return (
    selectedIndexes.length === correctIndexes.length &&
    selectedIndexes.every((selectedIndex) => correctIndexes.includes(selectedIndex))
  );
}

function examinerCorrectChoiceIndexes(question, candidate, index) {
  const fromExisting = correctOptionIndexesFromPackage(question, candidate, index);

  const correctValue =
    question?.correctAnswer ??
    question?.correct_answer ??
    question?.answerKey ??
    question?.answer_key ??
    question?.expectedAnswer ??
    question?.expected_answer ??
    "";

  const fromAnswer = (question?.options ?? [])
    .map((option, optionIndex) => examinerChoiceMatchesOption(option, optionIndex, correctValue) ? optionIndex : -1)
    .filter((optionIndex) => optionIndex >= 0);

  return [...new Set([...fromExisting, ...fromAnswer])];
}

function examinerChoiceAutoScore(question, candidate, index, value) {
  const selectedIndexes = examinerSelectedChoiceIndexes(question, value);
  const correctIndexes = examinerCorrectChoiceIndexes(question, candidate, index);

  if (!selectedIndexes.length || !correctIndexes.length) return 0;

  const fullyCorrect =
    selectedIndexes.length === correctIndexes.length &&
    selectedIndexes.every((selectedIndex) => correctIndexes.includes(selectedIndex));

  return fullyCorrect ? writtenQuestionMax(question) : 0;
}

function ExaminerWrittenReview({ selectedCandidate, variants, testBank, testResponses, importedCandidatePackages, scoringLimits, updateScore, setActivePage, examinerName, activeAdminPackageMeta, t }) {
  const [showExamInfo, setShowExamInfo] = useState(false);
  // Seed from the per-candidate persisted marks so re-opening the review shows what was entered,
  // not zeros. Reloaded when the candidate changes and written back on every edit below.
  const [questionScores, setQuestionScores] = useState(() => readWrittenQuestionScores(selectedCandidate?.id));
  const writtenScoresCandidateRef = useRef(selectedCandidate?.id);
  useEffect(() => {
    if (writtenScoresCandidateRef.current === selectedCandidate?.id) return;
    writtenScoresCandidateRef.current = selectedCandidate?.id;
    setQuestionScores(readWrittenQuestionScores(selectedCandidate?.id));
  }, [selectedCandidate?.id]);
  useEffect(() => {
    if (selectedCandidate?.id) writeWrittenQuestionScores(selectedCandidate.id, questionScores);
  }, [questionScores, selectedCandidate?.id]);
  // Manual scores only live in local state until the examiner clicks the final "submit and
  // close" button — there's no per-question save request to confirm. Flash a brief "Uloženo"
  // next to a question right after its score changes, so entering a number visibly registers.
  const [justSavedScoreId, setJustSavedScoreId] = useState(null);
  const savedScoreTimeoutRef = useRef(null);

  if (!activeAdminPackageMeta) {
    return (
      <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          {t("examiner.candidates.backToList")}
        </Button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("examiner.blockedNoAdminPackage")}</div>
      </div>
    );
  }

  if (!selectedCandidate) {
    return (
      <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          {t("examiner.candidates.backToList")}
        </Button>
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          {t("examiner.writtenReview.noCandidateSelected")}
        </div>
      </div>
    );
  }

  const importedPackage = importedCandidatePackages?.[selectedCandidate.id] ?? null;
  const importedQuestions =
    importedPackage?.testQuestionsSnapshot ??
    importedPackage?.testBankSnapshot ??
    importedPackage?.questionsSnapshot ??
    null;

  const effectiveVariantCode = importedPackage?.variantCode || variantCodeForCandidate(selectedCandidate, variants);

  const effectiveTestBank = Array.isArray(importedQuestions)
    ? { ...(testBank ?? {}), [effectiveVariantCode]: importedQuestions }
    : testBank;

  const strictQuestionCount = questionsForVariantStrict(effectiveTestBank, effectiveVariantCode).length;
  const hasStrictQuestions = strictQuestionCount > 0;
  const importedPackageHasQuestionSnapshot = Array.isArray(importedQuestions) && importedQuestions.length > 0;
  const shouldWarnMissingImportedSnapshot = Boolean(importedPackage) && !importedPackageHasQuestionSnapshot && !hasStrictQuestions;

  const reviewVariants = {
    ...(variants ?? {}),
    [selectedCandidate.level]: effectiveVariantCode,
  };

  const computedReview = computeWrittenTestReview(selectedCandidate, reviewVariants, effectiveTestBank, testResponses);
  const review = computedReview ?? {
    variantCode: effectiveVariantCode,
    questions: [],
    answered: 0,
    totalScore: 0,
    totalMax: 0,
  };
  const reviewQuestions = Array.isArray(review.questions) ? review.questions : [];
  const responses = testResponses?.[selectedCandidate.id] ?? {};

  useEffect(() => {
    setQuestionScores((prev) => {
      const next = { ...prev };
      let changed = false;

      reviewQuestions.forEach((question, index) => {
        const isChoiceQuestion = Array.isArray(question?.options) && question.options.length > 0;
        if (!isChoiceQuestion) return;

        const value = responses?.[question.id];
        if (!String(value ?? "").trim()) return;

        const isCorrect = examinerChoiceAnswerIsFullyCorrect(question, selectedCandidate, index, value);
        if (!isCorrect) return;

        const max = writtenQuestionMax(question);
        const current = next[question.id];

        if (current === undefined || current === "" || Number(current) === 0) {
          next[question.id] = max;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [selectedCandidate?.id, review.variantCode, reviewQuestions.length, JSON.stringify(responses)]);
  const reviewItems = Array.isArray(review.items) ? review.items : [];
  const questions = reviewItems.map((item) => item.question).filter(Boolean);
  const answeredCount = reviewItems.filter((item) => item.hasAnswer).length;

  const manualTotal = reviewItems.reduce((total, item, index) => {
    const question = item.question;
    const manualValue = questionScores[question.id];

    if (manualValue !== undefined && manualValue !== "") {
      return total + (Number.isFinite(Number(manualValue)) ? Number(manualValue) : 0);
    }

    const autoScore = choiceScoreForQuestion(question, selectedCandidate, index, item.answer ?? responses[question.id]);
    return total + (autoScore !== null ? autoScore : 0);
  }, 0);

  const manualMax = questions.reduce((total, question) => total + writtenQuestionMax(question), 0);
  const writtenMax = scoringLimits?.writtenMax ?? scoreLimits(selectedCandidate.level).writtenMax;

  function updateQuestionScore(question, value) {
    const max = writtenQuestionMax(question);
    const score = value === "" ? "" : Math.min(Math.max(Number(value), 0), max);

    setQuestionScores((prev) => ({
      ...prev,
      [question.id]: score,
    }));

    setJustSavedScoreId(question.id);
    clearTimeout(savedScoreTimeoutRef.current);
    savedScoreTimeoutRef.current = setTimeout(() => setJustSavedScoreId(null), 1500);
  }

  function applyManualWrittenScore() {
    const ok = window.confirm(t("examiner.writtenReview.submitConfirmation").replace("{name}", selectedCandidate.name).replace("{total}", manualTotal).replace("{max}", manualMax || writtenMax));
    if (!ok) return;
    updateScore("written", manualTotal, { closed: true });
  }

  function printWrittenReviewPdf() {
    const bodyHtml = reviewItems.map((item, index) => {
      const question = item.question;
      const isChoice = Array.isArray(question.options) && question.options.length > 0;
      const value = item.answer ?? responses[question.id];
      const answered = item.hasAnswer || (value !== undefined && value !== null && String(value).trim() !== "");
      const max = writtenQuestionMax(question);
      const autoChoiceScore = examinerChoiceAnswerIsFullyCorrect(question, selectedCandidate, index, value) ? writtenQuestionMax(question) : 0;
      const manualDisplayedScore = questionScores[question.id] ?? review.scores?.[question.id] ?? 0;
      const pointsAwarded = autoChoiceScore || manualDisplayedScore;
      const help = writtenScoringHelp(question, selectedCandidate, index);
      const optionsHtml = isChoice
        ? `<div>${question.options.map((opt, i) => {
            const optionLabel = String.fromCharCode(65 + i);
            const selected = selectedOptionIndexes(question, value).includes(i);
            return `<div class="exam-answer${selected ? (autoChoiceScore ? " correct" : " incorrect") : ""}">${selected ? "☑" : "☐"} ${escapeHtml(optionLabel)}. ${escapeHtml(String(opt).replace(/^[A-D][.)]\s*/i, ""))}</div>`;
          }).join("")}</div>`
        : `<div class="exam-answer">${answered ? linesToHtml(String(value ?? "")) : `<em>${escapeHtml(t("centre.review.noAnswer") || "Bez odpovědi")}</em>`}</div>`;
      return `<section class="exam-block">
        <div class="exam-block-head"><span>[[${escapeHtml(question.id)}]]</span><span>${index + 1}. ${escapeHtml(question.section || "-")}</span></div>
        <div class="exam-title">${escapeHtml(question.text || "")}</div>
        ${optionsHtml}
        ${help ? `<div class="exam-help">${escapeHtml(help)}</div>` : ""}
        <div style="margin-top:2mm"><span class="exam-score">${pointsAwarded} / ${max} b.</span></div>
      </section>`;
    }).join("");
    const totalHtml = `<div class="exam-total">${escapeHtml(t("archive.total"))}: ${manualTotal} / ${manualMax || writtenMax} b.</div>`;
    openPrintDocument(examinerPdfShellHtml({
      docTitle: t("examiner.pdf.writtenReviewTitle"),
      candidate: selectedCandidate,
      examinerName,
      metaLine: `${escapeHtml(t("examiner.pdf.variant"))}: ${review.variantCode || "-"} · ${escapeHtml(t("examiner.pdf.answered"))}: ${answeredCount} / ${questions.length}`,
      bodyHtml: bodyHtml + totalHtml,
    }));
  }

  return (
    <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
      <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-4 inline-flex items-center gap-2 rounded-2xl border-2 border-slate-400 px-5 py-2.5 text-base font-bold hover:bg-slate-50"><span aria-hidden="true">←</span> {t("examiner.backNoSave")}</Button>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">{t("examiner.writtenReview.title")}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {selectedCandidate.name} · {selectedCandidate.id} · {selectedCandidate.level}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t("examiner.writtenReview.variant")}: {review.variantCode || "-"} · {t("examiner.writtenReview.answered")}: {answeredCount} / {questions.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowExamInfo((value) => !value)} variant="outline" className="rounded-2xl">
            {t("examiner.writtenReview.scoringInfo")}
          </Button>
          {selectedCandidate.level === "Consulting" && (
            <Button onClick={() => setActivePage("reportReview")} variant="outline" className="rounded-2xl">
              {t("examiner.writtenReview.goToReportReview")}
            </Button>
          )}
          <Button onClick={() => setActivePage("landing")} variant="outline" className="rounded-2xl">
            {t("examiner.candidates.backToList")}
          </Button>
          <Button onClick={printWrittenReviewPdf} variant="outline" className="rounded-2xl">
            {t("examiner.pdfWithGrading")}
          </Button>
          <Button onClick={applyManualWrittenScore} className="rounded-2xl">
            {t("examiner.writtenReview.submitAndClose")}
          </Button>
        </div>
      </div>

      {importedPackage && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="font-semibold">{t("examiner.writtenReview.importedPackageLabel")}</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            <div>{t("examiner.writtenReview.variant")}: <strong>{importedPackage.variantCode || "-"}</strong></div>
            <div>{t("examiner.writtenReview.createdLabel")}: <strong>{importedPackage.createdAt ? new Date(importedPackage.createdAt).toLocaleString() : "-"}</strong></div>
            <div>Admin package: <strong>{importedPackage.activeAdminPackage?.packageId || "-"}</strong></div>
            <div>{t("examiner.writtenReview.questionSnapshot")}: <strong>{Array.isArray(importedQuestions) ? importedQuestions.length : 0}</strong></div>
          </div>
        </div>
      )}

      {showExamInfo && (
        <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="mb-2 font-semibold">{t("examiner.writtenReview.scoringInfoHeading")}</div>
          <div className="whitespace-pre-wrap">{writtenExamInfo(selectedCandidate.level)}</div>
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">{t("examiner.writtenReview.questions")}</div>
          <div className="text-xl font-bold">{questions.length}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">{t("examiner.pdf.answered")}</div>
          <div className="text-xl font-bold">{answeredCount}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">{t("examiner.writtenReview.manualScore")}</div>
          <div className="text-xl font-bold">{manualTotal}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">{t("examiner.writtenReview.manualMax")}</div>
          <div className="text-xl font-bold">{manualMax || writtenMax}</div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        {t("examiner.writtenReview.examinerOnlyNotice")}
      </div>

      {variantLanguageFromCode(review.variantCode) && variantLanguageFromCode(review.variantCode) !== variantLanguageFromCode(importedPackage?.variantCode || review.variantCode) && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          {t("examiner.writtenReview.languageMismatchWarning")}
        </div>
      )}

      {Boolean(importedPackage) && reviewQuestions.length === 0 && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          {t("examiner.writtenReview.missingQuestionSnapshotWarning")}
        </div>
      )}

      <div className="space-y-3">
        {!hasStrictQuestions && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
            {t("examiner.writtenReview.noQuestionsLoadedWarning").replace("{variant}", effectiveVariantCode)}
          </div>
        )}
        {questions.length === 0 ? (
          <div className="rounded-xl border bg-amber-50 p-3 text-sm text-amber-950">
            {t("examiner.writtenReview.noQuestionsAvailable")}
          </div>
        ) : reviewItems.map((item, index) => {
          const question = item.question;
          const value = item.answer ?? responses[question.id];
          const answered = item.hasAnswer || (value !== undefined && value !== null && String(value).trim() !== "");
          const isChoice = Array.isArray(question.options) && question.options.length > 0;
          const max = writtenQuestionMax(question);
          const isSectionAChoice = isPracticingSectionAQuestion(question, selectedCandidate, index);
          const correctIndexes = isSectionAChoice ? correctOptionIndexesFromPackage(question, selectedCandidate, index) : [];
          const selectedIndexes = isSectionAChoice ? selectedOptionIndexes(question, value) : [];
          const autoScore = choiceScoreForQuestion(question, selectedCandidate, index, value);
          const manualDisplayedScore = questionScores[question.id] ?? review.scores?.[question.id] ?? 0;
              const autoChoiceScore = examinerChoiceAnswerIsFullyCorrect(question, selectedCandidate, index, value)
                ? writtenQuestionMax(question)
                : 0;
              const displayedScore = autoChoiceScore || manualDisplayedScore;
          const help = writtenScoringHelp(question, selectedCandidate, index);

          return (
            <div key={question.id} className="grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[130px_1fr]">
              <div className="rounded-2xl border bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("common.pointsLabel")}</div>
                <input
                  type="number"
                  min="0"
                  max={max}
                  step="0.5"
                  value={examinerChoiceAutoScore(question, selectedCandidate, index, value) || displayedScore}
                  onChange={(event) => updateQuestionScore(question, event.target.value)}
                  className="mt-2 w-full rounded-xl border bg-white p-2 text-lg font-bold"
                />
                <div className="mt-1 text-xs text-slate-500">max. {max}</div>
                <StatusPill tone={answered ? "good" : "warn"}>{answered ? "Answered" : "Unanswered"}</StatusPill>
                {justSavedScoreId === question.id && (
                  <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" /> {t("examiner.writtenReview.scoreSaved")}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-500">
                    {index + 1}. {question.id} · {question.section || "-"} · {max} {t("common.points")}
                  </div>
                </div>

                <div className="whitespace-pre-wrap font-medium leading-relaxed">{cleanQuestionText(question.text)}</div>

                {isSectionAChoice && isChoice ? (
                  <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="mb-2 font-semibold">{t("examiner.writtenReview.answerOptions")}</div>
                    <div className="space-y-2">
                      {question.options.map((option, optionIndex) => {
                        const letter = optionLetter(option, optionIndex);
                        const selected = examinerSelectedChoiceIndexes(question, value).includes(optionIndex);
                        const correct = examinerCorrectChoiceIndexes(question, selectedCandidate, index).includes(optionIndex);

                        return (
                          <div
                            key={option}
                            className={`rounded-xl border p-3 ${
                              correct
                                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                                : "bg-white text-slate-700"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className={selected ? "font-bold" : ""}>
                                <span className="font-bold">{letter}.</span> {String(option).replace(/^[A-D][\).:\s-]*/i, "")}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {selected && <StatusPill tone={correct ? "good" : "bad"}>{t("examiner.writtenReview.candidateAnswer")}</StatusPill>}
                                {correct && <StatusPill tone="good">{t("examiner.writtenReview.correctAnswer")}</StatusPill>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 rounded-xl bg-white p-3 text-sm">
                      {t("examiner.writtenReview.autoPrefilledPoints")}: <strong>{autoChoiceScore}</strong> / {max}
                    </div>
                  </div>
                ) : (
                  <>
                    {isChoice && (
                      <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
                        <div className="mb-2 font-semibold">{t("examiner.writtenReview.answerOptions")}</div>
                        <div className="space-y-2">
                          {question.options.map((option, optionIndex) => {
                            const letter = optionLetter(option, optionIndex);
                            const selected = examinerSelectedChoiceIndexes(question, value).includes(optionIndex);
                            const correct = examinerCorrectChoiceIndexes(question, selectedCandidate, index).includes(optionIndex);

                            return (
                              <div
                                key={option}
                                className={`rounded-xl border p-3 ${
                                  correct
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                                    : selected
                                      ? "border-rose-300 bg-rose-50 text-rose-950"
                                      : "bg-white text-slate-700"
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className={selected ? "font-bold" : ""}>
                                    <span className="font-bold">{letter}.</span> {String(option).replace(/^[A-D][\).:\s-]*/i, "")}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {selected && <StatusPill tone={correct ? "good" : "bad"}>{t("examiner.writtenReview.candidateAnswer")}</StatusPill>}
                                    {correct && <StatusPill tone="good">{t("examiner.writtenReview.correctAnswer")}</StatusPill>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("examiner.writtenReview.candidateAnswer")}
                      </div>
                      <div className="whitespace-pre-wrap text-slate-900">
                        {answered ? String(value) : "-"}
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                      <div className="whitespace-pre-wrap">
                        {help || t("examiner.writtenReview.noScoringHelpAvailable")}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExaminerReportReview({ selectedCandidate, reportDrafts, openWrittenReview, setActivePage, examinerName, activeAdminPackageMeta, onReportMarked, t }) {
  const candidateId = selectedCandidate?.id || "";
  const [marks, setMarks] = useState(() => readReportMarks(candidateId));
  // Opening the report shows the model answer's own introduction first, so the examiner marks
  // against the same framing the paper document gives.
  const [introOpen, setIntroOpen] = useState(true);

  useEffect(() => {
    setMarks(readReportMarks(candidateId));
    setIntroOpen(true);
  }, [candidateId]);

  function persist(next) {
    setMarks(next);
    writeReportMarks(candidateId, next);
    onReportMarked?.(selectedCandidate, next);
  }

  function updateMark(treeName, sectionKey, patch) {
    persist({
      ...marks,
      [treeName]: { ...(marks[treeName] || {}), [sectionKey]: { ...(marks[treeName]?.[sectionKey] || {}), ...patch } },
    });
  }

  function updateClarity(itemKey, value) {
    persist({ ...marks, clarity: { ...(marks.clarity || {}), [itemKey]: value } });
  }

  const marksTotal = reportMarksTotal(marks);

  if (!activeAdminPackageMeta) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          {t("examiner.candidates.backToList")}
        </Button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("examiner.blockedNoAdminPackage")}</div>
      </div>
    );
  }

  if (!selectedCandidate) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          {t("examiner.candidates.backToList")}
        </Button>
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          {t("examiner.reportReview.noCandidateSelected")}
        </div>
      </div>
    );
  }

  const draft = reportDrafts[selectedCandidate.id] ?? createReportDraft();
  const treeSummaries = REPORT_TREES.map((treeName) => {
    const tree = draft[treeName] ?? createReportDraft()[treeName];
    const reportPhotos = (tree.photos ?? []).filter((photo) => photo.useInReport ?? true);
    const completedSections = REPORT_SECTIONS.filter((section) => String(tree.finalSections?.[section.key] ?? "").trim()).length;

    return {
      treeName,
      tree,
      reportPhotos,
      completedSections,
    };
  });

  function printReportReviewPdf() {
    const bodyHtml = treeSummaries.map(({ treeName, tree, reportPhotos, completedSections }) => {
      const photosHtml = reportPhotos.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:3mm;margin:2mm 0">${reportPhotos.map((photo) => photo.dataUrl ? `<img src="${photo.dataUrl}" alt="" style="width:38mm;height:28mm;object-fit:cover;border-radius:6px;border:1px solid #dbe3dd" />` : "").join("")}</div>`
        : `<p class="exam-help">${escapeHtml(t("examiner.reportReview.noPhotos"))}</p>`;
      const sectionsHtml = REPORT_SECTIONS.map((section) => {
        const value = String(tree.finalSections?.[section.key] ?? "").trim();
        return `<div style="margin-top:2mm"><div class="exam-block-head" style="margin-bottom:0.5mm">${escapeHtml(sectionTitle(t, section))}</div><div class="exam-answer">${value ? linesToHtml(value) : `<em>${escapeHtml(t("examiner.reportReview.missing"))}</em>`}</div></div>`;
      }).join("");
      return `<section class="exam-block">
        <div class="exam-title">${escapeHtml(treeName)} <span class="exam-score">${completedSections} / ${REPORT_SECTIONS.length}</span></div>
        <div class="exam-block-head">${escapeHtml(t("examiner.reportReview.fieldNotesLabel"))}</div>
        <div class="exam-answer">${String(tree.fieldNotes ?? "").trim() ? linesToHtml(tree.fieldNotes) : "-"}</div>
        ${photosHtml}
        ${sectionsHtml}
      </section>`;
    }).join("");
    openPrintDocument(examinerPdfShellHtml({
      docTitle: t("examiner.pdf.reportReviewTitle"),
      candidate: selectedCandidate,
      examinerName,
      bodyHtml,
    }));
  }

  return (
    <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
      {introOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-bold">{t("examiner.reportReview.introTitle")}</h3>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
              {REPORT_MARKING_INTRO.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setIntroOpen(false)} className="rounded-2xl">{t("common.confirm")}</Button>
            </div>
          </div>
        </div>
      )}
      <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-4 inline-flex items-center gap-2 rounded-2xl border-2 border-slate-400 px-5 py-2.5 text-base font-bold hover:bg-slate-50"><span aria-hidden="true">←</span> {t("examiner.backNoSave")}</Button>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">{t("examiner.reportReview.title")}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {selectedCandidate.name} · {selectedCandidate.id} · {selectedCandidate.level}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-bold text-white">{marksTotal} / {REPORT_MARKING_TOTAL}</span>
            <Button onClick={() => setIntroOpen(true)} variant="outline" className="rounded-2xl">{t("examiner.reportReview.showIntro")}</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openWrittenReview?.(selectedCandidate.id)} variant="outline" className="rounded-2xl">
            {t("examiner.reportReview.goToWrittenReview")}
          </Button>
          <Button onClick={() => setActivePage("landing")} variant="outline" className="rounded-2xl">
            {t("examiner.candidates.backToList")}
          </Button>
          <Button onClick={printReportReviewPdf} variant="outline" className="rounded-2xl">
            {t("examiner.pdfWithGrading")}
          </Button>
        </div>
      </div>

      {selectedCandidate.level !== "Consulting" && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          {t("examiner.reportReview.consultingOnlyWarning")}
        </div>
      )}

      {/* Trees stacked, never side by side: each tree gets the full width so the candidate's own
          text (left) can be read against the examiner's comment and mark (right). */}
      <div className="space-y-6">
        {treeSummaries.map(({ treeName, tree, reportPhotos, completedSections }) => {
          const treeMarks = marks[treeName] || {};
          const treeTotal = REPORT_MARKING_SECTIONS.reduce((sum, section) => {
            const mark = treeMarks[section.key];
            return sum + (section.key === "plan" ? reportPlanScore(mark) : (Number(mark?.score) || 0));
          }, 0);
          const treeMax = REPORT_MARKING_SECTIONS.reduce((sum, section) => sum + section.perTreeMax, 0);
          return (
            <div key={treeName} className="rounded-2xl border bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xl font-bold">{treeName}</h4>
                  <p className="text-sm text-slate-600">
                    {t("examiner.reportReview.completedSectionsLabel")}: {completedSections} / {REPORT_SECTIONS.length}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={completedSections === REPORT_SECTIONS.length ? "good" : "warn"}>
                    {completedSections === REPORT_SECTIONS.length ? t("examiner.reportReview.complete") : t("examiner.reportReview.incomplete")}
                  </StatusPill>
                  <span className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-bold text-white">{treeTotal} / {treeMax}</span>
                </div>
              </div>

              {reportPhotos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {reportPhotos.map((photo) => photo.dataUrl && (
                    <img key={photo.id} src={photo.dataUrl} alt={photo.description || photo.name || photo.id} className="h-24 w-32 rounded-lg border object-cover" />
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {REPORT_MARKING_SECTIONS.map((section, index) => {
                  const candidateText = String(tree.finalSections?.[REPORT_SECTIONS[index]?.key] ?? "").trim()
                    || (index === 0 ? String(tree.fieldNotes ?? "").trim() : "");
                  const mark = treeMarks[section.key] || {};

                  // Section 6 (management plan) splits into an itemized sub-rubric instead of one
                  // combined score - the examiner picks whether the candidate proposed cutting/
                  // soil/shade management or "do nothing", then scores that table's line items.
                  if (section.key === "plan") {
                    const mode = mark.mode === "doNothing" ? "doNothing" : "management";
                    const items = reportPlanItemsForMode(mode);
                    const planScore = reportPlanScore(mark);
                    return (
                      <div key={section.key} className="rounded-2xl border bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{section.title}</div>
                          <div className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">{formatHalfPointScore(planScore)} / {REPORT_PLAN_CAP}</div>
                        </div>
                        <div className="mt-2 grid gap-3 lg:grid-cols-2">
                          <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">
                            {candidateText || <em className="text-slate-400">{t("examiner.reportReview.missing")}</em>}
                          </div>
                          <div className="min-w-0">
                            <div className="mb-2 inline-flex rounded-2xl border bg-slate-50 p-0.5 text-xs font-semibold">
                              <button type="button" onClick={() => updateMark(treeName, "plan", { mode: "management" })} className={`rounded-2xl px-3 py-1.5 ${mode === "management" ? "bg-white shadow-sm" : "text-slate-500"}`}>{t("report.plan.modeManagement")}</button>
                              <button type="button" onClick={() => updateMark(treeName, "plan", { mode: "doNothing" })} className={`rounded-2xl px-3 py-1.5 ${mode === "doNothing" ? "bg-white shadow-sm" : "text-slate-500"}`}>{t("report.plan.modeDoNothing")}</button>
                            </div>
                            <div className="space-y-2">
                              {items.map((item) => (
                                <div key={item.key} className="flex items-start justify-between gap-3 rounded-lg border bg-slate-50 p-2">
                                  <div className="min-w-0 text-xs text-slate-700">{item.title}</div>
                                  <label className="shrink-0 text-center text-[10px] text-slate-500">
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      max={item.max}
                                      value={mark.items?.[item.key] ?? ""}
                                      onChange={(event) => updateMark(treeName, "plan", { items: { ...(mark.items || {}), [item.key]: event.target.value } })}
                                      className="block w-16 rounded-lg border p-1 text-right text-xs font-bold text-slate-950"
                                    />
                                    / {item.max}
                                  </label>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <textarea
                          value={mark.comment ?? ""}
                          onChange={(event) => updateMark(treeName, "plan", { comment: event.target.value })}
                          rows={3}
                          placeholder={t("examiner.reportReview.commentPlaceholder")}
                          className="mt-2 w-full rounded-xl border p-2 text-sm"
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={section.key} className="grid gap-3 rounded-2xl border bg-white p-3 lg:grid-cols-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{section.title}</div>
                        <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">
                          {candidateText || <em className="text-slate-400">{t("examiner.reportReview.missing")}</em>}
                        </div>
                      </div>
                      <div className="min-w-0 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                        <div className="flex items-start justify-between gap-3">
                          <ul className="min-w-0 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-slate-600">
                            {section.guidance.map((line, guidanceIndex) => <li key={guidanceIndex}>{line}</li>)}
                          </ul>
                          <label className="shrink-0 text-xs font-semibold text-slate-600">
                            {t("centre.scan.score")} / {section.perTreeMax}
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={section.perTreeMax}
                              value={mark.score ?? ""}
                              onChange={(event) => updateMark(treeName, section.key, { score: event.target.value })}
                              className="mt-1 block w-24 rounded-lg border p-1 text-right text-sm font-bold"
                            />
                          </label>
                        </div>
                        <textarea
                          value={mark.comment ?? ""}
                          onChange={(event) => updateMark(treeName, section.key, { comment: event.target.value })}
                          rows={3}
                          placeholder={t("examiner.reportReview.commentPlaceholder")}
                          className="mt-2 w-full rounded-xl border p-2 text-sm"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Whole-plan marks, scored once rather than per tree. */}
        <div className="rounded-2xl border bg-slate-50 p-4">
          <h4 className="text-xl font-bold">{t("examiner.reportReview.clarityTitle")}</h4>
          <p className="mt-1 text-sm text-slate-600">{t("examiner.reportReview.clarityHelper")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {REPORT_CLARITY_ITEMS.map((item) => (
              <label key={item.key} className="rounded-2xl border bg-white p-3 text-sm font-medium">
                {item.title}
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max={item.max}
                  value={marks.clarity?.[item.key] ?? ""}
                  onChange={(event) => updateClarity(item.key, event.target.value)}
                  className="mt-2 block w-full rounded-lg border p-1 text-right text-sm font-bold"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">/ {item.max}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function examinerWrittenSummary(candidate, variants, testBank, testResponses) {
  const review = computeWrittenTestReview(candidate, variants, testBank, testResponses);
  const score = review.computedScore ?? 0;
  const max = review.computedMax || scoreLimits(candidate.level).writtenMax;
  const answered = review.items.filter((item) => item.hasAnswer).length;
  const total = review.items.length;
  return { score, max, answered, total };
}

function outdoorMaxForSection(level, section, outdoorItemsByLevel) {
  const items = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, level)?.[section] ?? [];
  return items.reduce((sum, item) => sum + Number(item.max || 0), 0);
}

function examinerOutdoorSummary(candidate, outdoor, outdoorItemsByLevel) {
  const sections = effectiveOutdoorSectionsForLevel(outdoorItemsByLevel, candidate.level);
  const values = outdoor?.[candidate.id] ?? {};
  const total = Object.entries(values).reduce((sum, [, value]) => {
    const number = Number(value);
    return sum + (Number.isFinite(number) ? number : 0);
  }, 0);
  const answered = Object.values(values).filter((value) => value !== "" && value !== null && value !== undefined).length;
  // Either/or exercises (halo vs soil) count once in the maximum — the Centre doesn't know which
  // variant the examiner picked, so it counts the first of each group (both carry the same max).
  const max = sections.filter((section) => !outdoorSectionExcluded(sections, undefined, section)).reduce((sum, section) => sum + outdoorMaxForSection(candidate.level, section, outdoorItemsByLevel), 0) || scoreLimits(candidate.level).outdoorMax;
  return { total, max, answered };
}

function examinerReportSummary(candidate, reportDrafts) {
  if (candidate.level !== "Consulting") return { label: "Not required", sections: 0, totalSections: 0, photos: 0, complete: false };
  const draft = reportDrafts?.[candidate.id] ?? {};
  const review = computeReportReview(draft);
  return {
    label: `${review.filledSections} / ${review.totalSections} sections · ${review.photos} photos`,
    sections: review.filledSections,
    totalSections: review.totalSections,
    photos: review.photos,
    complete: review.totalSections > 0 && review.filledSections >= review.totalSections,
  };
}

function CentreCandidateResultsOverview({ candidates, assignments, examiners, variants, testBank, testResponses, reportDrafts, outdoor, outdoorItemsByLevel, scanPagesFor, onOpenScanGrading, t }) {
  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [storedOutdoorResults, setStoredOutdoorResults] = useState(() => readOutdoorCentreResults());
  const [examinerResults, setExaminerResults] = useState(() => readExaminerResultsLocal());

  useEffect(() => {
    const refresh = () => {
      setStoredOutdoorResults(readOutdoorCentreResults());
      setExaminerResults(readExaminerResultsLocal());
      fetchExaminerResultsFromLocalServer().then(setExaminerResults);
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("vetbara:outdoor-centre-results", refresh);
    window.addEventListener("vetbara:examiner-results", refresh);
    refresh();
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("vetbara:outdoor-centre-results", refresh);
      window.removeEventListener("vetbara:examiner-results", refresh);
    };
  }, []);

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="mb-3">
        <h3 className="font-semibold">{t("centre.resultsOverview.title")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("centre.resultsOverview.helper")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2 pr-3">{t("centre.resultsOverview.candidateNumber")}</th>
              <th className="py-2 pr-3">{t("centre.resultsOverview.name")}</th>
              <th className="py-2 pr-3">{t("centre.resultsOverview.testResult")}</th>
              <th className="py-2 pr-3">{t("centre.resultsOverview.scan")}</th>
              <th className="py-2 pr-3">{t("centre.resultsOverview.outdoorResult")}</th>
              <th className="py-2 pr-3">{t("centre.resultsOverview.reportResult")}</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const assignment = assignments[candidate.id] ?? {};
              const writtenAuto = examinerWrittenSummary(candidate, variants, testBank, testResponses);
              const writtenStored = examinerResultFor(examinerResults, candidate.id, "written");
              const written = writtenStored ? { ...writtenAuto, score: Number(writtenStored.value ?? 0), max: Number(writtenStored.max ?? writtenAuto.max), closed: Boolean(writtenStored.closed), updatedAt: writtenStored.updatedAt } : writtenAuto;
              const storedOutdoorResult = examinerResultFor(examinerResults, candidate.id, "outdoor");
              const storedReportResult = examinerResultFor(examinerResults, candidate.id, "report");
              const storedScores = outdoorCentreScoresForCandidate(candidate.id, storedOutdoorResults);
              const mergedOutdoor = {
                ...(outdoor ?? {}),
                [candidate.id]: {
                  ...(outdoor?.[candidate.id] ?? {}),
                  ...storedScores,
                },
              };
              const outdoorAuto = examinerOutdoorSummary(candidate, mergedOutdoor, outdoorItemsByLevel);
              const outdoorSummary = storedOutdoorResult ? { ...outdoorAuto, total: Number(storedOutdoorResult.value ?? 0), max: Number(storedOutdoorResult.max ?? outdoorAuto.max), closed: Boolean(storedOutdoorResult.closed) } : outdoorAuto;
              const submittedOutdoorRows = outdoorCentreSubmittedForCandidate(candidate.id, storedOutdoorResults);
              const reportAuto = examinerReportSummary(candidate, reportDrafts);
              const report = storedReportResult ? { ...reportAuto, label: `${Number(storedReportResult.value ?? 0)} / ${Number(storedReportResult.max ?? scoreLimits(candidate.level).reportMax)}`, complete: Boolean(storedReportResult.closed), updatedAt: storedReportResult.updatedAt } : reportAuto;
              return (
                <tr key={candidate.id} className="border-b align-top">
                  <td className="py-3 pr-3"><div className="font-semibold">{candidate.id}</div><div className="text-xs text-slate-500">{candidate.level}</div></td>
                  <td className="py-3 pr-3"><div className="font-medium">{candidate.name}</div></td>
                  <td className="py-3 pr-3"><StatusPill tone={written.closed ? "good" : written.answered ? "warn" : "default"}>{written.score} / {written.max}</StatusPill><div className="mt-1 text-xs text-slate-500">{tf("centre.resultsOverview.answeredCount", { answered: written.answered, total: written.total })}{written.updatedAt ? ` · ${new Date(written.updatedAt).toLocaleString("cs-CZ")}` : ""}</div></td>
                  <td className="py-3 pr-3">{scanPagesFor?.(candidate.id)?.length ? <Button onClick={() => onOpenScanGrading?.(candidate)} variant="outline" className="rounded-2xl px-3 py-1 text-xs">{t("centre.resultsOverview.scan")}</Button> : <span className="text-slate-300">—</span>}</td>
                  <td className="py-3 pr-3"><StatusPill tone={outdoorSummary.closed || submittedOutdoorRows.length ? "good" : outdoorSummary.answered ? "warn" : "default"}>{outdoorSummary.total} / {outdoorSummary.max}</StatusPill><div className="mt-1 text-xs text-slate-500">{t("centre.resultsOverview.primary")}: {examinerNameById(examiners, assignment.primary)} · {t("centre.resultsOverview.secondary")}: {examinerNameById(examiners, assignment.secondary)}</div>{(submittedOutdoorRows.length > 0 || outdoorSummary.closed) && <div className="mt-1 text-xs text-emerald-700">{t("centre.resultsOverview.closed")}: {submittedOutdoorRows.length ? submittedOutdoorRows.map((row) => `${row.mode || row.role || "examiner"} ${row.total ?? 0}/${row.max ?? outdoorSummary.max}`).join(" · ") : `${storedOutdoorResult?.role || storedOutdoorResult?.examinerName || "examiner"} ${outdoorSummary.total}/${outdoorSummary.max}`}</div>}{(() => { const summaryRow = submittedOutdoorRows.find((row) => String(row.examSummary || "").trim()) || (String(storedOutdoorResult?.examSummary || "").trim() ? storedOutdoorResult : null); return summaryRow ? <div className="mt-1 max-w-md whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs italic text-slate-700"><span className="font-semibold not-italic">{t("outdoor.summary.title")}: </span>{summaryRow.examSummary}</div> : null; })()}</td>
                  <td className="py-3 pr-3">{candidate.level === "Consulting" ? <><StatusPill tone={report.complete ? "good" : report.sections ? "warn" : "default"}>{report.label}</StatusPill></> : <span className="text-slate-400">{t("centre.resultsOverview.notRequired")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExaminerLanding({
  examiner,
  confirmed,
  confirmExaminer,
  logoutExaminer,
  assignedCandidates,
  assignments,
  setPrimary,
  openOutdoor,
  openWrittenReview,
  openReportReview,
  importOfflineCandidatePackageFile,
  importOfflineCandidatePackageData,
  setSelectedCandidateId,
  setImportedCandidatePackages,
  setActivePage,
  setScannerMode,
  setScannerReentry,
  testBank,
  examinerTimes = {},
  activeSessionToken,
  t,
}) {

  const tf = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));


  function candidateOutdoorClosed(candidateId) {
    return Boolean(examinerTimes?.[candidateId]?.outdoor?.closedAt);
  }

  // Ends this device's examiner session and immediately re-opens the full-page scanner so a
  // different examiner (or the same one, on a fresh QR) can take over - the device stays put,
  // only who's signed into it changes. Destructive/irreversible from this screen's point of view
  // (any not-yet-synced local state for this examiner becomes unreachable through the UI), hence
  // the confirm.
  function endExaminerSession() {
    if (!window.confirm(t("examiner.identity.endExamConfirm"))) return;
    logoutExaminer?.();
    setScannerReentry?.(true);
    setScannerMode?.("Examiner");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-1" : ""}`}>
        <div className="mb-3 rounded-xl bg-slate-950 p-4 text-white">
          <div className="text-xs uppercase tracking-wide text-slate-300">{t("examiner.identity.idLabel")}</div>
          <div className="text-3xl font-bold tracking-tight">{examiner.id}</div>
        </div>
        <h3 className="font-semibold">{t("examiner.identity.title")}</h3>
        {[[t("examiner.identity.name"), examiner.name], [t("examiner.identity.email"), examiner.email]].filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => (
          <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="font-medium">{v}</div>
          </div>
        ))}
        <Button onClick={confirmExaminer} disabled={confirmed} className="mt-4 w-full rounded-2xl">
          <BadgeCheck className="mr-2 h-4 w-4" />
          {confirmed ? t("examiner.identity.confirmed") : t("examiner.identity.confirm")}
        </Button>
        <Button onClick={endExaminerSession} variant="outline" className="mt-2 w-full rounded-2xl">
          <LogOut className="mr-2 h-4 w-4" />
          {t("examiner.identity.endExam")}
        </Button>
      </div>

      <div className="rounded-2xl border bg-white p-4 lg:col-span-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold">{t("examiner.worklist.title")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t("examiner.worklist.helper")}</p>
          </div>
        </div>
        {assignedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">{t("examiner.worklist.emptyTitle")}</div>
            <p className="mt-1">{t("examiner.worklist.emptyHelper")}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {assignedCandidates.map((c) => {
              const isPrimary = assignments[c.id]?.primary === examiner.id;
              return (
                <div key={c.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-sm text-slate-600">{c.id} · {c.level}</div>
                    </div>
                    <StatusPill tone={isPrimary ? "good" : "default"}>{isPrimary ? t("examiner.role.primary") : t("examiner.role.secondary")}</StatusPill>
                  </div>
                  <label className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm">
                    <input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(c.id, examiner.id, e.target.checked)} />
                    {t("examiner.worklist.primaryCheckbox")}
                  </label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => openWrittenReview(c.id)} disabled={!confirmed} variant="outline" className="rounded-2xl">TEST</Button>
                    <Button
                      onClick={() => openOutdoor(c.id)}
                      disabled={!confirmed}
                      variant={candidateOutdoorClosed(c.id) ? "outline" : "default"}
                      className={`rounded-2xl ${candidateOutdoorClosed(c.id) ? "bg-slate-200 text-slate-500 hover:bg-slate-200" : ""}`}
                      title={candidateOutdoorClosed(c.id) ? t("examiner.worklist.outdoorClosedTitle") : ""}
                    >
                      OUTDOOR
                    </Button>
                    {c.level === "Consulting" && <Button onClick={() => openReportReview(c.id)} disabled={!confirmed} variant="outline" className="rounded-2xl">REPORT</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ExaminerLocalMediaPanel sessionToken={activeSessionToken} t={t} />
    </div>
  );
}

// A scope-check reason from the server only ever makes sense if it describes *this* role's own
// upload - "Examiner can upload only audio recordings/for assigned candidates" is something an
// examiner can act on (or at least understand). A reason meant for a different role ("Centre can
// upload only photos") can only reach an examiner's device through some kind of session/token
// mixup and would be actively misleading shown at face value, so it falls back to the same
// friendly generic message as a plain network failure instead of a nonsensical "Centre can...".
// Also used to filter a reason already sitting in IndexedDB from a past attempt, so a stale
// wrong-role message left over from before this filter existed stops showing immediately rather
// than waiting for the next failed retry to overwrite it.
function isExaminerRelevantUploadReason(reason) {
  return Boolean(reason) && /^Examiner /.test(reason);
}
function examinerUploadErrorText(error, t) {
  const reason = error?.reason;
  return isExaminerRelevantUploadReason(reason) ? reason : t("examiner.localMedia.retryFailed");
}

// Voice recordings live only in THIS device's IndexedDB until they upload — the Centre's own
// media library (Section E) can never see them, since browsers don't share storage across
// devices. A long recording that failed its first PUT (poor field connection) keeps retrying
// silently every 60s (see retryPendingMediaUploads), but until now there was no way for the
// examiner to see that from their own tablet — the only way to check was to ask the Centre,
// which had nothing to show. This panel is that visibility, plus a manual retry/download for
// when the automatic retry keeps losing to a bad connection.
function ExaminerLocalMediaPanel({ sessionToken, t }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorId, setErrorId] = useState("");
  // The specific reason the last attempt failed, keyed by clientMediaId — an expired session
  // (re-scan the QR to fix) and a file over the storage size limit (nothing to retry, needs the
  // Centre involved) both used to show the exact same generic "check the connection" message,
  // which sent the examiner retrying something a retry could never fix.
  const [errorDetail, setErrorDetail] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listLocalMedia();
      setItems(all.filter((item) => item.mediaType === "audio"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function retryUpload(item) {
    if (!sessionToken || !item.blob) return;
    setBusyId(item.clientMediaId);
    setErrorId("");
    try {
      const { blob, uploadState, remoteId, id, ...meta } = item;
      const uploaded = await uploadExamMedia(sessionToken, meta, blob);
      if (uploaded.stored) {
        await updateLocalMedia(item.clientMediaId, { uploadState: "uploaded", remoteId: uploaded.id ?? null });
        setErrorDetail((prev) => { const next = { ...prev }; delete next[item.clientMediaId]; return next; });
        await refresh();
      } else {
        setErrorId(item.clientMediaId);
      }
    } catch (error) {
      setErrorId(item.clientMediaId);
      // 401 means the session this tablet logged in with has expired (8h TTL) — no retry can
      // fix that, only a fresh QR scan can. Everything else goes through examinerUploadErrorText,
      // which only trusts a reason that's actually about an examiner's own upload — a plain
      // network failure has no error.reason at all (error.message there is a raw, untranslated
      // engine string), and a reason scoped to a different role can only reach this device
      // through some kind of session mixup, so both fall back to the same friendly message.
      const message = error?.status === 401
        ? t("examiner.localMedia.sessionExpired")
        : examinerUploadErrorText(error, t);
      setErrorDetail((prev) => ({ ...prev, [item.clientMediaId]: message }));
    } finally {
      setBusyId("");
    }
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "-";
    return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  }
  function formatMinutes(ms) {
    if (!ms) return "-";
    return `${Math.round(ms / 60000)} min`;
  }

  const pending = items.filter((item) => item.uploadState !== "uploaded");

  return (
    <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t("examiner.localMedia.title")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("examiner.localMedia.helper")}</p>
        </div>
        <Button onClick={refresh} variant="outline" className="rounded-2xl" disabled={loading}>
          {loading ? t("media.refreshing") : t("media.refresh")}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{t("examiner.localMedia.empty")}</div>
      ) : pending.length === 0 ? (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{t("examiner.localMedia.allUploaded")}</div>
      ) : (
        <div className="mt-3 space-y-2">
          {pending.map((item) => (
            <div key={item.clientMediaId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <div>
                <div className="font-medium">{item.candidateId}{item.examinerId ? ` · ${item.examinerId}` : ""}</div>
                <div className="text-xs text-slate-600">{formatMinutes(item.durationMs)} · {formatSize(item.sizeBytes)}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}</div>
                {(errorId === item.clientMediaId || item.lastError) && (
                  <div className="mt-1 text-xs font-semibold text-rose-700">
                    {errorDetail[item.clientMediaId] || (errorId === item.clientMediaId || !isExaminerRelevantUploadReason(item.lastError) ? t("examiner.localMedia.retryFailed") : item.lastError)}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => retryUpload(item)} disabled={busyId === item.clientMediaId || !sessionToken} className="rounded-2xl">
                  {busyId === item.clientMediaId ? t("examiner.localMedia.uploading") : t("examiner.localMedia.uploadNow")}
                </Button>
                <Button onClick={() => downloadBlob(item.blob, item.fileName)} variant="outline" className="rounded-2xl">{t("media.download")}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRecordingClock(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MicIcon({ className }) { return <IconBase className={className}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /><path d="M8 22h8" /></IconBase>; }
function StopIcon({ className }) { return <IconBase className={className}><rect x="6" y="6" width="12" height="12" rx="2" /></IconBase>; }
function ExpandIcon({ className }) { return <IconBase className={className}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></IconBase>; }

function PauseIcon({ className }) { return <IconBase className={className}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></IconBase>; }
function PlayIcon({ className }) { return <IconBase className={className}><path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none" /></IconBase>; }
function PlayTriangleIcon({ className }) { return <IconBase className={className}><path d="M7 5v14l11-7z" /></IconBase>; }

// Live microphone level bars, polled on rAF while actively recording (frozen on pause).
// Bars only need to look "live", not track every audio frame - the recording itself is
// unaffected either way (this reads a side-tap analyser node, see OutdoorVoiceRecorder). A plain
// requestAnimationFrame loop calls getVoiceLevels() (an analyser read + rebuilding 28 bins) and
// re-renders 28 DOM nodes on every display refresh, 60-120 times a second depending on the
// tablet - for the outdoor exam's full ~2h recording that adds up to a real, avoidable chunk of
// battery drain for a decorative meter. Still scheduled via rAF (so it naturally pauses with a
// backgrounded tab), just skipping the actual read/re-render on most frames.
const VOICE_HISTOGRAM_INTERVAL_MS = 90;
function VoiceHistogram({ getVoiceLevels, active }) {
  const [bins, setBins] = useState([]);
  const getLevelsRef = useRef(getVoiceLevels);
  getLevelsRef.current = getVoiceLevels;
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let lastUpdate = 0;
    const tick = (timestamp) => {
      if (timestamp - lastUpdate >= VOICE_HISTOGRAM_INTERVAL_MS) {
        lastUpdate = timestamp;
        setBins(getLevelsRef.current?.() ?? []);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const data = bins.length ? bins : new Array(28).fill(0);
  return (
    <div className="flex h-9 items-center gap-[2px]" aria-hidden="true">
      {data.map((value, index) => (
        <span key={index} className={`w-1 rounded-full ${active ? "bg-red-500/80" : "bg-amber-400/70"}`} style={{ height: `${Math.max(8, Math.round(value * 100))}%` }} />
      ))}
    </div>
  );
}

function OutdoorVoiceRecorderBar({ voiceRecording, toggleVoiceRecording, pauseVoiceRecording, resumeVoiceRecording, getVoiceLevels, voiceRecordingSupported, selectedMode, selectedCandidate, t }) {
  const status = voiceRecording?.status ?? "idle";
  const recording = status === "recording";
  const paused = status === "paused";
  const processing = status === "processing";
  const disabled = selectedMode === "unassigned" || processing || !voiceRecordingSupported;
  const forThisCandidate = !voiceRecording?.candidateId || voiceRecording.candidateId === selectedCandidate.id;

  const tone = paused
    ? "border-amber-400 bg-amber-50"
    : recording
    ? "border-red-300 bg-red-50"
    : status === "saved"
    ? "border-emerald-300 bg-emerald-50"
    : status === "error"
    ? "border-red-300 bg-red-50"
    : "border-slate-300 bg-white";

  return (
    // On pause the whole panel pulses a gentle orange — the fill/border animate (not opacity), so the
    // blink is calm and the Resume/Stop buttons stay fully legible and clickable.
    <div className={`sticky top-2 z-30 mb-4 rounded-2xl border shadow-sm ${tone}`} style={paused ? { animation: "vetbaraPausePulse 1.8s ease-in-out infinite" } : undefined}>
      <style>{"@keyframes vetbaraPausePulse{0%,100%{background-color:#fef3c7;border-color:#f59e0b}50%{background-color:#fffbeb;border-color:#fcd34d}}"}</style>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${paused ? "bg-amber-500 text-white" : recording ? "bg-red-600 text-white animate-pulse" : "bg-slate-900 text-white"}`}>
            {paused ? <PauseIcon className="h-5 w-5" /> : recording ? <StopIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
          </span>
          <div>
            <div className="text-base font-semibold text-slate-950">{t("voice.title")}</div>
            <div className="text-xs text-slate-600">
              {paused
                ? `${t("voice.status.paused")} · ${formatRecordingClock(voiceRecording.elapsedMs)}`
                : recording
                ? `${t("voice.recordingFor")} ${selectedCandidate.name} · ${formatRecordingClock(voiceRecording.elapsedMs)}`
                : processing
                ? voiceRecording.detail || t("voice.status.processing")
                : status === "saved"
                ? voiceRecording.detail || t("voice.status.savedLocal")
                : t("voice.helper")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(recording || paused) && <VoiceHistogram getVoiceLevels={getVoiceLevels} active={recording} />}
          <div className="flex items-center gap-2">
            {recording && (
              <button type="button" onClick={pauseVoiceRecording} disabled={disabled} className="inline-flex items-center gap-2 rounded-2xl border-2 border-amber-400 bg-white px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50">
                <PauseIcon className="h-5 w-5" /> {t("voice.pause")}
              </button>
            )}
            {paused && (
              <button type="button" onClick={resumeVoiceRecording} disabled={disabled} className="inline-flex items-center gap-2 rounded-2xl border-2 border-emerald-500 bg-white px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50">
                <PlayTriangleIcon className="h-5 w-5" /> {t("voice.resume")}
              </button>
            )}
            <button
              type="button"
              onClick={toggleVoiceRecording}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {(recording || paused) ? <><StopIcon className="h-5 w-5" /> {t("voice.stop")}</> : <><MicIcon className="h-5 w-5" /> {t("voice.start")}</>}
            </button>
          </div>
        </div>
      </div>
      {recording && <div className="border-t border-red-200 px-4 py-2 text-xs text-red-800">{t("voice.recordingNote")}</div>}
      {paused && <div className="border-t border-amber-200 px-4 py-2 text-xs font-medium text-amber-800">{t("voice.pausedNote")}</div>}
      {status === "error" && voiceRecording.error && <div className="border-t border-red-200 px-4 py-2 text-xs font-medium text-red-800">{voiceRecording.error}</div>}
      {!voiceRecordingSupported && <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600">{t("voice.error.unsupported")}</div>}
      {!forThisCandidate && recording && <div className="border-t border-red-200 px-4 py-2 text-xs text-red-800">{t("voice.otherCandidate")}</div>}
    </div>
  );
}

function ClockIcon({ className }) { return <IconBase className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></IconBase>; }

// Small always-visible examiner timer (bottom-left of the outdoor form): shows when the exam was
// opened and a countdown "minutka" that defaults to 30 min and can be adjusted in 5-min steps.
// Turns amber under 5 min and rose once it runs out; collapsible so it never blocks the scoring.
function OutdoorExaminerTimer({ openedAtIso, t }) {
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const openedMs = openedAtIso ? Date.parse(openedAtIso) : NaN;
  if (!Number.isFinite(openedMs)) return null;
  const endMs = openedMs + durationMinutes * 60000;
  const remainingMs = Math.max(0, endMs - nowMs);
  const totalSec = Math.round(remainingMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const over = nowMs >= endMs;
  const warn = !over && remainingMs <= 5 * 60000;
  const tone = over ? "border-rose-400 bg-rose-50 text-rose-800" : warn ? "border-amber-400 bg-amber-50 text-amber-900" : "border-slate-300 bg-white text-slate-800";
  const openedLabel = new Date(openedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`fixed bottom-4 left-4 z-40 select-none rounded-2xl border shadow-lg ${tone}`}>
      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-bold" title={t("outdoor.timer.title")}>
          <ClockIcon className="h-4 w-4" /> {over ? "00:00" : `${mm}:${ss}`}
        </button>
      ) : (
        <div className="p-3">
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70"><ClockIcon className="h-3.5 w-3.5" /> {t("outdoor.timer.title")}</span>
            <button type="button" onClick={() => setCollapsed(true)} className="rounded-full px-2 text-sm leading-none opacity-60 hover:opacity-100" aria-label={t("common.close")}>–</button>
          </div>
          <div className="mt-1 text-[11px] opacity-80">{t("outdoor.timer.opened")}: <strong>{openedLabel}</strong></div>
          <div className="mt-1 font-mono text-3xl font-bold tabular-nums leading-none">{over ? "00:00" : `${mm}:${ss}`}</div>
          {over && <div className="mt-0.5 text-xs font-bold">{t("outdoor.timer.over")}</div>}
          <div className="mt-2 flex items-center gap-1">
            <button type="button" onClick={() => setDurationMinutes((m) => Math.max(5, m - 5))} className="h-7 w-7 rounded-lg border bg-white/70 text-sm font-bold hover:bg-white">−</button>
            <span className="min-w-16 text-center text-xs font-semibold">{durationMinutes} min</span>
            <button type="button" onClick={() => setDurationMinutes((m) => Math.min(180, m + 5))} className="h-7 w-7 rounded-lg border bg-white/70 text-sm font-bold hover:bg-white">+</button>
          </div>
        </div>
      )}
    </div>
  );
}

function OutdoorForm({ selectedCandidate, selectedMode, activeOutdoorSection, setActiveOutdoorSection, outdoor, outdoorNotes, outdoorNoteDrawings, outdoorVariantChoice = {}, setOutdoorVariantChoice, outdoorExamSummaries = {}, updateOutdoorExamSummary, outdoorItemsByLevel, setOutdoorItemsByLevel, updateOutdoor, updateOutdoorNote, updateOutdoorNoteDrawing, outdoorTotal, outdoorMax, submitOutdoor, voiceRecording, toggleVoiceRecording, pauseVoiceRecording, resumeVoiceRecording, getVoiceLevels, voiceRecordingSupported, archivePlan, practicingArchive, setActivePage, examinerName, time, activeAdminPackageMeta, t }) {
  const [drawingItemId, setDrawingItemId] = useState(null);
  // A scored item shows a green, locked chip (double-click to reopen the select); this tracks which
  // items the examiner has explicitly reopened for editing.
  const [editingScoreIds, setEditingScoreIds] = useState(() => new Set());
  const unlockScoreEdit = (id) => setEditingScoreIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  const lockScoreEdit = (id) => setEditingScoreIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  const outdoorSections = effectiveOutdoorSectionsForLevel(outdoorItemsByLevel, selectedCandidate.level);
  const effectiveActiveOutdoorSection = outdoorSections.includes(activeOutdoorSection)
    ? activeOutdoorSection
    : (outdoorSections[0] ?? "generic");
  const activeItems = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level)?.[effectiveActiveOutdoorSection] ?? [];
  // Either/or exercises (e.g. Threats: halo vs soil): only the examiner-chosen variant is scored.
  const outdoorChoiceForCandidate = outdoorVariantChoice[selectedCandidate.id];
  const outdoorGroups = outdoorVariantGroups(outdoorSections);
  const isOutdoorSectionExcluded = (section) => outdoorSectionExcluded(outdoorSections, outdoorChoiceForCandidate, section);
  const chooseOutdoorVariant = (section) => {
    const { base } = outdoorSectionBaseAndVariant(section);
    if (!outdoorGroups.has(base) || typeof setOutdoorVariantChoice !== "function") return;
    setOutdoorVariantChoice((prev) => ({ ...prev, [selectedCandidate.id]: { ...(prev[selectedCandidate.id] ?? {}), [base]: section } }));
  };
  const isOutdoorFallback = isHardcodedOutdoorFallbackLevel(selectedCandidate.level, outdoorItemsByLevel?.[selectedCandidate.level]) || !hasRuntimeOutdoorLevel(outdoorItemsByLevel?.[selectedCandidate.level]);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveOutdoorForExaminer() {
      if (!setOutdoorItemsByLevel || !isOutdoorFallback) return;

      try {
        const response = await fetch("/api/centre/test-package/active");
        const data = await response.json();
        if (!response.ok) return;

        const normalized = normalizeAdminOutdoorPackage(data);
        if (!hasRuntimeOutdoorLevel(normalized?.[selectedCandidate.level])) return;

        if (!cancelled) {
          setOutdoorItemsByLevel((previous) => ({
            ...(previous && !isHardcodedOutdoorFallbackBank(previous) ? previous : {}),
            ...normalized,
          }));
        }
      } catch {
        // Fallback demo outdoor stays available when no active Admin package exists.
      }
    }

    loadActiveOutdoorForExaminer();
    return () => { cancelled = true; };
  }, [isOutdoorFallback, selectedCandidate.level, setOutdoorItemsByLevel]);

  useEffect(() => {
    if (outdoorSections.length > 0 && activeOutdoorSection !== effectiveActiveOutdoorSection) {
      setActiveOutdoorSection(effectiveActiveOutdoorSection);
    }
  }, [activeOutdoorSection, effectiveActiveOutdoorSection, outdoorSections, setActiveOutdoorSection]);

  // "Text to read at the start of the outdoor session" (package preface + candidate intro for
  // this level). Shown in a dismissable panel that auto-opens when the examiner opens a
  // candidate's outdoor form, and can be reopened from the header.
  const outdoorIntro = activeAdminPackageMeta?.outdoorIntro?.[selectedCandidate.level] || null;
  const outdoorIntroText = outdoorIntro ? [outdoorIntro.preface, outdoorIntro.candidateIntro].filter(Boolean).join("\n\n") : "";
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    setIntroOpen(Boolean(outdoorIntroText));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidate.id, selectedCandidate.level, outdoorIntroText]);

  if (!activeAdminPackageMeta || isOutdoorFallback) {
    return (
      <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          {t("outdoor.backToLanding")}
        </Button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("examiner.blockedNoAdminPackage")}</div>
      </div>
    );
  }

  const total = outdoorSections.filter((section) => !isOutdoorSectionExcluded(section)).reduce((sum, section) => sum + outdoorTotal(selectedCandidate.id, selectedCandidate.level, section), 0);
  const max = outdoorSections.filter((section) => !isOutdoorSectionExcluded(section)).reduce((sum, section) => sum + outdoorMax(selectedCandidate.level, section), 0) || scoreLimits(selectedCandidate.level).outdoorMax;
  // Closing summary block: live score, pass percentage against OUTDOOR_PASS_RATE, and the primary
  // examiner's strengths/weaknesses text (sent to the Centre on submit and printed in the PDF).
  const examSummaryText = outdoorExamSummaries?.[selectedCandidate.id] ?? "";
  const passPercent = max > 0 ? Math.round((total / max) * 1000) / 10 : 0;
  const outdoorPassed = max > 0 && total / max >= OUTDOOR_PASS_RATE;
  const passLine = `${total} / ${max} · ${passPercent} % · ${outdoorPassed ? t("outdoor.summary.passed") : t("outdoor.summary.notPassed")}`;

  const introModal = introOpen && outdoorIntroText ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("outdoor.intro.eyebrow")}</div>
            <h3 className="text-lg font-semibold">{outdoorIntro?.title || t("outdoor.intro.title")}</h3>
          </div>
          <Button type="button" onClick={() => setIntroOpen(false)} variant="outline" className="rounded-2xl"><X className="mr-1 h-4 w-4" />{t("common.close")}</Button>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{outdoorIntroText}</div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setIntroOpen(false)} className="rounded-2xl">{t("outdoor.intro.acknowledge")}</Button>
        </div>
      </div>
    </div>
  ) : null;

  function printOutdoorPdf() {
    const scores = outdoor[selectedCandidate.id] ?? {};
    const notes = outdoorNotes[selectedCandidate.id] ?? {};
    const drawings = outdoorNoteDrawings[selectedCandidate.id] ?? {};
    const bodyHtml = outdoorSections.filter((section) => !isOutdoorSectionExcluded(section)).map((section) => {
      const items = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level)?.[section] ?? [];
      const itemsHtml = items.map((item) => {
        const score = scores[item.id];
        const note = notes[item.id];
        const drawing = drawings[item.id];
        return `<section class="exam-block">
          <div class="exam-block-head"><span>[[${escapeHtml(item.id)}]]</span></div>
          <div class="exam-title">${linesToHtml(item.text || "")}</div>
          <div style="margin-top:2mm"><span class="exam-score">${score !== undefined && score !== "" ? score : "-"} / ${item.max} b.</span></div>
          ${note ? `<div class="exam-block-head" style="margin-top:2mm">${escapeHtml(t("archive.examinerNote"))}</div><div class="exam-answer">${linesToHtml(note)}</div>` : ""}
          ${drawing ? `<img class="exam-sketch" src="${drawing}" alt="${escapeHtml(t("examiner.pdf.examinerNoteSketchAlt"))}" />` : ""}
        </section>`;
      }).join("");
      return `<h2 style="font-size:12.5pt;margin:4mm 0 2mm">${escapeHtml(outdoorSectionTitle(section))}</h2>${itemsHtml}`;
    }).join("");
    const totalHtml = `<div class="exam-total">${escapeHtml(t("archive.total"))}: ${total} / ${max} b. · ${passPercent} % · ${escapeHtml(outdoorPassed ? t("outdoor.summary.passed") : t("outdoor.summary.notPassed"))} (${escapeHtml(t("outdoor.summary.passMark"))}: 70 %)</div>`;
    const summaryHtml = String(examSummaryText).trim()
      ? `<h2 style="font-size:12.5pt;margin:5mm 0 2mm">${escapeHtml(t("outdoor.summary.title"))}</h2><div class="exam-answer">${linesToHtml(examSummaryText)}</div>`
      : "";
    openPrintDocument(examinerPdfShellHtml({
      docTitle: t("examiner.pdf.outdoorReviewTitle"),
      candidate: selectedCandidate,
      examinerName,
      metaLine: `${t("common.opened")}: ${time?.openedAt || "-"} · ${t("common.closed")}: ${time?.closedAt || "-"}`,
      bodyHtml: bodyHtml + totalHtml + summaryHtml,
    }));
  }

  return <div>{introModal}<OutdoorExaminerTimer openedAtIso={time?.openedAtIso} closedAt={time?.closedAt} t={t} /><OutdoorVoiceRecorderBar voiceRecording={voiceRecording} toggleVoiceRecording={toggleVoiceRecording} pauseVoiceRecording={pauseVoiceRecording} resumeVoiceRecording={resumeVoiceRecording} getVoiceLevels={getVoiceLevels} voiceRecordingSupported={voiceRecordingSupported} selectedMode={selectedMode} selectedCandidate={selectedCandidate} t={t} /><div className="grid gap-4 lg:grid-cols-3"><div className="lg:sticky lg:top-4 lg:self-start">{outdoorIntroText && <div className="mb-3 flex flex-wrap gap-2"><Button onClick={() => setIntroOpen(true)} variant="outline" className="rounded-2xl">{t("outdoor.intro.reopen")}</Button></div>}<h3 className="font-semibold">{t("outdoor.candidateBinding")}</h3><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">{t("outdoor.activeRecord")}: <strong>{selectedCandidate.name}</strong><br />{t("outdoor.level")}: <strong>{selectedCandidate.level}</strong><br />{t("outdoor.total")}: <strong>{total}</strong> / {max}<br />{t("common.opened")}: {time?.openedAt || "-"}<br />{t("common.closed")}: {time?.closedAt || "-"}<br /><span className="text-emerald-700">{t("outdoor.sourceActivePackage")}</span></div>{selectedCandidate.level === "Practicing" && <div className="mt-3 rounded-xl border bg-white p-3 text-sm"><div className="font-semibold">{t("outdoor.paperArchive.title")}</div><p className="mt-1 text-slate-600">{t("outdoor.paperArchive.helper")}</p><label className="mt-3 flex w-full cursor-pointer items-center justify-center rounded-2xl border bg-white px-4 py-2 text-sm font-medium text-slate-950 hover:bg-slate-50">{t("outdoor.paperArchive.button")}<input type="file" accept="image/*" capture="environment" multiple onChange={(event) => { archivePlan(event.target.files); event.target.value = ""; }} className="hidden" /></label><div className="mt-2 text-xs text-slate-500">{t("outdoor.paperArchive.photos")}: {(practicingArchive[selectedCandidate.id] ?? []).length}</div>{(practicingArchive[selectedCandidate.id] ?? []).length > 0 && <div className="mt-2 grid grid-cols-4 gap-2">{(practicingArchive[selectedCandidate.id] ?? []).map((photo) => photo.dataUrl && <img key={photo.id} src={photo.dataUrl} alt={photo.name || photo.id} className="h-14 w-full rounded-lg border object-cover" />)}</div>}</div>}<div className="mt-4 space-y-2">{outdoorSections.map((section) => { const excluded = isOutdoorSectionExcluded(section); const inGroup = outdoorGroups.has(outdoorSectionBaseAndVariant(section).base); return <button key={section} onClick={() => { setActiveOutdoorSection(section); chooseOutdoorVariant(section); }} className={`w-full rounded-xl border p-3 text-left text-sm ${effectiveActiveOutdoorSection === section ? "border-slate-950 bg-slate-50" : "bg-white hover:bg-slate-50"} ${excluded ? "opacity-60" : ""}`}><div className="flex items-center justify-between gap-2"><div className="font-medium">{outdoorSectionTitle(section)}</div>{inGroup && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${excluded ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{excluded ? t("outdoor.variant.excluded") : t("outdoor.variant.counted")}</span>}</div><div className="text-xs text-slate-500">{excluded ? `— / —` : `${outdoorTotal(selectedCandidate.id, selectedCandidate.level, section)} / ${outdoorMax(selectedCandidate.level, section)}`} {t("outdoor.points")}{inGroup ? ` · ${t("outdoor.variant.pickHint")}` : ""}</div></button>; })}</div></div><div className="lg:col-span-2"><h3 className="font-semibold">{t("outdoor.detail.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("outdoor.detail.helper")}</p><div className="mt-4 space-y-3">{activeItems.map((item) => <div key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="font-mono text-xs text-slate-500">{item.id}</div><div className="whitespace-pre-wrap font-medium">{item.text}</div>{item.notes && <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{item.notes}</div>}</div><label className="text-sm font-medium md:w-36">{t("outdoor.pointsLabel")} / {item.max}{(() => { const scoreVal = outdoor[selectedCandidate.id]?.[item.id]; const hasScore = scoreVal !== undefined && scoreVal !== null && scoreVal !== ""; const editing = editingScoreIds.has(item.id); return hasScore && !editing ? <div onDoubleClick={() => unlockScoreEdit(item.id)} title={t("outdoor.editScoreHint")} className="mt-1 flex w-full cursor-pointer items-center justify-center rounded-xl border-2 border-emerald-500 bg-emerald-50 p-2 text-base font-bold text-emerald-800">{formatHalfPointScore(scoreVal)}</div> : <select autoFocus={editing} value={scoreVal ?? ""} onChange={(e) => { updateOutdoor(item.id, e.target.value); if (e.target.value !== "") lockScoreEdit(item.id); }} className="mt-1 w-full rounded-xl border bg-white p-2"><option value="">-</option>{outdoorHalfPointOptions(item.max).map((option) => <option key={option} value={option}>{formatHalfPointScore(option)}</option>)}</select>; })()}</label></div><textarea value={outdoorNotes[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoorNote(item.id, e.target.value)} placeholder={t("outdoor.examinerNotes")} className="mt-3 min-h-16 w-full rounded-xl border bg-white p-3 text-sm" /><div className="mt-2 flex flex-wrap items-center gap-2">{outdoorNoteDrawings[selectedCandidate.id]?.[item.id] && <img src={outdoorNoteDrawings[selectedCandidate.id][item.id]} alt="" onDoubleClick={() => setDrawingItemId(item.id)} title={t("outdoor.editSketch")} className="h-12 w-20 cursor-pointer rounded-lg border object-cover" />}<Button type="button" onClick={() => setDrawingItemId(item.id)} variant="outline" className="rounded-2xl"><Pencil className="mr-1 h-4 w-4" />{outdoorNoteDrawings[selectedCandidate.id]?.[item.id] ? t("outdoor.editSketch") : t("outdoor.addSketch")}</Button>{outdoorNoteDrawings[selectedCandidate.id]?.[item.id] && <Button type="button" onClick={() => updateOutdoorNoteDrawing(item.id, "")} variant="outline" className="rounded-2xl">{t("outdoor.removeSketch")}</Button>}</div>{drawingItemId === item.id && <HandwritingPad onClose={() => setDrawingItemId(null)} onSave={(dataUrl) => { updateOutdoorNoteDrawing(item.id, dataUrl); setDrawingItemId(null); }} existingImage={outdoorNoteDrawings[selectedCandidate.id]?.[item.id] || null} tallCanvas lockMaximized templateText={item.notes || ""} title={t("outdoor.sketchTitle")} helperText={t("outdoor.sketchHelper")} t={t} Button={Button} CloseIcon={X} EraserIcon={Eraser} UndoIcon={Undo} />}</div>)}</div><div className="mt-6 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("outdoor.summary.title")}</h3><span className={`rounded-full px-3 py-1.5 text-sm font-bold ${outdoorPassed ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>{passLine}</span></div><p className="mt-1 text-sm text-slate-600">{t("outdoor.summary.helper")} · {t("outdoor.summary.passMark")}: 70 %</p><textarea value={examSummaryText} onChange={(e) => updateOutdoorExamSummary?.(e.target.value)} disabled={selectedMode !== "primary"} placeholder={t("outdoor.summary.placeholder")} className="mt-3 min-h-28 w-full rounded-xl border bg-white p-3 text-sm disabled:bg-slate-50 disabled:text-slate-500" />{selectedMode !== "primary" && <p className="mt-1 text-xs text-slate-500">{t("outdoor.summary.primaryOnly")}</p>}</div><div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => setActivePage("landing")} variant="outline" className="rounded-2xl"><span aria-hidden="true">←</span> {t("examiner.backNoSave")}</Button><Button onClick={submitOutdoor} disabled={selectedMode === "unassigned"} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" /> {t("outdoor.submit")}</Button><Button onClick={printOutdoorPdf} variant="outline" className="rounded-2xl">{t("examiner.pdfWithGrading")}</Button>{selectedMode !== "secondary" && <StatusPill tone={selectedMode === "primary" ? "good" : "default"}>{selectedMode === "primary" ? t("outdoor.mode.primary") : t("outdoor.mode.unassigned")}</StatusPill>}</div></div></div></div>;
}

export default function VetBaraApp() {
  return (
    <VetBaraErrorBoundary>
      <VetBaraPrototype />
    </VetBaraErrorBoundary>
  );
}
