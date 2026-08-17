-- Seedance 2.5 1080p tier (KIE "Seedance 2.5 now supports 1080P", 2026-08-17).
--
-- Probe-verified against api.kie.ai on 2026-08-17: 1080p now passes resolution
-- validation (the 2026-08-08 probe had it rejected); 1440p/2k/4k are still
-- rejected with "not within the range of allowed options", and duration is
-- still capped at 30s. KIE rates: 114 cr/s no-video-ref / 68.5 cr/s with
-- video ref ("-ref" bills the lower unit rate over (input + output) seconds
-- instead of output alone).
--
-- Same conversion as the existing 480p/720p rows (migration 304):
--   credits = ceil(KIE_rate x duration / 4) x 10
-- ONE ROW PER SECOND across 4-30s, mirroring 304's reasoning: the tier lookup
-- snaps up and falls back to the last tier, and commit_credits can only refund
-- a surplus — never collect an upward delta.
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- 1080p no video ref
  ('seedance-2-5:4s:1080p',   1140, true, 'video'),
  ('seedance-2-5:5s:1080p',   1430, true, 'video'),
  ('seedance-2-5:6s:1080p',   1710, true, 'video'),
  ('seedance-2-5:7s:1080p',   2000, true, 'video'),
  ('seedance-2-5:8s:1080p',   2280, true, 'video'),
  ('seedance-2-5:9s:1080p',   2570, true, 'video'),
  ('seedance-2-5:10s:1080p',   2850, true, 'video'),
  ('seedance-2-5:11s:1080p',   3140, true, 'video'),
  ('seedance-2-5:12s:1080p',   3420, true, 'video'),
  ('seedance-2-5:13s:1080p',   3710, true, 'video'),
  ('seedance-2-5:14s:1080p',   3990, true, 'video'),
  ('seedance-2-5:15s:1080p',   4280, true, 'video'),
  ('seedance-2-5:16s:1080p',   4560, true, 'video'),
  ('seedance-2-5:17s:1080p',   4850, true, 'video'),
  ('seedance-2-5:18s:1080p',   5130, true, 'video'),
  ('seedance-2-5:19s:1080p',   5420, true, 'video'),
  ('seedance-2-5:20s:1080p',   5700, true, 'video'),
  ('seedance-2-5:21s:1080p',   5990, true, 'video'),
  ('seedance-2-5:22s:1080p',   6270, true, 'video'),
  ('seedance-2-5:23s:1080p',   6560, true, 'video'),
  ('seedance-2-5:24s:1080p',   6840, true, 'video'),
  ('seedance-2-5:25s:1080p',   7130, true, 'video'),
  ('seedance-2-5:26s:1080p',   7410, true, 'video'),
  ('seedance-2-5:27s:1080p',   7700, true, 'video'),
  ('seedance-2-5:28s:1080p',   7980, true, 'video'),
  ('seedance-2-5:29s:1080p',   8270, true, 'video'),
  ('seedance-2-5:30s:1080p',   8550, true, 'video'),
  -- 1080p with video ref
  ('seedance-2-5:4s:1080p-ref',   690, true, 'video'),
  ('seedance-2-5:5s:1080p-ref',   860, true, 'video'),
  ('seedance-2-5:6s:1080p-ref',  1030, true, 'video'),
  ('seedance-2-5:7s:1080p-ref',  1200, true, 'video'),
  ('seedance-2-5:8s:1080p-ref',  1370, true, 'video'),
  ('seedance-2-5:9s:1080p-ref',  1550, true, 'video'),
  ('seedance-2-5:10s:1080p-ref',  1720, true, 'video'),
  ('seedance-2-5:11s:1080p-ref',  1890, true, 'video'),
  ('seedance-2-5:12s:1080p-ref',  2060, true, 'video'),
  ('seedance-2-5:13s:1080p-ref',  2230, true, 'video'),
  ('seedance-2-5:14s:1080p-ref',  2400, true, 'video'),
  ('seedance-2-5:15s:1080p-ref',  2570, true, 'video'),
  ('seedance-2-5:16s:1080p-ref',  2740, true, 'video'),
  ('seedance-2-5:17s:1080p-ref',  2920, true, 'video'),
  ('seedance-2-5:18s:1080p-ref',  3090, true, 'video'),
  ('seedance-2-5:19s:1080p-ref',  3260, true, 'video'),
  ('seedance-2-5:20s:1080p-ref',  3430, true, 'video'),
  ('seedance-2-5:21s:1080p-ref',  3600, true, 'video'),
  ('seedance-2-5:22s:1080p-ref',  3770, true, 'video'),
  ('seedance-2-5:23s:1080p-ref',  3940, true, 'video'),
  ('seedance-2-5:24s:1080p-ref',  4110, true, 'video'),
  ('seedance-2-5:25s:1080p-ref',  4290, true, 'video'),
  ('seedance-2-5:26s:1080p-ref',  4460, true, 'video'),
  ('seedance-2-5:27s:1080p-ref',  4630, true, 'video'),
  ('seedance-2-5:28s:1080p-ref',  4800, true, 'video'),
  ('seedance-2-5:29s:1080p-ref',  4970, true, 'video'),
  ('seedance-2-5:30s:1080p-ref',  5140, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
