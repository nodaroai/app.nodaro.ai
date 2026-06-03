-- Migration: model_pricing for the new "Extract Audio" and "Remove Audio" nodes.
--
-- Single-pass FFmpeg processing fees (run on our own ffmpeg, no upstream
-- provider cost). STATIC_CREDIT_COSTS in ee/billing/credits.ts mirrors these.
--   - extract-audio = 1cr  (matches trim-audio, its functional twin)
--   - remove-audio  = 2cr  (video output is far larger to store/serve;
--                            matches resize-video)
--
-- NOTE: `extract-audio` was seeded as a 0-credit GHOST in migration 059
-- (the identifier existed in model_pricing but no node used it). It now ships
-- as a real 1-credit node. The INSERT below no-ops on that pre-existing row
-- (ON CONFLICT DO NOTHING), so an explicit UPDATE forces it to the shipped
-- price — otherwise existing/fresh DBs would keep charging 0.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('extract-audio', 1, true, 'processing'),
  ('remove-audio',  2, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;

-- Override the stale 0-credit ghost row from migration 059.
UPDATE model_pricing SET credit_cost = 1, is_enabled = true WHERE model_identifier = 'extract-audio';
