-- Depth Anything per frame (decided 2026-11-04): charged per whole second of the
-- input clip, 2 base credits a second, the probed length rounded UP (a clip under
-- 1 s pays for 1 s), up to the provider's 80 s cap (a longer clip is still refused
-- before anything is reserved). One row per second, `depth-anything-frames:1s` …
-- `:80s`, picked by `videoDepthCreditId` (packages/shared/src/video-depth.ts) on
-- every path: the route's guard and reservation, the workflow run's stamp and
-- reservation, every estimate. The video-depth worker sets no metered cost, so
-- the reserved row is committed verbatim as the charge. The same rule migration
-- 590 gave Video Depth Anything.
--
-- Replaces the 15/30/60/120 s buckets of 502, which stay in place. `:15s`, `:30s`
-- and `:60s` already hold the per-second price (2 credits × their length) and are
-- listed here at the same values, so they keep whatever an administrator set.
-- `:120s` and `:300s` are past the 80 s cap: no new run reaches them, and a job
-- already queued on `:120s` still finds its row, so they are not touched.
--
-- The bare row moves from 600 to 160, the price of the longest clip this provider
-- accepts, so every list that shows a model by its bare row shows a price a run
-- can reach (the UPDATE at the end).
--
-- WHY A SELECT AND NOT A PLAIN VALUES LIST: see 590. A reservation reads the
-- switches of the row it reserves, so each row takes `is_enabled`,
-- `tier_restriction` and `category` from the bucket row that priced that second
-- before: 1–15 s from `:15s`, 16–30 s from `:30s`, 31–60 s from `:60s`, 61–80 s
-- from `:120s`. A bucket row this deployment does not have gives the defaults a
-- row-less id prices with (enabled, unrestricted) in 'video'. The ids and prices
-- are literals, never read from a bucket. Values MUST match STATIC_CREDIT_COSTS
-- (credit-pricing-migration-sync.test.ts, static-costs-match-migrations.test.ts);
-- the inheritance is proven by
-- supabase/tests/depth-anything-frames-per-second-pricing.behavior.sql.
--
-- ON CONFLICT DO NOTHING keeps any admin override, and makes a second run a no-op.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction, category)
SELECT
  per_second.model_identifier,
  per_second.credit_cost,
  CASE WHEN bucket.model_identifier IS NULL THEN true ELSE bucket.is_enabled END,
  bucket.tier_restriction,
  CASE WHEN bucket.model_identifier IS NULL THEN 'video' ELSE bucket.category END
FROM (VALUES
  ('depth-anything-frames:1s', 2, 'depth-anything-frames:15s'),
  ('depth-anything-frames:2s', 4, 'depth-anything-frames:15s'),
  ('depth-anything-frames:3s', 6, 'depth-anything-frames:15s'),
  ('depth-anything-frames:4s', 8, 'depth-anything-frames:15s'),
  ('depth-anything-frames:5s', 10, 'depth-anything-frames:15s'),
  ('depth-anything-frames:6s', 12, 'depth-anything-frames:15s'),
  ('depth-anything-frames:7s', 14, 'depth-anything-frames:15s'),
  ('depth-anything-frames:8s', 16, 'depth-anything-frames:15s'),
  ('depth-anything-frames:9s', 18, 'depth-anything-frames:15s'),
  ('depth-anything-frames:10s', 20, 'depth-anything-frames:15s'),
  ('depth-anything-frames:11s', 22, 'depth-anything-frames:15s'),
  ('depth-anything-frames:12s', 24, 'depth-anything-frames:15s'),
  ('depth-anything-frames:13s', 26, 'depth-anything-frames:15s'),
  ('depth-anything-frames:14s', 28, 'depth-anything-frames:15s'),
  ('depth-anything-frames:15s', 30, 'depth-anything-frames:15s'),
  ('depth-anything-frames:16s', 32, 'depth-anything-frames:30s'),
  ('depth-anything-frames:17s', 34, 'depth-anything-frames:30s'),
  ('depth-anything-frames:18s', 36, 'depth-anything-frames:30s'),
  ('depth-anything-frames:19s', 38, 'depth-anything-frames:30s'),
  ('depth-anything-frames:20s', 40, 'depth-anything-frames:30s'),
  ('depth-anything-frames:21s', 42, 'depth-anything-frames:30s'),
  ('depth-anything-frames:22s', 44, 'depth-anything-frames:30s'),
  ('depth-anything-frames:23s', 46, 'depth-anything-frames:30s'),
  ('depth-anything-frames:24s', 48, 'depth-anything-frames:30s'),
  ('depth-anything-frames:25s', 50, 'depth-anything-frames:30s'),
  ('depth-anything-frames:26s', 52, 'depth-anything-frames:30s'),
  ('depth-anything-frames:27s', 54, 'depth-anything-frames:30s'),
  ('depth-anything-frames:28s', 56, 'depth-anything-frames:30s'),
  ('depth-anything-frames:29s', 58, 'depth-anything-frames:30s'),
  ('depth-anything-frames:30s', 60, 'depth-anything-frames:30s'),
  ('depth-anything-frames:31s', 62, 'depth-anything-frames:60s'),
  ('depth-anything-frames:32s', 64, 'depth-anything-frames:60s'),
  ('depth-anything-frames:33s', 66, 'depth-anything-frames:60s'),
  ('depth-anything-frames:34s', 68, 'depth-anything-frames:60s'),
  ('depth-anything-frames:35s', 70, 'depth-anything-frames:60s'),
  ('depth-anything-frames:36s', 72, 'depth-anything-frames:60s'),
  ('depth-anything-frames:37s', 74, 'depth-anything-frames:60s'),
  ('depth-anything-frames:38s', 76, 'depth-anything-frames:60s'),
  ('depth-anything-frames:39s', 78, 'depth-anything-frames:60s'),
  ('depth-anything-frames:40s', 80, 'depth-anything-frames:60s'),
  ('depth-anything-frames:41s', 82, 'depth-anything-frames:60s'),
  ('depth-anything-frames:42s', 84, 'depth-anything-frames:60s'),
  ('depth-anything-frames:43s', 86, 'depth-anything-frames:60s'),
  ('depth-anything-frames:44s', 88, 'depth-anything-frames:60s'),
  ('depth-anything-frames:45s', 90, 'depth-anything-frames:60s'),
  ('depth-anything-frames:46s', 92, 'depth-anything-frames:60s'),
  ('depth-anything-frames:47s', 94, 'depth-anything-frames:60s'),
  ('depth-anything-frames:48s', 96, 'depth-anything-frames:60s'),
  ('depth-anything-frames:49s', 98, 'depth-anything-frames:60s'),
  ('depth-anything-frames:50s', 100, 'depth-anything-frames:60s'),
  ('depth-anything-frames:51s', 102, 'depth-anything-frames:60s'),
  ('depth-anything-frames:52s', 104, 'depth-anything-frames:60s'),
  ('depth-anything-frames:53s', 106, 'depth-anything-frames:60s'),
  ('depth-anything-frames:54s', 108, 'depth-anything-frames:60s'),
  ('depth-anything-frames:55s', 110, 'depth-anything-frames:60s'),
  ('depth-anything-frames:56s', 112, 'depth-anything-frames:60s'),
  ('depth-anything-frames:57s', 114, 'depth-anything-frames:60s'),
  ('depth-anything-frames:58s', 116, 'depth-anything-frames:60s'),
  ('depth-anything-frames:59s', 118, 'depth-anything-frames:60s'),
  ('depth-anything-frames:60s', 120, 'depth-anything-frames:60s'),
  ('depth-anything-frames:61s', 122, 'depth-anything-frames:120s'),
  ('depth-anything-frames:62s', 124, 'depth-anything-frames:120s'),
  ('depth-anything-frames:63s', 126, 'depth-anything-frames:120s'),
  ('depth-anything-frames:64s', 128, 'depth-anything-frames:120s'),
  ('depth-anything-frames:65s', 130, 'depth-anything-frames:120s'),
  ('depth-anything-frames:66s', 132, 'depth-anything-frames:120s'),
  ('depth-anything-frames:67s', 134, 'depth-anything-frames:120s'),
  ('depth-anything-frames:68s', 136, 'depth-anything-frames:120s'),
  ('depth-anything-frames:69s', 138, 'depth-anything-frames:120s'),
  ('depth-anything-frames:70s', 140, 'depth-anything-frames:120s'),
  ('depth-anything-frames:71s', 142, 'depth-anything-frames:120s'),
  ('depth-anything-frames:72s', 144, 'depth-anything-frames:120s'),
  ('depth-anything-frames:73s', 146, 'depth-anything-frames:120s'),
  ('depth-anything-frames:74s', 148, 'depth-anything-frames:120s'),
  ('depth-anything-frames:75s', 150, 'depth-anything-frames:120s'),
  ('depth-anything-frames:76s', 152, 'depth-anything-frames:120s'),
  ('depth-anything-frames:77s', 154, 'depth-anything-frames:120s'),
  ('depth-anything-frames:78s', 156, 'depth-anything-frames:120s'),
  ('depth-anything-frames:79s', 158, 'depth-anything-frames:120s'),
  ('depth-anything-frames:80s', 160, 'depth-anything-frames:120s')
) AS per_second(model_identifier, credit_cost, bucket_identifier)
LEFT JOIN public.model_pricing AS bucket ON bucket.model_identifier = per_second.bucket_identifier
ON CONFLICT (model_identifier) DO NOTHING;

-- Guarded on the price 502 seeded, so an administrator's own retune is left alone
-- and a second run changes nothing.
UPDATE public.model_pricing SET credit_cost = 160 WHERE model_identifier = 'depth-anything-frames' AND credit_cost = 600;
