import React, { useEffect, useMemo, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { bootstrapSession, resolveQrToken, syncBatch, fetchCandidateEvaluation, exportCandidateEvaluation, exportCentreAuditPackage, downloadBase64File, loadCentreSetup } from "./lib/api";

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
    { id: "P1-Q1", type: "single_choice", points: 1, text: "In relation to the physiological and structural function of a tree, what is a functional unit?", options: ["A semi-autonomous unit comprising roots, trunk and shoots.", "A collection of tissues operating only in the current annual ring.", "The cells that form only when a wound is created.", "The section of trunk below the pollard knuckle."] },
    { id: "P1-Q2", type: "single_choice", points: 1, text: "Which action is generally most compatible with protecting a veteran tree rooting environment?", options: ["Raising soil level around the stem", "Compacting the access route", "Mulching with appropriate material", "Removing all fallen deadwood"] },
    { id: "P1-Q3", type: "single_choice", points: 1, text: "Why can crown retrenchment be beneficial to a veteran tree?", options: ["It reduces biomechanical loading and can shorten transport distances.", "It removes all decay from the stem.", "It prevents reiteration.", "It makes root protection unnecessary."] },
    { id: "P1-Q4", type: "written", points: 2, text: "List two measures you would take to reduce the risk of spreading pests and diseases during veteran tree work." },
    { id: "P1-Q5", type: "written", points: 3, text: "Give three veteran tree features that should be considered before deciding how to access the crown." },
    { id: "P1-Q6", type: "written", points: 4, text: "Describe how you would protect the rooting environment of a veteran tree during practical work." },
    { id: "P1-Q7", type: "written", points: 4, text: "Explain how cut material may be managed on site and give advantages or disadvantages of your chosen approach." },
    { id: "P1-Q8", type: "written", points: 5, text: "Describe how you would interpret the health / vitality of a veteran tree using visible evidence." },
  ],
  PRACTICING_2026_V2_EN: [
    { id: "P2-Q1", type: "single_choice", points: 1, text: "Which feature is commonly associated with veteran tree habitat value?", options: ["Hollowing and decaying wood", "Uniform nursery pruning only", "Absence of fungi", "Complete removal of deadwood"] },
    { id: "P2-Q2", type: "single_choice", points: 1, text: "What is the best first response if the work instruction may damage a sensitive habitat feature?", options: ["Stop and seek clarification", "Proceed quickly", "Remove the feature", "Ignore it if small"] },
    { id: "P2-Q3", type: "single_choice", points: 1, text: "Why is phased halo release often preferred?", options: ["It reduces sudden physiological and environmental shock", "It removes all competition immediately", "It prevents monitoring", "It eliminates future veteran trees"] },
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
const OUTDOOR_SECTIONS = { Practicing: ["generic", "prework", "threats", "history", "risk"], Consulting: ["generic", "history", "risk"] };
const OUTDOOR_TITLES = { generic: "Generic oral questions", prework: "Exercise 1 - Pre-work assessment", threats: "Exercise 2 - Threats", history: "Exercise 3 - History", risk: "Exercise 4 - Risk" };
const OUTDOOR_ITEMS = {
  Practicing: {
    generic: [{ id: "P-G-01", text: "Can you provide a list of 3 characteristics a veteran tree may have?", max: 1, notes: "Award 1 mark for 3 relevant characteristics; 0.5 for up to 2. Examples: great age, crown retrenchment, history of pollarding, large girth, complex structure, hollowing or decaying wood." }, { id: "P-G-02", text: "Can you describe the value of this tree?", max: 1, notes: "Accept historical, ecological, cultural, landscape, aesthetic and social values." }],
    prework: [{ id: "P-PW-01", text: "Please tell me about the health / vitality of the tree. How have you determined this?", max: 10, notes: "Higher scores require evidence: leaf density, bud density, extension growth, woundwood, reaction growth, epicormic growth and functional units." }, { id: "P-PW-02", text: "Refer to the paper management plan. Assess positioning of access, parking, equipment and machinery routes.", max: 2, notes: "The candidate prepares this on paper. Examiner assesses verbally and photographs it for archive only." }],
    threats: [{ id: "P-TH-01", text: "Identify the threat, likely impact and suitable management response.", max: 8, notes: "Look for realistic and proportionate management that protects veteran tree value." }],
    history: [{ id: "P-HI-01", text: "Tell me about the history of this tree and landscape.", max: 16, notes: "Assess ability to read tree body language and landscape history." }],
    risk: [{ id: "P-RI-01", text: "Identify targets, defects, risk level and management options.", max: 9, notes: "Balance risk with ecological, cultural and historical value." }],
  },
  Consulting: {
    generic: [{ id: "C-G-01", text: "Can you provide a list of 3 characteristics a veteran tree may have?", max: 1, notes: "Award 1 mark for 3 relevant characteristics; 0.5 for up to 2." }, { id: "C-G-02", text: "For the selected wildlife guild, describe habitat requirements, life cycle, survey / ID features and management implications.", max: 6, notes: "Award for species/group, habitat requirements, life cycle, survey or ID features and appropriate management implications." }],
    history: [{ id: "C-HI-01", text: "Based on your observations, tell me as much as you can about the history of this tree.", max: 10, notes: "Look for form, evidence and phases of management, damage, environmental change and body language." }, { id: "C-HI-02", text: "Based on your observations, tell me as much as you can about the history of this landscape.", max: 10, notes: "Look for age structure, species diversity, management history, land use, historic integrity and fragmentation." }],
    risk: [{ id: "C-RI-01", text: "Identify drop zone, targets, use frequency, biomechanical defects and management options.", max: 12, notes: "Balance risk against ecological, historical, cultural and social value; options should be proportionate." }],
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
function RealQr({ value, size = 112 }) {
  const encoded = encodeURIComponent(value);
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`}
      alt="VetBara QR code"
      width={size}
      height={size}
      className="rounded-xl bg-white p-2 shadow-inner"
    />
  );
}
function parseQrPayload(payload) { try { const url = new URL(payload); return { role: url.searchParams.get("role"), id: url.searchParams.get("id"), token: url.searchParams.get("token") }; } catch { const [role, id, token] = String(payload).split("|"); return { role, id, token }; } }
function QrScannerPanel({ title, onScan, onClose }) { const id = useMemo(() => `qr-reader-${Math.random().toString(36).slice(2)}`, []); useEffect(() => { const scanner = new Html5QrcodeScanner(id, { fps: 10, qrbox: { width: 250, height: 250 } }, false); scanner.render((text) => { onScan(text); scanner.clear().catch(() => {}); }, () => {}); return () => { scanner.clear().catch(() => {}); }; }, [id, onScan]); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{title}</h3><p className="text-sm text-slate-600">Allow camera access and point the tablet at a VetBara QR code.</p></div><Button onClick={onClose} variant="outline" className="rounded-2xl">Close</Button></div><div id={id} className="overflow-hidden rounded-2xl border" /></div></div>; }

export default function VetBaraPrototype() {
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
      const access = await resolveAccessWithFallback(parsed, "Direct QR/link accepted");
      if (!cancelled && access) applyResolvedAccess(access, "Direct QR/link accepted");
    }

    openQrSession();
    return () => { cancelled = true; };
  }, []);

  function importTestPackage(event) {
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
        setTestImportStatus(`Imported ${imported.variants.length} variants and ${imported.questionCount} questions.`);
        addAudit("Test package imported", file.name, `${imported.variants.length} variant(s), ${imported.questionCount} question(s)`);
        queue("Test package import", file.name);
      } catch (error) {
        console.error("Test import failed", error);
        setTestImportError(`Test import failed: ${error.message}`);
        addAudit("Test package import failed", file.name, error.message);
      }
    };
    reader.onerror = () => {
      setTestImportError("Test import failed: the file could not be read.");
      addAudit("Test package import failed", file.name, "File could not be read");
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
      addAudit("QR resolve failed", parsed.id ?? "Unknown QR", "The QR code could not be verified.");
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
      setEvaluationError("Open this portal with a valid QR/session before loading the evaluation preview.");
      return;
    }

    setEvaluationLoading(true);
    setEvaluationError("");

    try {
      const result = await fetchCandidateEvaluation(activeSessionToken, candidateId);
      setEvaluationPreview(result);
    } catch (error) {
      console.error("Evaluation preview failed", error);
      setEvaluationError("Evaluation preview is unavailable. Reopen the Examiner QR/session and try again.");
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function downloadDraftExport(candidateId) {
    if (!activeSessionToken) {
      setExportError("Open this portal with a valid QR/session before downloading the Draft Export.");
      return;
    }

    setExportLoading(true);
    setExportError("");

    try {
      const result = await exportCandidateEvaluation(activeSessionToken, candidateId, "xls");
      downloadBase64File(result);
    } catch (error) {
      console.error("Draft export failed", error);
      setExportError("Draft Export is unavailable. Reopen the Examiner QR/session and try again.");
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
    setCandidates((prev) => prev.map((candidate) => (
      candidate.id === id ? { ...candidate, ...patch } : candidate
    )));
  }

  function updateExaminer(id, patch) {
    setExaminers((prev) => prev.map((examiner) => examiner.id === id ? { ...examiner, ...patch } : examiner));
  }

  function addExaminer() {
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
        ? `Loaded stored test package with ${summary.variants} variant(s) and ${summary.questions} question(s).`
        : "Loaded stored test package.");
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
      setCentreSetupError("Open the Centre portal with a valid Centre QR/session, then try again.");
      return;
    }

    setCentreSetupLoading(true);
    setCentreSetupError("");
    setCentreSetupStatus("");

    try {
      const result = await loadCentreSetup(activeSessionToken);
      applyCentreSetup(result);
      setCentreValidationIssues([]);
      setCentreSetupStatus(`Loaded centre setup for exam event ${result.examEventId || "current"}.`);
    } catch (error) {
      console.error("Centre setup load failed", error);
      setCentreSetupError("Centre Setup could not be loaded. Check the session and try again.");
    } finally {
      setCentreSetupLoading(false);
    }
  }

  async function handleSaveCentreSetup() {
    if (!activeSessionToken) {
      setCentreSetupError("Open the Centre portal with a valid Centre QR/session, then try again.");
      return;
    }

    const issues = validateCentreSetup();
    setCentreValidationIssues(issues);

    if (issues.some((issue) => issue.severity === "error")) {
      setCentreSetupError("Centre setup has validation errors. Please fix them before saving.");
      return;
    }

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
      setCentreSetupStatus(`Saved centre setup for exam event ${result.examEventId || "current"}.`);
    } catch (error) {
      console.error("Centre setup save failed", error);
      setCentreSetupError("Centre Setup could not be saved. Fix any validation issues and try again.");
    } finally {
      setCentreSetupSaving(false);
    }
  }

  async function handleDownloadCentreAuditPackage() {
    if (!activeSessionToken) {
      setCentreAuditExportError("Open the Centre portal with a valid Centre QR/session before downloading the Audit Package.");
      return;
    }

    setCentreAuditExportLoading(true);
    setCentreAuditExportError("");

    try {
      const result = await exportCentreAuditPackage(activeSessionToken, "xls");
      downloadBase64File(result);
    } catch (error) {
      console.error("Centre audit export failed", error);
      setCentreAuditExportError("The Centre Audit Package requires a valid Centre session. Reopen the Centre QR and try again.");
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
  function toggleLevel(level) { setEnabledLevels((prev) => prev.includes(level) && prev.length > 1 ? prev.filter((x) => x !== level) : prev.includes(level) ? prev : [...prev, level]); }
  function addCandidate() { const id = `C-${String(candidates.length + 1).padStart(3, "0")}`; const level = enabledLevels[0] ?? "Practicing"; const c = { id, name: `New candidate ${candidates.length + 1}`, birthDate: "", documentId: "", email: "", level, status: "Ready", written: null, outdoor: null, report: null }; setCandidates((prev) => [...prev, c]); setCandidateStatus((prev) => ({ ...prev, [id]: createSectionStatus(level) })); setAssignments((prev) => ({ ...prev, [id]: { primary: examiners[0]?.id ?? "", secondary: examiners[1]?.id ?? "" } })); setSelectedCandidateId(id); }
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
  
   function addReportPhoto(tree) {
    if (!loggedCandidate) return;
    const capturedAt = new Date().toISOString();
    const draft = reportDrafts[loggedCandidate.id] ?? createReportDraft();
    const photos = draft[tree]?.photos ?? [];
    const photo = {
      id: `P-${photos.length + 1}`,
      caption: `${tree} candidate photo ${photos.length + 1}`,
      capturedAt,
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
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex flex-wrap items-center gap-2"><div className="rounded-2xl bg-slate-950 px-3 py-1 text-sm font-semibold text-white">VetBara</div><StatusPill tone="warn">MVP prototype</StatusPill><StatusPill><CloudOff className="mr-1 h-3.5 w-3.5" /> offline-first</StatusPill></div><h1 className="text-3xl font-bold tracking-tight md:text-5xl">Digital VETcert examination system</h1><p className="mt-2 max-w-3xl text-slate-600">Admin sets the exam, centre configures candidates and examiners, candidates and examiners log in by QR on tablets.</p></div><div className="flex flex-wrap gap-2">{lockedPortalRole ? <StatusPill tone="good">Dedicated {lockedPortalRole} portal</StatusPill> : ROLES.map((r) => <Button key={r} onClick={() => setRole(r)} variant={role === r ? "default" : "outline"} className="rounded-2xl">{r}</Button>)}</div></header>
    <Card className="mb-4 rounded-2xl shadow-sm"><CardContent className="p-5"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-medium text-slate-500">Current workspace</div><div className="text-2xl font-bold tracking-tight">{role}</div></div><div className="flex flex-wrap gap-2"><StatusPill>{status}</StatusPill><StatusPill>{summary.total} candidates</StatusPill><StatusPill>{summary.practicing} Practicing</StatusPill><StatusPill>{summary.consulting} Consulting</StatusPill></div></div></CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-3">
      {role === "Admin" && <AdminView centre={centre} setCentre={setCentre} examDate={examDate} setExamDate={setExamDate} place={place} setPlace={setPlace} language={language} setLanguage={setLanguage} setStatus={setStatus} addAudit={addAudit} setScannerMode={setScannerMode} centreQr={payload("Centre", centre, CENTRE_ACCESS_TOKEN)} />}
      {role === "Centre" && <CentreView centreUnlocked={centreUnlocked} centreCode={centreCode} setCentreCode={setCentreCode} unlockCentre={unlockCentre} enabledLevels={enabledLevels} toggleLevel={toggleLevel} language={language} availableVariants={availableVariants} variants={variants} setVariants={setVariants} importTestPackage={importTestPackage} testImportStatus={testImportStatus} testImportError={testImportError} testImportSummary={testImportSummary} candidates={candidates} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} addCandidate={addCandidate} updateCandidate={updateCandidate} assignments={assignments} setAssignments={setAssignments} examiners={examiners} candidateQrFor={(id) => payload("Candidate", id)} examinerQrFor={(id) => payload("Examiner", id)} centreSetupLoading={centreSetupLoading} centreSetupSaving={centreSetupSaving} centreSetupError={centreSetupError} centreSetupStatus={centreSetupStatus} centreAuditExportLoading={centreAuditExportLoading} centreAuditExportError={centreAuditExportError} centreQrAccess={centreQrAccess} centreValidationIssues={centreValidationIssues} dataMode={centreDataMode} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} handleLoadCentreSetup={handleLoadCentreSetup} handleSaveCentreSetup={handleSaveCentreSetup} handleDownloadCentreAuditPackage={handleDownloadCentreAuditPackage} updateExaminer={updateExaminer} addExaminer={addExaminer} />}
      {role === "Candidate" && <CandidateView candidates={candidates} loggedCandidate={loggedCandidate} confirmed={loggedCandidate ? candidateConfirmed[loggedCandidate.id] : false} loginCandidate={loginCandidate} logoutCandidate={() => setLoggedCandidateId(null)} confirmCandidate={confirmCandidate} sections={loggedCandidate ? CANDIDATE_SECTIONS[loggedCandidate.level] : []} sectionStatus={loggedCandidate ? candidateStatus[loggedCandidate.id] ?? createSectionStatus(loggedCandidate.level) : {}} sectionTimes={loggedCandidate ? candidateTimes[loggedCandidate.id] ?? {} : {}} sectionTone={sectionTone} openSection={openCandidateSection} activeSection={activeCandidateSection} setActiveSection={setActiveCandidateSection} testResponses={testResponses} updateTest={updateTest} submitTest={submitTest} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} submitReport={submitReport} variants={variants} testBank={testBank} qrFor={(id) => payload("Candidate", id)} setScannerMode={setScannerMode} />}
      {role === "Examiner" && <ExaminerView examiners={EXAMINERS} loggedExaminer={loggedExaminer} confirmed={loggedExaminer ? examinerConfirmed[loggedExaminer.id] : false} loginExaminer={loginExaminer} logoutExaminer={() => setLoggedExaminerId(null)} confirmExaminer={confirmExaminer} assignedCandidates={assignedCandidates} assignments={assignments} setPrimary={setPrimary} activePage={activeExaminerPage} setActivePage={setActiveExaminerPage} openOutdoor={openOutdoor} selectedCandidate={selectedCandidate} selectedMode={selectedMode} activeOutdoorSection={activeOutdoorSection} setActiveOutdoorSection={setActiveOutdoorSection} outdoor={outdoor} outdoorNotes={outdoorNotes} updateOutdoor={updateOutdoor} updateOutdoorNote={updateOutdoorNote} outdoorTotal={outdoorTotal} outdoorMax={outdoorMax} submitOutdoor={submitOutdoor} archivePlan={archivePlan} practicingArchive={practicingArchive} scoring={scoring} updateScore={updateScore} generateEvaluation={generateEvaluation} lastEvaluation={lastEvaluation} loadEvaluationPreview={loadEvaluationPreview} evaluationPreview={evaluationPreview} evaluationLoading={evaluationLoading} evaluationError={evaluationError} downloadDraftExport={downloadDraftExport} exportLoading={exportLoading} exportError={exportError} qrFor={(id) => payload("Examiner", id)} setScannerMode={setScannerMode} examinerTimes={loggedExaminer ? examinerTimes[loggedExaminer.id] ?? {} : {}} />}
      {(role === "Admin" || role === "Centre") && <AuditSyncView sync={sync} setSync={setSync} audit={audit} />}
    </div>
    {scannerMode && <QrScannerPanel title={`Scan ${scannerMode} QR`} onScan={handleQrScan} onClose={() => setScannerMode(null)} />}
  </div></main>;
}

function AdminView({ centre, setCentre, examDate, setExamDate, place, setPlace, language, setLanguage, setStatus, addAudit, setScannerMode, centreQr }) {
  return <><Card className="rounded-2xl shadow-sm lg:col-span-2"><CardContent className="p-5"><SectionTitle icon={ShieldCheck} title="Admin / Open exam event" subtitle="Admin sets centre, date, place and exam language, then sends centre access QR." /><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Certification centre<select value={centre} onChange={(e) => setCentre(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{CENTRES.map((x) => <option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">Exam language<select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2">{LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">Exam date<input value={examDate} onChange={(e) => setExamDate(e.target.value)} type="date" className="mt-1 w-full rounded-xl border bg-white p-2" /></label><label className="text-sm font-medium">Place<input value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label></div><div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="font-semibold">Centre access link / QR</h3><div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center"><RealQr value={centreQr} /><div><div className="break-all font-mono text-xs text-slate-500">{centreQr}</div><Button onClick={() => { setStatus("Opened for Centre"); addAudit("Centre access link sent", centre, CENTRE_ACCESS_TOKEN); }} className="mt-3 rounded-2xl">Send centre link / QR</Button><Button onClick={() => setScannerMode("Centre")} variant="outline" className="ml-2 mt-3 rounded-2xl">Scan centre QR</Button></div></div></div></CardContent></Card><Card className="rounded-2xl shadow-sm"><CardContent className="p-5"><SectionTitle icon={Languages} title="Admin / Multilingual layer" subtitle="UI translations are managed separately from exam content." /><div className="space-y-2 text-sm">{["exam.start", "exam.submit", "sync.offline", "evaluation.total"].map((key) => <div key={key} className="rounded-xl border bg-white p-3"><div className="font-mono text-xs text-slate-500">{key}</div><div>EN source + national terms</div><StatusPill tone="warn">needs review</StatusPill></div>)}</div><Button variant="outline" className="mt-4 w-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> Export translation XLSX</Button></CardContent></Card></>;
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

function examinerNameById(examiners, examinerId) {
  return examiners.find((examiner) => examiner.id === examinerId)?.name || examinerId || "-";
}

function PilotWorkflowDashboard({ candidates, assignments, examiners, centreValidationIssues, testImportSummary, candidateConfirmed, candidateStatus, candidateTimes, testResponses, reportDrafts, outdoor, centreSetupStatus, dataMode }) {
  const assignmentCount = candidates.reduce((total, candidate) => {
    const assignment = assignments[candidate.id] ?? {};
    return total + (assignment.primary ? 1 : 0) + (assignment.secondary ? 1 : 0);
  }, 0);
  const hasBackendState = dataMode === "backend";

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot workflow status</h3><p className="mt-1 text-sm text-slate-600">Pilot workflow status across setup, assignments, candidate sections, responses, report drafts and outdoor scoring.</p><p className="mt-1 text-xs text-slate-500">Use Audit/Sync panel to review sync status after smoke test.</p></div><div className="flex flex-wrap gap-2"><StatusPill tone={centreValidationIssues.length ? "warn" : "good"}>{centreValidationIssues.length} setup issue(s)</StatusPill><StatusPill>{candidates.length} candidates</StatusPill><StatusPill>{examiners.length} examiners</StatusPill><StatusPill>{assignmentCount} assignments</StatusPill><StatusPill tone={testImportSummary ? "good" : "warn"}>{testImportSummary ? "test package imported" : "no test package"}</StatusPill><StatusPill tone={hasBackendState ? "good" : "warn"}>{hasBackendState ? "Backend-loaded pilot data" : "Demo fallback data"}</StatusPill></div></div>{!hasBackendState && <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Demo fallback data is for testing only. Load Centre Setup to use the backend-backed pilot event; counts may reflect local/demo state until then.</div>}<div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-3">Candidate</th><th className="py-2 pr-3">Level</th><th className="py-2 pr-3">Primary examiner</th><th className="py-2 pr-3">Secondary examiner</th><th className="py-2 pr-3">Identity</th><th className="py-2 pr-3">Test</th><th className="py-2 pr-3">Report</th><th className="py-2 pr-3">Responses</th><th className="py-2 pr-3">Outdoor scores</th></tr></thead><tbody>{candidates.map((candidate) => { const assignment = assignments[candidate.id] ?? {}; const status = candidateStatus[candidate.id] ?? createSectionStatus(candidate.level); const times = candidateTimes[candidate.id] ?? {}; const reportDraft = reportDrafts[candidate.id] ?? {}; const responseCount = Object.keys(testResponses[candidate.id] ?? {}).length; const outdoorScoreCount = Object.values(outdoor[candidate.id] ?? {}).filter((value) => value !== "" && value !== null && value !== undefined).length; const reportPhotoCount = candidate.level === "Consulting" ? countReportPhotos(reportDraft) : 0; const reportSectionCount = candidate.level === "Consulting" ? countFilledReportSections(reportDraft) : 0; return <tr key={candidate.id} className="border-b align-top"><td className="py-2 pr-3"><div className="font-medium">{candidate.id}</div><div className="text-slate-600">{candidate.name}</div></td><td className="py-2 pr-3">{candidate.level}</td><td className="py-2 pr-3">{examinerNameById(examiners, assignment.primary)}</td><td className="py-2 pr-3">{examinerNameById(examiners, assignment.secondary)}</td><td className="py-2 pr-3"><StatusPill tone={candidateConfirmed[candidate.id] ? "good" : "default"}>{candidateConfirmed[candidate.id] ? "confirmed" : "not confirmed"}</StatusPill></td><td className="py-2 pr-3"><StatusPill tone={status.test === "closed" ? "good" : status.test === "open" ? "warn" : "default"}>{status.test ?? "locked"}</StatusPill><div className="mt-1 text-xs text-slate-500">Closed: {times.test?.closedAt || "-"}</div></td><td className="py-2 pr-3">{candidate.level === "Consulting" ? <><StatusPill tone={status.report === "closed" ? "good" : status.report === "open" ? "warn" : "default"}>{status.report ?? "locked"}</StatusPill><div className="mt-1 text-xs text-slate-500">{reportSectionCount} sections / {reportPhotoCount} photos</div></> : "-"}</td><td className="py-2 pr-3">{responseCount}</td><td className="py-2 pr-3">{outdoorScoreCount}</td></tr>; })}</tbody></table></div></div>;
}


function PilotSmokeTestChecklist() {
  const items = [
    "Load Centre Setup",
    "Confirm candidates and examiners are visible",
    "Import or verify test package",
    "Open Candidate QR and save a written test answer",
    "For Consulting candidate, save report draft and photo placeholder",
    "Open Examiner QR and save outdoor score and note",
    "Load Evaluation Preview",
    "Download Draft Export",
    "Download Centre Audit Package",
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot smoke-test checklist</h3><p className="mt-1 text-sm text-slate-600">Use this after each deploy to confirm the pilot workflow still works.</p></div><div className="flex flex-wrap gap-2"><StatusPill>Pilot</StatusPill><StatusPill>Manual</StatusPill></div></div><div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{items.map((item) => <div key={item} className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{item}</div>)}</div></div>;
}


function PilotReleaseNotesPanel() {
  const available = [
    "Centre setup save/load",
    "Candidate and Examiner QR workspaces",
    "CSV/JSON test package import",
    "sample CSV/JSON downloads",
    "Candidate written test persistence",
    "Consulting report draft persistence",
    "Examiner outdoor score and note persistence",
    "Evaluation preview",
    "Draft Export",
    "Centre Audit Package",
    "Pilot workflow dashboard and smoke-test checklist",
  ];

  const notIncluded = [
    "official VETcert final certificate/result",
    "final PASS/FAIL decision workflow",
    "official VETcert export template",
    "real image upload/storage",
    "full multilingual production translation review",
    "production-grade user management",
    "offline conflict resolution UI",
  ];

  return <div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Pilot release notes</h3><p className="mt-1 text-sm text-slate-600">This panel describes the pilot prototype scope. It is not the official VETcert certification output.</p></div><StatusPill>Pilot scope</StatusPill></div><div className="grid gap-4 lg:grid-cols-2"><div><h4 className="mb-2 text-sm font-semibold">Available in this pilot</h4><div className="space-y-2">{available.map((item) => <div key={item} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-700">{item}</div>)}</div></div><div><h4 className="mb-2 text-sm font-semibold">Not included yet</h4><div className="space-y-2">{notIncluded.map((item) => <div key={item} className="rounded-xl bg-amber-50 p-2 text-sm text-amber-950">{item}</div>)}</div></div></div></div>;
}

function CentreView({ centreUnlocked, centreCode, setCentreCode, unlockCentre, enabledLevels, toggleLevel, language, availableVariants, variants, setVariants, importTestPackage, testImportStatus, testImportError, testImportSummary, candidates, selectedCandidateId, setSelectedCandidateId, addCandidate, updateCandidate, assignments, setAssignments, examiners, candidateQrFor, examinerQrFor, centreSetupLoading, centreSetupSaving, centreSetupError, centreSetupStatus, centreAuditExportLoading, centreAuditExportError, centreQrAccess, centreValidationIssues, dataMode, candidateConfirmed, candidateStatus, candidateTimes, testResponses, reportDrafts, outdoor, handleLoadCentreSetup, handleSaveCentreSetup, handleDownloadCentreAuditPackage, updateExaminer, addExaminer }) {  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0]; const candidateQrUrl = (id) => centreQrAccess?.candidates?.find((item) => item.subjectId === id || item.subject_id === id)?.url; const examinerQrUrl = (id) => centreQrAccess?.examiners?.find((item) => item.subjectId === id || item.subject_id === id)?.url; return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5">{!centreUnlocked && <div className="mb-4 rounded-2xl border bg-white p-4"><SectionTitle icon={QrCodeIcon} title="Certification centre / Open delegated workspace" subtitle="Open workspace using QR/link received from Admin." /><div className="flex flex-col gap-3 md:flex-row"><input value={centreCode} onChange={(e) => setCentreCode(e.target.value)} placeholder="Paste centre token" className="w-full rounded-xl border bg-white p-2 font-mono text-sm" /><Button onClick={unlockCentre} className="rounded-2xl">Open centre workspace</Button></div><div className="mt-2 text-xs text-slate-500">Prototype token: {CENTRE_ACCESS_TOKEN}</div></div>}<div className={centreUnlocked ? "" : "pointer-events-none opacity-40"}><SectionTitle icon={Users} title="Centre / Configure levels, variants, candidates and examiners" subtitle="One exam can contain Practicing, Consulting or both. Each candidate has primary and secondary examiner." /><div className="mb-4 rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h3 className="font-semibold">Centre setup persistence</h3><p className="mt-1 text-sm text-slate-600">Load or save the current centre setup through the backend. Returned QR URLs are shown in the QR access pack below.</p></div><div className="flex flex-wrap gap-2"><Button onClick={handleLoadCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreSetupLoading ? "Loading..." : "Load Centre Setup"}</Button><Button onClick={handleSaveCentreSetup} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} className="rounded-2xl">{centreSetupSaving ? "Saving..." : "Save Centre Setup"}</Button><Button onClick={handleDownloadCentreAuditPackage} disabled={centreSetupLoading || centreSetupSaving || centreAuditExportLoading} variant="outline" className="rounded-2xl">{centreAuditExportLoading ? "Exporting..." : "Download Centre Audit Package (.xls)"}</Button></div></div>{centreSetupStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{centreSetupStatus}</div>}{centreSetupError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreSetupError}</div>}{centreAuditExportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{centreAuditExportError}</div>}<div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm"><div className="font-semibold">Centre setup checks</div>{centreValidationIssues.length === 0 ? <div className="mt-1 text-slate-600">No validation issues.</div> : <div className="mt-2 space-y-2">{centreValidationIssues.map((issue, index) => <div key={`${issue.severity}-${index}`} className={`rounded-lg border p-2 ${issue.severity === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}><span className="font-medium">{issue.severity === "error" ? "Error" : "Warning"}:</span> {issue.message}</div>)}</div>}</div></div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Centre data mode</h3><p className="mt-1 text-sm text-slate-600">{dataMode === "backend" ? "Backend-loaded pilot data is active for this Centre session." : "Demo fallback data is for testing only. Load Centre Setup to use the backend-backed pilot event."}</p><p className="mt-1 text-xs text-slate-500">Save Centre Setup after changing roster, examiners, assignments, or imported tests.</p></div><StatusPill tone={dataMode === "backend" ? "good" : "warn"}>{dataMode === "backend" ? "Backend-loaded pilot data" : "Demo fallback data"}</StatusPill></div></div><PilotWorkflowDashboard candidates={candidates} assignments={assignments} examiners={examiners} centreValidationIssues={centreValidationIssues} testImportSummary={testImportSummary} candidateConfirmed={candidateConfirmed} candidateStatus={candidateStatus} candidateTimes={candidateTimes} testResponses={testResponses} reportDrafts={reportDrafts} outdoor={outdoor} centreSetupStatus={centreSetupStatus} dataMode={dataMode} /><PilotSmokeTestChecklist /><PilotReleaseNotesPanel /><div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Levels</h3>{EXAM_LEVELS.map((level) => <label key={level} className="mb-3 flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={enabledLevels.includes(level)} onChange={() => toggleLevel(level)} /><span>{level}</span></label>)}</div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">Approved test variants</h3><p className="mt-1 text-sm text-slate-600">Import CSV or JSON package with real tests. The selected variant is then shown to candidates.</p></div><label className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">Import tests<input type="file" accept=".csv,.json,application/json,text/csv" onChange={importTestPackage} className="hidden" /></label></div><div className="mt-3 grid gap-3 md:grid-cols-2">{EXAM_LEVELS.map((level) => { const vars = availableVariants.filter((v) => v.level === level && v.language === language); return <label key={level} className="text-sm font-medium">{level}<select value={variants[level] ?? ""} onChange={(e) => setVariants((prev) => ({ ...prev, [level]: e.target.value }))} className="mt-1 w-full rounded-xl border bg-white p-2">{vars.length ? vars.map((v) => <option key={v.code} value={v.code}>{v.code}</option>) : <option value="">No imported variant</option>}</select></label>; })}</div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">CSV columns: variantCode, level, language, questionId, type, points, text, optionA, optionB, optionC, optionD, correctAnswer. JSON format: {`{ "variants": [...], "questions": { "VARIANT_CODE": [...] } }`}.</div>{testImportStatus && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{testImportStatus}</div>}{testImportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{testImportError}</div>}{testImportSummary && <div className="mt-2 text-xs text-slate-500">Imported summary: {testImportSummary.variants} variant(s), {testImportSummary.questions} question(s).</div>}</div></div><div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Candidate list</h3><Button onClick={addCandidate} variant="outline" className="rounded-2xl">Add candidate</Button></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">{candidates.map((c) => <button key={c.id} onClick={() => setSelectedCandidateId(c.id)} className={`rounded-2xl border p-3 text-left ${selectedCandidateId === c.id ? "border-slate-950 bg-slate-50" : "bg-white"}`}><div className="text-xs text-slate-500">{c.id}</div><div className="font-medium">{c.name}</div><StatusPill>{c.level}</StatusPill></button>)}</div></div>{selectedCandidate && <div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Candidate details</h3><div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-medium text-slate-500">Candidate ID<input value={selectedCandidate.id ?? ""} readOnly className="mt-1 w-full rounded-xl border bg-slate-100 p-2 text-sm text-slate-600" /></label><label className="text-xs font-medium text-slate-500">Name<input value={selectedCandidate.name ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { name: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">Level<select value={selectedCandidate.level ?? "Practicing"} onChange={(e) => updateCandidate(selectedCandidate.id, { level: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950"><option value="Practicing">Practicing</option><option value="Consulting">Consulting</option></select></label><label className="text-xs font-medium text-slate-500">Birth date<input value={selectedCandidate.birthDate ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { birthDate: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">Document ID<input value={selectedCandidate.documentId ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { documentId: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-500">Email<input value={selectedCandidate.email ?? ""} onChange={(e) => updateCandidate(selectedCandidate.id, { email: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label></div></div>}<div className="mt-4 rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">Examiner list</h3><Button onClick={addExaminer} variant="outline" className="rounded-2xl">Add examiner</Button></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{examiners.map((ex) => <div key={ex.id} className="rounded-2xl border bg-white p-3 text-sm"><label className="text-xs font-medium text-slate-500">ID<input value={ex.id ?? ""} onChange={(e) => updateExaminer(ex.id, { id: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">Name<input value={ex.name ?? ""} onChange={(e) => updateExaminer(ex.id, { name: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">Registration ID<input value={ex.registrationId ?? ""} onChange={(e) => updateExaminer(ex.id, { registrationId: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label><label className="mt-2 block text-xs font-medium text-slate-500">Email<input value={ex.email ?? ""} onChange={(e) => updateExaminer(ex.id, { email: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-2 text-sm text-slate-950" /></label></div>)}</div></div><div className="mt-4 rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Examiner assignments</h3><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2 pr-3">Candidate</th><th className="py-2 pr-3">Level</th><th className="py-2 pr-3">Primary examiner</th><th className="py-2 pr-3">Secondary examiner</th></tr></thead><tbody>{candidates.map((c) => <tr key={c.id} className="border-b"><td className="py-2 pr-3 font-medium">{c.name}</td><td className="py-2 pr-3">{c.level}</td>{["primary", "secondary"].map((slot) => <td key={slot} className="py-2 pr-3"><select value={assignments[c.id]?.[slot] ?? ""} onChange={(e) => setAssignments((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? {}), [slot]: e.target.value } }))} className="w-full rounded-xl border bg-white p-2">{examiners.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select></td>)}</tr>)}</tbody></table></div></div><div className="mt-4 rounded-2xl border bg-white p-4"><SectionTitle icon={QrCodeIcon} title="Centre / QR access pack" subtitle="Certification centre distributes these QR codes to the exact candidate or examiner tablet. Candidate and examiner portals no longer expose lists of other identities." /><div className="grid gap-4 lg:grid-cols-2"><div><h3 className="mb-3 font-semibold">Candidate QR codes</h3><div className="grid gap-3 md:grid-cols-2">{candidates.map((c) => <div key={c.id} className="rounded-2xl border bg-white p-3"><div className="flex gap-3"><RealQr value={candidateQrUrl(c.id) || candidateQrFor(c.id)} size={96} /><div className="min-w-0"><div className="font-semibold">{c.name}</div><div className="text-sm text-slate-600">{c.level}</div><div className="mt-2 break-all font-mono text-[10px] text-slate-500">{candidateQrUrl(c.id) || candidateQrFor(c.id)}</div>{candidateQrUrl(c.id) && <div className="mt-1 break-all text-[10px] text-emerald-700">Backend QR URL: {candidateQrUrl(c.id)}</div>}</div></div></div>)}</div></div><div><h3 className="mb-3 font-semibold">Examiner QR codes</h3><div className="grid gap-3 md:grid-cols-2">{examiners.map((ex) => <div key={ex.id} className="rounded-2xl border bg-white p-3"><div className="flex gap-3"><RealQr value={examinerQrUrl(ex.id) || examinerQrFor(ex.id)} size={96} /><div className="min-w-0"><div className="font-semibold">{ex.name}</div><div className="text-sm text-slate-600">{ex.registrationId}</div><div className="mt-2 break-all font-mono text-[10px] text-slate-500">{examinerQrUrl(ex.id) || examinerQrFor(ex.id)}</div>{examinerQrUrl(ex.id) && <div className="mt-1 break-all text-[10px] text-emerald-700">Backend QR URL: {examinerQrUrl(ex.id)}</div>}</div></div></div>)}</div></div></div></div></div></CardContent></Card>;
}
function CandidateView({ candidates, loggedCandidate, confirmed, loginCandidate, logoutCandidate, confirmCandidate, sections, sectionStatus, sectionTimes, sectionTone, openSection, activeSection, setActiveSection, testResponses, updateTest, submitTest, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, submitReport, variants, testBank, qrFor, setScannerMode }) {
  const selectedVariantCode = loggedCandidate ? variants[loggedCandidate.level] : "";

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={QrCodeIcon} title="Candidate / Tablet login and workspace" subtitle="Candidate opens only their own QR workspace, confirms identity, then completes each exam section." /><div className="grid gap-4 lg:grid-cols-3">{!loggedCandidate && <div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Candidate QR access</h3><Button onClick={() => setScannerMode("Candidate")} variant="outline" className="rounded-2xl">Scan QR</Button></div><p className="mt-3 text-sm text-slate-600">Scan the personal QR issued by the Centre. This portal only shows the current Candidate workspace.</p></div>}<div className={`rounded-2xl border bg-white p-4 ${loggedCandidate ? "lg:col-span-3" : "lg:col-span-2"}`}>{!loggedCandidate ? <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">No Candidate is logged in. Scan the personal Candidate QR issued by the Centre.</div> : <div className="grid gap-4"><div className="rounded-2xl bg-slate-100 p-4"><div className="flex flex-wrap gap-2"><StatusPill tone="good">Logged in</StatusPill><StatusPill>{loggedCandidate.level}</StatusPill><StatusPill>{selectedVariantCode}</StatusPill></div><div className="mt-2 font-semibold">{loggedCandidate.name}</div><Button onClick={logoutCandidate} variant="outline" className="mt-3 rounded-2xl">Logout</Button></div>{activeSection === "landing" && <CandidateLanding candidate={loggedCandidate} confirmed={confirmed} confirmCandidate={confirmCandidate} sections={sections} status={sectionStatus} times={sectionTimes} tone={sectionTone} openSection={openSection} />}{activeSection === "test" && <TestSection candidate={loggedCandidate} selectedVariantCode={selectedVariantCode} testBank={testBank} responses={testResponses[loggedCandidate.id] ?? {}} updateTest={updateTest} submitTest={submitTest} setActiveSection={setActiveSection} />}{activeSection === "report" && loggedCandidate.level === "Consulting" && <ReportSection candidate={loggedCandidate} reportDrafts={reportDrafts} activeReportTree={activeReportTree} setActiveReportTree={setActiveReportTree} updateReport={updateReport} addReportPhoto={addReportPhoto} submitReport={submitReport} />}</div>}</div></div></CardContent></Card>;
}
function CandidateLanding({ candidate, confirmed, confirmCandidate, sections, status, times, tone, openSection }) { return <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">Confirm personal details</h3>{[["Candidate name", candidate.name], ["Date of birth", candidate.birthDate], ["Document / registration ID", candidate.documentId], ["Exam level", candidate.level]].map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}<Button onClick={confirmCandidate} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? "Identity confirmed" : "Confirm identity"}</Button></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><h3 className="font-semibold">Candidate landing page</h3><div className="mt-4 grid gap-3 md:grid-cols-2">{sections.map((section) => <div key={section.key} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{section.title}</h4><p className="mt-1 text-sm text-slate-600">{section.description}</p></div><StatusPill tone={tone(status[section.key])}>{status[section.key]}</StatusPill></div><div className="mt-3 text-xs text-slate-500"><div>Opened: {times[section.key]?.openedAt || "-"}</div><div>Closed: {times[section.key]?.closedAt || "-"}</div></div><Button onClick={() => openSection(section.key)} disabled={!confirmed} className="mt-4 rounded-2xl">{status[section.key] === "closed" ? "Request reopen" : "Open section"}</Button></div>)}</div></div></div>; }
function TestSection({ candidate, selectedVariantCode, testBank, responses, updateTest, submitTest, setActiveSection }) {
  const selectedVariantQuestions = Array.isArray(testBank[selectedVariantCode]) ? testBank[selectedVariantCode] : [];
  const demoVariantCode = DEFAULT_TEST_BANK[selectedVariantCode]
    ? selectedVariantCode
    : TEST_VARIANTS.find((variant) => variant.level === candidate.level && DEFAULT_TEST_BANK[variant.code]?.length)?.code;
  const demoQuestions = demoVariantCode ? DEFAULT_TEST_BANK[demoVariantCode] ?? [] : [];
  const questions = selectedVariantQuestions.length > 0 ? selectedVariantQuestions : demoQuestions;

  return <div className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">Written test</h3><p className="text-sm text-slate-600">Variant: {selectedVariantCode}. Autosaved locally. Final submit closes this section.</p></div><Button onClick={() => setActiveSection("landing")} variant="outline" className="rounded-2xl">Back</Button></div><div className="mt-3 space-y-4">{questions.map((q, i) => <div key={q.id} className="rounded-xl border p-3"><div className="text-xs text-slate-500">Question {i + 1} / {q.points} point(s)</div><div className="mt-1 font-medium">{q.text}</div>{q.type === "single_choice" ? <div className="mt-2 space-y-2">{q.options.map((option) => <label key={option} className="flex gap-2 rounded-xl bg-slate-50 p-2 text-sm"><input type="radio" checked={responses[q.id] === option} onChange={() => updateTest(q.id, option)} /><span>{option}</span></label>)}</div> : <textarea value={responses[q.id] ?? ""} onChange={(e) => updateTest(q.id, e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border bg-white p-3 text-sm" placeholder="Write your answer here" />}</div>)}</div><Button onClick={submitTest} className="mt-4 rounded-2xl"><Lock className="mr-2 h-4 w-4" /> Submit and close written test</Button><p className="mt-2 text-xs text-slate-500">If offline, visible local work remains and sync will retry when session/backend is available.</p></div>;
}
function ReportSection({ candidate, reportDrafts, activeReportTree, setActiveReportTree, updateReport, addReportPhoto, submitReport }) { const draft = reportDrafts[candidate.id] ?? createReportDraft(); const tree = draft[activeReportTree]; return <div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">Consulting report - 2 trees</h3><div className="mt-3 flex gap-2">{REPORT_TREES.map((t) => <Button key={t} variant={activeReportTree === t ? "default" : "outline"} onClick={() => setActiveReportTree(t)} className="rounded-2xl">{t}</Button>)}</div><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">Photos: <strong>{tree.photos.length}</strong><Button onClick={() => addReportPhoto(activeReportTree)} variant="outline" className="mt-3 w-full rounded-2xl">Add photo</Button></div><textarea value={tree.fieldNotes} onChange={(e) => updateReport(activeReportTree, "fieldNotes", e.target.value, "fieldNotes")} placeholder="Field observations and rough notes..." className="mt-3 min-h-28 w-full rounded-xl border bg-white p-3 text-sm" /><div className="mt-3 grid gap-3 md:grid-cols-2">{REPORT_SECTIONS.map((sec) => <label key={sec.key} className="text-sm font-medium">{sec.title}<textarea value={tree.finalSections[sec.key] ?? ""} onChange={(e) => updateReport(activeReportTree, sec.key, e.target.value)} placeholder={`${activeReportTree}: ${sec.title}`} className="mt-1 min-h-20 w-full rounded-xl border bg-white p-3 text-sm" /></label>)}</div><Button onClick={submitReport} className="mt-4 rounded-2xl"><Lock className="mr-2 h-4 w-4" /> Submit and close report</Button><p className="mt-2 text-xs text-slate-500">If offline, visible local work remains and sync will retry when session/backend is available.</p></div>; }
function ExaminerView({ examiners, loggedExaminer, confirmed, loginExaminer, logoutExaminer, confirmExaminer, assignedCandidates, assignments, setPrimary, activePage, setActivePage, openOutdoor, selectedCandidate, selectedMode, activeOutdoorSection, setActiveOutdoorSection, outdoor, outdoorNotes, updateOutdoor, updateOutdoorNote, outdoorTotal, outdoorMax, submitOutdoor, archivePlan, practicingArchive, scoring, updateScore, generateEvaluation, lastEvaluation, loadEvaluationPreview, evaluationPreview, evaluationLoading, evaluationError, downloadDraftExport, exportLoading, exportError, qrFor, setScannerMode, examinerTimes }) { return <><Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={Tablet} title="Examiner / Landing page and Outdoor exercises" subtitle="Examiner logs in, confirms identity, sees assigned candidates and opens outdoor forms." /><div className="grid gap-4 lg:grid-cols-3">{!loggedExaminer && <div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Examiner QR access</h3><Button onClick={() => setScannerMode("Examiner")} variant="outline" className="rounded-2xl">Scan QR</Button></div><p className="mt-3 text-sm text-slate-600">Scan the personal Examiner QR issued by the Centre. This portal only shows assigned Candidate work.</p></div>}<div className={`rounded-2xl border bg-white p-4 ${loggedExaminer ? "lg:col-span-3" : "lg:col-span-2"}`}>{!loggedExaminer ? <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">No Examiner is logged in. Scan the personal Examiner QR issued by the Centre.</div> : activePage === "landing" ? <ExaminerLanding examiner={loggedExaminer} confirmed={confirmed} confirmExaminer={confirmExaminer} assignedCandidates={assignedCandidates} assignments={assignments} setPrimary={setPrimary} openOutdoor={openOutdoor} /> : <OutdoorForm selectedCandidate={selectedCandidate} selectedMode={selectedMode} activeOutdoorSection={activeOutdoorSection} setActiveOutdoorSection={setActiveOutdoorSection} outdoor={outdoor} outdoorNotes={outdoorNotes} updateOutdoor={updateOutdoor} updateOutdoorNote={updateOutdoorNote} outdoorTotal={outdoorTotal} outdoorMax={outdoorMax} submitOutdoor={submitOutdoor} archivePlan={archivePlan} practicingArchive={practicingArchive} setActivePage={setActivePage} time={examinerTimes[selectedCandidate.id]?.outdoor} />}</div></div></CardContent></Card><ScoringCard selectedCandidate={selectedCandidate} scoring={scoring} updateScore={updateScore} generateEvaluation={generateEvaluation} lastEvaluation={lastEvaluation} loadEvaluationPreview={loadEvaluationPreview} evaluationPreview={evaluationPreview} evaluationLoading={evaluationLoading} evaluationError={evaluationError} downloadDraftExport={downloadDraftExport} exportLoading={exportLoading} exportError={exportError} /></>; }
function ExaminerLanding({ examiner, confirmed, confirmExaminer, assignedCandidates, assignments, setPrimary, openOutdoor }) { return <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">Confirm examiner details</h3>{[["Name", examiner.name], ["Date of birth", examiner.birthDate], ["Registration ID", examiner.registrationId]].map(([k, v]) => <div key={k} className="mt-3 rounded-xl bg-slate-100 p-3 text-sm"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>)}<Button onClick={confirmExaminer} disabled={confirmed} className="mt-4 w-full rounded-2xl"><BadgeCheck className="mr-2 h-4 w-4" />{confirmed ? "Identity confirmed" : "Confirm identity"}</Button></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><h3 className="font-semibold">Assigned Candidate worklist</h3><p className="mt-1 text-sm text-slate-600">Primary Examiner must complete the full outdoor form. Secondary Examiner input is optional/supporting.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{assignedCandidates.map((c) => { const isPrimary = assignments[c.id]?.primary === examiner.id; return <div key={c.id} className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3"><div><div className="font-semibold">{c.name}</div><div className="text-sm text-slate-600">{c.level}</div></div><StatusPill tone={isPrimary ? "good" : "default"}>{isPrimary ? "primary" : "secondary"}</StatusPill></div><label className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm"><input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(c.id, examiner.id, e.target.checked)} />I am the primary examiner for this candidate</label><Button onClick={() => openOutdoor(c.id)} disabled={!confirmed} className="mt-4 rounded-2xl">Open Outdoor exercises</Button></div>; })}</div></div></div>; }
function OutdoorForm({ selectedCandidate, selectedMode, activeOutdoorSection, setActiveOutdoorSection, outdoor, outdoorNotes, updateOutdoor, updateOutdoorNote, outdoorTotal, outdoorMax, submitOutdoor, archivePlan, practicingArchive, setActivePage, time }) { const total = OUTDOOR_SECTIONS[selectedCandidate.level].reduce((sum, s) => sum + outdoorTotal(selectedCandidate.id, selectedCandidate.level, s), 0); return <div className="grid gap-4 lg:grid-cols-3"><div><Button onClick={() => setActivePage("landing")} variant="outline" className="mb-3 rounded-2xl">Back to landing</Button><h3 className="font-semibold">Candidate binding</h3><div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">Active record: <strong>{selectedCandidate.name}</strong><br />Level: <strong>{selectedCandidate.level}</strong><br />Outdoor total: <strong>{total}</strong> / {scoreLimits(selectedCandidate.level).outdoorMax}<br />Opened: {time?.openedAt || "-"}<br />Closed: {time?.closedAt || "-"}</div>{selectedCandidate.level === "Practicing" && <div className="mt-3 rounded-xl border bg-white p-3 text-sm"><div className="font-semibold">Paper management plan archive</div><p className="mt-1 text-slate-600">Candidate prepares this on paper. Examiner photographs it only for archive.</p><Button onClick={archivePlan} variant="outline" className="mt-3 w-full rounded-2xl">Photograph paper plan</Button><div className="mt-2 text-xs text-slate-500">Archived photos: {(practicingArchive[selectedCandidate.id] ?? []).length}</div></div>}<div className="mt-4 space-y-2">{OUTDOOR_SECTIONS[selectedCandidate.level].map((section) => <button key={section} onClick={() => setActiveOutdoorSection(section)} className={`w-full rounded-xl border p-3 text-left text-sm ${activeOutdoorSection === section ? "border-slate-950 bg-slate-50" : "bg-white hover:bg-slate-50"}`}><div className="font-medium">{OUTDOOR_TITLES[section]}</div><div className="text-xs text-slate-500">{outdoorTotal(selectedCandidate.id, selectedCandidate.level, section)} / {outdoorMax(selectedCandidate.level, section)} points</div></button>)}</div></div><div className="lg:col-span-2"><h3 className="font-semibold">Outdoor exercises detail form</h3><p className="mt-1 text-sm text-slate-600">Jump between sections freely. Each question includes Notes / marking guidance.</p><div className="mt-4 space-y-3">{(OUTDOOR_ITEMS[selectedCandidate.level]?.[activeOutdoorSection] ?? []).map((item) => <div key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="font-mono text-xs text-slate-500">{item.id}</div><div className="font-medium">{item.text}</div><div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><div className="mb-1 font-semibold">Notes / marking guidance</div><div>{item.notes}</div></div></div><label className="text-sm font-medium md:w-36">Points / {item.max}<input type="number" min="0" max={item.max} value={outdoor[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoor(item.id, e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label></div><textarea value={outdoorNotes[selectedCandidate.id]?.[item.id] ?? ""} onChange={(e) => updateOutdoorNote(item.id, e.target.value)} placeholder="Examiner notes / justification" className="mt-3 min-h-16 w-full rounded-xl border bg-white p-3 text-sm" /></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button onClick={submitOutdoor} disabled={selectedMode === "unassigned"} className="rounded-2xl"><Lock className="mr-2 h-4 w-4" /> Submit and close outdoor session</Button><StatusPill tone={selectedMode === "primary" ? "good" : "default"}>{selectedMode === "primary" ? "primary - full form required" : selectedMode === "secondary" ? "secondary - optional input" : "unassigned"}</StatusPill><StatusPill tone="warn">autosave to sync queue</StatusPill></div><p className="mt-2 text-xs text-slate-500">If offline, visible local work remains and sync will retry when session/backend is available.</p></div></div>; }
function EvaluationPreviewCard({ preview }) {
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
function ScoringCard({ selectedCandidate, scoring, updateScore, generateEvaluation, lastEvaluation, loadEvaluationPreview, evaluationPreview, evaluationLoading, evaluationError, downloadDraftExport, exportLoading, exportError }) { return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={BadgeCheck} title="Examiner / Candidate scoring and evaluation" subtitle="Scoring engine uses the candidate level." /><div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><div className="font-semibold">{selectedCandidate.name}</div><div className="mt-4 text-sm text-slate-600">Status: <StatusPill>{selectedCandidate.status}</StatusPill></div></div><div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-medium">Written / {scoring.writtenMax}<input type="number" value={selectedCandidate.written ?? ""} onChange={(e) => updateScore("written", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label><label className="text-sm font-medium">Outdoor / {scoring.outdoorMax}<input type="number" value={selectedCandidate.outdoor ?? ""} onChange={(e) => updateScore("outdoor", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>{selectedCandidate.level === "Consulting" && <label className="text-sm font-medium">Report / {scoring.reportMax}<input type="number" value={selectedCandidate.report ?? ""} onChange={(e) => updateScore("report", e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-2" /></label>}</div><div className="mt-4 grid gap-3 md:grid-cols-5"><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Total</div><div className="text-xl font-bold">{scoring.total} / {scoring.max}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Percentage</div><div className="text-xl font-bold">{scoring.percentage}%</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Result</div><div className="text-xl font-bold">{scoring.pass ? "PASS" : "NOT PASSED"}</div></div><Button onClick={generateEvaluation} className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> Generate Evaluation</Button><Button onClick={() => loadEvaluationPreview(selectedCandidate.id)} disabled={evaluationLoading} variant="outline" className="h-full rounded-2xl">{evaluationLoading ? "Loading..." : "Load Evaluation Preview"}</Button><Button onClick={() => downloadDraftExport(selectedCandidate.id)} disabled={exportLoading} variant="outline" className="h-full rounded-2xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> {exportLoading ? "Exporting..." : "Download Draft Export (.xls)"}</Button></div><p className="mt-3 text-xs text-slate-500">Draft Export only — not the official VETcert evaluation template.</p>{evaluationError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{evaluationError}</div>}{exportError && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{exportError}</div>}{lastEvaluation && <div className="mt-4 rounded-2xl border bg-white p-4 text-sm"><div className="font-semibold">Last generated evaluation</div><div className="mt-1 text-slate-600">{lastEvaluation.candidate} / {lastEvaluation.level}: {lastEvaluation.total}/{lastEvaluation.max} ({lastEvaluation.percentage}%) - {lastEvaluation.result}</div></div>}<EvaluationPreviewCard preview={evaluationPreview} /></div></div></CardContent></Card>; }
function AuditSyncView({ sync, setSync, audit }) {
  const syncStatusCounts = sync.reduce((counts, item) => {
    const status = String(item.status ?? "").toLowerCase();
    return {
      total: counts.total + 1,
      error: counts.error + (status.includes("error") ? 1 : 0),
      pending: counts.pending + (status.includes("queued") || status.includes("pending") || status.includes("ready") ? 1 : 0),
      synced: counts.synced + (status.includes("synced") || status.includes("saved") || status.includes("ok") ? 1 : 0),
    };
  }, { total: 0, error: 0, pending: 0, synced: 0 });

  return <Card className="rounded-2xl shadow-sm lg:col-span-3"><CardContent className="p-5"><SectionTitle icon={CloudOff} title="Audit trail and offline sync" subtitle="Sync queue shows local actions waiting for backend confirmation or already recorded during this session." /><div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-slate-600"><p>Failed sync does not erase visible local work on this tablet.</p><p className="mt-1">If sync errors persist, reopen the personal QR/session and retry the action.</p></div><div className="mb-4 grid gap-2 md:grid-cols-4"><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Total sync items</div><div className="font-semibold">{syncStatusCounts.total}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Pending / ready</div><div className="font-semibold">{syncStatusCounts.pending}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Synced / saved</div><div className="font-semibold">{syncStatusCounts.synced}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-xs text-slate-500">Sync errors</div><div className="font-semibold">{syncStatusCounts.error}</div></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Sync queue</h3><Button onClick={() => setSync((prev) => prev.map((x) => ({ ...x, status: "Synced" })))} variant="outline" className="rounded-2xl">Mark all synced</Button></div><div className="space-y-2 text-sm">{sync.slice(0, 6).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-100 p-3"><div><div className="font-medium">{item.type}</div><div className="text-xs text-slate-500">{item.detail ?? item.id}</div></div><StatusPill tone={String(item.status ?? "").toLowerCase().includes("error") ? "bad" : item.status === "Synced" ? "good" : "warn"}>{item.status}</StatusPill></div>)}</div></div><div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Audit log</h3><div className="max-h-72 space-y-2 overflow-auto text-sm">{audit.slice(0, 8).map((entry) => <div key={entry.id} className="rounded-xl border p-3"><div className="flex justify-between gap-3"><div className="font-medium">{entry.action}</div><div className="text-xs text-slate-500">{entry.time}</div></div><div className="text-slate-600">{entry.target}</div><div className="text-xs text-slate-500">{entry.detail}</div></div>)}</div></div></div></CardContent></Card>;
}
