-- Real binary storage for exam media: examiner voice recordings and report photos.
-- Bytes live in a private Supabase Storage bucket; this table keeps the metadata
-- and the storage path so Centre staff can list and download recordings/photos
-- for further processing.

create table if not exists exam_media (
  id uuid primary key default gen_random_uuid(),
  client_media_id text not null,
  session_id uuid references app_sessions(id) on delete set null,
  role text not null,
  media_type text not null check (media_type in ('audio', 'photo')),
  candidate_id text,
  examiner_id text,
  exam_id text,
  section_key text,
  tree text,
  storage_bucket text not null default 'exam-media',
  storage_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  duration_ms bigint,
  caption text,
  description text,
  cleaned boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  unique(session_id, client_media_id)
);

create index if not exists exam_media_candidate_idx on exam_media(candidate_id);
create index if not exists exam_media_examiner_idx on exam_media(examiner_id);
create index if not exists exam_media_type_idx on exam_media(media_type);

-- Private bucket for exam media. Access is only ever through the serverless API
-- using the service role key (signed URLs for downloads); no public access.
insert into storage.buckets (id, name, public)
values ('exam-media', 'exam-media', false)
on conflict (id) do nothing;
