-- ============================================================================
-- Behavioral proof: one live granted subscription per account, decided where
-- the plan grant is claimed (migration 663).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000066301 upward).
--
-- `claim_subscription_grant(stripe subscription id, user id)` is the webhook's
-- one claim of a subscription's plan grant (subscription-grant.ts). What it
-- pins:
--   1. claimed: a recorded, ungranted, not-ended subscription of this account
--      with no other claimed or granted live one is marked granted and its
--      claim time stamped, and nothing else on the row moves;
--   2. not_claimable: the same subscription again (a redelivered event) — even
--      once it is live, it is never other_live; an ended subscription; a
--      missing one; another account's subscription; bad input. Nothing moves;
--   3. other_live: another subscription of the account that has not ended is
--      claimed (plan_claimed_at) — even while still `incomplete`, before the
--      webhook writes its live status — or granted and live (active,
--      trialing, past_due, unpaid): its Stripe id is named and nothing is
--      written. A trialing pair is refused too;
--   4. what does not block: another subscription that ended (claimed or
--      not), one live but never granted, one whose claim was released, one
--      granted before the claim marker existed and stuck `incomplete`, and
--      another account's live granted subscription;
--   5. only the service role may call it.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/subscription-claim-one-live.behavior.sql
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

-- claim(stripe subscription id, user) → 'outcome' or 'outcome:other id', as the service role.
CREATE FUNCTION pg_temp.claim(p_sub text, p_user uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0; v text;
BEGIN
  SET LOCAL ROLE service_role;
  FOR r IN SELECT * FROM public.claim_subscription_grant(p_sub, p_user) LOOP
    n := n + 1;
    v := r.outcome || coalesce(':' || r.other_stripe_subscription_id, '');
  END LOOP;
  RESET ROLE;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: claim answered % rows', n;
  END IF;
  RETURN v;
END $$;

-- Whether a subscription row carries a claim time.
CREATE FUNCTION pg_temp.claimed(p_sub text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN plan_claimed_at IS NULL THEN 'unclaimed' ELSE 'claimed' END FROM subscriptions WHERE stripe_subscription_id = p_sub
$$;

-- A subscription row as status/granted.
CREATE FUNCTION pg_temp.sub(p_sub text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT status || '/' || plan_granted::text FROM subscriptions WHERE stripe_subscription_id = p_sub
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000066301', 'cl-claim@cl.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066302', 'cl-trial@cl.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066303', 'cl-ended@cl.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066304', 'cl-ungranted@cl.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066305', 'cl-owner@cl.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066306', 'cl-neighbour@cl.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066307', 'cl-pastdue@cl.test',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066308', 'cl-legacy@cl.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066309', 'cl-released@cl.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000066310', 'cl-endclaim@cl.test',  '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@cl.test'), '10');

INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end, plan_granted, created_at)
VALUES
  -- 1-3: one account, two subscriptions recorded unpaid.
  ('00000000-0000-4000-8000-000000066301', 'sub_cl_a',        'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066301', 'sub_cl_b',        'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- A trialing pair: one granted, the other not yet.
  ('00000000-0000-4000-8000-000000066302', 'sub_cl_trial_1',  'price_cl_pro', 'pro', 'trialing',   now(), now() + interval '1 month', true,  now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066302', 'sub_cl_trial_2',  'price_cl_pro', 'pro', 'trialing',   now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- Every ended status, granted, then a new subscription.
  ('00000000-0000-4000-8000-000000066303', 'sub_cl_canceled', 'price_cl_pro', 'pro', 'canceled',           now(), now(), true,  now() - interval '4 minutes'),
  ('00000000-0000-4000-8000-000000066303', 'sub_cl_expired',  'price_cl_pro', 'pro', 'expired',            now(), now(), true,  now() - interval '3 minutes'),
  ('00000000-0000-4000-8000-000000066303', 'sub_cl_inc_exp',  'price_cl_pro', 'pro', 'incomplete_expired', now(), now(), false, now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066303', 'sub_cl_new',      'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- A live subscription that was never granted (a refused second one), then another.
  ('00000000-0000-4000-8000-000000066304', 'sub_cl_refused',  'price_cl_pro', 'pro', 'trialing',   now(), now() + interval '1 month', false, now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066304', 'sub_cl_next',     'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- Two accounts: one with a live granted plan, its neighbour subscribing.
  ('00000000-0000-4000-8000-000000066305', 'sub_cl_owner',    'price_cl_pro', 'pro', 'active',     now(), now() + interval '1 month', true,  now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066306', 'sub_cl_neigh',    'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- past_due and unpaid granted subscriptions still hold the account.
  ('00000000-0000-4000-8000-000000066307', 'sub_cl_pastdue',  'price_cl_pro', 'pro', 'past_due',   now(), now() + interval '1 month', true,  now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066307', 'sub_cl_after',    'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- Granted by the column's default before migration 650, never paid: stuck incomplete, no claim time.
  ('00000000-0000-4000-8000-000000066308', 'sub_cl_legacy',   'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', true,  now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066308', 'sub_cl_fresh',    'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- Two recorded unpaid: the first will be claimed, then released.
  ('00000000-0000-4000-8000-000000066309', 'sub_cl_rel_a',    'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066309', 'sub_cl_rel_b',    'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute'),
  -- Two recorded unpaid: the first will be claimed, then cancelled before its status is written.
  ('00000000-0000-4000-8000-000000066310', 'sub_cl_endc_a',   'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000066310', 'sub_cl_endc_b',   'price_cl_pro', 'pro', 'incomplete', now(), now() + interval '1 month', false, now() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- 1. claimed
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a recorded, ungranted subscription with no other live grant is claimed',
  pg_temp.claim('sub_cl_a', '00000000-0000-4000-8000-000000066301'), 'claimed');
SELECT pg_temp.assert_eq('...it is marked granted and its claim time stamped, its status untouched (the webhook writes it)',
  pg_temp.sub('sub_cl_a') || ' ' || pg_temp.claimed('sub_cl_a'), 'incomplete/true claimed');

-- The window: A is claimed but its live status is not written yet.
SELECT pg_temp.assert_eq('a second subscription claimed while the first is claimed but still incomplete is other_live, naming the first',
  pg_temp.claim('sub_cl_b', '00000000-0000-4000-8000-000000066301'), 'other_live:sub_cl_a');
SELECT pg_temp.assert_eq('...nothing is written for the second',
  pg_temp.sub('sub_cl_b') || ' ' || pg_temp.claimed('sub_cl_b'), 'incomplete/false unclaimed');

-- ---------------------------------------------------------------------------
-- 2. not_claimable — the redelivery case first.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the same subscription claimed again (a redelivered event) is not_claimable',
  pg_temp.claim('sub_cl_a', '00000000-0000-4000-8000-000000066301'), 'not_claimable');
UPDATE subscriptions SET status = 'active' WHERE stripe_subscription_id = 'sub_cl_a';
SELECT pg_temp.assert_eq('...and once it is live, its own redelivery is still not_claimable, never other_live',
  pg_temp.claim('sub_cl_a', '00000000-0000-4000-8000-000000066301'), 'not_claimable');
SELECT pg_temp.assert_eq('...nothing moved', pg_temp.sub('sub_cl_a'), 'active/true');

SELECT pg_temp.assert_eq('an ended subscription (canceled) is not_claimable',
  pg_temp.claim('sub_cl_canceled', '00000000-0000-4000-8000-000000066303'), 'not_claimable');
SELECT pg_temp.assert_eq('an ended subscription (incomplete_expired, never granted) is not_claimable',
  pg_temp.claim('sub_cl_inc_exp', '00000000-0000-4000-8000-000000066303'), 'not_claimable');
SELECT pg_temp.assert_eq('...and stays ungranted', pg_temp.sub('sub_cl_inc_exp'), 'incomplete_expired/false');
SELECT pg_temp.assert_eq('a subscription that does not exist is not_claimable',
  pg_temp.claim('sub_cl_missing', '00000000-0000-4000-8000-000000066301'), 'not_claimable');
SELECT pg_temp.assert_eq('another account''s subscription is not_claimable',
  pg_temp.claim('sub_cl_neigh', '00000000-0000-4000-8000-000000066305'), 'not_claimable');
SELECT pg_temp.assert_eq('...and that subscription is untouched', pg_temp.sub('sub_cl_neigh'), 'incomplete/false');
SELECT pg_temp.assert_eq('no subscription id is not_claimable',
  pg_temp.claim(NULL, '00000000-0000-4000-8000-000000066301'), 'not_claimable');
SELECT pg_temp.assert_eq('no account is not_claimable',
  pg_temp.claim('sub_cl_b', NULL), 'not_claimable');

-- ---------------------------------------------------------------------------
-- 3. other_live
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a second subscription while the first is granted and active is other_live, naming the first',
  pg_temp.claim('sub_cl_b', '00000000-0000-4000-8000-000000066301'), 'other_live:sub_cl_a');
SELECT pg_temp.assert_eq('...nothing is written: the second stays as recorded', pg_temp.sub('sub_cl_b'), 'incomplete/false');
SELECT pg_temp.assert_eq('...and the first is untouched', pg_temp.sub('sub_cl_a'), 'active/true');

SELECT pg_temp.assert_eq('a trialing pair: the second is other_live',
  pg_temp.claim('sub_cl_trial_2', '00000000-0000-4000-8000-000000066302'), 'other_live:sub_cl_trial_1');
SELECT pg_temp.assert_eq('...and stays ungranted', pg_temp.sub('sub_cl_trial_2'), 'trialing/false');

SELECT pg_temp.assert_eq('a granted past_due subscription holds the account',
  pg_temp.claim('sub_cl_after', '00000000-0000-4000-8000-000000066307'), 'other_live:sub_cl_pastdue');
UPDATE subscriptions SET status = 'unpaid' WHERE stripe_subscription_id = 'sub_cl_pastdue';
SELECT pg_temp.assert_eq('so does a granted unpaid one',
  pg_temp.claim('sub_cl_after', '00000000-0000-4000-8000-000000066307'), 'other_live:sub_cl_pastdue');

-- ---------------------------------------------------------------------------
-- 4. What does not block.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('granted subscriptions that ended (canceled, expired, incomplete_expired) do not block a new one',
  pg_temp.claim('sub_cl_new', '00000000-0000-4000-8000-000000066303'), 'claimed');
SELECT pg_temp.assert_eq('...it is marked granted', pg_temp.sub('sub_cl_new'), 'incomplete/true');

SELECT pg_temp.assert_eq('a row granted before the claim marker and stuck incomplete (no claim time) does not block',
  pg_temp.claim('sub_cl_fresh', '00000000-0000-4000-8000-000000066308'), 'claimed');

SELECT pg_temp.assert_eq('the first of two claimed',
  pg_temp.claim('sub_cl_rel_a', '00000000-0000-4000-8000-000000066309'), 'claimed');
SELECT pg_temp.assert_eq('...blocks the second while claimed',
  pg_temp.claim('sub_cl_rel_b', '00000000-0000-4000-8000-000000066309'), 'other_live:sub_cl_rel_a');
-- Its grant write failed: the webhook releases the claim (releaseSubscriptionGrant).
UPDATE subscriptions SET plan_granted = false, plan_claimed_at = NULL WHERE stripe_subscription_id = 'sub_cl_rel_a';
SELECT pg_temp.assert_eq('a released claim does not block: the second is claimed',
  pg_temp.claim('sub_cl_rel_b', '00000000-0000-4000-8000-000000066309'), 'claimed');

SELECT pg_temp.assert_eq('the first of two claimed (cancel case)',
  pg_temp.claim('sub_cl_endc_a', '00000000-0000-4000-8000-000000066310'), 'claimed');
UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = 'sub_cl_endc_a';
SELECT pg_temp.assert_eq('a claimed subscription that ended does not block, though its claim time stays',
  pg_temp.claimed('sub_cl_endc_a') || ' ' || pg_temp.claim('sub_cl_endc_b', '00000000-0000-4000-8000-000000066310'), 'claimed claimed');

SELECT pg_temp.assert_eq('a live subscription that was never granted does not block another',
  pg_temp.claim('sub_cl_next', '00000000-0000-4000-8000-000000066304'), 'claimed');

SELECT pg_temp.assert_eq('another account''s live granted subscription does not block',
  pg_temp.claim('sub_cl_neigh', '00000000-0000-4000-8000-000000066306'), 'claimed');
SELECT pg_temp.assert_eq('...the neighbour''s row is granted, the owner''s untouched',
  pg_temp.sub('sub_cl_neigh') || ' ' || pg_temp.sub('sub_cl_owner'), 'incomplete/true active/true');

UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = 'sub_cl_a';
SELECT pg_temp.assert_eq('once the first is canceled, the second is claimed',
  pg_temp.claim('sub_cl_b', '00000000-0000-4000-8000-000000066301'), 'claimed');

-- ---------------------------------------------------------------------------
-- 5. Only the service role.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000066302","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000066302';
DO $$ BEGIN
  PERFORM public.claim_subscription_grant('sub_cl_trial_2', '00000000-0000-4000-8000-000000066302');
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user claimed a plan grant';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a signed-in user cannot claim a plan grant';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.claim_subscription_grant('sub_cl_trial_2', '00000000-0000-4000-8000-000000066302');
  RAISE EXCEPTION 'ASSERT FAIL: an anonymous caller claimed a plan grant';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an anonymous caller cannot claim a plan grant';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('the function is closed to PUBLIC, anon and authenticated, open to service_role',
  (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')::text || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
          || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
     FROM pg_proc p WHERE p.oid = 'public.claim_subscription_grant(text,uuid)'::regprocedure),
  'falsefalsetrue');
SELECT pg_temp.assert_eq('PUBLIC holds no EXECUTE',
  (SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.claim_subscription_grant(text,uuid)'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'), '0');
SELECT pg_temp.assert_eq('SECURITY DEFINER with a pinned search_path',
  (SELECT prosecdef::text || ' ' || array_to_string(proconfig, ',')
     FROM pg_proc WHERE oid = 'public.claim_subscription_grant(text,uuid)'::regprocedure),
  'true search_path=public, pg_temp');
SELECT pg_temp.assert_eq('no refused attempt touched the trialing pair',
  pg_temp.sub('sub_cl_trial_1') || ' ' || pg_temp.sub('sub_cl_trial_2'), 'trialing/true trialing/false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
