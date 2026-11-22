-- ============================================================================
-- Behavioral proof — 684_first_remake_offer.sql ("First Remake on us")
-- ============================================================================
-- Runs after the full migration chain (CI: migration-behavior job), inside a
-- transaction it rolls back, through the real reserve / commit / refund RPCs.
-- The cover is held on the offer row, never in the pools:
--   A  a covered run that completes: cover = quote - balance; own credits are
--      drawn first; the hold's unused part goes back to the COVER; the offer
--      ends only when the last hold settles; balance 0; used; never again;
--   B  the grant is idempotent per job;
--   C  a covered run that fails before the cover paid anything: released, the
--      account's own credits paid only what was delivered;
--   C2 a covered run that fails after the cover paid part of it: used (that part
--      is ours to lose), the unspent cover dropped, own credits untouched;
--   D  one offer per account (race backstop index);
--   E  the first run takes the offer needed or not (cover 0) and is used when
--      it completes; later runs take nothing; E2 a failed one releases it;
--   F  eligibility: every purchase record; a free trial is no purchase, a
--      converted one is;
--   H  an abandoned run gives up its offer;
--   I  delete-forever and trash of a covered run are refused while its offer
--      is in use (a cancelled run too); once the offer ended its row may go;
--   J  a covered run's LLM side hold draws on the cover; a cancelled run's
--      child that bills itself from the cover makes the offer used;
--   K  the cover is unreachable from anything else: another job's hold, an
--      app's creator fee, a metered overrun (another job's and the run's own),
--      an admin debit; a refund after the offer ended returns only the pools'
--      share;
--   L  every SQL function that writes the pools (either SET form) is known,
--      and only the settle paths of 684 may read the cover;
--   O  the narrow fence: while a cover is held, the account's other holds are
--      refused; a cover used up or of 0 fences nothing;
--   P  on the run job itself only its fee (or its LLM side hold) draws on the
--      cover;
--   Q  a cancelled run whose child is still out cannot be deleted (nor its
--      workflow, project or child); once the child settled and the offer ended
--      it can; deleting the account is not refused; an orphaned hold is never
--      refunded by the sweep (it alerts), only by the admin path;
--   M  another Video Remake run that completes uses the offer;
--   N  the sweep alerts on a finalize error and on an offer in use too long;
--   R  the sweep ends an offer still in use 24 hours after its run ended: the
--      unspent cover dropped, used when a hold still out drew on the cover;
--      that hold settling later gives back only the account's own share;
--      a released one when nothing drew on it; a pending child with no hold
--      may be deleted while the offer is in use.
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, got text, want text) RETURNS void AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAILED: % — got %, want %', label, coalesce(got, '<null>'), coalesce(want, '<null>');
  END IF;
  RAISE NOTICE 'ok %', label;
END;
$fn$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.balance(p uuid) RETURNS integer AS $fn$
  SELECT COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0) FROM profiles WHERE id = p;
$fn$ LANGUAGE sql;

CREATE FUNCTION pg_temp.offer(j uuid) RETURNS text AS $fn$
  SELECT status || '/' || cover_remaining || '/' || cover_spent FROM first_remake_offers WHERE job_id = j;
$fn$ LANGUAGE sql;

CREATE FUNCTION pg_temp.raises(p_sql text) RETURNS text AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN split_part(SQLERRM, ':', 1);
END;
$fn$ LANGUAGE plpgsql;

-- An account that never paid, with 300 free credits, and a run job of it.
CREATE FUNCTION pg_temp.account(u uuid) RETURNS void AS $fn$
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u, u::text || '@example.com');
  UPDATE profiles SET subscription_credits = 300, topup_credits = 0, lifetime_topup_credits = 0,
         tier = 'free', subscription_tier = 'free', free_grant_state = 'granted' WHERE id = u;
END;
$fn$ LANGUAGE plpgsql;
CREATE FUNCTION pg_temp.job(id uuid, u uuid, kind text DEFAULT 'cast-swap', parent uuid DEFAULT NULL) RETURNS uuid AS $fn$
  INSERT INTO jobs (id, user_id, status, job_type, input_data, parent_job_id)
  VALUES (id, u, 'pending', kind, jsonb_build_object('type', kind), parent) RETURNING id;
$fn$ LANGUAGE sql;

-- ------------------------------------------------------------ A + B: completes
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068401';
  j uuid := 'a0000000-0000-4000-8000-000000068401';
  c uuid := 'b0000000-0000-4000-8000-000000068401';
  v_fee uuid;
  v_child uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM pg_temp.assert_eq('A state before', first_remake_offer_state(u), 'available');
  PERFORM pg_temp.assert_eq('A cover = quote - balance', grant_first_remake_cover(u, j, 520)::text, '220');
  PERFORM pg_temp.assert_eq('A the cover is not in the balance', pg_temp.balance(u)::text, '300');
  PERFORM pg_temp.assert_eq('A held on the offer', pg_temp.offer(j), 'in_use/220/0');
  PERFORM pg_temp.assert_eq('B a repeat holds nothing more', grant_first_remake_cover(u, j, 520)::text, '220');
  PERFORM pg_temp.assert_eq('B still one cover', pg_temp.offer(j), 'in_use/220/0');

  v_fee := reserve_credits(u, 12, j, 'cast-swap');
  PERFORM pg_temp.assert_eq('A the fee is paid by own credits', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '288/in_use/220/0');
  v_child := reserve_credits(u, 508, c, 'seedance-2-5');
  PERFORM pg_temp.assert_eq('A the child: own credits first, then the cover',
    pg_temp.balance(u)::text || '/' || pg_temp.offer(j) || '/' || (SELECT metadata->>'from_cover' FROM usage_logs WHERE id = v_child), '0/in_use/0/0/220');
  PERFORM pg_temp.assert_eq('A both holds recorded', (SELECT cardinality(hold_ids) FROM first_remake_offers WHERE job_id = j)::text, '2');

  PERFORM commit_credits(v_child, 418);
  PERFORM pg_temp.assert_eq('A the unused 90 goes back to the cover, not the balance',
    pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '0/in_use/90/130');
  UPDATE jobs SET status = 'completed' WHERE id = j;
  PERFORM pg_temp.assert_eq('A completed with the fee held: not yet', first_remake_offer_state(u), 'in_use');
  PERFORM commit_credits(v_fee, 12);
  PERFORM pg_temp.assert_eq('A ended: used, the rest of the cover dropped', pg_temp.offer(j), 'used/0/130');
  PERFORM pg_temp.assert_eq('A balance 0', pg_temp.balance(u)::text, '0');
  PERFORM pg_temp.assert_eq('A the ledger says what the offer paid',
    (SELECT amount || '/' || balance_after FROM credit_transactions WHERE user_id = u AND source = 'first_remake_cover'), '130/0');
  PERFORM pg_temp.assert_eq('A settled', (SELECT settled_credits FROM first_remake_offers WHERE job_id = j)::text, '430');
  PERFORM pg_temp.assert_eq('A finalize is idempotent', finalize_first_remake_offer(j), 'used');
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068441', u);
  PERFORM pg_temp.assert_eq('A used: no new cover',
    pg_temp.raises($q$SELECT grant_first_remake_cover('00000000-0000-4000-8000-000000068401', 'a0000000-0000-4000-8000-000000068441', 520)$q$),
    'FIRST_REMAKE_UNAVAILABLE');
END $$;

-- --------------------------------- C: fails before the cover paid anything
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068402';
  j uuid := 'a0000000-0000-4000-8000-000000068402';
  v_fee uuid; v_pic uuid; v_video uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job('b0000000-0000-4000-8000-000000068402', u, 'generate-image', j);
  PERFORM pg_temp.job('b0000000-0000-4000-8000-000000068422', u, 'generate-video', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  v_fee := reserve_credits(u, 12, j, 'cast-swap');
  v_pic := reserve_credits(u, 40, 'b0000000-0000-4000-8000-000000068402', 'gpt-image-2');
  PERFORM commit_credits(v_pic, 40);
  v_video := reserve_credits(u, 400, 'b0000000-0000-4000-8000-000000068422', 'seedance-2-5');
  PERFORM pg_temp.assert_eq('C the video drew 152 of the cover', pg_temp.offer(j), 'in_use/68/0');
  PERFORM refund_credits(v_video);
  PERFORM pg_temp.assert_eq('C its refund: the cover share back to the cover, own back to the balance',
    pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '248/in_use/220/0');
  UPDATE jobs SET status = 'failed' WHERE id = j;
  PERFORM refund_credits(v_fee);
  PERFORM pg_temp.assert_eq('C released: the cover paid nothing', pg_temp.offer(j), 'released/0/0');
  PERFORM pg_temp.assert_eq('C own credits paid the picture only', pg_temp.balance(u)::text, '260');
  PERFORM pg_temp.assert_eq('C the chance is kept', first_remake_offer_state(u), 'available');
  PERFORM pg_temp.assert_eq('C no ledger row', (SELECT count(*) FROM credit_transactions WHERE user_id = u AND source = 'first_remake_cover')::text, '0');
END $$;

-- ------------------------------------- C2: fails after the cover paid part
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068419';
  j uuid := 'a0000000-0000-4000-8000-000000068419';
  v_fee uuid; v_pic uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job('b0000000-0000-4000-8000-000000068419', u, 'generate-image', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  v_fee := reserve_credits(u, 12, j, 'cast-swap');
  v_pic := reserve_credits(u, 300, 'b0000000-0000-4000-8000-000000068419', 'gpt-image-2');
  PERFORM commit_credits(v_pic, 300);
  UPDATE jobs SET status = 'failed' WHERE id = j;
  PERFORM refund_credits(v_fee);
  PERFORM pg_temp.assert_eq('C2 used: the cover paid 12, the rest dropped', pg_temp.offer(j), 'used/0/12');
  PERFORM pg_temp.assert_eq('C2 own credits untouched by the end (the fee came back)', pg_temp.balance(u)::text, '12');
  PERFORM pg_temp.assert_eq('C2 never again', first_remake_offer_state(u), 'used');
END $$;

-- -------------------------------------------------------- D: one per account
DO $$
DECLARE u uuid := '00000000-0000-4000-8000-000000068403';
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068403', u);
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068433', u);
  PERFORM pg_temp.assert_eq('D first run takes it', grant_first_remake_cover(u, 'a0000000-0000-4000-8000-000000068403', 520)::text, '220');
END $$;
SELECT pg_temp.assert_eq('D a second covered run cannot',
  pg_temp.raises($q$SELECT grant_first_remake_cover('00000000-0000-4000-8000-000000068403', 'a0000000-0000-4000-8000-000000068433', 520)$q$),
  'FIRST_REMAKE_UNAVAILABLE');
SELECT pg_temp.assert_eq('D the index refuses a second running offer',
  pg_temp.raises($q$INSERT INTO first_remake_offers (user_id, job_id, status, quote_credits, balance_before, cover_credits)
    VALUES ('00000000-0000-4000-8000-000000068403', 'a0000000-0000-4000-8000-000000068433', 'in_use', 520, 300, 220)$q$),
  'duplicate key value violates unique constraint "first_remake_offers_one_per_user"');

-- ------------------------------------------------------- E: can pay itself
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068404';
  j uuid := 'a0000000-0000-4000-8000-000000068404';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068445', u);
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068499', u, 'generate-image');
  PERFORM pg_temp.assert_eq('E an affordable first run takes the offer with a cover of 0', grant_first_remake_cover(u, j, 250)::text, '0');
  PERFORM pg_temp.assert_eq('E in use, nothing held', pg_temp.offer(j), 'in_use/0/0');
  PERFORM pg_temp.assert_eq('E a second affordable run takes nothing, never refused',
    grant_first_remake_cover(u, 'a0000000-0000-4000-8000-000000068445', NULL)::text, '0');
  PERFORM pg_temp.assert_eq('E only a Video Remake run',
    pg_temp.raises($q$SELECT grant_first_remake_cover('00000000-0000-4000-8000-000000068404', 'a0000000-0000-4000-8000-000000068499', NULL)$q$),
    'FIRST_REMAKE_UNAVAILABLE');
  v := reserve_credits(u, 30, j, 'cast-swap');
  UPDATE jobs SET status = 'completed' WHERE id = j;
  PERFORM commit_credits(v, 30);
  PERFORM pg_temp.assert_eq('E the affordable first run used it', pg_temp.offer(j), 'used/0/0');
  PERFORM pg_temp.assert_eq('E paid by its own credits', pg_temp.balance(u)::text, '270');
  PERFORM pg_temp.assert_eq('E after it: a run needing a cover is refused',
    pg_temp.raises($q$SELECT grant_first_remake_cover('00000000-0000-4000-8000-000000068404', 'a0000000-0000-4000-8000-000000068445', 520)$q$),
    'FIRST_REMAKE_UNAVAILABLE');
END $$;

DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068417';
  j uuid := 'a0000000-0000-4000-8000-000000068447';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.assert_eq('E2 no quote: cover 0', grant_first_remake_cover(u, j, NULL)::text, '0');
  v := reserve_credits(u, 30, j, 'cast-swap');
  UPDATE jobs SET status = 'failed' WHERE id = j;
  PERFORM refund_credits(v);
  PERFORM pg_temp.assert_eq('E2 a failed first run releases it', first_remake_offer_state(u), 'available');
  PERFORM pg_temp.assert_eq('E2 balance as it was', pg_temp.balance(u)::text, '300');
END $$;

-- ------------------------------------------------- F: every purchase record
DO $$
BEGIN
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068405');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068406');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068407');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068408');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068409');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068414');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068418');
  PERFORM pg_temp.job('a0000000-0000-4000-8000-000000068405', '00000000-0000-4000-8000-000000068405');
END $$;
INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted, status)
  VALUES ('00000000-0000-4000-8000-000000068405', 'frm-tx-1', 'topup', 9.99, 1000, 'completed');
INSERT INTO subscriptions (user_id, tier, status, plan_granted) VALUES ('00000000-0000-4000-8000-000000068406', 'pro', 'canceled', true);
INSERT INTO credit_transactions (user_id, amount, credit_type, source, balance_after)
  VALUES ('00000000-0000-4000-8000-000000068406', 1000, 'subscription', 'subscription_created', 1300);
UPDATE profiles SET lifetime_topup_credits = 500 WHERE id = '00000000-0000-4000-8000-000000068407';
UPDATE profiles SET free_grant_state = 'withheld' WHERE id = '00000000-0000-4000-8000-000000068408';
INSERT INTO credit_transactions (user_id, amount, credit_type, source, balance_after)
  VALUES ('00000000-0000-4000-8000-000000068409', 1000, 'topup', 'one_time_purchase', 1300);
UPDATE profiles SET subscription_tier = 'creator' WHERE id = '00000000-0000-4000-8000-000000068414';
INSERT INTO subscriptions (user_id, tier, status, plan_granted) VALUES ('00000000-0000-4000-8000-000000068418', 'pro', 'canceled', true);
INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted, status)
  VALUES ('00000000-0000-4000-8000-000000068418', 'frm-tx-2', 'subscription', 19.00, 1000, 'completed');
SELECT pg_temp.assert_eq('F paid transaction', first_remake_offer_state('00000000-0000-4000-8000-000000068405'), 'not_eligible');
SELECT pg_temp.assert_eq('F a free trial, ended unpaid, is no purchase', first_remake_offer_state('00000000-0000-4000-8000-000000068406'), 'available');
SELECT pg_temp.assert_eq('F a trial converted to paid is a purchase', first_remake_offer_state('00000000-0000-4000-8000-000000068418'), 'not_eligible');
SELECT pg_temp.assert_eq('F top-up ever bought', first_remake_offer_state('00000000-0000-4000-8000-000000068407'), 'not_eligible');
SELECT pg_temp.assert_eq('F grant withheld', first_remake_offer_state('00000000-0000-4000-8000-000000068408'), 'not_eligible');
SELECT pg_temp.assert_eq('F purchase in the ledger', first_remake_offer_state('00000000-0000-4000-8000-000000068409'), 'not_eligible');
SELECT pg_temp.assert_eq('F paid tier (a trial while it runs)', first_remake_offer_state('00000000-0000-4000-8000-000000068414'), 'not_eligible');
SELECT pg_temp.assert_eq('F not eligible refuses a covered grant',
  pg_temp.raises($q$SELECT grant_first_remake_cover('00000000-0000-4000-8000-000000068405', 'a0000000-0000-4000-8000-000000068405', 520)$q$),
  'FIRST_REMAKE_UNAVAILABLE');
SELECT pg_temp.assert_eq('F not eligible: an affordable run records nothing',
  grant_first_remake_cover('00000000-0000-4000-8000-000000068405', 'a0000000-0000-4000-8000-000000068405', NULL)::text || '/' ||
  (SELECT count(*) FROM first_remake_offers WHERE user_id = '00000000-0000-4000-8000-000000068405')::text, '0/0');

-- ------------------------------------------------------------ H: abandoned
DO $$
DECLARE u uuid := '00000000-0000-4000-8000-000000068411'; j uuid := 'a0000000-0000-4000-8000-000000068411';
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM pg_temp.assert_eq('H abandoned: released', finalize_first_remake_offer(j, true), 'released');
  DELETE FROM jobs WHERE id = j;
  PERFORM pg_temp.assert_eq('H nothing moved', pg_temp.balance(u)::text || '/' || first_remake_offer_state(u), '300/available');
END $$;

-- ---------------------------- I: a running covered run is not deleted or trashed
DO $$
DECLARE u uuid := '00000000-0000-4000-8000-000000068412'; j uuid := 'a0000000-0000-4000-8000-000000068412'; v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  v := reserve_credits(u, 400, j, 'cast-swap');
  PERFORM pg_temp.assert_eq('I delete-forever of the running run is refused',
    pg_temp.raises($q$DELETE FROM jobs WHERE id = 'a0000000-0000-4000-8000-000000068412'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  PERFORM pg_temp.assert_eq('I trash is refused',
    pg_temp.raises($q$UPDATE jobs SET deleted_at = now() WHERE id = 'a0000000-0000-4000-8000-000000068412'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  UPDATE jobs SET status = 'cancelled' WHERE id = j;
  PERFORM pg_temp.assert_eq('I cancelled, its hold still reserved: still refused (the offer is in use)',
    pg_temp.raises($q$DELETE FROM jobs WHERE id = 'a0000000-0000-4000-8000-000000068412'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  PERFORM refund_credits(v);
  PERFORM pg_temp.assert_eq('I its hold refunded: released, own credits back, cover dropped',
    (SELECT status || '/' || cover_remaining FROM first_remake_offers WHERE user_id = u) || '/' || pg_temp.balance(u), 'released/0/300');
  DELETE FROM jobs WHERE id = j;
  PERFORM pg_temp.assert_eq('I once the offer ended the run may go', (SELECT count(*) FROM jobs WHERE id = j)::text, '0');
END $$;

-- -------------------- J: side hold on the cover; a cancelled run's child pays
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068413';
  j uuid := 'a0000000-0000-4000-8000-000000068413';
  c uuid := 'b0000000-0000-4000-8000-000000068413';
  v_fee uuid; v_side jsonb; v_child uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  v_fee := reserve_credits(u, 290, j, 'cast-swap');
  v_side := reserve_llm_side_hold(u, 30, j, 'llm-chat:gpt');
  PERFORM pg_temp.assert_eq('J the side hold drew 20 of the cover (own 10 first)',
    pg_temp.balance(u)::text || '/' || pg_temp.offer(j) || '/' ||
    (SELECT metadata->>'from_cover' FROM usage_logs WHERE id = (v_side->>'usageLogId')::uuid), '0/in_use/200/0/20');
  PERFORM pg_temp.assert_eq('J recorded on the offer',
    (SELECT ((v_side->>'usageLogId')::uuid = ANY(hold_ids))::text FROM first_remake_offers WHERE job_id = j), 'true');
  v_child := reserve_credits(u, 150, c, 'seedance-2-5');
  UPDATE jobs SET status = 'cancelled' WHERE id = j;
  PERFORM refund_credits(v_fee);
  PERFORM refund_credits((v_side->>'usageLogId')::uuid);
  PERFORM pg_temp.assert_eq('J waits for the child', first_remake_offer_state(u), 'in_use');
  PERFORM commit_credits(v_child, 150);
  PERFORM pg_temp.assert_eq('J the child paid by the cover: used, own credits back', pg_temp.offer(j) || '/' || pg_temp.balance(u), 'used/0/150/300');
END $$;

-- ----------------------------------- K: nothing else can reach the cover
-- An app, its creator, and a run of it for the covered account.
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068420';
  cr uuid := '00000000-0000-4000-8000-000000068429';
  j uuid := 'a0000000-0000-4000-8000-000000068420';
  other uuid := 'a0000000-0000-4000-8000-000000068421';
  v_fee uuid; v_other uuid; v_met uuid; v_run_met uuid; r jsonb;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.account(cr);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(other, u, 'generate-image');
  INSERT INTO projects (id, user_id, name) VALUES ('c0000000-0000-4000-8000-000000068420', cr, 'P');
  INSERT INTO workflows (id, project_id, user_id, name) VALUES ('d0000000-0000-4000-8000-000000068420', 'c0000000-0000-4000-8000-000000068420', cr, 'W');
  INSERT INTO published_apps (id, workflow_id, creator_id, version, slug, name, snapshot_nodes, snapshot_edges)
    VALUES ('f0000000-0000-4000-8000-000000068420', 'd0000000-0000-4000-8000-000000068420', cr, 1, 'frm-app', 'A', '[]'::jsonb, '[]'::jsonb);
  INSERT INTO workflow_executions (id, workflow_id, user_id) VALUES ('e0000000-0000-4000-8000-000000068420', 'd0000000-0000-4000-8000-000000068420', u);
  INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES ('90000000-0000-4000-8000-000000068420', 'f0000000-0000-4000-8000-000000068420', 'e0000000-0000-4000-8000-000000068420', u);

  -- Another job's hold from before the offer, still open while the run goes.
  v_other := reserve_credits(u, 100, other, 'gpt-image-2');
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM pg_temp.assert_eq('K the earlier hold is not one of the run''s', (SELECT cardinality(hold_ids) FROM first_remake_offers WHERE job_id = j)::text, '0');
  PERFORM pg_temp.assert_eq('K balance and cover', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '200/in_use/320/0');
  -- An app's creator fee of 500: collected from own credits only.
  PERFORM process_app_monetization(u, cr, 500, 'f0000000-0000-4000-8000-000000068420', '90000000-0000-4000-8000-000000068420', 10, 500, 0, NULL);
  PERFORM pg_temp.assert_eq('K the creator fee takes own credits only', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '0/in_use/320/0');
  -- An admin debit, and a metered overrun of another job's hold.
  UPDATE profiles SET subscription_credits = 50 WHERE id = u;
  PERFORM admin_adjust_credits(u, 'subscription_credits', -1000);
  PERFORM pg_temp.assert_eq('K an admin debit stops at 0, the cover untouched', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '0/in_use/320/0');
  UPDATE profiles SET subscription_credits = 40 WHERE id = u;
  r := commit_credits_metered(v_other, 400);
  PERFORM pg_temp.assert_eq('K another job''s overrun collects own credits only',
    (r->>'collected_over_hold') || '/' || pg_temp.balance(u) || '/' || pg_temp.offer(j), '40/0/in_use/320/0');
  -- The run's own metered hold, over: the cover pays its hold, the overrun only own credits.
  PERFORM pg_temp.job('b0000000-0000-4000-8000-000000068420', u, 'llm-chat', j);
  v_run_met := reserve_credits(u, 100, 'b0000000-0000-4000-8000-000000068420', 'llm-chat:gpt');
  PERFORM pg_temp.assert_eq('K the run''s hold drew 100 of the cover', pg_temp.offer(j), 'in_use/220/0');
  UPDATE profiles SET subscription_credits = 25 WHERE id = u;
  r := commit_credits_metered(v_run_met, 160);
  PERFORM pg_temp.assert_eq('K the run''s overrun: 25 from own credits, never the cover',
    (r->>'collected_over_hold') || '/' || pg_temp.balance(u) || '/' || pg_temp.offer(j), '25/0/in_use/220/100');
  UPDATE jobs SET status = 'completed' WHERE id = j;
  PERFORM pg_temp.assert_eq('K ended', pg_temp.offer(j), 'used/0/100');
  -- A refund of that settled charge after the offer ended (the job policy, a
  -- side-hold sweep): the pools get back only what they paid (25); the
  -- cover's 100 goes nowhere.
  PERFORM reverse_settled_llm_charge(v_run_met, 'b0000000-0000-4000-8000-000000068420', 'policy_refund', 'test refund');
  PERFORM pg_temp.assert_eq('K a refund after the end returns only the pools'' share', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '25/used/0/100');
END $$;

-- ------------------------------------------------- L: who may see the cover
DO $$
DECLARE
  v_writers text[];
  v_readers text[];
BEGIN
  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) INTO v_writers
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ~* '(subscription_credits|topup_credits)\s*=' OR p.prosrc ~* 'SET\s*\([^)]*(subscription_credits|topup_credits)');
  -- Every function that writes the pools, pinned: a new one must be read and
  -- added here (it must not read the cover, or be one of the settle paths).
  PERFORM pg_temp.assert_eq('L the pool writers are known (either SET form)', array_to_string(v_writers, ','), (SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY[
    'activate_signup_grant(uuid,integer)', 'add_subscription_credits(uuid,integer)', 'add_topup_credits(uuid,integer)',
    'admin_adjust_credits(uuid,text,integer)', 'claim_signup_grant(uuid,integer,boolean,boolean,boolean)',
    'clawback_topup_credits(uuid,text,integer,numeric)', 'commit_credits(uuid,integer)', 'commit_credits_metered(uuid,integer)',
    'deduct_credits(uuid,integer)', 'expire_topup_credits(uuid)', 'grant_plan_change_credits(uuid,text,integer,integer,numeric,text)',
    'grant_topup_credits_idempotent(uuid,integer,text,numeric)',
    'grant_yearly_plan_monthly_credits(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)',
    'hold_subscription_renewal_credits(uuid,text,timestamp with time zone)',
    'process_app_monetization(uuid,uuid,integer,uuid,uuid,integer,integer,integer,uuid)', 'refund_credits(uuid)',
    'reinstate_signup_grant(uuid)',
    'release_subscription_renewal_credits(uuid,text,text,timestamp with time zone,timestamp with time zone,integer,numeric,text)',
    'renew_subscription_credits_safety_net(uuid,uuid,timestamp with time zone,integer)',
    'reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)',
    'reverse_settled_llm_charge(uuid,uuid,text,text)', 'revoke_signup_grant(uuid,integer,uuid)'
  ]) x));
  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) INTO v_readers
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ~* '(subscription_credits|topup_credits)\s*=' OR p.prosrc ~* 'SET\s*\([^)]*(subscription_credits|topup_credits)')
    AND p.prosrc ~* '(first_remake|cover_remaining|from_cover|cover_charged)';
  -- Of them, only the settle paths read the cover — and only to keep it OUT of the pools.
  PERFORM pg_temp.assert_eq('L only the settle paths read the cover', array_to_string(v_readers, ','),
    'commit_credits(uuid,integer),refund_credits(uuid),reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean),reverse_settled_llm_charge(uuid,uuid,text,text)');
END $$;

-- ------------------------------------- M: another completed run uses it
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068422';
  j uuid := 'a0000000-0000-4000-8000-000000068422';
  j2 uuid := 'a0000000-0000-4000-8000-000000068423';
  u2 uuid := '00000000-0000-4000-8000-000000068423';
  k1 uuid := 'a0000000-0000-4000-8000-000000068424';
  k2 uuid := 'a0000000-0000-4000-8000-000000068425';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(j2, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM grant_first_remake_cover(u, j2, NULL);
  UPDATE jobs SET status = 'completed' WHERE id = j2;
  v := reserve_credits(u, 10, j, 'cast-swap');
  UPDATE jobs SET status = 'failed' WHERE id = j;
  PERFORM refund_credits(v);
  PERFORM pg_temp.assert_eq('M the parallel run completed: used, though the first failed unpaid', pg_temp.offer(j), 'used/0/0');
  -- u2: an affordable run that started while the first held it completes after the first failed.
  PERFORM pg_temp.account(u2);
  PERFORM pg_temp.job(k1, u2);
  PERFORM pg_temp.job(k2, u2);
  PERFORM grant_first_remake_cover(u2, k1, NULL);
  PERFORM grant_first_remake_cover(u2, k2, NULL);
  UPDATE jobs SET status = 'failed' WHERE id = k1;
  PERFORM pg_temp.assert_eq('M the first failed: released', first_remake_offer_state(u2), 'available');
  UPDATE jobs SET status = 'completed' WHERE id = k2;
  PERFORM pg_temp.assert_eq('M then the other completed: used', first_remake_offer_state(u2) || '/' || pg_temp.offer(k2), 'used/used/0/0');
END $$;


-- --------------------------------------------------------- O: narrow fence
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068430';
  j uuid := 'a0000000-0000-4000-8000-000000068450';
  c uuid := 'b0000000-0000-4000-8000-000000068450';
  other uuid := 'a0000000-0000-4000-8000-000000068451';
  u0 uuid := '00000000-0000-4000-8000-000000068431';
  j0 uuid := 'a0000000-0000-4000-8000-000000068452';
  o0 uuid := 'a0000000-0000-4000-8000-000000068453';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM pg_temp.job(other, u, 'generate-image');
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM pg_temp.assert_eq('O another job is refused while a cover is held',
    pg_temp.raises($q$SELECT reserve_credits('00000000-0000-4000-8000-000000068430', 10, 'a0000000-0000-4000-8000-000000068451', 'gpt-image-2')$q$), 'FIRST_REMAKE_IN_PROGRESS');
  PERFORM pg_temp.assert_eq('O a hold naming no job too',
    pg_temp.raises($q$SELECT reserve_credits('00000000-0000-4000-8000-000000068430', 10, NULL, 'llm-chat:gpt')$q$), 'FIRST_REMAKE_IN_PROGRESS');
  PERFORM pg_temp.assert_eq('O another job''s side hold too',
    pg_temp.raises($q$SELECT reserve_llm_side_hold('00000000-0000-4000-8000-000000068430', 10, 'a0000000-0000-4000-8000-000000068451', 'llm-chat:gpt')$q$), 'FIRST_REMAKE_IN_PROGRESS');
  PERFORM pg_temp.assert_eq('O nothing was taken', pg_temp.balance(u)::text, '300');
  -- The run itself is never fenced; once its cover is used up, nothing is.
  v := reserve_credits(u, 520, c, 'seedance-2-5');
  PERFORM pg_temp.assert_eq('O the run used its whole cover', pg_temp.offer(j), 'in_use/0/0');
  PERFORM pg_temp.account('00000000-0000-4000-8000-000000068434');
  UPDATE profiles SET subscription_credits = 50 WHERE id = u;
  PERFORM pg_temp.assert_eq('O no cover left: another job reserves again',
    pg_temp.raises($q$SELECT reserve_credits('00000000-0000-4000-8000-000000068430', 10, 'a0000000-0000-4000-8000-000000068451', 'gpt-image-2')$q$), 'no error');
  -- A first run its own credits pay (cover 0) fences nothing.
  PERFORM pg_temp.account(u0);
  PERFORM pg_temp.job(j0, u0);
  PERFORM pg_temp.job(o0, u0, 'generate-image');
  PERFORM grant_first_remake_cover(u0, j0, NULL);
  PERFORM pg_temp.assert_eq('O a cover of 0 fences nothing',
    pg_temp.raises($q$SELECT reserve_credits('00000000-0000-4000-8000-000000068431', 10, 'a0000000-0000-4000-8000-000000068453', 'gpt-image-2')$q$), 'no error');
END $$;

-- ------------------------------------------- P: what the run job may draw
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068435';
  j uuid := 'a0000000-0000-4000-8000-000000068435';
  v uuid; s jsonb;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM pg_temp.assert_eq('P another model on the run job draws no cover (400 > own 300)',
    pg_temp.raises($q$SELECT reserve_credits('00000000-0000-4000-8000-000000068435', 400, 'a0000000-0000-4000-8000-000000068435', 'gpt-image-2')$q$), 'Insufficient credits');
  v := reserve_credits(u, 350, j, 'cast-swap');
  PERFORM pg_temp.assert_eq('P its fee does', pg_temp.offer(j), 'in_use/170/0');
  s := reserve_llm_side_hold(u, 20, j, 'llm-chat:gpt');
  PERFORM pg_temp.assert_eq('P and its LLM side hold does', pg_temp.offer(j), 'in_use/150/0');
END $$;

-- ------------------------------- Q: cascades, the account, orphaned holds
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068436';
  j uuid := 'a0000000-0000-4000-8000-000000068436';
  c uuid := 'b0000000-0000-4000-8000-000000068436';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  INSERT INTO projects (id, user_id, name) VALUES ('c0000000-0000-4000-8000-000000068436', u, 'P');
  INSERT INTO workflows (id, project_id, user_id, name) VALUES ('d0000000-0000-4000-8000-000000068436', 'c0000000-0000-4000-8000-000000068436', u, 'W');
  PERFORM pg_temp.job(j, u);
  UPDATE jobs SET workflow_id = 'd0000000-0000-4000-8000-000000068436' WHERE id = j;
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  PERFORM pg_temp.assert_eq('Q deleting the workflow that holds the running run is refused',
    pg_temp.raises($q$DELETE FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_HELD');
  PERFORM pg_temp.assert_eq('Q and the project too',
    pg_temp.raises($q$DELETE FROM projects WHERE id = 'c0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_HELD');
  -- The child (the video) is out, billing: own 300 + cover 100. The run is cancelled.
  v := reserve_credits(u, 400, c, 'seedance-2-5');
  UPDATE jobs SET status = 'cancelled' WHERE id = j;
  PERFORM pg_temp.assert_eq('Q a cancelled run whose child is still out cannot be deleted',
    pg_temp.raises($q$DELETE FROM jobs WHERE id = 'a0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  PERFORM pg_temp.assert_eq('Q nor trashed',
    pg_temp.raises($q$UPDATE jobs SET deleted_at = now() WHERE id = 'a0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  PERFORM pg_temp.assert_eq('Q nor its workflow',
    pg_temp.raises($q$DELETE FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_HELD');
  PERFORM pg_temp.assert_eq('Q nor the child itself',
    pg_temp.raises($q$DELETE FROM jobs WHERE id = 'b0000000-0000-4000-8000-000000068436'$q$), 'FIRST_REMAKE_RUN_ACTIVE');
  -- The child settles: the offer ends (the cover paid 100: used), and the rows may go.
  PERFORM commit_credits(v, 400);
  PERFORM pg_temp.assert_eq('Q the child settled: used', (SELECT status || '/' || cover_spent FROM first_remake_offers WHERE user_id = u), 'used/100');
  DELETE FROM workflows WHERE id = 'd0000000-0000-4000-8000-000000068436';
  PERFORM pg_temp.assert_eq('Q after the offer ended the workflow and its run go', (SELECT count(*) FROM jobs WHERE id IN (j, c))::text, '0');
END $$;

-- An orphaned hold (a recorded hold still reserved whose job row is gone —
-- the guard keeps the rows, so here it is written as one): the sweep never
-- refunds it, it alerts; the admin path refunds it once the work is known dead.
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068438';
  j uuid := 'a0000000-0000-4000-8000-000000068438';
  c uuid := 'b0000000-0000-4000-8000-000000068438';
  v uuid;
  r record;
  detail text := '';
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  v := reserve_credits(u, 400, c, 'seedance-2-5');
  UPDATE jobs SET status = 'cancelled' WHERE id = j;
  -- The hold as an orphan: its job row gone (job_id SET NULL), its child no longer in jobs.
  UPDATE usage_logs SET job_id = NULL, created_at = now() - interval '2 hours' WHERE id = v;
  UPDATE first_remake_offers SET created_at = now() - interval '7 hours' WHERE user_id = u;
  FOR r IN SELECT * FROM sweep_first_remake_offers() LOOP
    IF r.user_id = u THEN detail := detail || r.reason || ':' || r.detail || ','; END IF;
  END LOOP;
  PERFORM pg_temp.assert_eq('Q the sweep does not refund a live-billing orphan',
    (SELECT status FROM usage_logs WHERE id = v) || '/' || (SELECT status FROM first_remake_offers WHERE user_id = u) || '/' || pg_temp.balance(u),
    'reserved/in_use/0');
  PERFORM pg_temp.assert_eq('Q it alerts on it', detail, 'in_use_too_long:cover remaining 120, orphaned holds 1,');
  PERFORM pg_temp.assert_eq('Q the admin path refunds it once known dead', first_remake_release_orphan_holds(
    (SELECT id FROM first_remake_offers WHERE user_id = u))::text, '1');
  PERFORM pg_temp.assert_eq('Q then the offer ends by its rule: released, own credits back',
    (SELECT status || '/' || cover_remaining FROM first_remake_offers WHERE user_id = u) || '/' || pg_temp.balance(u), 'released/0/300');
END $$;

DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068437';
  j uuid := 'a0000000-0000-4000-8000-000000068437';
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  DELETE FROM auth.users WHERE id = u;
  PERFORM pg_temp.assert_eq('Q deleting the account is not refused', (SELECT count(*) FROM jobs WHERE id = j)::text || '/' ||
    (SELECT count(*) FROM first_remake_offers WHERE user_id = u)::text, '0/0');
END $$;

-- ------------------------------------------------------------- R: auto-end
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068439';
  j uuid := 'a0000000-0000-4000-8000-000000068460';
  c uuid := 'b0000000-0000-4000-8000-000000068460';
  p uuid := 'b0000000-0000-4000-8000-000000068461';
  u2 uuid := '00000000-0000-4000-8000-000000068440';
  j2 uuid := 'a0000000-0000-4000-8000-000000068462';
  v uuid;
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM pg_temp.job(c, u, 'generate-video', j);
  PERFORM pg_temp.job(p, u, 'generate-image', j);
  PERFORM grant_first_remake_cover(u, j, 520);
  v := reserve_credits(u, 400, c, 'seedance-2-5');
  PERFORM pg_temp.assert_eq('R a pending child with no hold may be deleted while the offer is in use',
    pg_temp.raises($q$DELETE FROM jobs WHERE id = 'b0000000-0000-4000-8000-000000068461'$q$), 'no error');
  UPDATE jobs SET status = 'cancelled' WHERE id = j;
  PERFORM pg_temp.assert_eq('R the child is still out: in use, its end time noted',
    (SELECT status || '/' || (run_ended_at IS NOT NULL)::text FROM first_remake_offers WHERE job_id = j), 'in_use/true');
  PERFORM count(*) FROM sweep_first_remake_offers();
  PERFORM pg_temp.assert_eq('R not before 24 hours', (SELECT status FROM first_remake_offers WHERE job_id = j), 'in_use');
  UPDATE first_remake_offers SET run_ended_at = now() - interval '25 hours' WHERE job_id = j;
  PERFORM count(*) FROM sweep_first_remake_offers();
  PERFORM pg_temp.assert_eq('R auto-ended: used (the hold out drew on the cover), cover dropped',
    pg_temp.offer(j) || '/' || pg_temp.balance(u), 'used/0/0/0');
  -- The hold settles later, lower: only the account's own share comes back.
  PERFORM commit_credits(v, 350);
  PERFORM pg_temp.assert_eq('R a later settle gives back the own share only', pg_temp.balance(u)::text || '/' || pg_temp.offer(j), '0/used/0/0');
  -- Nothing drew on the cover: released.
  PERFORM pg_temp.account(u2);
  PERFORM pg_temp.job(j2, u2);
  PERFORM pg_temp.job('b0000000-0000-4000-8000-000000068462', u2, 'generate-image', j2);
  PERFORM grant_first_remake_cover(u2, j2, 520);
  v := reserve_credits(u2, 100, 'b0000000-0000-4000-8000-000000068462', 'gpt-image-2');
  UPDATE jobs SET status = 'failed' WHERE id = j2;
  UPDATE first_remake_offers SET run_ended_at = now() - interval '25 hours' WHERE job_id = j2;
  PERFORM count(*) FROM sweep_first_remake_offers();
  PERFORM pg_temp.assert_eq('R auto-ended with no cover drawn: released', pg_temp.offer(j2), 'released/0/0');
  PERFORM refund_credits(v);
  PERFORM pg_temp.assert_eq('R its hold refunded later: own credits back', pg_temp.balance(u2)::text, '300');
END $$;

-- ------------------------------------------------------------- N: alerts
DO $$
DECLARE
  u uuid := '00000000-0000-4000-8000-000000068424';
  j uuid := 'a0000000-0000-4000-8000-000000068426';
  r record;
  reasons text := '';
BEGIN
  PERFORM pg_temp.account(u);
  PERFORM pg_temp.job(j, u);
  PERFORM grant_first_remake_cover(u, j, 520);
  UPDATE first_remake_offers SET created_at = now() - interval '7 hours', finalize_error = 'boom' WHERE job_id = j;
  FOR r IN SELECT * FROM sweep_first_remake_offers() LOOP
    IF r.job_id = j THEN reasons := reasons || r.reason || ','; END IF;
  END LOOP;
  PERFORM pg_temp.assert_eq('N the sweep alerts on the error and the age', reasons, 'finalize_error,in_use_too_long,');
  reasons := '';
  FOR r IN SELECT * FROM sweep_first_remake_offers() LOOP
    IF r.job_id = j THEN reasons := reasons || r.reason || ','; END IF;
  END LOOP;
  PERFORM pg_temp.assert_eq('N each once', reasons, '');
END $$;

-- ----------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('the table is server only',
  (has_table_privilege('authenticated', 'public.first_remake_offers', 'SELECT') OR has_table_privilege('anon', 'public.first_remake_offers', 'SELECT'))::text, 'false');
SELECT pg_temp.assert_eq('the grant is server only',
  (has_function_privilege('authenticated', 'public.grant_first_remake_cover(uuid, uuid, integer)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.grant_first_remake_cover(uuid, uuid, integer)', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('the cover helpers are server only',
  (has_function_privilege('authenticated', 'public.first_remake_cover_settled(uuid, uuid, integer, integer)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.first_remake_cover_available(uuid, uuid)', 'EXECUTE'))::text, 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
