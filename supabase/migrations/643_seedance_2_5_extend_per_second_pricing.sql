-- Seedance 2.5 Extend (extend-video node, provider seedance-2-5-extend) is
-- charged per second of video it sends and adds: the source's last 10 seconds
-- (or all of a shorter source) plus the seconds added, at the per-second rate
-- the earlier per-length rows were built from. A credit_cost holds whole
-- credits and the rates are not whole, so each resolution's row is the price
-- of TWO seconds; a run is the row x (seconds sent + seconds added) / 2,
-- rounded up once. The same figures as STATIC_CREDIT_COSTS.
--
-- 1. The three rate rows.
--
-- WHY A SELECT AND NOT A PLAIN VALUES LIST. A reservation reads the switches
-- of the row it reserves (`is_enabled`, `tier_restriction`: readPricingRow in
-- backend/src/ee/billing/credits.ts), so a resolution an administrator
-- switched off or restricted to a tier on the earlier per-length rows must
-- not come back on through its rate row. Each rate row therefore takes
-- `is_enabled`, `tier_restriction` and `category` (the columns migration 590
-- carries for the same reason) from that resolution's 8-second row, the
-- default run's: `seedance-2-5-extend:8s:<res>` — whatever this deployment
-- holds, with nobody checking first. An 8-second row this deployment does not
-- have gives the defaults a row-less id prices with (enabled, unrestricted)
-- in 'video'. The ids and prices are literals, never read from the earlier
-- rows. Proven by supabase/tests/seedance-2-5-extend-rate-rows.behavior.sql.
--
-- ON CONFLICT DO NOTHING keeps any admin override, and makes a second run a
-- no-op.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction, category)
SELECT
  rate.model_identifier,
  rate.credit_cost,
  CASE WHEN earlier.model_identifier IS NULL THEN true ELSE earlier.is_enabled END,
  earlier.tier_restriction,
  CASE WHEN earlier.model_identifier IS NULL THEN 'video' ELSE earlier.category END
FROM (VALUES
  ('seedance-2-5-extend:480p:per-2s', 85, 'seedance-2-5-extend:8s:480p'),
  ('seedance-2-5-extend:720p:per-2s', 190, 'seedance-2-5-extend:8s:720p'),
  ('seedance-2-5-extend:1080p:per-2s', 475, 'seedance-2-5-extend:8s:1080p')
) AS rate(model_identifier, credit_cost, earlier_identifier)
LEFT JOIN public.model_pricing AS earlier ON earlier.model_identifier = rate.earlier_identifier
ON CONFLICT (model_identifier) DO NOTHING;

-- 2. The earlier per-length rows, seedance-2-5-extend:<N>s:<res> (N = 4..30).
--
-- No run is priced on them any more, but a client built on an earlier
-- @nodaro/shared still names one to quote an extend. Each is repriced to the
-- MOST a run of that length can cost: the whole 10-second window sent, its
-- resolution's rate row x (10 + N) / 2, rounded up once — so such a quote is
-- never below the charge. Generated from the code's own rule (STATIC_CREDIT_COSTS
-- computes the same figures; static-costs-match-migrations.test.ts holds them
-- equal).
--
-- UNGUARDED on purpose: a row an administrator repriced is moved too, since a
-- figure left below the most a run costs would let such a quote under-state
-- the charge. Only credit_cost changes; each row's switches stay as they are.
-- 480p
UPDATE public.model_pricing SET credit_cost = 595 WHERE model_identifier = 'seedance-2-5-extend:4s:480p';
UPDATE public.model_pricing SET credit_cost = 638 WHERE model_identifier = 'seedance-2-5-extend:5s:480p';
UPDATE public.model_pricing SET credit_cost = 680 WHERE model_identifier = 'seedance-2-5-extend:6s:480p';
UPDATE public.model_pricing SET credit_cost = 723 WHERE model_identifier = 'seedance-2-5-extend:7s:480p';
UPDATE public.model_pricing SET credit_cost = 765 WHERE model_identifier = 'seedance-2-5-extend:8s:480p';
UPDATE public.model_pricing SET credit_cost = 808 WHERE model_identifier = 'seedance-2-5-extend:9s:480p';
UPDATE public.model_pricing SET credit_cost = 850 WHERE model_identifier = 'seedance-2-5-extend:10s:480p';
UPDATE public.model_pricing SET credit_cost = 893 WHERE model_identifier = 'seedance-2-5-extend:11s:480p';
UPDATE public.model_pricing SET credit_cost = 935 WHERE model_identifier = 'seedance-2-5-extend:12s:480p';
UPDATE public.model_pricing SET credit_cost = 978 WHERE model_identifier = 'seedance-2-5-extend:13s:480p';
UPDATE public.model_pricing SET credit_cost = 1020 WHERE model_identifier = 'seedance-2-5-extend:14s:480p';
UPDATE public.model_pricing SET credit_cost = 1063 WHERE model_identifier = 'seedance-2-5-extend:15s:480p';
UPDATE public.model_pricing SET credit_cost = 1105 WHERE model_identifier = 'seedance-2-5-extend:16s:480p';
UPDATE public.model_pricing SET credit_cost = 1148 WHERE model_identifier = 'seedance-2-5-extend:17s:480p';
UPDATE public.model_pricing SET credit_cost = 1190 WHERE model_identifier = 'seedance-2-5-extend:18s:480p';
UPDATE public.model_pricing SET credit_cost = 1233 WHERE model_identifier = 'seedance-2-5-extend:19s:480p';
UPDATE public.model_pricing SET credit_cost = 1275 WHERE model_identifier = 'seedance-2-5-extend:20s:480p';
UPDATE public.model_pricing SET credit_cost = 1318 WHERE model_identifier = 'seedance-2-5-extend:21s:480p';
UPDATE public.model_pricing SET credit_cost = 1360 WHERE model_identifier = 'seedance-2-5-extend:22s:480p';
UPDATE public.model_pricing SET credit_cost = 1403 WHERE model_identifier = 'seedance-2-5-extend:23s:480p';
UPDATE public.model_pricing SET credit_cost = 1445 WHERE model_identifier = 'seedance-2-5-extend:24s:480p';
UPDATE public.model_pricing SET credit_cost = 1488 WHERE model_identifier = 'seedance-2-5-extend:25s:480p';
UPDATE public.model_pricing SET credit_cost = 1530 WHERE model_identifier = 'seedance-2-5-extend:26s:480p';
UPDATE public.model_pricing SET credit_cost = 1573 WHERE model_identifier = 'seedance-2-5-extend:27s:480p';
UPDATE public.model_pricing SET credit_cost = 1615 WHERE model_identifier = 'seedance-2-5-extend:28s:480p';
UPDATE public.model_pricing SET credit_cost = 1658 WHERE model_identifier = 'seedance-2-5-extend:29s:480p';
UPDATE public.model_pricing SET credit_cost = 1700 WHERE model_identifier = 'seedance-2-5-extend:30s:480p';
-- 720p
UPDATE public.model_pricing SET credit_cost = 1330 WHERE model_identifier = 'seedance-2-5-extend:4s:720p';
UPDATE public.model_pricing SET credit_cost = 1425 WHERE model_identifier = 'seedance-2-5-extend:5s:720p';
UPDATE public.model_pricing SET credit_cost = 1520 WHERE model_identifier = 'seedance-2-5-extend:6s:720p';
UPDATE public.model_pricing SET credit_cost = 1615 WHERE model_identifier = 'seedance-2-5-extend:7s:720p';
UPDATE public.model_pricing SET credit_cost = 1710 WHERE model_identifier = 'seedance-2-5-extend:8s:720p';
UPDATE public.model_pricing SET credit_cost = 1805 WHERE model_identifier = 'seedance-2-5-extend:9s:720p';
UPDATE public.model_pricing SET credit_cost = 1900 WHERE model_identifier = 'seedance-2-5-extend:10s:720p';
UPDATE public.model_pricing SET credit_cost = 1995 WHERE model_identifier = 'seedance-2-5-extend:11s:720p';
UPDATE public.model_pricing SET credit_cost = 2090 WHERE model_identifier = 'seedance-2-5-extend:12s:720p';
UPDATE public.model_pricing SET credit_cost = 2185 WHERE model_identifier = 'seedance-2-5-extend:13s:720p';
UPDATE public.model_pricing SET credit_cost = 2280 WHERE model_identifier = 'seedance-2-5-extend:14s:720p';
UPDATE public.model_pricing SET credit_cost = 2375 WHERE model_identifier = 'seedance-2-5-extend:15s:720p';
UPDATE public.model_pricing SET credit_cost = 2470 WHERE model_identifier = 'seedance-2-5-extend:16s:720p';
UPDATE public.model_pricing SET credit_cost = 2565 WHERE model_identifier = 'seedance-2-5-extend:17s:720p';
UPDATE public.model_pricing SET credit_cost = 2660 WHERE model_identifier = 'seedance-2-5-extend:18s:720p';
UPDATE public.model_pricing SET credit_cost = 2755 WHERE model_identifier = 'seedance-2-5-extend:19s:720p';
UPDATE public.model_pricing SET credit_cost = 2850 WHERE model_identifier = 'seedance-2-5-extend:20s:720p';
UPDATE public.model_pricing SET credit_cost = 2945 WHERE model_identifier = 'seedance-2-5-extend:21s:720p';
UPDATE public.model_pricing SET credit_cost = 3040 WHERE model_identifier = 'seedance-2-5-extend:22s:720p';
UPDATE public.model_pricing SET credit_cost = 3135 WHERE model_identifier = 'seedance-2-5-extend:23s:720p';
UPDATE public.model_pricing SET credit_cost = 3230 WHERE model_identifier = 'seedance-2-5-extend:24s:720p';
UPDATE public.model_pricing SET credit_cost = 3325 WHERE model_identifier = 'seedance-2-5-extend:25s:720p';
UPDATE public.model_pricing SET credit_cost = 3420 WHERE model_identifier = 'seedance-2-5-extend:26s:720p';
UPDATE public.model_pricing SET credit_cost = 3515 WHERE model_identifier = 'seedance-2-5-extend:27s:720p';
UPDATE public.model_pricing SET credit_cost = 3610 WHERE model_identifier = 'seedance-2-5-extend:28s:720p';
UPDATE public.model_pricing SET credit_cost = 3705 WHERE model_identifier = 'seedance-2-5-extend:29s:720p';
UPDATE public.model_pricing SET credit_cost = 3800 WHERE model_identifier = 'seedance-2-5-extend:30s:720p';
-- 1080p
UPDATE public.model_pricing SET credit_cost = 3325 WHERE model_identifier = 'seedance-2-5-extend:4s:1080p';
UPDATE public.model_pricing SET credit_cost = 3563 WHERE model_identifier = 'seedance-2-5-extend:5s:1080p';
UPDATE public.model_pricing SET credit_cost = 3800 WHERE model_identifier = 'seedance-2-5-extend:6s:1080p';
UPDATE public.model_pricing SET credit_cost = 4038 WHERE model_identifier = 'seedance-2-5-extend:7s:1080p';
UPDATE public.model_pricing SET credit_cost = 4275 WHERE model_identifier = 'seedance-2-5-extend:8s:1080p';
UPDATE public.model_pricing SET credit_cost = 4513 WHERE model_identifier = 'seedance-2-5-extend:9s:1080p';
UPDATE public.model_pricing SET credit_cost = 4750 WHERE model_identifier = 'seedance-2-5-extend:10s:1080p';
UPDATE public.model_pricing SET credit_cost = 4988 WHERE model_identifier = 'seedance-2-5-extend:11s:1080p';
UPDATE public.model_pricing SET credit_cost = 5225 WHERE model_identifier = 'seedance-2-5-extend:12s:1080p';
UPDATE public.model_pricing SET credit_cost = 5463 WHERE model_identifier = 'seedance-2-5-extend:13s:1080p';
UPDATE public.model_pricing SET credit_cost = 5700 WHERE model_identifier = 'seedance-2-5-extend:14s:1080p';
UPDATE public.model_pricing SET credit_cost = 5938 WHERE model_identifier = 'seedance-2-5-extend:15s:1080p';
UPDATE public.model_pricing SET credit_cost = 6175 WHERE model_identifier = 'seedance-2-5-extend:16s:1080p';
UPDATE public.model_pricing SET credit_cost = 6413 WHERE model_identifier = 'seedance-2-5-extend:17s:1080p';
UPDATE public.model_pricing SET credit_cost = 6650 WHERE model_identifier = 'seedance-2-5-extend:18s:1080p';
UPDATE public.model_pricing SET credit_cost = 6888 WHERE model_identifier = 'seedance-2-5-extend:19s:1080p';
UPDATE public.model_pricing SET credit_cost = 7125 WHERE model_identifier = 'seedance-2-5-extend:20s:1080p';
UPDATE public.model_pricing SET credit_cost = 7363 WHERE model_identifier = 'seedance-2-5-extend:21s:1080p';
UPDATE public.model_pricing SET credit_cost = 7600 WHERE model_identifier = 'seedance-2-5-extend:22s:1080p';
UPDATE public.model_pricing SET credit_cost = 7838 WHERE model_identifier = 'seedance-2-5-extend:23s:1080p';
UPDATE public.model_pricing SET credit_cost = 8075 WHERE model_identifier = 'seedance-2-5-extend:24s:1080p';
UPDATE public.model_pricing SET credit_cost = 8313 WHERE model_identifier = 'seedance-2-5-extend:25s:1080p';
UPDATE public.model_pricing SET credit_cost = 8550 WHERE model_identifier = 'seedance-2-5-extend:26s:1080p';
UPDATE public.model_pricing SET credit_cost = 8788 WHERE model_identifier = 'seedance-2-5-extend:27s:1080p';
UPDATE public.model_pricing SET credit_cost = 9025 WHERE model_identifier = 'seedance-2-5-extend:28s:1080p';
UPDATE public.model_pricing SET credit_cost = 9263 WHERE model_identifier = 'seedance-2-5-extend:29s:1080p';
UPDATE public.model_pricing SET credit_cost = 9500 WHERE model_identifier = 'seedance-2-5-extend:30s:1080p';
