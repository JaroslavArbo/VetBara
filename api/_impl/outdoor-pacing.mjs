import { envReady, sendJson, supabase, resolveSession } from "../_lib/backend.mjs";
import { sectionBudgets, buildCandidateTiming, aggregateByExaminer, OUTDOOR_BLOCK_MINUTES_DEFAULT } from "../_lib/outdoorpacing.mjs";

// Outdoor time efficiency, read side. One handler serves both audiences from the same numbers, so
// the Centre and the administrator can never be looking at different figures:
//
//   Centre  -> its own roster: per candidate, what each section was budgeted and what it took
//   Admin   -> everything, plus the per-examiner roll-up ("does this examiner keep to the frame?")
//
// Everything is computed from sync_events on read. Exam volumes are small and the alternative - a
// projection table - would need to be rebuilt whenever a budget override changes, which is exactly
// the kind of thing that silently goes stale.

const EVENT_TYPES = "outdoor_section.focus,outdoor_assessment.opened,outdoor_assessment.submitted";

async function readOutdoorEvents(candidateIds) {
  const scope = candidateIds?.length
    ? `&candidate_id=in.(${candidateIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(",")})`
    : "";
  return supabase(
    `sync_events?event_type=in.(${encodeURIComponent(EVENT_TYPES)})${scope}&select=event_type,candidate_id,exam_event_id,payload,created_at&order=created_at.asc&limit=4000`
  ).catch((error) => { console.warn("Outdoor pacing read failed", error?.message || error); return []; });
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (!envReady()) return sendJson(response, 200, { ok: true, candidates: [], examiners: [] });

  try {
    const session = await resolveSession(request.body?.sessionToken);
    if (!session) return sendJson(response, 401, { error: "Invalid or expired session" });
    const isAdmin = session.role === "Admin";
    const isCentre = session.role === "Centre";
    if (!isAdmin && !isCentre) return sendJson(response, 403, { error: "Not available for this session" });

    // A Centre only ever sees its own people; an administrator supervises every certification.
    // Candidate ids REPEAT across certifications - C-001 exists in more than one exam, and not
    // necessarily at the same level - so a flat id->level map silently picks whichever row happened
    // to be last. Resolve by (candidate, exam event) first and only fall back to the id alone when
    // that is unambiguous.
    let roster = null;
    let candidateRows = [];
    if (isCentre) {
      candidateRows = await supabase(`candidates?centre_id=eq.${encodeURIComponent(session.subjectId)}&select=id,level,exam_event_id`).catch(() => []);
      roster = candidateRows.map((row) => row.id);
      if (!roster.length) return sendJson(response, 200, { ok: true, candidates: [], examiners: [] });
    } else {
      candidateRows = await supabase("candidates?select=id,level,exam_event_id&limit=2000").catch(() => []);
    }
    const levelByCandidateEvent = {};
    const levelsById = {};
    for (const row of candidateRows) {
      if (row.exam_event_id) levelByCandidateEvent[`${row.id}::${row.exam_event_id}`] = row.level;
      (levelsById[row.id] = levelsById[row.id] || new Set()).add(row.level);
    }
    const resolveLevel = (candidateId, examEventId) => {
      const scoped = levelByCandidateEvent[`${candidateId}::${examEventId}`];
      if (scoped) return scoped;
      const levels = levelsById[candidateId];
      return levels && levels.size === 1 ? [...levels][0] : null;
    };

    const events = await readOutdoorEvents(roster);

    // The item bank and any per-section overrides come from the caller: the Centre already holds
    // the active package and its own settings, and shipping them avoids re-deriving the package
    // server-side (where the "active" one is genuinely ambiguous across certifications).
    const itemsByLevel = request.body?.outdoorItemsByLevel && typeof request.body.outdoorItemsByLevel === "object"
      ? request.body.outdoorItemsByLevel : {};
    const overrides = request.body?.overrides && typeof request.body.overrides === "object" ? request.body.overrides : {};
    const blockMinutes = Number(request.body?.blockMinutes) > 0 ? Number(request.body.blockMinutes) : OUTDOOR_BLOCK_MINUTES_DEFAULT;

    const budgetsByLevel = {};
    for (const [level, bank] of Object.entries(itemsByLevel)) {
      budgetsByLevel[level] = sectionBudgets(bank, { blockMinutes, overrides: overrides[level] || {} });
    }

    const byCandidate = new Map();
    for (const event of events) {
      const candidateId = event.candidate_id || event.payload?.candidateId;
      if (!candidateId) continue;
      if (!byCandidate.has(candidateId)) byCandidate.set(candidateId, { focus: [], openedAt: null, submittedAt: null, examinerId: null, examEventId: null });
      const entry = byCandidate.get(candidateId);
      if (event.payload?.examinerId) entry.examinerId = event.payload.examinerId;
      if (event.exam_event_id) entry.examEventId = entry.examEventId || event.exam_event_id;
      if (event.event_type === "outdoor_section.focus") {
        entry.focus.push({ sectionKey: event.payload?.sectionKey, at: event.payload?.at || event.created_at });
      } else if (event.event_type === "outdoor_assessment.opened") {
        entry.openedAt = entry.openedAt || event.payload?.openedAt || event.created_at;
      } else if (event.event_type === "outdoor_assessment.submitted") {
        entry.submittedAt = event.payload?.submittedAt || event.created_at;
      }
    }

    const candidates = Array.from(byCandidate.entries())
      .filter(([, entry]) => entry.focus.length > 0)
      .map(([candidateId, entry]) => buildCandidateTiming({
        candidateId,
        examinerId: entry.examinerId,
        focusEvents: entry.focus,
        openedAt: entry.openedAt,
        submittedAt: entry.submittedAt,
        budgets: budgetsByLevel[resolveLevel(candidateId, entry.examEventId)] || {},
        budgetKnown: Boolean(budgetsByLevel[resolveLevel(candidateId, entry.examEventId)]),
      }))
      .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));

    return sendJson(response, 200, {
      ok: true,
      candidates,
      examiners: isAdmin ? aggregateByExaminer(candidates) : [],
    });
  } catch (error) {
    console.error("Outdoor pacing failed", error);
    return sendJson(response, 500, { error: "Outdoor pacing failed" });
  }
}
