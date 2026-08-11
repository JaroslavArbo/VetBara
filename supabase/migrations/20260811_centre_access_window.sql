-- Centre access that expires with the certification it was granted for.
--
-- A Centre account was valid indefinitely once approved, so access outlived the exam unless somebody
-- remembered to suspend it - and a revocation that depends on being remembered is the usual way
-- access rights survive their purpose.
--
-- Two nullable columns, enforced in the one place a Centre session is issued. NULL means "no limit",
-- so existing Centres are unaffected and the migration cannot lock anybody out.
--
-- Expiry deliberately does NOT delete or disable the account: the exam data, the audit trail and the
-- approval history stay intact and reviewable, which a certification system needs, and extending is
-- one click rather than a fresh invitation.

alter table user_profiles add column if not exists valid_from timestamptz;
alter table user_profiles add column if not exists valid_until timestamptz;

-- The window the resulting ACCOUNT should get. Distinct from centre_invites.expires_at, which is how
-- long the invitation LINK itself can be opened (7 days) - conflating the two would either give a
-- Centre a week of access or leave the link usable for the whole certification.
alter table centre_invites add column if not exists access_valid_until timestamptz;

create index if not exists user_profiles_valid_until_idx on user_profiles(valid_until) where valid_until is not null;
