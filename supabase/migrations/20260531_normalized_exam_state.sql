create table if not exists candidate_sections (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  section_key text not null,
  status text not null,
  opened_at timestamptz,
  closed_at timestamptz,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(candidate_id, section_key)
);

create table if not exists test_responses (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  question_id text not null,
  answer jsonb not null,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(candidate_id, question_id)
);

create table if not exists outdoor_assessments (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  examiner_id text not null,
  mode text not null,
  section_key text not null,
  payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(candidate_id, examiner_id, section_key)
);

create table if not exists outdoor_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  examiner_id text not null,
  item_id text not null,
  score numeric,
  note text,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(candidate_id, examiner_id, item_id)
);

create index if not exists candidate_sections_candidate_idx on candidate_sections(candidate_id);
create index if not exists test_responses_candidate_idx on test_responses(candidate_id);
create index if not exists outdoor_assessments_candidate_idx on outdoor_assessments(candidate_id);
create index if not exists outdoor_scores_candidate_idx on outdoor_scores(candidate_id);
