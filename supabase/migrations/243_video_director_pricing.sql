-- 243_video_director_pricing.sql
-- Pricing for the Video Director authoring feature (HyperFrames Phase 1).
-- One-shot authoring: fixed model claude-sonnet-4.6 (standard tier). No
-- :economy/:premium composites — the model is not user-selectable.
--
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
--
-- Value MUST match STATIC_CREDIT_COSTS["video-director"] in
-- backend/src/ee/billing/credits.ts (enforced by credit-pricing-migration-sync
-- test). Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING
-- preserves any admin overrides set via /admin/models.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('video-director', 9, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
