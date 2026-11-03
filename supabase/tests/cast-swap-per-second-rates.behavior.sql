-- ============================================================================
-- Behavioral proof: migration 591 seeds Nodaro Motion's two per-second fee
-- rates as admin-editable `model_pricing` rows — `cast-swap:per-second` at 2
-- and `cast-swap-full-quality:per-second` at 4 base credits a second, the
-- rows the cast-swap plugin reads through `tk.http.unitRatePrice` — and a
-- rerun keeps whatever an administrator set on them.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. It runs the migration FILE again (`\ir`), so it proves the
-- statement the migration ships, never a copy of it.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/cast-swap-per-second-rates.behavior.sql
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

-- One rate row as `price/is_enabled/tier_restriction/category`; NULL when the row is missing.
-- (The parameter is not `id`: in a SQL function a column of that name — the table's uuid key — wins.)
CREATE FUNCTION pg_temp.rate(rate_id text) RETURNS text
LANGUAGE sql AS $$
  SELECT credit_cost || '/' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>') || '/' || coalesce(category, '<null>')
    FROM model_pricing WHERE model_identifier = rate_id
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain seeds both rates: enabled, unrestricted, video.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the chain seeds cast-swap:per-second at 2 credits a second',
  pg_temp.rate('cast-swap:per-second'), '2/true/<null>/video');
SELECT pg_temp.assert_eq('the chain seeds cast-swap-full-quality:per-second at 4 credits a second',
  pg_temp.rate('cast-swap-full-quality:per-second'), '4/true/<null>/video');

-- ---------------------------------------------------------------------------
-- 1. An administrator retunes one rate (its price, its switch, its tier) and a
--    deployment lost the other: a rerun keeps the retune and seeds the lost
--    row again at its default.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 3, is_enabled = false, tier_restriction = 'pro'
 WHERE model_identifier = 'cast-swap:per-second';
DELETE FROM model_pricing WHERE model_identifier = 'cast-swap-full-quality:per-second';

\ir ../migrations/591_cast_swap_per_second_rates.sql

SELECT pg_temp.assert_eq('a retuned rate keeps the administrator''s price, switch and tier',
  pg_temp.rate('cast-swap:per-second'), '3/false/pro/video');
SELECT pg_temp.assert_eq('a lost rate is seeded again at its default',
  pg_temp.rate('cast-swap-full-quality:per-second'), '4/true/<null>/video');

-- ---------------------------------------------------------------------------
-- 2. A second run changes nothing — what CI's re-apply of the newest
--    migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE motion_rates_before ON COMMIT DROP AS
SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category
  FROM model_pricing WHERE model_identifier IN ('cast-swap:per-second', 'cast-swap-full-quality:per-second');

\ir ../migrations/591_cast_swap_per_second_rates.sql

SELECT pg_temp.assert_eq('a second run adds, drops and changes nothing',
  (SELECT count(*)::text FROM (
     (SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category
        FROM model_pricing WHERE model_identifier IN ('cast-swap:per-second', 'cast-swap-full-quality:per-second')
      EXCEPT SELECT * FROM motion_rates_before)
     UNION ALL
     (SELECT * FROM motion_rates_before
      EXCEPT SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category
        FROM model_pricing WHERE model_identifier IN ('cast-swap:per-second', 'cast-swap-full-quality:per-second'))
   ) AS changed), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
