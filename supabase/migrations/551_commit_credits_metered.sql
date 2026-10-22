-- 551: commit_credits_metered — settle a metered LLM job at its ACTUAL cost,
-- collecting any overrun beyond the hold from the payer's available balance.
--
-- Metered LLM pricing reserves a small hold (the main call, one attempt, on
-- its primary lane) and settles at what the calls really cost. Retries, lane
-- fallbacks and re-asks are not held, so the actual can exceed the hold; that
-- is the expected outcome, not an anomaly. `commit_credits` can only REFUND a
-- surplus — given an actual above the hold it records the actual and moves no
-- pool (382:765) — so this is a separate function.
--
-- `commit_credits(UUID, INTEGER)` is NOT redefined, widened or overloaded. A
-- defaulted third parameter would make every live 2-argument call (routes,
-- settle_job_reservation 392, migrations 515/516) ambiguous. Every existing
-- caller's behaviour is therefore unchanged by construction.
--
-- Branches, after locking the row (status = 'reserved', FOR UPDATE):
--   1. actual <= hold        -> commit_credits(id, actual). Today's settle.
--   2. workspace payer       -> commit_credits(id, actual). Its 351 clamp
--                               already spends up to the workspace headroom
--                               and writes the rest as org_usage_variance.
--   3. external-wallet row   -> commit_credits(id, hold); the overrun is
--                               logged. The 434 capture trigger raises when
--                               credits_charged > reserved_credits, so no
--                               overrun is ever collected there.
--   4. personal / deployment -> commit_credits(id, hold) (allowance settled
--                               for the hold, nothing refunded), then collect
--                               LEAST(overrun, available) from the payer.
--   5. anything uncollected  -> one credit_anomalies 'uncollected_overrun' row
--                               (not on a workspace row: org_usage_variance
--                               is the workspace record — branch 2 must stay
--                               identical to today).
--   6. anything collected    -> one credit_transactions 'usage' line for the
--      (branch 4)              collected credits (credits only), so the
--                              payer's ledger shows the charge above the
--                              hold beside the reserve's own line. Linked to
--                              the job — a side hold's (554) through its row.
--
-- Returns { charged, collected_over_hold, shortfall, payer }, where `charged`
-- is always the `usage_logs.credits_charged` the settle wrote.
--
-- Nothing RAISEs after the inner commit_credits: an exception there would roll
-- back the settle too and strand the hold. A missing profile or allowance row
-- collects 0 and logs the shortfall; the anomaly insert itself is guarded.

-- ---------------------------------------------------------------------------
-- 1. credit_anomalies.anomaly_type gains 'uncollected_overrun' and
--    'metered_settle_unconfirmed' (a metered fixed + LLM settle — the scrapes'
--    per-item analysis — whose commit was not confirmed: the hold stays
--    reserved and nothing sweeps it, so ops settle it by hand). 143's list is
--    the current one (no later migration touches the constraint); every value
--    is kept.
-- ---------------------------------------------------------------------------
ALTER TABLE public.credit_anomalies
  DROP CONSTRAINT IF EXISTS credit_anomalies_anomaly_type_check;

ALTER TABLE public.credit_anomalies
  ADD CONSTRAINT credit_anomalies_anomaly_type_check
    CHECK (anomaly_type IN (
      'overcharge',
      'undercharge',
      'unknown_model',
      'zero_cost',
      'reconcile_exhausted',
      'uncollected_overrun',
      'metered_settle_unconfirmed'
    ));

-- ---------------------------------------------------------------------------
-- 2. commit_credits_metered
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_credits_metered(p_usage_log_id UUID, p_actual_credits INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_reserved INTEGER;
  v_metadata JSONB;
  v_workspace_id UUID;
  v_on_behalf_of UUID;
  v_job_id UUID;
  v_action TEXT;
  v_payer TEXT;
  v_extra INTEGER;
  v_collect INTEGER := 0;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
  v_shortfall INTEGER := 0;
  v_charged INTEGER;
  v_enforced BOOLEAN;
  v_sub INTEGER;
  v_topup INTEGER;
  v_avail INTEGER;
  v_allowance_delta INTEGER;
  v_a_granted INTEGER;
  v_a_reserved INTEGER;
  v_a_spent INTEGER;
  v_a_found BOOLEAN := FALSE;
  v_b_spent_before INTEGER;
  v_b_spent_after INTEGER;
  v_line_job UUID;
  v_balance_after INTEGER;
BEGIN
  -- Validated BEFORE anything moves, so a refusal leaves the row reserved.
  IF p_actual_credits IS NULL OR p_actual_credits < 0 THEN
    RAISE EXCEPTION 'METERED_ACTUAL_REQUIRED: a metered settle needs a non-negative actual, got %', p_actual_credits;
  END IF;

  SELECT user_id, credits_used, COALESCE(metadata, '{}'::jsonb), workspace_id, on_behalf_of, job_id, action
    INTO v_user_id, v_reserved, v_metadata, v_workspace_id, v_on_behalf_of, v_job_id, v_action
    FROM usage_logs
   WHERE id = p_usage_log_id AND status = 'reserved'
   FOR UPDATE;
  -- The same message commit_credits raises, so a replayed settle reads the same.
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_payer := CASE
    WHEN v_workspace_id IS NOT NULL THEN 'workspace'
    WHEN COALESCE((v_metadata->>'external_wallet')::BOOLEAN, FALSE) THEN 'external_wallet'
    WHEN v_on_behalf_of IS NOT NULL OR v_metadata->'payer'->>'kind' = 'deployment' THEN 'deployment'
    ELSE 'personal'
  END;

  -- 1. At or under the hold: today's settle, refund and all.
  IF p_actual_credits <= v_reserved THEN
    PERFORM commit_credits(p_usage_log_id, p_actual_credits);
    RETURN jsonb_build_object('charged', p_actual_credits, 'collected_over_hold', 0,
                              'shortfall', 0, 'payer', v_payer);
  END IF;

  v_extra := p_actual_credits - v_reserved;

  -- 2. Workspace payer: exactly commit_credits(id, actual). The budget is
  --    read under the same lock commit_credits takes (usage_logs ->
  --    workspace_budgets, its own order), only to REPORT what it did.
  IF v_workspace_id IS NOT NULL THEN
    SELECT spent_credits INTO v_b_spent_before
      FROM workspace_budgets WHERE workspace_id = v_workspace_id FOR UPDATE;
    PERFORM commit_credits(p_usage_log_id, p_actual_credits);
    IF v_b_spent_before IS NOT NULL THEN
      SELECT spent_credits INTO v_b_spent_after
        FROM workspace_budgets WHERE workspace_id = v_workspace_id;
      v_collect := GREATEST(v_b_spent_after - v_b_spent_before - v_reserved, 0);
      v_shortfall := GREATEST(p_actual_credits - (v_b_spent_after - v_b_spent_before), 0);
    END IF;
    RETURN jsonb_build_object('charged', p_actual_credits, 'collected_over_hold', v_collect,
                              'shortfall', v_shortfall, 'payer', v_payer);
  END IF;

  -- 3 and 4 both settle the hold first: the allowance moves reserved -> spent
  -- for the hold, and no surplus is refunded (actual = reserved).
  PERFORM commit_credits(p_usage_log_id, v_reserved);

  IF v_payer = 'external_wallet' THEN
    -- 3. The wallet journal is immutable past the hold (434): collect nothing.
    v_shortfall := v_extra;
  ELSE
    -- 4. Collect from the payer (usage_logs.user_id — the payer account under
    --    a deployment payer, never the requester). Lock order ALLOWANCE ->
    --    PROFILES (382's D8), and both re-read AFTER the inner commit, which
    --    has just released the hold from the allowance's `reserved`.
    v_enforced := COALESCE((v_metadata->'payer'->>'allowance_enforced')::BOOLEAN, FALSE)
                  AND v_on_behalf_of IS NOT NULL;
    IF v_enforced THEN
      SELECT granted_credits, reserved_credits, spent_credits
        INTO v_a_granted, v_a_reserved, v_a_spent
        FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE;
      v_a_found := FOUND;
    END IF;

    SELECT subscription_credits, topup_credits INTO v_sub, v_topup
      FROM profiles WHERE id = v_user_id FOR UPDATE;

    IF FOUND THEN
      v_sub := GREATEST(COALESCE(v_sub, 0), 0);
      v_topup := GREATEST(COALESCE(v_topup, 0), 0);
      -- A web-free-mode row (stamped at reserve, 311) draws the free pool only.
      IF COALESCE((v_metadata->>'web_free_mode')::BOOLEAN, FALSE) THEN
        v_avail := v_sub;
      ELSE
        v_avail := v_sub + v_topup;
      END IF;
      -- An enforced allowance caps the collection at the requester's quota.
      -- A missing ledger row (requester deleted since the reserve) cannot
      -- vouch for any quota, so it caps at 0.
      IF v_enforced THEN
        IF v_a_found THEN
          v_avail := LEAST(v_avail, v_a_granted - v_a_reserved - v_a_spent);
        ELSE
          v_avail := 0;
        END IF;
      END IF;

      v_collect := LEAST(v_extra, GREATEST(v_avail, 0));
      v_from_sub := LEAST(v_collect, v_sub);
      v_from_topup := v_collect - v_from_sub;

      IF v_collect > 0 THEN
        IF v_enforced AND v_a_found THEN
          UPDATE deployment_user_allowances
             SET spent_credits = spent_credits + v_collect,
                 updated_at = now()
           WHERE user_id = v_on_behalf_of;
        END IF;

        -- The daily counter records the spend, with NO daily-limit check: the
        -- limit is enforced at reserve; the overrun is work already done.
        -- The app allowance moves in the sign reserve stamped (308):
        -- negative consumes (floored at 0), positive earns.
        v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);
        UPDATE profiles
           SET subscription_credits = subscription_credits - v_from_sub,
               topup_credits = topup_credits - v_from_topup,
               daily_spent_credits = COALESCE(daily_spent_credits, 0) + v_collect,
               app_credits_allowance = CASE
                 WHEN v_allowance_delta < 0 THEN GREATEST(0, COALESCE(app_credits_allowance, 0) - v_collect)
                 WHEN v_allowance_delta > 0 THEN COALESCE(app_credits_allowance, 0) + v_collect
                 ELSE app_credits_allowance
               END
         WHERE id = v_user_id;
      END IF;
    END IF;

    v_shortfall := v_extra - v_collect;
  END IF;

  v_charged := v_reserved + v_collect;

  -- The external-wallet trigger re-fires on this UPDATE and accepts it:
  -- credits_charged is unchanged (= the hold) on that branch.
  UPDATE usage_logs
     SET credits_charged = v_charged,
         metadata = v_metadata || jsonb_build_object('overrun', jsonb_build_object(
           'collected', v_collect,
           'from_sub', v_from_sub,
           'from_topup', v_from_topup,
           'shortfall', v_shortfall))
   WHERE id = p_usage_log_id;

  -- 6. The collected overrun's ledger line (credits only): the payer's
  --    history shows the reserve's -hold line and this one, so the two sum to
  --    what was charged. Guarded like the anomaly below: the money is already
  --    settled, and a ledger fault must never roll that back. The job link is
  --    FK-safe (a usage log can outlive its job); a SIDE hold's log carries no
  --    job, so its row (554's llm_side_holds) names it.
  IF v_collect > 0 THEN
    BEGIN
      v_line_job := v_job_id;
      IF v_line_job IS NULL AND to_regclass('public.llm_side_holds') IS NOT NULL THEN
        EXECUTE 'SELECT job_id FROM public.llm_side_holds WHERE usage_log_id = $1' INTO v_line_job USING p_usage_log_id;
      END IF;
      SELECT COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0) INTO v_balance_after
        FROM profiles WHERE id = v_user_id;
      INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, job_id, balance_after)
      VALUES (
        v_user_id,
        -v_collect,
        CASE WHEN v_from_sub > 0 AND v_from_topup > 0 THEN 'mixed'
             WHEN v_from_topup > 0 THEN 'topup' ELSE 'subscription' END,
        'usage',
        CASE WHEN v_line_job IS NOT NULL THEN 'Job ' || v_line_job || ': ' ELSE '' END
          || COALESCE(v_action, 'generate') || ' — usage above the hold',
        (SELECT id FROM jobs WHERE id = v_line_job),
        COALESCE(v_balance_after, 0));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'commit_credits_metered: could not write the ledger line of the % collected on usage log %: %',
        v_collect, p_usage_log_id, SQLERRM;
    END;
  END IF;

  -- 5. Log what could not be collected. Guarded: the money is already settled,
  --    and a logging fault must never roll that back.
  IF v_shortfall > 0 THEN
    BEGIN
      INSERT INTO credit_anomalies (job_id, user_id, usage_log_id, model_identifier,
                                    credits_estimated, credits_actual, diff, anomaly_type)
      VALUES (
        -- job_id is a foreign key; a usage log can outlive its job.
        (SELECT id FROM jobs WHERE id = v_job_id),
        v_user_id,
        p_usage_log_id,
        COALESCE(v_action, 'generate'),
        v_reserved,
        p_actual_credits,
        v_shortfall,
        'uncollected_overrun');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'commit_credits_metered: could not log the uncollected overrun of % on usage log %: %',
        v_shortfall, p_usage_log_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('charged', v_charged, 'collected_over_hold', v_collect,
                            'shortfall', v_shortfall, 'payer', v_payer);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_credits_metered(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_credits_metered(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_credits_metered(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_credits_metered(UUID, INTEGER) TO service_role;
