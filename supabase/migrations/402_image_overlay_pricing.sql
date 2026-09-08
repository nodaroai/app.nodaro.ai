-- Pricing for the image-overlay node: places up to 12 image layers (logo,
-- badge, cut-out, sticker) on a base image with sharp (local compute, no
-- external provider cost). Flat price on purpose — a banner and a 4K poster
-- cost the same to composite, and a flat price is what a user expects from a
-- "place my logo" step (unlike image-collage, which is priced by resolution).
--
-- Value MUST match STATIC_CREDIT_COSTS["image-overlay"] in
-- backend/src/ee/billing/credits.ts. `/admin/models` reads model_pricing and
-- nothing else, so without this row the node is invisible to admins.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('image-overlay', 10, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
