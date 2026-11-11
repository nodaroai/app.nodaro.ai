-- Kling 4.0 Flash (KIE) — one video model over two endpoints, picked by what
-- is wired:
--   kling-4-flash → kling-4.0/flash-keyframe-to-video (a start frame alone)
--                 → kling-4.0/flash-reference-to-video (everything else)
-- One row per second across 3-20s at 720p (its only tier), plus `-ref` rows
-- (a run with a reference video: the per-second rate of its BILLED duration,
-- output + max(output, input seconds)). Base credits = KIE cr/s × seconds ×
-- 2.5, rounded up to the next 10. Machine-generated; values MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('kling-4-flash', 220, true, 'video'),
  ('kling-4-flash:3s:720p', 130, true, 'video'),
  ('kling-4-flash:4s:720p', 170, true, 'video'),
  ('kling-4-flash:5s:720p', 220, true, 'video'),
  ('kling-4-flash:6s:720p', 260, true, 'video'),
  ('kling-4-flash:7s:720p', 300, true, 'video'),
  ('kling-4-flash:8s:720p', 340, true, 'video'),
  ('kling-4-flash:9s:720p', 390, true, 'video'),
  ('kling-4-flash:10s:720p', 430, true, 'video'),
  ('kling-4-flash:11s:720p', 470, true, 'video'),
  ('kling-4-flash:12s:720p', 510, true, 'video'),
  ('kling-4-flash:13s:720p', 560, true, 'video'),
  ('kling-4-flash:14s:720p', 600, true, 'video'),
  ('kling-4-flash:15s:720p', 640, true, 'video'),
  ('kling-4-flash:16s:720p', 680, true, 'video'),
  ('kling-4-flash:17s:720p', 730, true, 'video'),
  ('kling-4-flash:18s:720p', 770, true, 'video'),
  ('kling-4-flash:19s:720p', 810, true, 'video'),
  ('kling-4-flash:20s:720p', 850, true, 'video'),
  ('kling-4-flash:3s:720p-ref', 90, true, 'video'),
  ('kling-4-flash:4s:720p-ref', 120, true, 'video'),
  ('kling-4-flash:5s:720p-ref', 150, true, 'video'),
  ('kling-4-flash:6s:720p-ref', 170, true, 'video'),
  ('kling-4-flash:7s:720p-ref', 200, true, 'video'),
  ('kling-4-flash:8s:720p-ref', 230, true, 'video'),
  ('kling-4-flash:9s:720p-ref', 260, true, 'video'),
  ('kling-4-flash:10s:720p-ref', 290, true, 'video'),
  ('kling-4-flash:11s:720p-ref', 320, true, 'video'),
  ('kling-4-flash:12s:720p-ref', 340, true, 'video'),
  ('kling-4-flash:13s:720p-ref', 370, true, 'video'),
  ('kling-4-flash:14s:720p-ref', 400, true, 'video'),
  ('kling-4-flash:15s:720p-ref', 430, true, 'video'),
  ('kling-4-flash:16s:720p-ref', 460, true, 'video'),
  ('kling-4-flash:17s:720p-ref', 490, true, 'video'),
  ('kling-4-flash:18s:720p-ref', 510, true, 'video'),
  ('kling-4-flash:19s:720p-ref', 540, true, 'video'),
  ('kling-4-flash:20s:720p-ref', 570, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
