\set ON_ERROR_STOP on
BEGIN;
-- Migration 404 widened the live-thread invariant from (user, workflow) to
-- (user, workflow, surface). That is the whole point of the change and it is
-- not provable from the SQL text: the text says a unique index was created and
-- another dropped, while the invariant is what the database ACCEPTS and
-- REFUSES. Both halves matter, and they pull against each other — too wide and
-- the canvas assistant can mint duplicates of itself, too narrow and the studio
-- assistant can never open a thread on a workflow that already has one.
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
 RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 ('00000000-0000-4000-8000-000000000404','surface@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000404','Thread surface');
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('40000000-0000-4000-8000-000000000404','c0000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000404','One production','[]','[]');

-- A row written by code that predates the column is a CANVAS thread. Nothing
-- backfills it and nothing should have to.
INSERT INTO public.copilot_threads(id,user_id,workflow_id) VALUES
 ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404');
SELECT pg_temp.assert_true('a row written without the column is a canvas thread',
 (SELECT surface = 'workflow' FROM public.copilot_threads WHERE id='a0000000-0000-4000-8000-000000000001'));

-- The reason the migration exists: the second assistant on the SAME workflow.
INSERT INTO public.copilot_threads(id,user_id,workflow_id,surface) VALUES
 ('a0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404','studio');
SELECT pg_temp.assert_true('both assistants hold a live thread on one workflow',
 (SELECT count(*) = 2 FROM public.copilot_threads
  WHERE workflow_id='40000000-0000-4000-8000-000000000404' AND archived_at IS NULL));

-- …and the lookup each one makes still finds exactly one row, which is the
-- property the old single-row read depended on and the new index preserves.
SELECT pg_temp.assert_true('each surface looks up exactly one live row',
 (SELECT count(*) = 1 FROM public.copilot_threads
  WHERE user_id='00000000-0000-4000-8000-000000000404' AND workflow_id='40000000-0000-4000-8000-000000000404'
    AND surface='workflow' AND archived_at IS NULL)
 AND (SELECT count(*) = 1 FROM public.copilot_threads
  WHERE user_id='00000000-0000-4000-8000-000000000404' AND workflow_id='40000000-0000-4000-8000-000000000404'
    AND surface='studio' AND archived_at IS NULL));

DO $$ BEGIN
 -- Still refused: a SECOND live thread of a kind that already has one. The
 -- widening must not have loosened this, or the canvas assistant starts
 -- duplicating itself the first time a lookup blinks.
 BEGIN
  INSERT INTO public.copilot_threads(user_id,workflow_id,surface) VALUES
   ('00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404','workflow');
  RAISE EXCEPTION 'ASSERT FAIL: a second live canvas thread was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.assert_true('a second live canvas thread is refused', true);
 BEGIN
  INSERT INTO public.copilot_threads(user_id,workflow_id,surface) VALUES
   ('00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404','studio');
  RAISE EXCEPTION 'ASSERT FAIL: a second live studio thread was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.assert_true('a second live studio thread is refused', true);
 -- The column admits these two kinds and no others: a typo becomes a failed
 -- write rather than a thread nothing will ever look up.
 BEGIN
  INSERT INTO public.copilot_threads(user_id,workflow_id,surface) VALUES
   ('00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404','canvas');
  RAISE EXCEPTION 'ASSERT FAIL: an unknown surface was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM pg_temp.assert_true('an unknown surface is refused', true);
END $$;

-- Archiving is the exit, and it is what makes the rollback available: the
-- operator archives the studio rows and the reverted narrow index then accepts
-- the canvas row already there.
UPDATE public.copilot_threads SET archived_at = now() WHERE id='a0000000-0000-4000-8000-000000000002';
INSERT INTO public.copilot_threads(id,user_id,workflow_id,surface) VALUES
 ('a0000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000404','40000000-0000-4000-8000-000000000404','studio');
SELECT pg_temp.assert_true('an archived thread frees its slot',
 (SELECT count(*) = 1 FROM public.copilot_threads
  WHERE workflow_id='40000000-0000-4000-8000-000000000404' AND surface='studio' AND archived_at IS NULL));

-- The old index is gone, not merely shadowed: leaving it would refuse the
-- second assistant on every workflow and the widening would be inert.
SELECT pg_temp.assert_true('the narrower index is gone',
 NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='copilot_threads_active_per_workflow'));
SELECT pg_temp.assert_true('the wider index is present',
 EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='copilot_threads_active_per_workflow_surface'));

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
