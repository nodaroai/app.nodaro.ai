-- ============================================================================
-- Behavioral proof: content scoping keeps every existing user exactly where
-- they are.
--
-- Runs AFTER the whole migration chain, as `postgres`, inside one transaction
-- that rolls back. It asserts the INTENDED postcondition rather than diffing
-- before/after: for pre-organization data (every workspace_id NULL), what each
-- user can see, change and delete is exactly what they own — plus the one
-- known carve-out, public completed jobs. That holds before the RLS rewrite
-- (today's user_id policies) and must still hold after it: the OWNERSHIP
-- assertions — who sees, edits and deletes which rows — are the invariant, and
-- they run unchanged on every part of the content-scoping migration.
--
-- Three assertions below are deliberately NOT part of that invariant, because
-- part c is what changes them; each is marked [moves in part c]. When one goes
-- red there, update the number — do not weaken part c to keep it green.
--
-- Every identity-dependent assertion runs under SET LOCAL ROLE authenticated
-- with jwt claims, and RESET ROLE between users: as `postgres` the helpers
-- short-circuit on auth.uid() IS NULL and RLS does not apply at all.
--
-- Run locally:
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-content.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test bash -c 'psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql 2>&1 | grep -E "NOTICE|ERROR"'
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================

BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- ---------------------------------------------------------------- fixtures
-- A distinct uuid range (…-000000000101 upward) so this proof can never
-- collide with the foundations/invitations proofs' rows.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000101', 'owner1@c.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000102', 'owner2@c.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000103', 'padmin@c.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000104', 'nobody@c.test',  '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger', (SELECT count(*)::text FROM profiles WHERE email LIKE '%@c.test'), '4');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000103';

-- U1: two projects. U2: one project.
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'U1 project A'),
  ('c0000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'U1 project B'),
  ('c0000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000102', 'U2 project');

-- U1 workflows: plain, shared by token, a sub-workflow, one made from a
-- template. (workflows.project_id is NOT NULL, so there is no "workflow
-- without a project" shape, and the table has no soft-delete column.)
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'U1 wf plain'),
  ('d0000000-0000-4000-8000-000000000102', 'c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'U1 wf shared'),
  ('d0000000-0000-4000-8000-000000000103', 'c0000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'U1 wf sub'),
  ('d0000000-0000-4000-8000-000000000104', 'c0000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'U1 wf from template'),
  ('d0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000102', 'U2 wf');
UPDATE workflows SET share_token = 'tok-c-test-102' WHERE id = 'd0000000-0000-4000-8000-000000000102';
UPDATE workflows SET parent_workflow_id = 'd0000000-0000-4000-8000-000000000101' WHERE id = 'd0000000-0000-4000-8000-000000000103';
-- A template published from the plain workflow, and a workflow made from it.
INSERT INTO workflow_templates (id, workflow_id, creator_id, name) VALUES
  ('d1000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'U1 template');
UPDATE workflows SET template_id = 'd1000000-0000-4000-8000-000000000101' WHERE id = 'd0000000-0000-4000-8000-000000000104';

-- Entities: each twice for U1 — with U1's project and with NO project
-- (project_id is nullable on all three; this is the shape the rewrite must
-- not orphan) — plus ONE location attached to U2's project: the cross-user
-- shape today's rule allows and the rewrite must neither hide from U1 nor
-- silently hand to U2 before part c decides it.
INSERT INTO locations (id, user_id, project_id, name) VALUES
  ('e1000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', 'U1 loc in project'),
  ('e1000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', NULL,                                   'U1 loc no project'),
  ('e1000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000201', 'U1 loc in U2 project');
INSERT INTO objects (id, user_id, project_id, name) VALUES
  ('e2000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', 'U1 obj in project'),
  ('e2000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', NULL,                                   'U1 obj no project');
INSERT INTO creatures (id, user_id, project_id, name) VALUES
  ('e3000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', 'U1 cre in project'),
  ('e3000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', NULL,                                   'U1 cre no project');

-- Already project-joined tables (NOT NULL project_id): regression coverage only.
INSERT INTO characters (id, project_id, user_id, name) VALUES
  ('e4000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'U1 char');
INSERT INTO folders (id, project_id, name) VALUES
  ('e5000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', 'U1 folder');

-- Jobs: the one carve-out in today's rules is "public AND completed".
INSERT INTO jobs (id, workflow_id, user_id, status, is_public) VALUES
  ('f0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'completed', true),
  ('f0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'pending',   true),
  ('f0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'completed', false);

-- ------------------------------------------------ structural (as postgres)
SELECT pg_temp.assert_eq('workflow_collaborators has RLS enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'workflow_collaborators'), 'true');
-- [moves in part c] the collaborator routes add a client policy.
SELECT pg_temp.assert_eq('workflow_collaborators has NO client policy yet',
  (SELECT count(*)::text FROM pg_policies WHERE tablename = 'workflow_collaborators'), '0');
SELECT pg_temp.assert_eq('workspaces.default_project_id has its FK, defined as intended',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'fk_workspaces_default_project' AND conrelid = 'workspaces'::regclass),
  'FOREIGN KEY (default_project_id) REFERENCES projects(id) ON DELETE SET NULL');
SELECT pg_temp.assert_eq('every new scope column is NULL on every existing row',
  ((SELECT count(*) FROM workflows           WHERE workspace_id IS NOT NULL)
 + (SELECT count(*) FROM projects            WHERE workspace_id IS NOT NULL)
 + (SELECT count(*) FROM api_tokens          WHERE workspace_id IS NOT NULL)
 + (SELECT count(*) FROM jobs                WHERE workspace_id IS NOT NULL OR org_id IS NOT NULL)
 + (SELECT count(*) FROM workflow_executions WHERE workspace_id IS NOT NULL OR org_id IS NOT NULL)
 + (SELECT count(*) FROM usage_logs          WHERE workspace_id IS NOT NULL OR org_id IS NOT NULL))::text, '0');
-- The CHECKs exist (an ADD COLUMN IF NOT EXISTS would silently keep an older
-- definition; the default alone cannot tell the difference).
DO $$ BEGIN
  UPDATE workflows SET visibility = 'public' WHERE id = 'd0000000-0000-4000-8000-000000000101';
  RAISE EXCEPTION 'ASSERT FAIL: the visibility CHECK does not exist';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  visibility is constrained to private/workspace';
END $$;
DO $$ BEGIN
  UPDATE workflows SET source_kind = 'magic' WHERE id = 'd0000000-0000-4000-8000-000000000101';
  RAISE EXCEPTION 'ASSERT FAIL: the source_kind CHECK does not exist';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  source_kind is constrained to its five kinds';
END $$;
SELECT pg_temp.assert_eq('new workflow columns default to private / no provenance',
  (SELECT visibility || '|' || coalesce(source_kind, '-') FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000101'), 'private|-');

DO $$ BEGIN
  INSERT INTO workflow_collaborators (workflow_id, user_id, role)
    VALUES ('d0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'editor');
  RAISE EXCEPTION 'ASSERT FAIL: creator accepted as their own collaborator';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'SELF_COLLABORATOR%' THEN RAISE NOTICE 'ok  the creator cannot be their own collaborator';
  ELSE RAISE; END IF;
END $$;
INSERT INTO workflow_collaborators (workflow_id, user_id, role)
  VALUES ('d0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', 'viewer');
SELECT pg_temp.assert_eq('a grant to another user is accepted (service role)',
  (SELECT count(*)::text FROM workflow_collaborators), '1');

-- ----------------------------------------------------- U1: the owner
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';

SELECT pg_temp.assert_eq('U1 sees exactly their own projects',   (SELECT count(*)::text FROM projects  WHERE name LIKE 'U%'), '2');
SELECT pg_temp.assert_eq('U1 sees exactly their own workflows',  (SELECT count(*)::text FROM workflows WHERE name LIKE 'U%'), '4');
SELECT pg_temp.assert_eq('U1 sees all three of their locations, the project-less and the cross-user one included',
  (SELECT count(*)::text FROM locations WHERE name LIKE 'U%'), '3');
SELECT pg_temp.assert_eq('U1 sees both objects',   (SELECT count(*)::text FROM objects   WHERE name LIKE 'U%'), '2');
SELECT pg_temp.assert_eq('U1 sees both creatures', (SELECT count(*)::text FROM creatures WHERE name LIKE 'U%'), '2');
SELECT pg_temp.assert_eq('U1 sees their character via the project', (SELECT count(*)::text FROM characters WHERE name LIKE 'U%'), '1');
SELECT pg_temp.assert_eq('U1 sees their folder via the project',    (SELECT count(*)::text FROM folders    WHERE name LIKE 'U%'), '1');
SELECT pg_temp.assert_eq('U1 sees all three of their jobs', (SELECT count(*)::text FROM jobs WHERE id::text LIKE 'f0000000%'), '3');
-- [moves in part c] with a client policy, U1 sees the grants on their own workflow.
SELECT pg_temp.assert_eq('U1 cannot see the collaborators table (no client policy)',
  (SELECT count(*)::text FROM workflow_collaborators), '0');

-- writes: own rows yes, another user's rows no (0 rows, never an error)
WITH u AS (UPDATE workflows SET name = 'U1 wf plain (renamed)' WHERE id = 'd0000000-0000-4000-8000-000000000101' RETURNING 1)
  SELECT pg_temp.assert_eq('U1 can rename their own workflow', (SELECT count(*)::text FROM u), '1');
WITH u AS (UPDATE workflows SET name = 'hijack' WHERE id = 'd0000000-0000-4000-8000-000000000201' RETURNING 1)
  SELECT pg_temp.assert_eq('U1 cannot touch U2''s workflow (0 rows, no error)', (SELECT count(*)::text FROM u), '0');
WITH u AS (UPDATE locations SET name = 'U1 loc no project (renamed)' WHERE id = 'e1000000-0000-4000-8000-000000000102' RETURNING 1)
  SELECT pg_temp.assert_eq('U1 can edit their project-less location', (SELECT count(*)::text FROM u), '1');
WITH d AS (DELETE FROM objects WHERE id = 'e2000000-0000-4000-8000-000000000102' RETURNING 1)
  SELECT pg_temp.assert_eq('U1 can delete their project-less object', (SELECT count(*)::text FROM d), '1');
RESET ROLE;

-- ----------------------------------------------------- U2: the other owner
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000102';

SELECT pg_temp.assert_eq('U2 sees exactly their own project',  (SELECT count(*)::text FROM projects  WHERE name LIKE 'U%'), '1');
-- [moves in part c] U2 holds a viewer grant on U1's workflow: 1 -> 2.
SELECT pg_temp.assert_eq('U2 sees exactly their own workflow', (SELECT count(*)::text FROM workflows WHERE name LIKE 'U%'), '1');
SELECT pg_temp.assert_eq('U2 does NOT see U1''s location that sits in U2''s project (today''s rule: creator only)',
  (SELECT count(*)::text FROM locations WHERE name LIKE 'U%'), '0');
SELECT pg_temp.assert_eq('U2 sees only the public completed job of U1''s',
  (SELECT count(*)::text FROM jobs WHERE id::text LIKE 'f0000000%'), '1');
WITH u AS (UPDATE workflows SET name = 'hijack' WHERE id = 'd0000000-0000-4000-8000-000000000101' RETURNING 1)
  SELECT pg_temp.assert_eq('U2 cannot touch U1''s workflow', (SELECT count(*)::text FROM u), '0');
RESET ROLE;

-- ----------------------------------------------------- U4: belongs to nothing
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000104';

SELECT pg_temp.assert_eq('U4 sees no projects',  (SELECT count(*)::text FROM projects  WHERE name LIKE 'U%'), '0');
SELECT pg_temp.assert_eq('U4 sees no workflows', (SELECT count(*)::text FROM workflows WHERE name LIKE 'U%'), '0');
SELECT pg_temp.assert_eq('U4 sees no entities',
  ((SELECT count(*) FROM locations WHERE name LIKE 'U%') + (SELECT count(*) FROM objects WHERE name LIKE 'U%') + (SELECT count(*) FROM creatures WHERE name LIKE 'U%'))::text, '0');
SELECT pg_temp.assert_eq('U4 sees exactly the public completed job',
  (SELECT count(*)::text FROM jobs WHERE id::text LIKE 'f0000000%'), '1');
RESET ROLE;

-- ----------------------------------------------------- U3: platform admin
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000103';

SELECT pg_temp.assert_eq('platform admin reads every workflow', (SELECT count(*)::text FROM workflows WHERE name LIKE 'U%'), '5');
SELECT pg_temp.assert_eq('platform admin reads every project',  (SELECT count(*)::text FROM projects  WHERE name LIKE 'U%'), '3');
RESET ROLE;

-- ----------------------------------------------------- account deletion
-- Exercised as postgres: the re-parent trigger (part b) and anything later
-- that hangs off profiles DELETE must not make this raise.
DELETE FROM profiles WHERE id = '00000000-0000-4000-8000-000000000104';
SELECT pg_temp.assert_eq('deleting an account with no content succeeds',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000104'), '0');

-- ----------------------------------------------------- assets untouched
-- assets is personal-only and no organizations migration may touch it. Pinned
-- as LITERAL text captured from the catalog, compared exactly — a snapshot
-- taken in the same transaction could only ever equal itself.
SELECT pg_temp.assert_eq('assets still has exactly its four policies',
  (SELECT array_agg(policyname ORDER BY policyname)::text FROM pg_policies WHERE tablename = 'assets'),
  '{"Users can delete own assets or admins can delete library","Users can insert assets with restrictions","Users can update own assets or admins can update library","Users can view own and shared assets"}');
SELECT pg_temp.assert_eq('the assets SELECT predicate is unchanged',
  (SELECT qual FROM pg_policies WHERE tablename = 'assets' AND cmd = 'SELECT'),
  '((user_id = ( SELECT auth.uid() AS uid)) OR (is_shared = true) OR (is_library_item = true) OR is_admin())');

-- ---------------------------------------------- part b: triggers and backfills
-- Everything below is a no-op on today's data, and that is exactly what is
-- being pinned: the triggers exist, they are shaped correctly, and on rows
-- with no workspace they change nothing.

-- The project decides the workspace. U1's projects have none, so a workflow
-- created in one derives NULL — no exception, no value invented.
INSERT INTO workflows (id, user_id, project_id, name)
  VALUES ('d0000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000101',
          'c0000000-0000-4000-8000-000000000101', 'U1 wf derived');
SELECT pg_temp.assert_eq('a workflow in a workspace-less project derives NULL, without raising',
  (SELECT COALESCE(workspace_id::text, 'NULL') FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000131'), 'NULL');

-- A client-supplied workspace_id is DISCARDED, not trusted. This is the whole
-- point of deriving rather than accepting: the column is not forgeable even by
-- a writer that bypasses RLS entirely.
UPDATE workflows SET workspace_id = '00000000-0000-4000-8000-0000000000ff'
 WHERE id = 'd0000000-0000-4000-8000-000000000131';
SELECT pg_temp.assert_eq('a client-supplied workspace_id is overwritten from the project',
  (SELECT COALESCE(workspace_id::text, 'NULL') FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000131'), 'NULL');

-- The backfill filled created_by for every pre-existing row. The fixture rows
-- were inserted after the migration ran, so assert the STATEMENT's effect
-- rather than the migration's: a row with created_by NULL gets its user_id.
UPDATE workflows SET created_by = NULL WHERE id = 'd0000000-0000-4000-8000-000000000131';
UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;
SELECT pg_temp.assert_eq('the backfill statement fills created_by from user_id',
  (SELECT (created_by = user_id)::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000131'), 'true');

-- The jobs clamp does NOT fire on a workspace-less job: a public completed job
-- stays public. Every job on the platform today is this shape.
INSERT INTO jobs (id, user_id, status, is_public, job_type)
  VALUES ('f0000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000101', 'pending', true, 'test');
UPDATE jobs SET status = 'completed', is_public = true WHERE id = 'f0000000-0000-4000-8000-000000000131';
SELECT pg_temp.assert_eq('a job with no workspace keeps is_public — the clamp did not fire',
  (SELECT is_public::text FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000131'), 'true');
SELECT pg_temp.assert_eq('...and force_private is untouched',
  (SELECT COALESCE(force_private::text, 'NULL') FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000131'), 'NULL');

-- The clamp is affordable only because of its WHEN clause: without it every
-- one of the tens of thousands of job writes enters PL/pgSQL. The assertion
-- above cannot see the difference — it passes either way — so pin the clause
-- itself. pg_get_triggerdef, never pg_trigger.tgqual, which is an internal
-- node tree with no stable text form.
SELECT pg_temp.assert_eq('the jobs clamp is gated by a WHEN clause',
  (SELECT (pg_get_triggerdef(oid) LIKE '%WHEN ((new.workspace_id IS NOT NULL))%')::text
     FROM pg_trigger WHERE tgname = 'trg_clamp_workspace_job_privacy'), 'true');

-- All four triggers exist, on the right tables, at the right time.
SELECT pg_temp.assert_eq('the four part-b triggers exist',
  (SELECT array_agg(tgname ORDER BY tgname)::text FROM pg_trigger
    WHERE tgname IN ('trg_sync_workflow_workspace','trg_propagate_project_workspace_change',
                     'trg_clamp_workspace_job_privacy','trg_reparent_workspace_content')),
  '{trg_clamp_workspace_job_privacy,trg_propagate_project_workspace_change,trg_reparent_workspace_content,trg_sync_workflow_workspace}');

-- Every definer in this migration names pg_temp. A definer that does not is
-- shadowable by any caller who can create a temporary table.
SELECT pg_temp.assert_eq('every part-b definer pins search_path with pg_temp',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('sync_workflow_workspace','propagate_project_workspace_change','reparent_workspace_content')
      AND prosecdef
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '3');
SELECT pg_temp.assert_eq('the jobs clamp is NOT a definer — it reads no table',
  (SELECT prosecdef::text FROM pg_proc WHERE proname = 'clamp_workspace_job_privacy'), 'false');

-- ---- the triggers doing their job, not merely staying quiet ----------------
-- Everything above proves part b is INERT on today's data, which is what makes
-- it safe to ship. That alone would also pass if the triggers did nothing at
-- all, so here they are made to fire. The rows are created as postgres and
-- removed by the transaction's ROLLBACK; no organization survives this file.

INSERT INTO organizations (id, slug, name, kind, owner_user_id, status)
  VALUES ('a0000000-0000-4000-8000-000000000141', 'proof-org-b', 'Proof Org', 'school',
          '00000000-0000-4000-8000-000000000101', 'active');
INSERT INTO workspaces (id, org_id, name, slug)
  VALUES ('b0000000-0000-4000-8000-000000000141', 'a0000000-0000-4000-8000-000000000141', 'Proof Class', 'proof-class');
INSERT INTO projects (id, user_id, name, workspace_id)
  VALUES ('c0000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000101',
          'U1 workspace project', 'b0000000-0000-4000-8000-000000000141');

-- sync: a workflow created in a workspace project derives that workspace.
INSERT INTO workflows (id, user_id, project_id, name)
  VALUES ('d0000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000101',
          'c0000000-0000-4000-8000-000000000141', 'U1 wf in workspace');
SELECT pg_temp.assert_eq('a workflow in a workspace project derives that workspace',
  (SELECT workspace_id::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000141'),
  'b0000000-0000-4000-8000-000000000141');

-- sync: and a client cannot overwrite it with another workspace either.
UPDATE workflows SET workspace_id = NULL WHERE id = 'd0000000-0000-4000-8000-000000000141';
SELECT pg_temp.assert_eq('clearing workspace_id by hand is overwritten from the project',
  (SELECT workspace_id::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000141'),
  'b0000000-0000-4000-8000-000000000141');

-- propagate: moving the project out of the workspace re-stamps its workflows.
UPDATE projects SET workspace_id = NULL WHERE id = 'c0000000-0000-4000-8000-000000000141';
SELECT pg_temp.assert_eq('moving a project out of a workspace re-stamps its workflows',
  (SELECT COALESCE(workspace_id::text, 'NULL') FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000141'), 'NULL');

-- propagate: and back in again.
UPDATE projects SET workspace_id = 'b0000000-0000-4000-8000-000000000141'
 WHERE id = 'c0000000-0000-4000-8000-000000000141';
SELECT pg_temp.assert_eq('moving it back re-stamps them again',
  (SELECT workspace_id::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000141'),
  'b0000000-0000-4000-8000-000000000141');

-- clamp: a workspace job is never public, on INSERT...
INSERT INTO jobs (id, user_id, status, is_public, job_type, workspace_id)
  VALUES ('f0000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000101',
          'pending', true, 'test', 'b0000000-0000-4000-8000-000000000141');
SELECT pg_temp.assert_eq('a workspace job is forced private on insert',
  (SELECT (is_public::text || '/' || force_private::text) FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000141'),
  'false/true');

-- ...and on the UPDATE the workers issue when a job completes, which is the
-- write that would otherwise undo an insert-only clamp.
UPDATE jobs SET status = 'completed', is_public = true, force_private = false
 WHERE id = 'f0000000-0000-4000-8000-000000000141';
SELECT pg_temp.assert_eq('and again when the worker republishes it on completion',
  (SELECT (is_public::text || '/' || force_private::text) FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000141'),
  'false/true');

-- re-parent: deleting a member hands their workspace content to the org owner,
-- and leaves their personal content to cascade as it always has.
INSERT INTO projects (id, user_id, name, workspace_id)
  VALUES ('c0000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000102',
          'U2 workspace project', 'b0000000-0000-4000-8000-000000000141');
INSERT INTO workflows (id, user_id, project_id, name)
  VALUES ('d0000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000102',
          'c0000000-0000-4000-8000-000000000142', 'U2 wf in workspace');
DELETE FROM profiles WHERE id = '00000000-0000-4000-8000-000000000102';
SELECT pg_temp.assert_eq('a departed member''s workspace workflow goes to the organization owner',
  (SELECT user_id::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000142'),
  '00000000-0000-4000-8000-000000000101');
SELECT pg_temp.assert_eq('...and so does their workspace project',
  (SELECT user_id::text FROM projects WHERE id = 'c0000000-0000-4000-8000-000000000142'),
  '00000000-0000-4000-8000-000000000101');
SELECT pg_temp.assert_eq('their personal workflow is gone, as it always was',
  (SELECT count(*)::text FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000201'), '0');

-- The autosave path still works. It is the hottest write in the product, and
-- part c changes its predicate, so both answers are pinned from b onward: the
-- creator is accepted, a stranger is refused. In c the creator must STILL be
-- accepted and the stranger must still be refused; an editor grant is what
-- turns a third case true, and c asserts that one itself.
--
-- The claim must be set explicitly. RESET ROLE above restores the ROLE but
-- NOT request.jwt.claims, so without this the platform admin's claim from the
-- previous block is still live, apply_workflow_delta coalesces auth.uid()
-- ahead of p_user_id, and it looks up a workflow owned by the wrong user.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';
SELECT pg_temp.assert_eq('apply_workflow_delta accepts the creator''s edit',
  (SELECT ok::text FROM apply_workflow_delta(
     'd0000000-0000-4000-8000-000000000101',
     (SELECT version FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000101'),
     '[]'::jsonb, ARRAY[]::text[], '[]'::jsonb, ARRAY[]::text[], NULL,
     '00000000-0000-4000-8000-000000000101')), 'true');

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000102';
SELECT pg_temp.assert_eq('apply_workflow_delta refuses a stranger''s edit',
  (SELECT ok::text FROM apply_workflow_delta(
     'd0000000-0000-4000-8000-000000000101',
     (SELECT version FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000000101'),
     '[]'::jsonb, ARRAY[]::text[], '[]'::jsonb, ARRAY[]::text[], NULL,
     '00000000-0000-4000-8000-000000000102')), 'false');
SET LOCAL request.jwt.claims = '';
SET LOCAL request.jwt.claim.sub = '';

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
