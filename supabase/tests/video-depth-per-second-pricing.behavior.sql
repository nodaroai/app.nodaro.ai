-- ============================================================================
-- Behavioral proof: migration 590 seeds Video Depth Anything's per-second
-- price rows (`video-depth-anything:1s` … `:300s`, 20 credits × n), and each
-- row it adds takes its admin switches from the length bucket that priced that
-- second before it: 1–15 s from `:15s`, 16–30 s from `:30s`, 31–60 s from
-- `:60s`, 61–120 s from `:120s`, 121–300 s from `:300s` (`is_enabled`,
-- `tier_restriction`, `category` — the columns migration 419 carries for the
-- same reason). A bucket row a deployment does not have gives the defaults:
-- enabled, unrestricted, 'video'.
--
-- WHY THIS PROOF EXISTS AT ALL. On every database CI builds the bucket rows
-- are 502's defaults, so applying the chain proves only that the statement
-- runs. What has to be true is that a switch an administrator set on a bucket
-- row reaches every second it used to price — a disabled or tier-restricted
-- model must not come back on through the rows priced per second — that a
-- missing bucket falls back instead of failing, that the prices are 20 × n
-- whatever the buckets hold, and that a second run changes nothing.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. It sets the bucket rows' switches, deletes the rows 590 added,
-- and runs the migration FILE again (`\ir`), so it proves the statement the
-- migration ships, never a copy of it.
--
-- A DELIBERATE TRIPWIRE: it pins chain-wide prices (20 × n on every second,
-- the bare ceiling, every Depth Anything (per frame) row), so a later reprice
-- of either family updates this proof in the same change.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/video-depth-per-second-pricing.behavior.sql
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

-- Every second the provider accepts, its row id and the bucket that priced it before 590.
CREATE TEMP TABLE vd_second ON COMMIT DROP AS
SELECT n,
       'video-depth-anything:' || n || 's' AS id,
       'video-depth-anything:' || CASE WHEN n <= 15 THEN 15 WHEN n <= 30 THEN 30 WHEN n <= 60 THEN 60 WHEN n <= 120 THEN 120 ELSE 300 END || 's' AS bucket
FROM generate_series(1, 300) AS n;

-- What a range of seconds holds now, one switch at a time: the distinct values, comma-joined.
CREATE FUNCTION pg_temp.switches(lo int, hi int, col text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format(
    'SELECT string_agg(DISTINCT coalesce(p.%I::text, ''<null>''), '','' ORDER BY coalesce(p.%I::text, ''<null>''))
       FROM model_pricing p JOIN vd_second s ON s.id = p.model_identifier
      WHERE s.n BETWEEN $1 AND $2', col, col)
    INTO result USING lo, hi;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.rows_in(lo int, hi int) RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM model_pricing p JOIN vd_second s ON s.id = p.model_identifier WHERE s.n BETWEEN lo AND hi
$$;

CREATE FUNCTION pg_temp.priced_per_second() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM model_pricing p JOIN vd_second s ON s.id = p.model_identifier WHERE p.credit_cost = 20 * s.n
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain as CI applies it: 502's bucket rows are defaults, so every
--    second is there, at 20 credits a second, enabled, unrestricted, video.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the chain leaves one row per second, :1s … :300s', pg_temp.rows_in(1, 300), '300');
SELECT pg_temp.assert_eq('the chain prices every second at 20 credits × n', pg_temp.priced_per_second(), '300');
SELECT pg_temp.assert_eq('default buckets leave every second enabled', pg_temp.switches(1, 300, 'is_enabled'), 'true');
SELECT pg_temp.assert_eq('default buckets leave every second unrestricted', pg_temp.switches(1, 300, 'tier_restriction'), '<null>');
SELECT pg_temp.assert_eq('default buckets leave every second in video', pg_temp.switches(1, 300, 'category'), 'video');

-- ---------------------------------------------------------------------------
-- 1. A deployment whose administrator set switches on the buckets — and one
--    that lacks a bucket row altogether. The rows 590 added are removed (the
--    five buckets stay), then the migration runs again.
--      :15s   disabled
--      :30s   restricted to the pro tier
--      :60s   recategorised
--      :120s  missing
--      :300s  its is_enabled NULL (copied as it is, not defaulted)
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET is_enabled = false           WHERE model_identifier = 'video-depth-anything:15s';
UPDATE model_pricing SET tier_restriction = 'pro'     WHERE model_identifier = 'video-depth-anything:30s';
UPDATE model_pricing SET category = 'proof-category'  WHERE model_identifier = 'video-depth-anything:60s';
UPDATE model_pricing SET is_enabled = NULL            WHERE model_identifier = 'video-depth-anything:300s';
DELETE FROM model_pricing WHERE model_identifier = 'video-depth-anything:120s';
DELETE FROM model_pricing p USING vd_second s
 WHERE s.id = p.model_identifier AND s.n NOT IN (15, 30, 60, 120, 300);

SELECT pg_temp.assert_eq('only the four remaining buckets are left before the rerun', pg_temp.rows_in(1, 300), '4');

\ir ../migrations/590_video_depth_per_second_pricing.sql

SELECT pg_temp.assert_eq('the rerun restores one row per second', pg_temp.rows_in(1, 300), '300');

-- 2. 1–15 s: a disabled :15s leaves every one of them disabled.
SELECT pg_temp.assert_eq('a disabled :15s makes :1s … :15s disabled', pg_temp.switches(1, 15, 'is_enabled'), 'false');
SELECT pg_temp.assert_eq(':1s … :15s are not restricted', pg_temp.switches(1, 15, 'tier_restriction'), '<null>');

-- 3. 16–30 s: a tier-restricted :30s restricts every one of them, nothing else.
SELECT pg_temp.assert_eq('a tier-restricted :30s restricts :16s … :30s', pg_temp.switches(16, 30, 'tier_restriction'), 'pro');
SELECT pg_temp.assert_eq(':16s … :30s stay enabled (the switch-off of :15s does not bleed)', pg_temp.switches(16, 30, 'is_enabled'), 'true');

-- 4. 31–60 s: the bucket's category is carried too.
SELECT pg_temp.assert_eq(':31s … :60s carry the :60s category', pg_temp.switches(31, 60, 'category'), 'proof-category');
SELECT pg_temp.assert_eq(':31s … :60s are enabled and unrestricted',
  pg_temp.switches(31, 60, 'is_enabled') || '/' || pg_temp.switches(31, 60, 'tier_restriction'), 'true/<null>');

-- 5. 61–120 s: no :120s bucket — the static defaults, as a row-less id has.
SELECT pg_temp.assert_eq('a missing :120s gives :61s … :120s the defaults: enabled',
  pg_temp.switches(61, 120, 'is_enabled'), 'true');
SELECT pg_temp.assert_eq('a missing :120s gives :61s … :120s the defaults: unrestricted, video',
  pg_temp.switches(61, 120, 'tier_restriction') || '/' || pg_temp.switches(61, 120, 'category'), '<null>/video');
SELECT pg_temp.assert_eq('the missing :120s row is seeded again, at its price, with the defaults',
  (SELECT credit_cost || '/' || is_enabled || '/' || coalesce(tier_restriction, '<null>')
     FROM model_pricing WHERE model_identifier = 'video-depth-anything:120s'), '2400/true/<null>');

-- 6. 121–300 s: a present bucket is copied as it is — its NULL is_enabled included.
SELECT pg_temp.assert_eq(':121s … :300s copy the :300s is_enabled as it is (NULL)', pg_temp.switches(121, 300, 'is_enabled'), '<null>');

-- 7. The prices are 20 × n whatever the buckets hold.
SELECT pg_temp.assert_eq('every second is still 20 credits × n', pg_temp.priced_per_second(), '300');

-- 8. The bucket rows 502 seeded are not touched.
SELECT pg_temp.assert_eq('the bucket rows keep their own prices and switches',
  (SELECT string_agg(model_identifier || '=' || credit_cost || '/' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>') || '/' || coalesce(category, '<null>'), ' ' ORDER BY credit_cost)
     FROM model_pricing WHERE model_identifier IN ('video-depth-anything:15s', 'video-depth-anything:30s', 'video-depth-anything:60s', 'video-depth-anything:300s')),
  'video-depth-anything:15s=300/false/<null>/video video-depth-anything:30s=600/true/pro/video '
  'video-depth-anything:60s=1200/true/<null>/proof-category video-depth-anything:300s=6000/<null>/<null>/video');
SELECT pg_temp.assert_eq('the bare ceiling row and Depth Anything (per frame) are not touched',
  (SELECT string_agg(model_identifier || '=' || credit_cost, ' ' ORDER BY model_identifier)
     FROM model_pricing WHERE model_identifier = 'video-depth-anything' OR model_identifier LIKE 'depth-anything-frames%'),
  'depth-anything-frames=600 depth-anything-frames:120s=240 depth-anything-frames:15s=30 depth-anything-frames:300s=600 '
  'depth-anything-frames:30s=60 depth-anything-frames:60s=120 video-depth-anything=6000');

-- ---------------------------------------------------------------------------
-- 9. A second run changes nothing, and keeps an administrator's later edit of
--    a per-second row (ON CONFLICT DO NOTHING) — what CI's re-apply of the
--    newest migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
UPDATE model_pricing SET credit_cost = 999, is_enabled = true WHERE model_identifier = 'video-depth-anything:7s';
CREATE TEMP TABLE vd_before ON COMMIT DROP AS
SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
  FROM model_pricing WHERE model_identifier LIKE 'video-depth-anything%';

\ir ../migrations/590_video_depth_per_second_pricing.sql

SELECT pg_temp.assert_eq('a second run adds, drops and changes nothing',
  (SELECT count(*)::text FROM (
     (SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'video-depth-anything%'
      EXCEPT SELECT * FROM vd_before)
     UNION ALL
     (SELECT * FROM vd_before
      EXCEPT SELECT model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd
        FROM model_pricing WHERE model_identifier LIKE 'video-depth-anything%')
   ) AS changed), '0');
SELECT pg_temp.assert_eq('an administrator''s edit of a per-second row survives a rerun',
  (SELECT credit_cost || '/' || is_enabled FROM model_pricing WHERE model_identifier = 'video-depth-anything:7s'), '999/true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
