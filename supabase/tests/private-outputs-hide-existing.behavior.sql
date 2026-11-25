-- ============================================================================
-- Behavioral proof: migration 706 — switching outputs to private takes the
-- person's existing items out of the public gallery, and nothing else — and
-- migration 713: what was made while private stays private after the setting
-- returns to public.
--
-- WHAT IT PINS (none of it is provable from the SQL text or a mocked route):
--   P1  Only the service role can call the two functions (anon and
--       authenticated cannot hide anyone's gallery over PostgREST).
--   P2  make_outputs_private hides EVERY public row of that user — at volume
--       (10,000 rows, one account had 8,221) — sets the preference, and
--       answers how many it hid.
--   P3  Another user's rows and reports are untouched.
--   P4  Pending reports on the hidden rows are marked reviewed, exactly as the
--       admin removal does; a dismissed report keeps its status.
--   P5  A second call hides 0 and changes nothing (a retry is safe).
--   P6  While private, no row of the user turns public (a generation in
--       flight at the switch, a lifted restriction): update and insert.
--   P7  Switching back to public republishes nothing; new rows may be public
--       again.
--   P8  remove_jobs_from_gallery (the admin path) keeps its old contract.
--   P9  An unknown user is an error, not a silent 0.
--   P10 A row restricted while public, of a user who then goes private and
--       back to public, is not republished when the restriction is lifted
--       (the lift restores the visibility its immutable record kept); the
--       same lift for a user who never went private still restores it.
--   P11 A plan drop to one without private outputs (the exact write
--       tierColumns makes: tier, subscription_tier and public_outputs = true
--       in one UPDATE) republishes nothing: rows the switch hid and rows
--       completed while private stay private, a hidden row written public
--       again is still refused, and a NEW row is public again.
--   P12 (713) After the setting returns to public — by a plan drop or the
--       person's own switch — a row CREATED before that never turns public:
--       an unmarked row completed while private written public again, and a
--       job queued while private that completes after. A row created after
--       is public. The time is stamped by the database on false → true only:
--       an account that was public all along gets no stamp.
--   P13 (713) The stamp says why ('plan' when the same update changed the
--       tier, 'owner' otherwise), and only the trigger writes it; a plan reset
--       enqueues exactly one notice, a repeated write and the person's own
--       switch none; the notice table is closed to anon and authenticated
--       (no grant, no policy).
--
-- Fixtures, then assertions; rolls back. Own uuid range: a7060000-….
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase mig-test:/repo/supabase
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /repo/supabase/tests/private-outputs-hide-existing.behavior.sql
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

-- ---------------------------------------------------------------------------
-- P1: grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('P1 anon cannot make outputs private',
  has_function_privilege('anon', 'public.make_outputs_private(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('P1 authenticated cannot make outputs private',
  has_function_privilege('authenticated', 'public.make_outputs_private(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('P1 service_role can make outputs private',
  has_function_privilege('service_role', 'public.make_outputs_private(uuid)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('P1 anon cannot remove from the gallery',
  has_function_privilege('anon', 'public.remove_jobs_from_gallery(uuid[], boolean)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('P1 authenticated cannot remove from the gallery',
  has_function_privilege('authenticated', 'public.remove_jobs_from_gallery(uuid[], boolean)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('P1 service_role can remove from the gallery',
  has_function_privilege('service_role', 'public.remove_jobs_from_gallery(uuid[], boolean)', 'EXECUTE')::text, 'true');

-- ---------------------------------------------------------------------------
-- Fixtures. A switches to private; B is a bystander.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('a7060000-0000-4000-8000-000000000001', 'po-a@po.test', '{}', 'authenticated', 'authenticated'),
  ('a7060000-0000-4000-8000-000000000002', 'po-b@po.test', '{}', 'authenticated', 'authenticated');

SELECT pg_temp.assert_eq('fixture: profiles created by the auth trigger',
  (SELECT count(*)::text FROM public.profiles WHERE email LIKE '%@po.test'), '2');
UPDATE public.profiles SET public_outputs = true WHERE email LIKE '%@po.test';

-- A: 10,000 public completed rows, 2 public rows in other states, 3 private.
INSERT INTO public.jobs (id, user_id, status, is_public)
SELECT ('a706' || lpad(to_hex(g), 4, '0') || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'a7060000-0000-4000-8000-000000000001', 'completed', true
  FROM generate_series(1, 10000) AS g;
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7062000-0000-4000-8000-000000000001', 'a7060000-0000-4000-8000-000000000001', 'failed', true),
  ('a7062000-0000-4000-8000-000000000002', 'a7060000-0000-4000-8000-000000000001', 'processing', true),
  ('a7062000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000001', 'completed', false),
  ('a7062000-0000-4000-8000-000000000004', 'a7060000-0000-4000-8000-000000000001', 'completed', false),
  ('a7062000-0000-4000-8000-000000000005', 'a7060000-0000-4000-8000-000000000001', 'processing', false);

-- B: 3 public rows, 1 private.
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7063000-0000-4000-8000-000000000001', 'a7060000-0000-4000-8000-000000000002', 'completed', true),
  ('a7063000-0000-4000-8000-000000000002', 'a7060000-0000-4000-8000-000000000002', 'completed', true),
  ('a7063000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000002', 'completed', true),
  ('a7063000-0000-4000-8000-000000000004', 'a7060000-0000-4000-8000-000000000002', 'processing', false);

SELECT pg_temp.assert_eq('fixture: A has 10,002 public rows',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001' AND is_public), '10002');

-- Reports: two pending + one dismissed on A's public rows, one pending on B's.
INSERT INTO public.gallery_reports (id, job_id, reason, status) VALUES
  ('a7064000-0000-4000-8000-000000000001', 'a7060001-0000-4000-8000-000000000001', 'spam', 'pending'),
  ('a7064000-0000-4000-8000-000000000002', 'a7062000-0000-4000-8000-000000000001', 'spam', 'pending'),
  ('a7064000-0000-4000-8000-000000000003', 'a7060002-0000-4000-8000-000000000002', 'spam', 'dismissed'),
  ('a7064000-0000-4000-8000-000000000004', 'a7063000-0000-4000-8000-000000000001', 'spam', 'pending');

-- ---------------------------------------------------------------------------
-- P2–P4: the switch.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('P2 answers how many it hid',
  public.make_outputs_private('a7060000-0000-4000-8000-000000000001')::text, '10002');
SELECT pg_temp.assert_eq('P2 A has no public row left',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001' AND is_public IS TRUE), '0');
SELECT pg_temp.assert_eq('P2 every A row still exists',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001'), '10005');
SELECT pg_temp.assert_eq('P2 every hidden row is marked hidden by its owner',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001' AND hidden_by_owner_at IS NOT NULL), '10002');
SELECT pg_temp.assert_eq('P2 rows that were already private are not marked',
  (SELECT count(*)::text FROM public.jobs WHERE id IN ('a7062000-0000-4000-8000-000000000003', 'a7062000-0000-4000-8000-000000000004') AND hidden_by_owner_at IS NOT NULL), '0');
SELECT pg_temp.assert_eq('P2 the preference is private',
  (SELECT public_outputs::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000001'), 'false');

SELECT pg_temp.assert_eq('P3 B keeps its 3 public rows',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000002' AND is_public), '3');
SELECT pg_temp.assert_eq('P3 B keeps its preference',
  (SELECT public_outputs::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000002'), 'true');
SELECT pg_temp.assert_eq('P3 B''s pending report stays pending',
  (SELECT status FROM public.gallery_reports WHERE id = 'a7064000-0000-4000-8000-000000000004'), 'pending');

SELECT pg_temp.assert_eq('P4 A''s pending reports are reviewed',
  (SELECT string_agg(status, ',' ORDER BY id) FROM public.gallery_reports
    WHERE id IN ('a7064000-0000-4000-8000-000000000001', 'a7064000-0000-4000-8000-000000000002')), 'reviewed,reviewed');
SELECT pg_temp.assert_eq('P4 a dismissed report stays dismissed',
  (SELECT status FROM public.gallery_reports WHERE id = 'a7064000-0000-4000-8000-000000000003'), 'dismissed');

-- ---------------------------------------------------------------------------
-- P5: a retry.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('P5 a second call hides 0',
  public.make_outputs_private('a7060000-0000-4000-8000-000000000001')::text, '0');
SELECT pg_temp.assert_eq('P5 still no public A row',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001' AND is_public IS TRUE), '0');

-- ---------------------------------------------------------------------------
-- P6: while private, nothing of A turns public.
-- ---------------------------------------------------------------------------
-- A generation in flight at the switch completes with the visibility it read
-- at pickup.
UPDATE public.jobs SET status = 'completed', is_public = true
 WHERE id = 'a7062000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('P6 an in-flight completion stays private',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7062000-0000-4000-8000-000000000005'), 'false');
SELECT pg_temp.assert_eq('P6 the rest of that update applied',
  (SELECT status FROM public.jobs WHERE id = 'a7062000-0000-4000-8000-000000000005'), 'completed');
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7062000-0000-4000-8000-000000000006', 'a7060000-0000-4000-8000-000000000001', 'completed', true);
SELECT pg_temp.assert_eq('P6 a row inserted public stays private',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7062000-0000-4000-8000-000000000006'), 'false');
-- B is not clamped.
UPDATE public.jobs SET status = 'completed', is_public = true
 WHERE id = 'a7063000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_eq('P6 a public user''s completion is public',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7063000-0000-4000-8000-000000000004'), 'true');

-- ---------------------------------------------------------------------------
-- P7: back to public republishes nothing.
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET public_outputs = true WHERE id = 'a7060000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('P7 switching back republishes nothing',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000001' AND is_public IS TRUE), '0');
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7062000-0000-4000-8000-000000000007', 'a7060000-0000-4000-8000-000000000001', 'completed', true);
SELECT pg_temp.assert_eq('P7 a new row may be public again',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7062000-0000-4000-8000-000000000007'), 'true');
UPDATE public.jobs SET is_public = true WHERE id = 'a7060005-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('P7 a row the switch hid stays private when written public again',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7060005-0000-4000-8000-000000000005'), 'false');

-- ---------------------------------------------------------------------------
-- P8: the admin path.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('P8 no ids removes nothing',
  public.remove_jobs_from_gallery('{}'::uuid[])::text, '0');
SELECT pg_temp.assert_eq('P8 null removes nothing',
  public.remove_jobs_from_gallery(NULL)::text, '0');
SELECT pg_temp.assert_eq('P8 answers the rows it named',
  public.remove_jobs_from_gallery(ARRAY[
    'a7063000-0000-4000-8000-000000000001',
    'a7063000-0000-4000-8000-000000000001',
    'a7063000-0000-4000-8000-0000000000ff']::uuid[])::text, '1');
SELECT pg_temp.assert_eq('P8 the admin path marks nothing as hidden by the owner',
  (SELECT (hidden_by_owner_at IS NULL)::text FROM public.jobs WHERE id = 'a7063000-0000-4000-8000-000000000001'), 'true');
SELECT pg_temp.assert_eq('P8 the named row is out of the gallery',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7063000-0000-4000-8000-000000000001'), 'false');
SELECT pg_temp.assert_eq('P8 its pending report is reviewed',
  (SELECT status FROM public.gallery_reports WHERE id = 'a7064000-0000-4000-8000-000000000004'), 'reviewed');
SELECT pg_temp.assert_eq('P8 B''s other rows stay public',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000002' AND is_public), '3');

-- ---------------------------------------------------------------------------
-- P9: an unknown user.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.make_outputs_private('a7060000-0000-4000-8000-0000000000ff');
  RAISE EXCEPTION 'ASSERT FAIL [P9 unknown user]: no error raised';
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  RAISE NOTICE 'ok  P9 an unknown user is an error';
END $$;

-- ---------------------------------------------------------------------------
-- P10: a content restriction lifted after private → public.
-- C goes private and back; D never does. Each has one row restricted while
-- public (the record keeps prior is_public = true, as restrict_content does).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('a7060000-0000-4000-8000-000000000003', 'po-c@po.test', '{}', 'authenticated', 'authenticated'),
  ('a7060000-0000-4000-8000-000000000004', 'po-d@po.test', '{}', 'authenticated', 'authenticated');
UPDATE public.profiles SET public_outputs = true
 WHERE id IN ('a7060000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000004');
INSERT INTO public.jobs (id, user_id, status, is_public, restricted_at) VALUES
  ('a7065000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000003', 'completed', false, now()),
  ('a7065000-0000-4000-8000-000000000004', 'a7060000-0000-4000-8000-000000000004', 'completed', false, now());
INSERT INTO public.content_restrictions (id, job_id, job_ids, reason, prior) VALUES
  ('a7066000-0000-4000-8000-000000000003', 'a7065000-0000-4000-8000-000000000003',
   ARRAY['a7065000-0000-4000-8000-000000000003']::uuid[], 'proof',
   '{"jobs": {"a7065000-0000-4000-8000-000000000003": {"is_public": true}}}'::jsonb),
  ('a7066000-0000-4000-8000-000000000004', 'a7065000-0000-4000-8000-000000000004',
   ARRAY['a7065000-0000-4000-8000-000000000004']::uuid[], 'proof',
   '{"jobs": {"a7065000-0000-4000-8000-000000000004": {"is_public": true}}}'::jsonb);

SELECT pg_temp.assert_eq('P10 a restricted row is not counted as hidden',
  public.make_outputs_private('a7060000-0000-4000-8000-000000000003')::text, '0');
SELECT pg_temp.assert_eq('P10 but it is marked hidden by its owner',
  (SELECT (hidden_by_owner_at IS NOT NULL)::text FROM public.jobs WHERE id = 'a7065000-0000-4000-8000-000000000003'), 'true');
SELECT pg_temp.assert_eq('P10 the restriction record is left as it was',
  (SELECT prior::text FROM public.content_restrictions WHERE id = 'a7066000-0000-4000-8000-000000000003'),
  '{"jobs": {"a7065000-0000-4000-8000-000000000003": {"is_public": true}}}');
UPDATE public.profiles SET public_outputs = true WHERE id = 'a7060000-0000-4000-8000-000000000003';
SELECT public.lift_content_restriction('a7066000-0000-4000-8000-000000000003', NULL, 'proof lift');
SELECT public.lift_content_restriction('a7066000-0000-4000-8000-000000000004', NULL, 'proof lift');
SELECT pg_temp.assert_eq('P10 the lift does not republish the row of a user who went private',
  (SELECT is_public::text || '/' || (restricted_at IS NULL)::text FROM public.jobs WHERE id = 'a7065000-0000-4000-8000-000000000003'), 'false/true');
SELECT pg_temp.assert_eq('P10 the same lift still restores a user who never went private',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7065000-0000-4000-8000-000000000004'), 'true');

-- ---------------------------------------------------------------------------
-- P11: a plan drop returns the setting to public; nothing old is republished.
-- E is on Pro, public, with one public row; goes private (the row is hidden by
-- the switch); completes one generation while private; then drops to Free.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('a7060000-0000-4000-8000-000000000005', 'po-e@po.test', '{}', 'authenticated', 'authenticated');
UPDATE public.profiles SET public_outputs = true, tier = 'pro', subscription_tier = 'pro'
 WHERE id = 'a7060000-0000-4000-8000-000000000005';
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7067000-0000-4000-8000-000000000001', 'a7060000-0000-4000-8000-000000000005', 'completed', true);
SELECT pg_temp.assert_eq('P11 the switch hides E''s public row',
  public.make_outputs_private('a7060000-0000-4000-8000-000000000005')::text, '1');
-- A generation completed while private: written public, kept private by the clamp, not marked.
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7067000-0000-4000-8000-000000000002', 'a7060000-0000-4000-8000-000000000005', 'completed', true);
SELECT pg_temp.assert_eq('P11 a row completed while private is private and unmarked',
  (SELECT is_public::text || '/' || (hidden_by_owner_at IS NULL)::text FROM public.jobs WHERE id = 'a7067000-0000-4000-8000-000000000002'), 'false/true');

-- The downgrade write, as tierColumns('free') spreads it.
UPDATE public.profiles SET tier = 'free', subscription_tier = 'free', public_outputs = true
 WHERE id = 'a7060000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('P11 the drop leaves the setting public',
  (SELECT public_outputs::text || '/' || tier FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000005'), 'true/free');
SELECT pg_temp.assert_eq('P11 nothing E made before the drop is public',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000005' AND is_public IS TRUE), '0');
SELECT pg_temp.assert_eq('P11 the row the switch hid keeps its marker',
  (SELECT (hidden_by_owner_at IS NOT NULL)::text FROM public.jobs WHERE id = 'a7067000-0000-4000-8000-000000000001'), 'true');
UPDATE public.jobs SET is_public = true WHERE id = 'a7067000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('P11 the row the switch hid is refused public after the drop',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7067000-0000-4000-8000-000000000001'), 'false');
INSERT INTO public.jobs (id, user_id, status, is_public) VALUES
  ('a7067000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000005', 'completed', true);
SELECT pg_temp.assert_eq('P11 a new row after the drop is public',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7067000-0000-4000-8000-000000000003'), 'true');
-- The same write again (a redelivered webhook, the expiry safety net) changes nothing.
UPDATE public.profiles SET tier = 'free', subscription_tier = 'free', public_outputs = true
 WHERE id = 'a7060000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_eq('P11 a repeated drop republishes nothing',
  (SELECT count(*)::text FROM public.jobs WHERE user_id = 'a7060000-0000-4000-8000-000000000005' AND is_public IS TRUE), '1');

-- ---------------------------------------------------------------------------
-- P12: made while private stays private (migration 713).
-- F on Pro goes private, completes a generation, has a job still queued, then
-- drops to Free. The test runs in one transaction, where now() is fixed, so
-- the rows carry explicit creation times around that instant.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('a7060000-0000-4000-8000-000000000006', 'po-f@po.test', '{}', 'authenticated', 'authenticated'),
  ('a7060000-0000-4000-8000-000000000007', 'po-g@po.test', '{}', 'authenticated', 'authenticated');
UPDATE public.profiles SET public_outputs = true, tier = 'pro', subscription_tier = 'pro'
 WHERE id IN ('a7060000-0000-4000-8000-000000000006', 'a7060000-0000-4000-8000-000000000007');
SELECT pg_temp.assert_eq('P12 an account public all along has no stamp',
  (SELECT (outputs_public_since IS NULL)::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000006'), 'true');
SELECT public.make_outputs_private('a7060000-0000-4000-8000-000000000006');
INSERT INTO public.jobs (id, user_id, status, is_public, created_at) VALUES
  ('a7068000-0000-4000-8000-000000000001', 'a7060000-0000-4000-8000-000000000006', 'completed', true, now() - interval '2 hours'),
  ('a7068000-0000-4000-8000-000000000002', 'a7060000-0000-4000-8000-000000000006', 'processing', false, now() - interval '1 hour');
SELECT pg_temp.assert_eq('P12 the row completed while private is private and unmarked',
  (SELECT is_public::text || '/' || (hidden_by_owner_at IS NULL)::text FROM public.jobs WHERE id = 'a7068000-0000-4000-8000-000000000001'), 'false/true');

-- The drop, as tierColumns spreads it.
UPDATE public.profiles SET tier = 'free', subscription_tier = 'free', public_outputs = true
 WHERE id = 'a7060000-0000-4000-8000-000000000006';
SELECT pg_temp.assert_eq('P12 the drop stamps when the setting went back to public',
  (SELECT (outputs_public_since = now())::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000006'), 'true');
UPDATE public.jobs SET is_public = true WHERE id = 'a7068000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_eq('P12 an unmarked row made while private stays private when written public',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7068000-0000-4000-8000-000000000001'), 'false');
UPDATE public.jobs SET status = 'completed', is_public = true WHERE id = 'a7068000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_eq('P12 a job queued while private that completes after stays private',
  (SELECT is_public::text || '/' || status FROM public.jobs WHERE id = 'a7068000-0000-4000-8000-000000000002'), 'false/completed');
INSERT INTO public.jobs (id, user_id, status, is_public, created_at) VALUES
  ('a7068000-0000-4000-8000-000000000003', 'a7060000-0000-4000-8000-000000000006', 'processing', false, now() + interval '1 minute');
UPDATE public.jobs SET status = 'completed', is_public = true WHERE id = 'a7068000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_eq('P12 a job created after the drop is public',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7068000-0000-4000-8000-000000000003'), 'true');

-- A write of true over true (an account already public) stamps nothing, and
-- its older rows may still turn public.
UPDATE public.profiles SET tier = 'free', subscription_tier = 'free', public_outputs = true
 WHERE id = 'a7060000-0000-4000-8000-000000000007';
SELECT pg_temp.assert_eq('P12 true over true stamps nothing',
  (SELECT (outputs_public_since IS NULL)::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000007'), 'true');
INSERT INTO public.jobs (id, user_id, status, is_public, created_at) VALUES
  ('a7068000-0000-4000-8000-000000000004', 'a7060000-0000-4000-8000-000000000007', 'processing', false, now() - interval '1 hour');
UPDATE public.jobs SET status = 'completed', is_public = true WHERE id = 'a7068000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_eq('P12 an always-public account''s older job completes public',
  (SELECT is_public::text FROM public.jobs WHERE id = 'a7068000-0000-4000-8000-000000000004'), 'true');
-- The person's own switch back (the settings route's plain write) stamps too.
SELECT pg_temp.assert_eq('P12 the person''s own switch back is stamped',
  (SELECT (outputs_public_since IS NOT NULL)::text FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000001'), 'true');

-- ---------------------------------------------------------------------------
-- P13: why, and the one notice (migration 713).
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('P13 a plan drop is stamped plan',
  (SELECT outputs_public_reason FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000006'), 'plan');
SELECT pg_temp.assert_eq('P13 the person''s own switch is stamped owner',
  (SELECT outputs_public_reason FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000001'), 'owner');
SELECT pg_temp.assert_eq('P13 the plan drop enqueued one notice, at its stamp',
  (SELECT count(*)::text || '/' || bool_and(public_since = now())::text FROM public.outputs_public_notices WHERE user_id = 'a7060000-0000-4000-8000-000000000006'), '1/true');
SELECT pg_temp.assert_eq('P13 the person''s own switch enqueued none',
  (SELECT count(*)::text FROM public.outputs_public_notices WHERE user_id = 'a7060000-0000-4000-8000-000000000001'), '0');
SELECT pg_temp.assert_eq('P13 an always-public account''s write enqueued none',
  (SELECT count(*)::text FROM public.outputs_public_notices WHERE user_id = 'a7060000-0000-4000-8000-000000000007'), '0');
-- E (P11) dropped too: one notice; its repeated write added none.
SELECT pg_temp.assert_eq('P13 a repeated drop write enqueues nothing more',
  (SELECT count(*)::text FROM public.outputs_public_notices WHERE user_id = 'a7060000-0000-4000-8000-000000000005'), '1');
-- Only the trigger writes the stamp: a direct write is put back.
UPDATE public.profiles SET outputs_public_since = NULL, outputs_public_reason = 'owner'
 WHERE id = 'a7060000-0000-4000-8000-000000000006';
SELECT pg_temp.assert_eq('P13 a direct write of the stamp is put back',
  (SELECT (outputs_public_since = now())::text || '/' || outputs_public_reason FROM public.profiles WHERE id = 'a7060000-0000-4000-8000-000000000006'), 'true/plan');
SELECT pg_temp.assert_eq('P13 the notice table has row security on',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.outputs_public_notices'::regclass), 'true');
SELECT pg_temp.assert_eq('P13 anon and authenticated hold no privilege on the notice table',
  (SELECT (has_table_privilege('anon', 'public.outputs_public_notices', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.outputs_public_notices', 'SELECT,INSERT,UPDATE,DELETE'))::text), 'false');
SELECT pg_temp.assert_eq('P13 no policy opens the notice table',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'outputs_public_notices'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
