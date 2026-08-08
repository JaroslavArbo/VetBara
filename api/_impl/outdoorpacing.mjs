// Server-side half of the Outdoor time-efficiency system. The arithmetic mirrors
// src/lib/outdoorPacing.js, which the browser uses for the live signal; this file exists because an
// api/ module cannot import from src/. Keep the two in step - budgets and dwell are the parts that
// must agree, or the Centre's report would contradict what the examiner saw in the field.

export const OUTDOOR_BLOCK_MINUTES_DEFAULT = 120;
const UNMARKED_SECTION_FLOOR_MINUTES = 10;
const IDLE_GAP_MINUTES = 10;

export function sectionMaxima(itemsBySection) {
  const out = {};
  for (const [section, items] of Object.entries(itemsBySection || {})) {
    out[section] = (items || []).reduce((sum, item) => sum + (Number(item?.max) || 0), 0);
  }
  return out;
}

export function sectionBudgets(itemsBySection, { blockMinutes = OUTDOOR_BLOCK_MINUTES_DEFAULT, overrides = {} } = {}) {
  const maxima = sectionMaxima(itemsBySection);
  const sections = Object.keys(maxima);
  if (!sections.length) return {};

  const budgets = {};
  let remaining = blockMinutes;
  const unset = [];
  for (const section of sections) {
    const override = Number(overrides?.[section]);
    if (Number.isFinite(override) && override > 0) { budgets[section] = override; remaining -= override; }
    else unset.push(section);
  }
  if (!unset.length) return budgets;
  if (remaining <= 0) { for (const section of unset) budgets[section] = 0; return budgets; }

  const zeroMark = unset.filter((section) => !(maxima[section] > 0));
  const marked = unset.filter((section) => maxima[section] > 0);
  const floorEach = Math.min(UNMARKED_SECTION_FLOOR_MINUTES, marked.length ? Math.floor(remaining / (unset.length * 2)) : Math.floor(remaining / unset.length));
  for (const section of zeroMark) { budgets[section] = Math.max(0, floorEach); remaining -= budgets[section]; }

  const totalMarks = marked.reduce((sum, section) => sum + (maxima[section] || 0), 0);
  for (const section of marked) {
    budgets[section] = totalMarks > 0
      ? Math.round((remaining * (maxima[section] || 0)) / totalMarks)
      : Math.round(remaining / marked.length);
  }
  return budgets;
}

export function accumulateDwell(focusEvents, { endedAt, idleGapMinutes = IDLE_GAP_MINUTES } = {}) {
  const events = (focusEvents || [])
    .filter((event) => event?.sectionKey && event?.at)
    .map((event) => ({ sectionKey: event.sectionKey, at: new Date(event.at).getTime() }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at);
  if (!events.length) return { perSection: {}, idleMinutes: 0, totalMinutes: 0 };

  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const perSection = {};
  let idleMinutes = 0;
  for (let i = 0; i < events.length; i += 1) {
    const from = events[i].at;
    const to = i + 1 < events.length ? events[i + 1].at : end;
    if (!Number.isFinite(to) || to <= from) continue;
    const minutes = (to - from) / 60000;
    if (minutes > idleGapMinutes) {
      perSection[events[i].sectionKey] = (perSection[events[i].sectionKey] || 0) + idleGapMinutes;
      idleMinutes += minutes - idleGapMinutes;
    } else {
      perSection[events[i].sectionKey] = (perSection[events[i].sectionKey] || 0) + minutes;
    }
  }
  return {
    perSection,
    idleMinutes,
    totalMinutes: Object.values(perSection).reduce((sum, value) => sum + value, 0),
  };
}

// One candidate's outdoor run: what each section was budgeted, what it actually took, and by how
// much it differs. `complete` distinguishes a finished assessment from one still in progress, so a
// report never presents a half-finished run as if the examiner had overrun.
export function buildCandidateTiming({ candidateId, examinerId, focusEvents, openedAt, submittedAt, budgets }) {
  const dwell = accumulateDwell(focusEvents, { endedAt: submittedAt });
  const sections = Object.keys(budgets || {});
  const rows = sections
    .filter((section) => (dwell.perSection[section] || 0) > 0 || (budgets[section] || 0) > 0)
    .map((section) => {
      const planned = Math.round(budgets[section] || 0);
      const actual = Math.round(dwell.perSection[section] || 0);
      return { section, plannedMinutes: planned, actualMinutes: actual, deltaMinutes: actual - planned };
    });
  const plannedTotal = rows.reduce((sum, row) => sum + row.plannedMinutes, 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actualMinutes, 0);
  return {
    candidateId,
    examinerId: examinerId || null,
    openedAt: openedAt || null,
    submittedAt: submittedAt || null,
    complete: Boolean(submittedAt),
    sections: rows,
    plannedMinutes: plannedTotal,
    actualMinutes: actualTotal,
    deltaMinutes: actualTotal - plannedTotal,
    // Ratio is what the Admin view ranks on; guard against a zero budget.
    deviationRatio: plannedTotal > 0 ? (actualTotal - plannedTotal) / plannedTotal : 0,
    idleMinutes: Math.round(dwell.idleMinutes),
    sectionsOverBudget: rows.filter((row) => row.deltaMinutes > 0).length,
    sectionCount: rows.length,
  };
}

// Per-examiner roll-up: the actual question - does this examiner keep to the time frame? Only
// COMPLETED runs are aggregated; an assessment still open would otherwise drag the average down
// simply because it has not finished yet.
export function aggregateByExaminer(timings) {
  const byExaminer = new Map();
  for (const timing of timings) {
    if (!timing.examinerId || !timing.complete) continue;
    if (!byExaminer.has(timing.examinerId)) {
      byExaminer.set(timing.examinerId, {
        examinerId: timing.examinerId, exams: 0, plannedMinutes: 0, actualMinutes: 0,
        sectionsOverBudget: 0, sectionCount: 0, ratios: [],
      });
    }
    const row = byExaminer.get(timing.examinerId);
    row.exams += 1;
    row.plannedMinutes += timing.plannedMinutes;
    row.actualMinutes += timing.actualMinutes;
    row.sectionsOverBudget += timing.sectionsOverBudget;
    row.sectionCount += timing.sectionCount;
    row.ratios.push(timing.deviationRatio);
  }
  return Array.from(byExaminer.values()).map((row) => {
    // Trend compares the most recent third with the earliest third, so "getting better" is visible
    // without needing a chart. Too few exams to say anything is reported as unknown rather than
    // guessed at - three data points cannot show a trend.
    let trend = "unknown";
    if (row.ratios.length >= 3) {
      const window = Math.max(1, Math.floor(row.ratios.length / 3));
      const earliest = row.ratios.slice(0, window).reduce((a, b) => a + b, 0) / window;
      const latest = row.ratios.slice(-window).reduce((a, b) => a + b, 0) / window;
      const shift = latest - earliest;
      trend = shift < -0.05 ? "improving" : shift > 0.05 ? "worsening" : "steady";
    }
    return {
      examinerId: row.examinerId,
      exams: row.exams,
      plannedMinutes: row.plannedMinutes,
      actualMinutes: row.actualMinutes,
      deviationRatio: row.plannedMinutes > 0 ? (row.actualMinutes - row.plannedMinutes) / row.plannedMinutes : 0,
      sectionsOverBudget: row.sectionsOverBudget,
      sectionCount: row.sectionCount,
      trend,
    };
  }).sort((a, b) => b.deviationRatio - a.deviationRatio);
}
