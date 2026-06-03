-- Migration: seed model_pricing rows for the new "Extract Audio" and
-- "Remove Audio" FFmpeg processing nodes.
--
-- Both are single-pass FFmpeg utilities priced at a flat 1 credit, matching
-- their closest siblings (trim-audio = 1, trim-video = 1). They run on our own
-- ffmpeg (no upstream provider cost), so the credit is a flat processing fee.
--
-- Uses ON CONFLICT DO NOTHING — never overwrites admin-customized rows. The
-- runtime STATIC_CREDIT_COSTS fallback in ee/billing/credits.ts mirrors these.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('extract-audio', 1, true, 'processing'),
  ('remove-audio',  2, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
