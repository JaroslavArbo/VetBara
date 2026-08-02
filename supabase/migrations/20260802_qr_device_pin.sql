-- Device-bound QR access: the first device to ever use a Candidate/Examiner QR link is trusted
-- automatically and prompted to choose a short PIN; any OTHER device trying the same QR link must
-- enter that PIN before it is trusted too. Trusted devices never need the PIN again. Also tracks
-- how many DISTINCT devices currently hold a live (non-expired, non-revoked) session against the
-- same QR token, so the Centre can see - and the app can cap - simultaneous use of one link.
--
-- Deliberately additive/nullable only: every reader in api/ treats a missing column/table (migration
-- not yet applied) as "skip the PIN/device check, allow access as before" rather than failing
-- closed - a bug in this brand-new gate must never be able to lock a real candidate or examiner out
-- of their own exam.

alter table qr_tokens add column if not exists pin_hash text;

alter table app_sessions add column if not exists device_id text;

create table if not exists qr_token_devices (
  id uuid primary key default gen_random_uuid(),
  qr_token_id uuid not null references qr_tokens(id) on delete cascade,
  device_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (qr_token_id, device_id)
);

create index if not exists qr_token_devices_token_idx on qr_token_devices(qr_token_id);
create index if not exists app_sessions_qr_token_device_idx on app_sessions(qr_token_id, device_id);

grant all privileges on table qr_token_devices to service_role;
