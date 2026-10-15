-- ============================================================================
-- Behavioral proof: monthly credits on yearly plans (migration 527).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000052701 upward).
--
-- `grant_yearly_plan_monthly_credits` is what stands between the hourly cron
-- (backend/src/ee/billing/yearly-plan-monthly-credits.ts) and a user's
-- subscription pool. The cron decides WHICH anchor is due; this function
-- decides whether granting it is still safe, under the profile's row lock.
-- Every assertion below is a way a month could be paid twice, paid to the
-- wrong subscription, or paid at all when it should not be:
--
--   1. grants at an anchor: SETs the pool (never adds), never touches top-ups,
--      writes one ledger row, moves credits_reset_at;
--   2. grants ONCE per anchor — a second call for it (another replica's run,
--      staging and production sharing this database) changes nothing — and
--      again at the next month's anchor;
--   3. refuses an anchor that is in the future, at or past the period end, or
--      past a scheduled cancellation, any anchor once the period has ended,
--      a period or price that moved since the caller read it, a profile
--      marked ended, and a subscription whose payment collection is paused;
--   4. refuses every status but 'active';
--   5. a monthly-price subscription is untouched: the cron only ever sends a
--      yearly price, and a call naming a price the subscription is not on is
--      refused; the one anchor a monthly period holds (its start) is refused
--      once the renewal stamped it;
--   6. refuses another user's subscription, an unknown one, a non-positive
--      amount;
--   7. only the service role may call it — never anon or authenticated;
--   8. a user cannot rewind their own credits_reset_at to make a month due
--      again (the column joined the profiles UPDATE denylist).
-- Two callers racing for the same anchor on two connections cannot be shown
-- in one session; backend/scripts/verify-yearly-monthly-credits-concurrency.mjs
-- proves it in the same CI job.
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

-- The shared period: it started 200 days ago and runs a year, so the anchors
-- at +5 and +6 months have been reached and the one at +7 has not.
CREATE FUNCTION pg_temp.period_start() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('second', now()) - interval '200 days'
$$;

-- grant(user, subscription, price, period start, anchor, credits) as the service role.
CREATE FUNCTION pg_temp.grant_as_service(p_user uuid, p_sub uuid, p_price text, p_start timestamptz, p_anchor timestamptz, p_credits integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v boolean;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.grant_yearly_plan_monthly_credits(p_user, p_sub, p_price, p_start, p_anchor, p_credits);
  RESET ROLE;
  RETURN v;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052701', 'ym-yearly@ym.test',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052702', 'ym-monthly@ym.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052703', 'ym-status@ym.test',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052704', 'ym-ended@ym.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052705', 'ym-canceling@ym.test','{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052706', 'ym-micros@ym.test',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052707', 'ym-flags@ym.test',    '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@ym.test'), '7');

-- The yearly subscriber: 2,500 left of the plan's credits, 3,300 top-up
-- credits, last reset a minute after the period started (the subscription's
-- own creation).
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052701', '00000000-0000-4000-8000-000000052701', 'sub_ym_yearly', 'price_ym_standard_yearly', 'standard', 'active',
        pg_temp.period_start(), pg_temp.period_start() + interval '1 year');
UPDATE profiles SET subscription_credits = 2500, topup_credits = 3300,
                    credits_reset_at = pg_temp.period_start() + interval '1 minute'
 WHERE id = '00000000-0000-4000-8000-000000052701';

-- ---------------------------------------------------------------------------
-- 1. The grant at the +6 month anchor.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('grants at the latest reached anchor',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'true');
SELECT pg_temp.assert_eq('SETs the pool to the plan amount — the 2,500 left over is not added',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '11000');
SELECT pg_temp.assert_eq('top-up credits are untouched',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '3300');
SELECT pg_temp.assert_eq('credits_reset_at moves to the grant time',
  (SELECT (credits_reset_at = now())::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), 'true');
SELECT pg_temp.assert_eq('one ledger row, in the renewal''s shape',
  (SELECT count(*)::text FROM credit_transactions
    WHERE user_id = '00000000-0000-4000-8000-000000052701'
      AND credit_type = 'subscription' AND source = 'subscription_renewal'
      AND description LIKE 'Monthly credits % yearly plan'
      AND amount = 11000 AND balance_after = 11000), '1');

-- ---------------------------------------------------------------------------
-- 2. Once per anchor — and again at the next one.
-- ---------------------------------------------------------------------------
-- The user spends some of the month's credits; a second call for the same
-- anchor (another replica, the other environment) must not refill them.
UPDATE profiles SET subscription_credits = 4000 WHERE id = '00000000-0000-4000-8000-000000052701';
SELECT pg_temp.assert_eq('a second call for the same anchor is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('an earlier anchor is refused too',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '5 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('a refusal changes nothing: the spent-down pool stays spent down',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '4000');
SELECT pg_temp.assert_eq('a refusal writes no ledger row',
  (SELECT count(*)::text FROM credit_transactions WHERE user_id = '00000000-0000-4000-8000-000000052701'), '1');
-- As if that grant had happened at the +5 month anchor: the +6 month anchor
-- is then due again, and grants exactly once more.
UPDATE profiles SET credits_reset_at = pg_temp.period_start() + interval '5 months' + interval '40 minutes'
 WHERE id = '00000000-0000-4000-8000-000000052701';
SELECT pg_temp.assert_eq('the next month''s anchor grants again',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'true');
SELECT pg_temp.assert_eq('and SETs the pool again (4,000 left → 11,000)',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '11000');
SELECT pg_temp.assert_eq('top-ups still untouched',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '3300');

-- ---------------------------------------------------------------------------
-- 3. Anchors and reads that are not safe to grant at. The stamp is cleared
--    (never reset — which on its own would grant) so that only the condition
--    under test can refuse.
-- ---------------------------------------------------------------------------
UPDATE profiles SET subscription_credits = 1234, credits_reset_at = NULL
 WHERE id = '00000000-0000-4000-8000-000000052701';
SELECT pg_temp.assert_eq('an anchor in the future is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '7 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('an anchor before the period start is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() - interval '1 month', 11000)::text, 'false');
SELECT pg_temp.assert_eq('a period start that moved since the caller read it is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start() - interval '1 year', pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('a price that changed since the caller read it is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_pro_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 23000)::text, 'false');
SELECT pg_temp.assert_eq('none of those touched the pool',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '1234');
SELECT pg_temp.assert_eq('the control: with nothing wrong, a never-reset profile is granted',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'true');

-- A row whose year ended and was not moved on yet (webhook pending, cron
-- late): the turn of the year belongs to the renewal. Neither the anchor AT
-- the period end nor a late, never-granted last anchor inside it is paid — a
-- grant now would stamp credits_reset_at past the period end and the safety
-- net would then skip the year-end renewal.
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052704', '00000000-0000-4000-8000-000000052704', 'sub_ym_ended', 'price_ym_standard_yearly', 'standard', 'active',
        date_trunc('second', now()) - interval '13 months', date_trunc('second', now()) - interval '1 month');
UPDATE profiles SET subscription_credits = 700, credits_reset_at = date_trunc('second', now()) - interval '13 months'
 WHERE id = '00000000-0000-4000-8000-000000052704';
SELECT pg_temp.assert_eq('the anchor at the period end is refused (the renewal owns it)',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052704', 'a0000000-0000-4000-8000-000000052704',
    'price_ym_standard_yearly', date_trunc('second', now()) - interval '13 months',
    date_trunc('second', now()) - interval '1 month', 11000)::text, 'false');
SELECT pg_temp.assert_eq('a late last anchor inside an ended period is refused (the renewal owns the year end)',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052704', 'a0000000-0000-4000-8000-000000052704',
    'price_ym_standard_yearly', date_trunc('second', now()) - interval '13 months',
    date_trunc('second', now()) - interval '2 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('the ended period''s pool is untouched (the safety net still sees it due)',
  (SELECT (subscription_credits = 700 AND credits_reset_at < date_trunc('second', now()) - interval '1 month')::text
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000052704'), 'true');

-- A cancel whose update of the subscription row failed leaves that row
-- 'active'; the profile is still marked ended (subscription_ended_at), and an
-- ended profile is paid nothing. The created/updated handlers clear the mark.
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052707', '00000000-0000-4000-8000-000000052707', 'sub_ym_flags', 'price_ym_standard_yearly', 'standard', 'active',
        pg_temp.period_start(), pg_temp.period_start() + interval '1 year');
UPDATE profiles SET subscription_credits = 300, credits_reset_at = pg_temp.period_start() + interval '1 minute',
                    subscription_ended_at = now() - interval '3 days'
 WHERE id = '00000000-0000-4000-8000-000000052707';
SELECT pg_temp.assert_eq('a profile marked ended is refused, though its subscription row still says active',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052707', 'a0000000-0000-4000-8000-000000052707',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
-- Stripe "pause payment collection": the row stays active, only the flag moves.
UPDATE profiles SET subscription_ended_at = NULL WHERE id = '00000000-0000-4000-8000-000000052707';
UPDATE subscriptions SET collection_paused = true WHERE id = 'a0000000-0000-4000-8000-000000052707';
SELECT pg_temp.assert_eq('a subscription whose payment collection is paused is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052707', 'a0000000-0000-4000-8000-000000052707',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('neither touched the pool',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052707'), '300');
UPDATE subscriptions SET collection_paused = false WHERE id = 'a0000000-0000-4000-8000-000000052707';
SELECT pg_temp.assert_eq('the control: unmarked and unpaused, the same call is granted',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052707', 'a0000000-0000-4000-8000-000000052707',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'true');
SELECT pg_temp.assert_eq('a new subscription row starts unpaused',
  (SELECT (NOT collection_paused)::text FROM subscriptions WHERE id = 'a0000000-0000-4000-8000-000000052701'), 'true');

-- A cancellation scheduled inside the period ends the grants there.
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end, cancel_at)
VALUES ('a0000000-0000-4000-8000-000000052705', '00000000-0000-4000-8000-000000052705', 'sub_ym_canceling', 'price_ym_standard_yearly', 'standard', 'active',
        pg_temp.period_start(), pg_temp.period_start() + interval '1 year', pg_temp.period_start() + interval '5 months 10 days');
UPDATE profiles SET subscription_credits = 900, credits_reset_at = pg_temp.period_start() + interval '1 minute'
 WHERE id = '00000000-0000-4000-8000-000000052705';
SELECT pg_temp.assert_eq('an anchor past a scheduled cancel_at is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052705', 'a0000000-0000-4000-8000-000000052705',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('an anchor before it is granted',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052705', 'a0000000-0000-4000-8000-000000052705',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '5 months', 11000)::text, 'true');

-- A period start stored with microseconds. The cron computes anchors at
-- millisecond precision, so its first anchor (k = 0) arrives truncated — and
-- must not read as "before the period start".
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052706', '00000000-0000-4000-8000-000000052706', 'sub_ym_micros', 'price_ym_standard_yearly', 'standard', 'active',
        date_trunc('second', now()) - interval '20 days' + interval '0.123456 seconds',
        date_trunc('second', now()) - interval '20 days' + interval '0.123456 seconds' + interval '1 year');
UPDATE profiles SET subscription_credits = 500, credits_reset_at = NULL
 WHERE id = '00000000-0000-4000-8000-000000052706';
SELECT pg_temp.assert_eq('a microsecond period start is granted at its millisecond first anchor',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052706', 'a0000000-0000-4000-8000-000000052706',
    'price_ym_standard_yearly',
    date_trunc('second', now()) - interval '20 days' + interval '0.123456 seconds',
    date_trunc('second', now()) - interval '20 days' + interval '0.123 seconds', 11000)::text, 'true');

-- ---------------------------------------------------------------------------
-- 4. Every status but 'active' is refused.
-- ---------------------------------------------------------------------------
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052703', '00000000-0000-4000-8000-000000052703', 'sub_ym_status', 'price_ym_standard_yearly', 'standard', 'canceled',
        pg_temp.period_start(), pg_temp.period_start() + interval '1 year');
UPDATE profiles SET subscription_credits = 600, credits_reset_at = pg_temp.period_start() + interval '1 minute'
 WHERE id = '00000000-0000-4000-8000-000000052703';
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['canceled', 'past_due', 'trialing', 'paused', 'incomplete', 'expired'] LOOP
    UPDATE subscriptions SET status = s WHERE id = 'a0000000-0000-4000-8000-000000052703';
    IF pg_temp.grant_as_service('00000000-0000-4000-8000-000000052703', 'a0000000-0000-4000-8000-000000052703',
         'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000) THEN
      RAISE EXCEPTION 'ASSERT FAIL: a % subscription was granted', s;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok  canceled, past_due, trialing, paused, incomplete and expired subscriptions are refused';
END $$;
SELECT pg_temp.assert_eq('an inactive subscription''s pool is untouched',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052703'), '600');
SELECT pg_temp.assert_eq('and it got no ledger row',
  (SELECT count(*)::text FROM credit_transactions WHERE user_id = '00000000-0000-4000-8000-000000052703'), '0');

-- ---------------------------------------------------------------------------
-- 5. A monthly-price subscription is untouched.
-- ---------------------------------------------------------------------------
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES ('a0000000-0000-4000-8000-000000052702', '00000000-0000-4000-8000-000000052702', 'sub_ym_monthly', 'price_ym_standard_monthly', 'standard', 'active',
        date_trunc('second', now()) - interval '10 days', date_trunc('second', now()) - interval '10 days' + interval '1 month');
-- The renewal reset it seconds after the period started.
UPDATE profiles SET subscription_credits = 800, credits_reset_at = date_trunc('second', now()) - interval '10 days' + interval '5 seconds'
 WHERE id = '00000000-0000-4000-8000-000000052702';
SELECT pg_temp.assert_eq('a call naming a yearly price for a monthly subscription is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052702', 'a0000000-0000-4000-8000-000000052702',
    'price_ym_standard_yearly', date_trunc('second', now()) - interval '10 days',
    date_trunc('second', now()) - interval '10 days', 11000)::text, 'false');
SELECT pg_temp.assert_eq('the one anchor a monthly period holds (its start) is refused once the renewal stamped it',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052702', 'a0000000-0000-4000-8000-000000052702',
    'price_ym_standard_monthly', date_trunc('second', now()) - interval '10 days',
    date_trunc('second', now()) - interval '10 days', 11000)::text, 'false');
SELECT pg_temp.assert_eq('the monthly subscriber''s pool is untouched',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052702'), '800');

-- ---------------------------------------------------------------------------
-- 6. The wrong subscription, an unknown one, a non-positive amount.
-- ---------------------------------------------------------------------------
UPDATE profiles SET subscription_credits = 1234, credits_reset_at = pg_temp.period_start() + interval '1 minute'
 WHERE id = '00000000-0000-4000-8000-000000052701';
SELECT pg_temp.assert_eq('another user''s subscription is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052702', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('an unknown subscription is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-0000000527ff',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000)::text, 'false');
SELECT pg_temp.assert_eq('a zero amount is refused',
  pg_temp.grant_as_service('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 0)::text, 'false');
SELECT pg_temp.assert_eq('the yearly subscriber''s pool is still where those refusals found it',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '1234');

-- ---------------------------------------------------------------------------
-- 7. Only the service role may call it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('anon cannot execute it',
  has_function_privilege('anon', 'public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot execute it',
  has_function_privilege('authenticated', 'public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('the service role can',
  has_function_privilege('service_role', 'public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('exactly one overload, SECURITY DEFINER, search_path pinned',
  (SELECT (count(*) = 1 AND bool_and(prosecdef) AND bool_and(array_to_string(proconfig, ',') LIKE '%search_path=%'))::text
     FROM pg_proc WHERE proname = 'grant_yearly_plan_monthly_credits'), 'true');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000052701","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000052701';
DO $$ BEGIN
  PERFORM public.grant_yearly_plan_monthly_credits('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000);
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user granted themselves a month of credits';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a signed-in user cannot call the grant';
END $$;

-- ---------------------------------------------------------------------------
-- 8. Nor rewind their own credits_reset_at to make a month due again.
--    Only the narrowing is proven here. That the same policy still lets this
--    principal make the browser's one real write (last_workspace_id) is
--    proven in profiles-email-not-user-writable.behavior.sql, assertion 4
--    (lines 120-126), against the guard this migration recreated.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  UPDATE profiles SET credits_reset_at = '2000-01-01T00:00:00Z' WHERE id = '00000000-0000-4000-8000-000000052701';
  IF (SELECT credits_reset_at FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701') = '2000-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user rewound their own credits_reset_at';
  END IF;
  RAISE NOTICE 'ok  a user cannot rewind their own credits_reset_at (row unchanged)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot rewind their own credits_reset_at (refused)';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.grant_yearly_plan_monthly_credits('00000000-0000-4000-8000-000000052701', 'a0000000-0000-4000-8000-000000052701',
    'price_ym_standard_yearly', pg_temp.period_start(), pg_temp.period_start() + interval '6 months', 11000);
  RAISE EXCEPTION 'ASSERT FAIL: an anonymous caller granted a month of credits';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an anonymous caller cannot call the grant';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('the stamp survived the user''s attempt',
  (SELECT (credits_reset_at = pg_temp.period_start() + interval '1 minute')::text
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), 'true');
SELECT pg_temp.assert_eq('and so did the pool',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), '1234');
-- The service role, every real writer of the column, still writes it.
SET LOCAL ROLE service_role;
UPDATE profiles SET credits_reset_at = pg_temp.period_start() + interval '2 minutes' WHERE id = '00000000-0000-4000-8000-000000052701';
RESET ROLE;
SELECT pg_temp.assert_eq('the service role still writes credits_reset_at',
  (SELECT (credits_reset_at = pg_temp.period_start() + interval '2 minutes')::text
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000052701'), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
