-- ============================================================================
-- Behavioral proof: `unpaid` is a storable subscription status, and the
-- renewal safety net grants a period's credits in one locked call that a hold
-- cannot slip past (migration 656).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000065601 upward).
--
-- `renew_subscription_credits_safety_net` is what the hourly safety net
-- (cleanup-service.ts renewSubscriptionCredits) calls for an active
-- subscription whose period ended unreset. What it pins:
--   1. subscriptions.status stores `unpaid`; a status Stripe does not have is
--      still refused;
--   2. the grant SETs the pool to the plan's credits (top-ups untouched),
--      stamps the reset, and grants once: a second call for the same period
--      is refused;
--   3. a hold (hold_subscription_renewal_credits, migration 654) taken before
--      the call is never refilled;
--   4. a pool already reset since the period ended, a period end that is not
--      the stored one, an ended, unpaid or never-granted subscription, another
--      account's subscription, and bad input are refused and change nothing;
--   5. only the service role may call it.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/subscription-safety-net-renewal.behavior.sql
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

-- The period every renewal below is for: it ended an hour ago.
CREATE FUNCTION pg_temp.period_end() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('second', now()) - interval '1 hour'
$$;

-- renew(user, subscription row, period end, credits) → 'true' / 'false', as the service role.
CREATE FUNCTION pg_temp.renew(p_user uuid, p_sub uuid, p_end timestamptz, p_credits integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v boolean;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.renew_subscription_credits_safety_net(p_user, p_sub, p_end, p_credits);
  RESET ROLE;
  RETURN coalesce(v::text, '<null>');
END $$;

CREATE FUNCTION pg_temp.hold(p_user uuid, p_sub text, p_start timestamptz)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.hold_subscription_renewal_credits(p_user, p_sub, p_start);
  RESET ROLE;
  RETURN coalesce(v::text, '<null>');
END $$;

-- pool/top-up, and whether the reset stamp moved past the period end.
CREATE FUNCTION pg_temp.account(p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT subscription_credits::text || '/' || topup_credits::text || '/' ||
         CASE WHEN credits_reset_at >= pg_temp.period_end() THEN 'reset' ELSE 'stale' END
    FROM profiles WHERE id = p_user
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000065601', 'sn-grant@sn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065602', 'sn-held@sn.test',      '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065603', 'sn-reset@sn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065604', 'sn-moved@sn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065605', 'sn-ended@sn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065606', 'sn-ungranted@sn.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065607', 'sn-unpaid@sn.test',    '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@sn.test'), '7');

INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end, plan_granted)
VALUES
  ('a0000000-0000-4000-8000-000000065601', '00000000-0000-4000-8000-000000065601', 'sub_sn_grant',     'price_sn_pro', 'pro', 'active',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), true),
  ('a0000000-0000-4000-8000-000000065602', '00000000-0000-4000-8000-000000065602', 'sub_sn_held',      'price_sn_pro', 'pro', 'active',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), true),
  ('a0000000-0000-4000-8000-000000065603', '00000000-0000-4000-8000-000000065603', 'sub_sn_reset',     'price_sn_pro', 'pro', 'active',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), true),
  ('a0000000-0000-4000-8000-000000065604', '00000000-0000-4000-8000-000000065604', 'sub_sn_moved',     'price_sn_pro', 'pro', 'active',
   pg_temp.period_end(), pg_temp.period_end() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065605', '00000000-0000-4000-8000-000000065605', 'sub_sn_ended',     'price_sn_pro', 'pro', 'canceled',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), true),
  ('a0000000-0000-4000-8000-000000065606', '00000000-0000-4000-8000-000000065606', 'sub_sn_ungranted', 'price_sn_pro', 'pro', 'active',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), false),
  ('a0000000-0000-4000-8000-000000065607', '00000000-0000-4000-8000-000000065607', 'sub_sn_unpaid',    'price_sn_pro', 'pro', 'active',
   pg_temp.period_end() - interval '1 month', pg_temp.period_end(), true);

-- Everyone was reset at the start of the period that has now ended, has
-- spent some of it, and holds top-up credits too.
UPDATE profiles SET subscription_credits = 1200, topup_credits = 3300,
                    credits_reset_at = pg_temp.period_end() - interval '1 month' + interval '4 seconds'
 WHERE email LIKE '%@sn.test';
-- Reset since the period ended (the webhook, or a paid renewal invoice).
UPDATE profiles SET credits_reset_at = pg_temp.period_end() + interval '10 minutes'
 WHERE id = '00000000-0000-4000-8000-000000065603';

-- ---------------------------------------------------------------------------
-- 1. `unpaid` is storable; an unknown status is not.
-- ---------------------------------------------------------------------------
UPDATE subscriptions SET status = 'unpaid' WHERE id = 'a0000000-0000-4000-8000-000000065607';
SELECT pg_temp.assert_eq('unpaid is stored',
  (SELECT status FROM subscriptions WHERE id = 'a0000000-0000-4000-8000-000000065607'), 'unpaid');
DO $$ BEGIN
  UPDATE subscriptions SET status = 'overdue' WHERE id = 'a0000000-0000-4000-8000-000000065607';
  RAISE EXCEPTION 'ASSERT FAIL: a status Stripe does not have was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  a status Stripe does not have is refused';
END $$;
SELECT pg_temp.assert_eq('every status the CHECK kept is still stored',
  (SELECT string_agg(s, ',' ORDER BY s) FROM unnest(ARRAY['active','trialing','past_due','unpaid','paused','canceled','incomplete','incomplete_expired','expired']) s
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'subscriptions_status_check'
         AND pg_get_constraintdef(oid) LIKE '%''' || s || '''%')),
  NULL);

-- ---------------------------------------------------------------------------
-- 2. The grant: SET to the plan's credits, stamped, once.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('an active, granted, unheld subscription whose period ended unreset is renewed',
  pg_temp.renew('00000000-0000-4000-8000-000000065601', 'a0000000-0000-4000-8000-000000065601', pg_temp.period_end(), 23000), 'true');
SELECT pg_temp.assert_eq('...the pool is SET to the plan''s credits, top-ups untouched, the reset stamped',
  pg_temp.account('00000000-0000-4000-8000-000000065601'), '23000/3300/reset');
UPDATE profiles SET subscription_credits = 500 WHERE id = '00000000-0000-4000-8000-000000065601';
SELECT pg_temp.assert_eq('a second call for the same period is refused (the stamp is past the period end)',
  pg_temp.renew('00000000-0000-4000-8000-000000065601', 'a0000000-0000-4000-8000-000000065601', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...what was spent since stays spent', pg_temp.account('00000000-0000-4000-8000-000000065601'), '500/3300/reset');

-- ---------------------------------------------------------------------------
-- 3. A hold taken first is never refilled. (A stale `active` event can leave
--    a held row reading active; the hold itself is taken while past_due.)
-- ---------------------------------------------------------------------------
UPDATE subscriptions SET status = 'past_due' WHERE id = 'a0000000-0000-4000-8000-000000065602';
SELECT pg_temp.assert_eq('the failed renewal holds the pool',
  pg_temp.hold('00000000-0000-4000-8000-000000065602', 'sub_sn_held', pg_temp.period_end() - interval '1 month'), '1200');
UPDATE subscriptions SET status = 'active' WHERE id = 'a0000000-0000-4000-8000-000000065602';
SELECT pg_temp.assert_eq('a held subscription is refused, even read active',
  pg_temp.renew('00000000-0000-4000-8000-000000065602', 'a0000000-0000-4000-8000-000000065602', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...the pool stays held at 0', pg_temp.account('00000000-0000-4000-8000-000000065602'), '0/3300/stale');

-- ---------------------------------------------------------------------------
-- 4. Refusals that change nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a pool reset since the period ended is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065603', 'a0000000-0000-4000-8000-000000065603', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065603'), '1200/3300/reset');

SELECT pg_temp.assert_eq('a period end that is not the stored one (the period moved since the read) is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...even a microsecond off',
  pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', pg_temp.period_end() + interval '1 month' + interval '1 microsecond', 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065604'), '1200/3300/stale');

UPDATE subscriptions SET collection_paused = true WHERE id = 'a0000000-0000-4000-8000-000000065604';
SELECT pg_temp.assert_eq('a subscription whose payment collection is paused is refused (nothing is charged)',
  pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065604'), '1200/3300/stale');
UPDATE subscriptions SET collection_paused = false WHERE id = 'a0000000-0000-4000-8000-000000065604';

SELECT pg_temp.assert_eq('an ended subscription is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065605', 'a0000000-0000-4000-8000-000000065605', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065605'), '1200/3300/stale');

SELECT pg_temp.assert_eq('a subscription whose plan was never granted is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065606', 'a0000000-0000-4000-8000-000000065606', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065606'), '1200/3300/stale');

SELECT pg_temp.assert_eq('an unpaid subscription is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065607', 'a0000000-0000-4000-8000-000000065607', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065607'), '1200/3300/stale');

SELECT pg_temp.assert_eq('another account''s subscription is refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065602', pg_temp.period_end(), 23000), 'false');
SELECT pg_temp.assert_eq('negative credits, null input and an unknown row are refused',
  pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', pg_temp.period_end() + interval '1 month', -1)
  || pg_temp.renew(NULL, 'a0000000-0000-4000-8000-000000065604', pg_temp.period_end(), 23000)
  || pg_temp.renew('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-0000000656ff', pg_temp.period_end(), 23000),
  'falsefalsefalse');
SELECT pg_temp.assert_eq('...unchanged', pg_temp.account('00000000-0000-4000-8000-000000065604'), '1200/3300/stale');

-- ---------------------------------------------------------------------------
-- 5. Service role only.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000065604","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000065604';
DO $$ BEGIN
  PERFORM public.renew_subscription_credits_safety_net('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', now(), 999999);
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user called the safety net';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a signed-in user cannot call the safety net';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.renew_subscription_credits_safety_net('00000000-0000-4000-8000-000000065604', 'a0000000-0000-4000-8000-000000065604', now(), 999999);
  RAISE EXCEPTION 'ASSERT FAIL: an anonymous caller called the safety net';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an anonymous caller cannot call the safety net';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('the function is closed to PUBLIC, anon and authenticated, open to service_role',
  (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')::text || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
          || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
     FROM pg_proc p WHERE p.oid = 'public.renew_subscription_credits_safety_net(uuid,uuid,timestamptz,integer)'::regprocedure),
  'falsefalsetrue');
SELECT pg_temp.assert_eq('no attempt touched the pool', pg_temp.account('00000000-0000-4000-8000-000000065604'), '1200/3300/stale');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
