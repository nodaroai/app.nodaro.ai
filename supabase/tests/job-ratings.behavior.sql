-- ============================================================================
-- Behavioral proof: ratings on generations (migration 520).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000052001 upward).
--
-- What it pins:
--   1. job_ratings is service-role only: RLS on, no policies, no grants — the
--      rating's OWNER, signed in, and an anonymous caller are both refused by
--      privilege before RLS is consulted.
--   2. Integrity the API relies on: a rating is good or bad (CHECK); one per
--      job per person (UNIQUE), which the API's upsert targets; and only the
--      job's OWNER rates it — enforced by the guard trigger, whatever a route
--      forgets, on insert and on an update that moves a rating.
--   2d. The API's role (service_role) writes, upserts and clears a rating, and
--       the owner guard — which reads jobs with the writer's rights — holds for
--       it too.
--   2e. gallery_favorites has no client writer any more (520): no write
--       policy, no write privilege for anon / authenticated, a signed-in write
--       refused; reading one's own favorites is unchanged.
--   3. updated_at moves when a rating changes.
--   4. Deleting a job deletes its rating; deleting the person deletes theirs.
--   5. The foreign keys the list filters embed by have the names the API
--      spells (job_ratings_job_id_fkey, gallery_favorites_job_id_fkey), and the
--      primary key is the surrogate id alone — not a (user_id, job_id) key
--      PostgREST would read as a profiles <-> jobs junction.
--
-- Run locally: see the header of collections.behavior.sql (same steps).
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

-- Runs `stmt` and passes only if it fails with SQLSTATE `expected`.
CREATE FUNCTION pg_temp.assert_fails(label text, stmt text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
  END;
  IF got IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: expected SQLSTATE % got %', label, expected, coalesce(got, 'success');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A = owner, B = stranger.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052001', 'jr-owner@jr.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052002', 'jr-stranger@jr.test', '{}', 'authenticated', 'authenticated');

INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052011', '00000000-0000-4000-8000-000000052001', 'completed'),
  ('00000000-0000-4000-8000-000000052012', '00000000-0000-4000-8000-000000052001', 'failed'),
  ('00000000-0000-4000-8000-000000052013', '00000000-0000-4000-8000-000000052002', 'completed');

-- 0. The proof is not vacuous: a rating exists to be denied (written as the
--    service role would write it — as postgres here).
INSERT INTO job_ratings (user_id, job_id, rating)
VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052011', 'good');
SELECT pg_temp.assert_eq('job_ratings has a row (as postgres)',
  (SELECT count(*)::text FROM job_ratings), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on job_ratings',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.job_ratings'::regclass), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on job_ratings',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_ratings'), '0');
SELECT pg_temp.assert_eq('authenticated holds no privilege on job_ratings',
  (has_table_privilege('authenticated', 'public.job_ratings', 'SELECT')
   OR has_table_privilege('authenticated', 'public.job_ratings', 'INSERT')
   OR has_table_privilege('authenticated', 'public.job_ratings', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.job_ratings', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no privilege on job_ratings',
  (has_table_privilege('anon', 'public.job_ratings', 'SELECT')
   OR has_table_privilege('anon', 'public.job_ratings', 'INSERT')
   OR has_table_privilege('anon', 'public.job_ratings', 'UPDATE')
   OR has_table_privilege('anon', 'public.job_ratings', 'DELETE'))::text, 'false');

-- 1a. THE LEAK: the rating's OWNER, signed in, cannot read or write it through
--     the API role — refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000052001","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000052001';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM job_ratings;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT job_ratings as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT job_ratings as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO job_ratings (user_id, job_id, rating)
    VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052012', 'bad');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot INSERT job_ratings as authenticated]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  the owner cannot INSERT job_ratings as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    UPDATE job_ratings SET rating = 'bad';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot UPDATE job_ratings as authenticated]: the update succeeded';
  END IF;
  RAISE NOTICE 'ok  the owner cannot UPDATE job_ratings as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    DELETE FROM job_ratings;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot DELETE job_ratings as authenticated]: the delete succeeded';
  END IF;
  RAISE NOTICE 'ok  the owner cannot DELETE job_ratings as authenticated (privilege denied)';
END $$;
RESET ROLE;

-- 1b. Anonymous is refused the same way. Clear the JWT so this is a true anon
--     read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM job_ratings;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT job_ratings]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT job_ratings (privilege denied)';
END $$;
RESET ROLE;

-- 2a. A rating is good or bad.
SELECT pg_temp.assert_fails('a rating outside good | bad is refused (check)',
  $s$INSERT INTO job_ratings (user_id, job_id, rating)
     VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052012', 'meh')$s$, '23514');

-- 2b. One rating per job per person; the API's upsert targets that key.
SELECT pg_temp.assert_fails('a second rating of the same job by the same person is refused (unique)',
  $s$INSERT INTO job_ratings (user_id, job_id, rating)
     VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052011', 'bad')$s$, '23505');
INSERT INTO job_ratings (user_id, job_id, rating)
VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052011', 'bad')
ON CONFLICT (user_id, job_id) DO UPDATE SET user_id = EXCLUDED.user_id, job_id = EXCLUDED.job_id, rating = EXCLUDED.rating;
SELECT pg_temp.assert_eq('the upsert changes the rating and keeps one row',
  (SELECT string_agg(rating, ',') FROM job_ratings WHERE job_id = '00000000-0000-4000-8000-000000052011'), 'bad');

-- 2c. Only the job's owner rates it — on insert and on an update that moves a rating.
SELECT pg_temp.assert_fails('a stranger cannot rate the owner''s job',
  $s$INSERT INTO job_ratings (user_id, job_id, rating)
     VALUES ('00000000-0000-4000-8000-000000052002', '00000000-0000-4000-8000-000000052011', 'bad')$s$, '42501');
SELECT pg_temp.assert_fails('the owner cannot rate a stranger''s job',
  $s$INSERT INTO job_ratings (user_id, job_id, rating)
     VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052013', 'good')$s$, '42501');
SELECT pg_temp.assert_fails('a rating cannot be moved onto a stranger''s job',
  $s$UPDATE job_ratings SET job_id = '00000000-0000-4000-8000-000000052013'
     WHERE job_id = '00000000-0000-4000-8000-000000052011'$s$, '42501');
SELECT pg_temp.assert_fails('a rating cannot be handed to another person',
  $s$UPDATE job_ratings SET user_id = '00000000-0000-4000-8000-000000052002'
     WHERE job_id = '00000000-0000-4000-8000-000000052011'$s$, '42501');

-- 2d. The API's own role. The backend writes as service_role, and the owner
--     guard reads jobs with the WRITER's rights — so prove the API's write,
--     upsert and clear as that role, and that the guard still holds for it.
SET LOCAL ROLE service_role;
INSERT INTO job_ratings (user_id, job_id, rating)
VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052012', 'good')
ON CONFLICT (user_id, job_id) DO UPDATE SET user_id = EXCLUDED.user_id, job_id = EXCLUDED.job_id, rating = EXCLUDED.rating;
INSERT INTO job_ratings (user_id, job_id, rating)
VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052012', 'bad')
ON CONFLICT (user_id, job_id) DO UPDATE SET user_id = EXCLUDED.user_id, job_id = EXCLUDED.job_id, rating = EXCLUDED.rating;
SELECT pg_temp.assert_eq('service_role rates a job and the upsert changes it (the API write)',
  (SELECT string_agg(rating, ',') FROM job_ratings WHERE job_id = '00000000-0000-4000-8000-000000052012'), 'bad');
SELECT pg_temp.assert_fails('the owner guard refuses service_role a rating by someone who does not own the job',
  $s$INSERT INTO job_ratings (user_id, job_id, rating)
     VALUES ('00000000-0000-4000-8000-000000052002', '00000000-0000-4000-8000-000000052012', 'good')$s$, '42501');
DELETE FROM job_ratings
 WHERE user_id = '00000000-0000-4000-8000-000000052001' AND job_id = '00000000-0000-4000-8000-000000052012';
SELECT pg_temp.assert_eq('service_role clears a rating (the API delete)',
  (SELECT count(*)::text FROM job_ratings WHERE job_id = '00000000-0000-4000-8000-000000052012'), '0');
RESET ROLE;

-- 2e. gallery_favorites (520): the API is its only writer. Favorites written
--     as the API writes them (as postgres here), then the client roles.
INSERT INTO gallery_favorites (user_id, job_id) VALUES
  ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052011'),
  ('00000000-0000-4000-8000-000000052002', '00000000-0000-4000-8000-000000052013');
SELECT pg_temp.assert_eq('no write policy on gallery_favorites is left',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gallery_favorites'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND permissive = 'PERMISSIVE'), '0');
SELECT pg_temp.assert_eq('anon and authenticated hold no write privilege on gallery_favorites',
  (has_table_privilege('anon', 'public.gallery_favorites', 'INSERT')
   OR has_table_privilege('anon', 'public.gallery_favorites', 'UPDATE')
   OR has_table_privilege('anon', 'public.gallery_favorites', 'DELETE')
   OR has_table_privilege('anon', 'public.gallery_favorites', 'TRUNCATE')
   OR has_table_privilege('authenticated', 'public.gallery_favorites', 'INSERT')
   OR has_table_privilege('authenticated', 'public.gallery_favorites', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.gallery_favorites', 'DELETE')
   OR has_table_privilege('authenticated', 'public.gallery_favorites', 'TRUNCATE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated still reads gallery_favorites',
  has_table_privilege('authenticated', 'public.gallery_favorites', 'SELECT')::text, 'true');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000052001","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000052001';
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    -- A favorite on another person's job: the write (and the job-id probe) 055 allowed.
    INSERT INTO gallery_favorites (user_id, job_id)
    VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052013');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT gallery_favorites]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT gallery_favorites (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    DELETE FROM gallery_favorites;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot DELETE gallery_favorites]: the delete succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot DELETE gallery_favorites (privilege denied)';
END $$;
SELECT pg_temp.assert_eq('a signed-in user still reads exactly their own favorites',
  (SELECT string_agg(job_id::text, ',') FROM gallery_favorites), '00000000-0000-4000-8000-000000052011');
RESET ROLE;

-- 3. updated_at moves when the rating changes (an insert can backdate it).
INSERT INTO job_ratings (user_id, job_id, rating, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000052001', '00000000-0000-4000-8000-000000052012', 'good',
        '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');
UPDATE job_ratings SET rating = 'bad' WHERE job_id = '00000000-0000-4000-8000-000000052012';
SELECT pg_temp.assert_eq('changing a rating stamps updated_at, and keeps created_at',
  (SELECT (updated_at > '2000-01-01T00:00:00Z'::timestamptz)::text || ' ' || (created_at = '2000-01-01T00:00:00Z'::timestamptz)::text
     FROM job_ratings WHERE job_id = '00000000-0000-4000-8000-000000052012'), 'true true');

-- 4. Cascades: a deleted job takes its rating; a deleted person takes theirs.
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000052012';
SELECT pg_temp.assert_eq('deleting a job deletes its rating',
  (SELECT count(*)::text FROM job_ratings WHERE job_id = '00000000-0000-4000-8000-000000052012'), '0');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000052001';
SELECT pg_temp.assert_eq('deleting the person deletes their ratings',
  (SELECT count(*)::text FROM job_ratings WHERE user_id = '00000000-0000-4000-8000-000000052001'), '0');

-- 5. The names the list filters embed by, and no junction-shaped key.
SELECT pg_temp.assert_eq('job_ratings_job_id_fkey is job_ratings.job_id -> jobs',
  (SELECT (confrelid = 'public.jobs'::regclass)::text FROM pg_constraint
    WHERE conrelid = 'public.job_ratings'::regclass AND conname = 'job_ratings_job_id_fkey' AND contype = 'f'), 'true');
SELECT pg_temp.assert_eq('gallery_favorites_job_id_fkey is gallery_favorites.job_id -> jobs',
  (SELECT (confrelid = 'public.jobs'::regclass)::text FROM pg_constraint
    WHERE conrelid = 'public.gallery_favorites'::regclass AND conname = 'gallery_favorites_job_id_fkey' AND contype = 'f'), 'true');
SELECT pg_temp.assert_eq('the primary key of job_ratings is the surrogate id alone',
  (SELECT string_agg(a.attname, ',') FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.job_ratings'::regclass AND c.contype = 'p'), 'id');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
