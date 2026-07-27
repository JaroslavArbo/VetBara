-- Scan-inbox: a phone opened via ?mode=scan-capture uploads document photos here;
-- Centre polls and consumes them. Replaces the dev file mock.

create table if not exists scan_inbox (
  id text primary key,
  exam_id text not null,
  data_url text not null,
  captured_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists scan_inbox_exam_idx on scan_inbox(exam_id, received_at);

grant all privileges on table scan_inbox to service_role;
