***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
-- Dynamic (per-second) models store 0 credits; actual cost calculated at runtime.

-- Ensure model_pricing table has category column
ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS category TEXT;

-- ── Image Generation ──
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('nano-banana',       1, true, 'image'),
  ('nano-banana-pro',   2, true, 'image'),
  ('flux',              1, true, 'image'),
  ('grok',              1, true, 'image'),
  ('gpt-image',         1, true, 'image'),
  ('recraft-upscale',   1, true, 'image'),
  ('recraft-remove-bg', 0, true, 'image'),
  ('nano-banana-edit',  1, true, 'image'),
  ('flux-i2i',          1, true, 'image'),
  ('flux-pro-i2i',      1, true, 'image'),
  ('grok-i2i',          1, true, 'image'),
  ('gpt-image-i2i',     1, true, 'image'),
  -- ── Video Generation (I2V / T2V) ──
  ('minimax',           1, true, 'video'),
  ('veo3',             25, true, 'video'),
  ('veo3.1',           16, true, 'video'),
  ('kling',             4, true, 'video'),
  ('kling-turbo',       3, true, 'video'),
  ('grok-i2v',          1, true, 'video'),
  ('sora2-pro',        10, true, 'video'),
  ('runway',            0, true, 'video'),
  ('pika',              0, true, 'video'),
  ('sora',              0, true, 'video'),
  -- ── Video-to-Video / Motion ──
  ('wan',               5, true, 'video'),
  ('topaz-video',       0, true, 'video'),
  ('motion-transfer',   7, true, 'video'),
  ('kling-motion',      0, true, 'video'),
  -- ── Lip Sync ──
  ('kling-avatar',      0, true, 'video'),
  ('kling-avatar-pro',  0, true, 'video'),
  ('hailuo-avatar',     5, true, 'video'),
  -- ── Audio / TTS / Music ──
  ('elevenlabs',        1, true, 'audio'),
  ('suno',              1, true, 'audio'),
  ('suno-v5',           1, true, 'audio'),
  ('infinitalk',        0, true, 'audio'),
  -- ── Processing ──
  ('topaz',             0, true, 'processing'),
  ('ffmpeg',            0, true, 'processing')
ON CONFLICT (model_identifier) DO UPDATE SET
  credit_cost = EXCLUDED.credit_cost,
  category = EXCLUDED.category;
