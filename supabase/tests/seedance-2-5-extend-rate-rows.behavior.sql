-- ============================================================================
-- Behavioral proof: migration 643 seeds Seedance 2.5 Extend's two-second rate
-- rows (`seedance-2-5-extend:<res>:per-2s`, 85 / 190 / 475), each taking its
-- admin switches (`is_enabled`, `tier_restriction`, `category`) from its
-- resolution's 8-second row, `seedance-2-5-extend:8s:<res>`; and it reprices
-- every earlier per-length row (`seedance-2-5-extend:<N>s:<res>`, N = 4–30)
-- to the most a run of that length costs: the rate row × (10 + N) / 2,
-- rounded up.
--
-- WHY THIS PROOF EXISTS AT ALL. On every database CI builds the earlier rows
-- hold the defaults, so applying the chain proves only that the statements
-- run. What has to be true is that a switch an administrator set on an
-- earlier row reaches its resolution's rate row — a resolution switched off
-- or restricted to a tier must not come back on through the row every run is
-- now priced on — that a missing 8-second row falls back instead of failing,
-- that the rate prices are literals whatever the earlier rows hold, that an
-- earlier row an administrator repriced is moved to the full-window figure
-- too (only its price: its switches stay), and that a second run changes
-- nothing.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. It sets the earlier rows' switches, deletes the rate rows 643
-- added, and runs the migration FILE again (`\ir`), so it proves the
-- statements the migration ships, never a copy of them.
--
-- A DELIBERATE TRIPWIRE: it pins the rate prices and the full-window rule on
-- every earlier row, so a later reprice of either updates this proof in the
-- same change.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/seedance-2-5-extend-rate-rows.behavior.sql
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

-- Each earlier row: its id, its length and resolution, and the rate row of that resolution.
CREATE TEMP TABLE s25_earlier ON COMMIT DROP AS
SELECT n, res,
       'seedance-2-5-extend:' || n || 's:' || res AS id,
       'seedance-2-5-extend:' || res || ':per-2s' AS rate_id
FROM generate_series(4, 30) AS n
CROSS JOIN (VALUES ('480p'), ('720p'), ('1080p')) AS r(res);

-- A rate row as `price/is_enabled/tier_restriction/category`.
CREATE FUNCTION pg_temp.rate_row(res text) RETURNS text
LANGUAGE sql AS $$
  SELECT credit_cost || '/' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>') || '/' || coalesce(category, '<null>')
    FROM model_pricing WHERE model_identifier = 'seedance-2-5-extend:' || res || ':per-2s'
$$;

-- How many earlier rows there are, and how many hold the full-window figure of their rate row.
CREATE FUNCTION pg_temp.earlier_rows() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM model_pricing p JOIN s25_earlier e ON e.id = p.model_identifier
$$;
CREATE FUNCTION pg_temp.earlier_at_full_window() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text
    FROM model_pricing p
    JOIN s25_earlier e ON e.id = p.model_identifier
    JOIN (VALUES ('480p', 85), ('720p', 190), ('1080p', 475)) AS rate(res, cost) ON rate.res = e.res
   WHERE p.credit_cost = ceil(rate.cost * (10 + e.n) / 2.0)
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain as CI applies it: the earlier rows hold the defaults, so every
--    rate row is there at its price, enabled, unrestricted, in video, and
--    every earlier row holds the most a run of its length costs.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('480p rate row on the chain', pg_temp.rate_row('480p'), '85/true/<null>/video');
SELECT pg_temp.assert_eq('720p rate row on the chain', pg_temp.rate_row('720p'), '190/true/<null>/video');
SELECT pg_temp.assert_eq('1080p rate row on the chain', pg_temp.rate_row('1080p'), '475/true/<null>/video');
SELECT pg_temp.assert_eq('the chain leaves the 81 earlier rows', pg_temp.earlier_rows(), '81');
SELECT pg_temp.assert_eq('every earlier row is the rate row × (10 + N) / 2, rounded up', pg_temp.earlier_at_full_window(), '81');
SELECT pg_temp.assert_eq('spot: 8 s at 720p is 9 two-second units, 4 s at 480p 7, 30 s at 1080p 20',
  (SELECT string_agg(model_identifier || '=' || credit_cost, ' ' ORDER BY credit_cost)
     FROM model_pricing WHERE model_identifier IN ('seedance-2-5-extend:8s:720p', 'seedance-2-5-extend:4s:480p', 'seedance-2-5-extend:30s:1080p')),
  'seedance-2-5-extend:4s:480p=595 seedance-2-5-extend:8s:720p=1710 seedance-2-5-extend:30s:1080p=9500');

-- ---------------------------------------------------------------------------
-- 1. A deployment whose administrator set switches on the earlier rows — and
--    one that lacks an 8-second row altogether — and repriced one earlier
--    row. The rate rows 643 added are removed, then the migration runs again.
--      8s:480p   disabled, recategorised
--      8s:720p   restricted to the pro tier
--      8s:1080p  missing
--      12s:720p  repriced to 1, and disabled
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET is_enabled = false, category = 'proof-category' WHERE model_identifier = 'seedance-2-5-extend:8s:480p';
UPDATE model_pricing SET tier_restriction = 'pro'                         WHERE model_identifier = 'seedance-2-5-extend:8s:720p';
DELETE FROM model_pricing                                                 WHERE model_identifier = 'seedance-2-5-extend:8s:1080p';
UPDATE model_pricing SET credit_cost = 1, is_enabled = false              WHERE model_identifier = 'seedance-2-5-extend:12s:720p';
DELETE FROM model_pricing WHERE model_identifier LIKE 'seedance-2-5-extend:%:per-2s';

SELECT pg_temp.assert_eq('no rate row is left before the rerun',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier LIKE 'seedance-2-5-extend:%:per-2s'), '0');

\ir ../migrations/643_seedance_2_5_extend_per_second_pricing.sql

-- 2. Each rate row takes its resolution's 8-second row's switches; a missing one gives the defaults.
SELECT pg_temp.assert_eq('a disabled 8s:480p leaves the 480p rate row disabled, in its category', pg_temp.rate_row('480p'), '85/false/<null>/proof-category');
SELECT pg_temp.assert_eq('a tier-restricted 8s:720p restricts the 720p rate row', pg_temp.rate_row('720p'), '190/true/pro/video');
SELECT pg_temp.assert_eq('a missing 8s:1080p gives the 1080p rate row the defaults', pg_temp.rate_row('1080p'), '475/true/<null>/video');

-- 3. The earlier rows: the repriced one is moved to the full-window figure, its switch kept;
--    the missing one is not seeded again (an UPDATE only); every other one is at its figure.
SELECT pg_temp.assert_eq('a repriced 12s:720p is moved to the full-window figure, still disabled',
  (SELECT credit_cost || '/' || is_enabled FROM model_pricing WHERE model_identifier = 'seedance-2-5-extend:12s:720p'), '2090/false');
SELECT pg_temp.assert_eq('the switches set on the 8-second rows stay on them',
  (SELECT string_agg(model_identifier || '=' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>'), ' ' ORDER BY model_identifier)
     FROM model_pricing WHERE model_identifier IN ('seedance-2-5-extend:8s:480p', 'seedance-2-5-extend:8s:720p')),
  'seedance-2-5-extend:8s:480p=false/<null> seedance-2-5-extend:8s:720p=true/pro');
SELECT pg_temp.assert_eq('the missing 8s:1080p is not seeded again', pg_temp.earlier_rows(), '80');
SELECT pg_temp.assert_eq('every earlier row left is at its full-window figure', pg_temp.earlier_at_full_window(), '80');

-- ---------------------------------------------------------------------------
-- 4. A second run changes nothing, and keeps an administrator's later edit of
--    a rate row (ON CONFLICT DO NOTHING) — what CI's re-apply of the newest
--    migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 999 WHERE model_identifier = 'seedance-2-5-extend:720p:per-2s';
CREATE TEMP TABLE s25_before ON COMMIT DROP AS
SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
  FROM model_pricing WHERE model_identifier LIKE 'seedance-2-5-extend:%';

\ir ../migrations/643_seedance_2_5_extend_per_second_pricing.sql

SELECT pg_temp.assert_eq('a second run adds, drops and changes nothing',
  (SELECT count(*)::text FROM (
     (SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'seedance-2-5-extend:%'
      EXCEPT SELECT * FROM s25_before)
     UNION ALL
     (SELECT * FROM s25_before
      EXCEPT SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'seedance-2-5-extend:%')
   ) AS changed), '0');
SELECT pg_temp.assert_eq('an administrator''s edit of a rate row survives a rerun', pg_temp.rate_row('720p'), '999/true/pro/video');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
