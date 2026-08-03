-- Centre access-link lifecycle, so Admin can see at a glance what happened to each link it minted
-- and so an unused link stops working after three weeks.
--
--   subject_id   - the Centre exam id the link points at (lets any side find the row by id)
--   activated_at - first time the link was actually opened (resolved into a Centre session)
--   closed_at    - the exam behind the link was closed/archived in Centre section E
--
-- Admin tints its link history from these: no activated_at = white (only generated),
-- activated_at = green (opened), closed_at = orange (closed and archived).
alter table centre_links add column if not exists subject_id text;
alter table centre_links add column if not exists activated_at timestamptz;
alter table centre_links add column if not exists closed_at timestamptz;

create index if not exists centre_links_subject_id_idx on centre_links(subject_id);

grant select, insert, update, delete on centre_links to service_role;
