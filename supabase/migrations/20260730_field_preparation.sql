-- Production storage for field-preparation (site setup + trees) and field-tablet
-- sync packages, replacing the dev-only file mocks in vite.config.js.

create table if not exists field_preparations (
  exam_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists field_tablet_syncs (
  sync_id text primary key,
  exam_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists field_tablet_syncs_exam_idx on field_tablet_syncs(exam_id, received_at desc);

grant all privileges on table field_preparations to service_role;
grant all privileges on table field_tablet_syncs to service_role;
