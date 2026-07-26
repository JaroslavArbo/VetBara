-- Single admin account for gating sensitive Admin actions (e.g. minting Centre
-- access tokens). One row (id = 1). Password is stored as scrypt(salt, password),
-- never in plaintext. Seeded on first login with a default that the admin then
-- changes (see api/admin/auth/*).

create table if not exists admin_credentials (
  id integer primary key default 1,
  username text not null,
  password_hash text not null,
  salt text not null,
  updated_at timestamptz not null default now(),
  constraint admin_credentials_singleton check (id = 1)
);

grant all privileges on table admin_credentials to service_role;
