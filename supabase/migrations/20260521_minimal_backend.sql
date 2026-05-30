create extension if not exists pgcrypto;

do $$ begin
  create type vetbara_role as enum ('Admin', 'Centre', 'Candidate', 'Examiner');
exception when duplicate_object then null;
end $$;

create table if not exists qr_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role vetbara_role not null,
  subject_id text not null,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  qr_token_id uuid references qr_tokens(id) on delete set null,
  role vetbara_role not null,
  subject_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sync_batches (
  id uuid primary key default gen_random_uuid(),
  client_batch_id text not null unique,
  session_id uuid references app_sessions(id) on delete set null,
  role vetbara_role not null,
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  requested_by_role vetbara_role not null,
  requested_by_subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_token_hash_idx on app_sessions(token_hash);
create index if not exists qr_tokens_token_hash_idx on qr_tokens(token_hash);
create index if not exists outdoor_scores_candidate_idx on outdoor_scores(candidate_id);
