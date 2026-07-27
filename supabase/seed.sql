-- Local/dev seed: demo QR tokens so QR login works after `supabase db reset`.
-- (Production seeds via POST /api/seed with x-seed-secret.)
insert into qr_tokens (token_hash, role, subject_id, label) values
  ('a47891f38f87b7f7b14f1f3c2ab436d2c15163898e7a8e4f1eacbcdd8c904fcb', 'Centre', 'CENTRE-ARBOR', 'Centre CENTRE-ARBOR'),
  ('6450a96bdf0a34e6a365a621a25310fe116e82366de64e009a475a37c05aeb20', 'Candidate', 'C-001', 'Candidate C-001'),
  ('b845e3510d298296ee291727ebecd1ce681df24e93c66f47de77f1b7d94f40d0', 'Candidate', 'C-002', 'Candidate C-002'),
  ('cf1da60f6eecd410a955f58ee8a11c2f22854ac7a2565caeaba2907eabad2685', 'Candidate', 'C-003', 'Candidate C-003'),
  ('25894c19b869a58ec0d872ca9c9c3a4e3c3c5282f00ac475bae65fa4d373daa7', 'Candidate', 'C-004', 'Candidate C-004'),
  ('6957b023227ab3fab55dcfcbadbed39664e640f553978e176ffb55b608259f5c', 'Examiner', 'E-001', 'Examiner E-001'),
  ('5fd07aa2afe74c41c18df1d58a940e3db773002b148fa67b28fb5ce9117fa75c', 'Examiner', 'E-002', 'Examiner E-002'),
  ('5a763e30a2b12b795426180451223821d83c2052ec47dd29efaf9c5f513aaff5', 'Examiner', 'E-003', 'Examiner E-003')
on conflict (token_hash) do nothing;
