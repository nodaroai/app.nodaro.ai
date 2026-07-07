-- Grok Imagine Video 1.5 (KIE) pricing — image-to-video, per-second billing.
-- Identifier format: grok-imagine-video-1.5:{N}s:{resolution}  (resolution = 480p | 720p)
-- Credits derive from the provider's per-second billing at 0% markup (same methodology
-- as Seedance-2), including a small per-input-image surcharge baked into every tier
-- (this model always takes exactly 1 image).
-- Base fallback = 8s / 480p = 30. Durations 1-15s, resolutions 480p/720p → 30 composites.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('grok-imagine-video-1.5', 30, true, 'image-to-video'),
  -- 480p
  ('grok-imagine-video-1.5:1s:480p', 5, true, 'image-to-video'),
  ('grok-imagine-video-1.5:2s:480p', 8, true, 'image-to-video'),
  ('grok-imagine-video-1.5:3s:480p', 12, true, 'image-to-video'),
  ('grok-imagine-video-1.5:4s:480p', 15, true, 'image-to-video'),
  ('grok-imagine-video-1.5:5s:480p', 19, true, 'image-to-video'),
  ('grok-imagine-video-1.5:6s:480p', 23, true, 'image-to-video'),
  ('grok-imagine-video-1.5:7s:480p', 26, true, 'image-to-video'),
  ('grok-imagine-video-1.5:8s:480p', 30, true, 'image-to-video'),
  ('grok-imagine-video-1.5:9s:480p', 34, true, 'image-to-video'),
  ('grok-imagine-video-1.5:10s:480p', 37, true, 'image-to-video'),
  ('grok-imagine-video-1.5:11s:480p', 41, true, 'image-to-video'),
  ('grok-imagine-video-1.5:12s:480p', 44, true, 'image-to-video'),
  ('grok-imagine-video-1.5:13s:480p', 48, true, 'image-to-video'),
  ('grok-imagine-video-1.5:14s:480p', 52, true, 'image-to-video'),
  ('grok-imagine-video-1.5:15s:480p', 55, true, 'image-to-video'),
  -- 720p
  ('grok-imagine-video-1.5:1s:720p', 7, true, 'image-to-video'),
  ('grok-imagine-video-1.5:2s:720p', 13, true, 'image-to-video'),
  ('grok-imagine-video-1.5:3s:720p', 20, true, 'image-to-video'),
  ('grok-imagine-video-1.5:4s:720p', 26, true, 'image-to-video'),
  ('grok-imagine-video-1.5:5s:720p', 32, true, 'image-to-video'),
  ('grok-imagine-video-1.5:6s:720p', 38, true, 'image-to-video'),
  ('grok-imagine-video-1.5:7s:720p', 45, true, 'image-to-video'),
  ('grok-imagine-video-1.5:8s:720p', 51, true, 'image-to-video'),
  ('grok-imagine-video-1.5:9s:720p', 57, true, 'image-to-video'),
  ('grok-imagine-video-1.5:10s:720p', 63, true, 'image-to-video'),
  ('grok-imagine-video-1.5:11s:720p', 70, true, 'image-to-video'),
  ('grok-imagine-video-1.5:12s:720p', 76, true, 'image-to-video'),
  ('grok-imagine-video-1.5:13s:720p', 82, true, 'image-to-video'),
  ('grok-imagine-video-1.5:14s:720p', 88, true, 'image-to-video'),
  ('grok-imagine-video-1.5:15s:720p', 95, true, 'image-to-video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
