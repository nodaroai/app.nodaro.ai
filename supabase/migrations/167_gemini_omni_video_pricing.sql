-- Gemini Omni Video (KIE) credit pricing. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts. Admin /admin/models reads model_pricing
-- from the DB only, so every base + composite id must be seeded here.
***REDACTED-OSS-SCRUB***
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('gemini-omni-video',         29, true, 'image-to-video'),
  ('gemini-omni-video:4',       29, true, 'image-to-video'),
  ('gemini-omni-video:6',       38, true, 'image-to-video'),
  ('gemini-omni-video:8',       47, true, 'image-to-video'),
  ('gemini-omni-video:10',      57, true, 'image-to-video'),
  ('gemini-omni-video:4k:4',    66, true, 'image-to-video'),
  ('gemini-omni-video:4k:6',    75, true, 'image-to-video'),
  ('gemini-omni-video:4k:8',    85, true, 'image-to-video'),
  ('gemini-omni-video:4k:10',   94, true, 'image-to-video'),
  ('gemini-omni-video:vref',    75, true, 'image-to-video'),
  ('gemini-omni-video:4k:vref', 113, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
