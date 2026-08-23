-- Behavioral proof of 333_orgs_invitation_rpcs against a REAL Supabase Postgres.
--
-- Runs in one transaction and rolls back, so it is safe on any database that
-- has the migrations applied. It exercises every refusal prefix of
-- accept_invitation() and join_workspace_by_code(), the two asymmetries the
-- migration header documents (an invitation is consumed even when it changes
-- nothing; a join code never lifts a suspension), idempotency, and the
-- domain allowlist.
--
-- How to run (throwaway container, same image as community-e2e):
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=pw -p 54329:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:pw@localhost:54329/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-invitations.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test bash -c 'psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql 2>&1 | grep -E "NOTICE|ERROR"'
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
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

-- Runs a statement expecting it to fail with a message that STARTS with the
-- given prefix. The EXCEPTION block is a subtransaction, so the failed
-- statement is undone and the outer transaction carries on.
CREATE FUNCTION pg_temp.expect_error(label text, stmt text, prefix text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF left(v_msg, length(prefix)) = prefix THEN
      RAISE NOTICE 'ok  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASSERT FAIL [%]: got "%" expected prefix "%"', label, v_msg, prefix;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: expected an error with prefix "%", got none', label, prefix;
END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@t.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'admin@t.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000003', 'newbie@t.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000004', 'suspended@t.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000005', 'outsider@else.test','{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000006', 'joiner@t.test',    '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger', (SELECT count(*)::text FROM profiles WHERE email IN ('owner@t.test','admin@t.test','newbie@t.test','suspended@t.test','outsider@else.test','joiner@t.test')), '6');

INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'school-a', 'School A', 'school', '00000000-0000-4000-8000-000000000001', 'active', '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'pending-b', 'Pending B', 'team', '00000000-0000-4000-8000-000000000001', 'pending', '{}'),
  ('a0000000-0000-4000-8000-000000000003', 'strict-c', 'Strict C', 'team', '00000000-0000-4000-8000-000000000001', 'active', '{"allowed_email_domains": ["t.test"]}');
INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'admin',  'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'member', 'suspended'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'owner',  'active');
INSERT INTO workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Class 1', 'class-1'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Old Class', 'old-class'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'Pending WS', 'pending-ws'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 'Strict WS', 'strict-ws');
UPDATE workspaces SET archived_at = now() WHERE id = 'b0000000-0000-4000-8000-000000000002';

-- Invitations: token hashes are sha256 of a raw token, as the route stores them.
INSERT INTO invitations (id, org_id, workspace_id, email, org_role, workspace_role, token_hash, invited_by, expires_at, revoked_at, accepted_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'newbie@t.test',    'member', 'member', encode(sha256('tok-open'::bytea), 'hex'),    '00000000-0000-4000-8000-000000000002', now() + interval '14 days', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', NULL,                                   'newbie@t.test',    'member', NULL,     encode(sha256('tok-revoked'::bytea), 'hex'), '00000000-0000-4000-8000-000000000002', now() + interval '14 days', now(), NULL),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', NULL,                                   'joiner@t.test',    'member', NULL,     encode(sha256('tok-expired'::bytea), 'hex'), '00000000-0000-4000-8000-000000000002', now() - interval '1 hour', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', NULL,                                   'newbie@t.test',    'member', NULL,     encode(sha256('tok-pending'::bytea), 'hex'), '00000000-0000-4000-8000-000000000001', now() + interval '14 days', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'admin@t.test',     'member', 'admin',  encode(sha256('tok-existing'::bytea), 'hex'), '00000000-0000-4000-8000-000000000001', now() + interval '14 days', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'suspended@t.test', 'member', 'member', encode(sha256('tok-suspended'::bytea), 'hex'), '00000000-0000-4000-8000-000000000001', now() + interval '14 days', NULL, NULL);

INSERT INTO workspace_join_codes (workspace_id, code, enabled) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'BCDFGHJK', true),
  ('b0000000-0000-4000-8000-000000000002', 'MNPQRSTV', true),
  ('b0000000-0000-4000-8000-000000000003', 'WXYZ2345', true),
  ('b0000000-0000-4000-8000-000000000004', 'QQQQ9999', true);

-- ------------------------------------------------------- accept_invitation
SELECT pg_temp.expect_error('accept: unknown token',
  $q$ SELECT * FROM accept_invitation(encode(sha256('nope'::bytea), 'hex'), '00000000-0000-4000-8000-000000000003', 'newbie@t.test') $q$,
  'INVITATION_NOT_FOUND:');
SELECT pg_temp.expect_error('accept: revoked',
  $q$ SELECT * FROM accept_invitation(encode(sha256('tok-revoked'::bytea), 'hex'), '00000000-0000-4000-8000-000000000003', 'newbie@t.test') $q$,
  'INVITATION_REVOKED:');
SELECT pg_temp.expect_error('accept: expired',
  $q$ SELECT * FROM accept_invitation(encode(sha256('tok-expired'::bytea), 'hex'), '00000000-0000-4000-8000-000000000006', 'joiner@t.test') $q$,
  'INVITATION_EXPIRED:');
SELECT pg_temp.expect_error('accept: email mismatch',
  $q$ SELECT * FROM accept_invitation(encode(sha256('tok-open'::bytea), 'hex'), '00000000-0000-4000-8000-000000000005', 'outsider@else.test') $q$,
  'EMAIL_MISMATCH:');
SELECT pg_temp.expect_error('accept: organization not active',
  $q$ SELECT * FROM accept_invitation(encode(sha256('tok-pending'::bytea), 'hex'), '00000000-0000-4000-8000-000000000003', 'newbie@t.test') $q$,
  'ORG_NOT_ACTIVE:');
SELECT pg_temp.assert_eq('accept: no row was written by the refusals', (SELECT count(*)::text FROM organization_members WHERE user_id = '00000000-0000-4000-8000-000000000003'), '0');

-- Success: the email is matched case-insensitively; both rows are written with the inviter recorded.
SELECT pg_temp.assert_eq('accept: returns the organization and workspace',
  (SELECT org_id::text || '|' || workspace_id::text FROM accept_invitation(encode(sha256('tok-open'::bytea), 'hex'), '00000000-0000-4000-8000-000000000003', 'Newbie@T.TEST')),
  'a0000000-0000-4000-8000-000000000001|b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_eq('accept: organization membership written',
  (SELECT role || '/' || status || '/' || coalesce(invited_by::text, '-') FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000003'),
  'member/active/00000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_eq('accept: workspace membership written',
  (SELECT role || '/' || status || '/' || coalesce(added_by::text, '-') FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000003'),
  'member/active/00000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_eq('accept: the invitation is consumed',
  (SELECT (accepted_at IS NOT NULL)::text || '/' || accepted_by::text FROM invitations WHERE id = 'c0000000-0000-4000-8000-000000000001'),
  'true/00000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_error('accept: a second click is refused',
  $q$ SELECT * FROM accept_invitation(encode(sha256('tok-open'::bytea), 'hex'), '00000000-0000-4000-8000-000000000003', 'newbie@t.test') $q$,
  'INVITATION_ACCEPTED:');

-- An existing member keeps their role: the admin invited as member stays admin,
-- but DOES gain the workspace row the invitation carried.
SELECT pg_temp.assert_eq('accept: existing member — consumed',
  (SELECT (org_id IS NOT NULL)::text FROM accept_invitation(encode(sha256('tok-existing'::bytea), 'hex'), '00000000-0000-4000-8000-000000000002', 'admin@t.test')),
  'true');
SELECT pg_temp.assert_eq('accept: existing member keeps their organization role',
  (SELECT role FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000002'),
  'admin');
SELECT pg_temp.assert_eq('accept: existing member gains the workspace row with the invited role',
  (SELECT role FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000002'),
  'admin');

-- A suspended member accepting: consumed, standing unchanged (asymmetry 1).
SELECT pg_temp.assert_eq('accept: suspended member — consumed',
  (SELECT (org_id IS NOT NULL)::text FROM accept_invitation(encode(sha256('tok-suspended'::bytea), 'hex'), '00000000-0000-4000-8000-000000000004', 'suspended@t.test')),
  'true');
SELECT pg_temp.assert_eq('accept: suspended member stays suspended',
  (SELECT status FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000004'),
  'suspended');
SELECT pg_temp.assert_eq('accept: suspended member got the workspace row (still governed by the org suspension)',
  (SELECT count(*)::text FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000004'),
  '1');
SELECT pg_temp.assert_eq('accept: the suspended member is still suspended in the workspace by the SQL helper',
  (SELECT workspace_member_status('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004')),
  'suspended');

-- A member suspended in the WORKSPACE (their organization standing is fine)
-- accepting an invitation to that same workspace: consumed, standing kept.
INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'member', 'active');
INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'member', 'suspended');
INSERT INTO invitations (id, org_id, workspace_id, email, org_role, workspace_role, token_hash, invited_by, expires_at) VALUES
  ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'outsider@else.test', 'member', 'admin', encode(sha256('tok-ws-suspended'::bytea), 'hex'), '00000000-0000-4000-8000-000000000001', now() + interval '14 days');
SELECT pg_temp.assert_eq('accept: a workspace-suspended member — consumed',
  (SELECT (org_id IS NOT NULL)::text FROM accept_invitation(encode(sha256('tok-ws-suspended'::bytea), 'hex'), '00000000-0000-4000-8000-000000000005', 'outsider@else.test')),
  'true');
SELECT pg_temp.assert_eq('accept: a workspace-suspended member keeps both the role and the suspension',
  (SELECT role || '/' || status FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000005'),
  'member/suspended');

-- --------------------------------------------------- join_workspace_by_code
SELECT pg_temp.expect_error('join: unknown code',
  $q$ SELECT * FROM join_workspace_by_code('ZZZZZZZZ', '00000000-0000-4000-8000-000000000006', 'joiner@t.test') $q$,
  'JOIN_CODE_INVALID:');
UPDATE workspace_join_codes SET enabled = false WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_error('join: disabled code',
  $q$ SELECT * FROM join_workspace_by_code('BCDFGHJK', '00000000-0000-4000-8000-000000000006', 'joiner@t.test') $q$,
  'JOIN_CODE_INVALID:');
UPDATE workspace_join_codes SET enabled = true WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_error('join: archived workspace',
  $q$ SELECT * FROM join_workspace_by_code('MNPQRSTV', '00000000-0000-4000-8000-000000000006', 'joiner@t.test') $q$,
  'JOIN_CODE_INVALID:');
SELECT pg_temp.expect_error('join: organization not active',
  $q$ SELECT * FROM join_workspace_by_code('WXYZ2345', '00000000-0000-4000-8000-000000000006', 'joiner@t.test') $q$,
  'ORG_NOT_ACTIVE:');
SELECT pg_temp.expect_error('join: domain not on the allowlist',
  $q$ SELECT * FROM join_workspace_by_code('QQQQ9999', '00000000-0000-4000-8000-000000000005', 'outsider@else.test') $q$,
  'DOMAIN_NOT_ALLOWED:');
SELECT pg_temp.assert_eq('join: domain on the allowlist is admitted',
  (SELECT workspace_id::text FROM join_workspace_by_code('QQQQ9999', '00000000-0000-4000-8000-000000000006', 'Joiner@T.test')),
  'b0000000-0000-4000-8000-000000000004');
SELECT pg_temp.expect_error('join: a suspended member is refused (asymmetry 2)',
  $q$ SELECT * FROM join_workspace_by_code('BCDFGHJK', '00000000-0000-4000-8000-000000000004', 'suspended@t.test') $q$,
  'MEMBER_SUSPENDED:');
SELECT pg_temp.assert_eq('join: refusals wrote nothing for the suspended member',
  (SELECT status FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000004'),
  'suspended');

-- Success, lower-cased code accepted, both rows written as plain members; a second join changes nothing.
SELECT pg_temp.assert_eq('join: returns the organization and workspace',
  (SELECT org_id::text || '|' || workspace_id::text FROM join_workspace_by_code('bcdfghjk', '00000000-0000-4000-8000-000000000006', 'joiner@t.test')),
  'a0000000-0000-4000-8000-000000000001|b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_eq('join: organization membership as member',
  (SELECT role || '/' || status FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000006'),
  'member/active');
SELECT pg_temp.assert_eq('join: workspace membership as member',
  (SELECT role || '/' || status FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000006'),
  'member/active');
UPDATE workspace_members SET role = 'admin' WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000006';
SELECT pg_temp.assert_eq('join: a second join returns the same workspace',
  (SELECT workspace_id::text FROM join_workspace_by_code('BCDFGHJK', '00000000-0000-4000-8000-000000000006', 'joiner@t.test')),
  'b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_eq('join: the second join changed nothing (the promoted role survives)',
  (SELECT role FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000006'),
  'admin');

-- An owner of the org joining a class by code gets an explicit member row; their org role is untouched.
-- (Two statements on purpose: sub-selects in one expression have no ordering
-- guarantee, so the reads must not share a statement with the call.)
SELECT pg_temp.assert_eq('join: an org owner may use a code',
  (SELECT workspace_id::text FROM join_workspace_by_code('BCDFGHJK', '00000000-0000-4000-8000-000000000001', 'owner@t.test')),
  'b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_eq('join: they gain an explicit workspace row and keep the organization role',
  (SELECT (SELECT role FROM organization_members WHERE org_id = 'a0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000001') || '/' ||
          (SELECT role FROM workspace_members WHERE workspace_id = 'b0000000-0000-4000-8000-000000000001' AND user_id = '00000000-0000-4000-8000-000000000001')),
  'owner/member');

-- ----------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('grants: accept_invitation is not executable by anon',
  (SELECT has_function_privilege('anon', 'public.accept_invitation(text, uuid, text)', 'EXECUTE')::text), 'false');
SELECT pg_temp.assert_eq('grants: accept_invitation is not executable by authenticated',
  (SELECT has_function_privilege('authenticated', 'public.accept_invitation(text, uuid, text)', 'EXECUTE')::text), 'false');
SELECT pg_temp.assert_eq('grants: accept_invitation is executable by service_role',
  (SELECT has_function_privilege('service_role', 'public.accept_invitation(text, uuid, text)', 'EXECUTE')::text), 'true');
SELECT pg_temp.assert_eq('grants: join_workspace_by_code is not executable by anon',
  (SELECT has_function_privilege('anon', 'public.join_workspace_by_code(text, uuid, text)', 'EXECUTE')::text), 'false');
SELECT pg_temp.assert_eq('grants: join_workspace_by_code is not executable by authenticated',
  (SELECT has_function_privilege('authenticated', 'public.join_workspace_by_code(text, uuid, text)', 'EXECUTE')::text), 'false');
SELECT pg_temp.assert_eq('grants: join_workspace_by_code is executable by service_role',
  (SELECT has_function_privilege('service_role', 'public.join_workspace_by_code(text, uuid, text)', 'EXECUTE')::text), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
