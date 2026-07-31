import JSZip from "jszip";

// Builds the two VETcert classification workbooks that close an exam, faithfully reproducing the
// structure of the official templates 01_PRACTICING_form_template_AJ.xlsx and
// 01_CONSULTING_form_template_AJ.xlsx: a Registration sheet (centre header + candidate roster and
// the prerequisite formula), a Final dashboard (pass/fail per part + a percentage block, both
// reading the candidate sheets), one marking sheet per candidate, and — for Consulting — one
// "Candidate N Man. plan." management-plan sheet per candidate feeding the marking sheet's Report
// column.
//
// Written by hand rather than with a spreadsheet library: the app already ships JSZip and an .xlsx
// is a zip of XML. Every total, percentage and pass/fail verdict is written as a FORMULA (not a
// number computed here) with exactly the cell references the templates use, so the workbook still
// recalculates if an examiner corrects a mark in it afterwards, and the cross-sheet contract
// (Final/Man.plan → marking sheet) stays intact.
//
// The examiner "Marks" input cells are filled positionally from the recorded results: the app's
// written questions in order, the outdoor questions in order, and the Consulting report scores per
// section per tree. Where the exam package holds fewer/more items than the official form, the
// extra template slots stay blank (an examiner can complete them) and any surplus is dropped.

// "Marks available" totals per part, from the templates' own cells (verified by summing the
// per-question arrays below).
export const EXAM_TOTALS = {
  Practicing: { written: 45, outside: 111, report: 0, exam: 156 },
  Consulting: { written: 97, outside: 58, report: 127, exam: 282 },
};
export const PART_PASS_RATE = 0.5;    // "min. rate per part 50 %"
export const OVERALL_PASS_RATE = 0.75; // "minimum pass rate is 75%"

// Per-question "Marks available" arrays, verbatim from the templates.
const PRAC_WRITTEN_B = [2, 1, 1, 1, 2, 1, 2, 2, 2, 1, 3, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3]; // C19:C42 (Section B, 24 q)
const PRAC_OUT_S1 = [1, 1, 3, 1, 1, 1, 1, 1, 4, 4, 2, 2, 2, 3, 2, 2]; // G7:G22
const PRAC_OUT_S2 = [10, 10, 2, 10, 10, 1];                            // G25:G30
const PRAC_OUT_S3 = [2, 2, 4];                                         // G33:G35
const PRAC_OUT_S4 = [10, 10];                                          // G38:G39
const PRAC_OUT_S5 = [4, 1, 2, 2];                                      // G42:G45

const CONS_WRITTEN = [2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 3, 2, 1, 1, 3, 3, 3, 2, 4, 1, 2, 2, 1, 4, 6, 2, 2, 8, 1, 1, 1, 3, 6, 3, 2, 3, 1, 1, 2, 2, 2, 3]; // C7:C48 (42 q)
const CONS_OUT_S1 = [1, 1, 3, 1, 1, 1, 1, 1, 1, 6, 6, 2]; // G7:G18
const CONS_OUT_S2 = [10, 10];                              // G21:G22
const CONS_OUT_S3 = [2, 1, 1, 1, 6, 2];                    // G25:G30
// Report parts 1..8, per-exam (Tree A + Tree B) marks available: K7:K14.
const CONS_REPORT_AVAIL = [10, 20, 20, 12, 12, 24, 20, 9];

// Consulting report sections in the marking order (matches the app's REPORT_MARKING_SECTIONS keys),
// used to pull per-tree scores out of readReportMarks() into the Man. plan sheet.
const REPORT_SECTION_KEYS = ["basic", "health", "structure", "values", "threats", "plan", "justification"];
const REPORT_SECTION_TITLES = [
  "Section 1 - Basic information regarding the trees",
  "Section 2 - Health and vitality of the tree",
  "Section 3 - Structural condition (biomechanics) of the tree",
  "Section 4 - Wildlife, historical, cultural or social values of the tree",
  "Section 5 - Threats to the tree",
  "Section 6 - Detailed work specification",
  "Section 7 - Appraisal of the work specification",
];
const REPORT_CLARITY_KEYS = ["spelling", "layout", "photographs"];
const REPORT_CLARITY_TITLES = ["Spelling and grammar", "Layout / formatting", "Use of photographs"];

// --- low-level xlsx (cell-map based) ------------------------------------------------------------

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));
}

function columnName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function columnNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function refParts(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: match[1], row: Number(match[2]), c: columnNumber(match[1]) };
}

// cell: a plain value (string/number), or { v } / { f }, optionally with a style index `s`.
function cellXml(reference, cell) {
  if (cell === null || cell === undefined || cell === "") return "";
  const style = cell && typeof cell === "object" && cell.s ? ` s="${cell.s}"` : "";
  if (typeof cell === "object" && cell.f) {
    return `<c r="${reference}"${style}><f>${escapeXml(cell.f)}</f></c>`;
  }
  const value = typeof cell === "object" ? cell.v : cell;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function makeSheet(name, widths = []) {
  return { name, widths, cells: {} };
}

function put(sheet, ref, cell) {
  if (cell === "" || cell === null || cell === undefined) return;
  sheet.cells[ref] = cell;
}

// Fill an ordered list of input-cell refs from a scores array; blanks/non-numbers are skipped so
// the template SUM formulas treat them as 0 (exactly as an unfilled paper form).
function fillMarks(sheet, refs, scores) {
  if (!Array.isArray(scores)) return;
  refs.forEach((ref, index) => {
    const value = scores[index];
    if (value === "" || value === null || value === undefined) return;
    const num = Number(value);
    if (Number.isFinite(num)) put(sheet, ref, num);
  });
}

function colRange(from, to, col) {
  const refs = [];
  for (let r = from; r <= to; r += 1) refs.push(`${col}${r}`);
  return refs;
}

function sheetXml(sheet) {
  const rowsMap = {};
  let maxRow = 1;
  let maxCol = 1;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const { row, c } = refParts(ref);
    (rowsMap[row] = rowsMap[row] || []).push({ ref, cell, c });
    if (row > maxRow) maxRow = row;
    if (c > maxCol) maxCol = c;
  }
  const cols = sheet.widths.length
    ? `<cols>${sheet.widths.map((width, index) => (width ? `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>` : "")).join("")}</cols>`
    : "";
  const body = Object.keys(rowsMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map((row) => {
      const cells = rowsMap[row].sort((a, b) => a.c - b.c).map(({ ref, cell }) => cellXml(ref, cell)).join("");
      return `<row r="${row}">${cells}</row>`;
    })
    .join("");
  const dimension = `A1:${columnName(maxCol)}${maxRow}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

// Style 1 = bold, 2 = bold on grey fill (section headers), 3 = percentage (0.0%).
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

async function buildWorkbook(sheets) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`);

  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  const xl = zip.folder("xl");
  xl.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`);
  xl.file("styles.xml", STYLES_XML);
  xl.folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  const worksheets = xl.folder("worksheets");
  sheets.forEach((sheet, index) => {
    worksheets.file(`sheet${index + 1}.xml`, sheetXml(sheet));
  });

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// styled-cell shorthands
const B = (value) => ({ v: value, s: 1 });
const H = (value) => ({ v: value, s: 2 });
const PCT = (formula) => ({ f: formula, s: 3 });
const F = (formula) => ({ f: formula });

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// --- shared header (rows 1-3, referencing Registration) -----------------------------------------

function putMarkingHeader(sheet, registrationRow) {
  put(sheet, "A1", F("Registration!A1"));
  put(sheet, "B1", F("Registration!B1"));
  put(sheet, "A2", F("Registration!A2"));
  put(sheet, "B2", F("Registration!B2"));
  put(sheet, "E2", F("Registration!C2"));
  put(sheet, "F2", F("Registration!D2"));
  put(sheet, "G2", F("Registration!E2"));
  put(sheet, "A3", F("Registration!A3"));
  put(sheet, "B3", F("Registration!B3"));
  put(sheet, "E3", F("Registration!C3"));
  put(sheet, "F3", F("Registration!D3"));
  put(sheet, "G3", F("Registration!E3"));
  put(sheet, "B4", F(`Registration!B${registrationRow}`));
  put(sheet, "C4", F(`Registration!C${registrationRow}`));
  put(sheet, "L1", B("NOTES:"));
  put(sheet, "L2", "Fill only the cells with white background");
  put(sheet, "L3", "* Check marks according your national questions");
}

// --- Practicing marking sheet -------------------------------------------------------------------

function practicingCandidateSheet(n, entry) {
  const sheet = makeSheet(`Candidate ${n}`, [28, 11, 15, 2, 32, 10, 15, 13]);
  putMarkingHeader(sheet, n + 4);

  // Written part (cols A/B/C)
  put(sheet, "A5", H("Written part"));
  put(sheet, "A6", H("Section A - multiplie choice"));
  put(sheet, "B6", H("Marks"));
  put(sheet, "C6", H("Marks available"));
  for (let i = 0; i < 10; i += 1) { put(sheet, `A${7 + i}`, `Q. No. ${i + 1}`); put(sheet, `C${7 + i}`, 1); }
  put(sheet, "A17", "Marks per section");
  put(sheet, "B17", F("SUM(B7:B16)"));
  put(sheet, "C17", F("SUM(C7:C16)"));
  put(sheet, "A18", H("Section B - written answer"));
  for (let i = 0; i < 24; i += 1) {
    const r = 19 + i;
    const label = i === 22 ? "Q. No. 23*" : i === 23 ? "Q. No. 24*" : `Q. No. ${i + 1}`;
    put(sheet, `A${r}`, label);
    put(sheet, `C${r}`, PRAC_WRITTEN_B[i]);
  }
  put(sheet, "A46", "Marks per section");
  put(sheet, "B46", F("SUM(B19:B42)"));
  put(sheet, "C46", F("SUM(C19:C42)"));
  put(sheet, "B47", B("Marks"));
  put(sheet, "C47", B("Percentage"));
  put(sheet, "A48", "Marks per written part");
  put(sheet, "B48", F("B46+B17"));
  put(sheet, "C48", PCT("B48/B49"));
  put(sheet, "A49", "Marks available per written part ");
  put(sheet, "B49", F("C46+C17"));
  put(sheet, "C49", "min. rate per part 50 % ");

  // Outside part (cols E/F/G, ratio helper in H)
  put(sheet, "E5", H("Outside part"));
  put(sheet, "E6", H("Section 1 - Generic oral questions"));
  put(sheet, "F6", H("Marks"));
  put(sheet, "G6", H("Marks available"));
  for (let i = 0; i < 16; i += 1) { put(sheet, `E${7 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${7 + i}`, PRAC_OUT_S1[i]); put(sheet, `H${7 + i}`, F(`F${7 + i}/G${7 + i}`)); }
  put(sheet, "E23", "Marks per section");
  put(sheet, "F23", F("SUM(F7:F22)"));
  put(sheet, "G23", F("SUM(G7:G22)"));
  put(sheet, "E24", H("Section 2 - Excercise 1 Pre-Work A."));
  for (let i = 0; i < 6; i += 1) { put(sheet, `E${25 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${25 + i}`, PRAC_OUT_S2[i]); }
  put(sheet, "E31", "Marks per section");
  put(sheet, "F31", F("SUM(F25:F30)"));
  put(sheet, "G31", F("SUM(G25:G30)"));
  put(sheet, "E32", H("Section 2 - Excercise 2 Threats"));
  for (let i = 0; i < 3; i += 1) { put(sheet, `E${33 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${33 + i}`, PRAC_OUT_S3[i]); }
  put(sheet, "E36", "Marks per section");
  put(sheet, "F36", F("SUM(F33:F35)"));
  put(sheet, "G36", F("SUM(G33:G35)"));
  put(sheet, "E37", H("Section 2 - Excercise 3 History"));
  for (let i = 0; i < 2; i += 1) { put(sheet, `E${38 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${38 + i}`, PRAC_OUT_S4[i]); }
  put(sheet, "E40", "Marks per section");
  put(sheet, "F40", F("SUM(F38:F39)"));
  put(sheet, "G40", F("SUM(G38:G39)"));
  put(sheet, "E41", H("Section 2 - Excercise 4 Risk"));
  for (let i = 0; i < 4; i += 1) { put(sheet, `E${42 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${42 + i}`, PRAC_OUT_S5[i]); }
  put(sheet, "E46", "Marks per section");
  put(sheet, "F46", F("SUM(F42:F45)"));
  put(sheet, "G46", F("SUM(G42:G45)"));
  put(sheet, "F47", B("Marks"));
  put(sheet, "G47", B("Percentage"));
  put(sheet, "E48", "Marks per outside part");
  put(sheet, "F48", F("F46+F40+F36+F31+F23"));
  put(sheet, "G48", PCT("F48/F49"));
  put(sheet, "E49", "Marks available per outside part ");
  put(sheet, "F49", F("G46+G40+G36+G31+G23"));
  put(sheet, "G49", "min. rate per part 50 %  ");

  // Overall / verdicts
  put(sheet, "F50", B("Marks"));
  put(sheet, "G50", B("Percentage"));
  put(sheet, "A51", H("Overal mark"));
  put(sheet, "B51", "minimum pass rate is 75% ");
  put(sheet, "F51", F("B48+F48"));
  put(sheet, "G51", PCT("F51/F52"));
  put(sheet, "A52", "Marks available per exam");
  put(sheet, "F52", F("B49+F49"));
  put(sheet, "A53", H("Exam successfully completed"));
  put(sheet, "G53", F('IF(AND(G51>=0.75,C48>0.5,G48>0.5),"YES","NO")'));
  put(sheet, "A55", "Written part complied ");
  put(sheet, "C55", F('IF(C48>0.5,"YES","NO")'));
  put(sheet, "E55", "Outside part complied");
  put(sheet, "G55", F('IF(G48>0.5,"YES","NO")'));
  put(sheet, "A59", "Examiners confirm the above assessment of all sections of the VETcert - Practicing level.");
  put(sheet, "G62", "Examiner 1");
  put(sheet, "G65", "Examiner 2");

  fillMarks(sheet, [...colRange(7, 16, "B"), ...colRange(19, 42, "B")], entry.written);
  fillMarks(sheet, [...colRange(7, 22, "F"), ...colRange(25, 30, "F"), ...colRange(33, 35, "F"), ...colRange(38, 39, "F"), ...colRange(42, 45, "F")], entry.outside);
  return sheet;
}

// --- Consulting marking sheet -------------------------------------------------------------------

function consultingCandidateSheet(n, entry) {
  const sheet = makeSheet(`Candidate ${n}`, [20, 21, 15, 2, 24, 9, 14, 2, 20, 8, 16]);
  putMarkingHeader(sheet, n + 4);
  const planSheet = `'Candidate ${n} Man. plan.'`;

  // Written part (cols A/B/C) — 42 questions
  put(sheet, "A5", H("Written part"));
  put(sheet, "B5", H("Marks"));
  put(sheet, "C5", H("Marks available"));
  for (let i = 0; i < 42; i += 1) {
    const r = 7 + i;
    const label = i === 40 ? "Q. No. 41*" : i === 41 ? "Q. No. 42*" : `Q. No. ${i + 1}`;
    put(sheet, `A${r}`, label);
    put(sheet, `C${r}`, CONS_WRITTEN[i]);
  }
  put(sheet, "A49", "Marks per section");
  put(sheet, "B49", F("SUM(B7:B48)"));
  put(sheet, "C49", F("SUM(C7:C48)"));

  // Outside part (cols E/F/G)
  put(sheet, "E5", H("Outside part"));
  put(sheet, "F5", H("Marks"));
  put(sheet, "G5", H("Marks available"));
  put(sheet, "E6", H("Section 1 - Generic oral questions"));
  for (let i = 0; i < 12; i += 1) { put(sheet, `E${7 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${7 + i}`, CONS_OUT_S1[i]); }
  put(sheet, "E19", "Marks per section");
  put(sheet, "F19", F("SUM(F7:F18)"));
  put(sheet, "G19", F("SUM(G7:G18)"));
  put(sheet, "E20", H("Section 2 - Excercise 2 History"));
  for (let i = 0; i < 2; i += 1) { put(sheet, `E${21 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${21 + i}`, CONS_OUT_S2[i]); }
  put(sheet, "E23", "Marks per section");
  put(sheet, "F23", F("SUM(F21:F22)"));
  put(sheet, "G23", F("SUM(G21:G22)"));
  put(sheet, "E24", H("Section 3 - Excercise 3 Risk"));
  for (let i = 0; i < 6; i += 1) { put(sheet, `E${25 + i}`, `Q. No. ${i + 1}`); put(sheet, `G${25 + i}`, CONS_OUT_S3[i]); }
  put(sheet, "E31", "Marks per section");
  put(sheet, "F31", F("SUM(F25:F30)"));
  put(sheet, "G31", F("SUM(G25:G30)"));

  // Management Report (cols I/J/K) — J auto-filled from the Man. plan sheet roll-up
  put(sheet, "I5", H("Management Report"));
  put(sheet, "J5", H("Marks**"));
  put(sheet, "K5", H("Marks available"));
  for (let i = 0; i < 8; i += 1) {
    put(sheet, `I${7 + i}`, `Part ${i + 1}`);
    put(sheet, `J${7 + i}`, F(`${planSheet}!B${112 + i}`));
    put(sheet, `K${7 + i}`, CONS_REPORT_AVAIL[i]);
  }

  // Totals / percentages / verdicts
  put(sheet, "B50", B("Marks")); put(sheet, "C50", B("Percentage"));
  put(sheet, "F50", B("Marks")); put(sheet, "G50", B("Percentage"));
  put(sheet, "J50", B("Marks")); put(sheet, "K50", B("Percentage"));
  put(sheet, "A51", "Marks per written part"); put(sheet, "B51", F("B49")); put(sheet, "C51", PCT("B51/B52"));
  put(sheet, "E51", "Marks per outside part"); put(sheet, "F51", F("F31+F23+F19")); put(sheet, "G51", PCT("F51/F52"));
  put(sheet, "I51", "Marks per report"); put(sheet, "J51", F("SUM(J7:J14)")); put(sheet, "K51", PCT("J51/J52"));
  put(sheet, "A52", "Marks available per written part "); put(sheet, "B52", F("SUM(C7:C48)")); put(sheet, "C52", "min. rate per part 50 % ");
  put(sheet, "E52", "Marks available per outside part "); put(sheet, "F52", F("G19+G23+G31")); put(sheet, "G52", "min. rate per part 50 % ");
  put(sheet, "I52", "Marks available per report "); put(sheet, "J52", F("SUM(K7:K14)")); put(sheet, "K52", "min. rate per part 50 % ");
  put(sheet, "J53", B("Marks")); put(sheet, "K53", B("Percentage"));
  put(sheet, "A54", H("Overal mark")); put(sheet, "B54", "minimum pass rate is 75% "); put(sheet, "J54", F("B51+F51+J51")); put(sheet, "K54", PCT("J54/J55"));
  put(sheet, "A55", "Marks available per exam"); put(sheet, "J55", F("B52+F52+J52"));
  put(sheet, "A56", H("Exam successfully completed")); put(sheet, "K56", F('IF(AND(K54>0.75,C51>0.5,G51>0.5,K51>0.5),"yes","no")'));
  put(sheet, "A58", "Written part complied "); put(sheet, "C58", F('IF(C51>0.5,"yes","no")'));
  put(sheet, "E58", "Outside part complied"); put(sheet, "G58", F('IF(G51>0.5,"yes","no")'));
  put(sheet, "I58", "Repoort complied"); put(sheet, "K58", F('IF(K51>0.5,"yes","no")'));
  put(sheet, "A60", "Examiners confirm the above assessment of all sections of the VETcert - Consulting level .");
  put(sheet, "K64", "Examiner 1");
  put(sheet, "K67", "Examiner 2");

  fillMarks(sheet, colRange(7, 48, "B"), entry.written);
  fillMarks(sheet, [...colRange(7, 18, "F"), ...colRange(21, 22, "F"), ...colRange(25, 30, "F")], entry.outside);
  return sheet;
}

// Consulting "Candidate N Man. plan." sheet. The official template scores the report per item per
// tree; the app records one score per section per tree, so this compact sheet carries the section
// scores (Tree A / Tree B) and reproduces the roll-up block at rows 110-122 exactly where the
// marking sheet's Report column reads it (B112:B119).
function consultingManPlanSheet(n, entry) {
  const sheet = makeSheet(`Candidate ${n} Man. plan.`, [56, 11, 11, 22]);
  const r = n + 4;
  put(sheet, "B1", F(`Registration!B${r}`));
  put(sheet, "C1", F(`Registration!C${r}`));
  put(sheet, "F1", B("NOTES:"));
  put(sheet, "F2", "Fill only the cells with white background");

  put(sheet, "A3", H("Veteran tree management plan - marking summary"));
  put(sheet, "A5", H("Section"));
  put(sheet, "B5", H("Tree A"));
  put(sheet, "C5", H("Tree B"));
  put(sheet, "D5", H("Marks available per tree"));
  const perTreeMax = [5, 10, 10, 6, 6, 12, 10];
  const report = entry.report || {};
  const treeA = report["Tree A"] || {};
  const treeB = report["Tree B"] || {};
  const num = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : ""; };
  REPORT_SECTION_KEYS.forEach((key, i) => {
    const row = 6 + i;
    put(sheet, `A${row}`, REPORT_SECTION_TITLES[i]);
    put(sheet, `B${row}`, num(treeA?.[key]?.score));
    put(sheet, `C${row}`, num(treeB?.[key]?.score));
    put(sheet, `D${row}`, perTreeMax[i]);
  });
  put(sheet, "A13", H("Overall clarity of the management plan (whole plan)"));
  const clarity = report.clarity || {};
  REPORT_CLARITY_KEYS.forEach((key, i) => {
    const row = 14 + i;
    put(sheet, `A${row}`, REPORT_CLARITY_TITLES[i]);
    put(sheet, `B${row}`, num(clarity?.[key]));
    put(sheet, `D${row}`, 3);
  });

  // Roll-up (rows 110-122) — the contract the marking sheet's J7:J14 reads (B112:B119).
  put(sheet, "A110", H("Overall score"));
  put(sheet, "A111", H("Section"));
  put(sheet, "B111", H("Total"));
  put(sheet, "C111", H("Marks available"));
  const rollup = [
    ["Section 1 - Basic information regarding the trees", "B6+C6", 10],
    ["Section 2 - Health and vitality of the tree", "B7+C7", 20],
    ["Section 3 - Structural condition (biomechanics) of the tree", "B8+C8", 20],
    ["Section 4 - Wildlife, historical, cultural or social values of the tree", "B9+C9", 12],
    ["Section 5 - Threats to the tree", "B10+C10", 12],
    ["Section 6 - Detailed work specification", "B11+C11", 24],
    ["Section 7 - Appraisal of the work specification", "B12+C12", 20],
    ["Overall clarity of management plan ", "B14+B15+B16", 9],
  ];
  rollup.forEach(([title, formula, avail], i) => {
    const row = 112 + i;
    put(sheet, `A${row}`, title);
    put(sheet, `B${row}`, F(formula));
    put(sheet, `C${row}`, avail);
  });
  put(sheet, "A120", "Management grand total");
  put(sheet, "B120", F("SUM(B112:B119)"));
  put(sheet, "C120", F("SUM(C112:C119)"));
  put(sheet, "A121", "Percentage");
  put(sheet, "B121", PCT("B120/C120"));
  put(sheet, "A122", "Report complied");
  put(sheet, "B122", F('IF(B121>0.5,"yes","no")'));
  return sheet;
}

// --- Registration + Final -----------------------------------------------------------------------

function registrationSheet(level, meta, examiners, candidates) {
  const consulting = level === "Consulting";
  const sheet = makeSheet(
    "Registration",
    consulting ? [16, 18, 18, 26, 12, 14, 14, 20, 26, 24, 14, 14, 14, 14, 12, 8] : [16, 18, 18, 26, 12, 14, 14, 18, 26, 12, 12, 12, 12, 12, 14, 12, 12, 16, 12],
  );
  put(sheet, "A1", "Examination centre: ");
  put(sheet, "B1", meta.centre || "");
  put(sheet, "D1", B("Name"));
  put(sheet, "E1", B("Surname"));
  put(sheet, "A2", "Exam date:");
  put(sheet, "B2", meta.examDate || "");
  put(sheet, "C2", "Examiner 1:");
  put(sheet, "D2", examiners[0]?.first || "");
  put(sheet, "E2", examiners[0]?.last || "");
  put(sheet, "A3", "Exam place:");
  put(sheet, "B3", meta.place || "");
  put(sheet, "C3", "Examiner 2: ");
  put(sheet, "D3", examiners[1]?.first || "");
  put(sheet, "E3", examiners[1]?.last || "");

  const header = consulting
    ? ["Candidate No.", "Name*", "Surname*", "Email*", "Gender m/f*", "Date of Birth*", "Nationality*", "Agree to be published*", "Countries for list name and data*", "Route 1: if you are ETT provide EAC ID number ", "Route 1: if you are NOT ETT provide the name of relevant qualification/certification", "Copy of ETT/Relevant qualification/certification**", "Declaration of honour**", "References**", "Invoice paid**", "Prerequisities", "Notes"]
    : ["Candidate No.", "Name*", "Surname*", "Email*", "Gender m/f*", "Date of Birth*", "Nationality*", "Agree to be published*", "Countries for list name and data*", "ID NUMBER*", "ETW certificate**", "ChainSaw**", "Work at heights**", "Work with platform**", "Declaration on honour**", "References**", "Invoice payed**", "Prerequisities***", "Notes"];
  header.forEach((title, i) => put(sheet, `${columnName(i + 1)}4`, H(title)));

  candidates.forEach((entry, index) => {
    const row = index + 5;
    const { first, last } = splitName(entry.candidate?.name);
    const ok = entry.prerequisites ? "yes" : "no";
    put(sheet, `A${row}`, index + 1);
    put(sheet, `B${row}`, first);
    put(sheet, `C${row}`, last);
    put(sheet, `D${row}`, entry.candidate?.email || "");
    put(sheet, `E${row}`, entry.candidate?.gender || "");
    put(sheet, `F${row}`, entry.candidate?.birthDate || "");
    put(sheet, `G${row}`, entry.candidate?.nationality || "");
    if (consulting) {
      // Prereq = AND(L,M,N,O) all "yes".
      put(sheet, `L${row}`, ok);
      put(sheet, `M${row}`, ok);
      put(sheet, `N${row}`, ok);
      put(sheet, `O${row}`, ok);
      put(sheet, `P${row}`, F(`IF(AND(L${row}="yes",M${row}="yes",N${row}="yes",O${row}="yes"),"yes","no")`));
    } else {
      // Prereq = AND(K,L,M,O,P,Q) all "yes" (platform column N is deliberately excluded).
      put(sheet, `K${row}`, ok);
      put(sheet, `L${row}`, ok);
      put(sheet, `M${row}`, ok);
      put(sheet, `O${row}`, ok);
      put(sheet, `P${row}`, ok);
      put(sheet, `Q${row}`, ok);
      put(sheet, `R${row}`, F(`IF(AND(K${row}="yes",L${row}="yes",M${row}="yes",O${row}="yes",P${row}="yes",Q${row}="yes"),"yes","no")`));
    }
  });

  const notesRow = candidates.length + 6;
  put(sheet, `A${notesRow}`, B("NOTES:"));
  put(sheet, `A${notesRow + 1}`, "Fill only the cells with white background");
  put(sheet, `A${notesRow + 2}`, "** Write yes/no and cell will be cloured green/red");
  return sheet;
}

function finalSheet(level, candidates) {
  const consulting = level === "Consulting";
  const sheet = makeSheet("Final", consulting ? [16, 18, 18, 18, 16, 16, 16, 14] : [16, 18, 18, 20, 16, 16, 14]);
  // Header echo
  put(sheet, "A1", F("Registration!A1"));
  put(sheet, "B1", F("Registration!B1"));
  put(sheet, "A2", F("Registration!A2"));
  put(sheet, "B2", F("Registration!B2"));
  put(sheet, "C2", F("Registration!C2"));
  put(sheet, "D2", F("Registration!D2"));
  put(sheet, "E2", F("Registration!E2"));
  put(sheet, "A3", F("Registration!A3"));
  put(sheet, "B3", F("Registration!B3"));
  put(sheet, "C3", F("Registration!C3"));
  put(sheet, "D3", F("Registration!D3"));
  put(sheet, "E3", F("Registration!E3"));

  const prereqCol = consulting ? "P" : "R";
  const header = consulting
    ? ["Candidate No.", "Name*", "Surname*", "Prerequisities", "Written part", "Outside part", "Report", "Overall "]
    : ["Candidate No.", "Name*", "Surname*", "Prerequisities***", "Written Part", "Outside Part", "Overall "];

  // Table 1: verdicts
  header.forEach((title, i) => put(sheet, `${columnName(i + 1)}4`, H(title)));
  candidates.forEach((entry, index) => {
    const row = index + 5;
    const regRow = index + 5;
    const marking = `'Candidate ${index + 1}'`;
    put(sheet, `A${row}`, F(`Registration!A${regRow}`));
    put(sheet, `B${row}`, F(`Registration!B${regRow}`));
    put(sheet, `C${row}`, F(`Registration!C${regRow}`));
    put(sheet, `D${row}`, F(`Registration!${prereqCol}${regRow}`));
    if (consulting) {
      put(sheet, `E${row}`, F(`${marking}!C58`));
      put(sheet, `F${row}`, F(`${marking}!G58`));
      put(sheet, `G${row}`, F(`${marking}!K58`));
      put(sheet, `H${row}`, F(`${marking}!K56`));
    } else {
      put(sheet, `E${row}`, F(`${marking}!C55`));
      put(sheet, `F${row}`, F(`${marking}!G55`));
      put(sheet, `G${row}`, F(`${marking}!G53`));
    }
  });

  // Table 2: percentages
  const pctHeaderRow = candidates.length + 7;
  put(sheet, `A${pctHeaderRow - 1}`, B("PERTCENTAGE"));
  header.forEach((title, i) => put(sheet, `${columnName(i + 1)}${pctHeaderRow}`, H(title)));
  candidates.forEach((entry, index) => {
    const row = pctHeaderRow + 1 + index;
    const regRow = index + 5;
    const marking = `'Candidate ${index + 1}'`;
    put(sheet, `A${row}`, F(`Registration!A${regRow}`));
    put(sheet, `B${row}`, F(`Registration!B${regRow}`));
    put(sheet, `C${row}`, F(`Registration!C${regRow}`));
    put(sheet, `D${row}`, F(`Registration!${prereqCol}${regRow}`));
    if (consulting) {
      put(sheet, `E${row}`, PCT(`${marking}!C51`));
      put(sheet, `F${row}`, PCT(`${marking}!G51`));
      put(sheet, `G${row}`, PCT(`${marking}!K51`));
      put(sheet, `H${row}`, PCT(`${marking}!K54`));
    } else {
      put(sheet, `E${row}`, PCT(`${marking}!C48`));
      put(sheet, `F${row}`, PCT(`${marking}!G48`));
      put(sheet, `G${row}`, PCT(`${marking}!G51`));
    }
  });
  return sheet;
}

// --- public API ---------------------------------------------------------------------------------

// `candidates` entries: { candidate: { name, email, gender, birthDate, nationality },
//   prerequisites: boolean, written: number[], outside: number[],
//   report: { "Tree A": { sectionKey: { score } }, "Tree B": {...}, clarity: { itemKey: score } } }.
// `meta`: { centre, examDate, place }. `examiners`: [{ first, last }].
export function buildExamWorkbookSheets({ level, meta, examiners = [], candidates = [] }) {
  const sheets = [registrationSheet(level, meta, examiners, candidates), finalSheet(level, candidates)];
  candidates.forEach((entry, index) => {
    if (level === "Consulting") {
      sheets.push(consultingCandidateSheet(index + 1, entry));
      sheets.push(consultingManPlanSheet(index + 1, entry));
    } else {
      sheets.push(practicingCandidateSheet(index + 1, entry));
    }
  });
  return sheets;
}

export async function buildExamWorkbook(options) {
  return buildWorkbook(buildExamWorkbookSheets(options));
}
