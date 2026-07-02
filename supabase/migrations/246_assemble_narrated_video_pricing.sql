-- Pricing for assemble-narrated-video: fits N (clip, voice) blocks into ONE
-- MP4 via ffmpeg (local compute, no external provider cost). Priced by block
-- count at the route via computeCredits (3 + ceil(N/6)); this row backs the
-- isEnabled lookup + DB-unavailable fallback (the 6-block base = 4 credits).
-- Value MUST match STATIC_CREDIT_COSTS["assemble-narrated-video"] in
-- backend/src/ee/billing/credits.ts (credit-pricing-migration-sync test).
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('assemble-narrated-video', 4, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
