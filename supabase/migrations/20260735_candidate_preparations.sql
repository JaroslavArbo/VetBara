-- Candidate tree preparation (notes + sketches) written before the outdoor exam.
--
-- Until now this lived only in the candidate's own browser localStorage: there was no sync event,
-- no projection and no read path, so the Centre could never see it and clearing the browser (or
-- switching device) lost the work outright. One row per candidate/tree, matching how the client
-- keys it (notesByTree / sketchesByTree, keyed by fieldTreeKey -> "Practicing-A").
--
-- Scoped by exam_event_id from the start, for the same reason as 20260734: candidate ids repeat
-- across certifications and must not share rows.

create table if not exists candidate_preparations (
  id uuid primary key default gen_random_uuid(),
  exam_event_id text not null default '',
  candidate_id text not null,
  tree_key text not null,
  note text,
  -- Compressed data URL of the sketch; kept inline like outdoor_assessments.payload rather than in
  -- storage, because a preparation sketch is small and always read together with its note.
  sketch text,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists candidate_preparations_event_key
  on candidate_preparations(exam_event_id, candidate_id, tree_key);

create index if not exists candidate_preparations_candidate_idx
  on candidate_preparations(candidate_id);

-- Same rationale as 20260727: only the service_role reaches these tables, always via /api.
grant all privileges on table candidate_preparations to service_role;
