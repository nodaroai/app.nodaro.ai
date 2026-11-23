-- LTX 2.5 Fast and Pro (KIE) — one video model id per tier over two endpoints,
-- picked by what is wired:
--   ltx-2.5-fast → ltx/2-5-fast-image-to-video (a start frame)
--                → ltx/2-5-fast-text-to-video  (no image)
--   ltx-2.5-pro  → ltx/2-5-pro-image-to-video  / ltx/2-5-pro-text-to-video
-- One row per length each tier renders at each resolution: Fast 6-20s (2s steps)
-- at 720p and 1080p, 6/8/10s at 1440p; Pro 6/8/10s at 720p and 1080p. Base
-- credits = KIE cr/s × seconds × 2.5, rounded up to the next 10; KIE cr/s on both
-- endpoints and at every frame rate: Fast 10.8 / 15.6 / 22.8, Pro 14.4 / 20.4.
-- The bare ids are the default render (10s 1080p). Machine-generated; values
-- MUST match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('ltx-2.5-fast', 390, true, 'video'),
  ('ltx-2.5-pro', 510, true, 'video'),
  ('ltx-2.5-fast:6s:720p', 170, true, 'video'),
  ('ltx-2.5-fast:8s:720p', 220, true, 'video'),
  ('ltx-2.5-fast:10s:720p', 270, true, 'video'),
  ('ltx-2.5-fast:12s:720p', 330, true, 'video'),
  ('ltx-2.5-fast:14s:720p', 380, true, 'video'),
  ('ltx-2.5-fast:16s:720p', 440, true, 'video'),
  ('ltx-2.5-fast:18s:720p', 490, true, 'video'),
  ('ltx-2.5-fast:20s:720p', 540, true, 'video'),
  ('ltx-2.5-fast:6s:1080p', 240, true, 'video'),
  ('ltx-2.5-fast:8s:1080p', 320, true, 'video'),
  ('ltx-2.5-fast:10s:1080p', 390, true, 'video'),
  ('ltx-2.5-fast:12s:1080p', 470, true, 'video'),
  ('ltx-2.5-fast:14s:1080p', 550, true, 'video'),
  ('ltx-2.5-fast:16s:1080p', 630, true, 'video'),
  ('ltx-2.5-fast:18s:1080p', 710, true, 'video'),
  ('ltx-2.5-fast:20s:1080p', 780, true, 'video'),
  ('ltx-2.5-fast:6s:1440p', 350, true, 'video'),
  ('ltx-2.5-fast:8s:1440p', 460, true, 'video'),
  ('ltx-2.5-fast:10s:1440p', 570, true, 'video'),
  ('ltx-2.5-pro:6s:720p', 220, true, 'video'),
  ('ltx-2.5-pro:8s:720p', 290, true, 'video'),
  ('ltx-2.5-pro:10s:720p', 360, true, 'video'),
  ('ltx-2.5-pro:6s:1080p', 310, true, 'video'),
  ('ltx-2.5-pro:8s:1080p', 410, true, 'video'),
  ('ltx-2.5-pro:10s:1080p', 510, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
