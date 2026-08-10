// Candidate ids are NOT globally unique in this system, and that has caused real bugs.
//
// A Centre numbers its candidates C-001, C-002, ... and those numbers are printed on exam papers, so
// they are deliberately human-scale and repeat across certifications. The same id therefore names
// different people in different exams - and not even at the same level: C-001 has been Practicing in
// one certification and Consulting in another. Any lookup keyed by the id alone silently picks
// whichever row the database returned last, which is how the outdoor time report ended up computing
// budgets from the wrong level entirely.
//
// This module is the ONE place that resolution happens, so it does not get reinvented (differently,
// and wrongly) in each reader. Re-keying every table to globally unique ids would be a much larger
// migration and would change the numbers people read off printed papers, so the ids stay as they are
// and the lookups are made exact instead.

// rows: candidates as stored - { id, level, centre_id, exam_event_id }
export function buildCandidateScope(rows) {
  const byIdAndEvent = new Map();
  const byIdAndCentre = new Map();
  const rowsById = new Map();

  for (const row of rows || []) {
    if (!row?.id) continue;
    if (row.exam_event_id) byIdAndEvent.set(`${row.id}::${row.exam_event_id}`, row);
    if (row.centre_id) byIdAndCentre.set(`${row.id}::${row.centre_id}`, row);
    if (!rowsById.has(row.id)) rowsById.set(row.id, []);
    rowsById.get(row.id).push(row);
  }

  // Most specific match wins; the bare id is used only when it genuinely names one person.
  // Returning null rather than a guess is deliberate: a caller that cannot resolve the candidate
  // must say so (see budgetKnown in the outdoor report), never quietly use the wrong level.
  function resolve(candidateId, { examEventId, centreId } = {}) {
    if (!candidateId) return null;
    if (examEventId) {
      const hit = byIdAndEvent.get(`${candidateId}::${examEventId}`);
      if (hit) return hit;
    }
    if (centreId) {
      const hit = byIdAndCentre.get(`${candidateId}::${centreId}`);
      if (hit) return hit;
    }
    const all = rowsById.get(candidateId) || [];
    return all.length === 1 ? all[0] : null;
  }

  function levelOf(candidateId, scope) {
    return resolve(candidateId, scope)?.level ?? null;
  }

  // Ids that appear in more than one certification. Those whose LEVEL also differs are the
  // dangerous ones: level drives budgets, item banks and pass marks, so getting it wrong changes
  // results rather than just labels.
  function ambiguities() {
    const out = [];
    for (const [id, all] of rowsById.entries()) {
      if (all.length < 2) continue;
      const levels = Array.from(new Set(all.map((row) => row.level).filter(Boolean)));
      out.push({
        candidateId: id,
        occurrences: all.length,
        levels,
        levelConflict: levels.length > 1,
        centres: Array.from(new Set(all.map((row) => row.centre_id).filter(Boolean))),
      });
    }
    return out.sort((a, b) => Number(b.levelConflict) - Number(a.levelConflict));
  }

  return { resolve, levelOf, ambiguities };
}
