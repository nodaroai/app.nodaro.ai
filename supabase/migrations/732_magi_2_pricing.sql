-- MAGI-2 (KIE) — one video model id over three task models, picked by what is
-- wired:
--   magi-2 → magi-2/text-to-video      (nothing wired)
--          → magi-2/image-to-video     (a first frame, optionally a last frame)
--          → magi-2/reference-to-video (any reference image, video or audio)
-- One row per whole second 4-30 at 1080p, the only resolution; the same price
-- on every task model, with sound on or off and whatever references a run
-- carries. Base credits = 44 × seconds, rounded up to the next 10. The bare id
-- is the default render (5s 1080p). Machine-generated; values MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('magi-2', 220, true, 'video'),
  ('magi-2:4s:1080p', 180, true, 'video'),
  ('magi-2:5s:1080p', 220, true, 'video'),
  ('magi-2:6s:1080p', 270, true, 'video'),
  ('magi-2:7s:1080p', 310, true, 'video'),
  ('magi-2:8s:1080p', 360, true, 'video'),
  ('magi-2:9s:1080p', 400, true, 'video'),
  ('magi-2:10s:1080p', 440, true, 'video'),
  ('magi-2:11s:1080p', 490, true, 'video'),
  ('magi-2:12s:1080p', 530, true, 'video'),
  ('magi-2:13s:1080p', 580, true, 'video'),
  ('magi-2:14s:1080p', 620, true, 'video'),
  ('magi-2:15s:1080p', 660, true, 'video'),
  ('magi-2:16s:1080p', 710, true, 'video'),
  ('magi-2:17s:1080p', 750, true, 'video'),
  ('magi-2:18s:1080p', 800, true, 'video'),
  ('magi-2:19s:1080p', 840, true, 'video'),
  ('magi-2:20s:1080p', 880, true, 'video'),
  ('magi-2:21s:1080p', 930, true, 'video'),
  ('magi-2:22s:1080p', 970, true, 'video'),
  ('magi-2:23s:1080p', 1020, true, 'video'),
  ('magi-2:24s:1080p', 1060, true, 'video'),
  ('magi-2:25s:1080p', 1100, true, 'video'),
  ('magi-2:26s:1080p', 1150, true, 'video'),
  ('magi-2:27s:1080p', 1190, true, 'video'),
  ('magi-2:28s:1080p', 1240, true, 'video'),
  ('magi-2:29s:1080p', 1280, true, 'video'),
  ('magi-2:30s:1080p', 1320, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
