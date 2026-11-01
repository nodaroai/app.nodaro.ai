-- ============================================================================
-- Behavioral proof: the admin Jobs list filters on the server (migration 575).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000574001 upward).
--
-- WHAT IT PROVES.
--   1. `public.admin_job_own_credits` and `public.job_platform_key` answer every
--      case of the tables the backend's TypeScript twins are tested against
--      (supabase/tests/fixtures/admin-job-own-credits-cases.json and
--      job-platform-cases.json) — the SQL cannot drift from the TS.
--   2. `public.admin_job_page` applies each filter alone, several together,
--      a date range whose upper bound is exclusive, a search that matches `%`,
--      `_` and `\` literally in any of the row's text fields (prompt,
--      userPrompt, userInput, text, error), an exact id search, a type that
--      falls back to `job_type` when `input_data.type` is empty or not a
--      string, a model key that reads `resolvedModel` before `provider`, and
--      offset/limit over a stable newest-first order.
--   3. `public.admin_job_sources` lists each platform key once with its count
--      and a representative source, most jobs first, from a given time on.
--   4. None of the four is callable from a browser (anon / authenticated).
--
-- The case tables are read with psql's backquote expansion, relative to the
-- working directory: run it from the repo root, as CI does.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/admin-job-page.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
\set own_credits_cases `cat supabase/tests/fixtures/admin-job-own-credits-cases.json`
\set platform_cases `cat supabase/tests/fixtures/job-platform-cases.json`
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
  ('00000000-0000-4000-8000-000000574001', 'ajp-one@ajp.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000574002', 'ajp-two@ajp.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000574003', 'ajp-staff@ajp.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000574009', 'ajp-cases@ajp.test', '{}', 'authenticated', 'authenticated');

-- A usage log for a job (its own hold, or a side hold), under the job's user.
CREATE FUNCTION pg_temp.log(p_user uuid, p_status text, p_used integer, p_charged integer) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.usage_logs (user_id, action, provider, credits_used, credits_charged, status)
  VALUES (p_user, 'ajp-test', 'test', p_used, p_charged, p_status)
  RETURNING id
$$;

-- A side hold for a job: a usage log with no job_id, linked through llm_side_holds.
CREATE FUNCTION pg_temp.side_hold(p_job uuid, p_status text, p_credits integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.llm_side_holds (usage_log_id, job_id, user_id, charge_id, hold_credits)
  SELECT pg_temp.log(j.user_id, p_status, p_credits, CASE WHEN p_status = 'committed' THEN p_credits END),
         j.id, j.user_id, 'image-to-text:ajp-test', p_credits
    FROM public.jobs j WHERE j.id = p_job
$$;

-- ---------------------------------------------------------------------------
-- 1a. The own-credits case table.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE own_credit_cases AS
  SELECT n, c->>'label' AS label, c->>'logStatus' AS log_status,
         (c->>'creditsUsed')::integer AS credits_used,
         (c->>'creditsCharged')::integer AS credits_charged,
         ARRAY(SELECT x::integer FROM jsonb_array_elements_text(c->'sideCharges') AS x) AS side_charges,
         -- Side holds still reserved: never part of the job's figure.
         ARRAY(SELECT x::integer FROM jsonb_array_elements_text(c->'openSideCharges') AS x) AS open_side_charges,
         (c->>'held')::integer AS held,
         (c->>'expected')::integer AS expected,
         ('00000000-0000-4000-8000-000000574' || lpad((900 + n)::text, 3, '0'))::uuid AS job_id
    FROM jsonb_array_elements(:'own_credits_cases'::jsonb) WITH ORDINALITY AS t(c, n);
SELECT pg_temp.assert_eq('the own-credits case table was read',
  ((SELECT count(*) FROM own_credit_cases) >= 8)::text, 'true');

DO $$
DECLARE r record; v_log uuid; v_side integer;
BEGIN
  FOR r IN SELECT * FROM own_credit_cases LOOP
    INSERT INTO public.jobs (id, user_id, status, credits, created_at)
    VALUES (r.job_id, '00000000-0000-4000-8000-000000574009', 'completed', r.held, '2020-01-01T00:00:00Z');
    IF r.log_status IS NOT NULL THEN
      v_log := pg_temp.log('00000000-0000-4000-8000-000000574009', r.log_status, r.credits_used, r.credits_charged);
      UPDATE public.jobs SET usage_log_id = v_log WHERE id = r.job_id;
    END IF;
    FOREACH v_side IN ARRAY r.side_charges LOOP
      PERFORM pg_temp.side_hold(r.job_id, 'committed', v_side);
    END LOOP;
    FOREACH v_side IN ARRAY r.open_side_charges LOOP
      PERFORM pg_temp.side_hold(r.job_id, 'reserved', v_side);
    END LOOP;
  END LOOP;
END $$;

SELECT pg_temp.assert_eq('admin_job_own_credits: ' || c.label,
  public.admin_job_own_credits(j.id, j.usage_log_id, j.credits)::text, c.expected::text)
  FROM own_credit_cases c JOIN public.jobs j ON j.id = c.job_id
 ORDER BY c.n;

-- A side hold still open or refunded is not part of a settled job's charge.
DO $$ BEGIN
  PERFORM pg_temp.side_hold(job_id, 'reserved', 25) FROM own_credit_cases WHERE label = 'committed + side 40';
  PERFORM pg_temp.side_hold(job_id, 'refunded', 25) FROM own_credit_cases WHERE label = 'committed + side 40';
END $$;
SELECT pg_temp.assert_eq('admin_job_own_credits: an open or refunded side hold adds nothing',
  public.admin_job_own_credits(j.id, j.usage_log_id, j.credits)::text, '360')
  FROM own_credit_cases c JOIN public.jobs j ON j.id = c.job_id
 WHERE c.label = 'committed + side 40';

-- The case-table jobs are done with; the page proofs below see only theirs.
DELETE FROM public.jobs WHERE user_id = '00000000-0000-4000-8000-000000574009';

-- ---------------------------------------------------------------------------
-- 1b. The platform case table.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE platform_cases AS
  SELECT n, c->>'label' AS label, c->>'source' AS source, c->>'sourceDetail' AS source_detail,
         c->>'expected' AS expected
    FROM jsonb_array_elements(:'platform_cases'::jsonb) WITH ORDINALITY AS t(c, n);
SELECT pg_temp.assert_eq('the platform case table was read',
  ((SELECT count(*) FROM platform_cases) >= 9)::text, 'true');
SELECT pg_temp.assert_eq('job_platform_key: ' || label,
  public.job_platform_key(source, source_detail), expected)
  FROM platform_cases ORDER BY n;
SELECT pg_temp.assert_eq('job_platform_key: an empty source is unknown',
  public.job_platform_key('', NULL), 'unknown');
SELECT pg_temp.assert_eq('job_platform_key: the source kind is case-insensitive',
  public.job_platform_key('MCP', NULL), 'mcp');
SELECT pg_temp.assert_eq('job_platform_key: an app with no id',
  public.job_platform_key('app', NULL), 'app');
SELECT pg_temp.assert_eq('job_platform_key: an empty host is web without a host',
  public.job_platform_key('web', ''), 'web');
SELECT pg_temp.assert_eq('job_platform_key: a blank host is generic web',
  public.job_platform_key('web', '   '), 'web:web');
SELECT pg_temp.assert_eq('job_platform_key: an empty subdomain of nodaro.ai is generic web',
  public.job_platform_key('web', '.nodaro.ai'), 'web:web');
SELECT pg_temp.assert_eq('job_platform_key: a host that does not END in .nodaro.ai is kept whole',
  public.job_platform_key('web', 'studio.nodaro.ai.'), 'web:studio.nodaro.ai.');
SELECT pg_temp.assert_eq('job_platform_key: the host is trimmed',
  public.job_platform_key('web', '  Studio.Nodaro.ai '), 'web:studio');

-- ---------------------------------------------------------------------------
-- 2. admin_job_page over fourteen jobs, newest first:
--    114 and 113 share one timestamp (T); then 101 (T-1h) ... 112 (T-12h).
--
--  id  user   status      type (input/job_type)    model key            credits own  source / detail
--  101 one    completed   generate-image (+legacy) provider gpt-image    30  20   web studio.nodaro.ai
--  102 two    failed      generate-video           provider kling-3     200   0   mcp
--  103 one    completed   llm-chat                 llmModel gpt-5         5   5   api
--  104 staff  completed   generate-image           provider gpt-image    30  30   web next.studio.nodaro.ai
--  105 two    processing  (job_type) generate-video                     300 300   web recast.nodaro.ai
--  106 one    completed   generate-video           model veo-3          400 400   app <app id>
--  107 one    failed      generate-image           provider flux-2       10   0   (none)
--  108 two    completed   generate-image           provider gpt-image    50  55   web studio.nodaro.ai (45 + side 10)
--  109 one    completed   generate-video           provider kling-3     150 150   cli
--  110 two    pending     generate-image           provider gpt-image  null   0   web localhost:3000
--  111 one    completed   generate-video           provider kling-3      90  60   mcp
--  112 staff  completed   generate-video           provider kling-3     500 500   mcp
--  113 two    completed   text                     llmModel gpt-5,        -   0   sdk
--                                                  provider claude (wins)
--  114 one    completed   generate-audio           (none; jobs.provider = kie)  - 0  sdk
-- ---------------------------------------------------------------------------
INSERT INTO public.jobs (id, user_id, status, job_type, input_data, credits, provider, source, source_detail, error_message, created_at)
SELECT ('00000000-0000-4000-8000-000000574' || v.id)::uuid,
       ('00000000-0000-4000-8000-000000574' || v.u)::uuid,
       v.status, v.job_type, v.input_data::jsonb, v.credits, v.provider, v.source, v.detail, v.err,
       '2026-06-01T12:00:00Z'::timestamptz - make_interval(hours => v.h)
  FROM (VALUES
    ('101', '001', 'completed',  'legacy', '{"type":"generate-image","provider":"gpt-image","prompt":"a red fox"}', 30, 'kie', 'web', 'studio.nodaro.ai', NULL, 1),
    ('102', '002', 'failed',     NULL, '{"type":"generate-video","provider":"kling-3","prompt":"100% pure"}', 200, 'kie', 'mcp', NULL, 'provider timeout', 2),
    ('103', '001', 'completed',  NULL, '{"type":"llm-chat","llmModel":"gpt-5","prompt":"draft an a-b plan"}', 5, 'openrouter', 'api', NULL, NULL, 3),
    ('104', '003', 'completed',  NULL, '{"type":"generate-image","provider":"gpt-image","prompt":"fox den"}', 30, 'kie', 'web', 'next.studio.nodaro.ai', NULL, 4),
    ('105', '002', 'processing', 'generate-video', '{}', 300, 'kie', 'web', 'recast.nodaro.ai', NULL, 5),
    ('106', '001', 'completed',  NULL, '{"type":"generate-video","model":"veo-3"}', 400, 'kie', 'app', '7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', NULL, 6),
    ('107', '001', 'failed',     NULL, '{"type":"generate-image","provider":"flux-2","prompt":"100 percent"}', 10, 'replicate', NULL, NULL, 'a_b failure', 7),
    ('108', '002', 'completed',  NULL, '{"type":"generate-image","provider":"gpt-image","prompt":"a_b test at C:\\tmp"}', 50, 'kie', 'web', 'studio.nodaro.ai', NULL, 8),
    ('109', '001', 'completed',  NULL, '{"type":"generate-video","provider":"kling-3","prompt":"foxes in an aXb grove"}', 150, 'kie', 'cli', NULL, NULL, 9),
    ('110', '002', 'pending',    NULL, '{"type":"generate-image","provider":"gpt-image"}', NULL, 'kie', 'web', 'localhost:3000', NULL, 10),
    ('111', '001', 'completed',  NULL, '{"type":"generate-video","provider":"kling-3"}', 90, 'kie', 'mcp', NULL, NULL, 11),
    ('112', '003', 'completed',  NULL, '{"type":"generate-video","provider":"kling-3"}', 500, 'kie', 'mcp', NULL, NULL, 12),
    ('113', '002', 'completed',  NULL, '{"type":"text","llmModel":"gpt-5","provider":"claude"}', NULL, 'openrouter', 'sdk', NULL, NULL, 0),
    ('114', '001', 'completed',  NULL, '{"type":"generate-audio"}', NULL, 'kie', 'sdk', NULL, NULL, 0)
  ) AS v(id, u, status, job_type, input_data, credits, provider, source, detail, err, h);

-- Each job's own hold, under its own user.
DO $$
DECLARE r record; v_log uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('101', 'committed', 30, 20), ('102', 'refunded', 200, NULL), ('103', 'committed', 5, 5),
      ('105', 'reserved', 300, NULL), ('106', 'committed', 400, 400), ('107', 'refunded', 10, NULL),
      ('108', 'committed', 50, 45), ('109', 'committed', 150, 150), ('111', 'committed', 90, 60),
      ('112', 'committed', 500, 500)
    ) AS v(id, st, used, charged)
  LOOP
    SELECT pg_temp.log(j.user_id, r.st, r.used, r.charged) INTO v_log
      FROM public.jobs j WHERE j.id = ('00000000-0000-4000-8000-000000574' || r.id)::uuid;
    UPDATE public.jobs SET usage_log_id = v_log WHERE id = ('00000000-0000-4000-8000-000000574' || r.id)::uuid;
  END LOOP;
  -- 108 settled at 45 plus a 10-credit side hold: its own figure is 55.
  PERFORM pg_temp.side_hold('00000000-0000-4000-8000-000000574108', 'committed', 10);
END $$;

-- The page, as the last three digits of each id, in the order returned. Every
-- argument defaults to "no filter" except the window, which holds the proof to
-- its own rows (a NULL passed explicitly lifts it).
CREATE FUNCTION pg_temp.page(
  p_offset int DEFAULT 0, p_limit int DEFAULT 100,
  p_status text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_exclude_user_ids uuid[] DEFAULT NULL,
  p_types text[] DEFAULT NULL, p_models text[] DEFAULT NULL, p_min_credits int DEFAULT NULL,
  p_sources text[] DEFAULT NULL,
  p_from timestamptz DEFAULT '2026-05-01T00:00:00Z', p_to timestamptz DEFAULT '2026-07-01T00:00:00Z',
  p_q text DEFAULT NULL, p_q_is_id boolean DEFAULT NULL
) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(t.id::text, 3), ',' ORDER BY t.ord), '')
    FROM public.admin_job_page(
      p_offset => p_offset, p_limit => p_limit, p_status => p_status, p_user_id => p_user_id,
      p_exclude_user_ids => p_exclude_user_ids, p_types => p_types, p_models => p_models,
      p_min_credits => p_min_credits, p_sources => p_sources, p_from => p_from, p_to => p_to,
      p_q => p_q, p_q_is_id => p_q_is_id
    ) WITH ORDINALITY AS t(id, ord)
   WHERE t.id::text LIKE '00000000-0000-4000-8000-000000574%'
$$;

SELECT pg_temp.assert_eq('no filter: every job, newest first, a timestamp tie broken by id',
  pg_temp.page(), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('no window at all: the same jobs',
  pg_temp.page(p_from => NULL, p_to => NULL), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');

-- One filter at a time.
SELECT pg_temp.assert_eq('status', pg_temp.page(p_status => 'failed'), '102,107');
SELECT pg_temp.assert_eq('user', pg_temp.page(p_user_id => '00000000-0000-4000-8000-000000574001'),
  '114,101,103,106,107,109,111');
SELECT pg_temp.assert_eq('excluded users',
  pg_temp.page(p_exclude_user_ids => ARRAY['00000000-0000-4000-8000-000000574003'::uuid]),
  '114,113,101,102,103,105,106,107,108,109,110,111');
SELECT pg_temp.assert_eq('excluded users: an empty list excludes nobody',
  pg_temp.page(p_exclude_user_ids => ARRAY[]::uuid[]), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('types: the input type, else job_type',
  pg_temp.page(p_types => ARRAY['generate-video']), '102,105,106,109,111,112');
SELECT pg_temp.assert_eq('types: the input type wins over job_type',
  pg_temp.page(p_types => ARRAY['legacy']), '');
SELECT pg_temp.assert_eq('types: several',
  pg_temp.page(p_types => ARRAY['llm-chat', 'text']), '113,103');
SELECT pg_temp.assert_eq('types: an empty list is no filter',
  pg_temp.page(p_types => ARRAY[]::text[]), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('models: provider',
  pg_temp.page(p_models => ARRAY['gpt-image']), '101,104,108,110');
SELECT pg_temp.assert_eq('models: llmModel when there is no provider; provider wins beside it',
  pg_temp.page(p_models => ARRAY['gpt-5']), '103');
SELECT pg_temp.assert_eq('models: provider beside llmModel',
  pg_temp.page(p_models => ARRAY['claude']), '113');
SELECT pg_temp.assert_eq('models: model',
  pg_temp.page(p_models => ARRAY['veo-3']), '106');
SELECT pg_temp.assert_eq('models: the vendor lane in jobs.provider is never the model',
  pg_temp.page(p_models => ARRAY['kie', 'openrouter']), '');
SELECT pg_temp.assert_eq('min credits: the own figure, inclusive',
  pg_temp.page(p_min_credits => 55), '105,106,108,109,111,112');
SELECT pg_temp.assert_eq('min credits: settled below the hold counts the charge',
  pg_temp.page(p_min_credits => 100), '105,106,109,112');
SELECT pg_temp.assert_eq('min credits: a side hold moves a job across the line',
  pg_temp.page(p_min_credits => 50, p_types => ARRAY['generate-image']), '108');
SELECT pg_temp.assert_eq('min credits: 0 keeps every job',
  pg_temp.page(p_min_credits => 0), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('sources: a web product, env prefix collapsed',
  pg_temp.page(p_sources => ARRAY['web:studio']), '101,104,108');
SELECT pg_temp.assert_eq('sources: unknown',
  pg_temp.page(p_sources => ARRAY['unknown']), '107');
SELECT pg_temp.assert_eq('sources: a developer app by id',
  pg_temp.page(p_sources => ARRAY['app:7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b']), '106');
SELECT pg_temp.assert_eq('sources: several',
  pg_temp.page(p_sources => ARRAY['mcp', 'cli']), '102,109,111,112');
SELECT pg_temp.assert_eq('from: inclusive',
  pg_temp.page(p_from => '2026-06-01T11:00:00Z'), '114,113,101');
SELECT pg_temp.assert_eq('to: exclusive',
  pg_temp.page(p_to => '2026-06-01T12:00:00Z'), '101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('from + to: a window',
  pg_temp.page(p_from => '2026-06-01T02:00:00Z', p_to => '2026-06-01T04:00:00Z'), '109,110');

-- Search.
SELECT pg_temp.assert_eq('q: the prompt, case-insensitive',
  pg_temp.page(p_q => 'FOX'), '101,104,109');
SELECT pg_temp.assert_eq('q: the error message',
  pg_temp.page(p_q => 'timeout'), '102');
SELECT pg_temp.assert_eq('q: % is a literal',
  pg_temp.page(p_q => '100%'), '102');
SELECT pg_temp.assert_eq('q: _ is a literal, in the prompt or the error',
  pg_temp.page(p_q => 'a_b'), '107,108');
SELECT pg_temp.assert_eq('q: a backslash is a literal',
  pg_temp.page(p_q => 'C:\tmp'), '108');
SELECT pg_temp.assert_eq('q: blank is no filter',
  pg_temp.page(p_q => '  '), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');
SELECT pg_temp.assert_eq('q: an id matches that job exactly',
  pg_temp.page(p_q => '00000000-0000-4000-8000-000000574105', p_q_is_id => true), '105');
SELECT pg_temp.assert_eq('q: an id is not searched as text',
  pg_temp.page(p_q => '00000000-0000-4000-8000-000000574105', p_q_is_id => false), '');

-- ---------------------------------------------------------------------------
-- 2a. Rows whose text or type lives elsewhere, in a window of their own (2025)
--     so the fourteen-job proofs above and below never see them.
--
--  id  type (input/job_type)        text field
--  201 llm-chat                     userInput "summarise the otter report"
--  202 text-to-speech               text      "the otter said hello"
--  203 image-to-image               userPrompt "an otter in a hat"
--  204 '' / job_type llm            (none)
--  205 3 (a number) / job_type llm  (none)
-- ---------------------------------------------------------------------------
INSERT INTO public.jobs (id, user_id, status, job_type, input_data, created_at)
SELECT ('00000000-0000-4000-8000-000000574' || v.id)::uuid, '00000000-0000-4000-8000-000000574001',
       'completed', v.job_type, v.input_data::jsonb, '2025-01-01T12:00:00Z'::timestamptz - make_interval(hours => v.h)
  FROM (VALUES
    ('201', NULL,  '{"type":"llm-chat","userInput":"summarise the otter report"}', 1),
    ('202', NULL,  '{"type":"text-to-speech","text":"the otter said hello"}', 2),
    ('203', NULL,  '{"type":"image-to-image","userPrompt":"an otter in a hat"}', 3),
    ('204', 'llm', '{"type":""}', 4),
    ('205', 'llm', '{"type":3}', 5)
  ) AS v(id, job_type, input_data, h);

SELECT pg_temp.assert_eq('q: an LLM row matches on its userInput',
  pg_temp.page(p_q => 'otter report', p_from => '2025-01-01', p_to => '2025-01-02'), '201');
SELECT pg_temp.assert_eq('q: a TTS row matches on its text',
  pg_temp.page(p_q => 'SAID HELLO', p_from => '2025-01-01', p_to => '2025-01-02'), '202');
SELECT pg_temp.assert_eq('q: a row matches on its userPrompt',
  pg_temp.page(p_q => 'in a hat', p_from => '2025-01-01', p_to => '2025-01-02'), '203');
SELECT pg_temp.assert_eq('q: every text field, inside the date window only',
  pg_temp.page(p_q => 'otter', p_from => '2025-01-01', p_to => '2025-01-02'), '201,202,203');
SELECT pg_temp.assert_eq('q: the window still bounds the text search',
  pg_temp.page(p_q => 'otter', p_from => '2025-01-01T11:00:00Z', p_to => '2025-01-02'), '201');
SELECT pg_temp.assert_eq('types: an empty or non-string input type falls back to job_type',
  pg_temp.page(p_types => ARRAY['llm'], p_from => '2025-01-01', p_to => '2025-01-02'), '204,205');
SELECT pg_temp.assert_eq('types: an empty input type is never the type',
  pg_temp.page(p_types => ARRAY['', '3'], p_from => '2025-01-01', p_to => '2025-01-02'), '');

DELETE FROM public.jobs WHERE id IN (
  SELECT ('00000000-0000-4000-8000-000000574' || n)::uuid FROM unnest(ARRAY['201', '202', '203', '204', '205']) AS n);

-- Together.
SELECT pg_temp.assert_eq('types + models + min credits',
  pg_temp.page(p_types => ARRAY['generate-video'], p_models => ARRAY['kling-3'], p_min_credits => 100), '109,112');
SELECT pg_temp.assert_eq('types + models + min credits + excluded users',
  pg_temp.page(p_types => ARRAY['generate-video'], p_models => ARRAY['kling-3'], p_min_credits => 100,
               p_exclude_user_ids => ARRAY['00000000-0000-4000-8000-000000574003'::uuid]), '109');
SELECT pg_temp.assert_eq('status + source + search',
  pg_temp.page(p_status => 'completed', p_sources => ARRAY['web:studio', 'web:recast'], p_q => 'fox'), '101,104');

-- Offset and limit over the same order.
SELECT pg_temp.assert_eq('page 1', pg_temp.page(p_offset => 0, p_limit => 3), '114,113,101');
SELECT pg_temp.assert_eq('page 2', pg_temp.page(p_offset => 3, p_limit => 3), '102,103,104');
SELECT pg_temp.assert_eq('the last page is short', pg_temp.page(p_offset => 12, p_limit => 5), '111,112');
SELECT pg_temp.assert_eq('a filtered page', pg_temp.page(p_user_id => '00000000-0000-4000-8000-000000574001', p_offset => 2, p_limit => 2), '103,106');
SELECT pg_temp.assert_eq('no offset or limit given: from the start, every row',
  pg_temp.page(p_offset => NULL, p_limit => NULL), '114,113,101,102,103,104,105,106,107,108,109,110,111,112');

-- ---------------------------------------------------------------------------
-- 2b. admin_job_sources over the same fourteen jobs: one row per platform key,
--     its count, and the least source / source_detail as its representative.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.sources(p_since timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s.key || '=' || s.count, ',' ORDER BY s.ord), '')
    FROM public.admin_job_sources(p_since) WITH ORDINALITY AS s(key, source, source_detail, count, ord)
   WHERE s.key IN ('web:studio', 'web:recast', 'web:localhost:3000', 'mcp', 'api', 'cli', 'sdk', 'unknown',
                   'app:7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b')
$$;
SELECT pg_temp.assert_eq('sources: web:studio counts its three jobs, prefix collapsed',
  (SELECT count::text FROM public.admin_job_sources('2026-05-01T00:00:00Z') WHERE key = 'web:studio'), '3');
SELECT pg_temp.assert_eq('sources: the representative detail is the least one',
  (SELECT source || ' / ' || source_detail FROM public.admin_job_sources('2026-05-01T00:00:00Z') WHERE key = 'web:studio'),
  'web / next.studio.nodaro.ai');
SELECT pg_temp.assert_eq('sources: a kind with no detail',
  (SELECT coalesce(source, '<null>') || ' / ' || coalesce(source_detail, '<null>') || ' = ' || count
     FROM public.admin_job_sources('2026-05-01T00:00:00Z') WHERE key = 'mcp'), 'mcp / <null> = 3');
SELECT pg_temp.assert_eq('sources: unknown has no source',
  (SELECT coalesce(source, '<null>') || ' = ' || count
     FROM public.admin_job_sources('2026-05-01T00:00:00Z') WHERE key = 'unknown'), '<null> = 1');
SELECT pg_temp.assert_eq('sources: a developer app keeps its id',
  (SELECT source_detail || ' = ' || count
     FROM public.admin_job_sources('2026-05-01T00:00:00Z') WHERE key = 'app:7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b'),
  '7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b = 1');
SELECT pg_temp.assert_eq('sources: one row per key',
  (SELECT (count(*) = count(DISTINCT key))::text FROM public.admin_job_sources('2026-05-01T00:00:00Z')), 'true');
SELECT pg_temp.assert_eq('sources: most jobs first, then by key',
  pg_temp.sources('2026-05-01T00:00:00Z'),
  'mcp=3,web:studio=3,sdk=2,api=1,app:7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b=1,cli=1,unknown=1,web:localhost:3000=1,web:recast=1');
SELECT pg_temp.assert_eq('sources: since is inclusive and bounds the count',
  pg_temp.sources('2026-06-01T11:00:00Z'), 'sdk=2,web:studio=1');

-- ---------------------------------------------------------------------------
-- 2c. The model key reads `resolvedModel` first: the model the job ran, which
--     every new job records. Three jobs in April, outside the window above:
--      115  qa-check: provider "claude" (a vendor), resolvedModel an LLM id
--      116  text-to-speech: resolvedModel alone (the server's default model)
--      117  generate-image: provider only (a row from before resolvedModel)
-- ---------------------------------------------------------------------------
INSERT INTO public.jobs (id, user_id, status, input_data, created_at) VALUES
  ('00000000-0000-4000-8000-000000574115', '00000000-0000-4000-8000-000000574001', 'completed',
   '{"type":"qa-check","provider":"claude","llmModel":"gemini-3.6-flash","resolvedModel":"gemini-3.6-flash"}', '2026-04-15T12:00:00Z'),
  ('00000000-0000-4000-8000-000000574116', '00000000-0000-4000-8000-000000574001', 'completed',
   '{"type":"text-to-speech","resolvedModel":"elevenlabs-v3"}', '2026-04-15T11:00:00Z'),
  ('00000000-0000-4000-8000-000000574117', '00000000-0000-4000-8000-000000574001', 'completed',
   '{"type":"generate-image","provider":"gpt-image"}', '2026-04-15T10:00:00Z');
SELECT pg_temp.assert_eq('models: resolvedModel wins over a vendor name in provider',
  pg_temp.page(p_models => ARRAY['gemini-3.6-flash'], p_from => '2026-04-01T00:00:00Z', p_to => '2026-05-01T00:00:00Z'), '115');
SELECT pg_temp.assert_eq('models: the vendor name beside resolvedModel is not the model',
  pg_temp.page(p_models => ARRAY['claude'], p_from => '2026-04-01T00:00:00Z', p_to => '2026-05-01T00:00:00Z'), '');
SELECT pg_temp.assert_eq('models: resolvedModel alone',
  pg_temp.page(p_models => ARRAY['elevenlabs-v3'], p_from => '2026-04-01T00:00:00Z', p_to => '2026-05-01T00:00:00Z'), '116');
SELECT pg_temp.assert_eq('models: a row without resolvedModel still matches on provider',
  pg_temp.page(p_models => ARRAY['gpt-image'], p_from => '2026-04-01T00:00:00Z', p_to => '2026-05-01T00:00:00Z'), '117');

-- ---------------------------------------------------------------------------
-- 3. Server only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq(f || ' closed to ' || r, has_function_privilege(r, f, 'EXECUTE')::text, 'false')
  FROM unnest(ARRAY['anon', 'authenticated']) AS r,
       unnest(ARRAY[
         'public.job_platform_key(text,text)',
         'public.admin_job_own_credits(uuid,uuid,integer)',
         'public.admin_job_page(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)',
         'public.admin_job_sources(timestamptz)'
       ]) AS f;
SELECT pg_temp.assert_eq(f || ' open to service_role', has_function_privilege('service_role', f, 'EXECUTE')::text, 'true')
  FROM unnest(ARRAY[
         'public.job_platform_key(text,text)',
         'public.admin_job_own_credits(uuid,uuid,integer)',
         'public.admin_job_page(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)',
         'public.admin_job_sources(timestamptz)'
       ]) AS f;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
