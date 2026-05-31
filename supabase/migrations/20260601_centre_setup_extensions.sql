create table if not exists centres (
  id text primary key,
  name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exam_events (
  id text primary key,
  centre_id text not null references centres(id) on delete cascade,
  name text,
  status text not null default 'current',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists exam_events_current_centre_idx on exam_events(centre_id) where status = 'current';

create table if not exists candidates (
  exam_event_id text not null references exam_events(id) on delete cascade,
  centre_id text not null references centres(id) on delete cascade,
  id text not null,
  name text,
  level text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exam_event_id, id)
);

create table if not exists examiners (
  exam_event_id text not null references exam_events(id) on delete cascade,
  centre_id text not null references centres(id) on delete cascade,
  id text not null,
  name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exam_event_id, id)
);

create table if not exists examiner_assignments (
  id uuid primary key default gen_random_uuid(),
  exam_event_id text not null,
  centre_id text not null references centres(id) on delete cascade,
  candidate_id text not null,
  examiner_id text not null,
  role text not null check (role in ('primary', 'secondary')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (exam_event_id, candidate_id) references candidates(exam_event_id, id) on delete cascade,
  foreign key (exam_event_id, examiner_id) references examiners(exam_event_id, id) on delete cascade,
  unique (exam_event_id, candidate_id, role),
  unique (exam_event_id, candidate_id, examiner_id)
);

create index if not exists candidates_centre_exam_idx on candidates(centre_id, exam_event_id);
create index if not exists examiners_centre_exam_idx on examiners(centre_id, exam_event_id);
create index if not exists examiner_assignments_exam_candidate_idx on examiner_assignments(exam_event_id, candidate_id);
