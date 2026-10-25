-- ============================================================================
-- Behavioral proof: the Trash for generation sessions and jobs (migrations
-- 561 + 562).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000561xx).
--
-- What it pins:
--   1. Shape and privileges: the two columns, the jobs index, the restrictive
--      read policy, every new function service-role only, no new grant.
--   2. Only live items count: previews and item_count skip removed links and
--      deleted jobs; removed_count counts removed links of live jobs.
--   3. The cover is a live item: refused for a removed link or a deleted job;
--      cleared when its link is removed or its job deleted; a revive touches
--      the session.
--   4. move_session_items: moves, keeps `native` where the job was born (and
--      writes a new native link), revives a removed target link in place
--      (kind, origin and position kept), dedupes ids, and is all-or-nothing.
--   5. list_trash: both kinds in its own order, a deleted job once, every
--      scope, child and inner-run jobs left out, the workspace line, the keyset
--      across ties and a limit that cuts rows.
--   6. RLS: a deleted job is nobody's to read through the browser roles.
--   7. delete_trashed_job_with_recast_cleanup: only a job in the Trash since
--      before the cutoff, only the owner's (unless admin); the links cascade.
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

CREATE FUNCTION pg_temp.assert_refused(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: the statement succeeded', label;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A page of the Trash, in list_trash's OWN order (never re-sorted here), as
-- "kind:job-suffix[:session-suffix]".
CREATE FUNCTION pg_temp.trash(p_user uuid, p_ws uuid, p_tool text, p_project uuid, p_none boolean, p_types text[],
                              p_at timestamptz DEFAULT NULL, p_key text DEFAULT NULL, p_limit int DEFAULT 50) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.kind || ':' || right(t.job_id::text, 2) || coalesce(':' || right(t.session_id::text, 2), ''), ',' ORDER BY t.n), '')
    FROM public.list_trash(p_user, p_ws, p_tool, p_project, p_none, p_types, p_at, p_key, p_limit)
         WITH ORDINALITY AS t(kind, at, job_id, session_id, sort_key, n)
$$;

-- A = owner, B = stranger. A has projects P1, P2 and a workflow in P1.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000056101', 'trash-owner@trash.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000056102', 'trash-stranger@trash.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000056111', '00000000-0000-4000-8000-000000056101', 'P1'),
  ('00000000-0000-4000-8000-000000056112', '00000000-0000-4000-8000-000000056101', 'P2');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000056113', '00000000-0000-4000-8000-000000056111', '00000000-0000-4000-8000-000000056101', 'W');
INSERT INTO workflow_executions (id, workflow_id, user_id, status, is_component_execution) VALUES
  ('00000000-0000-4000-8000-000000056114', '00000000-0000-4000-8000-000000056113', '00000000-0000-4000-8000-000000056101', 'completed', true);

-- Sessions of A: S1 (image, P1), S2 (image, no project), S3 (video, P2),
-- S4 (video, no project). B's session SB.
INSERT INTO generation_sessions (id, user_id, tool, project_id) VALUES
  ('00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056101', 'create-image', '00000000-0000-4000-8000-000000056111'),
  ('00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056101', 'create-image', NULL),
  ('00000000-0000-4000-8000-000000056123', '00000000-0000-4000-8000-000000056101', 'create-video', '00000000-0000-4000-8000-000000056112'),
  ('00000000-0000-4000-8000-000000056125', '00000000-0000-4000-8000-000000056101', 'create-video', NULL),
  ('00000000-0000-4000-8000-000000056124', '00000000-0000-4000-8000-000000056102', 'create-image', NULL);

-- Jobs of A: J1, J2 born in S1; J3 born in S2; J4 in no session; J5 born in
-- S3; J6 born in S4; JC a child of J4, born in S1; JX an inner job of a
-- component run. B's JB born in SB.
INSERT INTO jobs (id, user_id, status, session_id, input_data, created_at) VALUES
  ('00000000-0000-4000-8000-000000056131', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056121', '{"type":"generate-image"}', now() - interval '5 min'),
  ('00000000-0000-4000-8000-000000056132', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056121', '{"type":"generate-image"}', now() - interval '4 min'),
  ('00000000-0000-4000-8000-000000056133', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056122', '{"type":"generate-image"}', now() - interval '3 min'),
  ('00000000-0000-4000-8000-000000056135', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056123', '{"type":"generate-video"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-000000056136', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056125', '{"type":"generate-video"}', now() - interval '2 min'),
  ('00000000-0000-4000-8000-000000056139', '00000000-0000-4000-8000-000000056102', 'completed', '00000000-0000-4000-8000-000000056124', '{"type":"generate-image"}', now() - interval '1 min');
INSERT INTO jobs (id, user_id, status, input_data, output_data, is_public) VALUES
  ('00000000-0000-4000-8000-000000056134', '00000000-0000-4000-8000-000000056101', 'completed', '{"type":"generate-image"}', '{"imageUrl":"https://x.test/4.png"}', true);
INSERT INTO jobs (id, user_id, status, session_id, parent_job_id, input_data) VALUES
  ('00000000-0000-4000-8000-0000000561c1', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056134', '{"type":"generate-image"}');
INSERT INTO jobs (id, user_id, status, workflow_execution_id, input_data) VALUES
  ('00000000-0000-4000-8000-0000000561e1', '00000000-0000-4000-8000-000000056101', 'completed', '00000000-0000-4000-8000-000000056114', '{"type":"generate-image"}');

-- 1. Shape and privileges ------------------------------------------------------
SELECT pg_temp.assert_eq('session_items.removed_at exists and is nullable',
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_items' AND column_name = 'removed_at'), 'YES');
SELECT pg_temp.assert_eq('jobs.deleted_at exists and is nullable',
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'deleted_at'), 'YES');
SELECT pg_temp.assert_eq('the partial jobs Trash index exists',
  (SELECT count(*)::text FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'jobs' AND indexname = 'idx_jobs_trash'
      AND indexdef LIKE '%WHERE (deleted_at IS NOT NULL)%'), '1');
SELECT pg_temp.assert_eq('a restrictive read policy hides a deleted job from the browser roles',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs' AND policyname = 'A deleted job is hidden'
      AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'), '1');
SELECT pg_temp.assert_eq('authenticated cannot read jobs.deleted_at',
  has_column_privilege('authenticated', 'public.jobs', 'deleted_at', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated still holds no privilege on session_items',
  (has_table_privilege('authenticated', 'public.session_items', 'SELECT')
   OR has_table_privilege('authenticated', 'public.session_items', 'UPDATE'))::text, 'false');
SELECT pg_temp.assert_eq('no policy was added on session_items',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'session_items'), '0');
SELECT pg_temp.assert_eq('no new function is callable by authenticated or anon',
  (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))::text
     FROM unnest(ARRAY['authenticated', 'anon']) AS r,
          unnest(ARRAY[
            'public.generation_session_previews(uuid[])',
            'public.move_session_items(uuid, uuid, uuid, uuid, uuid[])',
            'public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer)',
            'public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz)'
          ]) AS f), 'false');
SELECT pg_temp.assert_eq('the service role can call every new function',
  (SELECT bool_and(has_function_privilege('service_role', f, 'EXECUTE'))::text
     FROM unnest(ARRAY[
            'public.generation_session_previews(uuid[])',
            'public.move_session_items(uuid, uuid, uuid, uuid, uuid[])',
            'public.list_trash(uuid, uuid, text, uuid, boolean, text[], timestamptz, text, integer)',
            'public.delete_trashed_job_with_recast_cleanup(uuid, uuid, boolean, timestamptz)'
          ]) AS f), 'true');
SELECT pg_temp.assert_eq('generation_session_previews has one overload',
  (SELECT count(*)::text FROM pg_proc WHERE proname = 'generation_session_previews'), '1');

-- 2. Only live items count ---------------------------------------------------
-- J4 imported into S1 too: S1 = J1, J2 (native), JC (native child), J4 (imported).
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-000000056134', 'imported');
UPDATE session_items SET removed_at = now()
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id IN ('00000000-0000-4000-8000-000000056131', '00000000-0000-4000-8000-0000000561c1');
UPDATE jobs SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-000000056132';
SELECT pg_temp.assert_eq('item_count skips the removed links and the deleted job',
  (SELECT item_count::text FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000056121']::uuid[])), '1');
SELECT pg_temp.assert_eq('removed_count counts the removed links of live jobs',
  (SELECT removed_count::text FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000056121']::uuid[])), '2');
SELECT pg_temp.assert_eq('the previews show only the live completed item',
  (SELECT jsonb_path_query_array(recent, '$[*].job_id')::text
     FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000056121']::uuid[])),
  '["00000000-0000-4000-8000-000000056134"]');
UPDATE session_items SET removed_at = now()
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056132';
SELECT pg_temp.assert_eq('a removed link of a deleted job is not counted twice',
  (SELECT removed_count::text FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000056121']::uuid[])), '2');
-- Back to: J1 and JC removed from S1, J2 live in S1 and deleted.
UPDATE session_items SET removed_at = NULL
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056132';

-- 3. The cover is a live item -------------------------------------------------
SELECT pg_temp.assert_refused('a removed link cannot be the cover',
  $s$UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000056131'
     WHERE id = '00000000-0000-4000-8000-000000056121'$s$);
SELECT pg_temp.assert_refused('a deleted job cannot be the cover',
  $s$UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000056132'
     WHERE id = '00000000-0000-4000-8000-000000056121'$s$);
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000056134'
 WHERE id = '00000000-0000-4000-8000-000000056121';
UPDATE session_items SET removed_at = now()
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056134';
SELECT pg_temp.assert_eq('removing the cover''s item clears the cover',
  (SELECT (cover_job_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000056121'), 'true');
UPDATE generation_sessions SET updated_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-000000056121';
UPDATE session_items SET removed_at = NULL
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056134';
SELECT pg_temp.assert_eq('a revived item touches its session',
  (SELECT (updated_at > now() - interval '1 hour')::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000056121'), 'true');
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000056134'
 WHERE id = '00000000-0000-4000-8000-000000056121';
UPDATE jobs SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-000000056134';
SELECT pg_temp.assert_eq('deleting the cover''s job clears the cover',
  (SELECT (cover_job_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000056121'), 'true');
UPDATE jobs SET deleted_at = NULL WHERE id = '00000000-0000-4000-8000-000000056134';
SELECT pg_temp.assert_eq('a restored job is back in its session',
  (SELECT item_count::text FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000056121']::uuid[])), '1');

-- 4. move_session_items -------------------------------------------------------
-- J3 (born in S2) moves S2 -> S1, its id given twice: imported into S1 from
-- S2, removed from S2, counted once.
SELECT pg_temp.assert_eq('a move answers how many moved, duplicates once',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133', '00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"moved": 1}');
SELECT pg_temp.assert_eq('the target holds a live imported link from the source',
  (SELECT kind || ':' || (removed_at IS NULL)::text || ':' || imported_from_session_id::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056133'),
  'imported:true:00000000-0000-4000-8000-000000056122');
SELECT pg_temp.assert_eq('the source link is removed, not deleted',
  (SELECT (removed_at IS NOT NULL)::text || ':' || kind FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056133'),
  'true:native');
-- And back S1 -> S2: the removed native link in S2 is revived where it was.
SELECT pg_temp.assert_eq('moving back answers moved',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056121',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"moved": 1}');
SELECT pg_temp.assert_eq('the revived native link is live and native',
  (SELECT kind || ':' || (removed_at IS NULL)::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056133'),
  'native:true');
-- A removed IMPORTED link is revived with its origin and its place kept:
-- J3 into S1 again, whose old imported link (from S2) is removed.
UPDATE session_items SET added_at = '2026-01-01T00:00:00Z'
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056133';
SELECT pg_temp.assert_eq('a move into a session that has the item removed',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"moved": 1}');
SELECT pg_temp.assert_eq('the revived imported link keeps its kind, origin and place',
  (SELECT kind || ':' || (removed_at IS NULL)::text || ':' || imported_from_session_id::text || ':' || (added_at = '2026-01-01T00:00:00Z')::text
     FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056133'),
  'imported:true:00000000-0000-4000-8000-000000056122:true');
-- Back to S2 for the rest (S1's link removed again).
SELECT pg_temp.assert_eq('and back again',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056121',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"moved": 1}');
-- A job whose native link was deleted for good, moved back into the session
-- it was born in, gets a NEW native link: J6 born in S4; into S2, then home.
DELETE FROM session_items WHERE session_id = '00000000-0000-4000-8000-000000056125' AND job_id = '00000000-0000-4000-8000-000000056136';
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-000000056136', 'imported');
SELECT pg_temp.assert_eq('a move home answers moved',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056125', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056136']::uuid[])::text, '{"moved": 1}');
SELECT pg_temp.assert_eq('a new link in the session the job was born in is native, with no origin',
  (SELECT kind || ':' || coalesce(imported_from_session_id::text, 'none') FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056125' AND job_id = '00000000-0000-4000-8000-000000056136'),
  'native:none');
-- Into another project: J5 S3 (P2) -> S1 (P1).
SELECT pg_temp.assert_eq('a move into another project''s session',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056123',
    ARRAY['00000000-0000-4000-8000-000000056135']::uuid[])::text, '{"moved": 1}');
SELECT pg_temp.assert_eq('the moved job is live in P1''s session only',
  (SELECT string_agg(session_id::text, ',' ORDER BY session_id) FROM session_items
    WHERE job_id = '00000000-0000-4000-8000-000000056135' AND removed_at IS NULL),
  '00000000-0000-4000-8000-000000056121');
-- All or nothing: J3 (live in S2) with J1 (not live in S2) changes nothing.
SELECT pg_temp.assert_eq('one id that is not a live item of the source refuses the move',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133', '00000000-0000-4000-8000-000000056131']::uuid[])::text,
  '{"error": "item_not_found"}');
SELECT pg_temp.assert_eq('the refused move left the source untouched',
  (SELECT (removed_at IS NULL)::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056133'), 'true');
SELECT pg_temp.assert_eq('and the target untouched',
  (SELECT (removed_at IS NOT NULL)::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056133'), 'true');
-- JC is a live child item of S2 for this check.
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-0000000561c1', 'imported');
SELECT pg_temp.assert_eq('a child job cannot be moved',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-0000000561c1']::uuid[])::text, '{"error": "item_not_found"}');
DELETE FROM session_items WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-0000000561c1';
SELECT pg_temp.assert_eq('a stranger''s target session is not found',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056124', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"error": "session_not_found"}');
SELECT pg_temp.assert_eq('the stranger cannot move the owner''s items',
  move_session_items('00000000-0000-4000-8000-000000056102', NULL,
    '00000000-0000-4000-8000-000000056124', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"error": "session_not_found"}');
SELECT pg_temp.assert_eq('a session in another workspace context is not found',
  move_session_items('00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-0000000561ff',
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"error": "session_not_found"}');
SELECT pg_temp.assert_eq('the same session twice is refused',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133']::uuid[])::text, '{"error": "same_session"}');
SELECT pg_temp.assert_eq('a deleted job cannot be moved',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056121',
    ARRAY['00000000-0000-4000-8000-000000056132']::uuid[])::text, '{"error": "item_not_found"}');
SELECT pg_temp.assert_eq('a null id refuses the whole move',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    ARRAY['00000000-0000-4000-8000-000000056133', NULL]::uuid[])::text, '{"error": "item_not_found"}');
SELECT pg_temp.assert_eq('more than 100 ids is refused',
  move_session_items('00000000-0000-4000-8000-000000056101', NULL,
    '00000000-0000-4000-8000-000000056121', '00000000-0000-4000-8000-000000056122',
    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101)))::text, '{"error": "too_many"}');

-- 5. list_trash ----------------------------------------------------------------
-- A's Trash: J1 removed from S1; J2 deleted (live in S1); J3 removed from S1;
-- J4 removed from S2; J5 removed from S3; J6 removed from S2; JC removed from
-- S1 (a child: never listed). Pin the order with distinct times.
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000056122', '00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-000000056134', 'imported');
UPDATE session_items SET removed_at = now() - interval '50 s'
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056131';
UPDATE jobs SET deleted_at = now() - interval '40 s' WHERE id = '00000000-0000-4000-8000-000000056132';
UPDATE session_items SET removed_at = now() - interval '30 s'
 WHERE session_id = '00000000-0000-4000-8000-000000056121' AND job_id = '00000000-0000-4000-8000-000000056133';
UPDATE session_items SET removed_at = now() - interval '20 s'
 WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056134';
UPDATE session_items SET removed_at = now() - interval '10 s'
 WHERE session_id = '00000000-0000-4000-8000-000000056123' AND job_id = '00000000-0000-4000-8000-000000056135';
UPDATE session_items SET removed_at = now() - interval '60 s'
 WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056136';
SELECT pg_temp.assert_eq('everywhere: both kinds, newest first',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL),
  'removed:35:23,removed:34:22,removed:33:21,deleted:32,removed:31:21,removed:36:22');
SELECT pg_temp.assert_eq('a limit cuts the newest rows off, in order',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL, NULL, NULL, 2),
  'removed:35:23,removed:34:22');
SELECT pg_temp.assert_eq('one project: its sessions'' removals, and deleted jobs live in it',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, '00000000-0000-4000-8000-000000056111', false, NULL),
  'removed:33:21,deleted:32,removed:31:21');
SELECT pg_temp.assert_eq('no project: project-less sessions'' removals',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, true, NULL),
  'removed:34:22,removed:36:22');
SELECT pg_temp.assert_eq('by tool',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, 'create-video', NULL, false, NULL),
  'removed:35:23');
SELECT pg_temp.assert_eq('by type',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, ARRAY['generate-video']),
  'removed:35:23,removed:36:22');
-- A deleted job in General (no live link) is "no project"; its tool is the
-- session it was born in.
UPDATE jobs SET deleted_at = now() - interval '5 s' WHERE id = '00000000-0000-4000-8000-000000056131';
SELECT pg_temp.assert_eq('a deleted job in General is shown once, as deleted, under no project',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, 'create-image', NULL, true, NULL),
  'deleted:31,removed:34:22,removed:36:22');
SELECT pg_temp.assert_eq('everywhere, a removed link of a deleted job is not listed beside it',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL),
  'deleted:31,removed:35:23,removed:34:22,removed:33:21,deleted:32,removed:36:22');
SELECT pg_temp.assert_eq('a deleted job is in a project''s Trash only through a LIVE link to it',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, '00000000-0000-4000-8000-000000056111', false, NULL),
  'removed:33:21,deleted:32');
-- J6 deleted, its only links gone for good: its tool is still its birth session's.
DELETE FROM session_items WHERE job_id = '00000000-0000-4000-8000-000000056136';
UPDATE jobs SET deleted_at = now() - interval '1 s' WHERE id = '00000000-0000-4000-8000-000000056136';
SELECT pg_temp.assert_eq('a deleted job with no link left keeps the tool of the session it was born in',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, 'create-video', NULL, false, NULL),
  'deleted:36,removed:35:23');
-- Child and inner-run jobs in the Trash are never listed.
UPDATE jobs SET deleted_at = now() WHERE id IN ('00000000-0000-4000-8000-0000000561c1', '00000000-0000-4000-8000-0000000561e1');
SELECT pg_temp.assert_eq('a child job and an inner run''s job are never listed, removed or deleted',
  (SELECT count(*)::text FROM list_trash('00000000-0000-4000-8000-000000056101', NULL) t
    WHERE t.job_id IN ('00000000-0000-4000-8000-0000000561c1', '00000000-0000-4000-8000-0000000561e1')), '0');
UPDATE jobs SET deleted_at = NULL WHERE id = '00000000-0000-4000-8000-0000000561c1';
SELECT pg_temp.assert_eq('a removed child link is never listed either',
  (SELECT count(*)::text FROM list_trash('00000000-0000-4000-8000-000000056101', NULL) t
    WHERE t.job_id = '00000000-0000-4000-8000-0000000561c1'), '0');
SELECT pg_temp.assert_eq('the stranger''s Trash holds none of it',
  pg_temp.trash('00000000-0000-4000-8000-000000056102', NULL, NULL, NULL, false, NULL), '');
SELECT pg_temp.assert_eq('another workspace context holds none of it',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', '00000000-0000-4000-8000-0000000561ff', NULL, NULL, false, NULL), '');
SELECT pg_temp.assert_eq('the keyset continues strictly after the cursor',
  pg_temp.trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL,
    (SELECT removed_at FROM session_items WHERE session_id = '00000000-0000-4000-8000-000000056122' AND job_id = '00000000-0000-4000-8000-000000056134'),
    'r:00000000-0000-4000-8000-000000056122:00000000-0000-4000-8000-000000056134', 2),
  'removed:33:21,deleted:32');
-- Ties: three removals at the same instant page one by one, none skipped or repeated.
UPDATE session_items SET removed_at = '2026-10-01T00:00:00Z'
 WHERE removed_at IS NOT NULL AND job_id IN ('00000000-0000-4000-8000-000000056133', '00000000-0000-4000-8000-000000056134', '00000000-0000-4000-8000-000000056135');
CREATE TEMP TABLE pages AS
  WITH p1 AS (SELECT * FROM list_trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL, '2026-10-01T00:00:01Z', 'r:', 1)),
       p2 AS (SELECT * FROM list_trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL, (SELECT at FROM p1), (SELECT sort_key FROM p1), 1)),
       p3 AS (SELECT * FROM list_trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL, (SELECT at FROM p2), (SELECT sort_key FROM p2), 1))
  SELECT 1 AS n, job_id FROM p1 UNION ALL SELECT 2, job_id FROM p2 UNION ALL SELECT 3, job_id FROM p3;
SELECT pg_temp.assert_eq('three tied removals page one by one, each once',
  (SELECT count(DISTINCT job_id)::text FROM pages), '3');
DO $$ BEGIN
  PERFORM public.list_trash('00000000-0000-4000-8000-000000056101', NULL, NULL, NULL, false, NULL, now(), NULL, 10);
  RAISE EXCEPTION 'ASSERT FAIL [a cursor time without its key is refused]: it ran';
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE NOTICE 'ok  a cursor time without its key is refused';
END $$;

-- 6. RLS: a deleted job is nobody's to read through the browser roles --------
-- J4 is A's public, completed, live job; JB is B's.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000056102","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000056102';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.jobs WHERE id = '00000000-0000-4000-8000-000000056134') <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL [a stranger reads a live public job]';
  END IF;
  RAISE NOTICE 'ok  a stranger reads a live public job';
END $$;
RESET ROLE;
UPDATE jobs SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-000000056134';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.jobs WHERE id = '00000000-0000-4000-8000-000000056134') <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL [a stranger cannot read a deleted public job]';
  END IF;
  RAISE NOTICE 'ok  a stranger cannot read a deleted public job';
END $$;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000056101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000056101';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.jobs WHERE id = '00000000-0000-4000-8000-000000056134') <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot read their deleted job through RLS]';
  END IF;
  IF (SELECT count(*) FROM public.jobs WHERE id = '00000000-0000-4000-8000-000000056135') <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner still reads their live job]';
  END IF;
  RAISE NOTICE 'ok  the owner reads their live job, not their deleted one';
END $$;
RESET ROLE;
UPDATE jobs SET deleted_at = NULL WHERE id = '00000000-0000-4000-8000-000000056134';

-- 7. Delete for good ------------------------------------------------------------
SELECT pg_temp.assert_eq('a live job is never deleted for good',
  delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-000000056133',
    '00000000-0000-4000-8000-000000056101', false, 'infinity')::text, '{"deleted": false, "baseUrls": []}');
SELECT pg_temp.assert_eq('a job trashed after the cutoff is kept',
  delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-000000056132',
    NULL, true, now() - interval '30 days')::text, '{"deleted": false, "baseUrls": []}');
SELECT pg_temp.assert_eq('the stranger cannot delete the owner''s trashed job',
  delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-000000056132',
    '00000000-0000-4000-8000-000000056102', false, 'infinity')::text, '{"deleted": false, "baseUrls": []}');
SELECT pg_temp.assert_eq('the owner deletes their trashed job for good',
  delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-000000056132',
    '00000000-0000-4000-8000-000000056101', false, 'infinity')::text, '{"deleted": true, "baseUrls": []}');
SELECT pg_temp.assert_eq('the job and its links are gone',
  (SELECT (SELECT count(*) FROM jobs WHERE id = '00000000-0000-4000-8000-000000056132')
        + (SELECT count(*) FROM session_items WHERE job_id = '00000000-0000-4000-8000-000000056132'))::text, '0');
UPDATE jobs SET deleted_at = now() - interval '31 days' WHERE id = '00000000-0000-4000-8000-000000056131';
SELECT pg_temp.assert_eq('the purge deletes a job trashed before the cutoff',
  delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-000000056131',
    NULL, true, now() - interval '30 days')::text, '{"deleted": true, "baseUrls": []}');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
