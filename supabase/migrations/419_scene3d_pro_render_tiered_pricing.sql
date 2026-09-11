-- 3D Render Pro's per-frame price above 1920 px — DERIVED from the base rows.
--
-- Migration 418 tiered a Scene3D `render-video` by frame size (1x / 1.5x /
-- 2.5x, the measured cost ratios rounded to halves) and named the same ladder
-- on Pro's per-frame unit through `pro3DRenderFrameUnit(quality, tier)`
-- (`@nodaro/shared/scene3d-render-pricing`), which spells a tiered unit
-- `pro-3d-render:render-frame:<quality>:<tier>` and leaves `base` on the bare
-- `pro-3d-render:render-frame:<quality>` an operator has already configured.
-- This migration seeds the rows that spelling reads.
--
-- WHY THIS IS A SELECT AND NOT A VALUES LIST. Pro's per-frame rates are
-- DEPLOYMENT CONFIGURATION: they are seeded by an operator against the hardware
-- that deployment renders on, and no Pro rate exists anywhere in this
-- repository. A hard-coded number here would be an invented price for someone
-- else's cluster. So each tier is read from the base row it is a multiple of,
-- which also means:
--
--   * a deployment that has never configured Pro (every self-host, and CI)
--     gets ZERO rows from this migration -- a no-op, not an error;
--   * an operator who repriced the base gets tiers consistent with their own
--     number, not with ours;
--   * an operator override already sitting on a tier id survives, because the
--     insert is ON CONFLICT DO NOTHING (Provider Enum Sync step 9).
--
-- Re-running it changes nothing: every row it would write is either already
-- there (conflict) or still absent for the same reason it was absent before.
--
-- CEIL matches `scene3DRenderTierCredits`, which is `Math.ceil` for the same
-- reason: a tier must never round DOWN into charging less per frame than the
-- base frame it is a multiple of.
--
-- The filter's second clause is what makes this idempotent in the other
-- direction: `NOT LIKE 'pro-3d-render:render-frame:%:%'` excludes anything
-- already carrying a fourth segment, so a tiered row can never become the base
-- of a tier of its own -- today's `:large` / `:xlarge`, and any tier a later
-- migration adds.
--
-- `is_enabled`, `tier_restriction` and `category` are COPIED, so a quality an
-- operator has switched off does not come back on through its tiers.
-- `provider_cost_usd` is scaled by the same multiplier when the base row
-- carries one: the multipliers ARE the measured cost ratios, so the tier's own
-- cost is exactly as derived as its credit price, and a NULL there stays NULL
-- rather than becoming a guessed zero.
--
-- Nothing here touches the base rows.

BEGIN;

-- >>> DERIVATION (mirrored byte-for-byte in supabase/tests/scene3d-pro-render-tiers.behavior.sql) >>>
INSERT INTO model_pricing (model_identifier, provider_cost_usd, credit_cost, is_enabled, tier_restriction, category)
SELECT
  base.model_identifier || ':' || tier.name,
  CASE WHEN base.provider_cost_usd IS NULL THEN NULL
       ELSE ROUND(base.provider_cost_usd * tier.multiplier, 6) END,
  CEIL(base.credit_cost * tier.multiplier)::int,
  base.is_enabled,
  base.tier_restriction,
  base.category
FROM model_pricing AS base
CROSS JOIN (VALUES ('large', 1.5), ('xlarge', 2.5)) AS tier(name, multiplier)
WHERE base.model_identifier LIKE 'pro-3d-render:render-frame:%'
  AND base.model_identifier NOT LIKE 'pro-3d-render:render-frame:%:%'
ON CONFLICT (model_identifier) DO NOTHING;
-- <<< DERIVATION <<<

COMMIT;
