-- 725 — public.topup_grants, alone in this file: a top-up or an admin
-- grant repays the payer's ENFORCED routed debts, best effort (722 holds
-- the function: the grant always commits). Beside it, the two funding
-- functions that write that table (replacing a function locks no table).
--
-- Locks: SHARE ROW EXCLUSIVE on topup_grants (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to topup_grants wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

-- Identify the purchase grant at insertion. Looking up the newest system
-- grant by transaction timestamp can select another transaction's refund.
CREATE OR REPLACE FUNCTION public.grant_topup_credits_idempotent(
  p_user_id uuid, p_credits integer, p_stripe_transaction_id text, p_amount_usd decimal
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.transactions(user_id,stripe_transaction_id,type,amount_usd,credits_granted)
    VALUES(p_user_id,p_stripe_transaction_id,'topup',p_amount_usd,p_credits)
    ON CONFLICT (stripe_transaction_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_credits <= 0 THEN RAISE EXCEPTION 'Credits must be positive, got %',p_credits; END IF;

  UPDATE public.profiles SET topup_credits=topup_credits+p_credits,
    lifetime_topup_credits=coalesce(lifetime_topup_credits,0)+p_credits,last_topup_at=now()
    WHERE id=p_user_id;
  INSERT INTO public.topup_grants(user_id,amount,source,granted_at,expires_at)
    VALUES(p_user_id,p_credits,'purchase',now(),now()+interval '12 months');
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_topup_credits_idempotent(uuid,integer,text,decimal) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grant_topup_credits_idempotent(uuid,integer,text,decimal) TO service_role;

-- A grant can repay an existing charge in the same transaction. Report the
-- balance after that repayment to the admin and the adjustment ledger.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(p_user_id uuid,p_field text,p_amount integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_field NOT IN ('subscription_credits','topup_credits') THEN
    RAISE EXCEPTION 'admin_adjust_credits: invalid field %',p_field;
  END IF;
  IF p_field='subscription_credits' THEN
    UPDATE public.profiles SET subscription_credits=greatest(0,coalesce(subscription_credits,0)+p_amount) WHERE id=p_user_id;
  ELSE
    UPDATE public.profiles SET topup_credits=greatest(0,coalesce(topup_credits,0)+p_amount) WHERE id=p_user_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_adjust_credits: user profile not found %',p_user_id; END IF;
  IF p_field='topup_credits' AND p_amount>0 THEN
    INSERT INTO public.topup_grants(user_id,amount,source,granted_at,expires_at)
      VALUES(p_user_id,p_amount,'admin',now(),now()+interval '12 months');
  END IF;
  RETURN (SELECT json_build_object('subscription_credits',subscription_credits,'topup_credits',topup_credits)
    FROM public.profiles WHERE id=p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_adjust_credits(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid,text,integer) TO service_role;

CREATE OR REPLACE TRIGGER recover_video_topup_grant AFTER INSERT OR UPDATE OF source ON public.topup_grants
  FOR EACH ROW EXECUTE FUNCTION public.recover_video_topup_grant();
