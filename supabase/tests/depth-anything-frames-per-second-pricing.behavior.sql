-- ============================================================================
-- Behavioral proof: migration 595 seeds Depth Anything per frame's per-second
-- price rows (`depth-anything-frames:1s` … `:80s`, 2 credits × n), and each row
-- it adds takes its admin switches from the length bucket that priced that second
-- before it: 1–15 s from `:15s`, 16–30 s from `:30s`, 31–60 s from `:60s`, 61–80 s
-- from `:120s` (`is_enabled`, `tier_restriction`, `category`). A bucket row a
-- deployment does not have gives the defaults: enabled, unrestricted, 'video'.
-- It also moves the bare row from 600 to 160, the price of the 80 s row, only from
-- the price 502 seeded.
--
-- WHY THIS PROOF EXISTS AT ALL. On every database CI builds the bucket rows are
-- 502's defaults, so applying the chain proves only that the statement runs. What
-- has to be true is that a switch an administrator set on a bucket row reaches
-- every second it used to price, that a missing bucket falls back instead of
-- failing, that the prices are 2 × n whatever the buckets hold, that `:120s` and
-- `:300s` are left alone, that an administrator's price on the bare row survives,
-- and that a second run changes nothing.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. It sets the bucket rows' switches, deletes the rows 595 added, and
-- runs the migration FILE again (`\ir`), so it proves the statement the migration
-- ships, never a copy of it.
--
-- A DELIBERATE TRIPWIRE: it pins chain-wide prices (2 × n on every second, the
-- bare row, the rows past the cap), so a later reprice of this family updates this proof in the
-- same change.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/depth-anything-frames-per-second-pricing.behavior.sql
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

-- Every second the provider accepts, its row id.
CREATE TEMP TABLE daf_second ON COMMIT DROP AS
SELECT n, 'depth-anything-frames:' || n || 's' AS id
FROM generate_series(1, 80) AS n;

-- What a range of seconds holds now, one switch at a time: the distinct values, comma-joined.
CREATE FUNCTION pg_temp.switches(lo int, hi int, col text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format(
    'SELECT string_agg(DISTINCT coalesce(p.%I::text, ''<null>''), '','' ORDER BY coalesce(p.%I::text, ''<null>''))
       FROM model_pricing p JOIN daf_second s ON s.id = p.model_identifier
      WHERE s.n BETWEEN $1 AND $2', col, col)
    INTO result USING lo, hi;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.rows_in(lo int, hi int) RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM model_pricing p JOIN daf_second s ON s.id = p.model_identifier WHERE s.n BETWEEN lo AND hi
$$;

CREATE FUNCTION pg_temp.priced_per_second() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM model_pricing p JOIN daf_second s ON s.id = p.model_identifier WHERE p.credit_cost = 2 * s.n
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain as CI applies it: 502's bucket rows are defaults, so every
--    second is there, at 2 credits a second, enabled, unrestricted, video.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the chain leaves one row per second, :1s … :80s', pg_temp.rows_in(1, 80), '80');
SELECT pg_temp.assert_eq('the chain prices every second at 2 credits × n', pg_temp.priced_per_second(), '80');
SELECT pg_temp.assert_eq('default buckets leave every second enabled', pg_temp.switches(1, 80, 'is_enabled'), 'true');
SELECT pg_temp.assert_eq('default buckets leave every second unrestricted', pg_temp.switches(1, 80, 'tier_restriction'), '<null>');
SELECT pg_temp.assert_eq('default buckets leave every second in video', pg_temp.switches(1, 80, 'category'), 'video');
SELECT pg_temp.assert_eq('the chain prices the bare row at 160, the same as :80s',
  (SELECT string_agg(credit_cost::text, ',' ORDER BY model_identifier) FROM model_pricing
    WHERE model_identifier IN ('depth-anything-frames', 'depth-anything-frames:80s')), '160,160');

-- ---------------------------------------------------------------------------
-- 1. A deployment whose administrator set switches on the buckets — and one
--    that lacks a bucket row altogether. The rows 595 added are removed (the
--    three buckets inside the cap stay), then the migration runs again.
--      :15s   disabled
--      :30s   restricted to the pro tier
--      :60s   missing
--      :120s  recategorised, its is_enabled NULL (copied as it is, not defaulted)
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET is_enabled = false           WHERE model_identifier = 'depth-anything-frames:15s';
UPDATE model_pricing SET tier_restriction = 'pro'     WHERE model_identifier = 'depth-anything-frames:30s';
UPDATE model_pricing SET category = 'proof-category', is_enabled = NULL WHERE model_identifier = 'depth-anything-frames:120s';
DELETE FROM model_pricing WHERE model_identifier = 'depth-anything-frames:60s';
DELETE FROM model_pricing p USING daf_second s
 WHERE s.id = p.model_identifier AND s.n NOT IN (15, 30, 60);

SELECT pg_temp.assert_eq('only the two remaining buckets inside the cap are left before the rerun', pg_temp.rows_in(1, 80), '2');

\ir ../migrations/595_depth_anything_frames_per_second_pricing.sql

SELECT pg_temp.assert_eq('the rerun restores one row per second', pg_temp.rows_in(1, 80), '80');

-- 2. 1–15 s: a disabled :15s leaves every one of them disabled.
SELECT pg_temp.assert_eq('a disabled :15s makes :1s … :15s disabled', pg_temp.switches(1, 15, 'is_enabled'), 'false');
SELECT pg_temp.assert_eq(':1s … :15s are not restricted', pg_temp.switches(1, 15, 'tier_restriction'), '<null>');

-- 3. 16–30 s: a tier-restricted :30s restricts every one of them, nothing else.
SELECT pg_temp.assert_eq('a tier-restricted :30s restricts :16s … :30s', pg_temp.switches(16, 30, 'tier_restriction'), 'pro');
SELECT pg_temp.assert_eq(':16s … :30s stay enabled (the switch-off of :15s does not bleed)', pg_temp.switches(16, 30, 'is_enabled'), 'true');

-- 4. 31–60 s: no :60s bucket — the static defaults, as a row-less id has.
SELECT pg_temp.assert_eq('a missing :60s gives :31s … :60s the defaults: enabled',
  pg_temp.switches(31, 60, 'is_enabled'), 'true');
SELECT pg_temp.assert_eq('a missing :60s gives :31s … :60s the defaults: unrestricted, video',
  pg_temp.switches(31, 60, 'tier_restriction') || '/' || pg_temp.switches(31, 60, 'category'), '<null>/video');
SELECT pg_temp.assert_eq('the missing :60s row is seeded again, at its price, with the defaults',
  (SELECT credit_cost || '/' || is_enabled || '/' || coalesce(tier_restriction, '<null>')
     FROM model_pricing WHERE model_identifier = 'depth-anything-frames:60s'), '120/true/<null>');

-- 5. 61–80 s: :120s is past the cap but still decides them, copied as it is — its NULL is_enabled included.
SELECT pg_temp.assert_eq(':61s … :80s carry the :120s category', pg_temp.switches(61, 80, 'category'), 'proof-category');
SELECT pg_temp.assert_eq(':61s … :80s copy the :120s is_enabled as it is (NULL)', pg_temp.switches(61, 80, 'is_enabled'), '<null>');

-- 6. The prices are 2 × n whatever the buckets hold.
SELECT pg_temp.assert_eq('every second is still 2 credits × n', pg_temp.priced_per_second(), '80');

-- 7. The bucket rows 502 seeded are not touched, those past the cap included.
SELECT pg_temp.assert_eq('the buckets keep their own prices and switches',
  (SELECT string_agg(model_identifier || '=' || credit_cost || '/' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>') || '/' || coalesce(category, '<null>'), ' ' ORDER BY credit_cost)
     FROM model_pricing WHERE model_identifier IN ('depth-anything-frames:15s', 'depth-anything-frames:30s', 'depth-anything-frames:120s')),
  'depth-anything-frames:15s=30/false/<null>/video depth-anything-frames:30s=60/true/pro/video '
  'depth-anything-frames:120s=240/<null>/<null>/proof-category');
SELECT pg_temp.assert_eq('the bare row holds 160, :300s is not touched, and no row past :80s is added',
  (SELECT string_agg(p.model_identifier || '=' || p.credit_cost, ' ' ORDER BY p.model_identifier)
     FROM model_pricing p LEFT JOIN daf_second s ON s.id = p.model_identifier
    WHERE (p.model_identifier = 'depth-anything-frames' OR p.model_identifier LIKE 'depth-anything-frames:%') AND s.id IS NULL
      AND p.model_identifier <> 'depth-anything-frames:120s'),
  'depth-anything-frames=160 depth-anything-frames:300s=600');

-- ---------------------------------------------------------------------------
-- 7b. The bare row's reprice moves it only from the price 502 seeded, and
--     touches no other column.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 600, is_enabled = false, tier_restriction = 'pro', category = 'proof-category'
 WHERE model_identifier = 'depth-anything-frames';

\ir ../migrations/595_depth_anything_frames_per_second_pricing.sql

SELECT pg_temp.assert_eq('a bare row still at 600 moves to 160, keeping its switches',
  (SELECT credit_cost || '/' || is_enabled || '/' || tier_restriction || '/' || category
     FROM model_pricing WHERE model_identifier = 'depth-anything-frames'), '160/false/pro/proof-category');

UPDATE model_pricing SET credit_cost = 777 WHERE model_identifier = 'depth-anything-frames';

\ir ../migrations/595_depth_anything_frames_per_second_pricing.sql

SELECT pg_temp.assert_eq('an administrator''s price on the bare row survives',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'depth-anything-frames'), '777');

DELETE FROM model_pricing WHERE model_identifier = 'depth-anything-frames';

\ir ../migrations/595_depth_anything_frames_per_second_pricing.sql

SELECT pg_temp.assert_eq('a deployment without a bare row stays without one',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier = 'depth-anything-frames'), '0');

-- ---------------------------------------------------------------------------
-- 8. A second run changes nothing, and keeps an administrator's later edit of
--    a per-second row (ON CONFLICT DO NOTHING) — what CI's re-apply of the
--    newest migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 999, is_enabled = true WHERE model_identifier = 'depth-anything-frames:7s';
CREATE TEMP TABLE daf_before ON COMMIT DROP AS
SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
  FROM model_pricing WHERE model_identifier LIKE 'depth-anything-frames%';

\ir ../migrations/595_depth_anything_frames_per_second_pricing.sql

SELECT pg_temp.assert_eq('a second run adds, drops and changes nothing',
  (SELECT count(*)::text FROM (
     (SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'depth-anything-frames%'
      EXCEPT SELECT * FROM daf_before)
     UNION ALL
     (SELECT * FROM daf_before
      EXCEPT SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'depth-anything-frames%')
   ) AS changed), '0');
SELECT pg_temp.assert_eq('an administrator''s edit of a per-second row survives a rerun',
  (SELECT credit_cost || '/' || is_enabled FROM model_pricing WHERE model_identifier = 'depth-anything-frames:7s'), '999/true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
