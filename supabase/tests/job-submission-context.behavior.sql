-- Run against the migrated disposable database, never the shared cloud project.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
 ('00000000-0000-4000-8000-000000000981', 'submission-owner@test.invalid', '{}', 'authenticated', 'authenticated'),
 ('00000000-0000-4000-8000-000000000982', 'submission-other@test.invalid', '{}', 'authenticated', 'authenticated');

SET LOCAL ROLE service_role;
INSERT INTO public.jobs (id, user_id, job_type, status, credits, submission_context) VALUES
 ('f0000000-0000-4000-8000-000000000981', '00000000-0000-4000-8000-000000000981',
  'generate-image', 'pending', 0, '{"attemptId":"server-captured"}');

-- Normal job progress and explicitly retaining the same context remain legal.
UPDATE public.jobs SET status = 'processing', submission_context = submission_context
 WHERE id = 'f0000000-0000-4000-8000-000000000981';
DO $$ BEGIN
  IF (SELECT submission_context->>'attemptId' FROM public.jobs
      WHERE id = 'f0000000-0000-4000-8000-000000000981') IS DISTINCT FROM 'server-captured' THEN
    RAISE EXCEPTION 'ASSERT FAIL: service role cannot read the inserted snapshot';
  END IF;
  BEGIN
    UPDATE public.jobs SET submission_context = '{}' WHERE id = 'f0000000-0000-4000-8000-000000000981';
    RAISE EXCEPTION 'ASSERT FAIL: replaced immutable context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Job submission context is immutable' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.jobs SET submission_context = NULL WHERE id = 'f0000000-0000-4000-8000-000000000981';
    RAISE EXCEPTION 'ASSERT FAIL: cleared immutable context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Job submission context is immutable' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.jobs (user_id, job_type, status, credits, submission_context)
    VALUES ('00000000-0000-4000-8000-000000000981', 'generate-image', 'pending', 0, '[]');
    RAISE EXCEPTION 'ASSERT FAIL: non-object context inserted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000981","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000981';
-- A legitimate legacy insert remains allowed.
INSERT INTO public.jobs (id, user_id, job_type, status, credits)
 VALUES ('f0000000-0000-4000-8000-000000000983', '00000000-0000-4000-8000-000000000981', 'generate-image', 'pending', 0);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.jobs (user_id, job_type, status, credits, submission_context)
    VALUES ('00000000-0000-4000-8000-000000000981', 'generate-image', 'pending', 0, '{"attemptId":"forged"}');
    RAISE EXCEPTION 'ASSERT FAIL: owner forged trusted provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.jobs (user_id, job_type, status, credits)
    VALUES ('00000000-0000-4000-8000-000000000982', 'generate-image', 'pending', 0);
    RAISE EXCEPTION 'ASSERT FAIL: inserted another users job';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM submission_context FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000000981';
    RAISE EXCEPTION 'ASSERT FAIL: owner read private provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    UPDATE public.jobs SET submission_context = '{}' WHERE id = 'f0000000-0000-4000-8000-000000000983';
    RAISE EXCEPTION 'ASSERT FAIL: backfilled an untrusted job';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Job submission context is immutable' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_column_privilege('anon', 'public.jobs', 'submission_context', 'SELECT')
     OR has_column_privilege('authenticated', 'public.jobs', 'submission_context', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERT FAIL: private submission column is publicly readable';
  END IF;
  IF NOT (SELECT convalidated FROM pg_constraint
          WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_submission_context_object') THEN
    RAISE EXCEPTION 'ASSERT FAIL: context constraint is not validated';
  END IF;
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;
