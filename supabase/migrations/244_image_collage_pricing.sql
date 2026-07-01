-- Pricing for the image-collage node: composites N images into ONE 2K/4K
-- image via ffmpeg (local compute, no external provider cost). Priced by
-- output resolution only.
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- The single-node route reserves via the creditGuard `computeCredits` hook
-- (BASE credits by resolution); workflow runs reserve the composite id passed
-- as the payload-builder modelIdentifier. These rows back BOTH the isEnabled
-- lookup and the DB-unavailable fallback.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('image-collage',      2, true, 'image'),
  ('image-collage:2K',   2, true, 'image'),
  ('image-collage:4K',   4, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
