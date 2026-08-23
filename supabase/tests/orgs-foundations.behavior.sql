-- Behavioral proof of 332_orgs_foundations against a REAL Supabase Postgres.
--
-- Runs in one transaction and rolls back, so it is safe on any database that
-- has the migrations applied. It asserts what the RLS policies, the
-- SECURITY DEFINER helpers, the transfer RPC, the invitation trigger and the
-- cascades actually do — as the service role, as several authenticated users
-- (JWT claims emulated), and as anon.
--
-- How to run (throwaway container, same image as community-e2e):
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=pw -p 54329:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:pw@localhost:54329/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-foundations.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test bash -c 'psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql 2>&1 | grep -E "NOTICE|ERROR"'
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
--
-- The tenancy parity CI job wires this in alongside the TypeScript matrix.
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

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@t.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'admin@t.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000003', 'teacher@t.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000004', 'student@t.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000005', 'stranger@t.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000006', 'suspended@t.test','{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000007', 'platform@t.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger', (SELECT count(*)::text FROM profiles WHERE email LIKE '%@t.test'), '7');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000007';

INSERT INTO organizations (id, slug, name, kind, owner_user_id, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'school-a', 'School A', 'school', '00000000-0000-4000-8000-000000000001', 'active'),
  ('a0000000-0000-4000-8000-000000000002', 'team-b',   'Team B',   'team',   '00000000-0000-4000-8000-000000000005', 'active');
INSERT INTO organizations (id, slug, name, kind, owner_user_id) VALUES
  ('a0000000-0000-4000-8000-000000000003', 'pending-c', 'Pending C', 'team', '00000000-0000-4000-8000-000000000005');
SELECT pg_temp.assert_eq('new org defaults to pending', (SELECT status FROM organizations WHERE slug = 'pending-c'), 'pending');
SELECT pg_temp.assert_eq('approval setting seeded true', (SELECT value::text FROM app_settings WHERE key = 'org_creation_requires_approval'), 'true');
INSERT INTO organizations (id, slug, name, kind, owner_user_id, status) VALUES
  ('a0000000-0000-4000-8000-000000000004', 'hr', 'HR', 'team', '00000000-0000-4000-8000-000000000005', 'active');
DO $$ BEGIN RAISE NOTICE 'ok  a two-character organization slug is accepted'; END $$;
DO $$ BEGIN
  INSERT INTO organizations (id, slug, name, kind, owner_user_id) VALUES ('a0000000-0000-4000-8000-000000000005', '-bad-', 'Bad', 'team', '00000000-0000-4000-8000-000000000005');
  RAISE EXCEPTION 'ASSERT FAIL: leading/trailing hyphen slug accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  organization slug CHECK rejects leading/trailing hyphens';
END $$;

INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'admin',  'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'member', 'suspended'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'owner',  'active');

DO $$ BEGIN
  INSERT INTO organization_members (org_id, user_id, role) VALUES ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'owner');
  RAISE EXCEPTION 'ASSERT FAIL: second owner accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  single-owner index rejects a second owner';
END $$;

INSERT INTO workspaces (id, org_id, name, slug) VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Class 1', 'class-1');
DO $$ BEGIN
  INSERT INTO workspaces (org_id, name, slug) VALUES ('a0000000-0000-4000-8000-000000000001', 'Bad', '  NOT a slug!! ');
  RAISE EXCEPTION 'ASSERT FAIL: garbage workspace slug accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  workspace slug CHECK rejects garbage';
END $$;
INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'admin',  'active'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'member', 'active');

DO $$ BEGIN
  INSERT INTO workspace_members (workspace_id, org_id, user_id, role) VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'member');
  RAISE EXCEPTION 'ASSERT FAIL: cross-org workspace membership accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok  composite FK rejects a workspace membership in another org';
END $$;
DO $$ BEGIN
  INSERT INTO workspace_members (workspace_id, org_id, user_id, role) VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'member');
  RAISE EXCEPTION 'ASSERT FAIL: non-org-member workspace membership accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok  composite FK requires org membership first';
END $$;

INSERT INTO workspace_join_codes (workspace_id, code, enabled) VALUES ('b0000000-0000-4000-8000-000000000001', 'BCDF2345', true);
DO $$ BEGIN
  INSERT INTO workspace_join_codes (workspace_id, code) VALUES ('b0000000-0000-4000-8000-000000000001', 'abcd1234');
  RAISE EXCEPTION 'ASSERT FAIL: bad join code accepted';
EXCEPTION WHEN check_violation OR unique_violation THEN RAISE NOTICE 'ok  join-code CHECK rejects lowercase/vowels';
END $$;

INSERT INTO invitations (org_id, workspace_id, email, org_role, workspace_role, token_hash, invited_by)
VALUES ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'stranger@t.test', 'member', 'member', 'hash-1', '00000000-0000-4000-8000-000000000003');
DO $$ BEGIN
  INSERT INTO invitations (org_id, email, org_role, token_hash, invited_by)
  VALUES ('a0000000-0000-4000-8000-000000000001', 'x@t.test', 'admin', 'hash-2', '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'ASSERT FAIL: workspace admin could invite an org admin';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  trigger blocks org_role=admin from a workspace-only admin';
END $$;
DO $$ BEGIN
  INSERT INTO invitations (org_id, email, org_role, token_hash, invited_by)
  VALUES ('a0000000-0000-4000-8000-000000000001', 'y@t.test', 'admin', 'hash-3', NULL);
  RAISE EXCEPTION 'ASSERT FAIL: NULL inviter could invite an org admin';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  trigger blocks org_role=admin with no inviter';
END $$;
INSERT INTO invitations (org_id, email, org_role, token_hash, invited_by)
VALUES ('a0000000-0000-4000-8000-000000000001', 'z@t.test', 'admin', 'hash-4', '00000000-0000-4000-8000-000000000002');
DO $$ BEGIN RAISE NOTICE 'ok  org admin may invite an org admin'; END $$;
DO $$ BEGIN
  INSERT INTO invitations (org_id, workspace_id, email, token_hash, invited_by)
  VALUES ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'stranger@t.test', 'hash-5', '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'ASSERT FAIL: duplicate open invitation accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  one open invitation per (org, email, workspace)';
END $$;
UPDATE invitations SET revoked_at = now() WHERE token_hash = 'hash-1';
INSERT INTO invitations (org_id, workspace_id, email, token_hash, invited_by)
VALUES ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'stranger@t.test', 'hash-6', '00000000-0000-4000-8000-000000000003');
DO $$ BEGIN RAISE NOTICE 'ok  a revoked invitation frees the slot'; END $$;
DO $$ BEGIN
  INSERT INTO invitations (org_id, workspace_id, email, token_hash, invited_by)
  VALUES ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'cross@t.test', 'hash-7', '00000000-0000-4000-8000-000000000005');
  RAISE EXCEPTION 'ASSERT FAIL: invitation to another org''s workspace accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok  composite FK rejects an invitation to another org''s workspace';
END $$;
DO $$ BEGIN
  UPDATE invitations SET org_role = 'admin' WHERE token_hash = 'hash-6';
  RAISE EXCEPTION 'ASSERT FAIL: UPDATE escalated org_role past the guard';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  the escalation guard fires on UPDATE too';
END $$;

INSERT INTO organization_audit_log (org_id, actor_id, action) VALUES ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'org.member.invited');

-- ------------------------------------------- helpers as the service role
SELECT pg_temp.assert_eq('org_role owner',  org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'owner');
SELECT pg_temp.assert_eq('org_role admin',  org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'), 'admin');
SELECT pg_temp.assert_eq('org_role none',   org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005'), NULL);
SELECT pg_temp.assert_eq('org_role suspended member still has a role', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006'), 'member');
SELECT pg_temp.assert_eq('org_member_status suspended', org_member_status('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006'), 'suspended');
SELECT pg_temp.assert_eq('workspace_role implicit admin (owner)', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'admin');
SELECT pg_temp.assert_eq('workspace_role implicit admin (org admin)', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'), 'admin');
SELECT pg_temp.assert_eq('workspace_role explicit admin', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'), 'admin');
SELECT pg_temp.assert_eq('workspace_role member', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004'), 'member');
SELECT pg_temp.assert_eq('workspace_role stranger', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005'), NULL);
SELECT pg_temp.assert_eq('workspace_member_status implicit admin active', workspace_member_status('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'active');
SELECT pg_temp.assert_eq('workspace_member_status org-suspended member', workspace_member_status('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006'), 'suspended');
SELECT pg_temp.assert_eq('workspace_member_status stranger', workspace_member_status('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005'), NULL);
SELECT pg_temp.assert_eq('effective_setting preset', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"edit"');
UPDATE organizations SET settings = '{"admin_access":"view"}' WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('effective_setting org override', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"view"');
UPDATE workspaces SET settings = '{"admin_access":"edit","members_can_create_projects":false}' WHERE id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('effective_setting workspace override', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"edit"');
SELECT pg_temp.assert_eq('ws_setting_bool false override is false', ws_setting_bool('b0000000-0000-4000-8000-000000000001', 'members_can_create_projects')::text, 'false');
SELECT pg_temp.assert_eq('ws_setting_bool preset true', ws_setting_bool('b0000000-0000-4000-8000-000000000001', 'workspace_admins_can_invite')::text, 'true');
SELECT pg_temp.assert_eq('ws_setting_bool unknown key', ws_setting_bool('b0000000-0000-4000-8000-000000000001', 'no_such_key')::text, 'false');
UPDATE workspaces SET settings = '{"admin_access": null, "member_caps_enabled": "yes"}' WHERE id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('effective_setting: a JSON null override falls through to the org override', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"view"');
SELECT pg_temp.assert_eq('ws_setting_bool: a non-boolean value is false, not a cast error', ws_setting_bool('b0000000-0000-4000-8000-000000000001', 'member_caps_enabled')::text, 'false');
UPDATE workspaces SET settings = '{"admin_access":"edit","members_can_create_projects":false}' WHERE id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('kind_preset team', kind_preset('team')->>'admin_access', 'view');

-- ---------------------------------------------- transfer_org_ownership
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'ASSERT FAIL: non-owner transferred';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'NOT_OWNER:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: NOT_OWNER'; END $$;
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'ASSERT FAIL: member became owner';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'TARGET_NOT_ADMIN:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: TARGET_NOT_ADMIN'; END $$;
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'ASSERT FAIL: stranger became owner';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'TARGET_NOT_MEMBER:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: TARGET_NOT_MEMBER'; END $$;
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'ASSERT FAIL: self transfer';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'SAME_OWNER:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: SAME_OWNER'; END $$;
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'ASSERT FAIL: missing org';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'ORG_NOT_FOUND:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: ORG_NOT_FOUND'; END $$;
UPDATE organization_members SET status = 'suspended' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000002';
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'ASSERT FAIL: suspended admin became owner';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'TARGET_SUSPENDED:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: TARGET_SUSPENDED'; END $$;
UPDATE organization_members SET status = 'active' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_eq('transfer returns previous owner', transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')::text, '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_eq('owner pointer moved', (SELECT owner_user_id::text FROM organizations WHERE id = 'a0000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_eq('new owner row', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'), 'owner');
SELECT pg_temp.assert_eq('old owner demoted to admin', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'admin');
SELECT pg_temp.assert_eq('transfer back works', transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001')::text, '00000000-0000-4000-8000-000000000002');
UPDATE organizations SET status = 'suspended' WHERE id = 'a0000000-0000-4000-8000-000000000001';
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'ASSERT FAIL: suspended org transferred';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'ORG_NOT_TRANSFERABLE:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: ORG_NOT_TRANSFERABLE'; END $$;
UPDATE organizations SET status = 'active' WHERE id = 'a0000000-0000-4000-8000-000000000001';
UPDATE organization_members SET status = 'suspended' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000001';
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'ASSERT FAIL: suspended owner transferred';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'ACTOR_SUSPENDED:%' THEN RAISE; END IF; RAISE NOTICE 'ok  transfer: ACTOR_SUSPENDED'; END $$;
UPDATE organization_members SET status = 'active' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000001';
-- Drift: the owner pointer says U2 while U1 still holds the owner row. A
-- transfer by the pointer-owner must demote the ROW owner, not collide.
UPDATE organizations SET owner_user_id = '00000000-0000-4000-8000-000000000002' WHERE id = 'a0000000-0000-4000-8000-000000000001';
UPDATE organization_members SET role = 'admin' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_eq('transfer heals a drifted owner pointer', transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003')::text, '00000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_eq('drift: row owner demoted', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'admin');
SELECT pg_temp.assert_eq('drift: exactly one owner row', (SELECT count(*)::text FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND role = 'owner'), '1');
SELECT pg_temp.assert_eq('drift: target is the owner', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'), 'owner');
-- restore the fixture: U1 owner, U2 admin, U3 member
SELECT transfer_org_ownership('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001');
UPDATE organization_members SET role = 'member' WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_eq('fixture restored', org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001') || '/' || org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002') || '/' || org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'), 'owner/admin/member');

-- ------------------------------------------------ RLS as authenticated
-- student (U4): member of class-1
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_eq('student: auth.uid() resolves', auth.uid()::text, '00000000-0000-4000-8000-000000000004');
SELECT pg_temp.assert_eq('student sees own org only', (SELECT count(*)::text FROM organizations), '1');
SELECT pg_temp.assert_eq('student sees own workspace', (SELECT count(*)::text FROM workspaces), '1');
SELECT pg_temp.assert_eq('student sees only own workspace_members row', (SELECT count(*)::text FROM workspace_members), '1');
SELECT pg_temp.assert_eq('student sees only own organization_members row', (SELECT count(*)::text FROM organization_members), '1');
SELECT pg_temp.assert_eq('student cannot see join codes', (SELECT count(*)::text FROM workspace_join_codes), '0');
SELECT pg_temp.assert_eq('student cannot see invitations', (SELECT count(*)::text FROM invitations), '0');
SELECT pg_temp.assert_eq('student cannot see audit log', (SELECT count(*)::text FROM organization_audit_log), '0');
SELECT pg_temp.assert_eq('auth.uid() wins over p_user_id (no impersonation)', workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'), 'member');
SELECT pg_temp.assert_eq('a member can read the effective settings', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"edit"');
DO $$ BEGIN
  INSERT INTO invitations (org_id, email, token_hash) VALUES ('a0000000-0000-4000-8000-000000000001', 'evil@t.test', 'hash-evil');
  RAISE EXCEPTION 'ASSERT FAIL: client could insert an invitation';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  no client INSERT policy on invitations';
END $$;
DO $$ BEGIN
  UPDATE organization_members SET role = 'owner' WHERE user_id = auth.uid();
  IF FOUND THEN RAISE EXCEPTION 'ASSERT FAIL: client could update a membership'; END IF;
  RAISE NOTICE 'ok  no client UPDATE policy on organization_members (0 rows)';
END $$;
DO $$ BEGIN PERFORM transfer_org_ownership('a0000000-0000-4000-8000-000000000001', auth.uid(), auth.uid()); RAISE EXCEPTION 'ASSERT FAIL: client could call transfer RPC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  transfer RPC denied to authenticated'; END $$;
RESET ROLE;

-- teacher (U3): explicit workspace admin, plain org member
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_eq('teacher sees all workspace_members of the class', (SELECT count(*)::text FROM workspace_members), '3');
SELECT pg_temp.assert_eq('teacher sees the join code', (SELECT count(*)::text FROM workspace_join_codes), '1');
SELECT pg_temp.assert_eq('teacher sees class invitations only', (SELECT count(*)::text FROM invitations), '2');
SELECT pg_temp.assert_eq('teacher sees only own organization_members row', (SELECT count(*)::text FROM organization_members), '1');
SELECT pg_temp.assert_eq('teacher cannot see the audit log', (SELECT count(*)::text FROM organization_audit_log), '0');
RESET ROLE;

-- org admin (U2): implicit admin everywhere
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_eq('org admin sees every organization_members row', (SELECT count(*)::text FROM organization_members), '5');
SELECT pg_temp.assert_eq('org admin sees the audit log', (SELECT count(*)::text FROM organization_audit_log), '1');
SELECT pg_temp.assert_eq('org admin sees all invitations', (SELECT count(*)::text FROM invitations), '3');
SELECT pg_temp.assert_eq('org admin sees the join code (implicit admin)', (SELECT count(*)::text FROM workspace_join_codes), '1');
SELECT pg_temp.assert_eq('org admin sees the workspace', (SELECT count(*)::text FROM workspaces), '1');
RESET ROLE;

-- stranger (U5): owner of team-b, invited by email to school-a. The profile
-- email is deliberately mixed-case: the invitee policy must normalize it.
UPDATE profiles SET email = 'Stranger@T.TEST' WHERE id = '00000000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('stranger sees only own orgs (team-b + pending-c? no membership row for pending-c)', (SELECT count(*)::text FROM organizations), '1');
SELECT pg_temp.assert_eq('stranger sees no school workspaces', (SELECT count(*)::text FROM workspaces), '0');
SELECT pg_temp.assert_eq('a non-member cannot read another workspace''s settings', (effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access') IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('a non-member cannot probe a workspace''s existence through settings', (effective_setting('b0000000-0000-4000-8000-0000000000ff', 'admin_access') IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('invitee sees invitations addressed to their email (case-insensitive)', (SELECT count(*)::text FROM invitations), '2');
RESET ROLE;
UPDATE organizations SET status = 'deleted', deleted_at = now() WHERE id = 'a0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('a soft-deleted organization is hidden from its members', (SELECT count(*)::text FROM organizations), '0');
RESET ROLE;
UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = 'a0000000-0000-4000-8000-000000000002';

-- suspended member (U6): still sees the org and the class (status is a separate fact)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';
SELECT pg_temp.assert_eq('suspended member still sees the org', (SELECT count(*)::text FROM organizations), '1');
SELECT pg_temp.assert_eq('suspended member still sees the class', (SELECT count(*)::text FROM workspaces), '1');
RESET ROLE;

-- platform admin (U7)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000007';
SELECT pg_temp.assert_eq('platform admin sees every org', (SELECT count(*)::text FROM organizations), '4');
SELECT pg_temp.assert_eq('platform admin reads any workspace''s settings', effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access')::text, '"edit"');
SELECT pg_temp.assert_eq('platform admin sees join codes', (SELECT count(*)::text FROM workspace_join_codes), '1');
SELECT pg_temp.assert_eq('platform admin sees the audit log', (SELECT count(*)::text FROM organization_audit_log), '1');
RESET ROLE;

-- anon: the oracle is closed
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM workspace_role('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'ASSERT FAIL: anon could call workspace_role';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot call workspace_role'; END $$;
DO $$ BEGIN PERFORM org_role('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'ASSERT FAIL: anon could call org_role';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot call org_role'; END $$;
DO $$ BEGIN PERFORM effective_setting('b0000000-0000-4000-8000-000000000001', 'admin_access'); RAISE EXCEPTION 'ASSERT FAIL: anon could call effective_setting';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot call effective_setting'; END $$;
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM organizations; RAISE EXCEPTION 'ASSERT FAIL: anon read organizations (% rows)', n;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon SELECT on organizations is denied outright'; END $$;
RESET ROLE;

-- ------------------------------------------------------------ cascades
DELETE FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_eq('removing the org membership cascades to the workspace membership', (SELECT count(*)::text FROM workspace_members WHERE user_id = '00000000-0000-4000-8000-000000000004'), '0');
DO $$ BEGIN
  DELETE FROM profiles WHERE id = '00000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'ASSERT FAIL: owner profile deleted despite RESTRICT';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok  deleting an org owner is blocked (RESTRICT)';
END $$;
DELETE FROM workspaces WHERE id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('deleting a workspace cascades join code', (SELECT count(*)::text FROM workspace_join_codes), '0');
SELECT pg_temp.assert_eq('deleting a workspace cascades workspace invitations', (SELECT count(*)::text FROM invitations WHERE workspace_id IS NOT NULL), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
