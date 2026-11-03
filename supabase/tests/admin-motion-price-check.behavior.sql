-- ============================================================================
-- Behavioral proof: the admin Motion price check (migration 593) — every
-- Nodaro Motion run's hold, taken, taken in USD, paid in USD, the difference
-- and its flags, over a date range.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000593001 upward).
--
-- WHAT IT PROVES.
--   1. `public.admin_motion_runs`, asked for one run by id, answers every
--      expected run of every case of supabase/tests/fixtures/motion-price-run-cases.json:
--      hold, taken, settlement, taken in USD, recorded and KIE figures, paid,
--      the difference and its percent (to 4 dp), steps, steps with no recorded
--      cost, the recorded quote's total and allowance, the flags, and the
--      dimensions a case names. The backend's TypeScript twin
--      (backend/src/lib/__tests__/motion-price-run-cases.test.ts) holds the same
--      table's hold, taken and settlement to `runCreditsFor`, the one loader of
--      a run's figures: the SQL cannot drift from it. A job no case expects
--      (a trend's face-mask make) is not a run.
--   2. `public.admin_motion_engine` answers every case of
--      supabase/tests/fixtures/motion-engine-cases.json (the twin holds the same
--      table to `castSwapEngineFrom`).
--   3. `public.admin_motion_style`: a hand run is Flex when it picked it; a
--      trend run reads the prompt style its recipe ran, else its full-depth
--      clip while masking is on, never its own `style`.
--   4. `public.admin_motion_tree` over case G: the run at depth 0, a child and
--      a grandchild, a trashed step; no job past depth 5, none of another
--      owner; `route` and `step_key` from `input_data.type` and the idempotency
--      key; and, over other cases, each row's local / no-cost reading and its
--      KIE, ledger and side-hold figures: a side hold's ledger cost is paid
--      whether the hold was kept or given back, and a step whose own cost is
--      unknown has no recorded cost whatever its side holds recorded.
--   5. `public.admin_motion_run_list` over the cases' range: the count; each
--      sort in both directions (by a figure, every run still in flight after
--      every settled one; by date, by date alone; NULLs last, ties newest
--      first); a page; every filter (unfiltered, `p_flagged` is false, as the
--      admin route sends it); the totals per dimension (a group with no
--      settled run sums to null); and the arguments it refuses.
--   6. `public.admin_motion_task_ids` answers exactly the range's runs' tasks,
--      as one array.
--   7. None of the six is callable from a browser (anon / authenticated).
--
-- The case tables are read with psql's backquote expansion, relative to the
-- working directory: run it from the repo root, as CI does.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/admin-motion-price-check.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
\set run_cases `cat supabase/tests/fixtures/motion-price-run-cases.json`
\set engine_cases `cat supabase/tests/fixtures/motion-engine-cases.json`
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A JSON value against its expectation: numbers compare by value (1.25 is
-- 1.250000), everything else as JSON. SQL NULL (a key not produced) never
-- matches anything.
CREATE FUNCTION pg_temp.assert_json(label text, actual jsonb, expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS NULL OR expected IS NULL OR actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual::text, '<none>'), coalesce(expected::text, '<none>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000593001', 'mpc-owner@mpc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000593002', 'mpc-other@mpc.test', '{}', 'authenticated', 'authenticated');

-- The steps the price check counts as run on our own machines.
CREATE FUNCTION pg_temp.local_routes() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['mask-composite', 'mask-erase', 'mask-outline', 'video-face-mesh']
$$;

-- A usage log under a job's user (its own hold, or a side hold's).
CREATE FUNCTION pg_temp.log(p_user uuid, p_status text, p_used integer, p_charged integer) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.usage_logs (user_id, action, provider, credits_used, credits_charged, status)
  VALUES (p_user, 'mpc-test', 'test', p_used, p_charged, p_status)
  RETURNING id
$$;

-- A side hold of a job: a usage log with no job, linked through llm_side_holds,
-- with its ledger's cost when given.
CREATE FUNCTION pg_temp.side_hold(p_job uuid, p_status text, p_used integer, p_charged integer, p_ledger_usd numeric)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.llm_side_holds (usage_log_id, job_id, user_id, charge_id, hold_credits, ledger)
  SELECT pg_temp.log(j.user_id, p_status, p_used, p_charged), j.id, j.user_id, 'llm-chat:mpc-test', p_used,
         CASE WHEN p_ledger_usd IS NOT NULL THEN jsonb_build_object('costUsd', p_ledger_usd, 'calls', 1) END
    FROM public.jobs j WHERE j.id = p_job
$$;

-- One case job as a jobs row (and its own usage log), at its time.
CREATE FUNCTION pg_temp.insert_job(p_job jsonb, p_user uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_log uuid;
BEGIN
  IF jsonb_typeof(p_job->'log') = 'object' THEN
    v_log := pg_temp.log(p_user, p_job->'log'->>'status', (p_job->'log'->>'used')::integer, (p_job->'log'->>'charged')::integer);
  END IF;
  INSERT INTO public.jobs (id, user_id, parent_job_id, job_type, input_data, output_data, credits, status, usage_log_id,
                           provider_cost, llm_billing, provider_task_id, idempotency_key, deleted_at, created_at)
  VALUES ((p_job->>'id')::uuid, p_user, (p_job->>'parent')::uuid, p_job->>'jobType',
          coalesce(p_job->'input', '{}'::jsonb) || jsonb_build_object('type', p_job->'type'),
          p_job->'output', (p_job->>'credits')::integer, p_job->>'status', v_log,
          (p_job->>'providerCost')::numeric, p_job->'ledger', p_job->>'taskId', p_job->>'stepKey',
          CASE WHEN p_job->'trashed' = 'true'::jsonb THEN p_at + interval '1 day' END, p_at);
END $$;

-- ---------------------------------------------------------------------------
-- The run case table. Top-level jobs are created one hour apart, in case
-- order, from 2020-03-01T01:00Z; a step a few minutes after its run.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE case_jobs AS
  SELECT c.n AS case_n, c.c->>'label' AS label, j.k AS job_n, j.j AS job,
         j.j->>'key' AS key, (j.j->>'id')::uuid AS id, (j.j->>'parent')::uuid AS parent,
         CASE WHEN j.j->>'owner' = 'other' THEN '00000000-0000-4000-8000-000000593002'::uuid
              ELSE '00000000-0000-4000-8000-000000593001'::uuid END AS owner
    FROM jsonb_array_elements(:'run_cases'::jsonb) WITH ORDINALITY AS c(c, n)
   CROSS JOIN LATERAL jsonb_array_elements(c.c->'jobs') WITH ORDINALITY AS j(j, k);
SELECT pg_temp.assert_eq('the run case table was read',
  ((SELECT count(DISTINCT case_n) FROM case_jobs) >= 18)::text, 'true');

CREATE TEMP TABLE case_times AS
  SELECT cj.id,
         '2020-03-01T00:00:00Z'::timestamptz
           + make_interval(hours => (SELECT count(*) FROM case_jobs r
                                      WHERE r.parent IS NULL AND (r.case_n, r.job_n) <= (cj.case_n, cj.job_n))::integer)
           + CASE WHEN cj.parent IS NULL THEN interval '0' ELSE make_interval(mins => cj.job_n::integer) END AS at
    FROM case_jobs cj;

-- Every job under its owner, parents first. A job of another owner below a
-- run is a row only a write from before migration 480 could leave: the owner
-- check is off for that insert alone.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT cj.job, cj.owner, t.at FROM case_jobs cj JOIN case_times t ON t.id = cj.id
            WHERE cj.owner = '00000000-0000-4000-8000-000000593001' ORDER BY cj.case_n, cj.job_n LOOP
    PERFORM pg_temp.insert_job(r.job, r.owner, r.at);
  END LOOP;
END $$;
ALTER TABLE public.jobs DISABLE TRIGGER trg_jobs_pointer_owner;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT cj.job, cj.owner, t.at FROM case_jobs cj JOIN case_times t ON t.id = cj.id
            WHERE cj.owner <> '00000000-0000-4000-8000-000000593001' ORDER BY cj.case_n, cj.job_n LOOP
    PERFORM pg_temp.insert_job(r.job, r.owner, r.at);
  END LOOP;
END $$;
ALTER TABLE public.jobs ENABLE TRIGGER trg_jobs_pointer_owner;

CREATE TEMP TABLE case_sides AS
  SELECT cj.id AS job_id, s.s->>'status' AS status, (s.s->>'used')::integer AS used,
         (s.s->>'charged')::integer AS charged, (s.s->>'ledgerUsd')::numeric AS ledger_usd
    FROM jsonb_array_elements(:'run_cases'::jsonb) WITH ORDINALITY AS c(c, n)
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.c->'side', '[]'::jsonb)) AS s(s)
    JOIN case_jobs cj ON cj.case_n = c.n AND cj.key = s.s->>'job';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM case_sides LOOP
    PERFORM pg_temp.side_hold(r.job_id, r.status, r.used, r.charged, r.ledger_usd);
  END LOOP;
END $$;
SELECT pg_temp.assert_eq('every case job and side hold was written',
  ((SELECT count(*) FROM public.jobs WHERE id IN (SELECT id FROM case_jobs)) = (SELECT count(*) FROM case_jobs)
   AND (SELECT count(*) FROM case_sides) >= 1)::text, 'true');

-- Each expected run, with the KIE figures its case passes.
CREATE TEMP TABLE expectations AS
  SELECT c.n AS case_n, c.c->>'label' AS label, e.key AS run_key, e.value AS expected, cj.id AS run_id,
         coalesce(c.c->'kieUsd', '{}'::jsonb) AS kie,
         split_part(c.c->>'label', ':', 1) || CASE WHEN e.key = 'run' THEN '' ELSE '.' || e.key END AS name
    FROM jsonb_array_elements(:'run_cases'::jsonb) WITH ORDINALITY AS c(c, n)
   CROSS JOIN LATERAL jsonb_each(c.c->'expect') AS e(key, value)
    JOIN case_jobs cj ON cj.case_n = c.n AND cj.key = e.key;
SELECT pg_temp.assert_eq('twenty-two expected runs', (SELECT count(*) FROM expectations)::text, '22');
SELECT pg_temp.assert_eq('every expectation names every figure',
  (SELECT count(*) FROM expectations x,
          unnest(ARRAY['held', 'taken', 'settled', 'takenUsd', 'recordedUsd', 'kieUsd', 'paidUsd', 'marginUsd',
                       'marginPct', 'steps', 'stepsWithoutCost', 'quoteTotal', 'quoteAllowed', 'flags']) AS k
    WHERE NOT x.expected ? k)::text, '0');

-- Every case's KIE figures together, for the range-wide proofs.
CREATE TEMP TABLE kie_union AS
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) AS map
    FROM jsonb_array_elements(:'run_cases'::jsonb) AS c(c)
   CROSS JOIN LATERAL jsonb_each(coalesce(c.c->'kieUsd', '{}'::jsonb)) AS e(key, value);

-- A run row (or a list row: the same snake_case keys) as the case table
-- writes its expectations; the percent to 4 dp.
CREATE FUNCTION pg_temp.as_expected(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'held', r->'held', 'taken', r->'taken', 'settled', r->'settled', 'takenUsd', r->'taken_usd',
    'recordedUsd', r->'recorded_usd', 'kieUsd', r->'kie_usd', 'paidUsd', r->'paid_usd', 'marginUsd', r->'margin_usd',
    'marginPct', CASE WHEN jsonb_typeof(r->'margin_pct') = 'number'
                      THEN to_jsonb(round((r->>'margin_pct')::numeric, 4)) ELSE r->'margin_pct' END,
    'steps', r->'steps', 'stepsWithoutCost', r->'steps_without_cost',
    'quoteTotal', r->'quote_total', 'quoteAllowed', r->'quote_allowed',
    'flags', to_jsonb(array_remove(ARRAY[
               CASE WHEN (r->>'flag_paid_above_taken')::boolean THEN 'paid_above_taken' END,
               CASE WHEN (r->>'flag_missing_cost')::boolean THEN 'missing_cost' END,
               CASE WHEN (r->>'flag_above_quote')::boolean THEN 'above_quote' END], NULL)),
    'fullQuality', r->'full_quality', 'draftJobId', r->'draft_job_id', 'kind', r->'kind', 'trendName', r->'trend_name',
    'engine', r->'engine', 'style', r->'style', 'resolution', r->'resolution', 'draft', r->'draft',
    'lengthSec', r->'length_sec')
$$;

-- ---------------------------------------------------------------------------
-- 1. Every expected run, asked for by id (the range ignored).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE actuals AS
  SELECT x.*,
         (SELECT jsonb_agg(to_jsonb(r))
            FROM public.admin_motion_runs(NULL, NULL, x.run_id, 0.002, x.kie, pg_temp.local_routes()) r) AS rows
    FROM expectations x;

SELECT pg_temp.assert_eq('admin_motion_runs: ' || name || ' is one run',
  coalesce(jsonb_array_length(rows), 0)::text, '1')
  FROM actuals ORDER BY case_n, run_key;
SELECT pg_temp.assert_json('admin_motion_runs: ' || label || ' / ' || run_key || ' / ' || k,
  pg_temp.as_expected(rows->0)->k, expected->k)
  FROM actuals, jsonb_object_keys(expected) AS k
 ORDER BY case_n, run_key, k;
SELECT pg_temp.assert_eq('admin_motion_runs: ' || name || ' is flagged exactly when it has a flag',
  rows->0->>'flagged', (jsonb_array_length(expected->'flags') > 0)::text)
  FROM actuals ORDER BY case_n, run_key;

SELECT pg_temp.assert_eq('not a run: ' || cj.label,
  (SELECT count(*) FROM public.admin_motion_runs(NULL, NULL, cj.id, 0.002))::text, '0')
  FROM case_jobs cj
 WHERE cj.parent IS NULL AND NOT EXISTS (SELECT 1 FROM expectations x WHERE x.run_id = cj.id);
SELECT pg_temp.assert_eq('the case table has a top-level job that is not a run',
  (SELECT count(*) FROM case_jobs cj
    WHERE cj.parent IS NULL AND NOT EXISTS (SELECT 1 FROM expectations x WHERE x.run_id = cj.id))::text, '1');
SELECT pg_temp.assert_eq('a step is never a run',
  (SELECT count(*) FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593105', 0.002))::text, '0');

SELECT pg_temp.assert_eq('a run asked for by id, with a range that holds every run, is that run alone',
  (SELECT count(*) || ' ' || min(r.id::text)
     FROM public.admin_motion_runs('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z', '00000000-0000-4000-8000-000000593101', 0.002) r),
  '1 00000000-0000-4000-8000-000000593101');
SELECT pg_temp.assert_eq('a run asked for by id ignores the range',
  (SELECT count(*) FROM public.admin_motion_runs('2030-01-01', '2030-01-02', '00000000-0000-4000-8000-000000593101', 0.002))::text, '1');
SELECT pg_temp.assert_eq('a run carries its owner and the owner''s email',
  (SELECT r.user_id || ' ' || r.email || ' ' || r.status
     FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593101', 0.002) r),
  '00000000-0000-4000-8000-000000593001 mpc-owner@mpc.test completed');
SELECT pg_temp.assert_json('the recorded quote is passed on as stored',
  (SELECT r.quote FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593211', 0.002) r),
  '{"v": 1, "totalCredits": 100, "expectedCredits": 90, "breakdown": {"base": 40, "motion": 60}}');
SELECT pg_temp.assert_json('the extras that ran are passed on as stored',
  (SELECT r.extras FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593221', 0.002) r),
  '{"v": 1, "ran": ["privacyCredits"]}');
SELECT pg_temp.assert_json('a reusing Full Quality try passes on its reuse record',
  (SELECT r.reuse FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593254', 0.002) r),
  '{"v": 1, "entries": [{"step": "render", "jobId": "00000000-0000-4000-8000-000000593253"}]}');
SELECT pg_temp.assert_eq('a run with no records reads none',
  (SELECT (r.quote IS NULL AND r.reuse IS NULL AND r.extras IS NULL)::text
     FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593101', 0.002) r), 'true');

-- A side hold still open adds nothing. A refunded one's ledger cost is what
-- the call cost us, so it is paid; nothing of it is taken. (Undone after, so
-- the range-wide proofs below see case H as the table writes it.)
SAVEPOINT side_holds;
DO $$ BEGIN
  PERFORM pg_temp.side_hold('00000000-0000-4000-8000-000000593182', 'reserved', 7, NULL, 0.5);
  PERFORM pg_temp.side_hold('00000000-0000-4000-8000-000000593182', 'refunded', 4, 0, 0.25);
END $$;
SELECT pg_temp.assert_json('an open side hold adds nothing; a refunded one adds its ledger cost to paid, never to taken',
  (SELECT jsonb_build_object('held', r.held, 'taken', r.taken, 'recorded', r.recorded_usd, 'paid', r.paid_usd, 'settled', r.settled)
     FROM public.admin_motion_runs(NULL, NULL, '00000000-0000-4000-8000-000000593181', 0.002) r),
  '{"held": 45, "taken": 45, "recorded": 0.255, "paid": 0.255, "settled": true}');
ROLLBACK TO SAVEPOINT side_holds;

-- ---------------------------------------------------------------------------
-- 2. The engine case table.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE engine_cases AS
  SELECT n, c->'engine' AS engine, c->>'expected' AS expected
    FROM jsonb_array_elements(:'engine_cases'::jsonb) WITH ORDINALITY AS t(c, n);
SELECT pg_temp.assert_eq('the engine case table was read', ((SELECT count(*) FROM engine_cases) >= 8)::text, 'true');
SELECT pg_temp.assert_eq('admin_motion_engine: ' || engine::text,
  public.admin_motion_engine(jsonb_build_object('engine', engine)), expected)
  FROM engine_cases ORDER BY n;
SELECT pg_temp.assert_eq('admin_motion_engine: an input with no engine is prism', public.admin_motion_engine('{}'), 'prism');
SELECT pg_temp.assert_eq('admin_motion_engine: no input at all is prism', public.admin_motion_engine(NULL), 'prism');
SELECT pg_temp.assert_eq('admin_motion_engine: an engine that is not a string is prism',
  public.admin_motion_engine('{"engine": ["kling-4"]}'), 'prism');

-- ---------------------------------------------------------------------------
-- 3. The style rule.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('style: a hand run that picked Flex is flex, beside a __promptStyle of precise',
  public.admin_motion_style('{"style": "motion", "__promptStyle": "precise"}'), 'flex');
SELECT pg_temp.assert_eq('style: a hand run that picked nothing is precise',
  public.admin_motion_style('{}'), 'precise');
SELECT pg_temp.assert_eq('style: a trend run whose recipe ran flexible is flex',
  public.admin_motion_style('{"trend": {"id": "t", "name": "Neon"}, "__promptStyle": "flexible"}'), 'flex');
SELECT pg_temp.assert_eq('style: a trend run with only a full-depth clip is flex',
  public.admin_motion_style('{"__videoUrl": "https://cdn.test/x.mp4", "__faceMasking": {"source": "full-depth"}}'), 'flex');
SELECT pg_temp.assert_eq('style: a full-depth trend run with masking off, and no prompt style, is precise',
  public.admin_motion_style('{"__videoUrl": "https://cdn.test/x.mp4", "__faceMasking": {"mode": "off", "source": "full-depth"}}'), 'precise');
SELECT pg_temp.assert_eq('style: a full-depth trend run with masking on, and no prompt style, is flex',
  public.admin_motion_style('{"__videoUrl": "https://cdn.test/x.mp4", "__faceMasking": {"mode": "always", "source": "full-depth"}}'), 'flex');
SELECT pg_temp.assert_eq('style: a full-depth trend run whose recipe ran precise is precise',
  public.admin_motion_style('{"__videoUrl": "https://cdn.test/x.mp4", "__faceMasking": {"source": "full-depth"}, "__promptStyle": "precise"}'), 'precise');
SELECT pg_temp.assert_eq('style: a trend run never reads its own style',
  public.admin_motion_style('{"trend": {"id": "t"}, "style": "motion"}'), 'precise');
SELECT pg_temp.assert_eq('style: a trend run masking faces, with no prompt style, is precise',
  public.admin_motion_style('{"trend": {"id": "t"}, "__faceMasking": {"source": "faces"}}'), 'precise');
SELECT pg_temp.assert_eq('style: a __videoUrl that is not a string does not make a trend run',
  public.admin_motion_style('{"__videoUrl": 7, "style": "motion"}'), 'flex');
SELECT pg_temp.assert_eq('style: a trend that is not an object does not make a trend run',
  public.admin_motion_style('{"trend": "neon", "style": "motion"}'), 'flex');
SELECT pg_temp.assert_eq('style: no input at all is precise', public.admin_motion_style(NULL), 'precise');

-- ---------------------------------------------------------------------------
-- 4. The tree.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE g_tree AS
  SELECT * FROM public.admin_motion_tree(ARRAY['00000000-0000-4000-8000-000000593161'::uuid], '{}'::jsonb, pg_temp.local_routes());
SELECT pg_temp.assert_eq('tree G: the run, a child and a grandchild, the trashed child, and the chain to depth 5',
  (SELECT string_agg(right(job_id::text, 3) || '@' || depth, ',' ORDER BY job_id) FROM g_tree),
  '161@0,162@1,163@2,164@1,166@1,167@2,168@3,169@4,170@5');
SELECT pg_temp.assert_eq('tree G: depths 0, 1 and 2 are there',
  (SELECT string_agg(DISTINCT depth::text, ',') FROM g_tree WHERE depth <= 2), '0,1,2');
SELECT pg_temp.assert_eq('tree G: no job past depth 5',
  (SELECT count(*) FROM g_tree WHERE job_id = '00000000-0000-4000-8000-000000593171' OR depth > 5)::text, '0');
SELECT pg_temp.assert_eq('tree G: no job of another owner',
  (SELECT count(*) FROM g_tree WHERE job_id = '00000000-0000-4000-8000-000000593165')::text, '0');
SELECT pg_temp.assert_eq('tree G: the trashed step is there',
  (SELECT count(*) FROM g_tree WHERE job_id = '00000000-0000-4000-8000-000000593164')::text, '1');
SELECT pg_temp.assert_eq('tree G: each job once, every row the run''s',
  (SELECT count(*) = count(DISTINCT job_id) AND bool_and(run_id = '00000000-0000-4000-8000-000000593161') FROM g_tree)::text, 'true');
SELECT pg_temp.assert_eq('tree G: route is input_data.type, step_key the idempotency key, model resolvedModel first',
  (SELECT route || ' ' || step_key || ' ' || model || ' ' || parent_job_id FROM g_tree
    WHERE job_id = '00000000-0000-4000-8000-000000593162'),
  'generate-image mpc-g:child gpt-image-2 00000000-0000-4000-8000-000000593161');
SELECT pg_temp.assert_eq('tree G: an empty input type falls back to job_type',
  (SELECT route || ' ' || step_key FROM g_tree WHERE job_id = '00000000-0000-4000-8000-000000593163'),
  'video-mask mpc-g:grandchild');
SELECT pg_temp.assert_eq('tree G: the run''s own row is local, paid 0, never without a cost',
  (SELECT concat_ws(' ', route, held, log_status, taken, is_local::text, paid_usd, no_cost::text) FROM g_tree WHERE depth = 0),
  'cast-swap 40 committed 40 true 0 false');

CREATE TEMP TABLE all_trees AS
  SELECT * FROM public.admin_motion_tree(ARRAY(SELECT run_id FROM expectations), (SELECT map FROM kie_union), pg_temp.local_routes());
CREATE FUNCTION pg_temp.tree_row(p_job uuid) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' ', coalesce(log_status, '-'), coalesce(taken::text, '-'), coalesce(recorded_usd::text, '-'),
                   coalesce(kie_usd::text, '-'), coalesce(paid_usd::text, '-'), is_local::text, no_cost::text)
    FROM all_trees WHERE job_id = p_job
$$;
SELECT pg_temp.assert_eq('tree: one row per job of every run, a step under its own run only',
  (SELECT count(*) = count(DISTINCT (run_id, job_id)) AND count(*) = count(DISTINCT job_id) FROM all_trees)::text, 'true');
SELECT pg_temp.assert_eq('tree I: a local step with no cost is paid 0',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593192'), 'committed 9 - - 0 true false');
SELECT pg_temp.assert_eq('tree I: a completed step with no cost has none, and says so',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593193'), 'committed 66 - - - false true');
SELECT pg_temp.assert_eq('tree I: a failed step with no cost is not flagged',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593194'), 'refunded 0 - - - false false');
SELECT pg_temp.assert_eq('tree B: KIE''s figure comes before the recorded one',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593112'), 'committed 66 0.100000 0.12 0.12 false false');
SELECT pg_temp.assert_eq('tree B: a task KIE has no figure for is paid what it recorded',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593113'), 'committed 66 0.100000 - 0.100000 false false');
SELECT pg_temp.assert_eq('tree H: the ledger, never provider_cost, plus the committed side hold',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593182'), 'committed 5 0.005 - 0.005 false false');
SELECT pg_temp.assert_eq('tree H2: a ledger that could not compute its cost records none',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593187'), 'committed 5 - - - false true');
SELECT pg_temp.assert_eq('tree H3: a refunded side hold''s ledger cost is recorded and paid; none of it is taken',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593184'), 'committed 5 0.006 - 0.006 false false');
SELECT pg_temp.assert_eq('tree H4: an unknown own cost is a step without one; its side hold''s cost is still paid',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593189'), 'committed 7 0.001 - 0.001 false true');
SELECT pg_temp.assert_eq('tree D: a step whose hold is open has taken nothing yet',
  pg_temp.tree_row('00000000-0000-4000-8000-000000593133'), 'reserved - - - - false false');
SELECT pg_temp.assert_eq('tree: no ids, no rows',
  (SELECT count(*) FROM public.admin_motion_tree(ARRAY[]::uuid[]))::text || '/' ||
  (SELECT count(*) FROM public.admin_motion_tree(NULL))::text, '0/0');

-- ---------------------------------------------------------------------------
-- 5. The list over the cases' range, with every case's KIE figures. Its
--    unfiltered call passes p_flagged false, exactly as the admin route does.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.list(
  p_engine text DEFAULT NULL, p_style text DEFAULT NULL, p_kind text DEFAULT NULL, p_resolution text DEFAULT NULL,
  p_flagged boolean DEFAULT false, p_sort text DEFAULT 'margin_usd', p_dir text DEFAULT 'asc',
  p_offset int DEFAULT 0, p_limit int DEFAULT 200, p_credit_usd numeric DEFAULT 0.002
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_motion_run_list(
    '2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z', p_credit_usd, (SELECT map FROM kie_union), pg_temp.local_routes(),
    p_engine, p_style, p_kind, p_resolution, p_flagged, p_sort, p_dir, p_offset, p_limit)
$$;
-- The page's runs by case name, in the order given.
CREATE FUNCTION pg_temp.names(p_list jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(x.name, '?'), ',' ORDER BY e.ord), '')
    FROM jsonb_array_elements(p_list->'runs') WITH ORDINALITY AS e(r, ord)
    LEFT JOIN expectations x ON x.run_id = (e.r->>'id')::uuid
$$;
-- The same, as a set.
CREATE FUNCTION pg_temp.name_set(p_list jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(x.name, '?'), ',' ORDER BY coalesce(x.name, '?')), '')
    FROM jsonb_array_elements(p_list->'runs') AS e(r)
    LEFT JOIN expectations x ON x.run_id = (e.r->>'id')::uuid
$$;
-- A totals row by dimension and value.
CREATE FUNCTION pg_temp.total(p_list jsonb, p_dimension text, p_value text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t FROM jsonb_array_elements(p_list->'totals') AS t
   WHERE t->>'dimension' = p_dimension AND t->>'value' IS NOT DISTINCT FROM p_value
$$;
-- The last p_n runs of a page by case name, as a set.
CREATE FUNCTION pg_temp.last_names(p_list jsonb, p_n int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.n, ',' ORDER BY t.n), '')
    FROM (SELECT coalesce(x.name, '?') AS n
            FROM jsonb_array_elements(p_list->'runs') WITH ORDINALITY AS e(r, ord)
            LEFT JOIN expectations x ON x.run_id = (e.r->>'id')::uuid
           ORDER BY e.ord DESC LIMIT p_n) AS t
$$;
-- Whether a statement is refused as an invalid argument.
CREATE FUNCTION pg_temp.refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN true;
END $$;

SELECT pg_temp.assert_eq('list: every run of the range, the face-mask make left out',
  (pg_temp.list()->>'total') || ' ' || jsonb_array_length(pg_temp.list()->'runs'), '22 22');
SELECT pg_temp.assert_eq('list: no row that is not a case run', (strpos(pg_temp.names(pg_temp.list()), '?') = 0)::text, 'true');
SELECT pg_temp.assert_eq('list: each row is its admin_motion_runs row without quote, reuse and extras',
  (SELECT count(*) FROM jsonb_array_elements(pg_temp.list()->'runs') AS e(r)
    WHERE e.r IS DISTINCT FROM (SELECT to_jsonb(x) - 'quote' - 'reuse' - 'extras'
                                  FROM public.admin_motion_runs('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z', NULL, 0.002,
                                                                (SELECT map FROM kie_union), pg_temp.local_routes()) x
                                 WHERE x.id = (e.r->>'id')::uuid))::text, '0');
SELECT pg_temp.assert_eq('list: a row has no quote, reuse or extras',
  (SELECT bool_or(e.r ? 'quote' OR e.r ? 'reuse' OR e.r ? 'extras') FROM jsonb_array_elements(pg_temp.list()->'runs') AS e(r))::text,
  'false');

-- Sorting by a figure (the difference in USD or in percent, paid, taken):
-- every settled run first, in both directions, then the runs still in flight
-- (C, D, D2, Q), whose figures are not final; NULLs last within each; ties
-- newest first.
SELECT pg_temp.assert_eq('sort ' || s || ' ' || d || ': the runs still in flight come last',
  pg_temp.last_names(pg_temp.list(p_sort => s, p_dir => d), 4), 'C,D,D2,Q')
  FROM unnest(ARRAY['margin_usd', 'margin_pct', 'paid_usd', 'taken']) AS s, unnest(ARRAY['asc', 'desc']) AS d;
SELECT pg_temp.assert_eq('sort margin_usd asc: J first',
  pg_temp.names(pg_temp.list(p_sort => 'margin_usd', p_dir => 'asc')),
  'J,L.fq1,F,E,L.fq2,L.draft,H3,H,H2,H4,G,K4,K3,K2,K,I,B,A,Q,D2,D,C');
SELECT pg_temp.assert_eq('sort margin_usd desc: J last of the settled runs',
  pg_temp.names(pg_temp.list(p_sort => 'margin_usd', p_dir => 'desc')),
  'A,B,I,K,K4,K3,K2,G,H4,H2,H,H3,L.fq2,L.draft,E,L.fq1,F,J,Q,D2,D,C');
SELECT pg_temp.assert_eq('sort margin_pct desc: a settled run with nothing taken in USD has no percent, last of the settled',
  pg_temp.names(pg_temp.list(p_sort => 'margin_pct', p_dir => 'desc')),
  'L.fq2,L.draft,I,H2,H4,H,H3,G,K,K4,K3,K2,A,E,B,L.fq1,J,F,Q,D2,D,C');
SELECT pg_temp.assert_eq('sort margin_pct asc',
  pg_temp.names(pg_temp.list(p_sort => 'margin_pct', p_dir => 'asc')),
  'J,L.fq1,B,E,A,K4,K3,K2,K,G,H3,H,H4,L.fq2,L.draft,I,H2,F,Q,D2,D,C');
SELECT pg_temp.assert_eq('sort paid_usd asc: the runs in flight after every settled one, cheapest first among them',
  pg_temp.names(pg_temp.list(p_sort => 'paid_usd', p_dir => 'asc')),
  'L.fq2,L.draft,I,H2,F,H4,H,H3,G,K4,K3,K2,K,E,L.fq1,A,B,J,Q,D2,D,C');
SELECT pg_temp.assert_eq('sort paid_usd desc: the runs in flight still after every settled one',
  pg_temp.names(pg_temp.list(p_sort => 'paid_usd', p_dir => 'desc')),
  'J,B,A,L.fq1,K4,K3,K2,K,E,G,H3,H,H4,L.fq2,L.draft,I,H2,F,D,C,Q,D2');
SELECT pg_temp.assert_eq('sort taken desc: a run in flight sorts last though it has taken 106 so far',
  pg_temp.names(pg_temp.list(p_sort => 'taken', p_dir => 'desc')),
  'B,A,L.fq1,K,K4,K3,K2,J,I,G,E,H4,H3,H2,H,L.fq2,L.draft,F,D2,D,Q,C');
SELECT pg_temp.assert_eq('sort taken asc',
  pg_temp.names(pg_temp.list(p_sort => 'taken', p_dir => 'asc')),
  'F,L.fq2,L.draft,H3,H2,H,H4,E,G,I,K4,K3,K2,J,K,L.fq1,B,A,D2,D,Q,C');
-- The date sort is by date alone: a run in flight stays where its date puts it.
SELECT pg_temp.assert_eq('sort created_at asc: by date alone',
  pg_temp.names(pg_temp.list(p_sort => 'created_at', p_dir => 'asc')),
  'A,B,C,D,D2,E,F,G,H,H2,H3,H4,I,J,K,K2,K3,K4,L.draft,L.fq1,L.fq2,Q');
SELECT pg_temp.assert_eq('sort created_at desc: by date alone, the queued Q first',
  pg_temp.names(pg_temp.list(p_sort => 'created_at', p_dir => 'desc')),
  'Q,L.fq2,L.fq1,L.draft,K4,K3,K2,K,J,I,H4,H3,H2,H,G,F,E,D2,D,C,B,A');
SELECT pg_temp.assert_eq('a page: limit 5 offset 5 is the 6th to 10th run, the total still every run',
  pg_temp.names(pg_temp.list(p_offset => 5, p_limit => 5)) || ' ' || (pg_temp.list(p_offset => 5, p_limit => 5)->>'total'),
  'L.draft,H3,H,H2,H4 22');
SELECT pg_temp.assert_eq('a page past the end is empty',
  (pg_temp.list(p_offset => 22, p_limit => 5)->'runs')::text || ' ' || (pg_temp.list(p_offset => 22, p_limit => 5)->>'total'),
  '[] 22');

-- Filters.
SELECT pg_temp.assert_eq('flagged only: K2 is not, its extra ran; D2 is not, it is still in flight',
  pg_temp.name_set(pg_temp.list(p_flagged => true)) || ' ' || (pg_temp.list(p_flagged => true)->>'total'),
  'H2,H4,I,J,K,K3,K4 7');
SELECT pg_temp.assert_eq('flagged false is no filter, as NULL is',
  (pg_temp.list(p_flagged => false)->>'total') || ' ' || (pg_temp.list(p_flagged => NULL)->>'total'), '22 22');
SELECT pg_temp.assert_eq('engine pulse', pg_temp.name_set(pg_temp.list(p_engine => 'pulse')), 'K');
SELECT pg_temp.assert_eq('engine prism', pg_temp.list(p_engine => 'prism')->>'total', '21');
SELECT pg_temp.assert_eq('style flex', pg_temp.name_set(pg_temp.list(p_style => 'flex')), 'B,L.draft,L.fq1,L.fq2');
SELECT pg_temp.assert_eq('kind trend', pg_temp.name_set(pg_temp.list(p_kind => 'trend')), 'B');
SELECT pg_temp.assert_eq('kind hand', pg_temp.list(p_kind => 'hand')->>'total', '21');
SELECT pg_temp.assert_eq('resolution 1080p', pg_temp.name_set(pg_temp.list(p_resolution => '1080p')), 'L.fq1,L.fq2');
SELECT pg_temp.assert_eq('filters together',
  pg_temp.name_set(pg_temp.list(p_style => 'flex', p_resolution => '480p')), 'L.draft');
SELECT pg_temp.assert_json('a filter that matches nothing: no runs, and still the one all row',
  pg_temp.list(p_engine => 'nothing'),
  '{"runs": [], "total": 0, "totals": [{"dimension": "all", "value": null, "runs": 0, "unsettled": 0, "held": null,
    "taken": null, "taken_usd": null, "paid_usd": null, "margin_usd": null, "margin_pct": null}]}');

-- Totals.
CREATE TEMP TABLE settled_sums AS
  SELECT count(*) AS runs, count(*) FILTER (WHERE NOT settled) AS unsettled,
         sum(held) FILTER (WHERE settled) AS held, sum(taken) FILTER (WHERE settled) AS taken,
         sum(taken_usd) FILTER (WHERE settled) AS taken_usd, sum(paid_usd) FILTER (WHERE settled) AS paid_usd
    FROM public.admin_motion_runs('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z', NULL, 0.002,
                                  (SELECT map FROM kie_union), pg_temp.local_routes());
SELECT pg_temp.assert_json('totals: all is the settled runs'' sums over admin_motion_runs',
  pg_temp.total(pg_temp.list(), 'all', NULL) - 'dimension' - 'value' - 'margin_usd' - 'margin_pct',
  (SELECT jsonb_build_object('runs', runs, 'unsettled', unsettled, 'held', held, 'taken', taken,
                             'taken_usd', taken_usd, 'paid_usd', paid_usd) FROM settled_sums));
SELECT pg_temp.assert_json('totals: all, by figure',
  pg_temp.total(pg_temp.list(), 'all', NULL) - 'dimension' - 'value' - 'margin_pct',
  '{"runs": 22, "unsettled": 4, "held": 9534, "taken": 3864, "taken_usd": 7.728, "paid_usd": 9.567, "margin_usd": -1.839}');
SELECT pg_temp.assert_eq('totals: all, the difference as a percent of taken in USD',
  round((pg_temp.total(pg_temp.list(), 'all', NULL)->>'margin_pct')::numeric, 4)::text, '-23.7966');
SELECT pg_temp.assert_eq('totals: one all row, with no value',
  (SELECT count(*) || ' ' || coalesce(min(t->>'value'), '<null>') FROM jsonb_array_elements(pg_temp.list()->'totals') AS t
    WHERE t->>'dimension' = 'all'), '1 <null>');
SELECT pg_temp.assert_eq('totals: each dimension''s runs add up to all',
  (SELECT string_agg(d || '=' || s, ',' ORDER BY d)
     FROM (SELECT t->>'dimension' AS d, sum((t->>'runs')::int) AS s
             FROM jsonb_array_elements(pg_temp.list()->'totals') AS t GROUP BY 1) AS x),
  'all=22,engine=22,resolution=22,style=22');
SELECT pg_temp.assert_eq('totals: the run with no resolution is a resolution row with no value',
  (SELECT count(*) || ' ' || min(t->>'runs') || ' ' || min(t->>'unsettled')
     FROM jsonb_array_elements(pg_temp.list()->'totals') AS t
    WHERE t->>'dimension' = 'resolution' AND jsonb_typeof(t->'value') = 'null'), '1 1 1');
SELECT pg_temp.assert_eq('totals: the rows, all first, then each dimension by value',
  (SELECT string_agg(t->>'dimension' || ':' || coalesce(t->>'value', '-') || '=' || (t->>'runs'), ',' ORDER BY ord)
     FROM jsonb_array_elements(pg_temp.list()->'totals') WITH ORDINALITY AS e(t, ord)),
  'all:-=22,engine:prism=21,engine:pulse=1,resolution:1080p=2,resolution:480p=1,resolution:720p=18,resolution:-=1,style:flex=4,style:precise=18');
SELECT pg_temp.assert_json('totals: a group with no settled run (Q''s resolution row) sums to null, never 0',
  pg_temp.total(pg_temp.list(), 'resolution', NULL) - 'dimension' - 'value',
  '{"runs": 1, "unsettled": 1, "held": null, "taken": null, "taken_usd": null, "paid_usd": null, "margin_usd": null, "margin_pct": null}');
SELECT pg_temp.assert_json('totals: a dimension row, the difference and its percent',
  pg_temp.total(pg_temp.list(), 'engine', 'pulse') - 'dimension' - 'value',
  '{"runs": 1, "unsettled": 0, "held": 160, "taken": 160, "taken_usd": 0.32, "paid_usd": 0.10, "margin_usd": 0.22, "margin_pct": 68.75}');
SELECT pg_temp.assert_eq('totals: over the filtered runs only',
  (SELECT string_agg(t->>'dimension' || ':' || coalesce(t->>'value', '-') || '=' || (t->>'runs'), ',' ORDER BY ord)
     FROM jsonb_array_elements(pg_temp.list(p_kind => 'trend')->'totals') WITH ORDINALITY AS e(t, ord)),
  'all:-=1,engine:prism=1,resolution:720p=1,style:flex=1');

-- Arguments outside the lists are refused.
SELECT pg_temp.assert_eq('refused: ' || q, pg_temp.refused('SELECT pg_temp.list(' || q || ')')::text, 'true')
  FROM unnest(ARRAY['p_sort => ''email''', 'p_sort => NULL', 'p_dir => ''up''', 'p_dir => NULL',
                    'p_limit => 0', 'p_limit => 201', 'p_limit => NULL', 'p_offset => -1', 'p_offset => NULL',
                    'p_credit_usd => 0', 'p_credit_usd => -0.002', 'p_credit_usd => NULL']) AS q;
SELECT pg_temp.assert_eq('accepted: every sort, both directions, a limit of 1 and of 200',
  (SELECT bool_and(NOT pg_temp.refused(format('SELECT pg_temp.list(p_sort => %L, p_dir => %L, p_limit => %s)', s, d, l)))
     FROM unnest(ARRAY['margin_usd', 'margin_pct', 'paid_usd', 'taken', 'created_at']) AS s,
          unnest(ARRAY['asc', 'desc']) AS d, unnest(ARRAY[1, 200]) AS l)::text, 'true');

-- The range: from inclusive, to exclusive (B is at 02:00, D at 04:00).
SELECT pg_temp.assert_eq('the range: from inclusive, to exclusive',
  (SELECT string_agg(x.name, ',' ORDER BY x.name)
     FROM public.admin_motion_runs('2020-03-01T02:00:00Z', '2020-03-01T04:00:00Z', NULL, 0.002) r
     JOIN expectations x ON x.run_id = r.id), 'B,C');

-- ---------------------------------------------------------------------------
-- 6. The range's task ids.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('task ids: one value, a text array (never rows, which a row cap could cut)',
  pg_typeof(public.admin_motion_task_ids('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z'))::text, 'text[]');
SELECT pg_temp.assert_eq('task ids: every task of the range''s runs, sorted, none past depth 5, of another owner or of a job that is no run',
  array_to_string(public.admin_motion_task_ids('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z'), ','),
  'kie-a1,kie-a2,kie-a3,kie-b1,kie-b2,kie-b3,kie-g-5,kie-r1');
SELECT pg_temp.assert_eq('task ids: one run''s hour',
  array_to_string(public.admin_motion_task_ids('2020-03-01T01:00:00Z', '2020-03-01T02:00:00Z'), ','),
  'kie-a1,kie-a2,kie-a3');
SELECT pg_temp.assert_eq('task ids: a range with no run is an empty array',
  public.admin_motion_task_ids('2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z')::text, '{}');
UPDATE public.jobs SET provider_task_id = 'kie-g-5' WHERE id = '00000000-0000-4000-8000-000000593169';
SELECT pg_temp.assert_eq('task ids: a task two steps share is listed once',
  (SELECT count(*) FROM unnest(public.admin_motion_task_ids('2020-03-01T00:00:00Z', '2020-03-08T00:00:00Z')) AS t(task_id)
    WHERE t.task_id = 'kie-g-5')::text, '1');

-- ---------------------------------------------------------------------------
-- Edges, each on a copy of a case run's records (the transaction rolls back).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.run(p_id uuid, p_kie jsonb DEFAULT '{}', p_local text[] DEFAULT pg_temp.local_routes()) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT to_jsonb(r) FROM public.admin_motion_runs(NULL, NULL, p_id, 0.002, p_kie, p_local) r
$$;

-- A trashed run still counts, with every figure it had.
UPDATE public.jobs SET deleted_at = '2020-03-09T00:00:00Z' WHERE id = '00000000-0000-4000-8000-000000593141';
SELECT pg_temp.assert_json('a trashed run counts as before: ' || k,
  pg_temp.as_expected(pg_temp.run(x.run_id))->k, x.expected->k)
  FROM expectations x, jsonb_object_keys(x.expected) AS k
 WHERE x.name = 'E' ORDER BY k;
SELECT pg_temp.assert_eq('a trashed run is listed', pg_temp.list()->>'total', '22');

-- A step that recorded no cost but has KIE's own figure is no step without a
-- cost (the 1080p finalize of a Full Quality try records no provider_cost).
UPDATE public.jobs SET provider_cost = NULL WHERE id = '00000000-0000-4000-8000-000000593253';
SELECT pg_temp.assert_eq('a step with only KIE''s figure has a cost: paid that figure, never flagged',
  (SELECT concat_ws(' ', r->>'steps_without_cost', r->>'paid_usd', coalesce(r->>'recorded_usd', '-'), r->>'kie_usd',
                    r->>'flag_missing_cost', r->>'flagged')
     FROM pg_temp.run('00000000-0000-4000-8000-000000593252', '{"kie-r1": 1.00}') AS r), '0 1.00 - 1.00 false false');
SELECT pg_temp.assert_eq('the same step without KIE''s figure has no cost, and its settled run is flagged',
  (SELECT concat_ws(' ', r->>'steps_without_cost', r->>'paid_usd', coalesce(r->>'kie_usd', '-'), r->>'flag_missing_cost', r->>'flagged')
     FROM pg_temp.run('00000000-0000-4000-8000-000000593252') AS r), '1 0 - true true');

-- No KIE map and no local routes passed: every row still reads.
SELECT pg_temp.assert_eq('no KIE map: the recorded figures are paid',
  (SELECT coalesce(r->>'kie_usd', '-') || ' ' || (r->>'paid_usd') FROM pg_temp.run('00000000-0000-4000-8000-000000593111', NULL, NULL) AS r),
  '- 1.250000');
SELECT pg_temp.assert_eq('no local routes: a composite with no cost is a step without one; the run''s own row is still paid 0',
  (SELECT (r->>'steps_without_cost') || ' ' || (r->>'paid_usd') FROM pg_temp.run('00000000-0000-4000-8000-000000593191', '{}', NULL) AS r),
  '2 0');
SELECT pg_temp.assert_eq('a KIE figure that is not a number is no figure',
  (SELECT coalesce(r->>'kie_usd', '-') || ' ' || (r->>'paid_usd')
     FROM pg_temp.run('00000000-0000-4000-8000-000000593111', '{"kie-b3": "1.50", "kie-b1": null}') AS r), '- 1.250000');

-- The recorded quote and extras, read only in the shape they are written.
UPDATE public.jobs SET input_data = jsonb_set(input_data, '{__castSwapQuote,v}', '2') WHERE id = '00000000-0000-4000-8000-000000593211';
SELECT pg_temp.assert_eq('a quote of another version has no total, allows nothing, flags nothing',
  (SELECT concat_ws(' ', coalesce(r->>'quote_total', '-'), coalesce(r->>'quote_allowed', '-'), r->>'flag_above_quote', ((r->'quote') IS NOT NULL)::text)
     FROM pg_temp.run('00000000-0000-4000-8000-000000593211') AS r), '- - false true');
UPDATE public.jobs SET input_data = jsonb_set(input_data, '{__castSwapQuote}', '"100"') WHERE id = '00000000-0000-4000-8000-000000593211';
SELECT pg_temp.assert_eq('a quote that is not an object is no quote',
  (SELECT (r->'quote')::text || ' ' || (r->'quote_total')::text FROM pg_temp.run('00000000-0000-4000-8000-000000593211') AS r), 'null null');
UPDATE public.jobs SET output_data = '{"__castSwapExtras": {"v": 2, "ran": ["privacyCredits"]}}' WHERE id = '00000000-0000-4000-8000-000000593221';
SELECT pg_temp.assert_eq('extras of another version are none: the extra did not run',
  (SELECT concat_ws(' ', (r->'extras')::text, r->>'quote_allowed', r->>'flag_above_quote')
     FROM pg_temp.run('00000000-0000-4000-8000-000000593221') AS r), 'null 100 true');
UPDATE public.jobs SET input_data = jsonb_set(input_data, '{__castSwapQuote,privacyCredits}', '"50"'),
                       output_data = '{"__castSwapExtras": {"v": 1, "ran": ["privacyCredits"]}}'
 WHERE id = '00000000-0000-4000-8000-000000593221';
SELECT pg_temp.assert_eq('an extra that ran with no number quoted for it adds nothing',
  (SELECT r->>'quote_allowed' FROM pg_temp.run('00000000-0000-4000-8000-000000593221') AS r), '100');

-- A Full Quality run's draft: the owner's job, named by a well-formed id.
UPDATE public.jobs SET input_data = jsonb_set(input_data, '{fullQualityOf}', '"not-a-job-id"') WHERE id = '00000000-0000-4000-8000-000000593254';
SELECT pg_temp.assert_eq('a draft named by no id: still Full Quality, no draft, nothing read from one',
  (SELECT concat_ws(' ', r->>'full_quality', coalesce(r->>'draft_job_id', '-'), r->>'style', coalesce(r->>'length_sec', '-'))
     FROM pg_temp.run('00000000-0000-4000-8000-000000593254') AS r), 'true - precise -');
UPDATE public.jobs SET input_data = jsonb_set(input_data, '{fullQualityOf}', '"00000000-0000-4000-8000-000000593165"') WHERE id = '00000000-0000-4000-8000-000000593254';
SELECT pg_temp.assert_eq('a draft of another owner is not the draft',
  (SELECT coalesce(r->>'draft_job_id', '-') FROM pg_temp.run('00000000-0000-4000-8000-000000593254') AS r), '-');
UPDATE public.jobs SET input_data = input_data - 'fullQualityOf' WHERE id = '00000000-0000-4000-8000-000000593254';
SELECT pg_temp.assert_eq('a Full Quality job type with no fullQualityOf is still Full Quality',
  (SELECT r->>'full_quality' FROM pg_temp.run('00000000-0000-4000-8000-000000593254') AS r), 'true');

-- A run none of whose rows has a usage log has no hold open and took nothing:
-- settled, with no figure taken, so no difference and nothing above it.
UPDATE public.jobs SET usage_log_id = NULL
 WHERE id IN ('00000000-0000-4000-8000-000000593201', '00000000-0000-4000-8000-000000593202');
SELECT pg_temp.assert_eq('no usage log anywhere: settled, nothing taken, no difference, no flag',
  (SELECT concat_ws(' ', r->>'settled', coalesce(r->>'taken', '-'), coalesce(r->>'margin_usd', '-'),
                    r->>'flag_paid_above_taken', r->>'flagged', r->>'held')
     FROM pg_temp.run('00000000-0000-4000-8000-000000593201') AS r), 'true - - false false 140');

-- ---------------------------------------------------------------------------
-- 7. Server only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq(f || ' closed to ' || r, has_function_privilege(r, f, 'EXECUTE')::text, 'false')
  FROM unnest(ARRAY['anon', 'authenticated']) AS r,
       unnest(ARRAY[
         'public.admin_motion_engine(jsonb)',
         'public.admin_motion_style(jsonb)',
         'public.admin_motion_tree(uuid[],jsonb,text[])',
         'public.admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])',
         'public.admin_motion_run_list(timestamptz,timestamptz,numeric,jsonb,text[],text,text,text,text,boolean,text,text,integer,integer)',
         'public.admin_motion_task_ids(timestamptz,timestamptz)'
       ]) AS f;
SELECT pg_temp.assert_eq(f || ' open to service_role', has_function_privilege('service_role', f, 'EXECUTE')::text, 'true')
  FROM unnest(ARRAY[
         'public.admin_motion_engine(jsonb)',
         'public.admin_motion_style(jsonb)',
         'public.admin_motion_tree(uuid[],jsonb,text[])',
         'public.admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])',
         'public.admin_motion_run_list(timestamptz,timestamptz,numeric,jsonb,text[],text,text,text,text,boolean,text,text,integer,integer)',
         'public.admin_motion_task_ids(timestamptz,timestamptz)'
       ]) AS f;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
