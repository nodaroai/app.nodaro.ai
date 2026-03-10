-- Migration: Add pricing for new KIE.ai models and features
-- Phase 1: Ideogram V3, Kling 3.0 Motion, Topaz Image Tiers, Sora Watermark Remove
-- Phase 2: 7 new Suno operations
-- Phase 3: Speech-to-Video, Sora Storyboard

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  -- Ideogram V3 Base
  ('ideogram-v3', 2, true),
  ('ideogram-v3:TURBO', 1, true),
  ('ideogram-v3:QUALITY', 3, true),
  -- Kling 3.0 Motion Control
  ('kling-3.0-motion', 4, true),
  ('kling-3.0-motion:1080p', 7, true),
  -- Topaz Image Upscale tiers (2K is existing default at 4 credits)
  ('topaz-image-upscale:4K', 7, true),
  ('topaz-image-upscale:8K', 13, true),
  -- Sora Watermark Remove
  ('sora-watermark-remove', 4, true),
  -- Suno new operations
  ('suno-mashup', 4, true),
  ('suno-replace-section', 2, true),
  ('suno-style-boost', 1, true),
  ('suno-add-instrumental', 4, true),
  ('suno-add-vocals', 4, true),
  ('suno-convert-wav', 1, true),
  ('suno-upload-extend', 4, true),
  -- Speech-to-Video (Wan 2.2)
  ('speech-to-video', 4, true),
  ('speech-to-video:580p', 6, true),
  ('speech-to-video:720p', 8, true),
  -- Sora 2 Pro Storyboard
  ('sora-storyboard', 47, true),
  ('sora-storyboard:15', 85, true),
  ('sora-storyboard:25', 85, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
