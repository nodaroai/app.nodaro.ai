-- seedance-2-fast: remove the phantom 1080p tier + correct the 480p-ref rate.
--
-- KIE pricing page verified 2026-06-25: seedance-2-fast is sold at 480p/720p
-- ONLY (4 SKUs, ±video-ref). There is NO 1080p SKU. Migration 133 had seeded
-- guessed 1080p rows (extrapolated 1.5× of 720p) with no matching KIE SKU.
-- This migration removes them so the admin UI / pricing table no longer offers
-- a resolution KIE can't fulfil. Values MUST match STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts (1080p keys deleted there too).
--
-- The full `seedance-2` (with real 1080p + 4K SKUs) is NOT affected.
--
-- Also: the fast 480p-ref ladder was underpriced at 8 KIE cr/s; the KIE page
-- shows 9 cr/s. Conditional UPDATE corrects only rows still at the old value,
-- preserving any admin override. Nodaro credits = ceil(9 × duration / 4).

-- Drop the phantom 1080p rows (no KIE SKU). DELETE — not ON CONFLICT — because
-- these identifiers must cease to exist.
DELETE FROM model_pricing
WHERE model_identifier LIKE 'seedance-2-fast:%:1080p'
   OR model_identifier LIKE 'seedance-2-fast:%:1080p-ref';

-- 480p-ref correction (8 → 9 KIE cr/s). Conditional: only overwrite rows still
-- at the old (wrong) seeded value so genuine admin overrides are preserved.
UPDATE model_pricing SET credit_cost = 9  WHERE model_identifier = 'seedance-2-fast:4s:480p-ref'  AND credit_cost = 8;
UPDATE model_pricing SET credit_cost = 18 WHERE model_identifier = 'seedance-2-fast:8s:480p-ref'  AND credit_cost = 16;
UPDATE model_pricing SET credit_cost = 27 WHERE model_identifier = 'seedance-2-fast:12s:480p-ref' AND credit_cost = 24;
UPDATE model_pricing SET credit_cost = 34 WHERE model_identifier = 'seedance-2-fast:15s:480p-ref' AND credit_cost = 30;
