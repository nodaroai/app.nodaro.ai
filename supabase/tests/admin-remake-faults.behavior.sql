-- ============================================================================
-- Behavioral proof: the admin Remake faults list (migration 694) — every
-- Video Remake run of a range that recorded a fault, filtered and paged.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000694001 upward) and its own range
-- of days (2020-05-01).
--
-- WHAT IT PROVES.
--   1. Only faulted Video Remake runs are listed: a run, a Full Quality try,
--      a queued run (cast-swap, no resolution); never a run with no job_type
--      yet (a queued run has recorded nothing); never a run
--      with no faults key, an empty list, a non-list value or only malformed
--      entries; never a step below a run; never another job type; never a
--      run outside the range.
--   2. One reading of an entry: a non-object or kind-less entry is skipped,
--      an unknown severity reads 'warning', faults come worst first then by
--      `at`; `detail` is kept only as an object, `at` only as a string.
--   3. The filters (severity, kind, engine), `total` before paging, the page
--      newest first, and `kinds` (the range's, before the severity and kind
--      filters, the engine filter applied).
--   4. The arguments it refuses (SQLSTATE 22023).
--   5. It has no index of its own (it reads idx_jobs_job_type).
--   6. It is not callable from a browser (anon / authenticated).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/admin-remake-faults.behavior.sql
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

CREATE FUNCTION pg_temp.assert_json(label text, actual jsonb, expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS NULL OR expected IS NULL OR actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual::text, '<none>'), coalesce(expected::text, '<none>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- The call refused with SQLSTATE 22023.
CREATE FUNCTION pg_temp.assert_refused(label text, p_from timestamptz, p_to timestamptz, p_severity text, p_kind text,
                                       p_engine text, p_offset int, p_limit int) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.admin_remake_fault_list(p_from, p_to, p_severity, p_kind, p_engine, p_offset, p_limit);
  RAISE EXCEPTION 'ASSERT FAIL [%]: not refused', label;
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000694001', 'rf-owner@rf.test', '{}', 'authenticated', 'authenticated');

CREATE FUNCTION pg_temp.job(p_n int, p_at text, p_type text, p_input jsonb, p_output jsonb,
                            p_status text DEFAULT 'failed', p_parent int DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.jobs (id, user_id, parent_job_id, job_type, input_data, output_data, status, created_at)
  VALUES (('00000000-0000-4000-8000-000000694' || lpad(p_n::text, 3, '0'))::uuid,
          '00000000-0000-4000-8000-000000694001',
          CASE WHEN p_parent IS NOT NULL THEN ('00000000-0000-4000-8000-000000694' || lpad(p_parent::text, 3, '0'))::uuid END,
          p_type, p_input, p_output, p_status, ('2020-05-01T' || p_at || 'Z')::timestamptz)
$$;

-- 101: a Prism run, blocked + recovered + an unknown severity + malformed entries.
SELECT pg_temp.job(101, '01:00:00', 'cast-swap', '{"type":"cast-swap","engine":"nodaro-prism","resolution":"720p","draft":true}',
  '{"error":"refused","__castSwapFaults":[
     {"kind":"face_check_unsure","severity":"warning","at":"2020-05-01T01:00:02Z"},
     "not-an-object", 7, null, {"severity":"blocked"}, {"kind":"  ","severity":"blocked"}, {"kind":5,"severity":"blocked"},
     {"kind":"intent_override","severity":"recovered","at":"2020-05-01T01:00:01Z","detail":{"code":"no_person"}},
     {"kind":"unblurred_refused","severity":"blocked","at":"2020-05-01T01:00:03Z","detail":"not-an-object"},
     {"kind":"brand_new","severity":"catastrophic","at":42}
   ]}');
-- 102: a Pulse Full Quality try, one warning.
SELECT pg_temp.job(102, '02:00:00', 'cast-swap-full-quality', '{"type":"cast-swap","engine":"nodaro-pulse","resolution":"1080p","fullQualityOf":"00000000-0000-4000-8000-000000694101"}',
  '{"__castSwapFaults":[{"kind":"blur_left","severity":"warning","at":"2020-05-01T02:00:01Z"}]}', 'completed');
-- 103: queued, one recovered.
SELECT pg_temp.job(103, '03:00:00', 'cast-swap', '{"type":"cast-swap"}',
  '{"__castSwapFaults":[{"kind":"face_check_error","severity":"recovered"}]}', 'queued');
-- Not listed: no key, an empty list, a non-list value, only malformed entries,
-- a step below a run, another job type, a run outside the range.
SELECT pg_temp.job(104, '04:00:00', 'cast-swap', '{"type":"cast-swap"}', '{"videoUrl":"v"}', 'completed');
SELECT pg_temp.job(105, '05:00:00', 'cast-swap', '{"type":"cast-swap"}', '{"__castSwapFaults":[]}');
SELECT pg_temp.job(106, '06:00:00', 'cast-swap', '{"type":"cast-swap"}', '{"__castSwapFaults":{"kind":"x"}}');
SELECT pg_temp.job(107, '07:00:00', 'cast-swap', '{"type":"cast-swap"}', '{"__castSwapFaults":[1,"a",{}]}');
SELECT pg_temp.job(108, '01:30:00', 'cast-swap', '{"type":"cast-swap"}', '{"__castSwapFaults":[{"kind":"blur_left","severity":"blocked"}]}', 'failed', 101);
SELECT pg_temp.job(111, '09:00:00', NULL, '{"type":"cast-swap"}', '{"__castSwapFaults":[{"kind":"blur_left","severity":"blocked"}]}', 'queued');
SELECT pg_temp.job(109, '08:00:00', 'generate-video', '{"type":"generate-video"}', '{"__castSwapFaults":[{"kind":"blur_left","severity":"blocked"}]}');
INSERT INTO public.jobs (id, user_id, job_type, input_data, output_data, status, created_at)
VALUES ('00000000-0000-4000-8000-000000694110', '00000000-0000-4000-8000-000000694001', 'cast-swap', '{"type":"cast-swap"}',
        '{"__castSwapFaults":[{"kind":"out_of_range","severity":"blocked"}]}', 'failed', '2020-05-02T00:00:00Z');

CREATE FUNCTION pg_temp.list(p_severity text DEFAULT NULL, p_kind text DEFAULT NULL, p_engine text DEFAULT NULL,
                             p_offset int DEFAULT 0, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.admin_remake_fault_list('2020-05-01T00:00:00Z', '2020-05-02T00:00:00Z', p_severity, p_kind, p_engine, p_offset, p_limit)
$$;

CREATE FUNCTION pg_temp.ids(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(r->>'id', 3), ',' ORDER BY o), '') FROM jsonb_array_elements(p->'rows') WITH ORDINALITY AS x(r, o)
$$;

-- 1. Which runs, newest first, and the total.
SELECT pg_temp.assert_eq('unfiltered: the three faulted runs, newest first', pg_temp.ids(pg_temp.list()), '103,102,101');
SELECT pg_temp.assert_eq('unfiltered: total', (pg_temp.list()->>'total'), '3');
SELECT pg_temp.assert_json('kinds of the range, sorted (a step''s, another type''s and an out-of-range run''s never)', pg_temp.list()->'kinds',
  '["blur_left","brand_new","face_check_error","face_check_unsure","intent_override","unblurred_refused"]');

-- 2. One reading of an entry, worst first then by `at`.
SELECT pg_temp.assert_json('101: faults read and ordered', (SELECT r->'faults' FROM jsonb_array_elements(pg_temp.list()->'rows') r WHERE r->>'id' LIKE '%694101'),
  '[{"kind":"unblurred_refused","severity":"blocked","at":"2020-05-01T01:00:03Z"},
    {"kind":"intent_override","severity":"recovered","at":"2020-05-01T01:00:01Z","detail":{"code":"no_person"}},
    {"kind":"face_check_unsure","severity":"warning","at":"2020-05-01T01:00:02Z"},
    {"kind":"brand_new","severity":"warning"}]');
SELECT pg_temp.assert_json('101: the row', (SELECT r - 'faults' - 'created_at' FROM jsonb_array_elements(pg_temp.list()->'rows') r WHERE r->>'id' LIKE '%694101'),
  '{"id":"00000000-0000-4000-8000-000000694101","user_id":"00000000-0000-4000-8000-000000694001","email":"rf-owner@rf.test",
    "job_type":"cast-swap","status":"failed","full_quality":false,"engine":"prism","resolution":"720p","draft":true,"worst":"blocked"}');
SELECT pg_temp.assert_json('102: a Full Quality Pulse try', (SELECT jsonb_build_object('fq', r->'full_quality', 'engine', r->'engine', 'worst', r->'worst')
                                                               FROM jsonb_array_elements(pg_temp.list()->'rows') r WHERE r->>'id' LIKE '%694102'),
  '{"fq":true,"engine":"pulse","worst":"warning"}');
SELECT pg_temp.assert_json('103: queued, no resolution', (SELECT jsonb_build_object('type', r->'job_type', 'res', r->'resolution', 'worst', r->'worst')
                                                            FROM jsonb_array_elements(pg_temp.list()->'rows') r WHERE r->>'id' LIKE '%694103'),
  '{"type":"cast-swap","res":null,"worst":"recovered"}');

-- 3. Filters and paging.
SELECT pg_temp.assert_eq('severity blocked', pg_temp.ids(pg_temp.list('blocked')), '101');
SELECT pg_temp.assert_eq('severity recovered', pg_temp.ids(pg_temp.list('recovered')), '103,101');
SELECT pg_temp.assert_eq('severity warning (an unknown severity counts)', pg_temp.ids(pg_temp.list('warning')), '102,101');
SELECT pg_temp.assert_eq('kind brand_new (an unknown severity''s entry)', pg_temp.ids(pg_temp.list(NULL, 'brand_new')), '101');
SELECT pg_temp.assert_eq('kind blur_left (a step''s is not counted)', pg_temp.ids(pg_temp.list(NULL, 'blur_left')), '102');
SELECT pg_temp.assert_eq('kind none recorded', pg_temp.ids(pg_temp.list(NULL, 'nope')), '');
SELECT pg_temp.assert_eq('kind + severity together', pg_temp.ids(pg_temp.list('blocked', 'intent_override')), '101');
SELECT pg_temp.assert_eq('engine pulse', pg_temp.ids(pg_temp.list(NULL, NULL, 'pulse')), '102');
SELECT pg_temp.assert_eq('engine prism (a run naming none is prism)', pg_temp.ids(pg_temp.list(NULL, NULL, 'prism')), '103,101');
SELECT pg_temp.assert_json('kinds with the engine filter, before severity and kind', pg_temp.list('blocked', 'nope', 'pulse')->'kinds', '["blur_left"]');
SELECT pg_temp.assert_eq('page 2 of 1-a-page', pg_temp.ids(pg_temp.list(NULL, NULL, NULL, 1, 1)), '102');
SELECT pg_temp.assert_eq('page total is before paging', pg_temp.list(NULL, NULL, NULL, 1, 1)->>'total', '3');
SELECT pg_temp.assert_eq('past the end', pg_temp.ids(pg_temp.list(NULL, NULL, NULL, 50, 50)), '');

-- 4. Refused arguments.
SELECT pg_temp.assert_refused('no from', NULL, '2020-05-02', NULL, NULL, NULL, 0, 50);
SELECT pg_temp.assert_refused('from not before to', '2020-05-02', '2020-05-01', NULL, NULL, NULL, 0, 50);
SELECT pg_temp.assert_refused('more than 31 days', '2020-04-01', '2020-05-02 00:00:01', NULL, NULL, NULL, 0, 50);
SELECT pg_temp.assert_refused('unknown severity', '2020-05-01', '2020-05-02', 'fatal', NULL, NULL, 0, 50);
SELECT pg_temp.assert_refused('blank kind', '2020-05-01', '2020-05-02', NULL, '  ', NULL, 0, 50);
SELECT pg_temp.assert_refused('unknown engine', '2020-05-01', '2020-05-02', NULL, NULL, 'kling', 0, 50);
SELECT pg_temp.assert_refused('limit 0', '2020-05-01', '2020-05-02', NULL, NULL, NULL, 0, 0);
SELECT pg_temp.assert_refused('limit 201', '2020-05-01', '2020-05-02', NULL, NULL, NULL, 0, 201);
SELECT pg_temp.assert_refused('negative offset', '2020-05-01', '2020-05-02', NULL, NULL, NULL, -1, 50);

-- 5. No index of its own (the list reads idx_jobs_job_type).
SELECT pg_temp.assert_eq('no index on the faults key', (SELECT count(*) FROM pg_class WHERE relname = 'idx_jobs_cast_swap_faults')::text, '0');

-- 6. Never a browser's.
SELECT pg_temp.assert_eq('admin_remake_fault_list closed to ' || r, has_function_privilege(r, 'public.admin_remake_fault_list(timestamptz,timestamptz,text,text,text,integer,integer)', 'EXECUTE')::text, 'false')
  FROM unnest(ARRAY['anon', 'authenticated']) AS r;
SELECT pg_temp.assert_eq('admin_remake_fault_list open to service_role', has_function_privilege('service_role', 'public.admin_remake_fault_list(timestamptz,timestamptz,text,text,text,integer,integer)', 'EXECUTE')::text, 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
