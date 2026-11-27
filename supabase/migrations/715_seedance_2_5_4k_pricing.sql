-- Seedance 2.5 native 4K (decided 2026-11-22; offered from 2026-11-25).
--
-- KIE released native 4K for bytedance/seedance-2-5 on 2026-11-19
-- (`resolution: "4k"`, 3840x2160 HEVC Main 10). A probe on 2026-11-22
-- rendered it; the August probes had refused it. A Seedance 2.5 request that
-- says 4K rendered and billed 1080p until this release; it now renders and
-- bills 4K.
--
-- Same conversion as every other Seedance 2.5 tier (migrations 304 / 324):
--   credits = ceil(KIE_rate x duration / 4) x 10
-- at KIE's 4K rates, 251 KIE cr/s with no reference video and 155 with one
-- ("-ref" bills the lower rate over input + output seconds). One row per
-- second across 4-30 s, as for the other tiers.
--
-- Seedance 2.5 Extend at 4K (only for a source that is already 4K): its rate
-- row is the price of two seconds at the 4K reference-video rate, 775, by the
-- rule of its 480p / 720p / 1080p rows (migration 643).
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- ON CONFLICT DO NOTHING keeps any admin override.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- 4K no video ref
  ('seedance-2-5:4s:4k', 2510, true, 'video'),
  ('seedance-2-5:5s:4k', 3140, true, 'video'),
  ('seedance-2-5:6s:4k', 3770, true, 'video'),
  ('seedance-2-5:7s:4k', 4400, true, 'video'),
  ('seedance-2-5:8s:4k', 5020, true, 'video'),
  ('seedance-2-5:9s:4k', 5650, true, 'video'),
  ('seedance-2-5:10s:4k', 6280, true, 'video'),
  ('seedance-2-5:11s:4k', 6910, true, 'video'),
  ('seedance-2-5:12s:4k', 7530, true, 'video'),
  ('seedance-2-5:13s:4k', 8160, true, 'video'),
  ('seedance-2-5:14s:4k', 8790, true, 'video'),
  ('seedance-2-5:15s:4k', 9420, true, 'video'),
  ('seedance-2-5:16s:4k', 10040, true, 'video'),
  ('seedance-2-5:17s:4k', 10670, true, 'video'),
  ('seedance-2-5:18s:4k', 11300, true, 'video'),
  ('seedance-2-5:19s:4k', 11930, true, 'video'),
  ('seedance-2-5:20s:4k', 12550, true, 'video'),
  ('seedance-2-5:21s:4k', 13180, true, 'video'),
  ('seedance-2-5:22s:4k', 13810, true, 'video'),
  ('seedance-2-5:23s:4k', 14440, true, 'video'),
  ('seedance-2-5:24s:4k', 15060, true, 'video'),
  ('seedance-2-5:25s:4k', 15690, true, 'video'),
  ('seedance-2-5:26s:4k', 16320, true, 'video'),
  ('seedance-2-5:27s:4k', 16950, true, 'video'),
  ('seedance-2-5:28s:4k', 17570, true, 'video'),
  ('seedance-2-5:29s:4k', 18200, true, 'video'),
  ('seedance-2-5:30s:4k', 18830, true, 'video'),
  -- 4K with video ref
  ('seedance-2-5:4s:4k-ref', 1550, true, 'video'),
  ('seedance-2-5:5s:4k-ref', 1940, true, 'video'),
  ('seedance-2-5:6s:4k-ref', 2330, true, 'video'),
  ('seedance-2-5:7s:4k-ref', 2720, true, 'video'),
  ('seedance-2-5:8s:4k-ref', 3100, true, 'video'),
  ('seedance-2-5:9s:4k-ref', 3490, true, 'video'),
  ('seedance-2-5:10s:4k-ref', 3880, true, 'video'),
  ('seedance-2-5:11s:4k-ref', 4270, true, 'video'),
  ('seedance-2-5:12s:4k-ref', 4650, true, 'video'),
  ('seedance-2-5:13s:4k-ref', 5040, true, 'video'),
  ('seedance-2-5:14s:4k-ref', 5430, true, 'video'),
  ('seedance-2-5:15s:4k-ref', 5820, true, 'video'),
  ('seedance-2-5:16s:4k-ref', 6200, true, 'video'),
  ('seedance-2-5:17s:4k-ref', 6590, true, 'video'),
  ('seedance-2-5:18s:4k-ref', 6980, true, 'video'),
  ('seedance-2-5:19s:4k-ref', 7370, true, 'video'),
  ('seedance-2-5:20s:4k-ref', 7750, true, 'video'),
  ('seedance-2-5:21s:4k-ref', 8140, true, 'video'),
  ('seedance-2-5:22s:4k-ref', 8530, true, 'video'),
  ('seedance-2-5:23s:4k-ref', 8920, true, 'video'),
  ('seedance-2-5:24s:4k-ref', 9300, true, 'video'),
  ('seedance-2-5:25s:4k-ref', 9690, true, 'video'),
  ('seedance-2-5:26s:4k-ref', 10080, true, 'video'),
  ('seedance-2-5:27s:4k-ref', 10470, true, 'video'),
  ('seedance-2-5:28s:4k-ref', 10850, true, 'video'),
  ('seedance-2-5:29s:4k-ref', 11240, true, 'video'),
  ('seedance-2-5:30s:4k-ref', 11630, true, 'video'),
  -- Seedance 2.5 Extend at 4K: two seconds at the 4K reference-video rate
  ('seedance-2-5-extend:4k:per-2s', 775, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
