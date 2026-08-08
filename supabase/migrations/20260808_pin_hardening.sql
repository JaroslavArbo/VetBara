-- Phase 4 of the auth overhaul: make the three-digit QR PIN survivable.
--
-- A 3-digit PIN has only 1000 combinations, so it is NOT authentication on its own (§11.3) - it
-- confirms the holder of an already-valid QR token when they open it on another device. Two things
-- were missing and both are fixed here:
--
--   1. pin_hash was a bare SHA-256 of the digits. On a database leak all 1000 variants can be
--      enumerated instantly (§14). We move to salted scrypt with a server-side pepper.
--   2. There was no attempt limit at all, so the PIN could simply be guessed online (§13.1).
--
-- Additive and nullable throughout: the readers treat missing columns as "behave as before", so an
-- un-migrated deployment keeps working rather than locking a real candidate out mid-exam.

-- §14 - per-PIN salt, plus which algorithm the stored hash uses so legacy rows stay verifiable
-- and get transparently upgraded on the next successful entry.
alter table qr_tokens add column if not exists pin_salt text;
alter table qr_tokens add column if not exists pin_algo text;
alter table qr_tokens add column if not exists pin_created_at timestamptz;

-- §13.1 - attempt counter and escalating lockout (15 min, 60 min, then manual).
alter table qr_tokens add column if not exists pin_failed_attempts integer not null default 0;
alter table qr_tokens add column if not exists pin_locked_until timestamptz;
alter table qr_tokens add column if not exists pin_lockout_count integer not null default 0;
alter table qr_tokens add column if not exists pin_permanently_locked_at timestamptz;

-- §16.6 - device rows need to be individually revocable and to carry a little context for the
-- Centre's "which devices are registered?" view.
alter table qr_token_devices add column if not exists revoked_at timestamptz;
alter table qr_token_devices add column if not exists revoked_by text;
alter table qr_token_devices add column if not exists user_agent_summary text;

-- §16.7 - one-time, short-lived PIN challenge bound to a single QR token, so a PIN can never be
-- submitted outside a server-issued attempt window.
create table if not exists pin_challenges (
  id uuid primary key default gen_random_uuid(),
  qr_token_id uuid not null references qr_tokens(id) on delete cascade,
  challenge_hash text not null unique,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pin_challenges_token_idx on pin_challenges(qr_token_id);
create index if not exists pin_challenges_hash_idx on pin_challenges(challenge_hash);
create index if not exists qr_token_devices_active_idx on qr_token_devices(qr_token_id) where revoked_at is null;

-- Existing rows were hashed with the old scheme; mark them so the verifier knows.
update qr_tokens set pin_algo = 'sha256' where pin_hash is not null and pin_algo is null;

grant all privileges on table pin_challenges to service_role;
