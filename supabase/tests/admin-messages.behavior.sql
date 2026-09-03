-- ============================================================================
-- Behavioral proof: admin_messages is admin-READABLE, nobody-writable, and
-- invisible to the user it is about (migration 375).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000941 upward).
--
-- WHY THIS PROOF EXISTS. Three claims the feature rests on are made in RLS and
-- provable nowhere else:
--   1. EVERY admin reads EVERY row. The point of the log is that the next
--      admin to open this user sees what the last one already said. A policy
--      narrowed to the sender would look correct in review and quietly turn a
--      shared record into a private one.
--   2. The recipient cannot read it. It is an internal operations log: it
--      carries the acting admin's identity and the raw draft variables.
--   3. Nothing but service_role writes. The rate limit and the template
--      rendering live in the route; a write policy on `authenticated` would
--      let an admin's browser session skip both and forge a history row.
-- Assertions 3 and 4 are the ones that matter -- they also fail if a future
-- migration adds a write policy, which is how this would come back.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/admin-messages.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000941', 'am-recipient@am.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000942', 'am-admin-a@am.test',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000943', 'am-admin-b@am.test',   '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@am.test'), '3');
UPDATE profiles SET role = 'admin'
 WHERE id IN ('00000000-0000-4000-8000-000000000942', '00000000-0000-4000-8000-000000000943');

-- Admin A messages the recipient. Seeded as postgres (service role bypasses
-- RLS) because that is exactly how the route writes it.
INSERT INTO admin_messages
  (id, user_id, recipient_email, sent_by_admin_id, sent_by_admin_email,
   template_id, variables, rendered_subject, rendered_body, status)
VALUES
  ('00000000-0000-4000-8000-00000000094a',
   '00000000-0000-4000-8000-000000000941', 'am-recipient@am.test',
   '00000000-0000-4000-8000-000000000942', 'am-admin-a@am.test',
   'issue_detected', '{"whatHappened":"x"}'::jsonb,
   'We spotted an issue', 'body', 'sent');

-- 0. Not vacuous: the row exists to be read or denied.
SELECT pg_temp.assert_eq('the message row exists (as postgres)',
  (SELECT count(*)::text FROM admin_messages WHERE recipient_email = 'am-recipient@am.test'), '1');

-- 1. The SENDING admin reads their own message.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000942","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000942';
SELECT pg_temp.assert_eq('the sending admin reads the message',
  (SELECT count(*)::text FROM admin_messages WHERE id = '00000000-0000-4000-8000-00000000094a'), '1');

-- 2. A DIFFERENT admin reads it too -- the log is shared, not per-sender.
--    This is the assertion that fails if someone "tightens" the policy to
--    sent_by_admin_id = auth.uid().
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000943","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000943';
SELECT pg_temp.assert_eq('a second admin reads a message they did not send',
  (SELECT count(*)::text FROM admin_messages WHERE id = '00000000-0000-4000-8000-00000000094a'), '1');

-- 3. An admin CANNOT write. SELECT-only policy => the insert must be denied by
--    RLS. Caught, so the transaction survives to the next assertion.
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO admin_messages
      (user_id, recipient_email, sent_by_admin_id, template_id,
       rendered_subject, rendered_body, status)
    VALUES ('00000000-0000-4000-8000-000000000941', 'am-recipient@am.test',
            '00000000-0000-4000-8000-000000000943', 'general_followup',
            'forged', 'forged', 'sent');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [an admin cannot INSERT a message]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  an admin cannot INSERT a message (RLS denies)';
END $$;

-- 4. No write policy exists under ANY name for `authenticated`. Belt and
--    braces with #3: #3 proves today's behaviour, this proves the shape a
--    future migration would have to break.
SELECT pg_temp.assert_eq('no write policy on admin_messages for authenticated',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='admin_messages'
      AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
      AND NOT ('service_role' = ANY(roles))), '0');

-- 5. The RECIPIENT sees nothing. Internal log: it names the acting admin and
--    carries the draft variables.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000941","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000941';
SELECT pg_temp.assert_eq('the recipient cannot read messages about themselves',
  (SELECT count(*)::text FROM admin_messages), '0');

-- 6. RLS is actually ON (a table with policies but RLS disabled reads wide open
--    for everyone, and assertion #5 would still pass for the wrong reason).
RESET ROLE;
SELECT pg_temp.assert_eq('row level security is enabled on admin_messages',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'admin_messages'), 'true');

-- 7. The rate-limit setting is seeded at the spec default.
SELECT pg_temp.assert_eq('admin_messages_daily_limit seeded at 50',
  (SELECT value::text FROM app_settings WHERE key = 'admin_messages_daily_limit'), '50');

-- 8. Deleting the recipient keeps the row and its addressee (ON DELETE SET
--    NULL + the denormalised email). The log outlives the account.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000941';
SELECT pg_temp.assert_eq('the message survives the recipient being deleted',
  (SELECT count(*)::text FROM admin_messages WHERE id = '00000000-0000-4000-8000-00000000094a'), '1');
SELECT pg_temp.assert_eq('user_id is nulled but the address is still known',
  (SELECT (user_id IS NULL) || '/' || recipient_email FROM admin_messages
    WHERE id = '00000000-0000-4000-8000-00000000094a'), 'true/am-recipient@am.test');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
