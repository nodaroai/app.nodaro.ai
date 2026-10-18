-- Vidu Q4 (KIE vidu-q4/image-to-video + vidu-q4/reference-to-video) pricing —
-- serves the generate-video / image-to-video nodes.
--
-- ONE per-second ladder for both endpoints and for audio on or off, one seeded
-- row per allowed duration (3-16s) × 540p/720p/1080p/2k/4k:
--   credits = the tier's per-second base rate × seconds, rounded UP to the
--   next 10 (the minimax-h3 / seedance-2-5 rule).
--   Base per second: 540p 18, 720p 38, 1080p 48, 2k 76, 4k 156.
-- ONE ROW PER SECOND rather than a coarse ladder: the tier lookup snaps UP and
-- falls back to the LAST tier, and commit_credits can only refund a surplus —
-- never collect an upward delta.
-- The bare id is the DEFAULT render (5s @ 720p): the duration falls back to the
-- catalog's defaultDuration and the resolution to PRICING_DEFAULT_RESOLUTION
-- (@nodaro/shared), which is the 720p the provider layer sends.
-- No "-ref" and no ":audio" dimension. The 4k rows are closed to the free tier
-- (stripe-config blockedModels).
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts
-- (static-costs-match-migrations.test.ts). Machine-generated — never edit one
-- value by hand. Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO
-- NOTHING (preserves admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('vidu-q4', 190, true, 'video'),
  ('vidu-q4:3s:540p', 60, true, 'video'),
  ('vidu-q4:4s:540p', 80, true, 'video'),
  ('vidu-q4:5s:540p', 90, true, 'video'),
  ('vidu-q4:6s:540p', 110, true, 'video'),
  ('vidu-q4:7s:540p', 130, true, 'video'),
  ('vidu-q4:8s:540p', 150, true, 'video'),
  ('vidu-q4:9s:540p', 170, true, 'video'),
  ('vidu-q4:10s:540p', 180, true, 'video'),
  ('vidu-q4:11s:540p', 200, true, 'video'),
  ('vidu-q4:12s:540p', 220, true, 'video'),
  ('vidu-q4:13s:540p', 240, true, 'video'),
  ('vidu-q4:14s:540p', 260, true, 'video'),
  ('vidu-q4:15s:540p', 270, true, 'video'),
  ('vidu-q4:16s:540p', 290, true, 'video'),
  ('vidu-q4:3s:720p', 120, true, 'video'),
  ('vidu-q4:4s:720p', 160, true, 'video'),
  ('vidu-q4:5s:720p', 190, true, 'video'),
  ('vidu-q4:6s:720p', 230, true, 'video'),
  ('vidu-q4:7s:720p', 270, true, 'video'),
  ('vidu-q4:8s:720p', 310, true, 'video'),
  ('vidu-q4:9s:720p', 350, true, 'video'),
  ('vidu-q4:10s:720p', 380, true, 'video'),
  ('vidu-q4:11s:720p', 420, true, 'video'),
  ('vidu-q4:12s:720p', 460, true, 'video'),
  ('vidu-q4:13s:720p', 500, true, 'video'),
  ('vidu-q4:14s:720p', 540, true, 'video'),
  ('vidu-q4:15s:720p', 570, true, 'video'),
  ('vidu-q4:16s:720p', 610, true, 'video'),
  ('vidu-q4:3s:1080p', 150, true, 'video'),
  ('vidu-q4:4s:1080p', 200, true, 'video'),
  ('vidu-q4:5s:1080p', 240, true, 'video'),
  ('vidu-q4:6s:1080p', 290, true, 'video'),
  ('vidu-q4:7s:1080p', 340, true, 'video'),
  ('vidu-q4:8s:1080p', 390, true, 'video'),
  ('vidu-q4:9s:1080p', 440, true, 'video'),
  ('vidu-q4:10s:1080p', 480, true, 'video'),
  ('vidu-q4:11s:1080p', 530, true, 'video'),
  ('vidu-q4:12s:1080p', 580, true, 'video'),
  ('vidu-q4:13s:1080p', 630, true, 'video'),
  ('vidu-q4:14s:1080p', 680, true, 'video'),
  ('vidu-q4:15s:1080p', 720, true, 'video'),
  ('vidu-q4:16s:1080p', 770, true, 'video'),
  ('vidu-q4:3s:2k', 230, true, 'video'),
  ('vidu-q4:4s:2k', 310, true, 'video'),
  ('vidu-q4:5s:2k', 380, true, 'video'),
  ('vidu-q4:6s:2k', 460, true, 'video'),
  ('vidu-q4:7s:2k', 540, true, 'video'),
  ('vidu-q4:8s:2k', 610, true, 'video'),
  ('vidu-q4:9s:2k', 690, true, 'video'),
  ('vidu-q4:10s:2k', 760, true, 'video'),
  ('vidu-q4:11s:2k', 840, true, 'video'),
  ('vidu-q4:12s:2k', 920, true, 'video'),
  ('vidu-q4:13s:2k', 990, true, 'video'),
  ('vidu-q4:14s:2k', 1070, true, 'video'),
  ('vidu-q4:15s:2k', 1140, true, 'video'),
  ('vidu-q4:16s:2k', 1220, true, 'video'),
  ('vidu-q4:3s:4k', 470, true, 'video'),
  ('vidu-q4:4s:4k', 630, true, 'video'),
  ('vidu-q4:5s:4k', 780, true, 'video'),
  ('vidu-q4:6s:4k', 940, true, 'video'),
  ('vidu-q4:7s:4k', 1100, true, 'video'),
  ('vidu-q4:8s:4k', 1250, true, 'video'),
  ('vidu-q4:9s:4k', 1410, true, 'video'),
  ('vidu-q4:10s:4k', 1560, true, 'video'),
  ('vidu-q4:11s:4k', 1720, true, 'video'),
  ('vidu-q4:12s:4k', 1880, true, 'video'),
  ('vidu-q4:13s:4k', 2030, true, 'video'),
  ('vidu-q4:14s:4k', 2190, true, 'video'),
  ('vidu-q4:15s:4k', 2340, true, 'video'),
  ('vidu-q4:16s:4k', 2500, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
