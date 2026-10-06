-- Behaviour of `workflow_executions.input_overrides` (migration 466): the
-- input overrides a run applied, pinned on its execution when it starts, so a
-- continuation re-applies exactly those (decided 2026-10-06).
--
-- What reading the SQL cannot prove: that an execution inserted the way every
-- lane inserts one (without naming the column) holds NULL — "no pin", the
-- pre-migration reading — and not `{}` ("applied none"), which a default
-- would silently turn it into; that `{}` and a node map round-trip as written;
-- that only a node-keyed object is a pin; and that the runner's own RLS still
-- governs the row.
--
-- Run by the `migration-behavior` CI job against a real Postgres (see
-- workflow-cover.behavior.sql for running it locally).
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED

BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-0000000a6201', 'pin-owner@example.test'),
       ('00000000-0000-4000-8000-0000000a6202', 'pin-other@example.test');

DO $$
DECLARE
  v_user uuid := '00000000-0000-4000-8000-0000000a6201';
  v_project uuid;
  v_wf uuid;
  v_exec uuid;
  v_pin jsonb;
  v_nullable text;
  v_default text;
BEGIN
  INSERT INTO public.projects (user_id, name) VALUES (v_user, 'pin behaviour') RETURNING id INTO v_project;
  INSERT INTO public.workflows (user_id, project_id, name) VALUES (v_user, v_project, 'pin flow') RETURNING id INTO v_wf;

  -- 1. Nullable, no default: an execution inserted without the column has NO pin.
  SELECT is_nullable, column_default INTO v_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workflow_executions' AND column_name = 'input_overrides';
  ASSERT v_nullable = 'YES', 'input_overrides must be nullable';
  ASSERT v_default IS NULL, format('input_overrides must have no default, got %s', v_default);
  INSERT INTO public.workflow_executions (workflow_id, user_id, status)
  VALUES (v_wf, v_user, 'pending') RETURNING id, input_overrides INTO v_exec, v_pin;
  ASSERT v_pin IS NULL, format('an insert that does not name the pin: expected NULL, got %s', v_pin);
  RAISE NOTICE 'ok  an execution starts with no pin (NULL), never {}';

  -- 2. The orchestrator's write: "applied none" is {} — distinct from NULL.
  UPDATE public.workflow_executions SET input_overrides = '{}'::jsonb WHERE id = v_exec RETURNING input_overrides INTO v_pin;
  ASSERT v_pin = '{}'::jsonb AND v_pin IS NOT NULL, format('{} pin: got %s', v_pin);
  RAISE NOTICE 'ok  {} is stored as {} (ran with none)';

  -- 3. A node map round-trips as written.
  UPDATE public.workflow_executions
     SET input_overrides = '{"cap":{"fontSize":72},"cut":{"quality":"final","resolution":"1080p"}}'::jsonb
   WHERE id = v_exec RETURNING input_overrides INTO v_pin;
  ASSERT v_pin -> 'cap' ->> 'fontSize' = '72' AND v_pin -> 'cut' ->> 'quality' = 'final',
    format('node map: got %s', v_pin);
  RAISE NOTICE 'ok  a node map round-trips';

  -- 4. Only an object is a pin.
  BEGIN
    UPDATE public.workflow_executions SET input_overrides = '[]'::jsonb WHERE id = v_exec;
    RAISE EXCEPTION 'ASSERT FAIL: an array was stored as a pin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.workflow_executions SET input_overrides = '"final"'::jsonb WHERE id = v_exec;
    RAISE EXCEPTION 'ASSERT FAIL: a scalar was stored as a pin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.workflow_executions (workflow_id, user_id, status, input_overrides)
    VALUES (v_wf, v_user, 'pending', 'null'::jsonb);
    RAISE EXCEPTION 'ASSERT FAIL: a JSON null was stored as a pin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok  an array, a scalar or a JSON null is refused';

  -- 5. Re-running the migration's statements changes nothing.
  ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS input_overrides jsonb;
  SELECT input_overrides INTO v_pin FROM public.workflow_executions WHERE id = v_exec;
  ASSERT v_pin -> 'cap' ->> 'fontSize' = '72', 'the column survived a re-run';
  RAISE NOTICE 'ok  idempotent';

  -- 6. RLS unchanged: still on for the table.
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workflow_executions'::regclass),
    'RLS must stay enabled on workflow_executions';
  RAISE NOTICE 'ok  RLS still enabled';
END $$;

-- 7. Another person cannot read the pin (migration 036's select policy).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a6202","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000a6202';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.workflow_executions WHERE input_overrides IS NOT NULL) = 0,
    'another user read a pin';
  RAISE NOTICE 'ok  another user reads no pin';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
