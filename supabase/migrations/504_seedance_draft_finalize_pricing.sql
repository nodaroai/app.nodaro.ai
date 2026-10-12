-- 504_seedance_draft_finalize_pricing.sql
-- Seedance 2.5 Draft mode: the Video Upscale provider `seedance-2-5-hd`
-- re-renders a completed Seedance 2.5 DRAFT (480p) as the same take at 1080p.
--
-- Priced per OUTPUT second of the draft, one row per second (4-30s), with the
-- same conversion as the `seedance-2-5:{N}s:{res}` generation ladder:
--   credits = ceil(rate x seconds / 4) x 10
-- The `-ref` rows are the rate of a draft that had a reference VIDEO. Such a run
-- bills input + output seconds; the reservation scales the 8s `-ref` row by
-- that full span (the same rule the generation reference lane uses). Reference
-- IMAGES do not change the rate.
--
-- The draft itself needs no new rows: it is billed exactly like a 480p run.
-- Values match STATIC_CREDIT_COSTS (base credits). ON CONFLICT DO NOTHING keeps
-- any admin override set via /admin/models.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('seedance-2-5-hd',             3160, true, 'video'),  -- bare = 8s no reference video
  ('seedance-2-5-hd:4s',          1580, true, 'video'),
  ('seedance-2-5-hd:5s',          1980, true, 'video'),
  ('seedance-2-5-hd:6s',          2370, true, 'video'),
  ('seedance-2-5-hd:7s',          2770, true, 'video'),
  ('seedance-2-5-hd:8s',          3160, true, 'video'),
  ('seedance-2-5-hd:9s',          3560, true, 'video'),
  ('seedance-2-5-hd:10s',         3950, true, 'video'),
  ('seedance-2-5-hd:11s',         4350, true, 'video'),
  ('seedance-2-5-hd:12s',         4740, true, 'video'),
  ('seedance-2-5-hd:13s',         5140, true, 'video'),
  ('seedance-2-5-hd:14s',         5530, true, 'video'),
  ('seedance-2-5-hd:15s',         5930, true, 'video'),
  ('seedance-2-5-hd:16s',         6320, true, 'video'),
  ('seedance-2-5-hd:17s',         6720, true, 'video'),
  ('seedance-2-5-hd:18s',         7110, true, 'video'),
  ('seedance-2-5-hd:19s',         7510, true, 'video'),
  ('seedance-2-5-hd:20s',         7900, true, 'video'),
  ('seedance-2-5-hd:21s',         8300, true, 'video'),
  ('seedance-2-5-hd:22s',         8690, true, 'video'),
  ('seedance-2-5-hd:23s',         9090, true, 'video'),
  ('seedance-2-5-hd:24s',         9480, true, 'video'),
  ('seedance-2-5-hd:25s',         9880, true, 'video'),
  ('seedance-2-5-hd:26s',        10270, true, 'video'),
  ('seedance-2-5-hd:27s',        10670, true, 'video'),
  ('seedance-2-5-hd:28s',        11060, true, 'video'),
  ('seedance-2-5-hd:29s',        11460, true, 'video'),
  ('seedance-2-5-hd:30s',        11850, true, 'video'),
  ('seedance-2-5-hd:4s-ref',       950, true, 'video'),
  ('seedance-2-5-hd:5s-ref',      1190, true, 'video'),
  ('seedance-2-5-hd:6s-ref',      1430, true, 'video'),
  ('seedance-2-5-hd:7s-ref',      1670, true, 'video'),
  ('seedance-2-5-hd:8s-ref',      1900, true, 'video'),
  ('seedance-2-5-hd:9s-ref',      2140, true, 'video'),
  ('seedance-2-5-hd:10s-ref',     2380, true, 'video'),
  ('seedance-2-5-hd:11s-ref',     2620, true, 'video'),
  ('seedance-2-5-hd:12s-ref',     2850, true, 'video'),
  ('seedance-2-5-hd:13s-ref',     3090, true, 'video'),
  ('seedance-2-5-hd:14s-ref',     3330, true, 'video'),
  ('seedance-2-5-hd:15s-ref',     3570, true, 'video'),
  ('seedance-2-5-hd:16s-ref',     3800, true, 'video'),
  ('seedance-2-5-hd:17s-ref',     4040, true, 'video'),
  ('seedance-2-5-hd:18s-ref',     4280, true, 'video'),
  ('seedance-2-5-hd:19s-ref',     4520, true, 'video'),
  ('seedance-2-5-hd:20s-ref',     4750, true, 'video'),
  ('seedance-2-5-hd:21s-ref',     4990, true, 'video'),
  ('seedance-2-5-hd:22s-ref',     5230, true, 'video'),
  ('seedance-2-5-hd:23s-ref',     5470, true, 'video'),
  ('seedance-2-5-hd:24s-ref',     5700, true, 'video'),
  ('seedance-2-5-hd:25s-ref',     5940, true, 'video'),
  ('seedance-2-5-hd:26s-ref',     6180, true, 'video'),
  ('seedance-2-5-hd:27s-ref',     6420, true, 'video'),
  ('seedance-2-5-hd:28s-ref',     6650, true, 'video'),
  ('seedance-2-5-hd:29s-ref',     6890, true, 'video'),
  ('seedance-2-5-hd:30s-ref',     7130, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
