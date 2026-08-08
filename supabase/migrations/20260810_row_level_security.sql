-- §18 - Row Level Security as a second, independent layer.
--
-- How access actually works today: the browser never reads exam data from Supabase. Every read and
-- write goes through this app's own /api routes, which use the service_role key and enforce role
-- and scope in application code. Anonymous access is already refused at the GRANT level (PostgREST
-- answers 42501), so nothing is exposed right now.
--
-- What this migration adds is defence in depth. Grants are one mistake away from being widened - a
-- future "GRANT SELECT ... TO anon", a Supabase dashboard click, a new table created without the
-- usual grant block - and today that single mistake would expose candidate data immediately. With
-- RLS enabled and NO permissive policy for anon/authenticated, such a mistake yields an empty
-- result set instead of a breach: two independent things must now go wrong, not one.
--
-- Why this cannot break the application: service_role carries the BYPASSRLS attribute, so every
-- existing /api call is unaffected. That is verified explicitly after this migration, not assumed.
--
-- Deliberately NO policies are created. Adding a policy is what grants access under RLS; the
-- correct posture for these tables is that only the service role - i.e. our own server - may read
-- them. Per-user policies would only become meaningful if the browser ever queried Supabase
-- directly for exam data, which is exactly what this architecture avoids.

do $$
declare
  target text;
  app_tables text[] := array[
    'admin_activation_tokens', 'admin_credentials', 'app_sessions', 'auth_audit_log',
    'authoring_drafts', 'candidate_preparations', 'candidate_sections', 'candidates',
    'centre_approval_events', 'centre_invites', 'centre_links', 'centres',
    'certification_packages', 'evaluations', 'exam_events', 'exam_media',
    'examiner_assignments', 'examiners', 'field_preparations', 'field_tablet_syncs',
    'outdoor_assessments', 'outdoor_scores', 'package_history', 'pin_challenges',
    'qr_token_devices', 'qr_tokens', 'scan_inbox', 'sync_batches', 'sync_events',
    'test_responses', 'translation_overrides', 'user_profiles'
  ];
begin
  foreach target in array app_tables loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = target) then
      execute format('alter table public.%I enable row level security', target);
      -- Withdraw anything that may have been granted to the browser-facing roles. These tables are
      -- server-side only; the anon key is used solely for Supabase Auth sign-in.
      execute format('revoke all on public.%I from anon', target);
      execute format('revoke all on public.%I from authenticated', target);
    end if;
  end loop;
end $$;

-- New tables must not silently start life reachable by the browser roles either.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
