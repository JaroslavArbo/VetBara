import React, { useEffect, useMemo, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { bootstrapSession, resolveQrToken, syncBatch, fetchCandidateEvaluation, exportCandidateEvaluation, exportCentreAuditPackage, downloadBase64File, loadCentreSetup } from "./lib/api";
import { CandidateQuickHelp, ExaminerQuickHelp, PilotReleaseNotesPanel, PilotSmokeTestChecklist } from "./components/PilotInfoPanels";
import { EvaluationPreviewCard } from "./components/EvaluationPreviewCard";
import { AuditSyncView } from "./components/AuditSyncView";
import { CentreNetworkReadinessChecklist, CentreValidationSummary, PilotReadinessGuardrails, PilotRunSummary } from "./components/CentreReadinessPanels";
import { CentreQrAccessPack } from "./components/CentreQrAccessPack";
import { LANGUAGES as UI_LANGUAGES, makeTranslator } from "./i18n";

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
  { code: "PRACTICING_2026_V2_EN", level: "Practicing", language: "EN", status: "Approved" },
  { code: "CONSULTING_2026_V1_EN", level: "Consulting", language: "EN", status: "Approved" },
  { code: "CONSULTING_2026_V2_EN", level: "Consulting", language: "EN", status: "Approved" },
];
const DEFAULT_TEST_BANK = {
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
const CANDIDATE_SECTIONS = { Practicing: [{ key: "test", title: "Written test", description: "Complete and submit the Practicing written test." }], Consulting: [{ key: "test", title: "Written test", description: "Complete and submit the Consulting written test." }, { key: "report", title: "Report for 2 trees", description: "Collect field data and finalize the report for Tree A and Tree B." }] };
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
function scoreCandidate(c) { const l = scoreLimits(c.level); const w = Number(c.written ?? 0); const o = Number(c.outdoor ?? 0); const r = c.level === "Consulting" ? Number(c.report ?? 0) : 0; const total = w + o + r; const max = l.writtenMax + l.outdoorMax + l.reportMax; const pass = w / l.writtenMax >= 0.5 && o / l.outdoorMax >= 0.5 && (c.level !== "Consulting" || r / l.reportMax >= 0.5) && total / max >= 0.75; return { ...l, total, max, percentage: Math.round((total / max) * 1000) / 10, pass }; }
function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function storedAnswerValue(row) { const answer = row?.answer; return isObject(answer) ? answer.selectedAnswer ?? answer.answer ?? answer.value ?? "" : answer ?? ""; }
function isBackendPersistenceUnavailable(error) {
  const message = String(error?.message ?? error ?? "");
  return error?.status === 503 || /503/.test(message) || /Backend persistence is not configured/i.test(message);
}

function RealQr({ value, size = 112 }) {
  const encoded = encodeURIComponent(value);
  return (
    <div
      className="shrink-0 rounded-xl bg-white p-2 shadow-inner"
      style={{ width: size, height: size }}
    >
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`}
        alt="VetBara QR"
        width={size}
        height={size}
        className="block h-full w-full object-contain"
      />
    </div>
  );
}
function parseQrPayload(payload) { try { const url = new URL(payload); return { role: url.searchParams.get("role"), id: url.searchParams.get("id"), token: url.searchParams.get("token") }; } catch { const [role, id, token] = String(payload).split("|"); return { role, id, token }; } }
function QrScannerPanel({ title, onScan, onClose, t }) { const id = useMemo(() => `qr-reader-${Math.random().toString(36).slice(2)}`, []); useEffect(() => { const scanner = new Html5QrcodeScanner(id, { fps: 10, qrbox: { width: 250, height: 250 } }, false); scanner.render((text) => { onScan(text); scanner.clear().catch(() => {}); }, () => {}); return () => { scanner.clear().catch(() => {}); }; }, [id, onScan]); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{title}</h3><p className="text-sm text-slate-600">{t("qrScanner.helper")}</p></div><Button onClick={onClose} variant="outline" className="rounded-2xl">{t("common.close")}</Button></div><div id={id} className="overflow-hidden rounded-2xl border" /></div></div>; }

export default function VetBaraPrototype() {
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
  const [role, setRole] = useState(portalRole ?? "Admin");
  const [centre, setCentre] = useState(CENTRES[0]);
  const [examDate, setExamDate] = useState("2026-03-31");
  const [place, setPlace] = useState("Buchlovice");
  const [language, setLanguage] = useState("EN");
  const [enabledLevels, setEnabledLevels] = useState(["Practicing", "Consulting"]);
  const [availableVariants, setAvailableVariants] = useState(TEST_VARIANTS);
  const [testBank, setTestBank] = useState(DEFAULT_TEST_BANK);
  const [testImportStatus, setTestImportStatus] = useState("");
  const [testImportError, setTestImportError] = useState("");
  const [testImportSummary, setTestImportSummary] = useState(null);
  const [variants, setVariants] = useState({ Practicing: "PRACTICING_2026_V1_EN", Consulting: "CONSULTING_2026_V1_EN" });
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
  const [reportDrafts, setReportDrafts] = useState({ "C-001": createReportDraft(), "C-004": createReportDraft() });
  const [activeReportTree, setActiveReportTree] = useState("Tree A");
  const [loggedExaminerId, setLoggedExaminerId] = useState(null);
  const [examinerConfirmed, setExaminerConfirmed] = useState({});
  const [activeExaminerPage, setActiveExaminerPage] = useState("landing");
  const [assignments, setAssignments] = useState(START_ASSIGNMENTS);
  const [outdoor, setOutdoor] = useState({});
  const [outdoorNotes, setOutdoorNotes] = useState({});
  const [activeOutdoorSection, setActiveOutdoorSection] = useState("generic");
  const [examinerTimes, setExaminerTimes] = useState({});
  const [practicingArchive, setPracticingArchive] = useState({});
  const [audit, setAudit] = useState([{ id: "A-001", action: "Exam event opened", target: "Exam event", time: "09:00", detail: "Initial offline package prepared" }]);
  const [sync, setSync] = useState([{ id: "S-001", type: "Exam package", status: "Ready offline" }]);
  const [scannerMode, setScannerMode] = useState(null);
  const [lastEvaluation, setLastEvaluation] = useState(null);
  const [authenticatedPortalRole, setAuthenticatedPortalRole] = useState(null);
  const [activeSessionToken, setActiveSessionToken] = useState(null);
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
  const scoring = useMemo(() => scoreCandidate(selectedCandidate), [selectedCandidate]);
  const summary = useMemo(() => ({ total: candidates.length, practicing: candidates.filter((c) => c.level === "Practicing").length, consulting: candidates.filter((c) => c.level === "Consulting").length }), [candidates]);
  const addAudit = (action, target, detail = "") => setAudit((prev) => [{ id: `A-${prev.length + 1}`, action, target, detail, time: nowStamp() }, ...prev]);
  const queue = (type, detail = "") => setSync((prev) => [{ id: `S-${prev.length + 1}`, type, detail, status: "Pending sync" }, ...prev]);
  const payload = (roleName, id, token = `VETBARA-${roleName.toUpperCase()}-${id}-2026`) => `${window.location.origin}${window.location.pathname}?role=${encodeURIComponent(roleName)}&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const sectionTone = (v) => v === "closed" ? "good" : v === "open" ? "warn" : "default";
  const lockedPortalRole = portalRole ?? authenticatedPortalRole;
  const localEventId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const knownCandidate = (id) => candidates.some((candidate) => candidate.id === id);
  const knownExaminer = (id) => EXAMINERS.some((examiner) => examiner.id === id);

  useEffect(() => {
    let cancelled = false;

    async function openQrSession() {
      const parsed = parseQrPayload(window.location.href);
      if (!parsed.role && !parsed.token) return;
      const access = await resolveAccessWithFallback(parsed, "Direct QR session accepted");
      if (!cancelled && access) applyResolvedAccess(access, "Direct QR session accepted");
    }

    openQrSession();
    return () => { cancelled = true; };
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
      console.error("Session bootstrap failed; using local demo fallback when available", error);
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
    if (parsed.role === "Centre" && parsed.token === DEMO_QR_TOKENS.Centre) return { role: "Centre", subjectId: centre, mode: "demo" };
    if (parsed.role === "Candidate" && parsed.token === DEMO_QR_TOKENS.Candidate && parsed.id === "C-001" && knownCandidate(parsed.id)) return { role: "Candidate", subjectId: parsed.id, mode: "demo" };
    if (parsed.role === "Examiner" && parsed.token === DEMO_QR_TOKENS.Examiner && parsed.id === "E-001" && knownExaminer(parsed.id)) return { role: "Examiner", subjectId: parsed.id, mode: "demo" };
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

    if (access.role === "Candidate" && knownCandidate(access.subjectId)) {
      setRole("Candidate");
      loginCandidate(access.subjectId);
      hydrateCandidateProgress(access.sessionToken, access.subjectId);
      return;
    }

    if (access.role === "Examiner" && knownExaminer(access.subjectId)) {
      setRole("Examiner");
      loginExaminer(access.subjectId);
      hydrateExaminerOutdoorProgress(access.sessionToken, access.subjectId);
      return;
    }

    addAudit("QR role blocked", access.role ?? "Unknown role", "Resolved role or subject does not match this portal package");
  }

  async function handleQrScan(text) { const p = { ...parseQrPayload(text), raw: text }; const access = await resolveAccessWithFallback(p, "QR accepted"); if (access) applyResolvedAccess(access, "QR accepted"); setScannerMode(null); }
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
      const testPackage = testImportSummary ? {
        availableVariants,
        variants,
        testBank,
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

  function unlockCentre() {
    const raw = centreCode.trim();
    let token = raw;
    try {
      const parsed = new URL(raw);
      token = parsed.searchParams.get("token") || raw;
    } catch {
      token = raw;
    }
    if (token !== CENTRE_ACCESS_TOKEN) return addAudit("Centre access failed", centre, raw || "empty code");
    setCentreUnlocked(true);
    setRole("Centre");
    addAudit("Centre workspace opened", centre, "Delegated token accepted");
  }
  function toggleLevel(level) { setCentreSetupDirty(true); setEnabledLevels((prev) => prev.includes(level) && prev.length > 1 ? prev.filter((x) => x !== level) : prev.includes(level) ? prev : [...prev, level]); }
  function addCandidate() { setCentreSetupDirty(true); const id = `C-${String(candidates.length + 1).padStart(3, "0")}`; const level = enabledLevels[0] ?? "Practicing"; const c = { id, name: `New candidate ${candidates.length + 1}`, birthDate: "", documentId: "", email: "", level, status: "Ready", written: null, outdoor: null, report: null }; setCandidates((prev) => [...prev, c]); setCandidateStatus((prev) => ({ ...prev, [id]: createSectionStatus(level) })); setAssignments((prev) => ({ ...prev, [id]: { primary: examiners[0]?.id ?? "", secondary: examiners[1]?.id ?? "" } })); setSelectedCandidateId(id); }
  function loginCandidate(id) { setLoggedCandidateId(id); setSelectedCandidateId(id); setActiveCandidateSection("landing"); addAudit("Candidate logged in", candidates.find((c) => c.id === id)?.name ?? id, "QR accepted"); }
  function confirmCandidate() { if (!loggedCandidate) return; setCandidateConfirmed((prev) => ({ ...prev, [loggedCandidate.id]: true })); addAudit("Candidate identity confirmed", loggedCandidate.name, `${loggedCandidate.birthDate} / ${loggedCandidate.documentId}`); }
  function openCandidateSection(key) {
    if (!loggedCandidate || !candidateConfirmed[loggedCandidate.id]) return;
    const current = candidateStatus[loggedCandidate.id]?.[key];
    if (current === "closed" && !window.confirm("This section is already closed. Reopening requires examiner approval. Has an examiner approved this reopening?")) return;
    const openedAt = nowStamp();
    const openedAtIso = new Date().toISOString();
    setCandidateStatus((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level)), [key]: "open" } }));
    setCandidateTimes((prev) => ({ ...prev, [loggedCandidate.id]: { ...(prev[loggedCandidate.id] ?? {}), [key]: { ...(prev[loggedCandidate.id]?.[key] ?? {}), openedAt, openedAtIso, closedAt: null, closedAtIso: null } } }));
    setActiveCandidateSection(key);
    addAudit("Candidate section opened", loggedCandidate.name, `${key} / ${openedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`candidate-section-opened-${loggedCandidate.id}-${key}`), type: current === "closed" ? "candidate_section.reopened" : "candidate_section.opened", entityType: "candidate_section", entityId: `${loggedCandidate.id}:${key}`, candidateId: loggedCandidate.id, payload: { sectionKey: key, openedAt: openedAtIso, openedAtLabel: openedAt }, createdAt: openedAtIso });
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
        caption: photo.caption,
        capturedAt,
      },
      createdAt: capturedAt,
    });
  }
  function submitReport() { if (!loggedCandidate) return; setCandidates((prev) => prev.map((c) => c.id === loggedCandidate.id ? { ...c, status: "Report submitted" } : c)); closeCandidateSection("report"); }
  function loginExaminer(id) { setLoggedExaminerId(id); setActiveExaminerPage("landing"); const first = candidates.find((c) => [assignments[c.id]?.primary, assignments[c.id]?.secondary].includes(id)); if (first) setSelectedCandidateId(first.id); addAudit("Examiner logged in", EXAMINERS.find((e) => e.id === id)?.name ?? id, "QR accepted"); }
  function confirmExaminer() { if (!loggedExaminer) return; setExaminerConfirmed((prev) => ({ ...prev, [loggedExaminer.id]: true })); addAudit("Examiner identity confirmed", loggedExaminer.name, loggedExaminer.registrationId); }
  function setPrimary(candidateId, examinerId, primary) { setAssignments((prev) => { const current = prev[candidateId] ?? {}; return { ...prev, [candidateId]: primary ? { primary: examinerId, secondary: current.primary && current.primary !== examinerId ? current.primary : current.secondary } : { ...current, secondary: examinerId, primary: current.primary === examinerId ? current.secondary : current.primary } }; }); }
  function openOutdoor(candidateId) {
    const c = candidates.find((x) => x.id === candidateId);
    if (!c || !loggedExaminer) return;
    const assignment = assignments[candidateId] ?? {};
    const mode = assignment.primary === loggedExaminer.id ? "primary" : assignment.secondary === loggedExaminer.id ? "secondary" : "unassigned";
    if (mode === "unassigned") return;
    const prior = examinerTimes[loggedExaminer.id]?.[candidateId]?.outdoor;
    if (prior?.closedAt && !window.confirm("This outdoor form is already closed. Reopening requires examiner approval. Continue?")) return;
    const openedAt = nowStamp();
    const openedAtIso = new Date().toISOString();
    setSelectedCandidateId(candidateId);
    setActiveOutdoorSection(OUTDOOR_SECTIONS[c.level][0]);
    setActiveExaminerPage("outdoor");
    setExaminerTimes((prev) => ({ ...prev, [loggedExaminer.id]: { ...(prev[loggedExaminer.id] ?? {}), [candidateId]: { ...(prev[loggedExaminer.id]?.[candidateId] ?? {}), outdoor: { openedAt, openedAtIso, closedAt: null, closedAtIso: null } } } }));
    addAudit("Outdoor form opened", c.name, `${loggedExaminer.name} / ${openedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`outdoor-assessment-opened-${candidateId}-${loggedExaminer.id}`), type: "outdoor_assessment.opened", entityType: "outdoor_assessment", entityId: `${candidateId}:outdoor`, candidateId, payload: { candidateId, examinerId: loggedExaminer.id, mode, role: mode, sectionKey: "outdoor", openedAt: openedAtIso, openedAtLabel: openedAt }, createdAt: openedAtIso });
    hydrateOutdoorProgress(activeSessionToken, loggedExaminer.id, candidateId);
  }
  function updateOutdoor(itemId, value) {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const item = Object.values(OUTDOOR_ITEMS[selectedCandidate.level]).flat().find((x) => x.id === itemId);
    const points = value === "" ? null : Math.min(Math.max(Number(value), 0), item?.max ?? 0);
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

  function outdoorTotal(candidateId, level, section) { const values = outdoor[candidateId] ?? {}; return (OUTDOOR_ITEMS[level]?.[section] ?? []).reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0); }
  function outdoorMax(level, section) { return (OUTDOOR_ITEMS[level]?.[section] ?? []).reduce((sum, item) => sum + item.max, 0); }
  function submitOutdoor() {
    if (!loggedExaminer || selectedMode === "unassigned") return;
    const values = outdoor[selectedCandidate.id] ?? {};
    const total = Object.values(OUTDOOR_ITEMS[selectedCandidate.level]).flat().reduce((sum, item) => sum + Number(values[item.id] ?? 0), 0);
    const closedAt = nowStamp();
    const submittedAt = new Date().toISOString();
    setCandidates((prev) => prev.map((c) => c.id === selectedCandidate.id ? { ...c, outdoor: Math.min(total, scoreLimits(c.level).outdoorMax), status: "Outdoor submitted" } : c));
    setExaminerTimes((prev) => ({ ...prev, [loggedExaminer.id]: { ...(prev[loggedExaminer.id] ?? {}), [selectedCandidate.id]: { ...(prev[loggedExaminer.id]?.[selectedCandidate.id] ?? {}), outdoor: { ...(prev[loggedExaminer.id]?.[selectedCandidate.id]?.outdoor ?? {}), closedAt, closedAtIso: submittedAt } } } }));
    addAudit("Outdoor assessment submitted", selectedCandidate.name, `${total} points / ${closedAt}`);
    sendSyncEvent({ clientEventId: localEventId(`outdoor-assessment-submitted-${selectedCandidate.id}-${loggedExaminer.id}`), type: "outdoor_assessment.submitted", entityType: "outdoor_assessment", entityId: `${selectedCandidate.id}:outdoor`, candidateId: selectedCandidate.id, payload: { candidateId: selectedCandidate.id, examinerId: loggedExaminer.id, mode: selectedMode, role: selectedMode, sectionKey: "outdoor", submittedAt, closedAtLabel: closedAt, total }, createdAt: submittedAt });
  }
  function archivePlan() { if (!loggedExaminer || selectedCandidate.level !== "Practicing") return; setPracticingArchive((prev) => ({ ...prev, [selectedCandidate.id]: [...(prev[selectedCandidate.id] ?? []), { id: `MP-${(prev[selectedCandidate.id] ?? []).length + 1}`, capturedBy: loggedExaminer.name }] })); }
  function updateScore(field, value) { setCandidates((prev) => prev.map((c) => c.id === selectedCandidate.id ? { ...c, [field]: value === "" ? null : Math.min(Math.max(Number(value), 0), scoreLimits(c.level)[`${field}Max`]), status: "In evaluation" } : c)); }
  function generateEvaluation() { const s = scoreCandidate(selectedCandidate); setLastEvaluation({ candidate: selectedCandidate.name, level: selectedCandidate.level, total: s.total, max: s.max, percentage: s.percentage, result: s.pass ? "PASS" : "NOT PASSED" }); }

  const centreDataMode = centreSetupStatus || centreQrAccess?.candidates?.length || centreQrAccess?.examiners?.length ? "backend" : "demo";

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-7xl">
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div className="flex items-start gap-4"><img src="/brand/vetcert-logo.jpg" alt="VETcert Certified Veteran Tree Specialist" className="h-14 w-14 shrink-0 rounded-full border bg-white object-contain p-1 shadow-sm md:h-16 md:w-16" /><div><div className="mb-2 flex flex-wrap items-center gap-2"><div className="rounded-2xl bg-slate-950 px-3 py-1 text-sm font-semibold text-white">{t("app.title")}</div><StatusPill tone="warn">{t("app.mvpPrototype")}</StatusPill><StatusPill><CloudOff className="mr-1 h-3.5 w-3.5" /> {t("app.offlineFirst")}</StatusPill></div><h1 className="text-3xl font-bold tracking-tight md:text-5xl">{t("app.heroTitle")}</h1><p className="mt-2 max-w-3xl text-slate-600">{t("app.subtitle")}</p></div></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-medium text-slate-500">{t("language.label")}<select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value)} className="ml-2 rounded-xl border bg-white p-2 text-sm text-slate-950">{UI_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.draft ? `${lang.label} - draft` : lang.label}</option>)}</select></label>{lockedPortalRole ? <StatusPill tone="good">{tf("app.dedicatedPortal", { role: roleLabel(lockedPortalRole) })}</StatusPill> : ROLES.map((r) => <Button key={r} onClick={() => setRole(r)} variant={role === r ? "default" : "outline"} className="rounded-2xl">{roleLabel(r)}</Button>)}</div></header>
    {draftPreviewActive && <div role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950 shadow-sm">{t("language.draftPreviewWarning")}</div>}
    <Card className="mb-4 rounded-2xl shadow-sm"><CardContent className="p-5"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-medium text-slate-500">{t("workspace.current")}</div><div className="text-2xl font-bold tracking-tight">{role}</div></div><div className="flex flex-wrap gap-2"><StatusPill>{status}</StatusPill><StatusPill>{summary.total} {t("workspace.candidates")}</StatusPill><StatusPill>{summary.practicing} Practicing</StatusPill><StatusPill>{summary.consulting} Consulting</StatusPill></div></div></CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-3">
      {role === "Admin" && <AdminView centre={centre} setCentre={setCentre} examDate={examDate} setExamDate={setExamDate} place={place} setPlace={setPlace} language={language} setLanguage={setLanguage} availableVariants={availableVariants} variants={variants} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} importTestPackage={importTestPackage} setStatus={setStatus} addAudit={addAudit} setScannerMode={setScannerMode} centreQr={payload("Centre", centre, CENTRE_ACCESS_TOKEN)} t={t} />}
      {role === "Centre" && <CentreView centreUnlocked={centreUnlocked} centreCode={centreCode} setCentreCode={setCentreCode} unlockCentre={unlockCentre} enabledLevels={enabledLevels} toggleLevel={toggleLevel} language={language} availableVariants={availableVariants} variants={variants} setVariants={setVariants} importTestPackage={importTestPackage} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} candidates={candidates} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} addCandidate={addCandidate} updateCandidate={updateCandidate} assignments={assignments} setAssignments={setAssignments} examiners={examiners} candidateQrFor={(id) => payload("Candidate", id)} examinerQrFor={(id) => payload("Examiner", id)} centreSetupLoading={centreSetupLoading} centreSetupSaving={centreSetupSaving} centreSetupError={centreSetupError} centreSetupStatus={centreSetupStatus} centreAuditExportLoading={centreAuditExportLoading} centreAuditExportError={centreAuditExportError} centreQrAccess={centreQrAccess} centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} setCentreSetupDirty={setCentreSetupDirty} dataMode={centreDataMode} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} handleLoadCentreSetup={handleLoadCentreSetup} handleSaveCentreSetup={handleSaveCentreSetup} handleDownloadCentreAuditPackage={handleDownloadCentreAuditPackage} updateExaminer={updateExaminer} addExaminer={addExaminer} t={t} />}
      {role === "Candidate" && <CandidateView candidates={candidates} loggedCandidate={loggedCandidate} confirmed={loggedCandidate ? candidateConfirmed[loggedCandidate.id] : false} loginCandidate={loginCandidate} logoutCandidate={() => setLoggedCandidateId(null)} confirmCandidate={confirmCandidate} sections={loggedCandidate ? CANDIDATE_SECTIONS[loggedCandidate.level] : []} sectionStatus={loggedCandidate ? candidateStatus[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level) : {}} sectionTimes={loggedCandidate ? candidateTimes[loggedCandidate.id] ?? {} : {}} sectionTone={sectionTone} openSection={openCandidateSection} activeSection={activeCandidateSection} setActiveSection={setActiveCandidateSection} testResponses={testResponses} updateTest={updateTest} submitTest={submitTest} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} submitReport={submitReport} variants={variants} testBank={testBank} qrFor={(id) => payload("Candidate", id)} setScannerMode={setScannerMode} t={t} />}
      {role === "Examiner" && <ExaminerView examiners={EXAMINERS} loggedExaminer={loggedExaminer} confirmed={loggedExaminer ? examinerConfirmed[loggedExaminer.id] : false} loginExaminer={loginExaminer} logoutExaminer={() => setLoggedExaminerId(null)} confirmExaminer={confirmExaminer} assignedCandidates={assignedCandidates} assignments={assignments} setPrimary={setPrimary} activePage={activeExaminerPage} setActivePage={setActiveExaminerPage} openOutdoor={openOutdoor} selectedCandidate={selectedCandidate} selectedMode={selectedMode} activeOutdoorSection={activeOutdoorSection} setActiveOutdoorSection={setActiveOutdoorSection} outdoor={outdoor} outdoorNotes={outdoorNotes} updateOutdoor={updateOutdoor} updateOutdoorNote={updateOutdoorNote} outdoorTotal={outdoorTotal} outdoorMax={outdoorMax} submitOutdoor={submitOutdoor} archivePlan={archivePlan} practicingArchive={practicingArchive} scoring={scoring} updateScore={updateScore} generateEvaluation={generateEvaluation} lastEvaluation={lastEvaluation} loadEvaluationPreview={loadEvaluationPreview} evaluationPreview={evaluationPreview} evaluationLoading={evaluationLoading} evaluationError={evaluationError} downloadDraftExport={downloadDraftExport} exportLoading={exportLoading} exportError={exportError} variants={variants} testBank={testBank} testResponses={testResponses} reportDrafts={reportDrafts} qrFor={(id) => payload("Examiner", id)} setScannerMode={setScannerMode} examinerTimes={loggedExaminer ? examinerTimes[loggedExaminer.id] ?? {} : {}} t={t} />}
      {(role === "Admin" || role === "Centre") && <AuditSyncView sync={sync} setSync={setSync} audit={audit} CloudOff={CloudOff} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} Card={Card} CardContent={CardContent} t={t} />}
    </div>
    {scannerMode && <QrScannerPanel title={tf("qrScanner.scan", { role: roleLabel(scannerMode) })} onScan={handleQrScan} onClose={() => setScannerMode(null)} t={t} />}
  </div></main>;
}

function AdminView({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, availableVariants, variants, testImportStatus, testImportError, testImportSummary, importTestPackage, setStatus, addAudit, setScannerMode, centreQr, t }) {
  const variantsByLevel = EXAM_LEVELS.map((level) => ({
    level,
    selectedCode: variants[level] ?? "",
    options: availableVariants.filter((variant) => variant.level === level && variant.language === language),
  }));

  return <><Card className="rounded-2xl shadow-sm lg:col-span-2"><CardContent className="p-5"><SectionTitle icon={ShieldCheck} title={t("admin.openExam.title")} subtitle={t("admin.openExam.subtitle")} /><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">{t("admin.centre")}<select value={centre} onChange={(e) => setCentre(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{CENTRES.map((x) => <option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">{t("admin.examLanguage")}<select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">{t("admin.examDate")}<input value={examDate} onChange={(e) => setExamDate(e.target.value)} type="date" className="mt-1 w-full rounded-xl border bg-white p-2" /></label><label className="text-sm font-medium">{t("admin.place")}<input value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label></div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">{t("admin.testPackage.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("admin.testPackage.helper")}</p></div><label className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">{t("admin.testPackage.upload")}<input type="file" accept=".csv,.json,application/json,text/csv" onChange={(event) => importTestPackage(event, "Admin")} className="hidden" /></label></div><div className="mt-3 flex flex-wrap gap-2"><StatusPill tone={testImportSummary ? "good" : "warn"}>{testImportSummary ? t("admin.testPackage.loaded") : t("admin.testPackage.notLoaded")}</StatusPill>{testImportSummary && <StatusPill>{testImportSummary.variants} {t("admin.testPackage.variants")}</StatusPill>}{testImportSummary && <StatusPill>{testImportSummary.questions} {t("admin.testPackage.questions")}</StatusPill>}</div>{testImportStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{testImportStatus}</div>}{testImportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{testImportError}</div>}<div className="mt-3 grid gap-3 md:grid-cols-2">{variantsByLevel.map((row) => <div key={row.level} className="rounded-xl bg-slate-100 p-3 text-sm"><div className="font-semibold">{row.level}</div><div className="mt-1 text-xs text-slate-500">{t("admin.testPackage.assignedVariant")}: {row.selectedCode || "-"}</div><div className="mt-1 text-xs text-slate-500">{t("admin.testPackage.availableForLanguage")}: {row.options.length}</div></div>)}</div><p className="mt-3 text-xs text-slate-500">{t("admin.testPackage.saveHelper")}</p></div><div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="font-semibold">{t("admin.centreAccess.title")}</h3><div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center"><RealQr value={centreQr} /><div><div className="break-all font-mono text-xs text-slate-500">{centreQr}</div><Button onClick={() => { setStatus(t("status.openedForCentre")); addAudit(t("audit.centreAccessSent"), centre, CENTRE_ACCESS_TOKEN); }} className="mt-3 rounded-2xl">{t("admin.centreAccess.send")}</Button><Button onClick={() => setScannerMode("Centre")} variant="outline" className="ml-2 mt-3 rounded-2xl">{t("admin.centreAccess.scan")}</Button></div></div></div></CardContent></Card><Card className="rounded-2xl shadow-sm"><CardContent className="p-5"><SectionTitle icon={Languages} title={t("admin.multilingual.title")} subtitle={t("admin.multilingual.subtitle")} /><div className="space-y-2 text-sm">{["exam.start", "exam.submit", "sync.offline", "evaluation.total"].map((key) => <div key={key} className="rounded-xl border bg-white p-3"><div className="font-mono text-xs text-slate-500">{key}</div><div>{t("admin.multilingual.sourceTerms")}</div><StatusPill tone="warn">{t("admin.multilingual.needsReview")}</StatusPill></div>)}</div><Button variant="outline" className="mt-4 w-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {t("admin.multilingual.export")}</Button></CardContent></Card></>;
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


function CentreView({ centreUnlocked, centreCode, setCentreCode, unlockCentre, enabledLevels, toggleLevel, language, availableVariants, variants, setVariants, importTestPackage, testImportStatus, testImportError, testImportSummary, candidates, selectedCandidateId, setSelectedCandidateId, addCandidate, updateCandidate, assignments, setAssignments, examiners, candidateQrFor, examinerQrFor, centreSetupLoading, centreSetupSaving, centreSetupError, centreSetupStatus, centreAuditExportLoading, centreAuditExportError, centreQrAccess, centreValidationIssues, centreSetupDirty, setCentreSetupDirty, dataMode, candidateConfirmed, candidateStatus, candidateTimes, testResponses, reportDrafts, outdoor, handleLoadCentreSetup, handleSaveCentreSetup, handleDownloadCentreAuditPackage, updateExaminer, addExaminer, t }) {  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0]; const [copiedQr, setCopiedQr] = useState(""); const candidateQrUrl = (id) => centreQrAccess?.candidates?.find((item) => item.subjectId === id || item.subject_id === id)?.url; const examinerQrUrl = (id) => centreQrAccess?.examiners?.find((item) => item.subjectId === id || item.subject_id === id)?.url; async function copyQrLink(label, value) { try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); setCopiedQr(t("centre.copy.copied").replace("{label}", label)); return; } setCopiedQr(t("centre.copy.unavailable").replace("{label}", label)); } catch { setCopiedQr(t("centre.copy.unavailable").replace("{label}", label)); } } return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5">{!centreUnlocked && <div className="mb-4 rounded-2xl border bg-white p-4"><SectionTitle icon={QrCodeIcon} title={t("centre.access.title")} subtitle={t("centre.access.subtitle")} /><div className="flex flex-col gap-3 md:flex-row"><input value={centreCode} onChange={(e) => setCentreCode(e.target.value)} placeholder={t("centre.access.placeholder")} className="w-full rounded-xl border bg-white p-2 font-mono text-sm" /><Button onClick={unlockCentre} className="rounded-2xl">{t("centre.access.open")}</Button></div><div className="mt-2 text-xs text-slate-500">{t("centre.access.prototypeToken")}: {CENTRE_ACCESS_TOKEN}</div></div>}<div className={centreUnlocked ? "" : "pointer-events-none opacity-40"}><SectionTitle icon={Users} title={t("centre.config.title")} subtitle={t("centre.config.subtitle")} /><div className="mb-4 rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h3 className="font-semibold">{t("centre.setupPersistence.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("centre.setupPersistence.helper")}</p></div><div className="flex flex-wrap gap-2"><Button onClick={handleLoadCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreSetupLoading ? t("centre.setupPersistence.loading") : t("centre.setupPersistence.load")}</Button><Button onClick={handleSaveCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} className="rounded-2xl">{centreSetupSaving ? t("centre.setupPersistence.saving") : t("centre.setupPersistence.save")}</Button><Button onClick={handleDownloadCentreAuditPackage} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreAuditExportLoading ? t("centre.setupPersistence.exporting") : t("centre.setupPersistence.auditExport")}</Button></div></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill tone={centreSetupDirty ? "warn" : "good"}>{centreSetupDirty ? t("centre.setupPersistence.unsaved") : t("centre.setupPersistence.saved")}</StatusPill><span className="text-xs text-slate-500">{t("centre.setupPersistence.saveHelper")}</span></div>{centreSetupStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{centreSetupStatus}</div>}{centreSetupError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreSetupError}</div>}{centreAuditExportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreAuditExportError}</div>}<CentreValidationSummary issues={centreValidationIssues} StatusPill={StatusPill} t={t} /></div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("centre.dataMode.title")}</h3><p className="mt-1 text-sm text-slate-600">{dataMode === "backend" ? t("centre.dataMode.backendHelper") : t("centre.dataMode.demoHelper")}</p><p className="mt-1 text-xs text-slate-500">{t("centre.dataMode.saveAfterChanges")}</p></div><StatusPill tone={dataMode === "backend" ? "good" : "warn"}>{dataMode === "backend" ? t("centre.dataMode.backend") : t("centre.dataMode.demo")}</StatusPill></div></div><PilotReadinessGuardrails centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} testImportSummary={testImportSummary} dataMode={dataMode} StatusPill={StatusPill} t={t} /><PilotRunSummary centreValidationIssues={centreValidationIssues} centreSetupDirty={centreSetupDirty} testImportSummary={testImportSummary} dataMode={dataMode} StatusPill={StatusPill} t={t} /><CentreNetworkReadinessChecklist StatusPill={StatusPill} t={t} /><PilotWorkflowDashboard candidates={candidates} assignments={assignments} examiners={examiners} centreValidationIssues={centreValidationIssues} testImportSummary={testImportSummary} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} centreSetupStatus={centreSetupStatus} dataMode={dataMode} t={t} /><PilotSmokeTestChecklist StatusPill={StatusPill} t={t} /><PilotReleaseNotesPanel StatusPill={StatusPill} t={t} /><div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">{t("centre.levels.title")}</h3>{EXAM_LEVELS.map((level) => <label key={level} className="mb-3 flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={enabledLevels.includes(level)} onChange={() => toggleLevel(level)} /><span>{level}</span></label>)}</div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">{t("centre.variants.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("centre.variants.helper")}</p></div><label className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">{t("centre.variants.import")}<input type="file" accept=".csv,.json,application/json,text/csv" onChange={importTestPackage} className="hidden" /></label></div><div className="mt-3 grid gap-3 md:grid-cols-2">{EXAM_LEVELS.map((level) => { const vars = availableVariants.filter((v) => v.level === level && v.language === language); return <label key={level} className="text-sm font-medium">{level}<select value={variants[level] ?? ""} onChange={(e) => { setCentreSetupDirty(true); setVariants((prev) => ({ ...prev, [level]: e.target.value })); }} className="mt-1 w-full rounded-xl border bg-white p-2">{vars.length ? vars.map((v) => <option key={v.code} value={v.code}>{v.code}</option>) : <option value="">{t("centre.variants.noImported")}</option>}</select></label>; })}</div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">{t("centre.variants.csvHelper")}</div>{testImportStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{testImportStatus}</div>}{testImportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{testImportError}</div>}{testImportSummary && <div className="mt-2 text-xs text-slate-500">{t("centre.variants.importedSummary").replace("{variants}", testImportSummary.variants).replace("{questions}", testImportSummary.questions)}</div>}</div></div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{t("centre.candidates.title")}</h3><Button onClick={addCandidate} variant="outline" className="rounded-2xl">{t("centre.candidates.add")}</Button></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">{candidates.map((c) => <button key={c.id} onClick={() => setSelectedCandidateId(c.id)} className={`rounded-2xl border p-3 text-left ${selectedCandidateId === c.id ? "border-slate-950 bg-slate-50" : "bg-white"}`}><div className="text-xs text-slate-500">{c.id}</div><div className="font-medium">{c.name}</div><StatusPill>{c.level}</StatusPill></button>)}</div></div>{selectedCandidate && <div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">{t("centre.candidateDetails.title")}</h3><div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.id")}<input value={selectedCandidate.id ?? ""} readOnly className="mt-1 w-full rounded-xl border bg-slate-100 p-2 text-sm text-slate-600" /></label><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.name")}<input value={selectedCandidate.name ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { name: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.level")}<select value={selectedCandidate.level ?? "Practicing"} onChange={(e) => updateCandidate(selectedCandidate.id, { level: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950"><option value="Practicing">Practicing</option><option value="Consulting">Consulting</option></select></label><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.birthDate")}<input value={selectedCandidate.birthDate ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { birthDate: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.documentId")}<input value={selectedCandidate.documentId ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { documentId: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">{t("centre.candidateDetails.email")}<input value={selectedCandidate.email ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { email: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label></div></div>}<div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">{t("centre.examiners.title")}</h3><Button onClick={addExaminer} variant="outline" className="rounded-2xl">{t("centre.examiners.add")}</Button></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{examiners.map((ex) => <div key={ex.id} className="rounded-2xl border bg-white p-3 text-sm"><label className="text-xs font-medium text-slate-500">{t("centre.examinerDetails.id")}<input value={ex.id ?? ""} onChange={(e) => updateExaminer(ex.id, { id: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">{t("centre.examinerDetails.name")}<input value={ex.name ?? ""} onChange={(e) => updateExaminer(ex.id, { name: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">{t("centre.examinerDetails.registrationId")}<input value={ex.registrationId ?? ""} onChange={(e) => updateExaminer(ex.id, { registrationId: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">{t("centre.examinerDetails.email")}<input value={ex.email ?? ""} onChange={(e) => updateExaminer(ex.id, { email: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label></div>)}</div></div><div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">{t("centre.assignments.title")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-3">{t("centre.workflow.candidate")}</th><th className="py-2 pr-3">{t("centre.workflow.level")}</th><th className="py-2 pr-3">{t("centre.workflow.primaryExaminer")}</th><th className="py-2 pr-3">{t("centre.workflow.secondaryExaminer")}</th></tr></thead><tbody>{candidates.map((c) => <tr key={c.id} className="border-b"><td className="py-2 pr-3 font-medium">{c.name}</td><td className="py-2 pr-3">{c.level}</td>{["primary", "secondary"].map((slot) => <td key={slot} className="py-2 pr-3"><select value={assignments[c.id]?.[slot] ?? ""} onChange={(e) => { setCentreSetupDirty(true); setAssignments((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? {}), [slot]: e.target.value } })); }} className="w-full rounded-xl border bg-white p-2">{examiners.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select></td>)}</tr>)}</tbody></table></div></div><CentreQrAccessPack candidates={candidates} examiners={examiners} candidateQrUrl={candidateQrUrl} examinerQrUrl={examinerQrUrl} candidateQrFor={candidateQrFor} examinerQrFor={examinerQrFor} copiedQr={copiedQr} copyQrLink={copyQrLink} QrCodeIcon={QrCodeIcon} SectionTitle={SectionTitle} StatusPill={StatusPill} Button={Button} RealQr={RealQr} t={t} /></div></CardContent></Card>;
}
function CandidateView({ candidates, loggedCandidate, confirmed, loginCandidate, logoutCandidate, confirmCandidate, sections, sectionStatus, sectionTimes, sectionTone, openSection, activeSection, setActiveSection, testResponses, updateTest, submitTest, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, submitReport, variants, testBank, qrFor, setScannerMode, t }) {
  const selectedVariantCode = loggedCandidate ? variants[loggedCandidate.level] : "";

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={QrCodeIcon} title={t("candidate.view.title")} subtitle={t("candidate.view.subtitle")} /><CandidateQuickHelp t={t} /><div className="grid gap-4 lg:grid-cols-3">{!loggedCandidate && <div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{t("candidate.qrAccess.title")}</h3><Button onClick={() => setScannerMode("Candidate")} variant="outline" className="rounded-2xl">{t("common.scanQr")}</Button></div><p className="mt-3 text-sm text-slate-600">{t("candidate.qrAccess.helper")}</p></div>}<div className={`rounded-2xl border bg-white p-4 ${loggedCandidate ? "lg:col-span-3" : "lg:col-span-2"}`}>{!loggedCandidate ? <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{t("candidate.empty")}</div> : <div className="grid gap-4"><div className="rounded-2xl bg-slate-100 p-4"><div className="flex flex-wrap gap-2"><StatusPill tone="good">{t("common.loggedIn")}</StatusPill><StatusPill>{loggedCandidate.level}</StatusPill><StatusPill>{selectedVariantCode}</StatusPill></div><div className="mt-2 font-semibold">{loggedCandidate.name}</div><Button onClick={logoutCandidate} variant="outline" className="mt-3 rounded-2xl">{t("common.logout")}</Button></div>{activeSection === "landing" && <CandidateLanding candidate={loggedCandidate} confirmed={confirmed} confirmCandidate={confirmCandidate} sections={sections} status={sectionStatus} times={sectionTimes} tone={sectionTone} openSection={openSection} t={t} />}{activeSection === "test" && <TestSection candidate={loggedCandidate} selectedVariantCode={selectedVariantCode} testBank={testBank} responses={testResponses[loggedCandidate.id] ?? {}} updateTest={updateTest} submitTest={submitTest} setActiveSection={setActiveSection} t={t} />}{activeSection === "report" && loggedCandidate.level === "Consulting" && <ReportSection candidate={loggedCandidate} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} submitReport={submitReport} t={t} />}</div>}</div></div></CardContent></Card>;
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

  return <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">{t("candidate.identity.detailsTitle")}</h3>{[[t("candidate.identity.name"), candidate.name], [t("candidate.identity.birthDate"), candidate.birthDate], [t("candidate.identity.documentId"), candidate.documentId], [t("candidate.identity.examLevel"), candidate.level]].map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}{!confirmed && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{t("candidate.identity.warning")}</p>}<Button onClick={confirmCandidate} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? t("candidate.identity.confirmed") : t("candidate.identity.confirm")}</Button></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">{t("candidate.landing.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("candidate.landing.helper")}</p></div><div className="rounded-xl bg-slate-100 p-3 text-sm md:max-w-sm"><div className="font-semibold">{t("candidate.readiness.title")}</div><div className="mt-2 flex flex-wrap gap-2">{readinessItems.map(([label, ready]) => <StatusPill key={label} tone={ready ? "good" : "default"}>{label}</StatusPill>)}</div></div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{sections.map((section) => <div key={section.key} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{section.title}</h4><p className="mt-1 text-sm text-slate-600">{section.description}</p></div><StatusPill tone={tone(status[section.key])}>{status[section.key]}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{sectionHelper(status[section.key])}</p><div className="mt-3 text-xs text-slate-500"><div>{t("common.opened")}: {times[section.key]?.openedAt || "-"}</div><div>{t("common.closed")}: {times[section.key]?.closedAt || "-"}</div></div><Button onClick={() => openSection(section.key)} disabled={!confirmed} className="mt-4 rounded-2xl">{status[section.key] === "closed" ? t("candidate.section.requestReopen") : t("candidate.sections.open")}</Button></div>)}</div></div></div>;
}

function TestSection({ candidate, selectedVariantCode, testBank, responses, updateTest, submitTest, setActiveSection, t }) {
  const questions = testBank[selectedVariantCode] ?? [];
  const helper = t("test.variantAutosave").replace("{variant}", selectedVariantCode);

  return <div className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{t("test.title")}</h3><p className="text-sm text-slate-600">{helper}</p></div><Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">{t("common.back")}</Button></div>{questions.length === 0 ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><div className="font-semibold">{t("test.noQuestions")}</div><p className="mt-1">{t("test.askCentre")}</p></div> : <div className="mt-3 space-y-4">{questions.map((q, i) => <div key={q.id} className="rounded-xl border p-3"><div className="text-xs text-slate-500">{t("test.question")} {i + 1} / {q.points} {t("common.points")}</div><div className="mt-1 font-medium">{q.text}</div>{q.type === "single_choice" ? <div className="mt-2 space-y-2">{q.options.map((option) => <label key={option} className="flex gap-2 rounded-xl bg-slate-50 p-2 text-sm"><input type="radio" checked={responses[q.id] === option} onChange={() => updateTest(q.id, option)} /><span>{option}</span></label>)}</div> : <textarea value={responses[q.id] ?? ""} onChange={(e) => updateTest(q.id, e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border bg-white p-3 text-sm" placeholder={t("test.writeAnswer")} />}</div>)}</div>}<Button onClick={submitTest} disabled={questions.length === 0} className="mt-4 rounded-2xl"><Lock className="mr-2 h-4 w-4" /> {t("test.submit")}</Button><p className="mt-2 text-xs text-slate-500">{t("common.offlineRetry")}</p></div>;
}

function ReportSection({ candidate, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, submitReport, t }) {
  const draft = reportDrafts[candidate.id] ?? createReportDraft();
  const tree = draft[activeReportTree];
  const [photoStatus, setPhotoStatus] = useState("");

  function handlePhotoChange(event) {
    const input = event.target;
    const file = input.files?.[0];

    if (!file) {
      input.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      addReportPhoto(activeReportTree, {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result,
        createdAt: new Date().toISOString(),
      });
      setPhotoStatus(t("report.photoAdded"));
      input.value = "";
    };

    reader.onerror = () => {
      setPhotoStatus(t("report.photoError"));
      input.value = "";
    };

    reader.readAsDataURL(file);
  }

  return <div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">{t("report.titleFull")}</h3><p className="mt-1 text-sm text-slate-600">{t("report.helper")}</p><div className="mt-3 flex gap-2">{REPORT_TREES.map((treeName) => <Button key={treeName} variant={activeReportTree === treeName ? "default" : "outline"} onClick={() => setActiveReportTree(treeName)} className="rounded-2xl">{treeName}</Button>)}</div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">{t("report.photos")}: <strong>{tree.photos.length}</strong><p className="mt-2 text-xs text-slate-500">{t("report.photoHelper")}</p><label className="mt-3 inline-flex w-full cursor-pointer items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">{t("report.addPhotoShort")}<input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" /></label>{photoStatus && <div className="mt-2 text-xs font-medium text-slate-600">{photoStatus}</div>}{tree.photos.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{tree.photos.map((photo) => <div key={photo.id} className="flex items-center gap-3 rounded-xl border bg-white p-2"><div className="h-14 w-14 overflow-hidden rounded-lg bg-slate-200">{photo.dataUrl ? <img src={photo.dataUrl} alt={photo.name || photo.caption || photo.id} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{photo.id}</div>}</div><div className="min-w-0 text-xs"><div className="truncate font-medium text-slate-900">{photo.name || photo.caption || photo.id}</div><div className="text-slate-500">{photo.type || "image"} · {photo.size ? `${Math.round(photo.size / 1024)} KB` : ""}</div></div></div>)}</div>}</div><textarea value={tree.fieldNotes} onChange={(e) => updateReport(activeReportTree, "fieldNotes", e.target.value, "fieldNotes")} placeholder={t("report.fieldPlaceholder")} className="mt-3 min-h-28 w-full rounded-xl border bg-white p-3 text-sm" /><div className="mt-3 grid gap-3 md:grid-cols-2">{REPORT_SECTIONS.map((sec) => <label key={sec.key} className="text-sm font-medium">{sec.title}<textarea value={tree.finalSections[sec.key] ?? ""} onChange={(e) => updateReport(activeReportTree, sec.key, e.target.value)} placeholder={`${activeReportTree}: ${sec.title}`} className="mt-1 min-h-20 w-full rounded-xl border bg-white p-3 text-sm" /></label>)}</div><Button onClick={submitReport} className="mt-4 rounded-2xl"><Lock className="mr-2 h-4 w-4" /> {t("report.submit")}</Button><p className="mt-2 text-xs text-slate-500">{t("common.offlineRetry")}</p></div>;
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
  selectedCandidate,
  selectedMode,
  activeOutdoorSection,
  setActiveOutdoorSection,
  outdoor,
  outdoorNotes,
  updateOutdoor,
  updateOutdoorNote,
  outdoorTotal,
  outdoorMax,
  submitOutdoor,
  archivePlan,
  practicingArchive,
  scoring,
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
  reportDrafts,
  qrFor,
  setScannerMode,
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
                  assignedCandidates={assignedCandidates}
                  assignments={assignments}
                  setPrimary={setPrimary}
                  openOutdoor={openOutdoor}
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

      <ScoringCard
        selectedCandidate={selectedCandidate}
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
      />
    </>
  );
}
function ExaminerLanding({ examiner, confirmed, confirmExaminer, assignedCandidates, assignments, setPrimary, openOutdoor, t }) {
  const readiness = [
    { label: t("examiner.readiness.identity"), ready: confirmed },
    { label: t("examiner.readiness.assignments"), ready: assignedCandidates.length > 0 },
  ];

  return <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">{t("examiner.identity.title")}</h3>{[[t("examiner.identity.name"), examiner.name], [t("examiner.identity.registrationId"), examiner.registrationId]].map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}<Button onClick={confirmExaminer} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? t("examiner.identity.confirmed") : t("examiner.identity.confirm")}</Button></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="mb-4 rounded-xl bg-slate-100 p-3 text-sm"><div className="font-semibold">{t("examiner.readiness.title")}</div><div className="mt-2 flex flex-wrap gap-2">{readiness.map((item) => <StatusPill key={item.label} tone={item.ready ? "good" : "warn"}>{item.label}</StatusPill>)}</div></div><h3 className="font-semibold">{t("examiner.worklist.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("examiner.worklist.helper")}</p>{assignedCandidates.length === 0 ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="font-semibold">{t("examiner.worklist.emptyTitle")}</div><p className="mt-1">{t("examiner.worklist.emptyHelper")}</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2">{assignedCandidates.map((c) => { const isPrimary = assignments[c.id]?.primary === examiner.id; return <div key={c.id} className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3"><div><div className="font-semibold">{c.name}</div><div className="text-sm text-slate-600">{c.level}</div></div><StatusPill tone={isPrimary ? "good" : "default"}>{isPrimary ? t("examiner.role.primary") : t("examiner.role.secondary")}</StatusPill></div><label className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm"><input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(c.id, examiner.id, e.target.checked)} />{t("examiner.worklist.primaryCheckbox")}</label><Button onClick={() => openOutdoor(c.id)} disabled={!confirmed} className="mt-4 rounded-2xl">{t("examiner.worklist.openOutdoor")}</Button></div>; })}</div>}</div></div>;
}

function OutdoorForm({ selectedCandidate, selectedMode, activeOutdoorSection, setActiveOutdoorSection, outdoor, outdoorNotes, updateOutdoor, updateOutdoorNote, outdoorTotal, outdoorMax, submitOutdoor, archivePlan, practicingArchive, setActivePage, time, t }) {
  const total = OUTDOOR_SECTIONS[selectedCandidate.level].reduce((sum, s) => sum + outdoorTotal(selectedCandidate.id, selectedCandidate.level, s), 0);

  return <div className="grid gap-4 lg:grid-cols-3"><div><Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">{t("outdoor.backToLanding")}</Button><h3 className="font-semibold">{t("outdoor.candidateBinding")}</h3><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">{t("outdoor.activeRecord")}: <strong>{selectedCandidate.name}</strong><br />{t("outdoor.level")}: <strong>{selectedCandidate.level}</strong><br />{t("outdoor.total")}: <strong>{total}</strong> / {scoreLimits(selectedCandidate.level).outdoorMax}<br />{t("common.opened")}: {time?.openedAt || "-"}<br />{t("common.closed")}: {time?.closedAt || "-"}</div>{selectedCandidate.level === "Practicing" && <div className="mt-3 rounded-xl border bg-white p-3 text-sm"><div className="font-semibold">{t("outdoor.paperArchive.title")}</div><p className="mt-1 text-slate-600">{t("outdoor.paperArchive.helper")}</p><Button onClick={archivePlan} variant="outline" className="mt-3 w-full rounded-2xl">{t("outdoor.paperArchive.button")}</Button><div className="mt-2 text-xs text-slate-500">{t("outdoor.paperArchive.photos")}: {(practicingArchive[selectedCandidate.id] ?? []).length}</div></div>}<div className="mt-4 space-y-2">{OUTDOOR_SECTIONS[selectedCandidate.level].map((section) => <button key={section} onClick={() => setActiveOutdoorSection(section)} className={`w-full rounded-xl border p-3 text-left text-sm ${activeOutdoorSection === section ? "border-slate-950 bg-slate-50" : "bg-white hover:bg-slate-50"}`}><div className="font-medium">{OUTDOOR_TITLES[section]}</div><div className="text-xs text-slate-500">{outdoorTotal(selectedCandidate.id, selectedCandidate.level, section)} / {outdoorMax(selectedCandidate.level, section)} {t("outdoor.points")}</div></button>)}</div></div><div className="lg:col-span-2"><h3 className="font-semibold">{t("outdoor.detail.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("outdoor.detail.helper")}</p><div className="mt-4 space-y-3">{(OUTDOOR_ITEMS[selectedCandidate.level]?.[activeOutdoorSection] ?? []).map((item) => <div key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="font-mono text-xs text-slate-500">{item.id}</div><div className="font-medium">{item.text}</div><div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><div className="mb-1 font-semibold">{t("outdoor.notesGuidance")}</div><div>{item.notes}</div></div></div><label className="text-sm font-medium md:w-36">{t("outdoor.pointsLabel")} / {item.max}<input type="number" min="0" max={item.max} value={outdoor[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoor(item.id, e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label></div><textarea value={outdoorNotes[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoorNote(item.id, e.target.value)} placeholder={t("outdoor.examinerNotes")} className="mt-3 min-h-16 w-full rounded-xl border bg-white p-3 text-sm" /></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button onClick={submitOutdoor} disabled={selectedMode === "unassigned"} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" /> {t("outdoor.submit")}</Button><StatusPill tone={selectedMode === "primary" ? "good" : "default"}>{selectedMode === "primary" ? t("outdoor.mode.primary") : selectedMode === "secondary" ? t("outdoor.mode.secondary") : t("outdoor.mode.unassigned")}</StatusPill><StatusPill tone="warn">{t("outdoor.autosave")}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{t("common.offlineRetry")}</p></div></div>;
}

function ScoringCard({ selectedCandidate, scoring, updateScore, generateEvaluation, lastEvaluation, loadEvaluationPreview, evaluationPreview, evaluationLoading, evaluationError, downloadDraftExport, exportLoading, exportError, variants, testBank, testResponses, reportDrafts, t }) {
  const writtenReview = computeWrittenTestReview(selectedCandidate, variants, testBank, testResponses);
  const reportReview = computeReportReview(reportDrafts?.[selectedCandidate.id] ?? createReportDraft());

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={BadgeCheck} title={t("scoring.title")} subtitle={t("scoring.subtitle")} /><div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><div className="font-semibold">{selectedCandidate.name}</div><div className="mt-4 text-sm text-slate-600">{t("scoring.status")}: <StatusPill>{selectedCandidate.status}</StatusPill></div></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">{t("scoring.written")} / {scoring.writtenMax}<input type="number" value={selectedCandidate.written ?? ""} onChange={(e) => updateScore("written", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label><label className="text-sm font-medium">{t("scoring.outdoor")} / {scoring.outdoorMax}<input type="number" value={selectedCandidate.outdoor ?? ""} onChange={(e) => updateScore("outdoor", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>{selectedCandidate.level === "Consulting" && <label className="text-sm font-medium">{t("scoring.report")} / {scoring.reportMax}<input type="number" value={selectedCandidate.report ?? ""} onChange={(e) => updateScore("report", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>}</div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("examiner.writtenReview.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("examiner.writtenReview.variant")}: {writtenReview.variantCode || "-"}</p></div><div className="flex flex-wrap gap-2"><StatusPill>{writtenReview.correctCount} {t("examiner.writtenReview.correct")}</StatusPill><StatusPill>{writtenReview.unansweredCount} {t("examiner.writtenReview.unanswered")}</StatusPill><StatusPill>{writtenReview.computedScore} / {writtenReview.computedMax} {t("common.points")}</StatusPill></div></div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><strong>{t("examiner.writtenReview.computedScore")}:</strong> {writtenReview.computedScore} / {writtenReview.computedMax}<p className="mt-1 text-xs text-slate-500">{t("examiner.writtenReview.helper")}</p><Button onClick={() => updateScore("written", writtenReview.computedScore)} disabled={writtenReview.computedMax === 0} variant="outline" className="mt-3 rounded-2xl">{t("examiner.writtenReview.apply")}</Button></div><div className="mt-3 space-y-3">{writtenReview.items.map((item, index) => <div key={item.question.id} className="rounded-xl border bg-white p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-slate-500">{t("test.question")} {index + 1} / {item.question.points} {t("common.points")}</div><div className="mt-1 font-medium">{item.question.text}</div></div><StatusPill tone={!item.hasAnswer ? "warn" : item.hasCorrectAnswer ? item.correct ? "good" : "bad" : "default"}>{!item.hasAnswer ? t("examiner.writtenReview.unanswered") : item.hasCorrectAnswer ? item.correct ? t("examiner.writtenReview.correct") : t("examiner.writtenReview.incorrect") : t("examiner.writtenReview.manual")}</StatusPill></div><div className="mt-2 rounded-lg bg-slate-50 p-2"><div className="text-xs font-semibold text-slate-500">{t("examiner.writtenReview.candidateAnswer")}</div><div className="mt-1 whitespace-pre-wrap">{item.hasAnswer ? item.answer : "-"}</div></div>{item.hasCorrectAnswer && <div className="mt-2 rounded-lg bg-emerald-50 p-2"><div className="text-xs font-semibold text-emerald-800">{t("examiner.writtenReview.correctAnswer")}</div><div className="mt-1 whitespace-pre-wrap text-emerald-950">{item.question.correctAnswer}</div></div>}</div>)}</div></div>{selectedCandidate.level === "Consulting" && <div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("examiner.reportReview.title")}</h3><p className="mt-1 text-sm text-slate-600">{t("examiner.reportReview.helper")}</p></div><div className="flex flex-wrap gap-2"><StatusPill>{reportReview.filledSections} / {reportReview.totalSections} {t("examiner.reportReview.sections")}</StatusPill><StatusPill>{reportReview.photos} {t("examiner.reportReview.photos")}</StatusPill><StatusPill>{reportReview.completeness}% {t("examiner.reportReview.complete")}</StatusPill></div></div><div className="mt-3 space-y-4">{reportReview.trees.map((tree) => <div key={tree.treeName} className="rounded-xl border bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{tree.treeName}</h4><div className="flex flex-wrap gap-2"><StatusPill>{tree.filledSections} / {tree.totalSections} {t("examiner.reportReview.sections")}</StatusPill><StatusPill>{tree.photos.length} {t("examiner.reportReview.photos")}</StatusPill></div></div><div className="mt-3 rounded-lg bg-slate-50 p-2"><div className="text-xs font-semibold text-slate-500">{t("report.fieldNotes")}</div><div className="mt-1 whitespace-pre-wrap">{String(tree.fieldNotes).trim() || "-"}</div></div>{tree.photos.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">{tree.photos.map((photo) => <div key={photo.id} className="flex items-center gap-3 rounded-xl border bg-white p-2"><div className="h-16 w-16 overflow-hidden rounded-lg bg-slate-200">{photo.dataUrl ? <img src={photo.dataUrl} alt={photo.name || photo.caption || photo.id} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{photo.id}</div>}</div><div className="min-w-0 text-xs"><div className="truncate font-medium text-slate-900">{photo.name || photo.caption || photo.id}</div><div className="text-slate-500">{photo.type || "image"} · {photo.size ? `${Math.round(photo.size / 1024)} KB` : ""}</div></div></div>)}</div>}<div className="mt-3 grid gap-3 md:grid-cols-2">{tree.finalSections.map((section) => <div key={section.key} className="rounded-lg bg-slate-50 p-2"><div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-500">{section.title}</div><StatusPill tone={section.filled ? "good" : "warn"}>{section.filled ? t("examiner.reportReview.filled") : t("examiner.reportReview.missing")}</StatusPill></div><div className="mt-1 whitespace-pre-wrap">{String(section.value).trim() || "-"}</div></div>)}</div></div>)}</div></div>}<div className="mt-4 grid gap-3 md:grid-cols-5"><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.total")}</div><div className="text-xl font-bold">{scoring.total} / {scoring.max}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.percentage")}</div><div className="text-xl font-bold">{scoring.percentage}%</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">{t("scoring.result")}</div><div className="text-xl font-bold">{scoring.pass ? t("scoring.pass") : t("scoring.notPassed")}</div></div><Button onClick={generateEvaluation} className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {t("scoring.generate")}</Button><Button onClick={() => loadEvaluationPreview(selectedCandidate.id)} disabled={evaluationLoading} variant="outline" className="h-full rounded-2xl">{evaluationLoading ? t("scoring.loading") : t("scoring.loadPreview")}</Button><Button onClick={() => downloadDraftExport(selectedCandidate.id)} disabled={exportLoading} variant="outline" className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {exportLoading ? t("scoring.exporting") : t("scoring.downloadDraftExport")}</Button></div><p className="mt-3 text-xs text-slate-500">{t("scoring.draftOnly")}</p>{evaluationError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{evaluationError}</div>}{exportError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{exportError}</div>}{lastEvaluation && <div className="mt-4 rounded-2xl border bg-white p-4 text-sm"><div className="font-semibold">{t("scoring.lastGenerated")}</div><div className="mt-1 text-slate-600">{lastEvaluation.candidate} / {lastEvaluation.level}: {lastEvaluation.total}/{lastEvaluation.max} ({lastEvaluation.percentage}%) - {lastEvaluation.result}</div></div>}<EvaluationPreviewCard preview={evaluationPreview} t={t} /></div></div></CardContent></Card>;
}
