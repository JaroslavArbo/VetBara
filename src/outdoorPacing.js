// Time budgeting and pacing for the Outdoor section.
//
// There are no fixed per-tree time slots, so a section's budget is DERIVED from what it is worth:
// the outdoor block from the schedule, split across sections in proportion to the marks available.
// A section worth 20 of 102 marks gets 20/102 of the block. That needs no data entry at all, and a
// Centre can still override any individual section afterwards.
//
// The same arithmetic exists server-side in api/_lib/outdoorpacing.mjs, which cannot import from
// src/. Keep the two in step - the pieces that matter are sectionBudgets() and pacingState().

export const OUTDOOR_BLOCK_MINUTES_DEFAULT = 120;

// Floor for a section that carries no marks, so it is never budgeted at zero.
const UNMARKED_SECTION_FLOOR_MINUTES = 10;

// Marks available per section, from the outdoor item bank for one level.
export function sectionMaxima(itemsBySection) {
  const out = {};
  for (const [section, items] of Object.entries(itemsBySection || {})) {
    out[section] = (items || []).reduce((sum, item) => sum + (Number(item?.max) || 0), 0);
  }
  return out;
}

// { sectionKey: minutes }. Overrides win; anything left is shared out by marks. Sections worth no
// marks get an equal share of a small remainder rather than zero, so a discussion-only section is
// still allotted something.
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

  // A section carrying no marks (a discussion, a walk-round) still takes time. Giving it zero would
  // make every minute spent there count as overrun and produce warnings the examiner cannot act on,
  // so it gets a small floor carved out before the weighted split.
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

// Turns a stream of section-focus timestamps into accumulated time per section. An examiner moves
// back and forth, so every visit to a section is added up, not just the first.
//
// focusEvents: [{ sectionKey, at }] in any order; endedAt closes the last one.
// A gap longer than idleGapMinutes with no switch is counted as idle, not as work: walking between
// trees is part of the exam, a lunch break is not, and blaming an examiner for the latter would
// make the whole measurement untrustworthy.
export function accumulateDwell(focusEvents, { endedAt, idleGapMinutes = 10 } = {}) {
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
      // Count the plausible working part, park the rest as idle.
      perSection[events[i].sectionKey] = (perSection[events[i].sectionKey] || 0) + idleGapMinutes;
      idleMinutes += minutes - idleGapMinutes;
    } else {
      perSection[events[i].sectionKey] = (perSection[events[i].sectionKey] || 0) + minutes;
    }
  }
  const totalMinutes = Object.values(perSection).reduce((sum, value) => sum + value, 0);
  return { perSection, idleMinutes, totalMinutes };
}

// How far behind the plan the examiner is RIGHT NOW, judged cumulatively: sections already finished
// plus the one in progress, against what those sections were budgeted. Judging section by section
// would nag somebody who overran one exercise and made it up in the next, which is not what
// "evidently falling behind" means.
export function pacingState({ budgets, order, currentSection, perSection, currentSectionElapsedMinutes = 0 }) {
  const sequence = (order || []).filter((section) => budgets?.[section] !== undefined);
  const index = sequence.indexOf(currentSection);
  if (index < 0) return { known: false, ratio: 0, level: "neutral", isLastSection: false };

  let expected = 0;
  let actual = 0;
  for (let i = 0; i < index; i += 1) {
    expected += budgets[sequence[i]] || 0;
    actual += perSection?.[sequence[i]] || 0;
  }
  expected += budgets[currentSection] || 0;
  actual += currentSectionElapsedMinutes;

  const isLastSection = index === sequence.length - 1;
  if (expected <= 0) return { known: false, ratio: 0, level: "neutral", isLastSection };

  const ratio = (actual - expected) / expected;
  // Never nag on the final section: there is nothing left to reallocate, and pressure at the finish
  // only adds stress.
  const level = isLastSection ? "neutral" : ratio > 0.15 ? "behind" : ratio > 0.05 ? "slipping" : "neutral";
  return { known: true, ratio, level, isLastSection, expectedMinutes: expected, actualMinutes: actual };
}
