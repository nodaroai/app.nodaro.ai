-- jobs.llm_billing (migration 552) is SERVER-ONLY: the metered LLM billing
-- ledger carries the provider's dollar cost and the serving lanes. The job's
-- owner reads output_data (347's Realtime grant) and must not read this.
-- Run against the migrated disposable database, never the shared cloud project.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
 ('00000000-0000-4000-8000-000000549101', 'ledger-owner@test.invalid', '{}', 'authenticated', 'authenticated');

SET LOCAL ROLE service_role;
INSERT INTO public.jobs (id, user_id, job_type, status, credits, output_data, llm_billing) VALUES
 ('f0000000-0000-4000-8000-000000549101', '00000000-0000-4000-8000-000000549101', 'llm-chat', 'completed', 27,
  '{"text":"the answer"}', '{"costUsd":0.048,"source":"kie-stated","calls":1,"lanes":["kie"]}');
DO $$ BEGIN
  -- The service role (settle, sweep, admin tooling) reads and writes it.
  IF (SELECT (llm_billing->>'calls')::int FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000549101') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: service role cannot read the ledger';
  END IF;
  BEGIN
    UPDATE public.jobs SET llm_billing = '[]' WHERE id = 'f0000000-0000-4000-8000-000000549101';
    RAISE EXCEPTION 'ASSERT FAIL: a non-object ledger was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_column_privilege('authenticated', 'public.jobs', 'llm_billing', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERT FAIL: authenticated holds SELECT on jobs.llm_billing';
  END IF;
  IF has_column_privilege('anon', 'public.jobs', 'llm_billing', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERT FAIL: anon holds SELECT on jobs.llm_billing';
  END IF;
  -- The owner's own columns (347) are still readable — the revoke is that narrow.
  IF NOT has_column_privilege('authenticated', 'public.jobs', 'output_data', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERT FAIL: 552 took output_data away from the Realtime grant';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000549101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000549101';
DO $$
DECLARE v_out jsonb;
BEGIN
  -- The owner reads their own output — and finds no ledger in it.
  SELECT output_data INTO v_out FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000549101';
  IF v_out IS NULL OR v_out ? 'billing' OR v_out ? 'llm_billing' OR v_out::text LIKE '%costUsd%' THEN
    RAISE EXCEPTION 'ASSERT FAIL: the owner read a ledger through output_data: %', v_out;
  END IF;
  -- And cannot select the column itself, even on their own row.
  BEGIN
    PERFORM llm_billing FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000549101';
    RAISE EXCEPTION 'ASSERT FAIL: the owner selected jobs.llm_billing';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
