-- ============================================================================
-- Behavioral proof: a failed renewal charge puts the period's credits on hold;
-- they come back once, when the renewal is paid (migration 654).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000065101 upward).
--
-- `hold_subscription_renewal_credits` is what a `past_due` / `unpaid` update
-- calls; `release_subscription_renewal_credits` is what `invoice.paid`
-- (billing_reason subscription_cycle) calls. What it pins:
--   1. the hold takes the pool (never top-ups), records it against the
--      period, and holds once per period;
--   2. the release ADDs the held amount back once — anything granted during
--      the hold (a plan-change gap) is kept — and records the invoice with
--      what it gave; a replay changes nothing;
--   3. the normal case (reset at the move, never held) records the invoice
--      and gives nothing; a late past_due for a settled period holds nothing;
--   4. a period never reset (its move arrived past_due) is SET to the plan's
--      allocation when paid: the catch-up, which discards an older hold;
--   5. an older or finished period's invoice is recorded and gives nothing;
--   6. a subscription never granted, an ended one and a profile marked ended
--      hold nothing and get nothing (the invoice is still recorded); unknown
--      ones record nothing;
--   7. only the service role may call either function.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/subscription-renewal-credits.behavior.sql
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

-- The period every renewal below is for: it started an hour ago.
CREATE FUNCTION pg_temp.period_start() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('second', now()) - interval '1 hour'
$$;

CREATE FUNCTION pg_temp.hold(p_user uuid, p_sub text, p_start timestamptz)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.hold_subscription_renewal_credits(p_user, p_sub, p_start);
  RESET ROLE;
  RETURN coalesce(v::text, '<null>');
END $$;

-- release(...) → 'outcome/credits'
CREATE FUNCTION pg_temp.release(p_user uuid, p_sub text, p_invoice text, p_start timestamptz, p_credits integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO r FROM public.release_subscription_renewal_credits(
    p_user, p_sub, p_invoice, p_start, p_start + interval '1 month', p_credits, 25.00, 'pro');
  RESET ROLE;
  RETURN r.outcome || '/' || r.credits::text;
END $$;

CREATE FUNCTION pg_temp.pool(p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT subscription_credits::text FROM profiles WHERE id = p_user
$$;

CREATE FUNCTION pg_temp.claim(p_invoice text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT count(*)::text || ':' || coalesce(max(credits_granted)::text, '-') FROM transactions WHERE stripe_transaction_id = p_invoice
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000065101', 'rn-held@rn.test',       '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065102', 'rn-normal@rn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065103', 'rn-catchup@rn.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065104', 'rn-ungranted@rn.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065105', 'rn-ended@rn.test',      '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065106', 'rn-marked@rn.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065107', 'rn-skew@rn.test',       '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065108', 'rn-dropped@rn.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000065109', 'rn-upgraded@rn.test',   '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@rn.test'), '9');

INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end, plan_granted)
VALUES
  ('a0000000-0000-4000-8000-000000065101', '00000000-0000-4000-8000-000000065101', 'sub_rn_held',      'price_rn_pro', 'pro', 'past_due',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065102', '00000000-0000-4000-8000-000000065102', 'sub_rn_normal',    'price_rn_pro', 'pro', 'active',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065103', '00000000-0000-4000-8000-000000065103', 'sub_rn_catchup',   'price_rn_pro', 'pro', 'past_due',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065104', '00000000-0000-4000-8000-000000065104', 'sub_rn_ungranted', 'price_rn_pro', 'pro', 'incomplete',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', false),
  ('a0000000-0000-4000-8000-000000065105', '00000000-0000-4000-8000-000000065105', 'sub_rn_ended',     'price_rn_pro', 'pro', 'canceled',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065106', '00000000-0000-4000-8000-000000065106', 'sub_rn_marked',    'price_rn_pro', 'pro', 'active',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065107', '00000000-0000-4000-8000-000000065107', 'sub_rn_skew',      'price_rn_pro', 'pro', 'past_due',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065108', '00000000-0000-4000-8000-000000065108', 'sub_rn_dropped',   'price_rn_pro', 'pro', 'active',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true),
  ('a0000000-0000-4000-8000-000000065109', '00000000-0000-4000-8000-000000065109', 'sub_rn_upgraded',  'price_rn_pro', 'pro', 'past_due',
   pg_temp.period_start(), pg_temp.period_start() + interval '1 month', true);

-- Everyone was reset at this period's move (a few seconds after its start) and
-- has spent some of it; everyone holds top-up credits too.
UPDATE profiles SET subscription_credits = 20000, topup_credits = 3300,
                    credits_reset_at = pg_temp.period_start() + interval '4 seconds'
 WHERE email LIKE '%@rn.test';
UPDATE profiles SET subscription_ended_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-000000065106';

-- ---------------------------------------------------------------------------
-- 1. The hold.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a failed renewal holds the whole pool',
  pg_temp.hold('00000000-0000-4000-8000-000000065101', 'sub_rn_held', pg_temp.period_start()), '20000');
SELECT pg_temp.assert_eq('...the pool is empty', pg_temp.pool('00000000-0000-4000-8000-000000065101'), '0');
SELECT pg_temp.assert_eq('...top-ups are untouched',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000065101'), '3300');
SELECT pg_temp.assert_eq('...the hold is recorded against the period',
  (SELECT (renewal_credits_held::text || '@' || (renewal_hold_period_start = pg_temp.period_start())::text)
     FROM subscriptions WHERE stripe_subscription_id = 'sub_rn_held'), '20000@true');
SELECT pg_temp.assert_eq('the hold writes no ledger row (the caller does)',
  (SELECT count(*)::text FROM credit_transactions WHERE user_id = '00000000-0000-4000-8000-000000065101'), '0');
SELECT pg_temp.assert_eq('a second hold for the same period holds nothing',
  pg_temp.hold('00000000-0000-4000-8000-000000065101', 'sub_rn_held', pg_temp.period_start()), '<null>');
SELECT pg_temp.assert_eq('...and keeps the first amount',
  (SELECT renewal_credits_held::text FROM subscriptions WHERE stripe_subscription_id = 'sub_rn_held'), '20000');
SELECT pg_temp.assert_eq('a hold for a period the subscription has left holds nothing',
  pg_temp.hold('00000000-0000-4000-8000-000000065101', 'sub_rn_held', pg_temp.period_start() - interval '1 month'), '<null>');

-- ---------------------------------------------------------------------------
-- 2. The release ADDs the held amount back, once.
-- ---------------------------------------------------------------------------
-- A plan-change gap granted during the hold.
UPDATE profiles SET subscription_credits = 1500 WHERE id = '00000000-0000-4000-8000-000000065101';
SELECT pg_temp.assert_eq('the paid renewal releases the held amount',
  pg_temp.release('00000000-0000-4000-8000-000000065101', 'sub_rn_held', 'in_rn_1', pg_temp.period_start(), 23000), 'released/20000');
SELECT pg_temp.assert_eq('...ADDed to the pool: the 1,500 granted during the hold is kept',
  pg_temp.pool('00000000-0000-4000-8000-000000065101'), '21500');
SELECT pg_temp.assert_eq('...the invoice is recorded with what it gave', pg_temp.claim('in_rn_1'), '1:20000');
SELECT pg_temp.assert_eq('...the hold is cleared, the period marked settled',
  (SELECT coalesce(renewal_credits_held::text, '<null>') || '@' || (renewal_hold_period_start = pg_temp.period_start())::text
     FROM subscriptions WHERE stripe_subscription_id = 'sub_rn_held'), '<null>@true');
SELECT pg_temp.assert_eq('the same invoice again is a replay',
  pg_temp.release('00000000-0000-4000-8000-000000065101', 'sub_rn_held', 'in_rn_1', pg_temp.period_start(), 23000), 'replay/0');
SELECT pg_temp.assert_eq('...and gives nothing more', pg_temp.pool('00000000-0000-4000-8000-000000065101'), '21500');
SELECT pg_temp.assert_eq('...and records nothing twice', pg_temp.claim('in_rn_1'), '1:20000');
SELECT pg_temp.assert_eq('a late past_due for the settled period holds nothing',
  pg_temp.hold('00000000-0000-4000-8000-000000065101', 'sub_rn_held', pg_temp.period_start()), '<null>');
SELECT pg_temp.assert_eq('...the pool is untouched', pg_temp.pool('00000000-0000-4000-8000-000000065101'), '21500');

-- ---------------------------------------------------------------------------
-- 3. The normal case: reset at the move, never held, paid an hour later.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the normal paid renewal gives nothing',
  pg_temp.release('00000000-0000-4000-8000-000000065102', 'sub_rn_normal', 'in_rn_2', pg_temp.period_start(), 23000), 'recorded/0');
SELECT pg_temp.assert_eq('...the pool is untouched', pg_temp.pool('00000000-0000-4000-8000-000000065102'), '20000');
SELECT pg_temp.assert_eq('...the invoice is recorded with 0', pg_temp.claim('in_rn_2'), '1:0');

-- ---------------------------------------------------------------------------
-- 4. The catch-up: a move that arrived past_due reset nothing.
-- ---------------------------------------------------------------------------
UPDATE profiles SET subscription_credits = 700, credits_reset_at = pg_temp.period_start() - interval '1 month' + interval '4 seconds'
 WHERE id = '00000000-0000-4000-8000-000000065103';
SELECT pg_temp.assert_eq('the past_due event holds last period''s leftovers',
  pg_temp.hold('00000000-0000-4000-8000-000000065103', 'sub_rn_catchup', pg_temp.period_start()), '700');
SELECT pg_temp.assert_eq('the paid renewal of a period never reset SETs the allocation',
  pg_temp.release('00000000-0000-4000-8000-000000065103', 'sub_rn_catchup', 'in_rn_3', pg_temp.period_start(), 23000), 'renewed/23000');
SELECT pg_temp.assert_eq('...the pool is the allocation (the old leftovers are not added)',
  pg_temp.pool('00000000-0000-4000-8000-000000065103'), '23000');
SELECT pg_temp.assert_eq('...the reset is stamped',
  (SELECT (credits_reset_at = now())::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000065103'), 'true');
SELECT pg_temp.assert_eq('...the old hold is discarded',
  (SELECT coalesce(renewal_credits_held::text, '<null>') FROM subscriptions WHERE stripe_subscription_id = 'sub_rn_catchup'), '<null>');
SELECT pg_temp.assert_eq('...the invoice is recorded with what it gave', pg_temp.claim('in_rn_3'), '1:23000');

-- ---------------------------------------------------------------------------
-- 5. An older or finished period's invoice.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('an older period''s invoice gives nothing',
  pg_temp.release('00000000-0000-4000-8000-000000065102', 'sub_rn_normal', 'in_rn_old', pg_temp.period_start() - interval '1 month', 23000), 'recorded/0');
SELECT pg_temp.assert_eq('...the pool is untouched', pg_temp.pool('00000000-0000-4000-8000-000000065102'), '20000');
SELECT pg_temp.assert_eq('...it is recorded', pg_temp.claim('in_rn_old'), '1:0');

-- ---------------------------------------------------------------------------
-- 6. Never granted, ended, marked ended, unknown.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a subscription never granted holds nothing',
  pg_temp.hold('00000000-0000-4000-8000-000000065104', 'sub_rn_ungranted', pg_temp.period_start()), '<null>');
SELECT pg_temp.assert_eq('...and its paid invoice gives nothing',
  pg_temp.release('00000000-0000-4000-8000-000000065104', 'sub_rn_ungranted', 'in_rn_4', pg_temp.period_start(), 23000), 'recorded/0');
SELECT pg_temp.assert_eq('an ended subscription holds nothing',
  pg_temp.hold('00000000-0000-4000-8000-000000065105', 'sub_rn_ended', pg_temp.period_start()), '<null>');
SELECT pg_temp.assert_eq('...and its paid invoice gives nothing',
  pg_temp.release('00000000-0000-4000-8000-000000065105', 'sub_rn_ended', 'in_rn_5', pg_temp.period_start(), 23000), 'recorded/0');
SELECT pg_temp.assert_eq('a profile marked ended gets nothing',
  pg_temp.release('00000000-0000-4000-8000-000000065106', 'sub_rn_marked', 'in_rn_6', pg_temp.period_start(), 23000), 'recorded/0');
SELECT pg_temp.assert_eq('...pools untouched',
  (SELECT string_agg(subscription_credits::text, ',' ORDER BY email) FROM profiles
    WHERE id IN ('00000000-0000-4000-8000-000000065104', '00000000-0000-4000-8000-000000065105', '00000000-0000-4000-8000-000000065106')),
  '20000,20000,20000');
SELECT pg_temp.assert_eq('another user''s subscription is unknown',
  pg_temp.release('00000000-0000-4000-8000-000000065102', 'sub_rn_held', 'in_rn_x', pg_temp.period_start(), 23000), 'unknown/0');
SELECT pg_temp.assert_eq('...and records nothing', pg_temp.claim('in_rn_x'), '0:-');

-- ---------------------------------------------------------------------------
-- 6b. The review's cases: start skew, a dropped hold, an upgrade while waiting.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a hold for this period',
  pg_temp.hold('00000000-0000-4000-8000-000000065107', 'sub_rn_skew', pg_temp.period_start()), '20000');
SELECT pg_temp.assert_eq('an invoice whose line starts 30 s off the event''s period still releases it',
  pg_temp.release('00000000-0000-4000-8000-000000065107', 'sub_rn_skew', 'in_rn_7', pg_temp.period_start() - interval '30 seconds', 23000), 'released/20000');
SELECT pg_temp.assert_eq('...the pool is back', pg_temp.pool('00000000-0000-4000-8000-000000065107'), '20000');

-- A hold left from last period (never paid), then this period reset normally.
UPDATE subscriptions SET renewal_hold_period_start = pg_temp.period_start() - interval '1 month', renewal_credits_held = 800
 WHERE stripe_subscription_id = 'sub_rn_dropped';
SELECT pg_temp.assert_eq('a hold for another period is reported as dropped, not released',
  pg_temp.release('00000000-0000-4000-8000-000000065108', 'sub_rn_dropped', 'in_rn_8', pg_temp.period_start(), 23000), 'dropped/800');
SELECT pg_temp.assert_eq('...the pool is untouched', pg_temp.pool('00000000-0000-4000-8000-000000065108'), '20000');
SELECT pg_temp.assert_eq('...the hold is cleared',
  (SELECT coalesce(renewal_credits_held::text, '<null>') FROM subscriptions WHERE stripe_subscription_id = 'sub_rn_dropped'), '<null>');
SELECT pg_temp.assert_eq('...the invoice is recorded with 0', pg_temp.claim('in_rn_8'), '1:0');

-- The move arrived past_due (never reset), the user upgraded while waiting.
UPDATE profiles SET subscription_credits = 700, credits_reset_at = pg_temp.period_start() - interval '1 month'
 WHERE id = '00000000-0000-4000-8000-000000065109';
SELECT pg_temp.assert_eq('the past_due event holds the leftovers',
  pg_temp.hold('00000000-0000-4000-8000-000000065109', 'sub_rn_upgraded', pg_temp.period_start()), '700');
UPDATE profiles SET subscription_credits = 30000 WHERE id = '00000000-0000-4000-8000-000000065109';
SELECT pg_temp.assert_eq('the catch-up never lowers the pool: the upgrade''s credits are kept',
  pg_temp.release('00000000-0000-4000-8000-000000065109', 'sub_rn_upgraded', 'in_rn_9', pg_temp.period_start(), 23000), 'renewed/30000');
SELECT pg_temp.assert_eq('...the pool', pg_temp.pool('00000000-0000-4000-8000-000000065109'), '30000');

-- ---------------------------------------------------------------------------
-- 7. Service role only.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000065102","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000065102';
DO $$ BEGIN
  PERFORM public.hold_subscription_renewal_credits('00000000-0000-4000-8000-000000065102', 'sub_rn_normal', now());
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user called the hold';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a signed-in user cannot call the hold';
END $$;
DO $$ BEGIN
  PERFORM public.release_subscription_renewal_credits('00000000-0000-4000-8000-000000065102', 'sub_rn_normal', 'in_rn_self',
    now(), now() + interval '1 month', 999999, 0, 'pro');
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user called the release';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a signed-in user cannot call the release';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.release_subscription_renewal_credits('00000000-0000-4000-8000-000000065102', 'sub_rn_normal', 'in_rn_anon',
    now(), now() + interval '1 month', 999999, 0, 'pro');
  RAISE EXCEPTION 'ASSERT FAIL: an anonymous caller called the release';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an anonymous caller cannot call the release';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('no attempt touched the pool', pg_temp.pool('00000000-0000-4000-8000-000000065102'), '20000');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
