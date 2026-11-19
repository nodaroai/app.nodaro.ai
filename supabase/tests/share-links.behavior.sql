-- ============================================================================
-- Behavioral proof: share links (migration 680).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000680xx).
--
-- What it pins:
--   1. share_links is service-role only: a signed-in user (even the row's
--      owner) and an anonymous caller hold no privilege on it, no policy opens
--      it, and the summaries function is callable by the service role alone.
--   2. One row per item, and a token is a token: a second row for the same
--      (owner, kind, target) and a malformed token are refused; a kind outside
--      job / session / project is refused.
--   3. share_link_session_summaries counts and lists only what a link shows:
--      live links of the session's owner, to completed top-level jobs that
--      are not in the Trash, not restricted, not kept private, that made an
--      image, video or sound, and whose prompt, prompt text and name hold none
--      of the words passed in — the cover first when it is shown, then newest.
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

CREATE FUNCTION pg_temp.assert_raises(label text, stmt text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
  END;
  IF got IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got SQLSTATE % expected %', label, coalesce(got, '<none>'), expected_state;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000068001', 'share-owner@share.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000068002', 'share-stranger@share.test', '{}', 'authenticated', 'authenticated');

-- 1. Privileges -----------------------------------------------------------------
INSERT INTO share_links (token, owner_id, kind, target_id)
VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-4000-8000-000000068001', 'job', '00000000-0000-4000-8000-000000068099');

SELECT pg_temp.assert_eq('RLS is on for share_links',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.share_links'::regclass), 'true');
SELECT pg_temp.assert_eq('no policy opens share_links',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'share_links'), '0');
SELECT pg_temp.assert_eq('neither browser role holds any privilege on share_links',
  (SELECT bool_or(has_table_privilege(r, 'public.share_links', p))::text
     FROM unnest(ARRAY['authenticated', 'anon']) AS r,
          unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p), 'false');
SELECT pg_temp.assert_eq('the service role reads and writes share_links',
  (has_table_privilege('service_role', 'public.share_links', 'SELECT')
   AND has_table_privilege('service_role', 'public.share_links', 'UPDATE'))::text, 'true');
SELECT pg_temp.assert_eq('only the service role runs the summaries',
  (SELECT string_agg(r || '=' || has_function_privilege(r, 'public.share_link_session_summaries(uuid[], text[])', 'EXECUTE')::text, ',' ORDER BY r)
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r), 'anon=false,authenticated=false,service_role=true');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000068001","role":"authenticated"}', true);
SELECT pg_temp.assert_raises('the owner cannot read share_links through the API role',
  'SELECT count(*) FROM public.share_links', '42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_raises('an anonymous caller cannot read share_links',
  'SELECT count(*) FROM public.share_links', '42501');
RESET ROLE;

-- 2. Integrity --------------------------------------------------------------------
SELECT pg_temp.assert_raises('a second row for the same item is refused',
  $$INSERT INTO share_links (token, owner_id, kind, target_id)
    VALUES ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000-0000-4000-8000-000000068001', 'job', '00000000-0000-4000-8000-000000068099')$$,
  '23505');
SELECT pg_temp.assert_raises('a token of another shape is refused',
  $$INSERT INTO share_links (token, owner_id, kind, target_id)
    VALUES ('short', '00000000-0000-4000-8000-000000068001', 'job', '00000000-0000-4000-8000-000000068098')$$,
  '23514');
SELECT pg_temp.assert_raises('a kind outside job / session / project is refused',
  $$INSERT INTO share_links (token, owner_id, kind, target_id)
    VALUES ('ccccccccccccccccccccccccccccccccccccccccccc', '00000000-0000-4000-8000-000000068001', 'workflow', '00000000-0000-4000-8000-000000068097')$$,
  '23514');
SELECT pg_temp.assert_raises('the same token twice is refused',
  $$INSERT INTO share_links (token, owner_id, kind, target_id)
    VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-4000-8000-000000068002', 'job', '00000000-0000-4000-8000-000000068096')$$,
  '23505');

-- 3. The summaries ------------------------------------------------------------------
-- S1 holds every case; S2 is empty; S3 is the stranger's.
INSERT INTO generation_sessions (id, user_id, tool) VALUES
  ('00000000-0000-4000-8000-000000068011', '00000000-0000-4000-8000-000000068001', 'create-image'),
  ('00000000-0000-4000-8000-000000068012', '00000000-0000-4000-8000-000000068001', 'create-image'),
  ('00000000-0000-4000-8000-000000068013', '00000000-0000-4000-8000-000000068002', 'create-image');

-- Shown: A (oldest image), B (video), C (newest image).
-- Not shown: D failed, E in the Trash, F a child of A, G restricted,
-- H kept private, I no media, J a blocked word in its prompt, K in its name,
-- L a removed item, M an empty image list, P private by its input flag,
-- Q a media field with no address.
INSERT INTO jobs (id, user_id, status, session_id, input_data, output_data, created_at) VALUES
  ('00000000-0000-4000-8000-0000000680a1', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"a red car"}', '{"imageUrl":"https://cdn.test/images/a.png"}', now() - interval '10 min'),
  ('00000000-0000-4000-8000-0000000680b1', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-video","prompt":"waves"}', '{"videoUrl":"https://cdn.test/videos/b.mp4"}', now() - interval '9 min'),
  ('00000000-0000-4000-8000-0000000680c1', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","userPrompt":"a blue boat"}', '{"imageUrls":["https://cdn.test/images/c1.png","https://cdn.test/images/c2.png"]}', now() - interval '1 min'),
  ('00000000-0000-4000-8000-0000000680d1', '00000000-0000-4000-8000-000000068001', 'failed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', NULL, now() - interval '8 min'),
  ('00000000-0000-4000-8000-0000000680e1', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', '{"imageUrl":"https://cdn.test/images/e.png"}', now() - interval '7 min'),
  ('00000000-0000-4000-8000-0000000680f1', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', '{"imageUrl":"https://cdn.test/images/f.png"}', now() - interval '6 min'),
  ('00000000-0000-4000-8000-0000000680a7', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', '{"imageUrl":"https://cdn.test/images/g.png"}', now() - interval '5 min'),
  ('00000000-0000-4000-8000-0000000680a8', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', '{"imageUrl":"https://cdn.test/images/h.png"}', now() - interval '4 min'),
  ('00000000-0000-4000-8000-0000000680a9', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-text","prompt":"x"}', '{"text":"hello"}', now() - interval '3 min'),
  ('00000000-0000-4000-8000-0000000680aa', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"a NSFW scene"}', '{"imageUrl":"https://cdn.test/images/j.png"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-0000000680ab', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"a cat"}', '{"imageUrl":"https://cdn.test/images/k.png"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-0000000680ac', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"a dog"}', '{"imageUrl":"https://cdn.test/images/l.png"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-0000000680ad', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"a fox"}', '{"imageUrls":[]}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-0000000680ae', '00000000-0000-4000-8000-000000068002', 'completed', '00000000-0000-4000-8000-000000068013',
   '{"type":"generate-image","prompt":"theirs"}', '{"imageUrl":"https://cdn.test/images/s.png"}', now() - interval '2 min'),
  -- Kept private by its own input flag; and a media field that holds no address.
  ('00000000-0000-4000-8000-0000000680af', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x","forcePrivate":true}', '{"imageUrl":"https://cdn.test/images/p.png"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-0000000680b0', '00000000-0000-4000-8000-000000068001', 'completed', '00000000-0000-4000-8000-000000068011',
   '{"type":"generate-image","prompt":"x"}', '{"imageUrl":"not-an-address"}', now() - interval '2 min');

UPDATE jobs SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-0000000680e1';
UPDATE jobs SET parent_job_id = '00000000-0000-4000-8000-0000000680a1' WHERE id = '00000000-0000-4000-8000-0000000680f1';
UPDATE jobs SET restricted_at = now() WHERE id = '00000000-0000-4000-8000-0000000680a7';
UPDATE jobs SET force_private = true WHERE id = '00000000-0000-4000-8000-0000000680a8';
UPDATE jobs SET title = 'My Porn edit' WHERE id = '00000000-0000-4000-8000-0000000680ab';
UPDATE session_items SET removed_at = now() WHERE job_id = '00000000-0000-4000-8000-0000000680ac';

CREATE FUNCTION pg_temp.summary(p_session uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT s.item_count::text || ':' ||
         coalesce((SELECT string_agg(right(e ->> 'job_id', 2), ',' ORDER BY n) FROM jsonb_array_elements(s.recent) WITH ORDINALITY AS r(e, n)), '')
    FROM public.share_link_session_summaries(ARRAY[p_session], ARRAY['porn', 'nsfw']) AS s
$$;

SELECT pg_temp.assert_eq('a session counts and lists only what its link shows, newest first',
  pg_temp.summary('00000000-0000-4000-8000-000000068011'), '3:c1,b1,a1');

UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-0000000680a1' WHERE id = '00000000-0000-4000-8000-000000068011';
SELECT pg_temp.assert_eq('the cover comes first when it is shown',
  pg_temp.summary('00000000-0000-4000-8000-000000068011'), '3:a1,c1,b1');

SELECT pg_temp.assert_eq('an empty session answers zero and no items',
  pg_temp.summary('00000000-0000-4000-8000-000000068012'), '0:');

SELECT pg_temp.assert_eq('with no words passed, only the word rule stops holding',
  (SELECT item_count::text FROM public.share_link_session_summaries(ARRAY['00000000-0000-4000-8000-000000068011'::uuid], NULL)), '5');

SELECT pg_temp.assert_eq('one call answers every session asked, in one row each',
  (SELECT string_agg(right(session_id::text, 2) || '=' || item_count, ',' ORDER BY session_id)
     FROM public.share_link_session_summaries(ARRAY[
       '00000000-0000-4000-8000-000000068011'::uuid, '00000000-0000-4000-8000-000000068012'::uuid, '00000000-0000-4000-8000-000000068013'::uuid
     ], ARRAY['porn', 'nsfw'])), '11=3,12=0,13=1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
