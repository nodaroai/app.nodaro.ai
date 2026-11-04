-- ============================================================================
-- Behavioral proof: migration 594 moves Seedance 2.5's 1080p rows (one per
-- second, 4-30 s, with and without a video) and GPT Image 2's 2K and 4K rows
-- (text-to-image and image-to-image) to their new prices, each row only from
-- the price it held before.
--
-- WHY THIS PROOF EXISTS AT ALL. On every database CI builds the rows hold the
-- seeded prices, so applying the chain proves only that the statements run.
-- What has to be true is what they do to a deployment an administrator has
-- touched: a row at the old price moves and keeps its switches, a retuned row
-- stays as it is, a row the deployment lacks stays missing, the rows beside
-- them (1K, 480p, 720p, the finalize rows, GPT Image 2.5) are not touched, and
-- a second run changes nothing.
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
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/seedance-1080p-gpt-image-2-prices.behavior.sql
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

-- The rows the migration moves, each with its old and new price: ceil(rate × seconds / 4) × 10.
CREATE TEMP TABLE moved_row ON COMMIT DROP AS
SELECT 'seedance-2-5:' || n || 's:1080p' AS id,
       (ceil(114 * n / 4.0) * 10)::int AS old_price,
       (ceil(158 * n / 4.0) * 10)::int AS new_price
  FROM generate_series(4, 30) AS n
UNION ALL
SELECT 'seedance-2-5:' || n || 's:1080p-ref',
       (ceil(68.5 * n / 4.0) * 10)::int,
       (ceil(95 * n / 4.0) * 10)::int
  FROM generate_series(4, 30) AS n
UNION ALL
SELECT * FROM (VALUES
  ('gpt-image-2:2K', 30, 25),
  ('gpt-image-2:4K', 60, 40),
  ('gpt-image-2-i2i:2K', 30, 25),
  ('gpt-image-2-i2i:4K', 60, 40)
) AS gpt(id, old_price, new_price);

CREATE FUNCTION pg_temp.rows_at_new_price() RETURNS text
LANGUAGE sql AS $$
  SELECT count(*)::text FROM moved_row r JOIN model_pricing p ON p.model_identifier = r.id WHERE p.credit_cost = r.new_price
$$;

-- ---------------------------------------------------------------------------
-- 0. The chain as CI applies it: every row is there, at its new price,
--    enabled and unrestricted, in the category it was seeded in.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the list holds 27 × 2 Seedance rows and 4 GPT Image 2 rows', (SELECT count(*)::text FROM moved_row), '58');
SELECT pg_temp.assert_eq('the chain leaves every row at its new price', pg_temp.rows_at_new_price(), '58');
SELECT pg_temp.assert_eq('the chain prices 4 s at 1080p', pg_temp.price_row('seedance-2-5:4s:1080p'), '1580/true/<null>/video');
SELECT pg_temp.assert_eq('the chain prices 8 s at 1080p', pg_temp.price_row('seedance-2-5:8s:1080p'), '3160/true/<null>/video');
SELECT pg_temp.assert_eq('the chain prices 4 s at 1080p with a video', pg_temp.price_row('seedance-2-5:4s:1080p-ref'), '950/true/<null>/video');
SELECT pg_temp.assert_eq('the chain prices GPT Image 2 at 2K', pg_temp.price_row('gpt-image-2:2K'), '25/true/<null>/image');
SELECT pg_temp.assert_eq('the chain prices GPT Image 2 at 4K', pg_temp.price_row('gpt-image-2:4K'), '40/true/<null>/image');
SELECT pg_temp.assert_eq('the chain prices GPT Image 2 image-to-image at 2K', pg_temp.price_row('gpt-image-2-i2i:2K'), '25/true/<null>/image');
SELECT pg_temp.assert_eq('the chain prices GPT Image 2 image-to-image at 4K', pg_temp.price_row('gpt-image-2-i2i:4K'), '40/true/<null>/image');

-- ---------------------------------------------------------------------------
-- 1. A deployment an administrator has touched. Every row back at its old
--    price, then:
--      two rows at the old price with their switches set  (they move, keep them)
--      four retuned rows                                  (they stay)
--      one row already at the new price                   (it stays)
--      two rows missing                                   (they stay missing)
--      rows the migration does not name, two of them holding
--        a figure the migration moves other rows from     (they stay)
-- ---------------------------------------------------------------------------
UPDATE model_pricing p SET credit_cost = r.old_price FROM moved_row r WHERE p.model_identifier = r.id;

UPDATE model_pricing SET is_enabled = false, tier_restriction = 'pro', category = 'proof-category'
 WHERE model_identifier IN ('seedance-2-5:8s:1080p', 'gpt-image-2-i2i:4K');

UPDATE model_pricing SET credit_cost = 2600, is_enabled = false WHERE model_identifier = 'seedance-2-5:9s:1080p';
UPDATE model_pricing SET credit_cost = 1600, tier_restriction = 'pro' WHERE model_identifier = 'seedance-2-5:9s:1080p-ref';
UPDATE model_pricing SET credit_cost = 38 WHERE model_identifier = 'gpt-image-2:2K';
UPDATE model_pricing SET credit_cost = 76, category = 'proof-category' WHERE model_identifier = 'gpt-image-2:4K';

UPDATE model_pricing SET credit_cost = 3950 WHERE model_identifier = 'seedance-2-5:10s:1080p';

DELETE FROM model_pricing WHERE model_identifier IN ('seedance-2-5:11s:1080p-ref', 'gpt-image-2-i2i:2K');

UPDATE model_pricing SET credit_cost = 2280 WHERE model_identifier = 'seedance-2-5:8s:720p';
UPDATE model_pricing SET credit_cost = 30 WHERE model_identifier = 'gpt-image-2-5-flare:2K';

SELECT pg_temp.assert_eq('before the rerun only the row already at the new price is at it', pg_temp.rows_at_new_price(), '1');

\ir ../migrations/594_seedance_1080p_gpt_image_2_prices.sql

-- 2. A row at the old price moves.
SELECT pg_temp.assert_eq('every row at its old price moved: 58 less four retuned and two missing', pg_temp.rows_at_new_price(), '52');
SELECT pg_temp.assert_eq('4 s at 1080p moved', pg_temp.price_row('seedance-2-5:4s:1080p'), '1580/true/<null>/video');
SELECT pg_temp.assert_eq('30 s at 1080p moved', pg_temp.price_row('seedance-2-5:30s:1080p'), '11850/true/<null>/video');
SELECT pg_temp.assert_eq('4 s at 1080p with a video moved', pg_temp.price_row('seedance-2-5:4s:1080p-ref'), '950/true/<null>/video');
SELECT pg_temp.assert_eq('5 s at 1080p with a video moved (its old price is a half-credit round-up)', pg_temp.price_row('seedance-2-5:5s:1080p-ref'), '1190/true/<null>/video');
SELECT pg_temp.assert_eq('30 s at 1080p with a video moved', pg_temp.price_row('seedance-2-5:30s:1080p-ref'), '7130/true/<null>/video');

-- 3. It keeps its switches.
SELECT pg_temp.assert_eq('a moved Seedance row keeps is_enabled, tier_restriction and category',
  pg_temp.price_row('seedance-2-5:8s:1080p'), '3160/false/pro/proof-category');
SELECT pg_temp.assert_eq('a moved GPT Image 2 row keeps is_enabled, tier_restriction and category',
  pg_temp.price_row('gpt-image-2-i2i:4K'), '40/false/pro/proof-category');

-- 4. A retuned row stays as it is.
SELECT pg_temp.assert_eq('a retuned 1080p row stays', pg_temp.price_row('seedance-2-5:9s:1080p'), '2600/false/<null>/video');
SELECT pg_temp.assert_eq('a retuned 1080p row with a video stays', pg_temp.price_row('seedance-2-5:9s:1080p-ref'), '1600/true/pro/video');
SELECT pg_temp.assert_eq('a retuned GPT Image 2 row stays at 2K', pg_temp.price_row('gpt-image-2:2K'), '38/true/<null>/image');
SELECT pg_temp.assert_eq('a retuned GPT Image 2 row stays at 4K', pg_temp.price_row('gpt-image-2:4K'), '76/true/<null>/proof-category');

-- 5. A row already at the new price stays.
SELECT pg_temp.assert_eq('a row already at the new price stays', pg_temp.price_row('seedance-2-5:10s:1080p'), '3950/true/<null>/video');

-- 6. A missing row stays missing.
SELECT pg_temp.assert_eq('a missing row with a video stays missing',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier = 'seedance-2-5:11s:1080p-ref'), '0');
SELECT pg_temp.assert_eq('a missing GPT Image 2 row stays missing',
  (SELECT count(*)::text FROM model_pricing WHERE model_identifier = 'gpt-image-2-i2i:2K'), '0');

-- 7. The rows beside them are not touched, a figure a row was moved from included.
SELECT pg_temp.assert_eq('GPT Image 2 at 1K stays 15', pg_temp.price_row('gpt-image-2'), '15/true/<null>/image');
SELECT pg_temp.assert_eq('GPT Image 2 image-to-image at 1K stays 15', pg_temp.price_row('gpt-image-2-i2i'), '15/true/<null>/image');
SELECT pg_temp.assert_eq('GPT Image 2.5 holding a figure the migration moves from is not named',
  pg_temp.price_row('gpt-image-2-5-flare:2K'), '30/true/<null>/image');
SELECT pg_temp.assert_eq('720p holding a figure the migration moves from is not named',
  pg_temp.price_row('seedance-2-5:8s:720p'), '2280/true/<null>/video');
SELECT pg_temp.assert_eq('720p with a video is not touched', pg_temp.price_row('seedance-2-5:8s:720p-ref'), '760/true/<null>/video');
SELECT pg_temp.assert_eq('480p is not touched', pg_temp.price_row('seedance-2-5:8s:480p'), '560/true/<null>/video');
SELECT pg_temp.assert_eq('the bare id is not touched', pg_temp.price_row('seedance-2-5'), '1260/true/<null>/video');
SELECT pg_temp.assert_eq('the finalize row is not touched', pg_temp.price_row('seedance-2-5-hd:8s'), '3160/true/<null>/video');
SELECT pg_temp.assert_eq('the finalize row with a video is not touched', pg_temp.price_row('seedance-2-5-hd:8s-ref'), '1900/true/<null>/video');

-- ---------------------------------------------------------------------------
-- 8. A second run changes nothing: no row added, dropped or rewritten (a row
--    written again, even to the same values, gets a new ctid) — what CI's
--    re-apply of the newest migration exercises on a pristine chain.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE prices_before ON COMMIT DROP AS
SELECT ctid::text AS row_at, model_identifier, credit_cost, is_enabled, tier_restriction, category, provider_cost_usd, updated_at
  FROM model_pricing;

\ir ../migrations/594_seedance_1080p_gpt_image_2_prices.sql

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
