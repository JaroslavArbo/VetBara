-- Phase 1 of the auth overhaul: separate, named administrator identities instead of one shared
-- "Admin" account with a default password.
--
-- Deliberately NOT using Supabase Auth yet: admin credentials in this app are custom scrypt hashes
-- in admin_credentials, and moving them to Supabase Auth (needed for native TOTP/passkeys, phases
-- 2-3) is an architecture change of its own. This migration establishes the identities, activation
-- flow and audit trail those phases will build on.

-- 16.1 - one row per real person who can sign in.
create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,                       -- filled once/if the account moves to Supabase Auth
  username text not null unique,
  role text not null default 'super_admin', -- super_admin | centre_admin | centre_user
  centre_id text,
  status text not null default 'pending_activation', -- pending_activation | pending_approval | active | suspended | disabled
  -- Own credential material per identity (no shared account). Null until activation sets it.
  salt text,
  password_hash text,
  password_set_at timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  last_login_at timestamptz
);

-- 16.2 - one-time, hashed, expiring activation links. The plaintext token never touches the DB.
create table if not exists admin_activation_tokens (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);

-- 16.9 - security audit trail. Must never contain secrets (passwords, PINs, TOTP secrets, or whole
-- tokens) - callers pass only non-reversible references.
create table if not exists auth_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,               -- admin | centre | candidate | examiner | system
  actor_id text,
  action text not null,
  result text not null default 'success',  -- success | failure
  exam_event_id text,
  target_type text,
  target_id text,
  ip_address_or_hash text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_profiles_username_idx on user_profiles(username);
create index if not exists admin_activation_tokens_hash_idx on admin_activation_tokens(token_hash);
create index if not exists auth_audit_log_created_idx on auth_audit_log(created_at desc);
create index if not exists auth_audit_log_actor_idx on auth_audit_log(actor_type, actor_id);

-- 4.1 - the two named administrators, both pending activation (no usable credentials yet).
insert into user_profiles (username, role, status)
values ('Admin_Bara', 'super_admin', 'pending_activation'),
       ('Admin_Jarek', 'super_admin', 'pending_activation')
on conflict (username) do nothing;

-- 2.2 - retire the shared account so its (default) password can never authenticate again. The row
-- is kept, not dropped, so an operator can still see that it existed and when it was retired.
update admin_credentials set username = 'retired_shared_admin', password_hash = 'disabled', salt = 'disabled'
where id = 1 and username <> 'retired_shared_admin';

grant select, insert, update, delete on user_profiles to service_role;
grant select, insert, update, delete on admin_activation_tokens to service_role;
grant select, insert on auth_audit_log to service_role;
