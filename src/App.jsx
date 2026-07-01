import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { bootstrapSession, resolveQrToken, syncBatch, fetchCandidateEvaluation, exportCandidateEvaluation, exportCentreAuditPackage, downloadBase64File, loadCentreSetup } from "./lib/api";
import { CandidateQuickHelp, ExaminerQuickHelp, PilotReleaseNotesPanel, PilotSmokeTestChecklist } from "./components/PilotInfoPanels";
import { EvaluationPreviewCard } from "./components/EvaluationPreviewCard";
import { AuditSyncView } from "./components/AuditSyncView";
import { CentreNetworkReadinessChecklist, CentreValidationSummary, PilotReadinessGuardrails, PilotRunSummary } from "./components/CentreReadinessPanels";
import { CentreQrAccessPack } from "./components/CentreQrAccessPack";
import { LANGUAGES as UI_LANGUAGES, makeTranslator } from "./i18n";
import { QRCodeSVG } from "qrcode.react";

async function saveCentreSetupWithTestPackage(sessionToken, { candidates, examiners, assignments, testPackage }) {
  const response = await fetch("/api/centre/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, action: "save", candidates, examiners, assignments, testPackage }),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "object" && body?.error ? body.error : `Request failed: ${response.status}`);
  return body;
}

function Button({ children, className = "", variant = "default", ...props }) {
  const base = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none";
  const styles = variant === "outline" ? "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "bg-slate-950 text-white hover:bg-slate-800";
  return <button className={`${base} ${styles} ${className}`} {...props}>{children}</button>;
}
function Card({ children, className = "" }) { return <div className={`border bg-white ${className}`}>{children}</div>; }
function CardContent({ children, className = "" }) { return <div className={className}>{children}</div>; }

class VetBaraErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-5 shadow-sm">
            <h1 className="text-2xl font-bold text-rose-950">VetBara runtime chyba</h1>
            <p className="mt-2 text-sm text-rose-900">Pošlete tento text vývojáři.</p>
            <pre className="mt-4 overflow-auto rounded-xl bg-white p-4 text-xs text-rose-950">
              {String(this.state.error?.message || this.state.error || "Neznámá chyba")}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}


function RuntimeCrashScreen({ error }) {
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-rose-950">VetBara runtime chyba</h1>
        <p className="mt-2 text-sm text-rose-900">
          Aplikace nespadla do bílé obrazovky, ale zachytila chybu. Pošlete tento text vývojáři.
        </p>
        <pre className="mt-4 overflow-auto rounded-xl bg-white p-4 text-xs text-rose-950">
          {String(error?.message || error || "Neznámá chyba")}
        </pre>
      </div>
    </main>
  );
}

function VetCertRulesReference() {
  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="font-semibold">VETcert Rules reference</div>
      <p className="mt-1">
        Oficiální pravidla zkoušky jsou referenční dokument pro průběh certifikace.
        Zkušební materiály, vzorové odpovědi a dokončené zkoušky jsou důvěrné.
      </p>
      <p className="mt-2 text-xs">
        Kandidátům ani zkoušejícím v hodnoticím rozhraní nezobrazovat správné odpovědi,
        answer key ani návodné hodnoticí poznámky.
      </p>
    </div>
  );
}

function StatusPill({ children, tone = "default" }) {
  const cls = { good: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-rose-100 text-rose-800", default: "bg-slate-100 text-slate-700" }[tone] || "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}
function IconBase({ children, className = "h-5 w-5" }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>; }
function BadgeCheck({ className }) { return <IconBase className={className}><path d="M8 12.5l2.5 2.5L16 9" /><path d="M12 2l2.1 2.2 3-.4.8 2.9 2.7 1.4-1.4 2.7.4 3-2.9.8-1.4 2.7-3-.4L12 22l-2.1-2.2-3 .4-.8-2.9-2.7-1.4 1.4-2.7-.4-3 2.9-.8 1.4-2.7 3 .4L12 2z" /></IconBase>; }
function CloudOff({ className }) { return <IconBase className={className}><path d="M3 3l18 18" /><path d="M17.5 17H8a5 5 0 0 1-.8-9.9A6.5 6.5 0 0 1 18.7 9" /><path d="M20 16.5A3.5 3.5 0 0 0 18.5 10" /></IconBase>; }
function FileSpreadsheet({ className }) { return <IconBase className={className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h8" /><path d="M11 10v9" /></IconBase>; }
function Languages({ className }) { return <IconBase className={className}><path d="M4 5h8" /><path d="M8 5v12" /><path d="M4 17c3-2 5-5 6-12" /><path d="M12 17c-2-1-4-3-6-6" /><path d="M15 19l3-7 3 7" /><path d="M16 17h4" /></IconBase>; }
function Lock({ className }) { return <IconBase className={className}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></IconBase>; }
function ShieldCheck({ className }) { return <IconBase className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-5" /></IconBase>; }
function Tablet({ className }) { return <IconBase className={className}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></IconBase>; }
function Users({ className }) { return <IconBase className={className}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></IconBase>; }
function QrCodeIcon({ className }) { return <IconBase className={className}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h2v2h-2z" /><path d="M18 14h3" /><path d="M14 18h3" /><path d="M19 18h2v3h-3" /></IconBase>; }
function SectionTitle({ icon: Icon, title, subtitle }) { return <div className="mb-4 flex items-start gap-3"><div className="rounded-2xl bg-slate-100 p-2"><Icon className="h-5 w-5" /></div><div><h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div></div>; }

const LANGUAGES = ["EN", "CZ", "PL", "DE", "NL"];
const EXAM_LEVELS = ["Practicing", "Consulting"];
const ROLES = ["Admin", "Centre", "Candidate", "Examiner"];
const CENTRES = ["Arboricultural Academy", "VETcert Centre Poland", "VETcert Centre Germany", "VETcert Centre Netherlands"];
const CENTRE_ACCESS_TOKEN = "VETBARA-CENTRE-ARBOR-2026";
const CENTRE_QR_ID = "ARBOR-2026";
const DEMO_QR_TOKENS = {
  Centre: CENTRE_ACCESS_TOKEN,
  Candidate: "VETBARA-CANDIDATE-C-001-2026",
  Examiner: "VETBARA-EXAMINER-E-001-2026",
};
const EXAMINERS = [
  { id: "E-001", name: "Examiner 1", birthDate: "", registrationId: "EX-DEMO-001" },
  { id: "E-002", name: "Examiner 2", birthDate: "", registrationId: "EX-DEMO-002" },
  { id: "E-003", name: "Examiner 3", birthDate: "", registrationId: "EX-DEMO-003" },
];
const START_CANDIDATES = [
  { id: "C-001", name: "Candidate 1", birthDate: "", documentId: "", level: "Consulting", status: "Ready", written: null, outdoor: null, report: null },
  { id: "C-002", name: "Candidate 2", birthDate: "", documentId: "", level: "Practicing", status: "Ready", written: null, outdoor: null, report: null },
  { id: "C-003", name: "Candidate 3", birthDate: "", documentId: "", level: "Practicing", status: "Ready", written: null, outdoor: null, report: null },
  { id: "C-004", name: "Candidate 4", birthDate: "", documentId: "", level: "Consulting", status: "Ready", written: null, outdoor: null, report: null },
];
const START_ASSIGNMENTS = { "C-001": { primary: "E-001", secondary: "E-002" }, "C-002": { primary: "E-002", secondary: "E-003" }, "C-003": { primary: "E-003", secondary: "E-001" }, "C-004": { primary: "E-001", secondary: "E-003" } };
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
const REPORT_SECTIONS = ["Health and vitality", "Structural condition / biomechanics", "Wildlife, historical, cultural or social values", "Threats to the tree", "Management plan", "Management justification summary"].map((title, i) => ({ key: `s${i + 1}`, title }));
const CANDIDATE_SECTIONS = { Practicing: [{ key: "field-orientation", title: "Orientace", description: "Fullscreen map for orientation on the field site." }, { key: "field-trees", title: "Příprava stromů", description: "Readonly tree cards A-D with candidate notes." }, { key: "test", title: "Written test", description: "Complete and submit the Practicing written test." }], Consulting: [{ key: "field-orientation", title: "Orientace", description: "Fullscreen map for orientation on the field site." }, { key: "field-trees", title: "Příprava stromů", description: "Readonly tree cards A-D with candidate notes." }, { key: "test", title: "Written test", description: "Complete and submit the Consulting written test." }, { key: "report", title: "Report for 2 trees", description: "Collect field data and finalize the report for Tree A and Tree B." }] };
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

function nowStamp() { return new Date().toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function createReportDraft() { return REPORT_TREES.reduce((acc, tree) => ({ ...acc, [tree]: { fieldNotes: "", photos: [], finalSections: REPORT_SECTIONS.reduce((s, sec) => ({ ...s, [sec.key]: "" }), {}) } }), {}); }
function createSectionStatus(level) { return CANDIDATE_SECTIONS[level].reduce((acc, sec) => ({ ...acc, [sec.key]: "locked" }), {}); }
function scoreLimits(level) { return level === "Consulting" ? { writtenMax: 97, outdoorMax: 58, reportMax: 117 } : { writtenMax: 46, outdoorMax: 102, reportMax: 0 }; }
function sumQuestionBankMax(questions) { return Array.isArray(questions) ? questions.reduce((sum, question) => sum + writtenQuestionMax(question), 0) : 0; }
function sumOutdoorItemsMax(itemsBySection) { return Object.values(itemsBySection ?? {}).flat().reduce((sum, item) => sum + Number(item?.max ?? 0), 0); }
function scoreLimitsForCandidate(candidate, variants, testBank, outdoorItemsByLevel) {
  const fallback = scoreLimits(candidate?.level);
  const variantCode = variants?.[candidate?.level];
  const writtenMax = sumQuestionBankMax(testBank?.[variantCode]) || fallback.writtenMax;
  const outdoorMax = sumOutdoorItemsMax(effectiveOutdoorItemsForLevel(outdoorItemsByLevel, candidate?.level)) || fallback.outdoorMax;
  return { ...fallback, writtenMax, outdoorMax };
}
function safeRatio(score, max) { return max > 0 ? score / max : 0; }
function scoreCandidate(c, limits = scoreLimits(c?.level)) { const l = limits; const w = Number(c?.written ?? 0); const o = Number(c?.outdoor ?? 0); const r = c?.level === "Consulting" ? Number(c?.report ?? 0) : 0; const total = w + o + r; const max = l.writtenMax + l.outdoorMax + l.reportMax; const pass = safeRatio(w, l.writtenMax) >= 0.5 && safeRatio(o, l.outdoorMax) >= 0.5 && (c?.level !== "Consulting" || safeRatio(r, l.reportMax) >= 0.5) && safeRatio(total, max) >= 0.75; return { ...l, total, max, percentage: max > 0 ? Math.round((total / max) * 1000) / 10 : 0, pass }; }
function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function storedAnswerValue(row) { const answer = row?.answer; return isObject(answer) ? answer.selectedAnswer ?? answer.answer ?? answer.value ?? "" : answer ?? ""; }
function isBackendPersistenceUnavailable(error) {
  const message = String(error?.message ?? error ?? "");
  return error?.status === 503 || /503/.test(message) || /Backend persistence is not configured/i.test(message);
}

function RealQr({ value, size = 112 }) {
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

function qrAccessFromCurrentUrl() {
  try {
    const query = new URLSearchParams(window.location.search);
    return {
      role: query.get("role") || "",
      id: query.get("id") || "",
      token: query.get("token") || "",
      level: query.get("level") || "",
      name: query.get("name") || "",
    };
  } catch {
    return { role: "", id: "", token: "", level: "", name: "" };
  }
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

  function submitManualPayload() {
    const value = manualPayload.trim();
    if (!value) {
      window.alert("Vložte QR odkaz nebo payload.");
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
            <p className="text-sm text-slate-600">
              QR kamera je dočasně vypnutá kvůli stabilitě Examiner portálu. Použijte ruční vložení QR odkazu nebo offline payloadu.
            </p>
          </div>
          <Button onClick={onClose} variant="outline" className="rounded-2xl">
            {t("common.close")}
          </Button>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Stabilní fallback režim</div>
          <p className="mt-1">
            Zkopírujte QR odkaz / obsah QR kódu ze zdrojového zařízení a vložte jej níže.
            Kamerové skenování vrátíme samostatně až po ověření na HTTPS tabletu.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <h4 className="font-semibold">Ruční načtení QR payloadu</h4>
          <p className="mt-1 text-sm text-slate-600">
            Vložte sem odkaz z QR kódu, obsah QR, nebo offline JSON manifest kandidáta.
          </p>
          <textarea
            value={manualPayload}
            onChange={(e) => setManualPayload(e.target.value)}
            placeholder="Např. https://.../?role=Candidate&id=C-001&token=... nebo JSON balíček"
            className="mt-3 min-h-32 w-full rounded-xl border bg-white p-3 text-sm font-mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={submitManualPayload} className="rounded-2xl">
              Načíst vložený obsah
            </Button>
            <Button onClick={() => setManualPayload("")} variant="outline" className="rounded-2xl">
              Vymazat
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReopenSectionModal({ sectionKey, error, onConfirm, onCancel }) {
  const [password, setPassword] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">Znovuotevření uzavřené části</h3>
        <p className="mt-2 text-sm text-slate-600">
          Část <strong>{sectionKey}</strong> je uzavřená. Znovuotevření musí schválit dohlížející pracovník (Vetarbo) zadáním schvalovacího hesla přímo na tomto zařízení.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(password); }}
          placeholder="Schvalovací heslo"
          className="mt-3 w-full rounded-xl border bg-white p-2 font-mono text-sm"
        />
        {error && <p className="mt-2 rounded-xl bg-rose-50 p-2 text-sm font-medium text-rose-900">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => onConfirm(password)} className="rounded-2xl">Potvrdit</Button>
          <Button onClick={onCancel} variant="outline" className="rounded-2xl">Zrušit</Button>
        </div>
      </div>
    </div>
  );
}


function VetBaraPrototype() {
  const [runtimeError, setRuntimeError] = useState(null);
  const fieldTabletMode = (() => {
    try {
      const query = new URLSearchParams(window.location.search);
      return query.get("mode") === "field-tablet" || query.get("role") === "FieldTablet";
    } catch {
      return false;
    }
  })();

  if (fieldTabletMode) return <FieldTabletPage />;

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
  const [examDate, setExamDate] = useState("2026-03-31");
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
  const [adminPdfPackageList, setAdminPdfPackageList] = useState([]);
  const [adminPdfPackageLatest, setAdminPdfPackageLatest] = useState(null);
  const [variants, setVariants] = useState({ Practicing: "PRACTICING_2026_V1_CZ", Consulting: "CONSULTING_2026_V1_EN" });
  const [status, setStatus] = useState("Draft by Admin");
  const [centreUnlocked, setCentreUnlocked] = useState(false);
  const [centreCode, setCentreCode] = useState("");
  const [candidates, setCandidates] = useState(START_CANDIDATES);
  const [examiners, setExaminers] = useState(EXAMINERS);
  const [selectedCandidateId, setSelectedCandidateId] = useState("C-001");
  const [loggedCandidateId, setLoggedCandidateId] = useState(null);
  const [candidateConfirmed, setCandidateConfirmed] = useState({});
  const [candidateStatus, setCandidateStatus] = useState({ "C-001": createSectionStatus("Consulting"), "C-002": createSectionStatus("Practicing"), "C-003": createSectionStatus("Practicing"), "C-004": createSectionStatus("Consulting") });
  const [candidateTimes, setCandidateTimes] = useState({});
  const [activeCandidateSection, setActiveCandidateSection] = useState("landing");
  const [testResponses, setTestResponses] = useState({});
  const [importedCandidatePackages, setImportedCandidatePackages] = useState({});
  const [reportDrafts, setReportDrafts] = useState({ "C-001": createReportDraft(), "C-004": createReportDraft() });
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
  const [outdoorItemsByLevel, setOutdoorItemsByLevel] = useState({});
  const [activeAdminPackageMeta, setActiveAdminPackageMeta] = useState(null);
  const [activeOutdoorSection, setActiveOutdoorSection] = useState("generic");
  const [examinerTimes, setExaminerTimes] = useState({});
  const [practicingArchive, setPracticingArchive] = useState({});
  const [audit, setAudit] = useState([{ id: "A-001", action: "Exam event opened", target: "Exam event", time: "09:00", detail: "Initial offline package prepared" }]);
  const [sync, setSync] = useState([{ id: "S-001", type: "Exam package", status: "Ready offline" }]);
  const [scannerMode, setScannerMode] = useState(null);
  const [lastEvaluation, setLastEvaluation] = useState(null);
  const [authenticatedPortalRole, setAuthenticatedPortalRole] = useState(null);
  const [activeSessionToken, setActiveSessionToken] = useState(null);
  const [reopenRequest, setReopenRequest] = useState(null);
  const [evaluationPreview, setEvaluationPreview] = useState(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");
  const [centreSetupLoading, setCentreSetupLoading] = useState(false);
  const [centreSetupSaving, setCentreSetupSaving] = useState(false);
  const [centreSetupError, setCentreSetupError] = useState("");
  const [centreSetupStatus, setCentreSetupStatus] = useState("");
  const [centreAuditExportLoading, setCentreAuditExportLoading] = useState(false);
  const [centreAuditExportError, setCentreAuditExportError] = useState("");
  const [centreQrAccess, setCentreQrAccess] = useState({ candidates: [], examiners: [] });
  const [centreValidationIssues, setCentreValidationIssues] = useState([]);
  const [centreSetupDirty, setCentreSetupDirty] = useState(false);

  const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId) ?? candidates[0];
  const loggedCandidate = candidates.find((c) => c.id === loggedCandidateId) ?? null;
  const loggedExaminer = EXAMINERS.find((e) => e.id === loggedExaminerId) ?? null;
  const assignedCandidates = loggedExaminer ? candidates.filter((c) => [assignments[c.id]?.primary, assignments[c.id]?.secondary].includes(loggedExaminer.id)) : [];
  const selectedMode = loggedExaminer && assignments[selectedCandidate.id]?.primary === loggedExaminer.id ? "primary" : loggedExaminer && assignments[selectedCandidate.id]?.secondary === loggedExaminer.id ? "secondary" : "unassigned";
  const activeScoreLimits = useMemo(() => scoreLimitsForCandidate(selectedCandidate, variants, testBank, outdoorItemsByLevel), [selectedCandidate, variants, testBank, outdoorItemsByLevel]);
  const scoring = useMemo(() => scoreCandidate(selectedCandidate, activeScoreLimits), [selectedCandidate, activeScoreLimits]);
  const summary = useMemo(() => ({ total: candidates.length, practicing: candidates.filter((c) => c.level === "Practicing").length, consulting: candidates.filter((c) => c.level === "Consulting").length }), [candidates]);
  const addAudit = (action, target, detail = "") => setAudit((prev) => [{ id: `A-${prev.length + 1}`, action, target, detail, time: nowStamp() }, ...prev]);
  const queue = (type, detail = "") => setSync((prev) => [{ id: `S-${prev.length + 1}`, type, detail, status: "Pending sync" }, ...prev]);
  const payload = (roleName, id, token = `VETBARA-${roleName.toUpperCase()}-${id}-2026`) => {
    const url = new URL(window.location.pathname || "/", window.location.origin);
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
  const knownExaminer = (id) => EXAMINERS.some((examiner) => examiner.id === id);

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

      setActiveCertificationPackageStatus(`Aktivní balíček načten: ${data.packageId}`);
    } catch (error) {
      setActiveCertificationPackageError(error.message || "Načtení aktivního balíčku selhalo.");
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
        setActiveCertificationPackageStatus(`Aktivní Admin JSON balíček automaticky načten: ${data.packageId}`);
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

  async function resolveAccessWithFallback(parsed, detail) {
    const token = parsed.token || parsed.raw || window.location.href;
    try {
      const resolved = await resolveQrToken(token);
      const session = await bootstrapSession(resolved.sessionToken);
      return { ...resolved, ...session, sessionToken: resolved.sessionToken };
    } catch (error) {
      // Only fall back to local demo matching when there was no backend to authoritatively
      // answer at all (offline LAN use, plain `vite dev` with no API, network down). A
      // definitive server answer (e.g. 401 invalid token) must be respected as-is —
      // otherwise anyone could present one of the public demo-token constants and get the
      // client to grant access locally even though the server explicitly rejected it, which
      // is exactly the gap this fixes.
      if (!error?.isBackendUnavailable) {
        console.warn("QR/session request rejected by server", error);
        addAudit("QR resolve failed", parsed.id ?? "Unknown QR", error?.message || "The QR could not be verified.");
        return null;
      }
      console.error("Backend unreachable; using local demo fallback when available", error);
      const fallback = demoAccess(parsed);
      if (fallback) {
        addAudit("Backend unavailable", fallback.subjectId ?? fallback.role, `${detail}; local demo fallback used`);
        return fallback;
      }
      addAudit("QR resolve failed", parsed.id ?? "Unknown QR", "The QR could not be verified.");
      return null;
    }
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

    if (access.role === "Centre") {
      setCentreUnlocked(true);
      setRole("Centre");
      addAudit("Centre workspace opened", centre, detail);
      return;
    }

    if (access.role === "Candidate") {
      if (access.profile && Object.values(access.profile).some((value) => String(value ?? "").trim())) {
        setCandidates((previous) => previous.map((candidate) => candidate.id === access.subjectId ? { ...candidate, ...Object.fromEntries(Object.entries(access.profile).filter(([, value]) => String(value ?? "").trim())) } : candidate));
      }

      if (knownCandidate(access.subjectId)) {
        setRole("Candidate");
        loginCandidate(access.subjectId);
        hydrateCandidateProgress(access.sessionToken, access.subjectId);
        return;
      }
    }

    if (access.role === "Examiner" && knownExaminer(access.subjectId)) {
      setRole("Examiner");
      loginExaminer(access.subjectId);
      hydrateExaminerOutdoorProgress(access.sessionToken, access.subjectId);
      return;
    }

    addAudit("QR role blocked", access.role ?? "Unknown role", "Resolved role or subject does not match this portal package");
  }

  // Centre unlock for a ?role=Centre&token=... direct link is handled by the openQrSession
  // effect above (server-verified), not here. This used to also unlock straight from the URL
  // by comparing the token to the single hardcoded CENTRE_ACCESS_TOKEN client-side.

  async function handleQrScan(text) {
    const offlinePackage = parseOfflineCandidatePackage(text);

    if (offlinePackage) {
      importOfflineCandidatePackage(offlinePackage);
      setScannerMode(null);
      return;
    }

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

  async function loadEvaluationPreview(candidateId) {
    if (!activeSessionToken) {
      setEvaluationError(t("status.evaluation.previewSessionRequired"));
      return;
    }

    setEvaluationLoading(true);
    setEvaluationError("");

    try {
      const result = await fetchCandidateEvaluation(activeSessionToken, candidateId);
      setEvaluationPreview(result);
    } catch (error) {
      console.error("Evaluation preview failed", error);
      setEvaluationError(t("status.evaluation.previewUnavailable"));
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function downloadDraftExport(candidateId) {
    if (!activeSessionToken) {
      setExportError(t("status.export.sessionRequired"));
      return;
    }

    setExportLoading(true);
    setExportError("");

    try {
      const result = await exportCandidateEvaluation(activeSessionToken, candidateId, "xls");
      downloadBase64File(result);
    } catch (error) {
      console.error("Draft export failed", error);
      setExportError(t("status.export.unavailable"));
    } finally {
      setExportLoading(false);
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

    if (isObject(result.testPackage)) {
      if (Array.isArray(result.testPackage.availableVariants)) setAvailableVariants(result.testPackage.availableVariants);
      if (isObject(result.testPackage.variants)) setVariants((previous) => ({ ...previous, ...result.testPackage.variants }));
      if (isObject(result.testPackage.testBank)) setTestBank(result.testPackage.testBank);
      if (isObject(result.testPackage.outdoorItemsByLevel)) {
        const storedOutdoorItemsByLevel = result.testPackage.outdoorItemsByLevel;
        if (!isHardcodedOutdoorFallbackBank(storedOutdoorItemsByLevel)) {
          setOutdoorItemsByLevel(storedOutdoorItemsByLevel);
        }
      }
      if (isObject(result.testPackage.activeAdminPackageMeta)) setActiveAdminPackageMeta(result.testPackage.activeAdminPackageMeta);
      const summary = result.testPackage.summary ?? result.testPackage.testImportSummary ?? null;
      if (summary) setTestImportSummary(summary);
      setTestImportError("");
      setTestImportStatus(summary?.variants && summary?.questions
        ? tf("status.testImport.loadedStoredFull", { variants: summary.variants, questions: summary.questions })
        : t("status.testImport.loadedStored"));
    }
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
      return;
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
      });
      setCentreQrAccess(result.qrAccess ?? { candidates: [], examiners: [] });
      setCentreSetupDirty(false);
      setCentreSetupStatus(tf("status.centreSetup.savedEvent", { event: result.examEventId || "current" }));
    } catch (error) {
      console.error("Centre Setup save failed", error);
      setCentreSetupError(isBackendPersistenceUnavailable(error) ? t("status.backendPersistenceUnavailable") : t("status.centreSetup.saveFailed"));
    } finally {
      setCentreSetupSaving(false);
    }
  }

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
  function addCandidate() { setCentreSetupDirty(true); const id = `C-${String(candidates.length + 1).padStart(3, "0")}`; const level = enabledLevels[0] ?? "Practicing"; const c = { id, name: `New candidate ${candidates.length + 1}`, level, status: "Ready", written: null, outdoor: null, report: null }; setCandidates((prev) => [...prev, c]); setCandidateStatus((prev) => ({ ...prev, [id]: createSectionStatus(level) })); setAssignments((prev) => ({ ...prev, [id]: { primary: examiners[0]?.id ?? "", secondary: examiners[1]?.id ?? "" } })); setSelectedCandidateId(id); }
  function removeCandidate(candidateId) {
    if (candidates.length <= 2) {
      window.alert("Nejmenší povolený počet jsou 2 kandidáti.");
      return;
    }

    const candidate = candidates.find((item) => item.id === candidateId);
    if (!window.confirm(`Opravdu odstranit kandidáta ${candidate?.name ?? candidateId}?`)) return;

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
      window.alert("Nejmenší povolený počet jsou 2 examineři.");
      return;
    }

    const examiner = examiners.find((item) => item.id === examinerId);
    if (!window.confirm(`Opravdu odstranit examinera ${examiner?.name ?? examinerId}?`)) return;

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

  function performOpenCandidateSection(key, previousStatus) {
    const openedAt = nowStamp();
    const openedAtIso = new Date().toISOString();
    setCandidateStatus((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level)), [key]: "open" } }));
    setCandidateTimes((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? {}), [key]: { ...(prev[loggedCandidate.id]?.[key] ?? {}), openedAt, openedAtIso, closedAt: null, closedAtIso: null } } }));
    setActiveCandidateSection(key);
    addAudit(previousStatus === "closed" ? "Candidate section reopened" : "Candidate section opened", loggedCandidate.name, `${key} / ${openedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`candidate-section-opened-${loggedCandidate.id}-${key}`), type: previousStatus === "closed" ? "candidate_section.reopened" : "candidate_section.opened", entityType: "candidate_section", entityId: `${loggedCandidate.id}:${key}`, candidateId: loggedCandidate.id, payload: { sectionKey: key, openedAt: openedAtIso, openedAtLabel: openedAt }, createdAt: openedAtIso });
  }

  function confirmReopenRequest(password) {
    if (!reopenRequest) return;
    if (password !== "Vetarbo") {
      setReopenRequest((prev) => prev && { ...prev, error: "Neplatné heslo. Znovuotevření nebylo povoleno." });
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
    const photo = {
      id: `P-${photos.length + 1}`,
      name: filePhoto.name,
      type: filePhoto.type,
      size: filePhoto.size,
      dataUrl: filePhoto.dataUrl,
      description: filePhoto.description ?? "",
      useInReport: filePhoto.useInReport ?? true,
      caption: filePhoto.name || `${tree} candidate photo ${photos.length + 1}`,
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

  function submitReport() { if (!loggedCandidate) return; setCandidates((prev) => prev.map((c) => c.id === loggedCandidate.id ? { ...c, status: "Report submitted" } : c)); closeCandidateSection("report"); }
  function loginExaminer(id) { setLoggedExaminerId(id); setActiveExaminerPage("landing"); const first = candidates.find((c) => [assignments[c.id]?.primary, assignments[c.id]?.secondary].includes(id)); if (first) setSelectedCandidateId(first.id); addAudit("Examiner logged in", EXAMINERS.find((e) => e.id === id)?.name ?? id, "QR accepted"); }
  function confirmExaminer() { if (!loggedExaminer) return; setExaminerConfirmed((prev) => ({ ...prev, [loggedExaminer.id]: true })); addAudit("Examiner identity confirmed", loggedExaminer.name, loggedExaminer.registrationId); }
  function setPrimary(candidateId, examinerId, primary) { setAssignments((prev) => { const current = prev[candidateId] ?? {}; return { ...prev, [candidateId]: primary ? { primary: examinerId, secondary: current.primary && current.primary !== examinerId ? current.primary : current.secondary } : { ...current, secondary: examinerId, primary: current.primary === examinerId ? current.secondary : current.primary } }; }); }
  async function openOutdoor(candidateId) {
    const c = candidates.find((x) => x.id === candidateId);
    if (!c || !loggedExaminer) return;
    const assignment = assignments[candidateId] ?? {};
    const mode = assignment.primary === loggedExaminer.id ? "primary" : assignment.secondary === loggedExaminer.id ? "secondary" : "unassigned";
    if (mode === "unassigned") return;
    const prior = examinerTimes[loggedExaminer.id]?.[candidateId]?.outdoor;
    if (prior?.closedAt && !confirmedReopenAllowed("Outdoor form")) return;
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
    if (loggedExaminer && examinerTimes[loggedExaminer.id]?.[candidateId]?.written?.closedAt && !confirmedReopenAllowed("Written test review")) return;
    setSelectedCandidateId(candidateId);
    setActiveExaminerPage("writtenReview");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function openExaminerReportReview(candidateId) {
    if (loggedExaminer && examinerTimes[loggedExaminer.id]?.[candidateId]?.report?.closedAt && !confirmedReopenAllowed("Report review")) return;
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
    sendSyncEvent({ clientEventId: localEventId(`outdoor-score-saved-${selectedCandidate.id}-${loggedExaminer.id}-${itemId}`), type: "outdoor_score.saved", entityType: "outdoor_score", entityId: `${selectedCandidate.id}:${itemId}`, candidateId: selectedCandidate.id, payload: { candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, sectionKey: activeOutdoorSection, itemId, score: points, updatedAt }, createdAt: updatedAt });
  }

  function updateOutdoorNote(itemId, note) {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const updatedAt = new Date().toISOString();
    const currentScore = outdoor[selectedCandidate.id]?.[itemId] ?? null;

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
        updatedAt,
      },
      createdAt: updatedAt,
    });
  }

  function outdoorTotal(candidateId, level, section) {
    const values = outdoor[candidateId] ?? {};
    return (effectiveOutdoorItemsForLevel(outdoorItemsByLevel, level)?.[section] ?? []).reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0);
  }

  function outdoorMax(level, section) {
    return (effectiveOutdoorItemsForLevel(outdoorItemsByLevel, level)?.[section] ?? []).reduce((sum, item) => sum + Number(item.max ?? 0), 0);
  }

  function submitOutdoor() {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const values = outdoor[selectedCandidate.id] ?? {};
    const items = Object.values(effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level)).flat();
    const total = items.reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0);
    const max = items.reduce((sum, item) => sum + Number(item.max ?? 0), 0) || activeScoreLimits.outdoorMax;
    const closedAt = nowStamp();
    const submittedAt = new Date().toISOString();
    const cappedTotal = Math.min(total, max);
    const ok = window.confirm(`Odeslat a uzavřít OUTDOOR pro ${selectedCandidate.name}?\n\nVýsledek: ${cappedTotal} / ${max} bodů.`);
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
    sendSyncEvent({ clientEventId: localEventId(`outdoor-assessment-submitted-${selectedCandidate.id}-${loggedExaminer.id}`), type: "outdoor_assessment.submitted", entityType: "outdoor_assessment", entityId: `${selectedCandidate.id}:outdoor`, candidateId: selectedCandidate.id, payload: { candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, sectionKey: "outdoor", submittedAt, closedAtLabel: closedAt, total: cappedTotal, max, scores: values, notes: outdoorNotes[selectedCandidate.id] ?? {} }, createdAt: submittedAt });
    setActiveExaminerPage("landing");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }
  function archivePlan() { if (!loggedExaminer || selectedCandidate.level !== "Practicing") return; setPracticingArchive((prev) => ({ ...prev, [selectedCandidate.id]: [...(prev[selectedCandidate.id] ?? []), { id: `MP-${(prev[selectedCandidate.id] ?? []).length + 1}`, capturedBy: loggedExaminer.name }] })); }
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
      saveExaminerResultToLocalServer({
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
  function generateEvaluation() { const s = scoreCandidate(selectedCandidate, activeScoreLimits); setLastEvaluation({ candidate: selectedCandidate.name, level: selectedCandidate.level, total: s.total, max: s.max, percentage: s.percentage, result: s.pass ? "PASS" : "NOT PASSED" }); }

  const centreDataMode = centreSetupStatus || centreQrAccess?.candidates?.length || centreQrAccess?.examiners?.length ? "backend" : "demo";

  if (runtimeError) return <RuntimeCrashScreen error={runtimeError} />;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-7xl">
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div className="flex items-start gap-4"><img src="/brand/vetcert-logo.jpg" alt="VETcert Certified Veteran Tree Specialist" className="h-14 w-14 shrink-0 rounded-full border bg-white object-contain p-1 shadow-sm md:h-16 md:w-16" /><div><div className="mb-2 flex flex-wrap items-center gap-2"><div className="rounded-2xl bg-slate-950 px-3 py-1 text-sm font-semibold text-white">{t("app.title")}</div><StatusPill tone="warn">{t("app.mvpPrototype")}</StatusPill><StatusPill><CloudOff className="mr-1 h-3.5 w-3.5" /> {t("app.offlineFirst")}</StatusPill></div><h1 className="text-3xl font-bold tracking-tight md:text-5xl">{t("app.heroTitle")}</h1><p className="mt-2 max-w-3xl text-slate-600">{t("app.subtitle")}</p></div></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-medium text-slate-500">{t("language.label")}<select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value)} className="ml-2 rounded-xl border bg-white p-2 text-sm text-slate-950">{uiLanguageChoices.map((lang) => <option key={lang.code} value={lang.code}>{lang.draft ? `${lang.label} - draft` : lang.label}</option>)}</select></label>{lockedPortalRole ? <StatusPill tone="good">{tf("app.dedicatedPortal", { role: roleLabel(lockedPortalRole) })}</StatusPill> : role === "Admin" ? <StatusPill tone="good">Admin</StatusPill> : ROLES.map((r) => <Button key={r} onClick={() => setRole(r)} variant={role === r ? "default" : "outline"} className="rounded-2xl">{roleLabel(r)}</Button>)}</div></header>
    {draftPreviewActive && <div role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950 shadow-sm">{t("language.draftPreviewWarning")}</div>}
    <div className="grid gap-4 lg:grid-cols-3">
      {role === "Admin" && <AdminView centre={centre} setCentre={setCentre} examDate={examDate} setExamDate={setExamDate} place={place} setPlace={setPlace} language={language} setLanguage={setLanguage} availableVariants={availableVariants} variants={variants} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} importTestPackage={importTestPackage} setStatus={setStatus} addAudit={addAudit} setScannerMode={setScannerMode} centreQr={payload("Centre", CENTRE_QR_ID, CENTRE_ACCESS_TOKEN)} t={t}  adminPdfPackageStatus={adminPdfPackageStatus} adminPdfPackageError={adminPdfPackageError} adminPdfPackageList={adminPdfPackageList} adminPdfPackageLatest={adminPdfPackageLatest} setAdminPdfPackageStatus={setAdminPdfPackageStatus} setAdminPdfPackageError={setAdminPdfPackageError} setAdminPdfPackageList={setAdminPdfPackageList} setAdminPdfPackageLatest={setAdminPdfPackageLatest} />}
      {role === "Centre" && <CentreView centreUnlocked={centreUnlocked} centreCode={centreCode} setCentreCode={setCentreCode} unlockCentre={unlockCentre} enabledLevels={enabledLevels} toggleLevel={toggleLevel} language={language} availableVariants={availableVariants} variants={variants} setVariants={setVariants} setAvailableVariants={setAvailableVariants} testBank={testBank} setTestBank={setTestBank} setTestImportSummary={setTestImportSummary} outdoorItemsByLevel={outdoorItemsByLevel} setOutdoorItemsByLevel={setOutdoorItemsByLevel} setActiveAdminPackageMeta={setActiveAdminPackageMeta} importTestPackage={importTestPackage} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} candidates={candidates} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} addCandidate={addCandidate} updateCandidate={updateCandidate} assignments={assignments} setAssignments={setAssignments} examiners={examiners} candidateQrFor={(id) => payload("Candidate", id)} examinerQrFor={(id) => payload("Examiner", id)} centreSetupLoading={centreSetupLoading} centreSetupSaving={centreSetupSaving} centreSetupError={centreSetupError} centreSetupStatus={centreSetupStatus} centreAuditExportLoading={centreAuditExportLoading} centreAuditExportError={centreAuditExportError} centreQrAccess={centreQrAccess} centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} setCentreSetupDirty={setCentreSetupDirty} dataMode={centreDataMode} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} handleLoadCentreSetup={handleLoadCentreSetup} handleSaveCentreSetup={handleSaveCentreSetup} handleDownloadCentreAuditPackage={handleDownloadCentreAuditPackage} updateExaminer={updateExaminer} addExaminer={addExaminer} removeCandidate={removeCandidate} removeExaminer={removeExaminer} t={t} />}
      {role === "Candidate" && <CandidateView candidates={candidates} loggedCandidate={loggedCandidate} confirmed={loggedCandidate ? candidateConfirmed[loggedCandidate.id] : false} loginCandidate={loginCandidate} logoutCandidate={() => setLoggedCandidateId(null)} confirmCandidate={confirmCandidate} sections={loggedCandidate ? CANDIDATE_SECTIONS[loggedCandidate.level] : []} sectionStatus={loggedCandidate ? candidateStatus[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level) : {}} sectionTimes={loggedCandidate ? candidateTimes[loggedCandidate.id] ?? {} : {}} sectionTone={sectionTone} openSection={openCandidateSection} activeSection={activeCandidateSection} setActiveSection={setActiveCandidateSection} testResponses={testResponses} updateTest={updateTest} submitTest={submitTest} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} updateReportPhoto={updateReportPhoto} submitReport={submitReport} variants={variants} testBank={testBank} activeAdminPackageMeta={activeAdminPackageMeta} outdoorItemsByLevel={outdoorItemsByLevel} qrFor={(id) => payload("Candidate", id)} setScannerMode={setScannerMode} t={t} />}
      {role === "Examiner" && <ExaminerView examiners={examiners} loggedExaminer={loggedExaminer} confirmed={loggedExaminer ? examinerConfirmed[loggedExaminer.id] : false} loginExaminer={loginExaminer} logoutExaminer={() => setLoggedExaminerId(null)} confirmExaminer={confirmExaminer} assignedCandidates={assignedCandidates} assignments={assignments} setPrimary={setPrimary} activePage={activeExaminerPage} setActivePage={setActiveExaminerPage} openOutdoor={openOutdoor} openWrittenReview={openExaminerWrittenReview} openReportReview={openExaminerReportReview} selectedCandidate={selectedCandidate} setSelectedCandidateId={setSelectedCandidateId} selectedMode={selectedMode} activeOutdoorSection={activeOutdoorSection} setActiveOutdoorSection={setActiveOutdoorSection} outdoor={outdoor} outdoorNotes={outdoorNotes} outdoorItemsByLevel={outdoorItemsByLevel} setOutdoorItemsByLevel={setOutdoorItemsByLevel} updateOutdoor={updateOutdoor} updateOutdoorNote={updateOutdoorNote} outdoorTotal={outdoorTotal} outdoorMax={outdoorMax} submitOutdoor={submitOutdoor} archivePlan={archivePlan} practicingArchive={practicingArchive} scoring={scoring} activeScoreLimits={activeScoreLimits} updateScore={updateScore} generateEvaluation={generateEvaluation} lastEvaluation={lastEvaluation} loadEvaluationPreview={loadEvaluationPreview} evaluationPreview={evaluationPreview} evaluationLoading={evaluationLoading} evaluationError={evaluationError} downloadDraftExport={downloadDraftExport} exportLoading={exportLoading} exportError={exportError} variants={variants} testBank={testBank} testResponses={testResponses} reportDrafts={reportDrafts} importedCandidatePackages={importedCandidatePackages} setImportedCandidatePackages={setImportedCandidatePackages} qrFor={(id) => payload("Examiner", id)} setScannerMode={setScannerMode} importOfflineCandidatePackageFile={importOfflineCandidatePackageFile} importOfflineCandidatePackageData={importOfflineCandidatePackageData} examinerTimes={loggedExaminer ? examinerTimes[loggedExaminer.id] ?? {} : {}} t={t} />}
      {role === "Centre" && <AuditSyncView sync={sync} setSync={setSync} audit={audit} CloudOff={CloudOff} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} Card={Card} CardContent={CardContent} t={t} />}
    </div>
    {scannerMode && <QrScannerPanel title={tf("qrScanner.scan", { role: roleLabel(scannerMode) })} onScan={handleQrScan} onClose={() => setScannerMode(null)} t={t} />}
    {reopenRequest && <ReopenSectionModal sectionKey={reopenRequest.key} error={reopenRequest.error} onConfirm={confirmReopenRequest} onCancel={() => setReopenRequest(null)} />}
  </div></main>;
}

const AUTHORING_DOCS = [
  { key: "writtenPracticing", level: "Practicing", kind: "written", title: "Practicing written answers" },
  { key: "writtenConsulting", level: "Consulting", kind: "written", title: "Consulting written answers" },
  { key: "outdoorPracticing", level: "Practicing", kind: "outdoor", title: "Practicing outdoor exercises" },
  { key: "outdoorConsulting", level: "Consulting", kind: "outdoor", title: "Consulting outdoor exercises" },
];


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

function defaultAuthoringDocumentMeta(key) {
  const doc = AUTHORING_DOCS.find((item) => item.key === key) || AUTHORING_DOCS[0];
  const defaults = AUTHORING_DOCUMENT_DEFAULTS[key] || {};
  return {
    level: doc.level,
    kind: doc.kind,
    title: doc.title,
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linesToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
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

function authoringPrintHtml(draft) {
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
      guidanceParts.push(`<div class="correct-answer"><strong>Correct answer:</strong> ${escapeHtml(item.correctAnswer || "-")}</div>`);
    }
    if (String(guidance ?? "").trim()) {
      guidanceParts.push(`<div class="guidance-text">${guidanceToFlowHtml(guidance)}</div>`);
    }
    const typeLabel = isMultipleChoice ? "Multiple-choice" : doc.kind === "outdoor" ? "Outdoor / oral" : "Written answer";
    return `<tr class="${isMultipleChoice ? "choice-row" : "written-row"}"><td class="q"><div class="qid"><strong>${escapeHtml(item.id || `Question ${index + 1}`)}</strong><span>${escapeHtml(typeLabel)}</span></div><div class="question-text">${linesToHtml(question)}</div>${optionHtml}</td><td class="guidance">${guidanceParts.join("") || "&nbsp;"}</td><td class="marks">/${escapeHtml(item.max || 0)}</td></tr>`;
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
      return `<h3>${escapeHtml(section)}</h3><table class="${[doc.kind === "written" ? "test-question-table" : "", isChoiceSection ? "choice-section-table" : "standard-section-table"].filter(Boolean).join(" ")}"><thead><tr><th>Question</th><th>Notes / answer guidance</th><th>Marks</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
    return `<section class="doc"><h2>${escapeHtml(data.title || doc.title)}</h2><p>${escapeHtml(doc.level)} / ${escapeHtml(doc.kind)} / ${summary.count} items / ${summary.max} marks</p>${data.preface ? `<div class="preface"><strong>Preface</strong><br />${linesToHtml(data.preface)}</div>` : ""}${data.candidateIntro ? `<div class="intro"><strong>Introductory text for candidates</strong><br />${linesToHtml(data.candidateIntro)}</div>` : ""}${sectionHtml}</section>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(pkg.packageId)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{font-size:26px}h2{page-break-before:always;margin-top:32px}.doc:first-of-type h2{page-break-before:auto}h3{margin-top:20px;font-size:15px}.preface,.intro,.meta{border:1px solid #cbd5e1;background:#f8fafc;padding:12px;margin:10px 0 14px}table{border-collapse:collapse;width:100%;font-size:12px;break-inside:auto}tr{break-inside:avoid;break-after:auto}th,td{border:1px solid #111827;padding:8px;vertical-align:top}th{background:#f1f5f9}.q{width:34%}.guidance{width:auto}.marks{width:60px;text-align:right;font-weight:bold}.test-question-table .q{width:44%}.test-question-table .guidance{width:auto;padding-left:6px;padding-right:6px}.test-question-table .marks{width:48px}.choice-section-table .q{width:46%}.test-question-table.choice-section-table .q{width:54%}.choice-section-table .guidance{width:auto}.qid{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:5px}.qid span{border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;color:#475569;font-size:10px;font-weight:700;padding:2px 7px;white-space:nowrap}.question-text{font-weight:600;margin-bottom:8px}.choice-list{margin:8px 0 0 18px;padding:0}.choice-list li{margin:3px 0;padding-left:3px}.choice-row .q{background:#f8fafc}.choice-row .question-text{font-weight:700}.correct-answer{border:1px solid #bbf7d0;background:#f0fdf4;color:#064e3b;border-radius:8px;padding:8px;margin-bottom:8px}.guidance-text{white-space:normal;width:100%;max-width:none;line-height:1.25}.test-question-table .guidance-text{display:block}.guidance-heading{font-weight:700;margin:0 0 3px}.guidance-paragraph{margin:0 0 5px}.guidance-bullet{margin:0 0 2px;padding-left:0.9em;text-indent:-0.9em}.written-row .guidance-text{color:#334155}@media print{button{display:none}body{margin:12mm}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>${escapeHtml(draft.title || "VETCERT examination package")}</h1><div class="meta"><div>Package ID: ${escapeHtml(pkg.packageId)}</div><div>Version: ${escapeHtml(draft.version || "")}</div><div>Language: ${escapeHtml(draft.language || "English")}</div><div>Generated: ${escapeHtml(pkg.createdAt)}</div></div>${docs}</body></html>`;
}

function AdminStructuredPackagePanel({ adminPdfPackageLatest, setAdminPdfPackageLatest, setAdminPdfPackageStatus, setAdminPdfPackageError }) {
  const [draft, setDraft] = useState(() => createEmptyAuthoringDraft());
  const [activeDocKey, setActiveDocKey] = useState("writtenPracticing");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draftList, setDraftList] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [activeSectionFilter, setActiveSectionFilter] = useState("__all__");
  const [localStatus, setLocalStatus] = useState("");
  const [localError, setLocalError] = useState("");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

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
    setDraft(authoringDraftFromCertificationPackage(pkg));
    setSelectedIndex(0);
    setActiveSectionFilter("__all__");
    setLocalStatus(`Načteno do strukturovaného editoru: ${pkg.packageId || "balíček bez ID"}`);
    setLocalError("");
  }

  function loadDraftIntoEditor(nextDraft, label = "draft") {
    if (!nextDraft || nextDraft.kind !== "vetbara.structuredAuthoringDraft.v1") {
      setLocalError("Soubor není VetBara structured authoring draft.");
      return;
    }
    setDraft({
      ...nextDraft,
      documents: {
        writtenPracticing: normalizedAuthoringDocument("writtenPracticing", nextDraft.documents?.writtenPracticing),
        writtenConsulting: normalizedAuthoringDocument("writtenConsulting", nextDraft.documents?.writtenConsulting),
        outdoorPracticing: normalizedAuthoringDocument("outdoorPracticing", nextDraft.documents?.outdoorPracticing),
        outdoorConsulting: normalizedAuthoringDocument("outdoorConsulting", nextDraft.documents?.outdoorConsulting),
      },
    });
    setSelectedIndex(0);
    setActiveSectionFilter("__all__");
    setSelectedDraftId(nextDraft.draftId || nextDraft.packageId || "");
    setLocalStatus(`Načten strukturovaný ${label}: ${nextDraft.title || nextDraft.packageId || nextDraft.draftId || "bez názvu"}`);
    setLocalError("");
  }

  async function refreshDraftList() {
    setLocalStatus("Načítám uložené strukturované drafty...");
    setLocalError("");
    try {
      const response = await fetch("/api/admin/authoring-drafts/list", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setDraftList(Array.isArray(data.drafts) ? data.drafts : []);
      setLocalStatus(`Načteno ${data.drafts?.length || 0} uložených draftů.`);
    } catch (error) {
      setLocalError(error.message || "Načtení seznamu draftů selhalo.");
      setLocalStatus("");
    }
  }

  async function saveDraftToDatabase() {
    setLocalStatus("Ukládám strukturovaný draft...");
    setLocalError("");
    try {
      const response = await fetch("/api/admin/authoring-drafts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setDraft(data.draft);
      setSelectedDraftId(data.draft?.draftId || data.draft?.packageId || "");
      setDraftList((current) => [data.summary, ...current.filter((item) => item.filename !== data.summary?.filename)]);
      setLocalStatus(`Draft uložen: ${data.filename}`);
    } catch (error) {
      setLocalError(error.message || "Uložení draftu selhalo.");
      setLocalStatus("");
    }
  }

  async function loadLatestDraft() {
    setLocalStatus("Načítám poslední strukturovaný draft...");
    setLocalError("");
    try {
      const response = await fetch("/api/admin/authoring-drafts/latest", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      loadDraftIntoEditor(data, "draft");
    } catch (error) {
      setLocalError(error.message || "Načtení posledního draftu selhalo.");
      setLocalStatus("");
    }
  }

  async function loadSelectedDraft() {
    if (!selectedDraftId) return;
    setLocalStatus("Načítám vybraný strukturovaný draft...");
    setLocalError("");
    try {
      const response = await fetch(`/api/admin/authoring-drafts/${encodeURIComponent(selectedDraftId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      loadDraftIntoEditor(data, "draft");
    } catch (error) {
      setLocalError(error.message || "Načtení vybraného draftu selhalo.");
      setLocalStatus("");
    }
  }

  async function fetchJsonIfOk(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
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
    if (!silent) setLocalStatus("Načítám Admin balíček do editoru...");
    setLocalError("");

    const attempts = [
      { url: "/api/admin/test-package/approved", label: "schválený aktivní balíček" },
      { url: "/api/centre/test-package/active", label: "aktivní Centre balíček" },
      { url: "/api/admin/test-package/latest", label: "poslední uložený Admin balíček" },
    ];

    const failures = [];

    for (const attempt of attempts) {
      const result = await fetchJsonIfOk(attempt.url);
      if (result.ok && packageHasAuthoringContent(result.data)) {
        loadFromPackage(result.data);
        setLocalStatus(`Načten ${attempt.label}: ${result.data.packageId || "bez packageId"}`);
        return;
      }
      failures.push(`${attempt.label}: ${result.data?.error || `HTTP ${result.status}`}`);
    }

    if (!silent) {
      setLocalError(`Nepodařilo se načíst žádný existující balíček. ${failures.join(" | ")}`);
      setLocalStatus("");
    }
  }

  async function saveAsPackage() {
    setLocalStatus("Ukládám strukturovaný obsah jako Admin JSON balíček...");
    setLocalError("");
    try {
      const pkg = certificationPackageFromAuthoringDraft(draft);
      const response = await fetch("/api/admin/test-package/authoring/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setAdminPdfPackageLatest?.(data.package);
      setAdminPdfPackageStatus?.(`Strukturovaný balíček uložen: ${data.filename}`);
      setLocalStatus(`Uloženo: ${data.filename}`);
    } catch (error) {
      setLocalError(error.message || "Uložení selhalo.");
      setAdminPdfPackageError?.(error.message || "Uložení strukturovaného balíčku selhalo.");
      setLocalStatus("");
    }
  }

  function printPackage() {
    const win = window.open("", "_blank");
    if (!win) {
      setLocalError("Prohlížeč zablokoval nové okno pro tisk.");
      return;
    }
    win.document.open();
    win.document.write(authoringPrintHtml(draft));
    win.document.close();
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        if (data.kind === "vetbara.structuredAuthoringDraft.v1") {
          loadDraftIntoEditor(data, file.name);
        } else {
          loadFromPackage(data);
        }
      } catch (error) {
        setLocalError(error.message || "Import JSON selhal.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function exportDraft() {
    downloadJsonFile(`${draft.packageId || "vetbara-authoring-draft"}.json`, draft);
  }

  function exportPackage() {
    const pkg = certificationPackageFromAuthoringDraft(draft);
    downloadJsonFile(`${pkg.packageId}.json`, pkg);
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

  const allSummaries = AUTHORING_DOCS.map((doc) => {
    const data = draft.documents[doc.key] || {};
    const list = doc.kind === "outdoor" ? data.exercises : data.questions;
    return { ...doc, ...summarizeAuthoringItems(list) };
  });

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Vytvoření/editace podkladů pro zkoušku</h3>
            <p className="mt-1 text-sm text-slate-600">
              Upravte čtyři zdrojové dokumenty zkoušky. Z těchto dat se vytváří zkušební balíček pro systém a tisková/PDF verze dokumentů.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button onClick={loadActivePackage} variant="outline" className="rounded-2xl">Otevřít aktuální podklady</Button>
            <Button onClick={loadLatestDraft} variant="outline" className="rounded-2xl">Otevřít pracovní draft</Button>
            <Button onClick={saveDraftToDatabase} className="rounded-2xl">Uložit draft</Button>
            <Button onClick={saveAsPackage} className="rounded-2xl">Vytvořit zkušební balíček</Button>
            <Button onClick={printPackage} variant="outline" className="rounded-2xl">Tisk / PDF</Button>
            <Button onClick={() => setShowAdvancedTools((value) => !value)} variant="outline" className="rounded-2xl">
              {showAdvancedTools ? "Skrýt pokročilé" : "Pokročilé nástroje"}
            </Button>
          </div>
        </div>

        {showAdvancedTools && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pokročilé / servisní akce</div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => adminPdfPackageLatest && loadFromPackage(adminPdfPackageLatest)} variant="outline" className="rounded-2xl" disabled={!adminPdfPackageLatest}>Převzít poslední balíček z Admin workflow</Button>
              <Button onClick={refreshDraftList} variant="outline" className="rounded-2xl">Seznam všech draftů</Button>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
                Import JSON
                <input type="file" accept="application/json,.json" className="hidden" onChange={importJson} />
              </label>
              <Button onClick={exportDraft} variant="outline" className="rounded-2xl">Export draft</Button>
              <Button onClick={exportPackage} variant="outline" className="rounded-2xl">Export package JSON</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Tyto nástroje slouží hlavně pro migraci, zálohy a technickou kontrolu. Pro běžnou přípravu zkoušky stačí hlavní tlačítka nahoře.
            </p>
          </div>
        )}

        {localStatus && <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{localStatus}</div>}
        {localError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{localError}</div>}

        {draftList.length > 0 && (
          <div className="mt-3 rounded-2xl border bg-slate-50 p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
              <label className="text-sm font-medium">Uložené strukturované drafty
                <select value={selectedDraftId} onChange={(e) => setSelectedDraftId(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">
                  <option value="">Vyberte draft...</option>
                  {draftList.map((item) => (
                    <option key={item.filename || item.draftId || item.packageId} value={item.draftId || item.packageId || item.filename}>
                      {(item.title || item.packageId || item.draftId || item.filename)} · {item.version || "bez verze"} · {item.storedAt || item.updatedAt || item.createdAt || "bez data"}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={loadSelectedDraft} variant="outline" className="rounded-xl" disabled={!selectedDraftId}>Otevřít draft</Button>
            </div>
          </div>
        )}

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

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {allSummaries.map((doc) => (
            <button key={doc.key} onClick={() => { setActiveDocKey(doc.key); setSelectedIndex(0); setActiveSectionFilter("__all__"); }} className={`rounded-xl border p-3 text-left text-sm ${activeDocKey === doc.key ? "border-slate-950 bg-slate-100" : "bg-white hover:bg-slate-50"}`}>
              <div className="font-semibold">{doc.title}</div>
              <div className="mt-1 text-xs text-slate-600">{doc.count} položek / {doc.max} bodů</div>
            </button>
          ))}
        </div>


        <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h4 className="font-bold">Manuální kontrola dokumentu</h4>
              <p className="text-sm text-slate-600">Editujte předmluvu, úvod pro kandidáty, sekce a otázky. Tato struktura je zdrojem pro JSON balíček i tisk/PDF.</p>
            </div>
            <label className="text-sm font-medium">Filtrovat sekci
              <select value={activeSectionFilter} onChange={(e) => { setActiveSectionFilter(e.target.value); setSelectedIndex(0); }} className="mt-1 w-full rounded-xl border bg-white p-2 md:w-80">
                <option value="__all__">Všechny sekce</option>
                {sections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium md:col-span-2">Název dokumentu
              <input value={activeDoc.title || ""} onChange={(e) => setActiveDocumentField("title", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
            </label>
            <label className="text-sm font-medium">Předmluva / poznámky k dokumentu
              <textarea value={activeDoc.preface || ""} onChange={(e) => setActiveDocumentField("preface", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
            </label>
            <label className="text-sm font-medium">Úvodní text pro kandidáty
              <textarea value={activeDoc.candidateIntro || ""} onChange={(e) => setActiveDocumentField("candidateIntro", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
            </label>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {sections.map((section) => {
              const sectionItems = items.filter((item) => (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === section);
              const sectionSummary = summarizeAuthoringItems(sectionItems);
              return (
                <button key={section} type="button" onClick={() => { setActiveSectionFilter(section); const first = items.findIndex((item) => (String(item.section || item.theme || "Unsectioned").trim() || "Unsectioned") === section); setSelectedIndex(Math.max(0, first)); }} className={`rounded-xl border p-3 text-left text-sm ${activeSectionFilter === section ? "border-slate-950 bg-white" : "bg-white hover:bg-slate-100"}`}>
                  <div className="font-semibold">{section}</div>
                  <div className="mt-1 text-xs text-slate-600">{sectionSummary.count} otázek / {sectionSummary.max} bodů</div>
                </button>
              );
            })}
            {!sections.length && <div className="rounded-xl border border-dashed bg-white p-3 text-sm text-slate-500">Sekce se vytvoří podle pole „Sekce“ u jednotlivých otázek.</div>}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{activeDocMeta.title}</div>
                <div className="text-xs text-slate-600">{activeSummary.count} položek / {activeSummary.max} bodů</div>
              </div>
              <Button onClick={addItem} variant="outline" className="rounded-xl px-3 py-1">+ položka</Button>
            </div>
            <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
              {visibleItems.map(({ item, index }) => (
                <button key={`${item.id}-${index}`} onClick={() => setSelectedIndex(index)} className={`w-full rounded-xl border p-2 text-left text-sm ${selectedIndex === index ? "border-slate-950 bg-white" : "bg-white hover:bg-slate-50"}`}>
                  <div className="font-mono text-xs text-slate-500">{item.id || `#${index + 1}`}</div>
                  <div className="line-clamp-2 font-medium">{activeDocMeta.kind === "outdoor" ? item.question : item.text}</div>
                  <div className="mt-1 text-xs text-slate-500">/{item.max || 0} bodů</div>
                </button>
              ))}
              {!items.length && <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-500">Dokument zatím nemá položky.</div>}
              {items.length > 0 && !visibleItems.length && <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-500">V této sekci zatím nejsou položky.</div>}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            {selectedItem ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-bold">Editace položky</h4>
                  <div className="flex gap-2">
                    <Button onClick={duplicateItem} variant="outline" className="rounded-xl">Duplikovat</Button>
                    <Button onClick={removeItem} variant="outline" className="rounded-xl">Smazat</Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="text-sm font-medium">ID
                    <input value={selectedItem.id || ""} onChange={(e) => updateSelected("id", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2 font-mono text-sm" />
                  </label>
                  <label className="text-sm font-medium">Number
                    <input value={selectedItem.number || ""} onChange={(e) => updateSelected("number", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                  </label>
                  <label className="text-sm font-medium">Maximální bodové skóre
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
                      <label className="block text-sm font-medium">Sekce
                        <input value={selectedItem.section || ""} onChange={(e) => setSelectedSection(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                      <Button type="button" onClick={() => renameSection(activeSectionFilter, selectedItem.section)} variant="outline" className="rounded-xl" disabled={activeSectionFilter === "__all__" || !selectedItem.section}>Přejmenovat filtrovanou sekci</Button>
                    </div>
                    <label className="block text-sm font-medium">Tělo otázky / text pro kandidáta
                      <textarea value={selectedItem.question || ""} onChange={(e) => updateSelected("question", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                    <label className="block text-sm font-medium">Pomoc zkoušejícímu / hodnoticí vodítko
                      <textarea value={selectedItem.examinerGuidance || ""} onChange={(e) => updateSelected("examinerGuidance", e.target.value)} rows={10} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-sm font-medium">Sekce
                        <input value={selectedItem.section || ""} onChange={(e) => setSelectedSection(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                      <label className="block text-sm font-medium">Téma
                        <input value={selectedItem.theme || ""} onChange={(e) => updateSelected("theme", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">Tělo otázky
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
                    <label className="block text-sm font-medium">Pomoc zkoušejícímu / správná odpověď / hodnoticí vodítko
                      <textarea value={selectedItem.scoringHelp || ""} onChange={(e) => updateSelected("scoringHelp", e.target.value)} rows={10} className="mt-1 w-full rounded-xl border bg-white p-3" />
                    </label>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-sm text-slate-500">Vyber položku vlevo nebo přidej novou.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminPdfPackagePanel({
  adminPdfPackageStatus,
  adminPdfPackageError,
  adminPdfPackageList,
  adminPdfPackageLatest,
  setAdminPdfPackageStatus,
  setAdminPdfPackageError,
  setAdminPdfPackageList,
  setAdminPdfPackageLatest,
}) {
  const validation = adminPdfPackageLatest?.validation;
  const variants = adminPdfPackageLatest?.variants;

  async function refreshList() {
    setAdminPdfPackageError("");
    setAdminPdfPackageStatus("Načítám lokální JSON balíčky...");

    try {
      const response = await fetch("/api/admin/test-package/list");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setAdminPdfPackageList(data.packages || []);
      setAdminPdfPackageStatus(`Načteno ${data.packages?.length || 0} lokálních JSON balíčků.`);
    } catch (error) {
      setAdminPdfPackageError(error.message || "Načtení seznamu selhalo.");
      setAdminPdfPackageStatus("");
    }
  }

  async function loadLatest() {
    setAdminPdfPackageError("");
    setAdminPdfPackageStatus("Načítám poslední JSON balíček...");

    try {
      const response = await fetch("/api/admin/test-package/latest");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setAdminPdfPackageLatest(data);
      setAdminPdfPackageStatus(`Načten poslední balíček: ${data.packageId}`);
    } catch (error) {
      setAdminPdfPackageError(error.message || "Načtení posledního balíčku selhalo.");
      setAdminPdfPackageStatus("");
    }
  }

  async function convertPdfs(event) {
    const files = Array.from(event.target.files || []);
    setAdminPdfPackageError("");
    setAdminPdfPackageStatus("");

    const findFile = (patterns) => files.find((file) => patterns.every((pattern) => pattern.test(file.name)));

    const practicingWritten = findFile([/pract/i, /answer|answers/i]);
    const consultingWritten = findFile([/consult/i, /answer|answers/i]);
    const practicingOutdoor = findFile([/pract/i, /outdoor|outside/i]);
    const consultingOutdoor = findFile([/consult/i, /outdoor|outside|oudtoor/i]);

    if (!practicingWritten || !consultingWritten || !practicingOutdoor || !consultingOutdoor) {
      setAdminPdfPackageError("Vyberte 4 PDF: Practicing answers, Consulting answers, Practicing outdoor, Consulting outdoor.");
      event.target.value = "";
      return;
    }

    const form = new FormData();
    form.append("practicingWritten", practicingWritten);
    form.append("consultingWritten", consultingWritten);
    form.append("practicingOutdoor", practicingOutdoor);
    form.append("consultingOutdoor", consultingOutdoor);

    setAdminPdfPackageStatus("Převádím PDF na lokální JSON balíček...");

    try {
      const response = await fetch("/api/admin/test-package/convert", {
        method: "POST",
        body: form,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setAdminPdfPackageLatest(data.package);
      setAdminPdfPackageStatus(`JSON balíček vytvořen: ${data.filename}`);
      await refreshList();
    } catch (error) {
      setAdminPdfPackageError(error.message || "Převod PDF selhal.");
      setAdminPdfPackageStatus("");
    } finally {
      event.target.value = "";
    }
  }

  async function approveLatestPackage({ override = false } = {}) {
    if (!adminPdfPackageLatest?.packageId) {
      setAdminPdfPackageError("Nejprve načtěte poslední JSON balíček.");
      return;
    }

    let reason = "";

    if (adminPdfPackageLatest?.validation?.status !== "valid") {
      if (!override) {
        setAdminPdfPackageError("Balíček vyžaduje kontrolu. Pro schválení použijte ruční override s důvodem.");
        return;
      }

      reason = window.prompt("Balíček má status requires_review. Zadejte důvod ručního schválení pro Centre:") || "";

      if (!reason.trim()) {
        setAdminPdfPackageError("Ruční override vyžaduje důvod.");
        return;
      }
    }

    setAdminPdfPackageError("");
    setAdminPdfPackageStatus("Schvaluji balíček pro Centre...");

    try {
      const response = await fetch("/api/admin/test-package/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: adminPdfPackageLatest.packageId,
          allowRequiresReview: override,
          reason,
        }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setAdminPdfPackageLatest(data.package);
      setAdminPdfPackageStatus(`Balíček schválen pro Centre: ${data.package.packageId}`);
      await refreshList();
    } catch (error) {
      setAdminPdfPackageError(error.message || "Schválení balíčku selhalo.");
      setAdminPdfPackageStatus("");
    }
  }

  async function loadApprovedPackage() {
    setAdminPdfPackageError("");
    setAdminPdfPackageStatus("Načítám aktivní balíček pro Centre...");

    try {
      const response = await fetch("/api/admin/test-package/approved");
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setAdminPdfPackageLatest(data);
      setAdminPdfPackageStatus(`Aktivní balíček pro Centre: ${data.packageId}`);
    } catch (error) {
      setAdminPdfPackageError(error.message || "Načtení aktivního balíčku selhalo.");
      setAdminPdfPackageStatus("");
    }
  }

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Admin PDF → VetBara JSON package</h3>
            <p className="mt-1 text-sm text-slate-600">
              Certifikační PDF se převádí do lokálního JSON balíčku. Jazyk UX aplikace nemění jazyk ani obsah zkouškových podkladů.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Převést 4 PDF
              <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={convertPdfs} />
            </label>
            <Button onClick={refreshList} variant="outline" className="rounded-2xl">Načíst seznam</Button>
            <Button onClick={loadLatest} variant="outline" className="rounded-2xl">Načíst poslední</Button>
            <Button onClick={loadApprovedPackage} variant="outline" className="rounded-2xl">Načíst aktivní</Button>
            <Button onClick={() => approveLatestPackage({ override: false })} variant="outline" className="rounded-2xl">Schválit pro Centre</Button>
            <Button onClick={() => approveLatestPackage({ override: true })} variant="outline" className="rounded-2xl">Override schválení</Button>
          </div>
        </div>

        {adminPdfPackageStatus && <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{adminPdfPackageStatus}</div>}
        {adminPdfPackageError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{adminPdfPackageError}</div>}

        {adminPdfPackageLatest && (
          <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Poslední balíček: {adminPdfPackageLatest.packageId}</div>
            <div className="mt-1 text-slate-600">Vytvořeno: {adminPdfPackageLatest.createdAt}</div>
            {adminPdfPackageLatest.approval && (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-950">
                Schváleno pro Centre: {adminPdfPackageLatest.approval.approvedAt}
                {adminPdfPackageLatest.approval.reason && <div className="mt-1 text-xs">Důvod override: {adminPdfPackageLatest.approval.reason}</div>}
              </div>
            )}

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {["Practicing", "Consulting"].map((level) => (
                <div key={level} className="rounded-xl border bg-white p-3">
                  <div className="font-semibold">{level}</div>
                  <div className="mt-1 text-xs text-slate-600">Written: {variants?.[level]?.writtenQuestionCount ?? "-"} otázek / {variants?.[level]?.writtenMax ?? "-"} bodů</div>
                  <div className="mt-1 text-xs text-slate-600">Outdoor: {variants?.[level]?.outdoorItemCount ?? "-"} položek / {variants?.[level]?.outdoorMax ?? "-"} bodů</div>
                </div>
              ))}
            </div>

            {validation && (
              <div className={`mt-3 rounded-xl border p-3 ${validation.status === "valid" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
                <div className="font-semibold">Validace: {validation.status}</div>
                {validation.issues?.length > 0 && (
                  <ul className="mt-2 list-disc pl-5">
                    {validation.issues.map((issue, index) => <li key={index}>{issue}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {adminPdfPackageList.length > 0 && (
          <div className="mt-4 rounded-xl border bg-white p-3 text-sm">
            <div className="font-semibold">Lokální JSON balíčky: {adminPdfPackageList.length}</div>
            <div className="mt-2 space-y-2">
              {adminPdfPackageList.slice(0, 5).map((pkg) => (
                <div key={pkg.packageId} className="rounded-lg bg-slate-50 p-2">
                  <div className="font-mono text-xs">{pkg.packageId}</div>
                  <div className="text-xs text-slate-600">
                    Practicing {pkg.variants?.Practicing?.writtenQuestionCount ?? "-"} / {pkg.variants?.Practicing?.writtenMax ?? "-"} · Consulting {pkg.variants?.Consulting?.writtenQuestionCount ?? "-"} / {pkg.variants?.Consulting?.writtenMax ?? "-"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminDashboardSection({ id, title, description, activeSection, setActiveSection, children }) {
  const isOpen = activeSection === id;
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-3">
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => setActiveSection(isOpen ? "" : id)}
          className="flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between"
        >
          <div>
            <h3 className="text-xl font-bold tracking-tight">{title}</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
          </div>
          <span className="inline-flex rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            {isOpen ? "Zavřít" : "Otevřít"}
          </span>
        </button>
        {isOpen && <div className="mt-5 border-t pt-5">{children}</div>}
      </CardContent>
    </Card>
  );
}

function AdminExamOpeningPanel({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, centreQr, setStatus, addAudit, setScannerMode, t }) {
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
        <p className="mt-1 text-sm text-slate-600">Vygenerujte odkaz pro centrum až ve chvíli, kdy je balíček připravený a zkouška otevřená.</p>
        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
          <RealQr value={centreQr} />
          <div>
            <div className="break-all font-mono text-xs text-slate-500">{centreQr}</div>
            <Button onClick={() => { setStatus(t("status.openedForCentre")); addAudit(t("audit.centreAccessSent"), centre, CENTRE_ACCESS_TOKEN); }} className="mt-3 rounded-2xl">{t("admin.centreAccess.send")}</Button>
            <Button onClick={() => setScannerMode("Centre")} variant="outline" className="ml-2 mt-3 rounded-2xl">{t("admin.centreAccess.scan")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminTranslationPanel({ t }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <SectionTitle icon={Languages} title={t("admin.multilingual.title")} subtitle={t("admin.multilingual.subtitle")} />
      <p className="mb-4 text-sm text-slate-600">Správa překladů se týká pouze prostředí aplikace. Obsah zkoušky se bere z Admin balíčku a jazyk UX jej nemá měnit.</p>
      <div className="grid gap-2 text-sm md:grid-cols-2">
        {["exam.start", "exam.submit", "sync.offline", "evaluation.total"].map((key) => (
          <div key={key} className="rounded-xl border bg-white p-3">
            <div className="font-mono text-xs text-slate-500">{key}</div>
            <div>{t("admin.multilingual.sourceTerms")}</div>
            <StatusPill tone="warn">{t("admin.multilingual.needsReview")}</StatusPill>
          </div>
        ))}
      </div>
      <Button variant="outline" className="mt-4 rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {t("admin.multilingual.export")}</Button>
    </div>
  );
}

function AdminView({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, availableVariants, variants, testImportStatus, testImportError, testImportSummary, importTestPackage, setStatus, addAudit, setScannerMode, centreQr, t, adminPdfPackageStatus, adminPdfPackageError, adminPdfPackageList, adminPdfPackageLatest, setAdminPdfPackageStatus, setAdminPdfPackageError, setAdminPdfPackageList, setAdminPdfPackageLatest }) {
  const [activeAdminSection, setActiveAdminSection] = useState("package-authoring");

  return (
    <>
      <AdminDashboardSection
        id="package-authoring"
        title="A - Vytvoření/editace podkladů pro zkoušku"
        description="Dlouhodobý strukturovaný zdroj čtyř dokumentů. Zde se upravují otázky, sekce, bodování, nápovědy pro zkoušející a následně se ukládá draft nebo finální balíček pro zkušební systém."
        activeSection={activeAdminSection}
        setActiveSection={setActiveAdminSection}
      >
        <AdminStructuredPackagePanel
          adminPdfPackageLatest={adminPdfPackageLatest}
          setAdminPdfPackageLatest={setAdminPdfPackageLatest}
          setAdminPdfPackageStatus={setAdminPdfPackageStatus}
          setAdminPdfPackageError={setAdminPdfPackageError}
        />
      </AdminDashboardSection>

      <AdminDashboardSection
        id="exam-opening"
        title="B - Otevření zkoušky"
        description="Nastavení centra, data, místa a jazyka zkoušky. Po přípravě balíčku se zde otevře konkrétní zkouška a odešle se Centre access link / QR."
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
          centreQr={centreQr}
          setStatus={setStatus}
          addAudit={addAudit}
          setScannerMode={setScannerMode}
          t={t}
        />
      </AdminDashboardSection>

      <AdminDashboardSection
        id="translation"
        title="C - Překlad prostředí"
        description="Správa překladů uživatelského rozhraní aplikace. Nejde o překlad obsahu zkouškových podkladů; ten se řídí balíčkem vytvořeným v první sekci."
        activeSection={activeAdminSection}
        setActiveSection={setActiveAdminSection}
      >
        <AdminTranslationPanel t={t} />
      </AdminDashboardSection>
    </>
  );
}


const OUTDOOR_CENTRE_RESULT_KEY = "vetbara.outdoorCentreResults.v1";
const EXAMINER_RESULT_KEY = "vetbara.examinerResults.v1";
const EXAMINER_FORM_UNLOCK_PASSWORD = "Vetarbo";

function readExaminerResultsLocal() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXAMINER_RESULT_KEY);
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
  window.localStorage.setItem(EXAMINER_RESULT_KEY, JSON.stringify(next));
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
      window.localStorage.setItem(EXAMINER_RESULT_KEY, JSON.stringify(data.results));
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
      window.localStorage.setItem(EXAMINER_RESULT_KEY, JSON.stringify(results));
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

function confirmedReopenAllowed(label) {
  const password = window.prompt(`${label} is closed. Enter Vetarbo password to reopen:`);
  return password === EXAMINER_FORM_UNLOCK_PASSWORD;
}

function readOutdoorCentreResults() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OUTDOOR_CENTRE_RESULT_KEY);
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
  window.localStorage.setItem(OUTDOOR_CENTRE_RESULT_KEY, JSON.stringify(next));
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

function countFilledReportSections(reportDraft) {
  return Object.values(reportDraft ?? {}).reduce((total, tree) => {
    const finalSections = tree?.finalSections && typeof tree.finalSections === "object" ? tree.finalSections : {};
    return total + Object.values(finalSections).filter((value) => String(value ?? "").trim()).length;
  }, 0);
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

function PilotWorkflowDashboard({ candidates, assignments, examiners, centreValidationIssues, testImportSummary, candidateConfirmed, candidateStatus, candidateTimes, testResponses, reportDrafts, outdoor, centreSetupStatus, dataMode, t }) {
  const assignmentCount = candidates.reduce((total, candidate) => {
    const assignment = assignments[candidate.id] ?? {};
    return total + (assignment.primary ? 1 : 0) + (assignment.secondary ? 1 : 0);
  }, 0);
  const hasBackendState = dataMode === "backend";

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("centre.workflow.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("centre.workflow.helper")}</p><p className="mt-1 text-xs text-slate-500">{t("centre.workflow.syncHelper")}</p></div><div className="flex flex-wrap gap-2"><StatusPill tone={centreValidationIssues.length ? "warn" : "good"}>{centreValidationIssues.length} {t("centre.workflow.setupIssues")}</StatusPill><StatusPill>{candidates.length} {t("centre.workflow.candidates")}</StatusPill><StatusPill>{examiners.length} {t("centre.workflow.examiners")}</StatusPill><StatusPill>{assignmentCount} {t("centre.workflow.assignments")}</StatusPill><StatusPill tone={testImportSummary ? "good" : "warn"}>{testImportSummary ? t("centre.workflow.testPackageImported") : t("centre.workflow.noTestPackage")}</StatusPill><StatusPill tone={hasBackendState ? "good" : "warn"}>{hasBackendState ? t("centre.dataMode.backend") : t("centre.dataMode.demo")}</StatusPill></div></div>{!hasBackendState && <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{t("centre.workflow.demoWarning")}</div>}<div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-3">{t("centre.assignments.candidate")}</th><th className="py-2 pr-3">{t("centre.assignments.level")}</th><th className="py-2 pr-3">{t("centre.assignments.primary")}</th><th className="py-2 pr-3">{t("centre.assignments.secondary")}</th><th className="py-2 pr-3">{t("centre.workflow.identity")}</th><th className="py-2 pr-3">{t("centre.workflow.writtenTest")}</th><th className="py-2 pr-3">{t("centre.workflow.report")}</th><th className="py-2 pr-3">{t("centre.workflow.responses")}</th><th className="py-2 pr-3">{t("centre.workflow.outdoorScores")}</th></tr></thead><tbody>{candidates.map((candidate) => { const assignment = assignments[candidate.id] ?? {}; const status = candidateStatus[candidate.id] ?? createSectionStatus(candidate.level); const times = candidateTimes[candidate.id] ?? {}; const reportDraft = reportDrafts[candidate.id] ?? {}; const responseCount = Object.keys(testResponses[candidate.id] ?? {}).length; const outdoorScoreCount = Object.values(outdoor[candidate.id] ?? {}).filter((value) => value !== "" && value !== null && value !== undefined).length; const reportPhotoCount = candidate.level === "Consulting" ? countReportPhotos(reportDraft) : 0; const reportSectionCount = candidate.level === "Consulting" ? countFilledReportSections(reportDraft) : 0; return <tr key={candidate.id} className="border-b align-top"><td className="py-2 pr-3"><div className="font-medium">{candidate.id}</div><div className="text-slate-600">{candidate.name}</div></td><td className="py-2 pr-3">{candidate.level}</td><td className="py-2 pr-3">{examinerNameById(examiners, assignment.primary)}</td><td className="py-2 pr-3">{examinerNameById(examiners, assignment.secondary)}</td><td className="py-2 pr-3"><StatusPill tone={candidateConfirmed[candidate.id] ? "good" : "default"}>{candidateConfirmed[candidate.id] ? t("centre.workflow.confirmed") : t("centre.workflow.notConfirmed")}</StatusPill></td><td className="py-2 pr-3"><StatusPill tone={status.test === "closed" ? "good" : status.test === "open" ? "warn" : "default"}>{t(`sectionStatus.${status.test ?? "locked"}`)}</StatusPill><div className="mt-1 text-xs text-slate-500">{t("centre.workflow.closedAt")}: {times.test?.closedAt || "-"}</div></td><td className="py-2 pr-3">{candidate.level === "Consulting" ? <><StatusPill tone={status.report === "closed" ? "good" : status.report === "open" ? "warn" : "default"}>{t(`sectionStatus.${status.report ?? "locked"}`)}</StatusPill><div className="mt-1 text-xs text-slate-500">{reportSectionCount} {t("centre.workflow.sections")} / {reportPhotoCount} {t("centre.workflow.photos")}</div></> : "-"}</td><td className="py-2 pr-3">{responseCount}</td><td className="py-2 pr-3">{outdoorScoreCount}</td></tr>; })}</tbody></table></div></div>;
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

function effectiveOutdoorSectionsForLevel(activeOutdoorItems, level) {
  const levelItems = effectiveOutdoorItemsForLevel(activeOutdoorItems, level);
  const sections = Object.keys(levelItems);
  return sections.length ? sections : OUTDOOR_SECTIONS[level] ?? [];
}

function outdoorSectionTitle(section) {
  return OUTDOOR_TITLES[section] || section;
}


const FIELD_LEVELS = ["Practicing", "Consulting"];
const FIELD_TREE_CODES = ["A", "B", "C", "D"];
const FIELD_REQUIRED_ASSIGNMENTS = FIELD_LEVELS.flatMap((level) => FIELD_TREE_CODES.map((code) => ({ level, code })));

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


const FIELD_TABLET_TRANSLATIONS = {
  en: {
    exam: "Exam",
    site: "Site",
    online: "Online",
    offline: "Offline",
    both: "Both",
    downloadOffline: "Download offline",
    sync: "Sync",
    syncing: "Syncing...",
    syncDisabledUntilChecked: "Sync is enabled after all required trees are checked.",
    pdf: "PDF",
    share: "Share",
    printPdf: "Print / save PDF",
    packageMissingTitle: "Package is not on this tablet",
    packageMissingText: "Before going into the field, download the offline package. The page stores exam data on this device and can then be used without internet access for local editing.",
    find: "Find",
    zoomIn: "+",
    zoomOut: "−",
    gps: "GPS",
    cuzk: "CUZK orthophoto",
    osm: "OSM",
    examCenter: "Exam centre",
    selectedTree: "Selected tree",
    checked: "Checked",
    treeName: "Tree name",
    latitude: "Latitude",
    longitude: "Longitude",
    assignment: "Assignment",
    level: "Level",
    tree: "Tree",
    labelPosition: "Label position on map",
    labelOffsetX: "Label offset X px",
    labelOffsetY: "Label offset Y px",
    resetOffset: "Reset offset",
    candidateNote: "Candidate tree note",
    managementData: "Tree parameters / management data",
    taxon: "Taxon",
    heightM: "Height m",
    stemDiameterCm: "Stem diameter cm",
    crownSpreadM: "Crown spread m",
    managementNote: "Management note",
    interventions: "Intervention technologies",
    addTechnology: "+ technology",
    technology: "Technology",
    description: "Description",
    removeTechnology: "Remove technology",
    noTechnologies: "No intervention technologies have been entered yet.",
    chooseTree: "Select a tree on the map.",
  },
};

function fieldTabletText(locale, key) {
  return FIELD_TABLET_TRANSLATIONS[locale]?.[key] || FIELD_TABLET_TRANSLATIONS.en[key] || key;
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

function limitFieldTreesToRequiredCodes(trees, level = "Practicing", center = {}) {
  const source = fieldEnsureArray(trees);
  const includeAll = String(level || "").toLowerCase() === "all";
  const levels = includeAll ? FIELD_LEVELS : [normalizeFieldLevel(level)];
  const centerLat = Number(center?.latitude ?? center?.lat);
  const centerLng = Number(center?.longitude ?? center?.lng);
  const baseLat = Number.isFinite(centerLat) ? centerLat : 49.405888;
  const baseLng = Number.isFinite(centerLng) ? centerLng : 15.128912;
  const offsets = {
    "Practicing-A": { lat: 0.00025, lng: 0.00025 },
    "Practicing-B": { lat: 0.00045, lng: 0.00055 },
    "Practicing-C": { lat: 0.00015, lng: 0.00078 },
    "Practicing-D": { lat: -0.00018, lng: 0.00055 },
    "Consulting-A": { lat: 0.00005, lng: -0.00025 },
    "Consulting-B": { lat: 0.00033, lng: -0.00048 },
    "Consulting-C": { lat: -0.00012, lng: -0.00062 },
    "Consulting-D": { lat: -0.00038, lng: -0.00028 },
  };
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

function parseFieldCoordinates(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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
    name: `Strom ${index}`,
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
    siteName: `${centre} - terénní stanoviště`,
    referenceLatitude: 49.406706323273454,
    referenceLongitude: 15.129055089456797,
    mapProvider: "CUZK_ORTHO",
    status: "DRAFT",
    language,
    updatedAt: new Date().toISOString(),
    updatedBy: "Centre",
    examCenter: {
      id: vetbaraUid("field-center"),
      name: "Zkušební centrum / registrace",
      point: { x: 12, y: 18, lat: 49.405888298283934, lng: 15.128912434693621 },
      candidateNote: "Sraz kandidátů.",
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

function fieldTreeLabels(tree) {
  return (tree.assignments || []).map((assignment) => `${assignment.level === "Practicing" ? "P" : "C"}-${assignment.code}`);
}

function fieldPreparationValidationIssues(prep) {
  const issues = [];
  const center = prep?.examCenter;
  if (!center?.point || !Number.isFinite(Number(center.point.lat)) || !Number.isFinite(Number(center.point.lng))) {
    issues.push({ severity: "error", message: "Zkušební centrum nemá platné GPS souřadnice." });
  }

  for (const tree of prep?.trees || []) {
    if (!Number.isFinite(Number(tree.point?.lat)) || !Number.isFinite(Number(tree.point?.lng))) {
      issues.push({ severity: "error", message: `${tree.name || "Strom"} nemá platné GPS souřadnice.` });
    }
  }

  for (const level of FIELD_LEVELS) {
    for (const code of FIELD_TREE_CODES) {
      const matches = (prep?.trees || []).filter((tree) => (tree.assignments || []).some((assignment) => assignment.level === level && assignment.code === code));
      if (matches.length === 0) issues.push({ severity: "error", message: `Chybí ${level} strom ${code}.` });
      if (matches.length > 1) issues.push({ severity: "warning", message: `${level} strom ${code} je přiřazen více než jednou.` });
    }
  }

  const practicingA = (prep?.trees || []).find((tree) => (tree.assignments || []).some((assignment) => assignment.level === "Practicing" && assignment.code === "A"));
  const data = practicingA?.practicingTreeAData;
  if (!data) {
    issues.push({ severity: "error", message: "Practicing A nemá vyplněná management data." });
  } else {
    if (!String(data.taxon || "").trim()) issues.push({ severity: "error", message: "Practicing A: chybí taxon." });
    if (data.heightM === "" || data.heightM === null || data.heightM === undefined) issues.push({ severity: "error", message: "Practicing A: chybí výška." });
    if (data.stemDiameterCm === "" || data.stemDiameterCm === null || data.stemDiameterCm === undefined) issues.push({ severity: "error", message: "Practicing A: chybí průměr kmene." });
    if (data.crownSpreadM === "" || data.crownSpreadM === null || data.crownSpreadM === undefined) issues.push({ severity: "error", message: "Practicing A: chybí průmět koruny." });
    if (!Array.isArray(data.interventions) || data.interventions.length === 0 || data.interventions.every((item) => !String(item.technology || "").trim())) {
      issues.push({ severity: "error", message: "Practicing A: chybí alespoň jedna technologie zásahu." });
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

function fieldTabletUrl({ examId, level = "Practicing", token = CENTRE_ACCESS_TOKEN } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "field-tablet");
  url.searchParams.set("examId", examId || CENTRE_QR_ID);
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

function writeJsonLocalStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function appendFieldTabletSyncQueue(entry) {
  const key = fieldTabletQueueKey();
  const current = readJsonLocalStorage(key, []);
  writeJsonLocalStorage(key, [...(Array.isArray(current) ? current : []), entry]);
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


function CentreFieldPreparationModule({ centreCode, language }) {
  const [prep, setPrep] = useState(() => createDefaultFieldPreparation({ examId: centreCode || CENTRE_QR_ID, language }));
  const [selectedTreeId, setSelectedTreeId] = useState(() => fieldEnsureArray(prep.trees)[0]?.id || "");
  const [coordinateInput, setCoordinateInput] = useState(`${prep.referenceLatitude}, ${prep.referenceLongitude}`);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tabletLevel, setTabletLevel] = useState("Practicing");
  const [tabletSyncLoadedAt, setTabletSyncLoadedAt] = useState("");
  const centreMapRef = useRef(null);
  const centreDragRef = useRef(null);
  const centreFieldTrees = fieldEnsureArray(prep.trees);
  const selectedTree = centreFieldTrees.find((tree) => tree.id === selectedTreeId) || null;
  const issues = useMemo(() => fieldPreparationValidationIssues(prep), [prep]);
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
      setError("Všechny povinné stromy Practicing A-D a Consulting A-D už jsou připravené. Další strom přidejte jen změnou existujícího přiřazení.");
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

  async function loadFieldPreparation() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(prep.examId || centreCode || CENTRE_QR_ID)}/field-preparation`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Přípravu stanoviště se nepodařilo načíst.");
      const loaded = normalizeFieldPreparationForCentreMap(data.fieldPreparation || data);
      setPrep(loaded);
      setCoordinateInput(`${loaded.referenceLatitude}, ${loaded.referenceLongitude}`);
      setSelectedTreeId(fieldEnsureArray(loaded.trees)?.[0]?.id || "");
      setStatus("Příprava stanoviště načtena.");
    } catch (err) {
      setError(err.message || "Přípravu stanoviště se nepodařilo načíst.");
    }
  }

  async function loadTabletChanges() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(prep.examId || centreCode || CENTRE_QR_ID)}/field-tablet-sync/latest`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Změny z tabletu se nepodařilo načíst.");
      const loaded = normalizeFieldPreparationForCentreMap(data.fieldPreparation || data);
      setPrep(loaded);
      setCoordinateInput(`${loaded.referenceLatitude}, ${loaded.referenceLongitude}`);
      setSelectedTreeId(fieldEnsureArray(loaded.trees)?.[0]?.id || "__center__");
      const loadedAt = new Date().toISOString();
      setTabletSyncLoadedAt(loadedAt);
      setStatus(data?.syncId ? `Změny z tabletu načteny (${data.syncId}).` : "Změny z tabletu načteny.");
    } catch (err) {
      setError(err.message || "Změny z tabletu se nepodařilo načíst.");
    }
  }

  async function saveFieldPreparation() {
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(prep.examId || centreCode || CENTRE_QR_ID)}/field-preparation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldPreparation: prep }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Přípravu stanoviště se nepodařilo uložit.");
      setPrep(data.fieldPreparation || prep);
      setStatus("Příprava stanoviště uložena.");
    } catch (err) {
      setError(err.message || "Přípravu stanoviště se nepodařilo uložit.");
    }
  }

  function applyCoordinateSearch(event) {
    event?.preventDefault();
    const parsed = parseFieldCoordinates(coordinateInput);
    if (!parsed) {
      setError("Souřadnice musí být ve formátu například 49.406706323, 15.129055089.");
      return;
    }
    setError("");
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

  function handlePhotoUpload(treeId, files) {
    if (!files?.length) return;
    const next = Array.from(files).map((file) => ({ id: vetbaraUid("photo"), fileName: file.name, name: file.name, url: URL.createObjectURL(file), caption: "", uploadedAt: new Date().toISOString() }));
    updateTree(treeId, (tree) => ({ ...tree, photos: [...(tree.photos || []), ...next] }));
  }

  function currentFieldTabletUrl(level = tabletLevel) {
    return fieldTabletUrl({ examId: prep.examId || centreCode || CENTRE_QR_ID, level, token: CENTRE_ACCESS_TOKEN });
  }

  async function openFieldTablet(level = tabletLevel) {
    if (tabletSyncLoadedAt) {
      const password = window.prompt("Field tablet has already been synced back. Enter Vetarbo password to reopen it:");
      if (password !== "Vetarbo") {
        setError("Tablet mode is locked after tablet changes were loaded. Enter the Vetarbo password to reopen it.");
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

  function pointFromCentreMapEvent(event) {
    const rect = centreMapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const centerWorld = centreLatLngToWorld(prep.referenceLatitude, prep.referenceLongitude, 18);
    const worldX = centerWorld.x + (event.clientX - (rect.left + rect.width / 2));
    const worldY = centerWorld.y + (event.clientY - (rect.top + rect.height / 2));
    const { lat, lng } = centreWorldToLatLng(worldX, worldY, 18);
    return { lat, lng };
  }

  function startCentreDrag(kind, id, event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    centreDragRef.current = { kind, id, moved: false };
    if (kind === "tree") setSelectedTreeId(id);
    if (kind === "center") setSelectedTreeId("__center__");
  }

  function moveCentreDrag(event) {
    const drag = centreDragRef.current;
    if (!drag) return;
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
    const centerWorld = centreLatLngToWorld(prep.referenceLatitude, prep.referenceLongitude, 18);
    const pointWorld = centreLatLngToWorld(lat, lng, 18);
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
    return `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
  }

  function centreMapTiles() {
    const centerWorld = centreLatLngToWorld(prep.referenceLatitude, prep.referenceLongitude, 18);
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
          key: `centre-cuzk-18-${x}-${y}`,
          src: centreTileUrl(x, y, 18),
          style: { left: `calc(50% + ${dx * 256 - offsetX}px)`, top: `calc(50% + ${dy * 256 - offsetY}px)` },
        });
      }
    }
    return tiles;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <h3 className="font-semibold">Příprava stanoviště</h3>
            <p className="mt-1 text-sm text-slate-600">Připravte mapu a stromy, otevřete tabletový režim, načtěte změny z tabletu a uložte finální přípravu.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone={errorCount ? "bad" : "good"}>{errorCount ? `${errorCount} chyb` : "Bez blokující chyby"}</StatusPill>
              <StatusPill>{requiredReadyCount} / {FIELD_REQUIRED_ASSIGNMENTS.length} povinných přiřazení</StatusPill>
              <StatusPill>{prep.status || "DRAFT"}</StatusPill>
              {tabletSyncLoadedAt && <StatusPill tone="good">Tablet sync načten</StatusPill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className={`flex items-center gap-3 rounded-2xl border bg-white p-2 shadow-sm ${tabletSyncLoadedAt ? "border-amber-200 bg-amber-50" : ""}`}>
              <RealQr value={fieldTabletAccessUrl} size={88} />
              <div className="min-w-[13rem] text-sm">
                <div className="font-semibold text-slate-950">Tablet access</div>
                <div className="mt-1 break-all font-mono text-[11px] leading-snug text-slate-500">{fieldTabletAccessUrl}</div>
                {tabletSyncLoadedAt && <div className="mt-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Reopen requires Vetarbo</div>}
              </div>
            </div>
            <Button onClick={() => openFieldTablet(tabletLevel)} variant="outline" className={`rounded-2xl ${tabletSyncLoadedAt ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100" : ""}`}>Otevřít tablet</Button>
            <Button onClick={loadTabletChanges} variant="outline" className={`rounded-2xl ${tabletSyncLoadedAt ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200" : ""}`} title={tabletSyncLoadedAt ? `Poslední sync načten: ${new Date(tabletSyncLoadedAt).toLocaleString()}` : "Načíst poslední změny uložené tabletem"}>Načíst změny z tabletu</Button>
          </div>
        </div>
      </div>

      {status && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div>}
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-medium">Název areálu<input value={prep.siteName || ""} onChange={(event) => updatePrep({ siteName: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <label className="text-sm font-medium">Exam ID<input value={prep.examId || ""} onChange={(event) => updatePrep({ examId: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 font-mono text-xs" /></label>
              <form onSubmit={applyCoordinateSearch} className="text-sm font-medium">Referenční souřadnice<div className="mt-1 flex gap-2"><input value={coordinateInput} onChange={(event) => setCoordinateInput(event.target.value)} className="w-full rounded-xl border bg-white p-2 font-mono text-xs" /><Button type="submit" variant="outline" className="rounded-xl px-3">Najít</Button></div></form>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div><h3 className="font-semibold">Mapový náhled stanoviště</h3><p className="text-sm text-slate-600">MVP zobrazuje pracovní mapové plátno s GPS body. Reálné Leaflet/ČÚZK vrstvy jsou připravené jako další technický krok modulu.</p></div>
              <div className="text-xs text-slate-500">Reference: {Number(prep.referenceLatitude).toFixed(6)}, {Number(prep.referenceLongitude).toFixed(6)}</div>
            </div>
            <div ref={centreMapRef} onPointerMove={moveCentreDrag} onPointerUp={endCentreDrag} onPointerCancel={endCentreDrag} className="relative h-[520px] touch-none overflow-hidden rounded-2xl border bg-slate-100">
              <div className="field-tile-layer" aria-hidden="true">
                {centreMapTiles().map((tile) => <img key={tile.key} src={tile.src} style={tile.style} loading="lazy" alt="" />)}
              </div>
              <div className="absolute left-3 top-3 z-20 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">N ▲</div>
              <button type="button" onPointerDown={(event) => startCentreDrag("center", "__center__", event)} onClick={() => setSelectedTreeId("__center__")} style={markerForPoint(prep.examCenter?.point)} className="absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-lg ring-4 ring-white">Centrum</button>
              {fieldEnsureArray(prep.trees).map((tree) => {
                const selected = tree.id === selectedTreeId;
                const labels = fieldTreeLabels(tree);
                return <button type="button" key={tree.id} onPointerDown={(event) => startCentreDrag("tree", tree.id, event)} onClick={() => setSelectedTreeId(tree.id)} style={markerForPoint(tree.point)} className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl px-2 py-1 text-xs font-bold shadow-lg ring-4 ring-white ${selected ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}>{labels.length ? labels.join(" / ") : "strom"}</button>;
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {selectedTreeId === "__center__" ? (
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="font-semibold">Zkušební centrum</h3>
              <label className="mt-3 block text-sm font-medium">Název<input value={prep.examCenter?.name || ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, name: event.target.value } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">Latitude<input type="number" value={prep.examCenter?.point?.lat ?? ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, point: { ...prep.examCenter.point, lat: Number(event.target.value) } } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                <label className="text-sm font-medium">Longitude<input type="number" value={prep.examCenter?.point?.lng ?? ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, point: { ...prep.examCenter.point, lng: Number(event.target.value) } } })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              </div>
              <label className="mt-3 block text-sm font-medium">Poznámka pro kandidáty<textarea value={prep.examCenter?.candidateNote || ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, candidateNote: event.target.value } })} rows={3} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <label className="mt-3 block text-sm font-medium">Interní poznámka<textarea value={prep.examCenter?.internalNote || ""} onChange={(event) => updatePrep({ examCenter: { ...prep.examCenter, internalNote: event.target.value } })} rows={2} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
            </div>
          ) : selectedTree ? (
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vybraný strom</div><h3 className="text-lg font-semibold">{selectedTree.name}</h3><p className="text-xs text-slate-500">{formatFieldCoordinates(selectedTree.point)}</p></div>
                <Button onClick={() => removeTree(selectedTree.id)} variant="outline" className="rounded-2xl">Smazat</Button>
              </div>
              <label className="mt-3 block text-sm font-medium">Název stromu<input value={selectedTree.name || ""} onChange={(event) => updateTree(selectedTree.id, { name: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">Latitude<input type="number" value={selectedTree.point?.lat ?? ""} onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, point: { ...tree.point, lat: Number(event.target.value) } }))} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                <label className="text-sm font-medium">Longitude<input type="number" value={selectedTree.point?.lng ?? ""} onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, point: { ...tree.point, lng: Number(event.target.value) } }))} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              </div>
              <div className="mt-4 flex items-center justify-between"><h4 className="font-semibold">Přiřazení</h4><Button onClick={() => addAssignment(selectedTree.id)} variant="outline" className="rounded-2xl">+ přiřazení</Button></div>
              <div className="mt-2 space-y-2">
                {(selectedTree.assignments || []).map((assignment) => <div key={assignment.id} className="grid gap-2 rounded-xl border bg-slate-50 p-2 md:grid-cols-[1fr_1fr_auto]">
                  <select value={assignment.level} onChange={(event) => updateAssignment(selectedTree.id, assignment.id, { level: event.target.value })} className="rounded-xl border bg-white p-2 text-sm"><option>Practicing</option><option>Consulting</option></select>
                  <select value={assignment.code} onChange={(event) => updateAssignment(selectedTree.id, assignment.id, { code: event.target.value })} className="rounded-xl border bg-white p-2 text-sm">{FIELD_TREE_CODES.map((code) => <option key={code}>{code}</option>)}</select>
                  <Button onClick={() => removeAssignment(selectedTree.id, assignment.id)} variant="outline" className="rounded-xl">Odebrat</Button>
                </div>)}
              </div>
              <label className="mt-3 block text-sm font-medium">Poznámka pro kandidáty<textarea value={selectedTree.candidateNote || ""} onChange={(event) => updateTree(selectedTree.id, { candidateNote: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              <label className="mt-3 block text-sm font-medium">Interní poznámka<textarea value={selectedTree.internalNote || ""} onChange={(event) => updateTree(selectedTree.id, { internalNote: event.target.value })} rows={2} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
              {(selectedTree.assignments || []).some((assignment) => assignment.level === "Practicing" && assignment.code === "A") && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                <h4 className="font-semibold text-emerald-950">Practicing A · management data</h4>
                <label className="mt-2 block text-sm font-medium">Taxon<input value={selectedTree.practicingTreeAData?.taxon || ""} onChange={(event) => updatePracticingAData(selectedTree.id, { taxon: event.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <label className="text-sm font-medium">Výška m<input type="number" value={selectedTree.practicingTreeAData?.heightM ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { heightM: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                  <label className="text-sm font-medium">Průměr kmene cm<input type="number" value={selectedTree.practicingTreeAData?.stemDiameterCm ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { stemDiameterCm: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                  <label className="text-sm font-medium">Průmět koruny m<input type="number" value={selectedTree.practicingTreeAData?.crownSpreadM ?? ""} onChange={(event) => updatePracticingAData(selectedTree.id, { crownSpreadM: event.target.value === "" ? "" : Number(event.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>
                </div>
                <div className="mt-3 flex items-center justify-between"><h5 className="font-semibold">Technologie zásahu</h5><Button onClick={() => addIntervention(selectedTree.id)} variant="outline" className="rounded-xl">+ technologie</Button></div>
                <div className="mt-2 space-y-2">
                  {(selectedTree.practicingTreeAData?.interventions || []).map((intervention) => <div key={intervention.id} className="rounded-xl border bg-white p-2"><input value={intervention.technology || ""} onChange={(event) => updateIntervention(selectedTree.id, intervention.id, { technology: event.target.value })} placeholder="Technologie" className="w-full rounded-xl border bg-white p-2 text-sm" /><textarea value={intervention.description || ""} onChange={(event) => updateIntervention(selectedTree.id, intervention.id, { description: event.target.value })} placeholder="Popis" rows={2} className="mt-2 w-full rounded-xl border bg-white p-2 text-sm" /></div>)}
                </div>
              </div>}
              <label className="mt-4 block text-sm font-medium">Fotografie<input type="file" multiple accept="image/*" onChange={(event) => handlePhotoUpload(selectedTree.id, event.target.files)} className="mt-1 block w-full text-sm" /></label>
              <div className="mt-2 grid grid-cols-3 gap-2">{(selectedTree.photos || []).map((photo) => <img key={photo.id} src={photo.url} alt={photo.caption || photo.fileName || "photo"} className="h-20 w-full rounded-xl object-cover" />)}</div>
            </div>
          ) : <div className="rounded-2xl border bg-white p-4 text-sm text-slate-600">Vyberte strom nebo zkušební centrum v mapě.</div>}

          <div className="rounded-2xl border bg-white p-4">
            <h3 className="font-semibold">Validace</h3>
            <div className="mt-3 space-y-2 text-sm">
              {issues.length === 0 && <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">Příprava je kompletní.</div>}
              {issues.map((issue, index) => <div key={index} className={`rounded-xl p-3 ${issue.severity === "error" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>{issue.message}</div>)}
            </div>
          </div>
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

function FieldTabletPage() {
  const query = new URLSearchParams(window.location.search);
  const examId = query.get("examId") || CENTRE_QR_ID;
  const level = query.get("level") || "Practicing";
  const token = query.get("token") || "";
  const normalizedLevel = normalizeFieldLevel(level);
  const fieldTabletLocale = "en";
  const tt = (key) => fieldTabletText(fieldTabletLocale, key);
  const packageKey = fieldTabletStorageKey("package", examId, normalizedLevel);
  const draftKey = fieldTabletStorageKey("draft", examId, normalizedLevel);
  const [fieldPackage, setFieldPackage] = useState(() => readJsonLocalStorage(packageKey, null));
  const [draft, setDraft] = useState(() => readJsonLocalStorage(draftKey, null));
  const [selectedTreeCode, setSelectedTreeCode] = useState(() => firstFieldTabletTreeCode(readJsonLocalStorage(packageKey, null), normalizedLevel));
  const [status, setStatus] = useState(fieldPackage ? "The package is stored locally on this device." : "The package is not stored offline yet.");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSyncOk, setLastSyncOk] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [activeTabletLevel, setActiveTabletLevel] = useState(normalizedLevel);
  const [mapLayer, setMapLayer] = useState("cuzk");
  const [mapZoom, setMapZoom] = useState(18);
  const [mapCenterOverride, setMapCenterOverride] = useState(null);
  const [gpsPosition, setGpsPosition] = useState(null);
  const mapGestureRef = useRef({ pointers: new Map(), startCenterWorld: null, startPointer: null, startDistance: 0, startZoom: 18 });
  const treeDragRef = useRef(null);

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
    setStatus("Stahuji field package...");
    try {
      const fetchPackage = async (pkgLevel) => {
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/field-package/${pkgLevel.toLowerCase()}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Field package ${pkgLevel} could not be downloaded.`);
        return data;
      };
      const [practicing, consulting] = await Promise.all([fetchPackage("Practicing"), fetchPackage("Consulting")]);
      const data = {
        ...practicing,
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
      const nextDraft = {
        kind: "vetbara.fieldTabletDraft.v1",
        examId,
        level: "All",
        activeLevel: normalizedLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        treeNotes: Object.fromEntries(allTrees.map((tree) => {
          const key = fieldTreeKey(tree);
          return [key, draft?.treeNotes?.[key] || draft?.treeNotes?.[tree.code] || { visited: false, note: "", photos: [], labelDirection: tree.labelDirection || "n", labelOffsetX: Number(tree.labelOffsetX || 0), labelOffsetY: Number(tree.labelOffsetY || 0) }];
        })),
        generalNote: draft?.generalNote || "",
      };
      setDraft(nextDraft);
      writeJsonLocalStorage(draftKey, nextDraft);
      setStatus("Package downloaded and stored for offline use.");
    } catch (err) {
      setError(err.message || "Field package could not be downloaded.");
      setStatus(fieldPackage ? "Using the last locally stored package." : "Package is not available.");
    }
  }

  function updateDraft(updater) {
    const next = typeof updater === "function" ? updater(draft || {}) : { ...(draft || {}), ...updater };
    const withMeta = { ...next, examId, level: normalizedLevel, updatedAt: new Date().toISOString() };
    setDraft(withMeta);
    writeJsonLocalStorage(draftKey, withMeta);
    setLastSyncOk(false);
    setStatus("Local changes are saved on the tablet and waiting for sync.");
  }

  function updateTreeDraft(code, patch) {
    updateDraft((current) => ({
      ...current,
      treeNotes: {
        ...(current.treeNotes || {}),
        [code]: { ...(current.treeNotes?.[code] || {}), ...patch },
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
      const local = draft?.treeNotes?.[key] || draft?.treeNotes?.[tree.code] || {};
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

  async function syncBack() {
    if (!fieldPackage || !draft) {
      setError("Download the field package and store local data first.");
      return;
    }
    if (!allRequiredChecked) {
      setError("Sync is enabled only after all required trees are checked.");
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const payload = {
        kind: "vetbara.fieldTabletSync.v1",
        examId,
        level: normalizedLevel,
        token,
        syncedAt: new Date().toISOString(),
        packageSnapshot: fieldPackage,
        draft,
        fieldPreparationSnapshot: buildFieldPreparationSnapshotForSync(),
      };
      const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/field-tablet-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Sync failed.");
      setLastSyncOk(true);
      setStatus(data?.syncId ? `Synced back to VetBara (${data.syncId}).` : "Synced back to VetBara. The local copy remains on the tablet as backup.");
    } catch (err) {
      const queued = { id: vetbaraUid("field-sync"), examId, level: normalizedLevel, queuedAt: new Date().toISOString(), fieldPackage, draft };
      appendFieldTabletSyncQueue(queued);
      setLastSyncOk(false);
      setError(`${err.message || "Sync failed."} Změny byly uloženy do lokální sync queue.`);
    } finally {
      setSyncing(false);
    }
  }

  const centerSource = fieldPackage?.examCenter || {};
  const localCenter = draft?.examCenter || {};
  const center = { ...centerSource, ...localCenter };
  const normalizedTrees = normalizeFieldTabletTrees(fieldPackage, "All");
  const baseFieldTrees = limitFieldTreesToRequiredCodes(normalizedTrees, "All", center);
  const fieldTrees = baseFieldTrees.map((tree) => {
    const key = fieldTreeKey(tree);
    const local = draft?.treeNotes?.[key] || draft?.treeNotes?.[tree.code] || {};
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
    };
  });
  const visibleFieldTrees = activeTabletLevel === "Both" ? fieldTrees : fieldTrees.filter((tree) => normalizeFieldLevel(tree.level) === activeTabletLevel);
  const selectedTree = fieldTrees.find((tree) => fieldTreeKey(tree) === String(selectedTreeCode)) || visibleFieldTrees[0] || fieldTrees[0] || null;
  const readyOffline = Boolean(fieldPackage && draft);
  const selectedLocal = selectedTree ? (draft?.treeNotes?.[fieldTreeKey(selectedTree)] || draft?.treeNotes?.[selectedTree.code] || {}) : {};
  const visitedCount = visibleFieldTrees.filter((tree) => Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited || draft?.treeNotes?.[tree.code]?.visited)).length;
  const allRequiredChecked = fieldTrees.length >= FIELD_REQUIRED_ASSIGNMENTS.length && fieldTrees.every((tree) => Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited || draft?.treeNotes?.[tree.code]?.visited));
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
    return `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
  }

  function mapTiles() {
    const centerWorld = latLngToWorld(mapCenter.lat, mapCenter.lng);
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
          key: `${mapLayer}-${mapZoom}-${x}-${y}`,
          src: tileUrl(x, y, mapZoom),
          style: { left: `calc(50% + ${dx * 256 - offsetX}px)`, top: `calc(50% + ${dy * 256 - offsetY}px)` },
        });
      }
    }
    return tiles;
  }

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
    if (treeDragRef.current || event.target?.closest?.(".field-map-marker") || event.target?.closest?.(".field-map-toolbar")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointers = mapGestureRef.current.pointers;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    mapGestureRef.current.startCenterWorld = latLngToWorld(mapCenter.lat, mapCenter.lng, mapZoom);
    mapGestureRef.current.startPointer = { x: event.clientX, y: event.clientY };
    mapGestureRef.current.startDistance = pointerDistance(pointers);
    mapGestureRef.current.startZoom = mapZoom;
  }

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
    setMapCenterOverride(worldToLatLng(gesture.startCenterWorld.x - dx, gesture.startCenterWorld.y - dy, mapZoom));
  }

  function handleMapPointerEnd(event) {
    if (treeDragRef.current) return;
    mapGestureRef.current.pointers.delete(event.pointerId);
    if (mapGestureRef.current.pointers.size === 0) {
      mapGestureRef.current.startCenterWorld = null;
      mapGestureRef.current.startPointer = null;
      mapGestureRef.current.startDistance = 0;
      mapGestureRef.current.startZoom = mapZoom;
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

  function locateTablet() {
    setError("");
    if (!navigator.geolocation) {
      setError("GPS is not available in this browser.");
      return;
    }
    setStatus("Requesting GPS permission...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
        setGpsPosition(next);
        setMapCenterOverride({ lat: next.lat, lng: next.lng });
        setStatus(`GPS position loaded${Number.isFinite(next.accuracy) ? ` · accuracy approx. ${Math.round(next.accuracy)} m` : ""}.`);
      },
      (err) => setError(`GPS could not be loaded: ${err.message || "permission was denied"}.`),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
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
      const checked = Boolean(draft?.treeNotes?.[fieldTreeKey(tree)]?.visited || draft?.treeNotes?.[tree.code]?.visited);
      return `<div class="pdf-marker tree ${checked ? "checked" : ""}" style="left:calc(50% + ${p.x}px);top:calc(50% + ${p.y}px)"><span class="dot"></span><span class="label">${fieldTreeLabel(tree.level, tree.code)}</span></div>`;
    }).join("");
    return `<section class="pdf-map"><h2>${levelName}</h2><div class="pdf-map-canvas">${tiles.join("")}${centreMarker}${treeMarkers}</div></section>`;
  }

  function openFieldMapsPdf() {
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>VetBara field maps</title><style>
      @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#102018}.actions{position:fixed;top:8px;right:10px;z-index:20;display:flex;gap:8px}.actions button{border:0;border-radius:999px;padding:8px 12px;font-weight:700;background:#0f3d2e;color:white}main{display:grid;grid-template-columns:1fr 1fr;gap:8mm;height:190mm}.pdf-map{break-inside:avoid}.pdf-map h2{margin:0 0 5mm;font-size:16pt}.pdf-map-canvas{position:relative;height:164mm;overflow:hidden;border:2px solid #102018;border-radius:10px;background:#e6efe9}.pdf-map-canvas img{position:absolute;width:256px;height:256px}.pdf-marker{position:absolute;width:0;height:0;z-index:5}.pdf-marker .dot{position:absolute;left:0;top:0;width:12px;height:12px;border-radius:999px;background:white;border:3px solid white;transform:translate(-50%,-50%);box-shadow:0 1px 5px rgba(0,0,0,.35)}.pdf-marker .label{position:absolute;left:16px;top:-17px;white-space:nowrap;border-radius:999px;background:white;border:3px solid white;padding:6px 10px;font-weight:900;box-shadow:0 2px 10px rgba(0,0,0,.25)}.pdf-marker.centre .dot,.pdf-marker.centre .label{background:#e7334d;color:white;border-color:white}.pdf-marker.checked .dot{background:#2d6f36}.pdf-marker.checked .label{border-color:#2d6f36;box-shadow:0 0 0 4px rgba(45,111,54,.22),0 2px 10px rgba(0,0,0,.25)}@media print{.actions{display:none}main{height:auto}}
    </style></head><body><div class="actions"><button onclick="window.print()">${tt("printPdf")}</button><button onclick="if(navigator.share){navigator.share({title:'VetBara field maps',text:'VetBara field maps for ${examId}'})}">${tt("share")}</button></div><main>${buildPrintableFieldMap("Practicing")}${buildPrintableFieldMap("Consulting")}</main></body></html>`;
    const win = window.open("about:blank", "_blank");
    if (!win) {
      setError("The PDF window was blocked by the browser.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  const selectedTreeDisplayName = selectedLocal.treeName || selectedTree?.name || "";
  const selectedManagementData = selectedTree ? { ...(selectedTree.managementData || selectedTree.practicingTreeAData || {}), ...(selectedLocal.managementData || {}) } : {};
  const showManagementData = Boolean(selectedTree);

  return (
    <main className="field-tablet-shell">
      <section className="field-tablet-workspace">
        {!fieldPackage ? (
          <section className="field-empty-package">
            <h2>{tt("packageMissingTitle")}</h2>
            <p>{tt("packageMissingText")}</p>
            <button type="button" onClick={downloadForOffline} className="field-primary-button">{tt("downloadOffline")}</button>
            {error && <div className="field-tablet-status error">{error}</div>}
          </section>
        ) : (
          <section className="field-tablet-main-grid">
            <div className="field-left-column">
              <div className="field-map-card">
                <div className="field-map-toolbar field-map-toolbar-above" onPointerDown={stopMapControlEvent} onPointerMove={stopMapControlEvent} onPointerUp={stopMapControlEvent} onPointerCancel={stopMapControlEvent} onWheel={stopMapControlEvent} onClick={stopMapControlEvent}>
                    <button type="button" className={activeTabletLevel === "Practicing" ? "active" : ""} onClick={() => switchTabletLevel("Practicing")}>Practicing</button>
                    <button type="button" className={activeTabletLevel === "Consulting" ? "active" : ""} onClick={() => switchTabletLevel("Consulting")}>Consulting</button>
                    <button type="button" className={activeTabletLevel === "Both" ? "active" : ""} onClick={() => switchTabletLevel("Both")}>{tt("both")}</button>
                    <button type="button" onClick={() => setMapCenterOverride(defaultMapCenter)}>{tt("find")}</button>
                    <button type="button" onClick={() => setMapZoom((current) => clampMapZoom(current + 1))}>{tt("zoomIn")}</button>
                    <button type="button" onClick={() => setMapZoom((current) => clampMapZoom(current - 1))}>{tt("zoomOut")}</button>
                    <button type="button" onClick={locateTablet}>{tt("gps")}</button>
                    <button type="button" className={mapLayer === "cuzk" ? "active" : ""} onClick={() => setMapLayer("cuzk")}>{tt("cuzk")}</button>
                    <button type="button" className={mapLayer === "osm" ? "active" : ""} onClick={() => setMapLayer("osm")}>{tt("osm")}</button>
                    <button type="button" onClick={downloadForOffline} className="field-primary-button">{tt("downloadOffline")}</button>
                    <button type="button" onClick={openFieldMapsPdf} disabled={!readyOffline} className="field-ghost-button">{tt("pdf")}</button>
                    <button type="button" onClick={syncBack} disabled={syncing || !readyOffline || !allRequiredChecked} title={!allRequiredChecked ? tt("syncDisabledUntilChecked") : (lastSyncOk ? "Last sync succeeded." : "")} className={`field-ghost-button ${lastSyncOk ? "field-sync-ok" : ""}`}>{syncing ? tt("syncing") : tt("sync")}</button>
                  </div>
                <div className="field-real-map" onPointerDown={handleMapPointerDown} onPointerMove={handleMapPointerMove} onPointerUp={handleMapPointerEnd} onPointerCancel={handleMapPointerEnd} onWheel={handleMapWheel}>
                  {error && <div className="field-map-message error">{error}</div>}
                  <div className="field-tile-layer" aria-hidden="true">
                    {mapTiles().map((tile) => <img key={tile.key} src={tile.src} style={tile.style} loading="lazy" alt="" />)}
                  </div>
                  <div className="field-map-attribution">{mapLayer === "cuzk" ? "© CUZK orthophoto" : "© OpenStreetMap contributors"}</div>
                  {Number.isFinite(centerLat) && Number.isFinite(centerLng) && (() => {
                    const p = mapPoint(centerLat, centerLng);
                    return <div className="field-map-marker center" style={{ ...p, ...fieldMarkerVisualStyle("n", 0, 0) }}><span className="field-marker-stem" /><span className="field-marker-dot" title="Drag the dot to move the exact position" onPointerDown={startCenterMarkerDrag} /><button type="button" className="field-marker-label" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{tt("examCenter")}</button></div>;
                  })()}
                  {gpsPosition && (() => {
                    const p = mapPoint(gpsPosition.lat, gpsPosition.lng);
                    return <div className="field-map-marker gps" style={{ ...p, ...fieldMarkerVisualStyle("n", 0, 0) }} onPointerDown={(event) => event.stopPropagation()}><span className="field-marker-dot" /><span className="field-marker-label">{tt("gps")}</span></div>;
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
            </div>

            <aside className="field-detail-panel">
              {selectedTree ? (
                <>
                  <div className="field-detail-header">
                    <div>
                      <span>{tt("selectedTree")}</span>
                      <h2>{fieldTreeLabel(selectedTree.level, selectedTree.code)} · {selectedTreeDisplayName}</h2>
                      <p>{formatCoord(selectedTree.latitude)}, {formatCoord(selectedTree.longitude)}</p>
                    </div>
                    <label className="field-visited-toggle"><input type="checkbox" checked={Boolean(selectedLocal.visited)} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { visited: event.target.checked })} />{tt("checked")}</label>
                  </div>
                  <label className="field-detail-field">
                    <span>{tt("treeName")}</span>
                    <input value={selectedTreeDisplayName} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { treeName: event.target.value })} />
                  </label>
                  <div className="field-two-cols">
                    <label className="field-detail-field"><span>{tt("latitude")}</span><input value={formatCoord(selectedTree.latitude)} readOnly /></label>
                    <label className="field-detail-field"><span>{tt("longitude")}</span><input value={formatCoord(selectedTree.longitude)} readOnly /></label>
                  </div>
                  <div className="field-assignment-box">
                    <h3>{tt("assignment")}</h3>
                    <div className="field-assignment-row editable">
                      <label><span>{tt("level")}</span><select value={normalizeFieldLevel(selectedTree.level)} onChange={(event) => { const nextLevel = normalizeFieldLevel(event.target.value); setActiveTabletLevel(nextLevel); setSelectedTreeCode(fieldTreeKey(nextLevel, selectedTree.code)); }}><option>Practicing</option><option>Consulting</option></select></label>
                      <label><span>{tt("tree")}</span><select value={selectedTree.code} onChange={(event) => setSelectedTreeCode(fieldTreeKey(selectedTree.level, event.target.value))}>{FIELD_TREE_CODES.map((code) => <option key={code}>{code}</option>)}</select></label>
                    </div>
                  </div>
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
                  <label className="field-detail-field">
                    <span>{tt("candidateNote")}</span>
                    <textarea value={selectedTree.candidateNote || ""} onChange={(event) => updateTreeDraft(fieldTreeKey(selectedTree), { candidateNote: event.target.value })} rows={3} />
                  </label>
                  {selectedTree.photos?.length > 0 && <div className="field-photo-grid">{selectedTree.photos.map((photo) => <figure key={photo.id || photo.url}><img src={photo.url} alt={photo.caption || photo.fileName || "Photo"} /><figcaption>{photo.caption || photo.fileName}</figcaption></figure>)}</div>}
                  {showManagementData && <section className="field-practicing-box">
                    <h3>{tt("managementData")}</h3>
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
                  </section>}
                </>
              ) : <p>{tt("chooseTree")}</p>}
            </aside>
          </section>
        )}
      </section>
    </main>
  );
}

function CentreActivePackagePanel({ setVariants, setAvailableVariants, setTestBank, setOutdoorItemsByLevel, setActiveAdminPackageMeta, setTestImportSummary, setCentreSetupDirty, language }) {
  const [activePackagePreview, setActivePackagePreview] = useState(null);
  const [activePackagePreviewStatus, setActivePackagePreviewStatus] = useState("");
  const [activePackagePreviewError, setActivePackagePreviewError] = useState("");

  async function loadActivePackagePreview() {
    setActivePackagePreviewError("");
    setActivePackagePreviewStatus("Načítám aktivní Admin JSON balíček...");

    try {
      const response = await fetch("/api/centre/test-package/active");
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

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
        source: "active-admin-json",
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
            source: "active-admin-json",
          },
          {
            code: consultingCode,
            level: "Consulting",
            language: variantLanguage,
            status: "Approved",
            source: "active-admin-json",
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

      setActivePackagePreviewStatus(`Aktivní balíček načten a nastaven pro Centre: ${data.packageId}`);
    } catch (error) {
      setActivePackagePreviewError(error.message || "Načtení aktivního balíčku selhalo.");
      setActivePackagePreviewStatus("");
    }
  }

  return (
    <div data-vb-active-admin-package-panel="true" className="mb-4 rounded-2xl border bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-semibold">Aktivní Admin JSON balíček</h3>
          <p className="mt-1 text-sm text-slate-600">
            Centre načítá otázky, správné odpovědi, hodnoticí pomoc a outdoor exercises ze schváleného Admin JSON balíčku.
            Jazyk UX nemění obsah zkoušky.
          </p>
        </div>
        <Button onClick={loadActivePackagePreview} variant="outline" className="rounded-2xl">
          Načíst aktivní balíček
        </Button>
      </div>

      {activePackagePreviewStatus && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {activePackagePreviewStatus}
        </div>
      )}

      {activePackagePreviewError && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {activePackagePreviewError}
        </div>
      )}

      {activePackagePreview && (
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-semibold">Package</div>
            <div className="mt-1 break-all font-mono text-xs">{activePackagePreview.packageId}</div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-semibold">Practicing written</div>
            <div className="mt-1 text-xs">
              {activePackagePreview.variants?.Practicing?.writtenQuestionCount ?? "-"} / {activePackagePreview.variants?.Practicing?.writtenMax ?? "-"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-semibold">Consulting written</div>
            <div className="mt-1 text-xs">
              {activePackagePreview.variants?.Consulting?.writtenQuestionCount ?? "-"} / {activePackagePreview.variants?.Consulting?.writtenMax ?? "-"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-semibold">Practicing outdoor</div>
            <div className="mt-1 text-xs">
              {activePackagePreview.variants?.Practicing?.outdoorItemCount ?? "-"} / {activePackagePreview.variants?.Practicing?.outdoorMax ?? "-"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-semibold">Consulting outdoor</div>
            <div className="mt-1 text-xs">
              {activePackagePreview.variants?.Consulting?.outdoorItemCount ?? "-"} / {activePackagePreview.variants?.Consulting?.outdoorMax ?? "-"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CentreView({ centreUnlocked, centreCode, setCentreCode, unlockCentre, enabledLevels, toggleLevel, language, availableVariants, variants, setVariants, setAvailableVariants, testBank, setTestBank, setTestImportSummary, outdoorItemsByLevel, setOutdoorItemsByLevel, setActiveAdminPackageMeta, importTestPackage, testImportStatus, testImportError, testImportSummary, candidates, selectedCandidateId, setSelectedCandidateId, addCandidate, updateCandidate, assignments, setAssignments, examiners, candidateQrFor, examinerQrFor, centreSetupLoading, centreSetupSaving, centreSetupError, centreSetupStatus, centreAuditExportLoading, centreAuditExportError, centreQrAccess, centreValidationIssues, centreSetupDirty, setCentreSetupDirty, dataMode, candidateConfirmed, candidateStatus, candidateTimes, testResponses, reportDrafts, outdoor, handleLoadCentreSetup, handleSaveCentreSetup, handleDownloadCentreAuditPackage, updateExaminer, addExaminer, removeCandidate, removeExaminer, t }) {
  const [copiedQr, setCopiedQr] = useState("");
  const [activeCentreSection, setActiveCentreSection] = useState("setup");
  const [showCentreAdvanced, setShowCentreAdvanced] = useState(false);
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
  const candidateQrForRewritten = (id) => rewriteQrBaseUrl(candidateQrFor(id));
  const examinerQrForRewritten = (id) => rewriteQrBaseUrl(examinerQrFor(id));

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

    window.prompt("Copy this VetBara access link", text);
    setCopiedQr(t("centre.copy.unavailable").replace("{label}", label));
  }

  function CandidateEditorCard({ candidate }) {
    return (
      <div className={`rounded-2xl border bg-white p-3 text-sm ${selectedCandidateId === candidate.id ? "border-slate-950 bg-slate-50" : ""}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-500">{candidate.id}</div>
          <Button onClick={() => removeCandidate(candidate.id)} disabled={candidates.length <= 2} variant="outline" className="rounded-2xl px-3 py-1 text-xs">Odstranit</Button>
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

  function ExaminerEditorCard({ examiner }) {
    return (
      <div className="rounded-2xl border bg-white p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-500">{examiner.id}</div>
          <Button onClick={() => removeExaminer(examiner.id)} disabled={examiners.length <= 2} variant="outline" className="rounded-2xl px-3 py-1 text-xs">Odstranit</Button>
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

  const setupMeta = testImportSummary ? "Balíček načten" : "Čeká na balíček";
  const peopleMeta = `${candidates.length} kandidátů · ${examiners.length} zkoušejících`;
  const accessMeta = centreValidationIssues.length ? `${centreValidationIssues.length} kontrol` : "Připraveno";

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
          title="A - Nastavení zkoušky"
          description="Načtení aktivního balíčku, výběr úrovní a uložení konfigurace centra. Tuto sekci použijte jako první před zahájením práce s kandidáty."
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="font-semibold">Nastavení zkoušky</h3>
                <p className="mt-1 text-sm text-slate-600">Načtěte aktivní Admin balíček a uložte konfiguraci centra. Běžně stačí použít první dvě tlačítka a poté načíst aktivní balíček.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleLoadCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreSetupLoading ? "Načítám..." : "Otevřít uložené nastavení"}</Button>
                <Button onClick={handleSaveCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} className="rounded-2xl">{centreSetupSaving ? "Ukládám..." : "Uložit nastavení"}</Button>
                <Button onClick={() => setShowCentreAdvanced((value) => !value)} variant="outline" className="rounded-2xl">Pokročilé nástroje</Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={testImportSummary ? "good" : "warn"}>{setupMeta}</StatusPill>
              <StatusPill tone={centreSetupDirty ? "warn" : "good"}>{centreSetupDirty ? t("centre.setupPersistence.unsaved") : t("centre.setupPersistence.saved")}</StatusPill>
              <StatusPill tone={dataMode === "backend" ? "good" : "warn"}>{dataMode === "backend" ? t("centre.dataMode.backend") : t("centre.dataMode.demo")}</StatusPill>
            </div>
            {centreSetupStatus && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{centreSetupStatus}</div>}
            {centreSetupError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreSetupError}</div>}

            <CentreActivePackagePanel setVariants={setVariants} setAvailableVariants={setAvailableVariants} setTestBank={setTestBank} setOutdoorItemsByLevel={setOutdoorItemsByLevel} setActiveAdminPackageMeta={setActiveAdminPackageMeta} setTestImportSummary={setTestImportSummary} setCentreSetupDirty={setCentreSetupDirty} language={language} />

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border bg-white p-4">
                <h3 className="mb-3 font-semibold">Úrovně zkoušky</h3>
                {EXAM_LEVELS.map((level) => (
                  <label key={level} className="mb-3 flex items-center gap-3 rounded-xl border p-3 text-sm">
                    <input type="checkbox" checked={enabledLevels.includes(level)} onChange={() => toggleLevel(level)} />
                    <span>{level}</span>
                  </label>
                ))}
              </div>
              <div className="rounded-2xl border bg-white p-4 lg:col-span-2">
                <h3 className="font-semibold">Varianty zkoušky</h3>
                <p className="mt-1 text-sm text-slate-600">Po načtení Admin balíčku se varianty nastaví automaticky. Ruční změna je jen pro kontrolní nebo migrační situace.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {EXAM_LEVELS.map((level) => {
                    const vars = availableVariants.filter((variant) => variant.level === level && variant.language === language);
                    return (
                      <label key={level} className="text-sm font-medium">
                        {level}
                        <select value={variants[level] ?? ""} onChange={(event) => { setCentreSetupDirty(true); setVariants((previous) => ({ ...previous, [level]: event.target.value })); }} className="mt-1 w-full rounded-xl border bg-white p-2">
                          {vars.length ? vars.map((variant) => <option key={variant.code} value={variant.code}>{variant.code}</option>) : <option value="">{t("centre.variants.noImported")}</option>}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {testImportStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{testImportStatus}</div>}
                {testImportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{testImportError}</div>}
                {testImportSummary && <div className="mt-2 text-xs text-slate-500">{t("centre.variants.importedSummary").replace("{variants}", testImportSummary.variants).replace("{questions}", testImportSummary.questions)}</div>}
              </div>
            </div>

            {showCentreAdvanced && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-semibold">Pokročilé nástroje</h3>
                <p className="mt-1 text-sm text-slate-600">Servisní volby pro audit, ruční import starších balíčků a provozní kontroly. Běžný průchod zkouškou je obvykle nepotřebuje.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                    {t("centre.variants.import")}
                    <input type="file" accept=".csv,.json,application/json,text/csv" onChange={importTestPackage} className="hidden" />
                  </label>
                  <Button onClick={handleDownloadCentreAuditPackage} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreAuditExportLoading ? t("centre.setupPersistence.exporting") : t("centre.setupPersistence.auditExport")}</Button>
                </div>
                {centreAuditExportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreAuditExportError}</div>}
                <div className="mt-4 space-y-4">
                  <VetCertRulesReference />
                  <PilotReadinessGuardrails centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} testImportSummary={testImportSummary} dataMode={dataMode} StatusPill={StatusPill} t={t} />
                  <PilotRunSummary centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} testImportSummary={testImportSummary} dataMode={dataMode} StatusPill={StatusPill} t={t} />
                  <CentreNetworkReadinessChecklist StatusPill={StatusPill} t={t} />
                  <PilotSmokeTestChecklist StatusPill={StatusPill} t={t} />
                  <PilotReleaseNotesPanel StatusPill={StatusPill} t={t} />
                </div>
              </div>
            )}
          </div>
        </AdminDashboardSection>

        <AdminDashboardSection
          id="field-preparation"
          title="B - Příprava stanoviště"
          description="Příprava terénní části zkoušky: zkušební centrum, fyzické stromy, přiřazení Practicing/Consulting A-D, data pro Practicing A, validace a kandidátské exporty."
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <CentreFieldPreparationModule centreCode={centreCode || CENTRE_QR_ID} language={language} />
        </AdminDashboardSection>

        <AdminDashboardSection
          id="people"
          title="C - Kandidáti a zkoušející"
          description="Správa kandidátů, zkoušejících a přiřazení primary/secondary examinerů. Seznam kandidátů i zkoušejících používá stejný typ editačních karet."
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border bg-white p-4">
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold">Seznam kandidátů</h3>
                  <p className="mt-1 text-sm text-slate-600">Zadejte kandidáty a jejich úroveň zkoušky.</p>
                </div>
                <Button onClick={addCandidate} variant="outline" className="rounded-2xl">{t("centre.candidates.add")}</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {candidates.map((candidate) => <CandidateEditorCard key={candidate.id} candidate={candidate} />)}
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold">Seznam zkoušejících</h3>
                  <p className="mt-1 text-sm text-slate-600">Přidejte nebo upravte zkoušející, kteří budou přiřazeni kandidátům.</p>
                </div>
                <Button onClick={addExaminer} variant="outline" className="rounded-2xl">+ zkoušející</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {examiners.map((examiner) => <ExaminerEditorCard key={examiner.id} examiner={examiner} />)}
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <h3 className="mb-3 font-semibold">{t("centre.assignments.title")}</h3>
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
          </div>
        </AdminDashboardSection>

        <AdminDashboardSection
          id="access"
          title="D - Přístup a kontrola"
          description="QR odkazy pro kandidáty a zkoušející, kontrola připravenosti a provozní přehled zkoušky."
          activeSection={activeCentreSection}
          setActiveSection={setActiveCentreSection}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={centreValidationIssues.length ? "warn" : "good"}>{accessMeta}</StatusPill>
              <StatusPill>{peopleMeta}</StatusPill>
            </div>
            <CentreValidationSummary issues={centreValidationIssues} StatusPill={StatusPill} t={t} />
            <CentreCandidateResultsOverview candidates={candidates} assignments={assignments} examiners={examiners} variants={variants} testBank={testBank} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} outdoorItemsByLevel={outdoorItemsByLevel} t={t} />
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">QR base URL</div>
                  <p className="mt-1 text-sm text-slate-600">Production QR je výchozí a bezpečný. Local LAN QR použijte jen pro dočasné testování v místní síti.</p>
                </div>
                <StatusPill tone={qrBaseUrlMode === "local" ? "warn" : "good"}>
                  {qrBaseUrlMode === "local" ? "Local LAN QR" : "Production QR"}
                </StatusPill>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setQrBaseUrlMode("production")} variant={qrBaseUrlMode === "production" ? "default" : "outline"} className="rounded-2xl">Production QR</Button>
                <Button onClick={() => setQrBaseUrlMode("local")} variant={qrBaseUrlMode === "local" ? "default" : "outline"} className="rounded-2xl">Local LAN QR</Button>
              </div>
              {qrBaseUrlMode === "local" && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-950">Local LAN linky fungují jen na stejné síti jako tento počítač a mohou se rozbít po změně Wi-Fi/routeru. Před distribucí kandidátům/examinerům zkontrolujte náhled odkazu níže.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input value={localQrBaseUrlInput} onChange={(e) => setLocalQrBaseUrlInput(e.target.value)} placeholder="http://192.168.0.186:3010" className="min-w-64 flex-1 rounded-xl border bg-white p-2 font-mono text-sm" />
                    <Button onClick={applyLocalQrBaseUrl} className="rounded-2xl">Použít adresu</Button>
                  </div>
                  {localQrBaseUrlError && <p className="mt-2 text-sm font-medium text-rose-900">{localQrBaseUrlError}</p>}
                  {localQrBaseUrl && !localQrBaseUrlError && <p className="mt-2 text-xs text-emerald-800">Aktivní Local LAN base URL: {localQrBaseUrl}</p>}
                </div>
              )}
            </div>
            <CentreQrAccessPack candidates={candidates} examiners={examiners} candidateQrUrl={candidateQrUrl} examinerQrUrl={examinerQrUrl} candidateQrFor={candidateQrForRewritten} examinerQrFor={examinerQrForRewritten} copiedQr={copiedQr} copyQrLink={copyQrLink} QrCodeIcon={QrCodeIcon} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} RealQr={RealQr} t={t} />
          </div>
        </AdminDashboardSection>
      </div>
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
  return `vetbara.candidateFieldPackage.${candidate?.id || "candidate"}.${candidateLevel(candidate)}`;
}

function candidateTreeAPreparationStorageKey(candidate) {
  return `vetbara.candidateTreeAPreparation.${candidate?.id || "candidate"}.${candidateLevel(candidate)}`;
}

function normalizeCandidateTreePreparationDraft(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      notesByTree: value.notesByTree && typeof value.notesByTree === "object" ? value.notesByTree : {},
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { notesByTree: { A: value, "Practicing:A": value, "Consulting:A": value } };
  }
  return { notesByTree: {} };
}

function candidateTreePreparationNote(preparationDraft, tree) {
  const notes = normalizeCandidateTreePreparationDraft(preparationDraft).notesByTree;
  const key = fieldTreeKey(tree);
  const code = String(tree?.code || "").toUpperCase();
  return notes[key] ?? notes[code] ?? "";
}

function candidateTreeCharacteristics(tree) {
  const data = tree?.managementData || tree?.practicingData || tree?.treeData || tree || {};
  const textValue = (...keys) => keys.map((key) => data?.[key] ?? tree?.[key]).find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "-";
  return [
    ["Taxon", textValue("taxon", "species", "treeSpecies")],
    ["Height", textValue("height", "heightM", "treeHeight")],
    ["Stem diameter", textValue("stemDiameter", "stemDiameterCm", "diameter", "dbh")],
    ["Crown spread", textValue("crownSpread", "crownSpreadM", "crownProjection")],
    ["Candidate note", textValue("candidateNote", "note")],
  ];
}

function candidateFieldExamIds() {
  return Array.from(new Set([CENTRE_QR_ID, CENTRE_ACCESS_TOKEN, "VETBARA-CENTRE-ARBOR-2026"].filter(Boolean)));
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
      const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/field-package/${level}`);
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

function CandidateView({ candidates, loggedCandidate, confirmed, loginCandidate, logoutCandidate, confirmCandidate, sections, sectionStatus, sectionTimes, sectionTone, openSection, activeSection, setActiveSection, testResponses, updateTest, submitTest, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, updateReportPhoto, submitReport, variants, testBank, activeAdminPackageMeta, outdoorItemsByLevel, qrFor, setScannerMode, t }) {
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
        outdoorPreparationDraft: { treeNotes: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).notesByTree, fieldPackageSnapshot: candidateFieldPackage },
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

  function updateCandidateTreePreparationNote(tree, value) {
    if (!tree) return;
    const key = fieldTreeKey(tree);
    setCandidateTreeAPreparation((previous) => {
      const normalized = normalizeCandidateTreePreparationDraft(previous);
      const next = { ...normalized, notesByTree: { ...(normalized.notesByTree || {}), [key]: value } };
      if (loggedCandidate) writeJsonLocalStorage(candidateTreeAPreparationStorageKey(loggedCandidate), next);
      return next;
    });
  }

  function buildFullOfflineCandidatePackage() {
    if (!loggedCandidate) return null;

    return createOfflineCandidatePackage({
      candidate: loggedCandidate,
      variantCode: selectedVariantCode,
      testBankSnapshot: candidateQuestionSnapshot,
      testQuestionsSnapshot: candidateQuestionSnapshot,
      responses: testResponses[loggedCandidate.id] ?? {},
      reportDraft: reportDrafts[loggedCandidate.id] ?? createReportDraft(),
      outdoorPreparationDraft: { treeNotes: normalizeCandidateTreePreparationDraft(candidateTreeAPreparation).notesByTree, fieldPackageSnapshot: candidateFieldPackage },
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
      setLanPackageStatus("Balíček nelze uložit: chybí snapshot testových otázek z aktivního Admin/Centre balíčku. Nejprve v Centre načtěte aktuální test package a otevřete test znovu.");
      return;
    }

    setLanPackageSaving(true);
    setLanPackageSaved(false);
    setLanPackageStatus("Ukládám balíček na lokální server...");

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
      setLanPackageStatus(`Balíček uložen na lokální server: ${result.packageId}`);
    } catch (error) {
      console.error("LAN package save failed", error);
      setLanPackageStatus(`Uložení na lokální server selhalo: ${error.message || "neznámá chyba"}. Použijte záložní JSON export.`);
    } finally {
      setLanPackageSaving(false);
    }
  }


  if (loggedCandidate && (activeSection === "field-orientation" || activeSection === "field-trees")) {
    return <CandidateFieldResourcesSection candidate={loggedCandidate} fieldPackage={candidateFieldPackage} fieldStatus={candidateFieldStatus} fieldError={candidateFieldError} preparationDraft={candidateTreeAPreparation} updatePreparationNote={updateCandidateTreePreparationNote} setActiveSection={setActiveSection} mode={activeSection === "field-trees" ? "trees" : "orientation"} />;
  }

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={QrCodeIcon} title={t("candidate.view.title")} subtitle={t("candidate.view.subtitle")} /><CandidateQuickHelp t={t} /><div className="grid gap-4 lg:grid-cols-3">{!loggedCandidate && <div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{t("candidate.qrAccess.title")}</h3><Button onClick={() => setScannerMode("Candidate")} variant="outline" className="rounded-2xl">{t("common.scanQr")}</Button></div><p className="mt-3 text-sm text-slate-600">{t("candidate.qrAccess.helper")}</p></div>}<div className={`rounded-2xl border bg-white p-4 ${loggedCandidate ? "lg:col-span-3" : "lg:col-span-2"}`}>{!loggedCandidate ? <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{t("candidate.empty")}</div> : <div className="grid gap-4"><div className="rounded-2xl bg-slate-100 p-4"><div className="flex flex-wrap gap-2"><StatusPill tone="good">{t("common.loggedIn")}</StatusPill><StatusPill>{loggedCandidate.level}</StatusPill><StatusPill>{selectedVariantCode}</StatusPill></div><div className="mt-2 font-semibold">{loggedCandidate.name}</div><Button onClick={logoutCandidate} variant="outline" className="mt-3 rounded-2xl">{t("common.logout")}</Button></div>{activeSection === "landing" && <CandidateLanding candidate={loggedCandidate} confirmed={confirmed} confirmCandidate={confirmCandidate} sections={sections} status={sectionStatus} times={sectionTimes} tone={sectionTone} openSection={openSection} t={t} />}{activeSection === "test" && <TestSection candidate={loggedCandidate} selectedVariantCode={selectedVariantCode} testBank={testBank} responses={testResponses[loggedCandidate.id] ?? {}} updateTest={updateTest} submitTest={submitTest} setActiveSection={setActiveSection} introAccepted={Boolean(testIntroAccepted[testIntroKey])} acceptIntro={acceptTestIntro} t={t} />}{activeSection === "report" && loggedCandidate.level === "Consulting" && <ReportSection candidate={loggedCandidate} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} updateReportPhoto={updateReportPhoto} submitReport={submitReport} t={t} />}{canShowOfflinePackage && <div className="rounded-2xl border bg-slate-50 p-4"><h4 className="font-semibold">Předat uzavřený test a report zkoušejícímu</h4><p className="mt-1 text-sm text-slate-600">QR přenos mezi Candidate a Examiner je vypnutý. Balíček se uloží na lokální Vite server v rámci LAN a Examiner si jej načte ze svého portálu.</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={saveOfflineCandidatePackageToLan} disabled={lanPackageSaving || lanPackageSaved} className="rounded-2xl">{lanPackageSaving ? "Ukládám..." : lanPackageSaved ? "Uloženo na lokální server" : "Uložit balíček na lokální server"}</Button><Button onClick={downloadOfflineCandidatePackage} variant="outline" className="rounded-2xl">Záložně stáhnout JSON balíček</Button></div>{lanPackageStatus && <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700">{lanPackageStatus}</div>}<p className="mt-2 text-xs text-slate-500">Balíček obsahuje testové odpovědi, report, fotografie označené pro použití v reportu a snapshot testových otázek ({candidateQuestionSnapshot.length}).</p></div>}</div>}</div></div></CardContent></Card>;
}

function FieldMapTiles({ mapLayer, mapZoom, mapCenter, markers = [], gpsPosition, heightClass = "h-[430px]", allowPan = true, minZoom = 17, maxZoom = 20, title = "Orientace na ploše", showHeader = true }) {
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
        <div className="absolute left-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">N ▲</div>
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

function CandidateFieldResourcesSection({ candidate, fieldPackage, fieldStatus, fieldError, preparationDraft, updatePreparationNote, setActiveSection, mode = "orientation" }) {
  const [mapLayer, setMapLayer] = useState("cuzk");
  const [gpsPosition, setGpsPosition] = useState(null);
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
      <Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">Back</Button>
      <div className="ml-1 mr-3 text-lg font-bold">{mode === "trees" ? "Příprava stromů" : "Orientace"}</div>
      <Button onClick={locate} variant="outline" className="rounded-2xl">GPS</Button>
      <Button onClick={() => setMapLayer("cuzk")} variant={mapLayer === "cuzk" ? "default" : "outline"} className="rounded-2xl">CUZK orthophoto</Button>
      <Button onClick={() => setMapLayer("osm")} variant={mapLayer === "osm" ? "default" : "outline"} className="rounded-2xl">OSM</Button>
      {fieldStatus && <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{fieldStatus}</span>}
      {gpsStatus && <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">{gpsStatus}</span>}
    </div>
  );

  if (!fieldPackage) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        {toolbar}
        <div className="p-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{fieldError || "Field map package is not available on this tablet yet. Confirm identity again after the certification centre saves field preparation."}</div>
        </div>
      </div>
    );
  }

  if (mode === "orientation") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {toolbar}
        <div className="min-h-0 flex-1">
          <FieldMapTiles mapLayer={mapLayer} mapZoom={18} mapCenter={defaultCenter} markers={orientationMarkers} gpsPosition={gpsPosition} minZoom={17} maxZoom={20} heightClass="h-full" title="Orientace" showHeader={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {toolbar}
      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="min-h-0 border-r bg-slate-100">
          <FieldMapTiles mapLayer={mapLayer} mapZoom={20} mapCenter={selectedTreeCenter} markers={selectedTreeMarkers} gpsPosition={gpsPosition} allowPan={false} heightClass="h-full" minZoom={18} maxZoom={20} title="Tree preparation" showHeader={false} />
        </div>
        <div className="min-h-0 overflow-y-auto bg-white p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {FIELD_TREE_CODES.map((code) => {
              const available = orderedTrees.some((tree) => String(tree.code || "").toUpperCase() === code);
              return <Button key={code} onClick={() => setSelectedTreeCode(code)} disabled={!available} variant={selectedTreeCode === code ? "default" : "outline"} className="rounded-2xl">{code}</Button>;
            })}
          </div>
          {selectedTree ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected tree</div>
                <h3 className="text-2xl font-bold">{fieldTreeLabel(selectedTree.level, selectedTree.code)} · {selectedTree.name || `Tree ${selectedTree.code}`}</h3>
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
                <span className="text-sm font-semibold">Candidate notes</span>
                <textarea value={candidateTreePreparationNote(preparationDraft, selectedTree)} onChange={(event) => updatePreparationNote(selectedTree, event.target.value)} rows={16} placeholder="Write your own notes for this tree here." className="mt-2 w-full rounded-2xl border bg-white p-4 text-base leading-relaxed shadow-inner" />
              </label>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">No trees A-D are available in the field package for this level.</div>
          )}
        </div>
      </div>
    </div>
  );
}


function CandidateLanding({ candidate, confirmed, confirmCandidate, sections, status, times, tone, openSection, t }) {
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

  return <div className="grid gap-4 lg:grid-cols-3"><div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-1" : ""}`}><div className="mb-3 rounded-xl bg-slate-950 p-4 text-white"><div className="text-xs uppercase tracking-wide text-slate-300">Candidate ID</div><div className="text-3xl font-bold tracking-tight">{candidate.id}</div></div><h3 className="font-semibold">{t("candidate.identity.detailsTitle")}</h3>{!confirmed && [[t("candidate.identity.name"), candidate.name], [t("candidate.identity.examLevel"), candidate.level]].map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}{confirmed && <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="font-medium">{candidate.name}</div><div className="text-xs text-slate-500">{candidate.level}</div></div>}{!confirmed && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{t("candidate.identity.warning")}</p>}<Button onClick={confirmCandidate} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? t("candidate.identity.confirmed") : t("candidate.identity.confirm")}</Button></div><div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-2" : "lg:col-span-2"}`}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">{t("candidate.landing.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("candidate.landing.helper")}</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{sections.map((section) => <div key={section.key} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{section.title}</h4><p className="mt-1 text-sm text-slate-600">{section.description}</p></div><StatusPill tone={tone(status[section.key])}>{status[section.key]}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{sectionHelper(status[section.key])}</p><div className="mt-3 text-xs text-slate-500"><div>{t("common.opened")}: {times[section.key]?.openedAt || "-"}</div><div>{t("common.closed")}: {times[section.key]?.closedAt || "-"}</div></div><Button onClick={() => openSection(section.key)} disabled={!confirmed} className="mt-4 rounded-2xl">{section.key.startsWith("field-") ? section.title : (status[section.key] === "closed" ? t("candidate.section.requestReopen") : t("candidate.sections.open"))}</Button></div>)}</div></div></div>;
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
  };
}

function candidateLevel(candidate) {
  const level = String(candidate?.level || "").trim().toLowerCase();
  if (level.includes("consult")) return "Consulting";
  return "Practicing";
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

const TEST_INTRO_COPY = {
  Practicing: {
    title: "Before you start the Practicing written test",
    sections: [
      {
        heading: "Section A",
        paragraphs: [
          "This section contains 10 multiple choice questions. For each question choose 1 answer that best answers the question. Each question is worth 1 mark. You should attempt to answer all questions. A total of 10 marks are available for this section.",
        ],
      },
      {
        heading: "Section B",
        paragraphs: [
          "This section contains 24 questions that require a written answer. Questions have been grouped into themes, the title of the theme is listed in bold and is underlined.",
          "The number of marks available for each question is shown. You should attempt to answer all questions in this section. A total of 36 marks are available for this section.",
          "Questions are grouped into the following themes:",
        ],
        bullets: [
          "The development and aging of trees;",
          "Roots of veteran trees and the soil environment;",
          "The values of veteran trees;",
          "Legislation affecting veteran tree management;",
          "Veteran tree management; and",
          "Country specific question(s).",
        ],
      },
    ],
  },
  Consulting: {
    title: "Before you start the Consulting written test",
    sections: [
      {
        paragraphs: [
          "This exam paper contains 45 questions that require a written answer. Questions have been grouped into themes, the title of the theme is listed in bold and is underlined.",
          "For each question, the number of marks available is detailed. You should attempt to answer all questions. A total of 97 marks are available for this paper.",
          "Questions are grouped into the following themes:",
        ],
        bullets: [
          "The development and aging of trees;",
          "Roots of veteran trees and the soil environment;",
          "The values of veteran trees;",
          "Legislation affecting veteran tree management; and",
          "Surveying and managing veteran trees.",
        ],
      },
    ],
  },
};

function WrittenTestIntroGate({ candidate, onAccept, onBack }) {
  const level = candidateLevel(candidate);
  const copy = TEST_INTRO_COPY[level] ?? TEST_INTRO_COPY.Practicing;

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{copy.title}</h3>
          <p className="mt-1 text-sm text-slate-600">Read this information carefully. You must confirm it before the test questions are shown.</p>
        </div>
        <Button onClick={onBack} variant="outline" className="rounded-2xl">Back</Button>
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
        By continuing, the candidate confirms that they have read and understood the instructions for this written test.
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAccept} className="rounded-2xl">I have read and understood - start test</Button>
        <Button onClick={onBack} variant="outline" className="rounded-2xl">Cancel</Button>
      </div>
    </div>
  );
}

function TestSection({ candidate, selectedVariantCode, testBank, responses, updateTest, submitTest, setActiveSection, introAccepted, acceptIntro, t }) {
  const requestedVariantCode = String(selectedVariantCode || "");
  const effectiveVariantCode = variantCodeMatchesCandidateLevel(candidate, requestedVariantCode)
    ? requestedVariantCode
    : candidateLevel(candidate) === "Consulting"
      ? "CONSULTING_ADMIN_PACKAGE"
      : "PRACTICING_ADMIN_PACKAGE";

  const questions = questionsForVariantStrict(testBank, effectiveVariantCode);
  const hasStrictQuestions = questions.length > 0;
  const helper = t("test.variantAutosave").replace("{variant}", selectedVariantCode);

  if (!introAccepted) {
    return <WrittenTestIntroGate candidate={candidate} onAccept={acceptIntro} onBack={() => setActiveSection("landing")} />;
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("test.title")}</h3>
          <p className="text-sm text-slate-600">{helper}</p>
        </div>
        <Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">
          {t("common.back")}
        </Button>
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
              <div className="mt-1 font-medium">{q.text}</div>
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

      <Button onClick={submitTest} disabled={questions.length === 0} className="mt-4 rounded-2xl">
        <Lock className="mr-2 h-4 w-4" /> {t("test.submit")}
      </Button>
      <p className="mt-2 text-xs text-slate-500">{t("common.offlineRetry")}</p>
    </div>
  );
}

function ReportSection({ candidate, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, updateReportPhoto, submitReport, t }) {
  const draft = reportDrafts[candidate.id] ?? createReportDraft();
  const tree = draft[activeReportTree];
  const [photoStatus, setPhotoStatus] = useState("");
  const [reportStep, setReportStep] = useState("field");
  const [photoViewer, setPhotoViewer] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [fieldNotesDraft, setFieldNotesDraft] = useState(tree.fieldNotes ?? "");
  const [photoDescriptionDrafts, setPhotoDescriptionDrafts] = useState({});
  const handwritingCanvasRef = useRef(null);
  const handwritingDrawingRef = useRef(false);
  const [handwritingOpen, setHandwritingOpen] = useState(false);

  const label = (key, fallback) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const localKey = `vetbara-report-field-backup-${candidate.id}-${activeReportTree}`;

  useEffect(() => {
    setFieldNotesDraft(tree.fieldNotes ?? "");
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
      setPhotoStatus(`Lokálně uloženo: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.warn("Report field manual save skipped", error);
      setPhotoStatus("Lokální uložení poznámek proběhlo bez obrazových dat fotografií.");
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

    files.forEach((file) => {
      const reader = new FileReader();

      reader.onload = () => {
        addReportPhoto(activeReportTree, {
          name: file.name || `photo-${Date.now()}`,
          type: file.type || "image/*",
          size: file.size,
          dataUrl: reader.result,
          description: "",
          useInReport: true,
          createdAt: new Date().toISOString(),
        });

        loaded += 1;
        if (loaded + failed === files.length) {
          setPhotoStatus(loaded === 1 ? t("report.photoAdded") : `Přidáno fotografií: ${loaded}`);
          input.value = "";
        }
      };

      reader.onerror = () => {
        failed += 1;
        if (loaded + failed === files.length) {
          setPhotoStatus(failed ? t("report.photoError") : t("report.photoAdded"));
          input.value = "";
        }
      };

      reader.readAsDataURL(file);
    });
  }

  function handleSubmitReport() {
    const confirmed = window.confirm(
      "Kontrola před odesláním reportu\n\nJe vyplněný report pro oba dva stromy (A+B)?\n\nJsou anotované fotografie k použití v reportu?\n\nPo potvrzení bude report odeslán a uzavřen."
    );
    if (!confirmed) return;
    submitReport();
  }

  function canvasPoint(event) {
    const canvas = handwritingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startHandwriting(event) {
    if (event.pointerType && event.pointerType !== "pen") return;
    const canvas = handwritingCanvasRef.current;
    if (!canvas) return;

    event.preventDefault();
    handwritingDrawingRef.current = true;
    canvas.setPointerCapture?.(event.pointerId);

    const ctx = canvas.getContext("2d");
    const point = canvasPoint(event);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function drawHandwriting(event) {
    if (!handwritingDrawingRef.current) return;
    if (event.pointerType && event.pointerType !== "pen") return;

    event.preventDefault();
    const canvas = handwritingCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const point = canvasPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function stopHandwriting(event) {
    handwritingDrawingRef.current = false;
    handwritingCanvasRef.current?.releasePointerCapture?.(event.pointerId);
  }

  function clearHandwriting() {
    const canvas = handwritingCanvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  function saveHandwritingAsPhoto() {
    const canvas = handwritingCanvasRef.current;
    if (!canvas) return;

    addReportPhoto(activeReportTree, {
      name: `handwriting-${activeReportTree}-${Date.now()}.png`,
      type: "image/png",
      size: 0,
      dataUrl: canvas.toDataURL("image/png"),
      description: "Rukopisná terénní poznámka",
      useInReport: false,
      createdAt: new Date().toISOString(),
    });

    setPhotoStatus("Rukopisná poznámka byla uložena mezi fotografie.");
    setHandwritingOpen(false);
  }

  function HandwritingPad() {
    return (
      <div className={`${handwritingOpen ? "fixed inset-0 z-50 overflow-auto bg-white p-4" : "rounded-2xl border bg-white p-4"}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold">Rukopisné poznámky</h4>
            <p className="mt-1 text-sm text-slate-600">
              Pište stylusem. Po uložení se rukopis uloží jako pracovní fotografie, standardně nezařazená do reportu.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setHandwritingOpen((value) => !value)} variant="outline" className="rounded-2xl">
              {handwritingOpen ? "Zavřít celou obrazovku" : "Otevřít na celou obrazovku"}
            </Button>
            <Button type="button" onClick={clearHandwriting} variant="outline" className="rounded-2xl">
              Smazat rukopis
            </Button>
            <Button type="button" onClick={saveHandwritingAsPhoto} className="rounded-2xl">
              Uložit rukopis mezi fotografie
            </Button>
          </div>
        </div>
        <canvas
          ref={handwritingCanvasRef}
          width={1600}
          height={900}
          onPointerDown={startHandwriting}
          onPointerMove={drawHandwriting}
          onPointerUp={stopHandwriting}
          onPointerCancel={stopHandwriting}
          className="h-[420px] w-full rounded-2xl border bg-white"
          style={{ touchAction: "none" }}
        />
      </div>
    );
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
              Fotografie: {(draft[treeName]?.photos ?? []).length} · poznámky: {String(draft[treeName]?.fieldNotes ?? "").trim() ? "ano" : "ne"}
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
              <button type="button" onClick={() => setPhotoViewer(photo)} className="flex w-full items-center gap-3 text-left">
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
                Popis fotografie
                <input
                  value={description}
                  maxLength={100}
                  onChange={(e) => setPhotoDescriptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value.slice(0, 100) }))}
                  onBlur={() => updateReportPhoto(activeReportTree, photo.id, { description })}
                  placeholder="Krátký popis, max. 100 znaků"
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
                Použít v reportu
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
        <h3 className="text-2xl font-bold">Krok 1: Terénní sběr dat</h3>
        <p className="mt-1 text-sm text-slate-600">
          Sbírejte pouze fotografie a terénní poznámky. Data se průběžně ukládají lokálně do tohoto zařízení.
        </p>

        {TreeTabs()}

        <div className="mt-4 rounded-2xl bg-slate-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Fotografie: {(tree.photos ?? []).length}</div>
              <p className="mt-1 text-sm text-slate-600">Fotografie se ukládají lokálně do návrhu reportu.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => cameraInputRef.current?.click()} variant="outline" className="rounded-2xl">
                Vyfotit fotografii
              </Button>
              <Button type="button" onClick={() => galleryInputRef.current?.click()} variant="outline" className="rounded-2xl">
                Vybrat z galerie
              </Button>
              <input ref={cameraInputRef} type="file" accept="image/*,.heic,.heif" capture="environment" onChange={handlePhotoInputChange} className="hidden" />
              <input ref={galleryInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handlePhotoInputChange} className="hidden" />
            </div>
          </div>

          {photoStatus && <div className="mt-2 text-xs font-medium text-slate-600">{photoStatus}</div>}
          {(tree.photos ?? []).length > 0 && PhotoGrid()}
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <h4 className="text-lg font-semibold">Terénní poznámky (nevstupují do reportu)</h4>
          <p className="mt-1 text-sm text-slate-600">Tyto poznámky slouží jako pracovní podklad pro druhý krok.</p>
          <textarea
            value={fieldNotesDraft}
            onChange={(e) => setFieldNotesDraft(e.target.value)}
            onBlur={() => updateReport(activeReportTree, "fieldNotes", fieldNotesDraft, "fieldNotes")}
            placeholder="Terénní pozorování a pracovní poznámky..."
            className="mt-3 min-h-72 w-full rounded-xl border bg-white p-4 text-base"
            style={{ resize: "vertical" }}
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck="true"
          />
        </div>

        <div className="mt-4">
          {HandwritingPad()}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={saveFieldDataLocally} variant="outline" className="rounded-2xl">
            Ulož lokálně pro pozdější zpracování
          </Button>
          <Button onClick={() => setReportStep("write")} className="rounded-2xl">
            Pokračovat psaním reportu
          </Button>
        </div>
      </div>
    );
  }

  function ReportWritingStep() {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-white p-5">
        <div className="mx-auto max-w-7xl">
          <div className="sticky top-0 z-10 mb-4 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold">Krok 2: Psaní Consulting reportu</h3>
                <p className="mt-1 text-sm text-slate-600">{candidate.name} · {activeReportTree}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setReportStep("field")} variant="outline" className="rounded-2xl">
                  Zpět do terénních dat
                </Button>
                <Button onClick={handleSubmitReport} className="rounded-2xl">
                  <Lock className="mr-2 h-4 w-4" /> Odeslat a uzavřít report
                </Button>
              </div>
            </div>
          </div>

          {TreeTabs()}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <h4 className="font-semibold">Terénní poznámky</h4>
              <div className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-sm">
                {String(fieldNotesDraft ?? tree.fieldNotes ?? "").trim() || "-"}
              </div>

              <h4 className="mt-4 font-semibold">Fotografie pro report</h4>
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
                        Popis fotografie
                        <input
                          value={description}
                          maxLength={100}
                          onChange={(e) => setPhotoDescriptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value.slice(0, 100) }))}
                          onBlur={() => updateReportPhoto(activeReportTree, photo.id, { description })}
                          placeholder="Krátký popis, max. 100 znaků"
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
                        Použít v reportu
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="grid gap-3 md:grid-cols-2">
                {REPORT_SECTIONS.map((sec) => (
                  <label key={sec.key} className="text-sm font-medium">
                    {sec.title}
                    <textarea
                      value={tree.finalSections[sec.key] ?? ""}
                      onChange={(e) => updateReport(activeReportTree, sec.key, e.target.value)}
                      placeholder={`${activeReportTree}: ${sec.title}`}
                      className="mt-1 min-h-32 w-full rounded-xl border bg-white p-3 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {reportStep === "field" ? FieldCollectionStep() : ReportWritingStep()}

      {photoViewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 p-4 text-white">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold">{photoViewer.description || photoViewer.name || photoViewer.id}</h3>
              <p className="text-sm text-slate-300">Fotografii lze na tabletu přiblížit gestem.</p>
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
  outdoorItemsByLevel,
  setOutdoorItemsByLevel,
  updateOutdoor,
  updateOutdoorNote,
  outdoorTotal,
  outdoorMax,
  submitOutdoor,
  archivePlan,
  practicingArchive,
  scoring,
  activeScoreLimits,
  updateScore,
  generateEvaluation,
  lastEvaluation,
  loadEvaluationPreview,
  evaluationPreview,
  evaluationLoading,
  evaluationError,
  downloadDraftExport,
  exportLoading,
  exportError,
  variants,
  testBank,
  testResponses,
  reportDrafts, importedCandidatePackages, setImportedCandidatePackages,
  qrFor,
  setScannerMode,
  importOfflineCandidatePackageFile,
  importOfflineCandidatePackageData,
  examinerTimes,
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
          <VetCertRulesReference />
          <ExaminerQuickHelp t={t} />
          {loggedExaminer && (
            <div className="mb-4 rounded-2xl border bg-slate-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-semibold">Offline balíček kandidáta</h3>
                  <p className="mt-1 text-sm text-slate-600">Pokud nefunguje backend nebo internet, nahrajte zde JSON balíček exportovaný z Candidate portálu.</p>
                </div>
                <label className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                  Importovat offline balíček
                  <input type="file" accept=".json,application/json" onChange={importOfflineCandidatePackageFile} className="hidden" />
                </label>
              </div>
            </div>
          )}
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
                  variants={variants}
                  testBank={testBank}
                  testResponses={testResponses}
                  reportDrafts={reportDrafts}
                  outdoor={outdoor}
                  outdoorItemsByLevel={outdoorItemsByLevel}
                  examinerTimes={examinerTimes}
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
                  t={t}
                />
              ) : activePage === "reportReview" ? (
                <ExaminerReportReview
                  selectedCandidate={selectedCandidate}
                  reportDrafts={reportDrafts}
                  openWrittenReview={openWrittenReview}
                  setActivePage={setActivePage}
                  t={t}
                />
              ) : (
                <OutdoorForm
                  selectedCandidate={selectedCandidate}
                  selectedMode={selectedMode}
                  activeOutdoorSection={activeOutdoorSection}
                  setActiveOutdoorSection={setActiveOutdoorSection}
                  outdoor={outdoor}
                  outdoorNotes={outdoorNotes}
                  outdoorItemsByLevel={outdoorItemsByLevel}
                  setOutdoorItemsByLevel={setOutdoorItemsByLevel}
                  updateOutdoor={updateOutdoor}
                  updateOutdoorNote={updateOutdoorNote}
                  outdoorTotal={outdoorTotal}
                  outdoorMax={outdoorMax}
                  submitOutdoor={submitOutdoor}
                  archivePlan={archivePlan}
                  practicingArchive={practicingArchive}
                  setActivePage={setActivePage}
                  time={examinerTimes[selectedCandidate.id]?.outdoor}
                  t={t}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {activePage === "scoring" && <ScoringCard
        selectedCandidate={selectedCandidate}
        assignment={assignments[selectedCandidate.id]}
        scoring={scoring}
        updateScore={updateScore}
        generateEvaluation={generateEvaluation}
        lastEvaluation={lastEvaluation}
        loadEvaluationPreview={loadEvaluationPreview}
        evaluationPreview={evaluationPreview}
        evaluationLoading={evaluationLoading}
        evaluationError={evaluationError}
        downloadDraftExport={downloadDraftExport}
        exportLoading={exportLoading}
        exportError={exportError}
        variants={variants}
        testBank={testBank}
        testResponses={testResponses}
        reportDrafts={reportDrafts}
        t={t}
      />}
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

function ExaminerWrittenReview({ selectedCandidate, variants, testBank, testResponses, importedCandidatePackages, scoringLimits, updateScore, setActivePage, t }) {
  const [showExamInfo, setShowExamInfo] = useState(false);
  const [questionScores, setQuestionScores] = useState({});

  if (!selectedCandidate) {
    return (
      <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          Zpět na seznam kandidátů
        </Button>
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Není vybraný kandidát pro opravu testu.
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
  }

  function applyManualWrittenScore() {
    const ok = window.confirm(`Odeslat a uzavřít TEST pro ${selectedCandidate.name}?\n\nVýsledek: ${manualTotal} / ${manualMax || writtenMax} bodů.`);
    if (!ok) return;
    updateScore("written", manualTotal, { closed: true });
  }

  return (
    <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">Oprava písemného testu</h3>
          <p className="mt-1 text-sm text-slate-600">
            {selectedCandidate.name} · {selectedCandidate.id} · {selectedCandidate.level}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Varianta: {review.variantCode || "-"} · Odpovězeno: {answeredCount} / {questions.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowExamInfo((value) => !value)} variant="outline" className="rounded-2xl">
            Info k hodnocení
          </Button>
          {selectedCandidate.level === "Consulting" && (
            <Button onClick={() => setActivePage("reportReview")} variant="outline" className="rounded-2xl">
              Přejít na kontrolu reportu
            </Button>
          )}
          <Button onClick={() => setActivePage("landing")} variant="outline" className="rounded-2xl">
            Zpět na seznam kandidátů
          </Button>
          <Button onClick={applyManualWrittenScore} className="rounded-2xl">
            Odeslat a uzavřít TEST
          </Button>
        </div>
      </div>

      {importedPackage && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="font-semibold">Importovaný kandidátský balíček</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            <div>Varianta: <strong>{importedPackage.variantCode || "-"}</strong></div>
            <div>Vytvořeno: <strong>{importedPackage.createdAt ? new Date(importedPackage.createdAt).toLocaleString() : "-"}</strong></div>
            <div>Admin package: <strong>{importedPackage.activeAdminPackage?.packageId || "-"}</strong></div>
            <div>Snapshot otázek: <strong>{Array.isArray(importedQuestions) ? importedQuestions.length : 0}</strong></div>
          </div>
        </div>
      )}

      {showExamInfo && (
        <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="mb-2 font-semibold">Celkové informace k hodnocení písemné části</div>
          <div className="whitespace-pre-wrap">{writtenExamInfo(selectedCandidate.level)}</div>
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">Questions</div>
          <div className="text-xl font-bold">{questions.length}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">Answered</div>
          <div className="text-xl font-bold">{answeredCount}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">Manual score</div>
          <div className="text-xl font-bold">{manualTotal}</div>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-sm">
          <div className="text-xs text-slate-500">Manual max</div>
          <div className="text-xl font-bold">{manualMax || writtenMax}</div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Hodnoticí nápověda je určena pouze pro Examinera. Candidate ji nikdy nevidí. Správné odpovědi ani answer key se v Candidate rozhraní nezobrazují.
      </div>

      {variantLanguageFromCode(review.variantCode) && variantLanguageFromCode(review.variantCode) !== variantLanguageFromCode(importedPackage?.variantCode || review.variantCode) && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          Jazyk testové varianty neodpovídá jazyku kandidátského balíčku. Hodnocení musí používat přesný snapshot z Admin/Centre balíčku.
        </div>
      )}

      {Boolean(importedPackage) && reviewQuestions.length === 0 && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          Tento importovaný kandidátský balíček neobsahuje snapshot testových otázek z Centre/Admin balíčku.
          Examiner proto může vidět lokální fallback variantu, která nemusí odpovídat jazyku ani obsahu reálné zkoušky.
          Po této opravě je nutné kandidátský balíček vytvořit znovu.
        </div>
      )}

      <div className="space-y-3">
        {!hasStrictQuestions && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
            Tato testová varianta nemá načtené otázky z Admin/Centre balíčku: {effectiveVariantCode}.
            Test se nesmí automaticky přepnout na jiný jazyk nebo lokální fallback.
          </div>
        )}
        {questions.length === 0 ? (
          <div className="rounded-xl border bg-amber-50 p-3 text-sm text-amber-950">
            Pro vybranou variantu testu nejsou dostupné otázky nebo nebyl načten test bank pro tuto variantu.
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
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Body</div>
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
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-500">
                    {index + 1}. {question.id} · {question.section || "-"} · {max} bodů
                  </div>
                </div>

                <div className="font-medium">{question.text}</div>

                {isSectionAChoice && isChoice ? (
                  <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="mb-2 font-semibold">Možnosti odpovědi</div>
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
                                {selected && <StatusPill tone={correct ? "good" : "bad"}>odpověď kandidáta</StatusPill>}
                                {correct && <StatusPill tone="good">správná odpověď</StatusPill>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 rounded-xl bg-white p-3 text-sm">
                      Automaticky předvyplněné body: <strong>{autoChoiceScore}</strong> / {max}
                    </div>
                  </div>
                ) : (
                  <>
                    {isChoice && (
                      <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
                        <div className="mb-2 font-semibold">Možnosti odpovědi</div>
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
                                    {selected && <StatusPill tone={correct ? "good" : "bad"}>odpověď kandidáta</StatusPill>}
                                    {correct && <StatusPill tone="good">správná odpověď</StatusPill>}
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
                        Odpověď kandidáta
                      </div>
                      <div className="whitespace-pre-wrap text-slate-900">
                        {answered ? String(value) : "-"}
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                      <div className="whitespace-pre-wrap">
                        {help || "Hodnoticí pomoc není v aktuálně načteném admin balíčku dostupná."}
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

function ExaminerLocalPackageExchange({ importOfflineCandidatePackageData, setActivePage, setSelectedCandidateId, setImportedCandidatePackages, testBank }) {
  const [packages, setPackages] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadPackages() {
    setLoading(true);
    setStatus("Načítám balíčky z lokálního serveru...");

    try {
      const response = await fetch("/api/local-exchange/packages");
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      setPackages(data.packages ?? []);
      setStatus(`Načteno balíčků: ${(data.packages ?? []).length}`);
    } catch (error) {
      console.error("LAN package list failed", error);
      setStatus(`Načtení balíčků selhalo: ${error.message || "neznámá chyba"}`);
    } finally {
      setLoading(false);
    }
  }

  async function importPackage(packageId) {
    setLoading(true);
    setStatus(`Importuji balíček ${packageId}...`);

    try {
      const response = await fetch(`/api/local-exchange/packages/${encodeURIComponent(packageId)}`);
      const raw = await response.text();

      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server nevrátil JSON. HTTP ${response.status}. Začátek odpovědi: ${raw.slice(0, 160)}`);
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (!data?.candidateId) {
        throw new Error(`Balíček neobsahuje candidateId. Klíče: ${Object.keys(data || {}).join(", ")}`);
      }

      if (data?.kind !== "vetbara.offlineCandidatePackage.v1") {
        throw new Error(`Neplatný typ balíčku: ${data?.kind || "chybí kind"}`);
      }

      const normalizedImportedPackage = normalizeOfflineCandidatePackageForImport(data, testBank);
      const imported = importOfflineCandidatePackageData(normalizedImportedPackage);

      if (imported === false) {
        throw new Error("importOfflineCandidatePackageData vrátil false.");
      }

      setImportedCandidatePackages?.((prev) => ({
        ...prev,
        [data.candidateId]: normalizedImportedPackage,
      }));

      setSelectedCandidateId?.(data.candidateId);
      setStatus(`Balíček importován: ${data.candidateName || data.candidateId} (${data.level || "-"})`);
      setActivePage("writtenReview");
    } catch (error) {
      console.error("LAN package import failed", error);
      setStatus(`Import balíčku selhal: ${error.message || "neznámá chyba"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border bg-slate-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-semibold">LAN balíčky kandidátů</h3>
          <p className="mt-1 text-sm text-slate-600">
            Načtení uzavřeného testu a reportu uloženého kandidátem na lokální Vite server.
          </p>
        </div>
        <Button onClick={loadPackages} disabled={loading} variant="outline" className="rounded-2xl">
          {loading ? "Načítám..." : "Načíst balíčky ze serveru"}
        </Button>
      </div>

      {status && <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700">{status}</div>}

      {packages.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {packages.map((pkg) => (
            <div key={pkg.packageId} className="rounded-xl border bg-white p-3 text-sm">
              <div className="font-semibold">{pkg.candidateName || pkg.candidateId}</div>
              <div className="text-xs text-slate-500">{pkg.candidateId} · {pkg.level} · {pkg.variantCode || "-"}</div>
              <div className="mt-1 text-xs text-slate-500">Uloženo: {pkg.storedAt || pkg.createdAt || "-"}</div>
              <div className="mt-1 text-xs text-slate-500">Fotografie: {pkg.reportPhotoCount ?? 0}</div>
              <Button onClick={() => importPackage(pkg.packageId)} disabled={loading} className="mt-3 rounded-2xl">
                Importovat balíček
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExaminerReportReview({ selectedCandidate, reportDrafts, openWrittenReview, setActivePage, t }) {
  if (!selectedCandidate) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">
          Zpět na seznam kandidátů
        </Button>
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Není vybraný kandidát pro kontrolu reportu.
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

  return (
    <div className="rounded-2xl border bg-white p-4 lg:col-span-3">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">Kontrola Consulting reportu</h3>
          <p className="mt-1 text-sm text-slate-600">
            {selectedCandidate.name} · {selectedCandidate.id} · {selectedCandidate.level}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openWrittenReview?.(selectedCandidate.id)} variant="outline" className="rounded-2xl">
            Přejít na opravu testu
          </Button>
          <Button onClick={() => setActivePage("landing")} variant="outline" className="rounded-2xl">
            Zpět na seznam kandidátů
          </Button>
        </div>
      </div>

      {selectedCandidate.level !== "Consulting" && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Tento kandidát není Consulting. Report review je určený pouze pro Consulting level.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {treeSummaries.map(({ treeName, tree, reportPhotos, completedSections }) => (
          <div key={treeName} className="rounded-2xl border bg-slate-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xl font-bold">{treeName}</h4>
                <p className="text-sm text-slate-600">
                  Vyplněno sekcí: {completedSections} / {REPORT_SECTIONS.length}
                </p>
              </div>
              <StatusPill tone={completedSections === REPORT_SECTIONS.length ? "good" : "warn"}>
                {completedSections === REPORT_SECTIONS.length ? "Kompletní" : "Neúplné"}
              </StatusPill>
            </div>

            <div className="rounded-xl border bg-white p-3">
              <h5 className="font-semibold">Fotografie použité v reportu</h5>
              {reportPhotos.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Žádné fotografie označené pro report.</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {reportPhotos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      className="rounded-xl border bg-white p-2 text-left"
                    >
                      <div className="h-40 overflow-hidden rounded-lg bg-slate-200">
                        {photo.dataUrl ? (
                          <img src={photo.dataUrl} alt={photo.description || photo.name || photo.id} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-500">
                            Bez obrazových dat
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-sm font-medium">{photo.description || photo.name || photo.id}</div>
                      <div className="text-xs text-slate-500">{photo.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border bg-white p-3">
              <h5 className="font-semibold">Terénní poznámky kandidáta</h5>
              <p className="mt-1 text-xs text-slate-500">
                Pracovní podklad kandidáta. Nevstupuje do finálního reportu.
              </p>
              <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-100 p-3 text-sm">
                {String(tree.fieldNotes ?? "").trim() || "-"}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {REPORT_SECTIONS.map((section) => {
                const value = String(tree.finalSections?.[section.key] ?? "").trim();

                return (
                  <div key={section.key} className="rounded-xl border bg-white p-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <h5 className="font-semibold">{section.title}</h5>
                      <StatusPill tone={value ? "good" : "warn"}>{value ? "Vyplněno" : "Chybí"}</StatusPill>
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-slate-700">
                      {value || "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
  const max = sections.reduce((sum, section) => sum + outdoorMaxForSection(candidate.level, section, outdoorItemsByLevel), 0) || scoreLimits(candidate.level).outdoorMax;
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

function ResultActionButton({ disabled, tone = "default", onClick, children, title }) {
  const toneClass = tone === "good"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100"
      : "border-slate-200 bg-white text-slate-950 hover:bg-slate-50";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${toneClass} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}

function CentreCandidateResultsOverview({ candidates, assignments, examiners, variants, testBank, testResponses, reportDrafts, outdoor, outdoorItemsByLevel }) {
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
        <h3 className="font-semibold">Přehled výsledků kandidátů</h3>
        <p className="mt-1 text-sm text-slate-600">Souhrn výsledků jednotlivých kandidátů. Editace výsledků probíhá v rozhraní Examinera po kliknutí na příslušný výsledek.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2 pr-3">Číslo kandidáta</th>
              <th className="py-2 pr-3">Jméno</th>
              <th className="py-2 pr-3">Výsledek testu</th>
              <th className="py-2 pr-3">Výsledek Outdoor</th>
              <th className="py-2 pr-3">Výsledek reportů</th>
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
                  <td className="py-3 pr-3"><StatusPill tone={written.closed ? "good" : written.answered ? "warn" : "default"}>{written.score} / {written.max}</StatusPill><div className="mt-1 text-xs text-slate-500">{written.answered} / {written.total} answered{written.updatedAt ? ` · ${new Date(written.updatedAt).toLocaleString("cs-CZ")}` : ""}</div></td>
                  <td className="py-3 pr-3"><StatusPill tone={outdoorSummary.closed || submittedOutdoorRows.length ? "good" : outdoorSummary.answered ? "warn" : "default"}>{outdoorSummary.total} / {outdoorSummary.max}</StatusPill><div className="mt-1 text-xs text-slate-500">Primary: {examinerNameById(examiners, assignment.primary)} · Secondary: {examinerNameById(examiners, assignment.secondary)}</div>{(submittedOutdoorRows.length > 0 || outdoorSummary.closed) && <div className="mt-1 text-xs text-emerald-700">Uzavřeno: {submittedOutdoorRows.length ? submittedOutdoorRows.map((row) => `${row.mode || row.role || "examiner"} ${row.total ?? 0}/${row.max ?? outdoorSummary.max}`).join(" · ") : `${storedOutdoorResult?.role || storedOutdoorResult?.examinerName || "examiner"} ${outdoorSummary.total}/${outdoorSummary.max}`}</div>}</td>
                  <td className="py-3 pr-3">{candidate.level === "Consulting" ? <><StatusPill tone={report.complete ? "good" : report.sections ? "warn" : "default"}>{report.label}</StatusPill></> : <span className="text-slate-400">Not required</span>}</td>
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
  testBank,
  examinerTimes = {},
  t,
}) {
  const [lanPackages, setLanPackages] = useState([]);
  const [lanLoading, setLanLoading] = useState(false);
  const [lanStatus, setLanStatus] = useState("");

  async function loadLanPackages() {
    setLanLoading(true);
    setLanStatus("Načítám LAN balíčky...");
    try {
      const response = await fetch("/api/local-exchange/packages", { cache: "no-store" });
      const raw = await response.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server nevrátil JSON. HTTP ${response.status}. Začátek odpovědi: ${raw.slice(0, 160)}`);
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const loaded = Array.isArray(data.packages) ? data.packages : Array.isArray(data) ? data : [];
      setLanPackages(loaded);
      setLanStatus(`LAN načteno: ${loaded.length} balíčků · ${new Date().toLocaleTimeString("cs-CZ")}`);
    } catch (error) {
      console.error("LAN package list failed", error);
      setLanStatus(`Načtení LAN balíčků selhalo: ${error.message || "neznámá chyba"}`);
    } finally {
      setLanLoading(false);
    }
  }

  async function importLanPackage(packageId) {
    setLanLoading(true);
    setLanStatus(`Importuji balíček ${packageId}...`);
    try {
      const response = await fetch(`/api/local-exchange/packages/${encodeURIComponent(packageId)}`);
      const raw = await response.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server nevrátil JSON. HTTP ${response.status}. Začátek odpovědi: ${raw.slice(0, 160)}`);
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!data?.candidateId) throw new Error(`Balíček neobsahuje candidateId. Klíče: ${Object.keys(data || {}).join(", ")}`);
      if (data?.kind !== "vetbara.offlineCandidatePackage.v1") throw new Error(`Neplatný typ balíčku: ${data?.kind || "chybí kind"}`);

      const normalizedImportedPackage = normalizeOfflineCandidatePackageForImport(data, testBank);
      const imported = importOfflineCandidatePackageData(normalizedImportedPackage);
      if (imported === false) throw new Error("importOfflineCandidatePackageData vrátil false.");

      setImportedCandidatePackages?.((prev) => ({
        ...prev,
        [data.candidateId]: normalizedImportedPackage,
      }));
      setSelectedCandidateId?.(data.candidateId);
      setLanStatus(`Balíček importován: ${data.candidateName || data.candidateId} (${data.level || "-"})`);
      setActivePage?.("writtenReview");
    } catch (error) {
      console.error("LAN package import failed", error);
      setLanStatus(`Import balíčku selhal: ${error.message || "neznámá chyba"}`);
    } finally {
      setLanLoading(false);
    }
  }

  useEffect(() => {
    if (confirmed) loadLanPackages();
  }, [confirmed]);

  function candidateOutdoorClosed(candidateId) {
    return Boolean(examinerTimes?.[candidateId]?.outdoor?.closedAt);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className={`rounded-2xl border bg-white p-4 ${confirmed ? "lg:col-span-1" : ""}`}>
        <div className="mb-3 rounded-xl bg-slate-950 p-4 text-white">
          <div className="text-xs uppercase tracking-wide text-slate-300">Examiner ID</div>
          <div className="text-3xl font-bold tracking-tight">{examiner.id}</div>
        </div>
        <h3 className="font-semibold">{t("examiner.identity.title")}</h3>
        {!confirmed && [[t("examiner.identity.name"), examiner.name]].map(([k, v]) => (
          <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="font-medium">{v}</div>
          </div>
        ))}
        {confirmed && (
          <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
            <div className="font-medium">{examiner.name}</div>
          </div>
        )}
        <Button onClick={confirmExaminer} disabled={confirmed} className="mt-4 w-full rounded-2xl">
          <BadgeCheck className="mr-2 h-4 w-4" />
          {confirmed ? t("examiner.identity.confirmed") : t("examiner.identity.confirm")}
        </Button>
        <label className={`mt-3 block rounded-2xl border bg-white px-4 py-2 text-center text-sm font-medium ${confirmed ? "hover:bg-slate-50" : "pointer-events-none opacity-50"}`}>
          JSON
          <input type="file" accept=".json,application/json" onChange={importOfflineCandidatePackageFile} className="hidden" disabled={!confirmed} />
        </label>
      </div>

      <div className="rounded-2xl border bg-white p-4 lg:col-span-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold">{t("examiner.worklist.title")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t("examiner.worklist.helper")}</p>
          </div>
          {confirmed && (
            <Button onClick={loadLanPackages} disabled={lanLoading} variant="outline" className="rounded-2xl">
              {lanLoading ? "Načítám..." : "Načíst LAN"}
            </Button>
          )}
        </div>
        {lanStatus && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{lanStatus}</div>}
        {assignedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">{t("examiner.worklist.emptyTitle")}</div>
            <p className="mt-1">{t("examiner.worklist.emptyHelper")}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {assignedCandidates.map((c) => {
              const isPrimary = assignments[c.id]?.primary === examiner.id;
              const candidatePackages = lanPackages
                .filter((pkg) => pkg.candidateId === c.id)
                .sort((a, b) => String(b.storedAt || b.createdAt || "").localeCompare(String(a.storedAt || a.createdAt || "")));
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
                      title={candidateOutdoorClosed(c.id) ? "Outdoor is closed. Reopening requires Vetarbo password." : ""}
                    >
                      OUTDOOR
                    </Button>
                    {c.level === "Consulting" && <Button onClick={() => openReportReview(c.id)} disabled={!confirmed} variant="outline" className="rounded-2xl">REPORT</Button>}
                  </div>
                  {candidatePackages.length > 0 && (
                    <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">LAN balíčky</div>
                      <div className="mt-2 space-y-2">
                        {candidatePackages.map((pkg) => (
                          <div key={pkg.packageId} className="rounded-xl border bg-white p-3 text-sm">
                            <div className="font-medium">{pkg.variantCode || "candidate package"}</div>
                            <div className="mt-1 text-xs text-slate-500">Uloženo: {pkg.storedAt || pkg.createdAt || "-"}</div>
                            <div className="mt-1 text-xs text-slate-500">Fotografie: {pkg.reportPhotoCount ?? 0}</div>
                            <Button onClick={() => importLanPackage(pkg.packageId)} disabled={lanLoading || !confirmed} className="mt-2 rounded-2xl">
                              Import
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function OutdoorForm({ selectedCandidate, selectedMode, activeOutdoorSection, setActiveOutdoorSection, outdoor, outdoorNotes, outdoorItemsByLevel, setOutdoorItemsByLevel, updateOutdoor, updateOutdoorNote, outdoorTotal, outdoorMax, submitOutdoor, archivePlan, practicingArchive, setActivePage, time, t }) {
  const outdoorSections = effectiveOutdoorSectionsForLevel(outdoorItemsByLevel, selectedCandidate.level);
  const effectiveActiveOutdoorSection = outdoorSections.includes(activeOutdoorSection)
    ? activeOutdoorSection
    : (outdoorSections[0] ?? "generic");
  const activeItems = effectiveOutdoorItemsForLevel(outdoorItemsByLevel, selectedCandidate.level)?.[effectiveActiveOutdoorSection] ?? [];
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

  const total = outdoorSections.reduce((sum, section) => sum + outdoorTotal(selectedCandidate.id, selectedCandidate.level, section), 0);
  const max = outdoorSections.reduce((sum, section) => sum + outdoorMax(selectedCandidate.level, section), 0) || scoreLimits(selectedCandidate.level).outdoorMax;

  return <div className="grid gap-4 lg:grid-cols-3"><div><Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">{t("outdoor.backToLanding")}</Button><h3 className="font-semibold">{t("outdoor.candidateBinding")}</h3><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">{t("outdoor.activeRecord")}: <strong>{selectedCandidate.name}</strong><br />{t("outdoor.level")}: <strong>{selectedCandidate.level}</strong><br />{t("outdoor.total")}: <strong>{total}</strong> / {max}<br />{t("common.opened")}: {time?.openedAt || "-"}<br />{t("common.closed")}: {time?.closedAt || "-"}<br /><span className={isOutdoorFallback ? "text-amber-700" : "text-emerald-700"}>{isOutdoorFallback ? "Outdoor source: demo fallback" : "Outdoor source: active Admin package"}</span></div>{selectedCandidate.level === "Practicing" && <div className="mt-3 rounded-xl border bg-white p-3 text-sm"><div className="font-semibold">{t("outdoor.paperArchive.title")}</div><p className="mt-1 text-slate-600">{t("outdoor.paperArchive.helper")}</p><Button onClick={archivePlan} variant="outline" className="mt-3 w-full rounded-2xl">{t("outdoor.paperArchive.button")}</Button><div className="mt-2 text-xs text-slate-500">{t("outdoor.paperArchive.photos")}: {(practicingArchive[selectedCandidate.id] ?? []).length}</div></div>}<div className="mt-4 space-y-2">{outdoorSections.map((section) => <button key={section} onClick={() => setActiveOutdoorSection(section)} className={`w-full rounded-xl border p-3 text-left text-sm ${effectiveActiveOutdoorSection === section ? "border-slate-950 bg-slate-50" : "bg-white hover:bg-slate-50"}`}><div className="font-medium">{outdoorSectionTitle(section)}</div><div className="text-xs text-slate-500">{outdoorTotal(selectedCandidate.id, selectedCandidate.level, section)} / {outdoorMax(selectedCandidate.level, section)} {t("outdoor.points")}</div></button>)}</div></div><div className="lg:col-span-2"><h3 className="font-semibold">{t("outdoor.detail.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("outdoor.detail.helper")}</p><div className="mt-4 space-y-3">{activeItems.map((item) => <div key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="font-mono text-xs text-slate-500">{item.id}</div><div className="font-medium">{item.text}</div>{item.notes && <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{item.notes}</div>}</div><label className="text-sm font-medium md:w-36">{t("outdoor.pointsLabel")} / {item.max}<select value={outdoor[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoor(item.id, e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2"><option value="">-</option>{outdoorHalfPointOptions(item.max).map((option) => <option key={option} value={option}>{formatHalfPointScore(option)}</option>)}</select></label></div><textarea value={outdoorNotes[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoorNote(item.id, e.target.value)} placeholder={t("outdoor.examinerNotes")} className="mt-3 min-h-16 w-full rounded-xl border bg-white p-3 text-sm" /></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button onClick={submitOutdoor} disabled={selectedMode === "unassigned"} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" /> {t("outdoor.submit")}</Button><StatusPill tone={selectedMode === "primary" ? "good" : "default"}>{selectedMode === "primary" ? t("outdoor.mode.primary") : selectedMode === "secondary" ? t("outdoor.mode.secondary") : t("outdoor.mode.unassigned")}</StatusPill><StatusPill tone="warn">{t("outdoor.autosave")}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{t("common.offlineRetry")}</p></div></div>;
}

function ScoringCard({ selectedCandidate, assignment, scoring, updateScore, generateEvaluation, lastEvaluation, loadEvaluationPreview, evaluationPreview, evaluationLoading, evaluationError, downloadDraftExport, exportLoading, exportError, variants, testBank, testResponses, reportDrafts, t }) {
  const writtenReview = computeWrittenTestReview(selectedCandidate, variants, testBank, testResponses);
  const reportReview = computeReportReview(reportDrafts?.[selectedCandidate.id] ?? createReportDraft());

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={BadgeCheck} title={t("scoring.title")} subtitle={t("scoring.subtitle")} /><div className="grid gap-4"><div className="rounded-2xl border bg-white p-4"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">{t("scoring.written")} / {scoring.writtenMax}<input type="number" value={selectedCandidate.written ?? ""} onChange={(e) => updateScore("written", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label><label className="text-sm font-medium">{t("scoring.outdoor")} / {scoring.outdoorMax}<input type="number" value={selectedCandidate.outdoor ?? ""} onChange={(e) => updateScore("outdoor", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>{selectedCandidate.level === "Consulting" && <label className="text-sm font-medium">{t("scoring.report")} / {scoring.reportMax}<input type="number" value={selectedCandidate.report ?? ""} onChange={(e) => updateScore("report", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>}</div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("examiner.writtenReview.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("examiner.writtenReview.variant")}: {writtenReview.variantCode || "-"}</p></div><div className="flex flex-wrap gap-2"><StatusPill>{writtenReview.correctCount} {t("examiner.writtenReview.correct")}</StatusPill><StatusPill>{writtenReview.unansweredCount} {t("examiner.writtenReview.unanswered")}</StatusPill><StatusPill>{writtenReview.computedScore} / {writtenReview.computedMax} {t("common.points")}</StatusPill></div></div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><strong>{t("examiner.writtenReview.computedScore")}:</strong> {writtenReview.computedScore} / {writtenReview.computedMax}<p className="mt-1 text-xs text-slate-500">{t("examiner.writtenReview.helper")}</p><Button onClick={() => updateScore("written", writtenReview.computedScore)} disabled={writtenReview.computedMax === 0} variant="outline" className="mt-3 rounded-2xl">{t("examiner.writtenReview.apply")}</Button></div><div className="mt-3 space-y-3">{writtenReview.items.map((item, index) => <div key={item.question.id} className="rounded-xl border bg-white p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-slate-500">{t("test.question")} {index + 1} / {item.question.points} {t("common.points")}</div><div className="mt-1 font-medium">{item.question.text}</div></div><StatusPill tone={!item.hasAnswer ? "warn" : item.hasCorrectAnswer ? item.correct ? "good" : "bad" : "default"}>{!item.hasAnswer ? t("examiner.writtenReview.unanswered") : item.hasCorrectAnswer ? item.correct ? t("examiner.writtenReview.correct") : t("examiner.writtenReview.incorrect") : t("examiner.writtenReview.manual")}</StatusPill></div><div className="mt-2 rounded-lg bg-slate-50 p-2"><div className="text-xs font-semibold text-slate-500">{t("examiner.writtenReview.candidateAnswer")}</div><div className="mt-1 whitespace-pre-wrap">{item.hasAnswer ? item.answer : "-"}</div></div>{item.hasCorrectAnswer && <div className="mt-2 rounded-lg bg-emerald-50 p-2"><div className="text-xs font-semibold text-emerald-800">{t("examiner.writtenReview.correctAnswer")}</div><div className="mt-1 whitespace-pre-wrap text-emerald-950">{item.question.correctAnswer}</div></div>}</div>)}</div></div>{selectedCandidate.level === "Consulting" && <div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("examiner.reportReview.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("examiner.reportReview.helper")}</p></div><div className="flex flex-wrap gap-2"><StatusPill>{reportReview.filledSections} / {reportReview.totalSections} {t("examiner.reportReview.sections")}</StatusPill><StatusPill>{reportReview.photos} {t("examiner.reportReview.photos")}</StatusPill><StatusPill>{reportReview.completeness}% {t("examiner.reportReview.complete")}</StatusPill></div></div><div className="mt-3 space-y-4">{reportReview.trees.map((tree) => <div key={tree.treeName} className="rounded-xl border bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{tree.treeName}</h4><div className="flex flex-wrap gap-2"><StatusPill>{tree.filledSections} / {tree.totalSections} {t("examiner.reportReview.sections")}</StatusPill><StatusPill>{tree.photos.length} {t("examiner.reportReview.photos")}</StatusPill></div></div><div className="mt-3 rounded-lg bg-slate-50 p-2"><div className="text-xs font-semibold text-slate-500">{t("report.fieldNotes")}</div><div className="mt-1 whitespace-pre-wrap">{String(tree.fieldNotes).trim() || "-"}</div></div>{tree.photos.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">{tree.photos.map((photo) => <div key={photo.id} className="flex items-center gap-3 rounded-xl border bg-white p-2"><div className="h-16 w-16 overflow-hidden rounded-lg bg-slate-200">{photo.dataUrl ? <img src={photo.dataUrl} alt={photo.name || photo.caption || photo.id} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{photo.id}</div>}</div><div className="min-w-0 text-xs"><div className="truncate font-medium text-slate-900">{photo.name || photo.caption || photo.id}</div><div className="text-slate-500">{photo.type || "image"} · {photo.size ? `${Math.round(photo.size / 1024)} KB` : ""}</div></div></div>)}</div>}<div className="mt-3 grid gap-3 md:grid-cols-2">{tree.finalSections.map((section) => <div key={section.key} className="rounded-lg bg-slate-50 p-2"><div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-500">{section.title}</div><StatusPill tone={section.filled ? "good" : "warn"}>{section.filled ? t("examiner.reportReview.filled") : t("examiner.reportReview.missing")}</StatusPill></div><div className="mt-1 whitespace-pre-wrap">{String(section.value).trim() || "-"}</div></div>)}</div></div>)}</div></div>}<div className="mt-4 grid gap-3 md:grid-cols-5"><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.total")}</div><div className="text-xl font-bold">{scoring.total} / {scoring.max}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.percentage")}</div><div className="text-xl font-bold">{scoring.percentage}%</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.result")}</div><div className="text-xl font-bold">{scoring.pass ? t("scoring.pass") : t("scoring.notPassed")}</div></div><Button onClick={generateEvaluation} className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {t("scoring.generate")}</Button><Button onClick={() => loadEvaluationPreview(selectedCandidate.id)} disabled={evaluationLoading} variant="outline" className="h-full rounded-2xl">{evaluationLoading ? t("scoring.loading") : t("scoring.loadPreview")}</Button><Button onClick={() => downloadDraftExport(selectedCandidate.id)} disabled={exportLoading} variant="outline" className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {exportLoading ? t("scoring.exporting") : t("scoring.downloadDraftExport")}</Button></div><p className="mt-3 text-xs text-slate-500">{t("scoring.draftOnly")}</p>{evaluationError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{evaluationError}</div>}{exportError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{exportError}</div>}{lastEvaluation && <div className="mt-4 rounded-2xl border bg-white p-4 text-sm"><div className="font-semibold">{t("scoring.lastGenerated")}</div><div className="mt-1 text-slate-600">{lastEvaluation.candidate} / {lastEvaluation.level}: {lastEvaluation.total}/{lastEvaluation.max} ({lastEvaluation.percentage}%) - {lastEvaluation.result}</div></div>}<EvaluationPreviewCard preview={evaluationPreview} t={t} assignment={assignment} /></div></div></CardContent></Card>;
}

export default function VetBaraApp() {
  return (
    <VetBaraErrorBoundary>
      <VetBaraPrototype />
    </VetBaraErrorBoundary>
  );
}
