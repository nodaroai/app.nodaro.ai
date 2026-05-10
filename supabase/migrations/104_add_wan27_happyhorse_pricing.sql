-- Migration: add wan-2.7 + happyhorse model_pricing rows
-- Estimated costs — run audit-credits after ship to verify actual KIE charges

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Wan 2.7 T2I (base + 2K + 4K composites)
  ('wan-2.7',         3,  true, 'generate-image'),
  ('wan-2.7:2K',      5,  true, 'generate-image'),
  ('wan-2.7:4K',      10, true, 'generate-image'),

  -- Wan 2.7 Pro T2I (base + 2K + 4K composites)
  ('wan-2.7-pro',     4,  true, 'generate-image'),
  ('wan-2.7-pro:2K',  8,  true, 'generate-image'),
  ('wan-2.7-pro:4K',  15, true, 'generate-image'),

  -- Wan 2.7 I2V
  ('wan-2.7-i2v',     24, true, 'image-to-video'),

  -- Wan 2.7 T2V
  ('wan-2.7-t2v',     24, true, 'text-to-video'),

  -- HappyHorse T2V
  ('happyhorse',      16, true, 'text-to-video'),

  -- HappyHorse I2V
  ('happyhorse-i2v',  16, true, 'image-to-video'),

  -- HappyHorse Ref2V
  ('happyhorse-ref2v', 19, true, 'image-to-video'),

  -- HappyHorse Video Edit
  ('happyhorse-edit', 25, true, 'video-to-video')

ON CONFLICT (model_identifier) DO NOTHING;
