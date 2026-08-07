-- Phase 2: admin identities move into Supabase Auth so its native MFA (TOTP now, passkeys next)
-- can be used instead of a hand-rolled second factor.
--
-- user_profiles keeps the app-level facts (username, role, status, audit linkage); Supabase Auth
-- owns the credentials and the factors. auth_user_id links the two.

alter table user_profiles add column if not exists auth_email text;

-- Any admin that still carries a local scrypt password predates this change. Clear the hash and
-- send the account back through activation, so its credentials end up in Supabase Auth and it
-- cannot be signed into with a password alone (§8).
update user_profiles
   set password_hash = null, salt = null, status = 'pending_activation'
 where role = 'super_admin' and auth_user_id is null;
