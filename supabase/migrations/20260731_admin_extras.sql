-- Remaining Admin dev-mock stores ported to Supabase: package history,
-- Centre-link history, and translation overrides.

create table if not exists package_history (
  id text primary key,
  saved_at timestamptz not null default now(),
  language text,
  centre text,
  note text,
  package_id text,
  vet_filename text,
  package jsonb,
  data jsonb not null
);
create index if not exists package_history_saved_idx on package_history(saved_at desc);

create table if not exists centre_links (
  id text primary key,
  created_at timestamptz not null default now(),
  place text,
  exam_date text,
  centre text,
  token text,
  url text
);
create index if not exists centre_links_created_idx on centre_links(created_at desc);

create table if not exists translation_overrides (
  lang text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (lang, key)
);

grant all privileges on table package_history to service_role;
grant all privileges on table centre_links to service_role;
grant all privileges on table translation_overrides to service_role;
