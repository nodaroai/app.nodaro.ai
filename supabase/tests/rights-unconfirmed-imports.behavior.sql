-- ============================================================================
-- Behavioral proof: imports without a content rights confirmation, and the
-- share that carried one (migration 597).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000b71 upward).
--
-- WHY THIS PROOF EXISTS. An administrator turns `content_rights_required` on
-- by this count: an import counted twice (a job's retry), a confirmed import
-- counted as unconfirmed, or confirmations from before counting began set
-- against a count that did not exist yet, would each misstate how many
-- imports the switch would refuse. And nobody but the server may read which
-- sites are imported from.
--
-- Run locally: see content-rights.behavior.sql.
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

-- Runs a statement that must fail, and answers the SQLSTATE it failed with.
CREATE FUNCTION pg_temp.expect_error(label text, stmt text, want_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> want_state THEN
      RAISE EXCEPTION 'ASSERT FAIL [%]: failed with % (%) expected %', label, SQLSTATE, SQLERRM, want_state;
    END IF;
    RAISE NOTICE 'ok  %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: did not fail', label;
END $$;

-- The share's rows as "declaration/lane/via/app=imports", in the order it answers them.
CREATE FUNCTION pg_temp.share_rows(p_since timestamptz) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(
           (r->>'declaration') || '/' || coalesce(r->>'lane', '-') || '/' || coalesce(r->>'via', '-') || '/' || coalesce(r->>'app_id', '-') || '=' || (r->>'imports'),
           ',' ORDER BY n)
    FROM jsonb_array_elements(public.content_rights_import_share(p_since)->'rows') WITH ORDINALITY AS t(r, n)
$$;

-- Counting began a week ago, for this proof: the share reaches back no further.
UPDATE rights_import_share_start SET started_at = now() - interval '7 days' WHERE id;
SELECT pg_temp.assert_eq('counting began once: one start row',
  (SELECT count(*)::text FROM rights_import_share_start), '1');

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000b71', 'ui-owner@ui.test', '{}', 'authenticated', 'authenticated');

-- 1. One row per import: a retry of the same request and host is the same import.
INSERT INTO rights_unconfirmed_imports (lane, via, request_id, host)
VALUES ('route', 'session', 'job-1', 'www.youtube.com');
SELECT pg_temp.expect_error('a retry of the same request is not a second import',
  $q$INSERT INTO rights_unconfirmed_imports (lane, via, request_id, host) VALUES ('route', 'session', 'job-1', 'www.youtube.com')$q$, '23505');
INSERT INTO rights_unconfirmed_imports (lane, via, request_id, host)
VALUES ('route', 'session', 'job-1', 'www.tiktok.com');
INSERT INTO rights_unconfirmed_imports (lane, via, app_id, host)
VALUES ('route', 'app', 'app-1', 'www.youtube.com'),
       ('route', 'app', 'app-1', 'www.youtube.com'),
       ('run', NULL, NULL, 'example.com');
SELECT pg_temp.assert_eq('another host of the same request, and imports with no request, each count',
  (SELECT count(*)::text FROM rights_unconfirmed_imports), '5');

-- 2. Only the ways in the gate knows, a host, and bounded values.
SELECT pg_temp.expect_error('an unknown way in is refused',
  $q$INSERT INTO rights_unconfirmed_imports (lane, via, host) VALUES ('route', 'browser', 'example.com')$q$, '23514');
SELECT pg_temp.expect_error('a host is required',
  $q$INSERT INTO rights_unconfirmed_imports (lane, via, host) VALUES ('route', 'session', '')$q$, '23514');
SELECT pg_temp.expect_error('a request id longer than 200 characters is refused',
  $q$INSERT INTO rights_unconfirmed_imports (lane, request_id, host) VALUES ('run', repeat('x', 201), 'example.com')$q$, '23514');
SELECT pg_temp.assert_eq('no account is kept',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rights_unconfirmed_imports' AND column_name = 'user_id'), '0');

-- 3. The share counts a confirmed import once (its consumed event), by kind, beside the unconfirmed ones.
INSERT INTO content_rights_confirmations (id, user_id, kind, declaration_version, declaration_hash, source_url, normalized_url, lane)
VALUES ('00000000-0000-4000-8000-000000000b81', '00000000-0000-4000-8000-000000000b71', 'checkbox', 1,
        (SELECT text_hash FROM rights_declarations WHERE version = 1), 'https://youtu.be/abc', 'https://youtu.be/abc', 'editor'),
       ('00000000-0000-4000-8000-000000000b82', '00000000-0000-4000-8000-000000000b71', 'derived', 1,
        (SELECT text_hash FROM rights_declarations WHERE version = 1), 'https://youtu.be/def', 'https://youtu.be/def', 'api'),
       ('00000000-0000-4000-8000-000000000b83', '00000000-0000-4000-8000-000000000b71', 'checkbox', 1,
        (SELECT text_hash FROM rights_declarations WHERE version = 1), 'https://youtu.be/ghi', 'https://youtu.be/ghi', 'editor');
-- A derived confirmation is consumed under its way in as the lane (content-rights.ts), as production writes it.
INSERT INTO rights_events (confirmation_id, kind, lane) VALUES
  ('00000000-0000-4000-8000-000000000b81', 'confirmed', 'editor'),
  ('00000000-0000-4000-8000-000000000b81', 'consumed', 'route'),
  ('00000000-0000-4000-8000-000000000b82', 'confirmed', 'api'),
  ('00000000-0000-4000-8000-000000000b82', 'consumed', 'api');
-- Consumed before counting began: never set against the count.
INSERT INTO rights_events (confirmation_id, kind, lane, created_at) VALUES
  ('00000000-0000-4000-8000-000000000b83', 'confirmed', 'editor', now() - interval '20 days'),
  ('00000000-0000-4000-8000-000000000b83', 'consumed', 'route', now() - interval '20 days');
SELECT pg_temp.assert_eq('the share: unconfirmed by lane, way in and app, the most first; confirmed by kind only; nothing before counting began',
  pg_temp.share_rows(now() - interval '30 days'),
  'none/route/app/app-1=2,none/route/session/-=2,checkbox/-/-/-=1,derived/-/-/-=1,none/run/-/-=1');
SELECT pg_temp.assert_eq('the window answered starts when counting began, not before',
  (SELECT ((public.content_rights_import_share(now() - interval '30 days')->>'since')::timestamptz
           = (SELECT started_at FROM rights_import_share_start))::text), 'true');
SELECT pg_temp.assert_eq('counting_since is when counting began',
  (SELECT ((public.content_rights_import_share(now() - interval '1 day')->>'counting_since')::timestamptz
           = (SELECT started_at FROM rights_import_share_start))::text), 'true');
SELECT pg_temp.assert_eq('a later window starts where it was asked to',
  (SELECT ((public.content_rights_import_share(now() + interval '1 day')->>'since')::timestamptz > now())::text), 'true');
SELECT pg_temp.assert_eq('nothing before the window: an empty list, never null',
  (public.content_rights_import_share(now() + interval '1 day')->'rows')::text, '[]');

-- 4. Re-applying the migration keeps when counting began.
INSERT INTO public.rights_import_share_start (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.assert_eq('a second write of the start keeps the first',
  (SELECT (started_at < now() - interval '6 days')::text FROM rights_import_share_start), 'true');
SELECT pg_temp.expect_error('there is only one start row',
  $q$INSERT INTO rights_import_share_start (id) VALUES (false)$q$, '23514');

-- 5. Nobody but the server reads the tables or the share.
SELECT pg_temp.assert_eq('the count is revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('rights_unconfirmed_imports', 'rights_import_share_start') AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('rls on the count', (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'rights_unconfirmed_imports'), 'true');
SELECT pg_temp.assert_eq('rls on the start', (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'rights_import_share_start'), 'true');
SELECT pg_temp.assert_eq('the share is closed to anon',
  has_function_privilege('anon', 'public.content_rights_import_share(timestamptz)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('the share is closed to authenticated',
  has_function_privilege('authenticated', 'public.content_rights_import_share(timestamptz)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('the share is open to the server',
  has_function_privilege('service_role', 'public.content_rights_import_share(timestamptz)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('the share runs with its caller''s rights',
  (SELECT prosecdef::text FROM pg_proc WHERE oid = 'public.content_rights_import_share(timestamptz)'::regprocedure), 'false');
-- With its caller's rights, the server's role must be able to read every table it reads.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('the server reads the share',
  pg_temp.share_rows(now() - interval '30 days'),
  'none/route/app/app-1=2,none/route/session/-=2,checkbox/-/-/-=1,derived/-/-/-=1,none/run/-/-=1');
RESET ROLE;
SELECT pg_temp.assert_eq('the share reads the spent confirmations by an index on when',
  (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rights_events_consumed_created_idx'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
