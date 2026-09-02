-- ============================================================================
-- Behavioral proof: signup_signal_clusters (migration 373).
--
-- The text guard in backend/src/__tests__ pins the SQL; this pins what the
-- database DOES — that a shared key groups, that a lone account never appears,
-- that an unknown axis is zero rows rather than an error, that total_count
-- survives paging, that the array cap holds while member_count stays true, and
-- that a signed-in user cannot call it at all (it is a lookup oracle over other
-- people's devices).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/signup-signal-clusters.behavior.sql mig-test:/tmp/t.sql
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

-- Nothing else in the database claimed from these keys, so every count below
-- is this file's own.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000931', 'sc1@sc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000932', 'sc2@sc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000933', 'sc3@sc.test', '{}', 'authenticated', 'authenticated');

-- 931 + 932 share a machine and a network; 933 is alone on both.
INSERT INTO signup_signals (user_id, browser_key, device_key, ip_hash, source, created_at) VALUES
  ('00000000-0000-4000-8000-000000000931', 'brw-shared', 'dev-shared', 'ip-shared', 'claim', '2026-09-01T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000932', 'brw-shared', 'dev-shared', 'ip-shared', 'claim', '2026-09-01T11:00:00Z'),
  ('00000000-0000-4000-8000-000000000933', 'brw-solo',   'dev-solo',   'ip-solo',   'claim', '2026-09-01T12:00:00Z');

-- 1. A shared key is exactly one cluster, sized by ACCOUNTS, spanning both times.
SELECT pg_temp.assert_eq('a shared device key is one cluster',
  (SELECT count(*)::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-shared'), '1');
SELECT pg_temp.assert_eq('...with both accounts counted',
  (SELECT member_count::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-shared'), '2');
SELECT pg_temp.assert_eq('...and both ids returned',
  (SELECT array_length(user_ids, 1)::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-shared'), '2');
SELECT pg_temp.assert_eq('...first_seen_at is the earliest claim',
  (SELECT first_seen_at::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-shared'),
  (SELECT '2026-09-01 10:00:00+00'::timestamptz::text));
SELECT pg_temp.assert_eq('...last_seen_at is the latest claim',
  (SELECT last_seen_at::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-shared'),
  (SELECT '2026-09-01 11:00:00+00'::timestamptz::text));

-- 2. A key with one account is not a cluster, on any axis.
SELECT pg_temp.assert_eq('a lone device key is absent',
  (SELECT count(*)::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-solo'), '0');
SELECT pg_temp.assert_eq('a lone ip hash is absent',
  (SELECT count(*)::text FROM signup_signal_clusters('ip', 50, 0) WHERE cluster_key = 'ip-solo'), '0');

-- 3. The other two axes read their own column.
SELECT pg_temp.assert_eq('the browser axis groups on browser_key',
  (SELECT member_count::text FROM signup_signal_clusters('browser', 50, 0) WHERE cluster_key = 'brw-shared'), '2');
SELECT pg_temp.assert_eq('the ip axis groups on ip_hash',
  (SELECT member_count::text FROM signup_signal_clusters('ip', 50, 0) WHERE cluster_key = 'ip-shared'), '2');

-- 4. An unrecognised axis is zero rows, never an error.
SELECT pg_temp.assert_eq('an unknown axis returns nothing',
  (SELECT count(*)::text FROM signup_signal_clusters('nope', 50, 0)), '0');

-- 5. The array cap holds while member_count stays true: 30 accounts, 25 ids.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
SELECT ('00000000-0000-4000-8000-0000000009' || lpad(i::text, 2, '0'))::uuid,
       'big' || i || '@sc.test', '{}', 'authenticated', 'authenticated'
FROM generate_series(40, 69) AS i;
INSERT INTO signup_signals (user_id, device_key, ip_hash, source)
SELECT ('00000000-0000-4000-8000-0000000009' || lpad(i::text, 2, '0'))::uuid,
       'dev-big', 'ip-big', 'claim'
FROM generate_series(40, 69) AS i;
SELECT pg_temp.assert_eq('a big cluster reports its true size',
  (SELECT member_count::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-big'), '30');
SELECT pg_temp.assert_eq('...but returns at most 25 ids',
  (SELECT array_length(user_ids, 1)::text FROM signup_signal_clusters('device', 50, 0) WHERE cluster_key = 'dev-big'), '25');

-- 6. total_count counts CLUSTERS, not the page — that is what paginates the UI.
--    Two device clusters exist now (dev-shared, dev-big), so a one-row page
--    still has to report two.
SELECT pg_temp.assert_eq('a one-row page still reports every cluster',
  (SELECT total_count::text FROM signup_signal_clusters('device', 1, 0)), '2');
SELECT pg_temp.assert_eq('...and the page really is one row',
  (SELECT count(*)::text FROM signup_signal_clusters('device', 1, 0)), '1');
SELECT pg_temp.assert_eq('...while the offset walks to the second one',
  (SELECT count(*)::text FROM signup_signal_clusters('device', 1, 1)), '1');

-- 7. It is a lookup oracle over other people's devices — a signed-in user
--    cannot call it at all.
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM * FROM signup_signal_clusters('device', 50, 0);
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE signup_signal_clusters';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot EXECUTE signup_signal_clusters';
END $$;
RESET ROLE;

-- 8. ...while the backend's service role still can. Without this an over-revoke
--    (the triple REVOKE growing a fourth line) would ship green and the admin
--    page would 500 in production.
SET ROLE service_role;
SELECT pg_temp.assert_eq('service_role can EXECUTE signup_signal_clusters',
  (SELECT count(*)::text FROM signup_signal_clusters('device', 50, 0)), '2');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
