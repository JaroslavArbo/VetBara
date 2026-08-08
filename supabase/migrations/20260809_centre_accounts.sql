-- Phase 5 of the auth overhaul: real accounts for certification Centres (§10, §16.3, §16.4).
--
-- Until now a Centre was reached purely by a shared QR link/token. That link keeps working
-- throughout this phase (§22 phase 5 - existing exams must not be interrupted); these tables add
-- the invite -> self-activation -> admin approval flow alongside it, so Centres can be migrated one
-- at a time and the old QR path retired afterwards.
--
-- Centre users reuse user_profiles (role centre_admin / centre_user, centre_id, status), which the
-- phase-1 migration already shaped for exactly this - so a Centre can later have SEVERAL named
-- users rather than one shared login (§10.3).

-- §16.3 - one-time, hashed, expiring invitation issued by an administrator.
create table if not exists centre_invites (
  id uuid primary key default gen_random_uuid(),
  centre_id text not null,
  centre_name text not null,
  invited_email text not null,
  country text,
  internal_ref text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

-- §16.4 - the approval trail: who decided what about a Centre, and why.
create table if not exists centre_approval_events (
  id uuid primary key default gen_random_uuid(),
  centre_id text not null,
  user_profile_id uuid references user_profiles(id) on delete set null,
  action text not null,          -- requested | approved | rejected | suspended | reactivated | info_requested
  performed_by text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists centre_invites_token_idx on centre_invites(token_hash);
create index if not exists centre_invites_centre_idx on centre_invites(centre_id);
create index if not exists centre_approval_events_centre_idx on centre_approval_events(centre_id, created_at desc);

-- A Centre user signs in with their own address, so it has to be unique and quick to look up.
create unique index if not exists user_profiles_auth_email_idx on user_profiles(auth_email) where auth_email is not null;

grant all privileges on table centre_invites to service_role;
grant all privileges on table centre_approval_events to service_role;
