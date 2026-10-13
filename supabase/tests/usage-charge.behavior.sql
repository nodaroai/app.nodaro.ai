-- ============================================================================
-- Behavioral proof: usage reporting reads the CHARGE, not the hold
-- (migration 511).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000c51 upward).
--
-- WHAT IT PROVES.
--   1. `public.usage_log_charge` answers every case of the table the backend's
--      `usageAmount` is tested against (supabase/tests/fixtures/
--      usage-charge-cases.json) — the SQL twin cannot drift from the TS reader.
--   2. The admin usage RPC reports a run settled below its hold at its charge
--      (`credits_charged`) beside the hold (`credits_used`), per row and summed
--      per user, and a refunded hold sums to 0.
--
-- The case table is read with psql's backquote expansion, relative to the
-- working directory: run it from the repo root, as CI does.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/usage-charge.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
\set usage_charge_cases `cat supabase/tests/fixtures/usage-charge-cases.json`
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- 1. Every case of the shared table.
CREATE TEMP TABLE usage_charge_cases AS
  SELECT c->>'label' AS label, c->>'status' AS status,
         (c->>'credits_used')::integer AS credits_used,
         (c->>'credits_charged')::integer AS credits_charged,
         (c->>'amount')::integer AS amount
    FROM jsonb_array_elements(:'usage_charge_cases'::jsonb) AS c;
SELECT pg_temp.assert_eq('the shared case table was read',
  ((SELECT count(*) FROM usage_charge_cases) > 4)::text, 'true');
SELECT pg_temp.assert_eq('usage_log_charge: ' || label,
  public.usage_log_charge(status, credits_used, credits_charged)::text, amount::text)
  FROM usage_charge_cases;

-- 2. The admin usage RPC.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000c51', 'uc-admin@uc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000c52', 'uc-payer@uc.test', '{}', 'authenticated', 'authenticated');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000c51';

-- A re-render ceiling settled at half its hold, a refunded hold, an open hold.
INSERT INTO usage_logs (id, user_id, action, provider, credits_used, credits_charged, status) VALUES
  ('00000000-0000-4000-8000-000000000c5a', '00000000-0000-4000-8000-000000000c52', 'uc-partial', 'test', 888, 444, 'committed'),
  ('00000000-0000-4000-8000-000000000c5b', '00000000-0000-4000-8000-000000000c52', 'uc-refunded', 'test', 55, NULL, 'refunded'),
  ('00000000-0000-4000-8000-000000000c5c', '00000000-0000-4000-8000-000000000c52', 'uc-open', 'test', 120, NULL, 'reserved');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000c51","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000c51';

SELECT pg_temp.assert_eq('per row: a partial settle reports its charge beside its hold',
  (SELECT credits_used || '/' || credits_charged FROM public.get_admin_usage_logs('none', 'created_at', 'desc', 200, 0)
    WHERE id = '00000000-0000-4000-8000-000000000c5a'), '888/444');
SELECT pg_temp.assert_eq('per row: a refunded hold charged nothing',
  (SELECT credits_used || '/' || credits_charged FROM public.get_admin_usage_logs('none', 'created_at', 'desc', 200, 0)
    WHERE id = '00000000-0000-4000-8000-000000000c5b'), '55/0');
SELECT pg_temp.assert_eq('per row: an open hold counts its hold',
  (SELECT credits_used || '/' || credits_charged FROM public.get_admin_usage_logs('none', 'created_at', 'desc', 200, 0)
    WHERE id = '00000000-0000-4000-8000-000000000c5c'), '120/120');
SELECT pg_temp.assert_eq('by user: the sum of charges (444 + 0 + 120), beside the sum of holds',
  (SELECT credits_used || '/' || credits_charged || '/' || log_count
     FROM public.get_admin_usage_logs('user', 'credits_charged', 'desc', 200, 0)
    WHERE user_id = '00000000-0000-4000-8000-000000000c52'), '1063/564/3');
SELECT pg_temp.assert_eq('by action: the partial settle sums at its charge',
  (SELECT credits_charged::text FROM public.get_admin_usage_logs('action', 'credits_charged', 'desc', 200, 0)
    WHERE action = 'uc-partial'), '444');

RESET ROLE;
SELECT pg_temp.assert_eq('the admin RPC stays closed to anon',
  has_function_privilege('anon', 'public.get_admin_usage_logs(text,text,text,integer,integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('the charge helper is not callable from a browser',
  has_function_privilege('authenticated', 'public.usage_log_charge(text,integer,integer)', 'EXECUTE')::text, 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
