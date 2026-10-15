-- ============================================================================
-- Behavioral proof: migration 523 adds `node_presets.preview_url` — a preset's
-- example picture — and makes it a column ONLY THE SERVER writes.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000005231 upward).
--
-- WHY THIS PROOF EXISTS. Every client that lists a preset loads this address.
-- The routes accept only the caller's own image on the platform's media host
-- and store their own copy of it (backend/src/lib/presets/preview-url.ts,
-- preview-copy.ts). But node_presets' owner policy (191) lets a user write
-- every column of their own rows over PostgREST with their browser JWT, which
-- would let anyone put any address there — a tracking pixel, another user's
-- file — around every check. The column is closed by privilege; nothing in
-- the SQL text says the policy alone would not have done it, so the effect is
-- asserted:
--   1-2. a browser session can neither set preview_url on its own row nor
--        insert a row carrying one;
--   3-4. and loses nothing else: it still inserts, renames and edits its own
--        presets (the columns the product has always had);
--   5.   the service role — the routes — still writes the column;
--   6.   the column's length bound holds for every writer.
--
-- Run locally (throwaway container, same image family as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/node-preset-preview-url.behavior.sql mig-test:/tmp/t.sql
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000005231', 'np-user@np.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profile created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005231'), '1');

-- A preset the server wrote, with its own copy as the picture.
INSERT INTO node_presets (id, user_id, node_type, name, data, preview_url) VALUES
  ('00000000-0000-4000-8000-000000005232', '00000000-0000-4000-8000-000000005231', 'generate-image', 'Mine', '{"prompt":"a fox"}',
   'https://media.example.test/node-presets/00000000-0000-4000-8000-000000005231/preview-0123456789abcdef.png');

-- ---------------------------------------------------------------------------
-- 1-4. ONE authenticated session, the user's own JWT: what a browser holding
--      that token can do over PostgREST.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000005231","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000005231';

-- 1. Pointing its own preset's picture somewhere else.
DO $$ BEGIN
  UPDATE node_presets SET preview_url = 'https://tracker.example.com/pixel.png'
    WHERE id = '00000000-0000-4000-8000-000000005232';
  RAISE EXCEPTION 'ASSERT FAIL: a browser session rewrote preview_url';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser session cannot write preview_url on its own preset (refused)';
END $$;

-- 2. A new row carrying a picture.
DO $$ BEGIN
  INSERT INTO node_presets (user_id, node_type, name, data, preview_url) VALUES
    ('00000000-0000-4000-8000-000000005231', 'generate-image', 'Sneaky', '{}', 'https://tracker.example.com/pixel.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser session inserted a preset with a preview_url';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser session cannot insert a preset carrying preview_url (refused)';
END $$;

-- 3. Its own preset is still its own to edit: every column but the picture.
UPDATE node_presets
  SET name = 'Renamed', description = 'd', data = '{"prompt":"a cat"}', tags = '["x"]', sort_order = 3, updated_at = now()
  WHERE id = '00000000-0000-4000-8000-000000005232';
SELECT pg_temp.assert_eq('a browser session still edits its own preset''s other columns',
  (SELECT name || '|' || (data->>'prompt') || '|' || sort_order::text FROM node_presets WHERE id = '00000000-0000-4000-8000-000000005232'),
  'Renamed|a cat|3');

-- 4. And still inserts one without a picture.
INSERT INTO node_presets (user_id, node_type, name, data) VALUES
  ('00000000-0000-4000-8000-000000005231', 'generate-image', 'Plain', '{"prompt":"x"}');
SELECT pg_temp.assert_eq('a browser session still inserts a preset without a picture',
  (SELECT count(*)::text FROM node_presets WHERE user_id = '00000000-0000-4000-8000-000000005231' AND name = 'Plain'), '1');
RESET ROLE;

SELECT pg_temp.assert_eq('the picture survived the browser''s attempt',
  (SELECT preview_url FROM node_presets WHERE id = '00000000-0000-4000-8000-000000005232'),
  'https://media.example.test/node-presets/00000000-0000-4000-8000-000000005231/preview-0123456789abcdef.png');

-- ---------------------------------------------------------------------------
-- 5. The routes write it: the service role sets, replaces and clears it.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
UPDATE node_presets SET preview_url = 'https://media.example.test/node-presets/00000000-0000-4000-8000-000000005231/preview-fedcba9876543210.webp'
  WHERE id = '00000000-0000-4000-8000-000000005232';
SELECT pg_temp.assert_eq('the service role replaces preview_url',
  (SELECT preview_url FROM node_presets WHERE id = '00000000-0000-4000-8000-000000005232'),
  'https://media.example.test/node-presets/00000000-0000-4000-8000-000000005231/preview-fedcba9876543210.webp');
INSERT INTO node_presets (user_id, node_type, name, data, preview_url) VALUES
  ('00000000-0000-4000-8000-000000005231', 'generate-image', 'Server made', '{}', 'https://media.example.test/x.png');
SELECT pg_temp.assert_eq('the service role inserts a preset with preview_url',
  (SELECT preview_url FROM node_presets WHERE user_id = '00000000-0000-4000-8000-000000005231' AND name = 'Server made'),
  'https://media.example.test/x.png');
UPDATE node_presets SET preview_url = NULL WHERE id = '00000000-0000-4000-8000-000000005232';
SELECT pg_temp.assert_eq('the service role clears preview_url',
  (SELECT coalesce(preview_url, '<null>') FROM node_presets WHERE id = '00000000-0000-4000-8000-000000005232'), '<null>');

-- ---------------------------------------------------------------------------
-- 6. The length bound (the routes' PREVIEW_URL_MAX_LENGTH) holds for every writer.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  UPDATE node_presets SET preview_url = 'https://media.example.test/' || repeat('a', 2048)
    WHERE id = '00000000-0000-4000-8000-000000005232';
  RAISE EXCEPTION 'ASSERT FAIL: a preview_url over 2048 characters was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  a preview_url over 2048 characters is refused';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
