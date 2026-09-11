-- ============================================================================
-- Behavioral proof: migration 419 DERIVES 3D Render Pro's tiered per-frame
-- rows from whatever base rows a deployment actually configured.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own id namespace (`pro-3d-render:render-frame:proof-*`).
--
-- WHY THIS PROOF EXISTS AT ALL. Migration 419 is a no-op on every database CI
-- ever sees: Pro's per-frame rates are operator configuration and no Pro row is
-- seeded by any migration in this repository, so running the chain proves only
-- that the statement PARSES. What has to be true is arithmetic and filtering:
-- ceil at 1.5x and 2.5x, the other columns carried over, tiered rows never
-- becoming bases of their own, an existing override never overwritten, and a
-- second run changing nothing.
--
-- So the proof seeds base rows and executes the migration's derivation itself.
-- The statement below is MIRRORED BYTE-FOR-BYTE from
-- supabase/migrations/419_scene3d_pro_render_tiered_pricing.sql between its
-- `>>> DERIVATION` markers, and
-- backend/src/__tests__/scene3d-pro-render-tiered-pricing.test.ts fails the
-- build if the two ever differ -- so this cannot drift into proving a
-- statement the migration does not run.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/scene3d-pro-render-tiers.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- ---------------------------------------------------------------------------
-- 0. A deployment with NO Pro rows: the derivation is a no-op, not an error.
--    This is every self-host and CI, so it is asserted before anything else.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('no Pro per-frame rows are shipped by the migration chain',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%'), '0');

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

SELECT pg_temp.assert_eq('an unconfigured deployment gets zero tiered rows',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%'), '0');

-- ---------------------------------------------------------------------------
-- 1. An operator's own rows, of the shape `pro3DRenderFrameUnit` reads.
--    `proof-odd` at 7 credits is the one that proves CEIL rather than round or
--    truncate: 7 x 1.5 = 10.5 -> 11, and 7 x 2.5 = 17.5 -> 18.
--    `proof-off` is disabled, and carries a tier restriction, to prove both
--    columns are carried rather than defaulted.
-- ---------------------------------------------------------------------------
INSERT INTO model_pricing (model_identifier, provider_cost_usd, credit_cost, is_enabled, tier_restriction, category) VALUES
  ('pro-3d-render:render-frame:proof-even', 0.004000, 40, true,  NULL,  'video'),
  ('pro-3d-render:render-frame:proof-odd',  NULL,      7, true,  NULL,  'video'),
  ('pro-3d-render:render-frame:proof-off',  0.001000, 10, false, 'pro', 'video');
-- Neighbours that must NOT be derived from: a different Pro unit, and a
-- differently-prefixed model that merely contains the words.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('pro-3d-render:plan', 30, true, 'video'),
  ('some-other:render-frame:standard', 5, true, 'video');

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

-- 2. Exactly two tiers per base row, and nothing else was touched.
SELECT pg_temp.assert_eq('three base rows yield six tiered rows',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%:%'), '6');
SELECT pg_temp.assert_eq('the ids are the ones pro3DRenderFrameUnit spells',
  (SELECT string_agg(model_identifier, ' ' ORDER BY model_identifier)
     FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%:%'),
  'pro-3d-render:render-frame:proof-even:large pro-3d-render:render-frame:proof-even:xlarge '
  'pro-3d-render:render-frame:proof-odd:large pro-3d-render:render-frame:proof-odd:xlarge '
  'pro-3d-render:render-frame:proof-off:large pro-3d-render:render-frame:proof-off:xlarge');

-- 3. The arithmetic, including the rounding direction.
SELECT pg_temp.assert_eq('40 credits -> 60 large / 100 xlarge',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-even:large')
  || '/' ||
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-even:xlarge'),
  '60/100');
SELECT pg_temp.assert_eq('7 credits CEILs to 11 large / 18 xlarge (never down)',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-odd:large')
  || '/' ||
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-odd:xlarge'),
  '11/18');

-- 4. The carried columns: a disabled quality stays disabled through its tiers,
--    and its tier restriction and category ride along.
SELECT pg_temp.assert_eq('a disabled base yields disabled tiers',
  (SELECT (bool_or(is_enabled))::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:proof-off:%'),
  'false');
SELECT pg_temp.assert_eq('tier_restriction and category are carried, not defaulted',
  (SELECT tier_restriction || '/' || category FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-off:xlarge'),
  'pro/video');
SELECT pg_temp.assert_eq('provider_cost_usd scales with the same multiplier',
  (SELECT provider_cost_usd::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-even:xlarge'),
  '0.010000');
SELECT pg_temp.assert_eq('a NULL provider cost stays NULL rather than becoming zero',
  (SELECT (provider_cost_usd IS NULL)::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-odd:large'),
  'true');

-- 5. Neighbours were not swept in.
SELECT pg_temp.assert_eq('another Pro unit is not a per-frame base',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:plan:%'), '0');
SELECT pg_temp.assert_eq('a differently-prefixed model is not a per-frame base',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'some-other:render-frame:%:%'), '0');

-- 6. The base rows are untouched -- the whole promise of the tiering.
SELECT pg_temp.assert_eq('base credit prices are unchanged',
  (SELECT string_agg(credit_cost::text, ' ' ORDER BY model_identifier)
     FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:proof-%'
       AND model_identifier NOT LIKE 'pro-3d-render:render-frame:%:%'),
  '40 7 10');

-- ---------------------------------------------------------------------------
-- 7. Idempotence, and an operator override survives.
--    A second run must change nothing -- including a tier the operator has
--    since repriced by hand, and including NOT tiering the tiers.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 999 WHERE model_identifier = 'pro-3d-render:render-frame:proof-even:large';

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

SELECT pg_temp.assert_eq('a re-run adds no rows',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%:%'), '6');
SELECT pg_temp.assert_eq('an operator override on a tier survives the re-run',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'pro-3d-render:render-frame:proof-even:large'),
  '999');
SELECT pg_temp.assert_eq('a tiered row never becomes the base of a tier of its own',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'pro-3d-render:render-frame:%:%:%'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
