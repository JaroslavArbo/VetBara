-- Scope the per-exam projection tables by exam event.
--
-- These tables were keyed by candidate_id alone, so two certifications that both use the
-- standard ids (C-001…) SHARED rows: opening a new exam showed the previous exam's sections,
-- test answers and outdoor scores, and new submissions overwrote the old exam's data.
--
-- exam_event_id defaults to '' so pre-migration rows stay valid; the API writes the session's
-- exam event id for all new rows and filters reads by it (rows written before this migration
-- are intentionally invisible to event-scoped reads — that is the "old exam data keeps
-- showing up in the new exam" complaint).
--
-- The old unique constraints must be dropped: they would forbid the same candidate id from
-- existing in two exam events, which is exactly what has to be possible.

alter table candidate_sections  add column if not exists exam_event_id text not null default '';
alter table test_responses      add column if not exists exam_event_id text not null default '';
alter table outdoor_assessments add column if not exists exam_event_id text not null default '';
alter table outdoor_scores      add column if not exists exam_event_id text not null default '';
alter table sync_events         add column if not exists exam_event_id text not null default '';

alter table candidate_sections  drop constraint if exists candidate_sections_candidate_id_section_key_key;
alter table test_responses      drop constraint if exists test_responses_candidate_id_question_id_key;
alter table outdoor_assessments drop constraint if exists outdoor_assessments_candidate_id_examiner_id_section_key_key;
alter table outdoor_scores      drop constraint if exists outdoor_scores_candidate_id_examiner_id_item_id_key;

create unique index if not exists candidate_sections_event_key
  on candidate_sections(exam_event_id, candidate_id, section_key);
create unique index if not exists test_responses_event_key
  on test_responses(exam_event_id, candidate_id, question_id);
create unique index if not exists outdoor_assessments_event_key
  on outdoor_assessments(exam_event_id, candidate_id, examiner_id, section_key);
create unique index if not exists outdoor_scores_event_key
  on outdoor_scores(exam_event_id, candidate_id, examiner_id, item_id);

create index if not exists sync_events_event_candidate_idx on sync_events(exam_event_id, candidate_id);
