-- 199_grant_topup_credits_idempotent.sql
--
-- Atomic, idempotent top-up grant for the Stripe webhook.
--
-- Why: handleTransactionCompleted previously (a) INSERTed the transactions claim,
-- then (b) called add_topup_credits in a SEPARATE statement. If (b) failed after
-- (a) committed, the claim row blocked every retry (UNIQUE stripe_transaction_id
-- → 23505) and the paying user permanently got ZERO credits (the webhook acks 200,
-- so Stripe never auto-retries). The interim fix (delete the claim on failure)
-- traded that for a DOUBLE-GRANT vector: if the grant actually committed but the
-- client observed a false-negative error (connection dropped after COMMIT), the
-- claim got deleted and a manual replay re-granted.
--
-- Fix: do the claim AND the grant in ONE transaction. The transactions row is the
-- mutex; ON CONFLICT DO NOTHING makes a redelivery/replay a no-op (exactly-once
-- grant); a failure rolls BOTH back together (no committed-claim-without-grant).
-- Returns TRUE if it granted, FALSE if the claim already existed (duplicate).
--
-- Reuses add_topup_credits for the actual pool update (single source of truth for
-- the grant logic); both run inside this function's transaction.

CREATE OR REPLACE FUNCTION grant_topup_credits_idempotent(
  p_user_id UUID,
  p_credits INTEGER,
  p_stripe_transaction_id TEXT,
  p_amount_usd DECIMAL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted)
  VALUES (p_user_id, p_stripe_transaction_id, 'topup', p_amount_usd, p_credits)
  ON CONFLICT (stripe_transaction_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Duplicate delivery / replay: claim already exists → do NOT re-grant.
    RETURN FALSE;
  END IF;

  -- Same transaction as the claim above → commit together or not at all.
  PERFORM add_topup_credits(p_user_id, p_credits);
  RETURN TRUE;
END;
$$;

-- Only the service-role webhook handler invokes this.
REVOKE EXECUTE ON FUNCTION grant_topup_credits_idempotent(UUID, INTEGER, TEXT, DECIMAL) FROM anon, authenticated;
