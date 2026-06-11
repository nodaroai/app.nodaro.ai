-- Pricing for the seedance-2-extend provider (extend-video node):
-- generates the continuation via seedance-2 reference-video mode, then
-- trim-stitches source+extension into one seamless clip (ffmpeg).
--
-- Rates = the seedance-2 "-ref" matrix (duration tier × resolution) + 3cr
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedance-2-extend',            53,  true, 'video'),
  ('seedance-2-extend:4s:480p',    15,  true, 'video'),
  ('seedance-2-extend:8s:480p',    26,  true, 'video'),
  ('seedance-2-extend:12s:480p',   38,  true, 'video'),
  ('seedance-2-extend:15s:480p',   47,  true, 'video'),
  ('seedance-2-extend:4s:720p',    28,  true, 'video'),
  ('seedance-2-extend:8s:720p',    53,  true, 'video'),
  ('seedance-2-extend:12s:720p',   78,  true, 'video'),
  ('seedance-2-extend:15s:720p',   97,  true, 'video'),
  ('seedance-2-extend:4s:1080p',   41,  true, 'video'),
  ('seedance-2-extend:8s:1080p',   78,  true, 'video'),
  ('seedance-2-extend:12s:1080p', 116,  true, 'video'),
  ('seedance-2-extend:15s:1080p', 144,  true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
