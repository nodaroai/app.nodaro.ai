-- ============================================================================
-- Behavioral proof: migration 625 moves Grok Imagine Video 1.5's rows (the
-- bare id and one row per second, 1-15 s, at 480p and 720p) to their new
-- prices, each row only from the price it held before, and seeds the fifteen
-- new 1080p rows.
--
-- WHY THIS PROOF EXISTS AT ALL. On every database CI builds the rows hold the
-- seeded prices, so applying the chain proves only that the statements run.
-- What has to be true is what they do to a deployment an administrator has
-- touched: a row at the old price moves and keeps its switches, a retuned row
-- stays as it is, a row the deployment lacks stays missing, a 1080p row an
-- administrator already priced keeps its price, the rows beside them (Grok
-- Imagine I2V) are not touched, and a second run changes nothing.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. It puts the rows back at their old prices, then runs the
-- migration FILE again (`\ir`), so it proves the statements the migration
-- ships, never a copy of them.
--
-- A DELIBERATE TRIPWIRE: it pins chain-wide prices, so a later reprice of
-- these rows updates this proof in the same change.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/grok-imagine-video-1-5-prices.behavior.sql
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

-- One row as `price/is_enabled/tier_restriction/category`; NULL when the row is missing.
-- (The parameter is not `id`: in a SQL function a column of that name, the table's uuid key, wins.)
CREATE FUNCTION pg_temp.price_row(row_id text) RETURNS text
LANGUAGE sql AS $$
  SELECT credit_cost || '/' || coalesce(is_enabled::text, '<null>') || '/' || coalesce(tier_restriction, '<null>') || '/' || coalesce(category, '<null>')
    FROM model_pricing WHERE model_identifier = row_id
$$;

-- The rows the migration moves, each with its old and new price. New:
-- ceil(rate × seconds / 4) × 10 at 2.4 / 4.5 cr/s (integer tenths, so no float
-- lands a boundary row a step up). Old: the rows migration 288 left.
CREATE TEMP TABLE moved_row ON COMMIT DROP AS
SELECT 'grok-imagine-video-1.5:' || n || 's:480p' AS id,
       (ARRAY[50,80,120,150,190,230,260,300,340,370,410,440,480,520,550])[n] AS old_price,
       (ceil(24 * n * 25 / 1000.0) * 10)::int AS new_price
  FROM generate_series(1, 15) AS n
UNION ALL
SELECT 'grok-imagine-video-1.5:' || n || 's:720p',
       (ARRAY[70,130,200,260,320,380,450,510,570,630,700,760,820,880,950])[n],
       (ceil(45 * n * 25 / 1000.0) * 10)::int
  FROM generate_series(1, 15) AS n
UNION ALL
SELECT 'grok-imagine-video-1.5', 295, 50;

-- The rows the migration seeds: 20 credits a second at 1080p.
CREATE TEMP TABLE seeded_row ON COMMIT DROP AS
SELECT 'grok-imagine-video-1.5:' || n || 's:1080p' AS id, 20 * n AS price
  FROM generate_series(1, 15) AS n;

CREATE FUNCTION pg_temp.rows_at_new_price() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM moved_row r JOIN model_pricing p ON p.model_identifier = r.id WHERE p.credit_cost = r.new_price
$$;

CREATE FUNCTION pg_temp.seeded_rows_at_price() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM seeded_row r JOIN model_pricing p ON p.model_identifier = r.id WHERE p.credit_cost = r.price
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain as CI applies it: every row is there, at its new price, enabled
--    and unrestricted, in the category the model's rows were seeded in.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the list holds 15 × 2 per-second rows and the bare id', (SELECT count(*)::text FROM moved_row), '31');
SELECT pg_temp.assert_eq('the chain leaves every moved row at its new price', pg_temp.rows_at_new_price(), '31');
SELECT pg_temp.assert_eq('the chain seeds every 1080p row at its price', pg_temp.seeded_rows_at_price(), '15');
SELECT pg_temp.assert_eq('the chain prices the bare id (8 s at 480p)', pg_temp.price_row('grok-imagine-video-1.5'), '50/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 8 s at 480p', pg_temp.price_row('grok-imagine-video-1.5:8s:480p'), '50/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 8 s at 720p', pg_temp.price_row('grok-imagine-video-1.5:8s:720p'), '90/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 8 s at 1080p', pg_temp.price_row('grok-imagine-video-1.5:8s:1080p'), '160/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 15 s at 480p', pg_temp.price_row('grok-imagine-video-1.5:15s:480p'), '90/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 15 s at 720p', pg_temp.price_row('grok-imagine-video-1.5:15s:720p'), '170/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 15 s at 1080p', pg_temp.price_row('grok-imagine-video-1.5:15s:1080p'), '300/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('the chain prices 9 s at 720p (a row past a whole step)', pg_temp.price_row('grok-imagine-video-1.5:9s:720p'), '110/true/<null>/image-to-video');

-- ---------------------------------------------------------------------------
-- 1. A deployment an administrator has touched. Every moved row back at its
--    old price, then:
--      two rows at the old price with their switches set  (they move, keep them)
--      two retuned rows                                    (they stay)
--      one row already at the new price                    (it stays)
--      one row missing                                     (it stays missing)
--      one 1080p row an administrator priced already       (it keeps its price)
--      one 1080p row missing                               (it is seeded)
--      Grok Imagine I2V holding a figure the migration
--        moves another row from                            (it stays)
-- ---------------------------------------------------------------------------
UPDATE model_pricing p SET credit_cost = r.old_price FROM moved_row r WHERE p.model_identifier = r.id;

UPDATE model_pricing SET is_enabled = false, tier_restriction = 'pro', category = 'proof-category'
 WHERE model_identifier IN ('grok-imagine-video-1.5:8s:480p', 'grok-imagine-video-1.5:15s:720p');

UPDATE model_pricing SET credit_cost = 310, is_enabled = false WHERE model_identifier = 'grok-imagine-video-1.5:9s:480p';
UPDATE model_pricing SET credit_cost = 600, tier_restriction = 'pro' WHERE model_identifier = 'grok-imagine-video-1.5:10s:720p';

UPDATE model_pricing SET credit_cost = 60 WHERE model_identifier = 'grok-imagine-video-1.5:10s:480p';

DELETE FROM model_pricing WHERE model_identifier = 'grok-imagine-video-1.5:11s:720p';

UPDATE model_pricing SET credit_cost = 999, is_enabled = false WHERE model_identifier = 'grok-imagine-video-1.5:8s:1080p';
DELETE FROM model_pricing WHERE model_identifier = 'grok-imagine-video-1.5:5s:1080p';

UPDATE model_pricing SET credit_cost = 50 WHERE model_identifier = 'grok-i2v:6s';

SELECT pg_temp.assert_eq('before the rerun only the row already at the new price is at it', pg_temp.rows_at_new_price(), '1');

\ir ../migrations/625_grok_imagine_video_1_5_frames_prices.sql

-- 2. A row at the old price moves.
SELECT pg_temp.assert_eq('every row at its old price moved: 31 less two retuned and one missing', pg_temp.rows_at_new_price(), '28');
SELECT pg_temp.assert_eq('the bare id moved', pg_temp.price_row('grok-imagine-video-1.5'), '50/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('1 s at 480p moved', pg_temp.price_row('grok-imagine-video-1.5:1s:480p'), '10/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('5 s at 480p moved (an exact step)', pg_temp.price_row('grok-imagine-video-1.5:5s:480p'), '30/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('8 s at 720p moved (an exact step)', pg_temp.price_row('grok-imagine-video-1.5:8s:720p'), '90/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('15 s at 480p moved', pg_temp.price_row('grok-imagine-video-1.5:15s:480p'), '90/true/<null>/image-to-video');

-- 3. It keeps its switches.
SELECT pg_temp.assert_eq('a moved 480p row keeps is_enabled, tier_restriction and category',
  pg_temp.price_row('grok-imagine-video-1.5:8s:480p'), '50/false/pro/proof-category');
SELECT pg_temp.assert_eq('a moved 720p row keeps is_enabled, tier_restriction and category',
  pg_temp.price_row('grok-imagine-video-1.5:15s:720p'), '170/false/pro/proof-category');

-- 4. A retuned row stays as it is.
SELECT pg_temp.assert_eq('a retuned 480p row stays', pg_temp.price_row('grok-imagine-video-1.5:9s:480p'), '310/false/<null>/image-to-video');
SELECT pg_temp.assert_eq('a retuned 720p row stays', pg_temp.price_row('grok-imagine-video-1.5:10s:720p'), '600/true/pro/image-to-video');

-- 5. A row already at the new price stays.
SELECT pg_temp.assert_eq('a row already at the new price stays', pg_temp.price_row('grok-imagine-video-1.5:10s:480p'), '60/true/<null>/image-to-video');

-- 6. A missing row stays missing.
SELECT pg_temp.assert_eq('a missing 720p row stays missing',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier = 'grok-imagine-video-1.5:11s:720p'), '0');

-- 7. The 1080p seed: a row an administrator priced keeps its price, a missing one is seeded.
SELECT pg_temp.assert_eq('a 1080p row an administrator priced keeps its price', pg_temp.price_row('grok-imagine-video-1.5:8s:1080p'), '999/false/<null>/image-to-video');
SELECT pg_temp.assert_eq('a missing 1080p row is seeded', pg_temp.price_row('grok-imagine-video-1.5:5s:1080p'), '100/true/<null>/image-to-video');
SELECT pg_temp.assert_eq('every other 1080p row is at its price', pg_temp.seeded_rows_at_price(), '14');

-- 8. The rows beside them are not touched, a figure a row was moved from included.
SELECT pg_temp.assert_eq('Grok Imagine I2V holding a figure the migration moves from is not named',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'grok-i2v:6s'), '50');

-- ---------------------------------------------------------------------------
-- 9. A second run changes nothing: no row added, dropped or rewritten (a row
--    written again, even to the same values, gets a new ctid) — what CI's
--    re-apply of the newest migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE prices_before ON COMMIT DROP AS
SELECT ctid::text AS row_at, model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd, updated_at
  FROM model_pricing;

\ir ../migrations/625_grok_imagine_video_1_5_frames_prices.sql

SELECT pg_temp.assert_eq('a second run adds, drops, changes and rewrites nothing',
  (SELECT count(*)::text FROM (
     (SELECT ctid::text AS row_at, model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd, updated_at
        FROM model_pricing
      EXCEPT SELECT * FROM prices_before)
     UNION ALL
     (SELECT * FROM prices_before
      EXCEPT SELECT ctid::text AS row_at, model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd, updated_at
        FROM model_pricing)
   ) AS changed), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
