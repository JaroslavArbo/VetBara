-- Production storage for Admin exam-package authoring + approval, replacing the
-- dev-only file-based mocks in vite.config.js. Packages/drafts are stored as
-- jsonb; the single active package is the row with active_for_centre = true.

create table if not exists certification_packages (
  package_id text primary key,
  created_at timestamptz not null default now(),
  content_source text,
  active_for_centre boolean not null default false,
  validation jsonb,
  approval jsonb,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists certification_packages_active_idx on certification_packages(active_for_centre);
create index if not exists certification_packages_created_idx on certification_packages(created_at desc);

create table if not exists authoring_drafts (
  draft_id text primary key,
  stored_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists authoring_drafts_stored_idx on authoring_drafts(stored_at desc);

grant all privileges on table certification_packages to service_role;
grant all privileges on table authoring_drafts to service_role;
