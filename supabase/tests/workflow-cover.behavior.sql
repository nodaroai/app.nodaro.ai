-- Behaviour of `workflows.cover_node_types` (migration 339).
--
-- Trigger semantics are not provable by reading SQL: which UPDATEs fire it,
-- what a malformed graph does, and — the one that matters most — that a
-- backfill or a rename never restamps `updated_at`, because the dashboard
-- sorts by it and a reshuffle of every user's cards is silent damage.
--
-- Run by the `migration-behavior` CI job against a real Postgres.
--
-- Run locally:
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5434:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5434/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/workflow-cover.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED

BEGIN;

-- `profiles.id` is FK'd to `auth.users`, so the row has to exist there first —
-- the same order the app's signup takes.
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-00000000c0be', 'cover-behavior@example.test');

DO $$
DECLARE
  v_user uuid := '00000000-0000-4000-8000-00000000c0be';
  v_project uuid;
  v_wf uuid;
  v_types text[];
  v_updated timestamptz;
  v_updated_after timestamptz;
BEGIN
  INSERT INTO public.projects (user_id, name)
  VALUES (v_user, 'cover behaviour')
  RETURNING id INTO v_project;

  -- 1. An INSERT that never mentions `nodes` still gets an answer, not NULL.
  --    A brand-new workflow is empty, and the cover must say "empty", not
  --    "unknown" — they look the same to a user but only one is a fact.
  INSERT INTO public.workflows (user_id, project_id, name)
  VALUES (v_user, v_project, 'empty flow')
  RETURNING id, cover_node_types INTO v_wf, v_types;
  ASSERT v_types = '{}', format('insert without nodes: expected {}, got %s', v_types);
  RAISE NOTICE 'ok  insert without nodes';

  -- 2. Writing a graph records its distinct types, and only its types.
  UPDATE public.workflows
     SET nodes = '[{"type":"text"},{"type":"generate-image"},{"type":"text"}]'::jsonb
   WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types @> '{text,generate-image}' AND array_length(v_types, 1) = 2,
    format('update of nodes: expected 2 distinct types, got %s', v_types);
  RAISE NOTICE 'ok  update of nodes recomputes';

  -- 3. A node with no usable type contributes nothing rather than a NULL hole,
  --    which would make `array_length` lie to the client.
  UPDATE public.workflows
     SET nodes = '[{"type":""},{},{"type":"text"},{"other":1}]'::jsonb
   WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types = '{text}', format('junk elements: expected {text}, got %s', v_types);
  RAISE NOTICE 'ok  elements with no usable type are skipped';

  -- 4. `nodes` that is not an array at all must not raise: an autosave failing
  --    because a graph is malformed would be a far worse bug than a plain cover.
  UPDATE public.workflows SET nodes = '{"not":"an array"}'::jsonb WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types = '{}', format('non-array nodes: expected {}, got %s', v_types);
  RAISE NOTICE 'ok  a non-array graph does not raise';

  UPDATE public.workflows SET nodes = '[]'::jsonb WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types = '{}', format('empty array: expected {}, got %s', v_types);
  RAISE NOTICE 'ok  an empty graph is {}';

  -- 4b. A node late in a large graph still counts. An earlier version bounded
  --     the scan with a LIMIT placed before the filter, so a video node at
  --     index 550 of a 600-node graph vanished and the flow showed an image
  --     cover. Nothing about position may change the answer.
  UPDATE public.workflows
     SET nodes = (
           SELECT jsonb_agg(
                    CASE WHEN i = 550 THEN '{"type":"image-to-video"}'::jsonb
                         ELSE '{"type":"text"}'::jsonb END
                  )
             FROM generate_series(1, 600) AS i
         )
   WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types @> '{image-to-video}',
    format('a node at index 550 was dropped: %s', v_types);
  RAISE NOTICE 'ok  a node late in a large graph still counts';

  -- 5. A hand-written value does not stick. RLS lets an owner PATCH the column
  --    straight through PostgREST; the trigger has to recompute over the top,
  --    or "maintained by trigger" is a convention rather than an invariant.
  UPDATE public.workflows
     SET nodes = '[{"type":"image-to-video"}]'::jsonb
   WHERE id = v_wf;
  UPDATE public.workflows
     SET cover_node_types = '{spoofed}'
   WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types = '{image-to-video}',
    format('hand-written value must be recomputed, got %s', v_types);
  RAISE NOTICE 'ok  a hand-written value is recomputed';

  -- 6. A rename does not touch the column: the graph did not change, so the
  --    cover must not flicker to something else on the dashboard.
  UPDATE public.workflows SET name = 'renamed' WHERE id = v_wf
  RETURNING cover_node_types INTO v_types;
  ASSERT v_types = '{image-to-video}', format('rename changed the column: %s', v_types);
  RAISE NOTICE 'ok  a rename leaves the column alone';

  -- 7. The backfill shape — writing ONLY this column with `set_updated_at`
  --    disabled — leaves `updated_at` alone. This is the assertion the whole
  --    migration hinges on: the dashboard sorts by `updated_at DESC`, so a
  --    backfill that restamps rows silently reorders every user's cards.
  SELECT updated_at INTO v_updated FROM public.workflows WHERE id = v_wf;
  PERFORM pg_sleep(0.05);
  ALTER TABLE public.workflows DISABLE TRIGGER set_updated_at;
  UPDATE public.workflows SET cover_node_types = cover_node_types WHERE id = v_wf;
  ALTER TABLE public.workflows ENABLE TRIGGER set_updated_at;
  SELECT updated_at INTO v_updated_after FROM public.workflows WHERE id = v_wf;
  ASSERT v_updated_after = v_updated,
    format('backfill restamped updated_at: %s -> %s', v_updated, v_updated_after);
  RAISE NOTICE 'ok  the backfill does not restamp updated_at';

END;
$$;

-- The runner greps for this exact line: a proof that silently never ran would
-- otherwise be indistinguishable from a proof that passed.
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
