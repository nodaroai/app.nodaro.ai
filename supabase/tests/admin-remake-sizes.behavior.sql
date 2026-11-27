-- ============================================================================
-- Behavioral proof: the engine's size and the size delivered of a Video
-- Remake run (migration 731), as the admin Motion price check and the admin
-- Remake faults read them.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000721001 upward) and its own day
-- (2020-07-01).
--
-- WHAT IT PROVES.
--   1. `public.admin_remake_engine_resolution` and
--      `public.admin_remake_delivered_resolution` over each generation of run
--      rows: before the step existed, the earlier `upscale: "next"` step
--      (stepped up, not stepped up, failed), and the size delivered asked for
--      (4K delivered, the output's size over the one asked, in flight, the
--      hidden key missing or only on the output); the engine's size is the
--      first string and must be an engine size; the size delivered is the
--      first valid one, read from the output only once the run completed.
--   2. `public.admin_motion_runs` answers both per run.
--   3. `public.admin_motion_run_list`: each listed run carries both; the
--      resolution filter and the totals' resolution rows go by the engine's
--      size (a run with no engine size is a row with no value).
--   4. `public.admin_remake_fault_list` answers both per row.
--   5. The two helpers are not callable from a browser (anon / authenticated).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/admin-remake-sizes.behavior.sql
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
  ('00000000-0000-4000-8000-000000721001', 'sizes-owner@sizes.test', '{}', 'authenticated', 'authenticated');

-- The runs: n, status, input, output, and the sizes expected ('-' for none).
CREATE TEMP TABLE size_cases (n int PRIMARY KEY, label text, status text, input jsonb, output jsonb,
                              engine text, delivered text) ON COMMIT DROP;
INSERT INTO size_cases VALUES
  -- 1. Before the step existed: the input's size is both.
  (101, 'before the step, completed', 'completed', '{"resolution":"720p"}', '{"videoUrl":"v"}', '720p', '720p'),
  (102, 'before the step, failed', 'failed', '{"resolution":"480p"}', '{"error":"x"}', '480p', '480p'),
  -- 2. The earlier step (upscale "next").
  (103, 'earlier step, stepped up', 'completed', '{"resolution":"720p","upscale":"next"}',
        '{"resolution":"720p","outputResolution":"1080p"}', '720p', '1080p'),
  (104, 'earlier step, 1080p stepped up to 4K', 'completed', '{"resolution":"1080p","upscale":"next"}',
        '{"resolution":"1080p","outputResolution":"4k"}', '1080p', '4k'),
  (105, 'earlier step, not stepped up', 'completed', '{"resolution":"1080p","upscale":"next"}',
        '{"resolution":"1080p"}', '1080p', '1080p'),
  (106, 'earlier step, failed: what it asked to receive is not known', 'failed', '{"resolution":"720p","upscale":"next"}',
        '{"resolution":"720p","__castSwapFaults":[{"kind":"blur_left","severity":"blocked"}]}', '720p', '-'),
  (107, 'earlier step asked off, failed: the size asked', 'failed', '{"resolution":"720p","upscale":"off"}',
        '{"error":"x"}', '720p', '720p'),
  -- 3. The size delivered asked for.
  (108, 'delivered asked, 4K', 'completed', '{"resolution":"4k","__castSwapEngineResolution":"1080p"}',
        '{"resolution":"4k","__castSwapEngineResolution":"1080p","__castSwapFaults":[{"kind":"face_check_unsure","severity":"warning"}]}',
        '1080p', '4k'),
  (109, 'delivered asked, the output''s size over the one asked', 'completed', '{"resolution":"4k","__castSwapEngineResolution":"1080p"}',
        '{"resolution":"1080p","__castSwapEngineResolution":"1080p"}', '1080p', '1080p'),
  (110, 'delivered asked, in flight: the size asked', 'processing', '{"resolution":"4k","__castSwapEngineResolution":"1080p"}',
        NULL, '1080p', '4k'),
  (111, 'delivered asked, failed with an output size: the output is not read', 'failed',
        '{"resolution":"1080p","__castSwapEngineResolution":"720p"}', '{"resolution":"4k"}', '720p', '1080p'),
  (112, 'delivered asked, no hidden key, 4K: no engine size', 'completed', '{"resolution":"4k"}', '{"resolution":"4k"}', '-', '4k'),
  (113, 'delivered asked, the hidden key on the output only', 'completed', '{"resolution":"1080p"}',
        '{"resolution":"1080p","__castSwapEngineResolution":"720p"}', '720p', '1080p'),
  -- The readings themselves.
  (114, 'engine: the first string counts, an invalid one is none', 'completed',
        '{"resolution":"720p","__castSwapEngineResolution":"4k"}', '{"resolution":"720p"}', '-', '720p'),
  (115, 'engine: a hidden key that is no string is passed over', 'completed',
        '{"resolution":"720p","__castSwapEngineResolution":5}', '{"resolution":"720p"}', '720p', '720p'),
  (116, 'delivered: the first valid size', 'completed', '{"resolution":"480p"}',
        '{"outputResolution":"8k","resolution":"720p"}', '480p', '720p'),
  (117, 'neither: nothing recorded', 'queued', '{}', NULL, '-', '-');

INSERT INTO public.jobs (id, user_id, job_type, input_data, output_data, status, created_at)
SELECT ('00000000-0000-4000-8000-000000721' || lpad(c.n::text, 3, '0'))::uuid,
       '00000000-0000-4000-8000-000000721001', 'cast-swap',
       c.input || '{"type":"cast-swap"}'::jsonb, c.output, c.status,
       '2020-07-01T00:00:00Z'::timestamptz + make_interval(mins => c.n)
  FROM size_cases c;

-- 1. The two readings.
SELECT pg_temp.assert_eq('engine size: ' || c.label,
  coalesce(public.admin_remake_engine_resolution(c.input, c.output), '-'), c.engine)
  FROM size_cases c ORDER BY c.n;
SELECT pg_temp.assert_eq('size delivered: ' || c.label,
  coalesce(public.admin_remake_delivered_resolution(c.input, c.output, c.status), '-'), c.delivered)
  FROM size_cases c ORDER BY c.n;
SELECT pg_temp.assert_eq('no input or output at all', coalesce(public.admin_remake_engine_resolution(NULL, NULL), '-')
  || ' ' || coalesce(public.admin_remake_delivered_resolution(NULL, NULL, NULL), '-'), '- -');

-- 2. Per run, asked for by id.
SELECT pg_temp.assert_eq('admin_motion_runs: ' || c.label,
  (SELECT coalesce(r.resolution, '-') || ' ' || coalesce(r.delivered_resolution, '-')
     FROM public.admin_motion_runs(NULL, NULL, ('00000000-0000-4000-8000-000000721' || lpad(c.n::text, 3, '0'))::uuid, 0.002) r),
  c.engine || ' ' || c.delivered)
  FROM size_cases c ORDER BY c.n;

-- 3. The list: its rows, the filter and the totals by the engine's size.
CREATE FUNCTION pg_temp.list(p_resolution text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_motion_run_list('2020-07-01T00:00:00Z', '2020-07-02T00:00:00Z', 0.002, '{}', '{}',
    NULL, NULL, NULL, p_resolution, false, 'created_at', 'asc', 0, 200)
$$;
CREATE FUNCTION pg_temp.ns(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(r->>'id', 3), ',' ORDER BY right(r->>'id', 3)), '') FROM jsonb_array_elements(p->'runs') r
$$;

SELECT pg_temp.assert_eq('list: every run of the day', pg_temp.list()->>'total', (SELECT count(*) FROM size_cases)::text);
SELECT pg_temp.assert_eq('list: each row''s two sizes',
  (SELECT count(*) FROM jsonb_array_elements(pg_temp.list()->'runs') r
     JOIN size_cases c ON right(r->>'id', 3)::int = c.n
    WHERE coalesce(r->>'resolution', '-') IS DISTINCT FROM c.engine
       OR coalesce(r->>'delivered_resolution', '-') IS DISTINCT FROM c.delivered)::text, '0');
SELECT pg_temp.assert_eq('list: every row has the delivered key',
  (SELECT bool_and(r ? 'delivered_resolution') FROM jsonb_array_elements(pg_temp.list()->'runs') r)::text, 'true');
SELECT pg_temp.assert_eq('filter 1080p: by the engine''s size (a 4K delivery made at 1080p among them)',
  pg_temp.ns(pg_temp.list('1080p')), '104,105,108,109,110');
SELECT pg_temp.assert_eq('filter 720p: by the engine''s size (a 1080p delivery made at 720p among them)',
  pg_temp.ns(pg_temp.list('720p')), '101,103,106,107,111,113,115');
SELECT pg_temp.assert_eq('filter 4k: no run (4K is never an engine size)', pg_temp.ns(pg_temp.list('4k')), '');
SELECT pg_temp.assert_eq('totals: the resolution rows, by the engine''s size',
  (SELECT string_agg(coalesce(t->>'value', '-') || '=' || (t->>'runs'), ',' ORDER BY coalesce(t->>'value', '-'))
     FROM jsonb_array_elements(pg_temp.list()->'totals') t WHERE t->>'dimension' = 'resolution'),
  '-=3,1080p=5,480p=2,720p=7');

-- 4. The faults list.
SELECT pg_temp.assert_eq('faults: each row''s two sizes',
  (SELECT string_agg(right(r->>'id', 3) || ':' || coalesce(r->>'resolution', '-') || '/' || coalesce(r->>'delivered_resolution', '-'),
                     ',' ORDER BY right(r->>'id', 3))
     FROM jsonb_array_elements(public.admin_remake_fault_list('2020-07-01T00:00:00Z', '2020-07-02T00:00:00Z',
                                                              NULL, NULL, NULL, 0, 50)->'rows') r),
  '106:720p/-,108:1080p/4k');

-- 5. Never a browser's.
SELECT pg_temp.assert_eq(f || ' closed to ' || r, has_function_privilege(r, f, 'EXECUTE')::text, 'false')
  FROM unnest(ARRAY['public.admin_remake_engine_resolution(jsonb,jsonb)',
                    'public.admin_remake_delivered_resolution(jsonb,jsonb,text)']) AS f,
       unnest(ARRAY['anon', 'authenticated']) AS r;
SELECT pg_temp.assert_eq(f || ' open to service_role', has_function_privilege('service_role', f, 'EXECUTE')::text, 'true')
  FROM unnest(ARRAY['public.admin_remake_engine_resolution(jsonb,jsonb)',
                    'public.admin_remake_delivered_resolution(jsonb,jsonb,text)',
                    'public.admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])']) AS f;
SELECT pg_temp.assert_eq('admin_motion_runs closed to ' || r,
  has_function_privilege(r, 'public.admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])', 'EXECUTE')::text, 'false')
  FROM unnest(ARRAY['anon', 'authenticated']) AS r;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
