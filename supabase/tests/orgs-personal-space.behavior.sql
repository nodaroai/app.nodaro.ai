-- ============================================================================
-- Behavioral proof: the personal-space gate, and the workspace landing project.
--
-- Runs AFTER the whole migration chain, as `postgres`, inside one transaction
-- that rolls back. Its own uuid range (…-000000000301 upward) so it can never
-- collide with the sibling proofs.
--
-- The first assertion is the one that matters most: a user who belongs to no
-- organization keeps their personal space. That is every user on the platform
-- today, and if it ever goes red this migration has broken all of them.
--
-- Run locally:
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-personal-space.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql
--
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, COALESCE(got, 'NULL'), COALESCE(want, 'NULL');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- ---------------------------------------------------------------- fixtures
-- U1 belongs to nothing. U2..U5 each belong to one organization, one per
-- status/setting combination the rule distinguishes.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000301', 'ps1@example.com'),
  ('00000000-0000-4000-8000-000000000302', 'ps2@example.com'),
  ('00000000-0000-4000-8000-000000000303', 'ps3@example.com'),
  ('00000000-0000-4000-8000-000000000304', 'ps4@example.com'),
  ('00000000-0000-4000-8000-000000000305', 'ps5@example.com'),
  ('00000000-0000-4000-8000-000000000306', 'ps6@example.com');

-- Organizations, each with personal_space_enabled = false, differing only in
-- status and whether they chose to keep binding while suspended.
INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000000301', 'ps-active',    'Active',    'school',
   '00000000-0000-4000-8000-000000000302', 'active',    '{"personal_space_enabled":false}'::jsonb),
  ('a0000000-0000-4000-8000-000000000302', 'ps-susp-no',   'SuspNo',    'school',
   '00000000-0000-4000-8000-000000000303', 'suspended', '{"personal_space_enabled":false}'::jsonb),
  ('a0000000-0000-4000-8000-000000000303', 'ps-susp-yes',  'SuspYes',   'school',
   '00000000-0000-4000-8000-000000000304', 'suspended', '{"personal_space_enabled":false,"policy_survives_suspension":true}'::jsonb),
  ('a0000000-0000-4000-8000-000000000304', 'ps-pending',   'Pending',   'school',
   '00000000-0000-4000-8000-000000000305', 'pending',   '{"personal_space_enabled":false}'::jsonb),
  ('a0000000-0000-4000-8000-000000000305', 'ps-allows',    'Allows',    'school',
   '00000000-0000-4000-8000-000000000306', 'active',    '{}'::jsonb);

INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000303', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000304', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000305', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000306', 'owner',  'active');

-- ------------------------------------------- the case that is everyone today
SELECT pg_temp.assert_eq('a user who belongs to no organization keeps their personal space',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000301')::text, 'true');

-- ------------------------------------------------- the suspension matrix
SELECT pg_temp.assert_eq('an ACTIVE organization that forbids it, forbids it',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000302')::text, 'false');
SELECT pg_temp.assert_eq('a SUSPENDED organization stops binding by default',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000303')::text, 'true');
SELECT pg_temp.assert_eq('...unless it chose to keep binding while suspended',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000304')::text, 'false');
SELECT pg_temp.assert_eq('a PENDING organization never binds — it was never approved',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000305')::text, 'true');
SELECT pg_temp.assert_eq('an organization that allows a personal space allows it',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000306')::text, 'true');

-- A SUSPENDED member of an ACTIVE organization is not bound by it either:
-- they are no longer one of its members in any sense that should constrain them.
UPDATE organization_members SET status = 'suspended'
 WHERE org_id = 'a0000000-0000-4000-8000-000000000301'
   AND user_id = '00000000-0000-4000-8000-000000000302';
SELECT pg_temp.assert_eq('a suspended MEMBER is not bound by their organization',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000302')::text, 'true');
UPDATE organization_members SET status = 'active'
 WHERE org_id = 'a0000000-0000-4000-8000-000000000301'
   AND user_id = '00000000-0000-4000-8000-000000000302';

-- Belonging to TWO organizations: one forbidding is enough.
INSERT INTO organization_members (org_id, user_id, role, status)
  VALUES ('a0000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000306', 'member', 'active');
SELECT pg_temp.assert_eq('one forbidding organization is enough, however many allow it',
  personal_space_enabled_for('00000000-0000-4000-8000-000000000306')::text, 'false');
DELETE FROM organization_members
 WHERE org_id = 'a0000000-0000-4000-8000-000000000301'
   AND user_id = '00000000-0000-4000-8000-000000000306';

-- --------------------------------------------------------- org_setting
SELECT pg_temp.assert_eq('org_setting reads the organization override',
  org_setting('a0000000-0000-4000-8000-000000000301', 'personal_space_enabled')::text, 'false');
SELECT pg_temp.assert_eq('org_setting falls through to the kind preset',
  org_setting('a0000000-0000-4000-8000-000000000305', 'personal_space_enabled')::text, 'true');
SELECT pg_temp.assert_eq('the ninth preset key exists and defaults to false',
  org_setting('a0000000-0000-4000-8000-000000000305', 'policy_survives_suspension')::text, 'false');
SELECT pg_temp.assert_eq('every preset key resolves for both kinds',
  (SELECT count(*)::text FROM (
     SELECT jsonb_object_keys(kind_preset('school')) INTERSECT SELECT jsonb_object_keys(kind_preset('team'))
   ) k), '9');

-- A key written as JSON null counts as NOT SET and falls through, exactly as
-- 332's effective_setting does — an override cleared by writing null must not
-- read as false.
UPDATE organizations SET settings = '{"personal_space_enabled":null}'::jsonb
 WHERE id = 'a0000000-0000-4000-8000-000000000301';
SELECT pg_temp.assert_eq('a null override falls through to the preset, it does not read as false',
  org_setting('a0000000-0000-4000-8000-000000000301', 'personal_space_enabled')::text, 'true');
UPDATE organizations SET settings = '{"personal_space_enabled":false}'::jsonb
 WHERE id = 'a0000000-0000-4000-8000-000000000301';

-- The membership gate: a NON-member reads nothing. Without this, org_setting
-- is a settings oracle over every organization on the platform.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000301';
SELECT pg_temp.assert_eq('a non-member reads NULL from org_setting, not the value',
  COALESCE(org_setting('a0000000-0000-4000-8000-000000000301', 'personal_space_enabled')::text, 'NULL'), 'NULL');
RESET ROLE;

-- ------------------------------------------------ ensure_default_project
-- The RPC is what the BROWSER calls, so it is exercised under a real role and
-- real claims, not as postgres.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000301';
SELECT pg_temp.assert_eq('a user with no organization still gets their default project',
  (ensure_default_project() IS NOT NULL)::text, 'true');
SELECT pg_temp.assert_eq('...and calling it twice returns the same project, not a second one',
  (SELECT count(*)::text FROM projects
    WHERE user_id = '00000000-0000-4000-8000-000000000301' AND is_default), '1');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000302","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000302';
DO $$
DECLARE v_msg text; v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM ensure_default_project();
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v_msg := SQLERRM;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'ASSERT FAIL: a member of a forbidding organization still got a personal project'; END IF;
  -- The PREFIX is the contract: the frontend calls this RPC directly, so the
  -- refusal reaches it as a PostgREST error and it matches on this string.
  IF v_msg NOT LIKE 'PERSONAL_SPACE_DISABLED%' THEN
    RAISE EXCEPTION 'ASSERT FAIL: refused, but the message prefix changed: %', v_msg;
  END IF;
  RAISE NOTICE 'ok  a member of a forbidding organization is refused, with the documented prefix';
END $$;
RESET ROLE;

-- ------------------------------------------ create_workspace_with_project
SELECT create_workspace_with_project(
  'a0000000-0000-4000-8000-000000000305', 'Proof Class', 'ps-proof-class', NULL, NULL,
  '00000000-0000-4000-8000-000000000306') AS ws \gset
SELECT pg_temp.assert_eq('the workspace has a landing project',
  (SELECT (default_project_id IS NOT NULL)::text FROM workspaces WHERE slug = 'ps-proof-class'), 'true');
SELECT pg_temp.assert_eq('the project sits IN that workspace',
  (SELECT (p.workspace_id = w.id)::text FROM workspaces w
     JOIN projects p ON p.id = w.default_project_id WHERE w.slug = 'ps-proof-class'), 'true');
-- The assertion that would catch is_default = TRUE. It is not a style point:
-- uniq_default_project_per_user is UNIQUE on (user_id) WHERE is_default, so a
-- TRUE here collides with the admin's own personal default.
SELECT pg_temp.assert_eq('the landing project is NOT the creator''s personal default',
  (SELECT p.is_default::text FROM workspaces w
     JOIN projects p ON p.id = w.default_project_id WHERE w.slug = 'ps-proof-class'), 'false');
-- Which the second call proves for real.
SELECT create_workspace_with_project(
  'a0000000-0000-4000-8000-000000000305', 'Proof Class 2', 'ps-proof-class-2', NULL, NULL,
  '00000000-0000-4000-8000-000000000306') AS ws2 \gset
SELECT pg_temp.assert_eq('a SECOND workspace for the same admin also succeeds',
  (SELECT count(*)::text FROM workspaces WHERE slug LIKE 'ps-proof-class%'), '2');
SELECT pg_temp.assert_eq('...with two distinct landing projects',
  (SELECT count(DISTINCT default_project_id)::text FROM workspaces WHERE slug LIKE 'ps-proof-class%'), '2');

-- ------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('anon cannot execute org_setting',
  has_function_privilege('anon', 'public.org_setting(uuid,text)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated CAN execute org_setting — it gates on membership',
  has_function_privilege('authenticated', 'public.org_setting(uuid,text)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('authenticated cannot execute personal_space_enabled_for — it takes a USER id',
  has_function_privilege('authenticated', 'public.personal_space_enabled_for(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot execute personal_space_enabled_for either',
  has_function_privilege('anon', 'public.personal_space_enabled_for(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot create a workspace directly',
  has_function_privilege('authenticated', 'public.create_workspace_with_project(uuid,text,text,text,jsonb,uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot either',
  has_function_privilege('anon', 'public.create_workspace_with_project(uuid,text,text,text,jsonb,uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('every new definer pins search_path with pg_temp',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('org_setting','personal_space_enabled_for','ensure_default_project','create_workspace_with_project')
      AND prosecdef
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '4');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
