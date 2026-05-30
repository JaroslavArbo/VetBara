create table if not exists sync_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null,
  session_id uuid references app_sessions(id) on delete set null,
  role text not null,
  subject_id text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  candidate_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(session_id, client_event_id)
);

create index if not exists sync_events_session_idx on sync_events(session_id);
create index if not exists sync_events_candidate_idx on sync_events(candidate_id);
create index if not exists sync_events_event_type_idx on sync_events(event_type);
