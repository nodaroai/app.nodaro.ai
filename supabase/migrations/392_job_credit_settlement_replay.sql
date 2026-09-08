-- Finalize an opt-in job reservation without repricing or a non-atomic fallback.
-- The existing completion path still owns output policy and terminal job status.
CREATE OR REPLACE FUNCTION public.settle_job_reservation(
  p_job_id UUID, p_user_id UUID, p_usage_log_id UUID,
  p_expected_status TEXT, p_actual_credits INTEGER, p_receipt_hash TEXT,
  p_provider_cost_usd NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_usage public.usage_logs%ROWTYPE;
  v_decision JSONB;
  v_diff INTEGER;
  v_balance INTEGER := 0;
  v_type TEXT;
BEGIN
  IF p_expected_status IS NULL OR p_expected_status NOT IN ('completed','failed','cancelled')
    OR p_actual_credits IS NULL OR p_actual_credits < 0
    OR (p_expected_status = 'failed' AND p_actual_credits <> 0)
    OR p_receipt_hash IS NULL OR p_receipt_hash !~ '^[a-f0-9]{64}$'
    OR (p_provider_cost_usd IS NOT NULL AND (p_provider_cost_usd < 0 OR p_provider_cost_usd > 100000)) THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_INVALID: invalid settlement decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM p_user_id
    OR v_job.status IS DISTINCT FROM p_expected_status
    OR v_job.usage_log_id IS DISTINCT FROM p_usage_log_id THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: owned terminal job and matching reservation required' USING ERRCODE = '55021';
  END IF;
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR v_usage.job_id IS DISTINCT FROM p_job_id
    OR coalesce(v_usage.on_behalf_of, v_usage.user_id) IS DISTINCT FROM p_user_id
    OR v_usage.workspace_id IS DISTINCT FROM v_job.workspace_id
    OR v_usage.metadata->>'reservation_mode' IS DISTINCT FROM 'job-once'
    OR p_actual_credits > v_usage.credits_used THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: reservation differs or settlement exceeds its ceiling' USING ERRCODE = '55021';
  END IF;
  v_decision := jsonb_build_object('version',1,'status',p_expected_status,'actualCredits',p_actual_credits,
    'receiptHash',p_receipt_hash,'providerCostUsd',p_provider_cost_usd);
  IF v_usage.metadata ? 'job_settlement' THEN
    IF v_usage.metadata->'job_settlement' IS DISTINCT FROM v_decision
      OR v_usage.credits_charged IS DISTINCT FROM p_actual_credits
      OR v_usage.status IS DISTINCT FROM (CASE WHEN p_actual_credits=0 THEN 'refunded' ELSE 'committed' END) THEN
      RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: settlement was already decided differently' USING ERRCODE = '55021';
    END IF;
    RETURN jsonb_build_object('jobId',p_job_id,'usageLogId',p_usage_log_id,
      'actualCredits',p_actual_credits,'releasedCredits',v_usage.credits_used-p_actual_credits,
      'receiptHash',p_receipt_hash,'replayed',true);
  END IF;
  IF v_usage.status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: reservation was settled by another operation' USING ERRCODE = '55021';
  END IF;
  IF p_actual_credits=0 THEN
    PERFORM public.refund_credits(p_usage_log_id);
  ELSE
    PERFORM public.commit_credits(p_usage_log_id,p_actual_credits);
  END IF;
  UPDATE public.usage_logs SET credits_charged=p_actual_credits,
    cost_usd=coalesce(p_provider_cost_usd,cost_usd),
    metadata=metadata || jsonb_build_object('job_settlement',v_decision)
    WHERE id=p_usage_log_id;
  UPDATE public.jobs SET credits_actual=p_actual_credits,
    provider_cost=coalesce(p_provider_cost_usd,provider_cost) WHERE id=p_job_id;
  v_diff := v_usage.credits_used-p_actual_credits;
  IF v_diff>0 THEN
    IF v_usage.workspace_id IS NOT NULL THEN
      v_type := 'org';
    ELSE
      v_type := CASE WHEN coalesce((v_usage.metadata->>'from_topup')::integer,0)>=v_diff THEN 'topup'
        WHEN coalesce((v_usage.metadata->>'from_topup')::integer,0)>0 THEN 'mixed' ELSE 'subscription' END;
      SELECT coalesce(subscription_credits,0)+coalesce(topup_credits,0) INTO v_balance
        FROM public.profiles WHERE id=v_usage.user_id;
    END IF;
    INSERT INTO public.credit_transactions(user_id,amount,credit_type,source,description,
      job_id,balance_after,workspace_id,org_id)
    VALUES(v_usage.user_id,v_diff,v_type,'refund','Unused job reservation',p_job_id,
      coalesce(v_balance,0),v_usage.workspace_id,v_usage.org_id);
  END IF;
  RETURN jsonb_build_object('jobId',p_job_id,'usageLogId',p_usage_log_id,
    'actualCredits',p_actual_credits,'releasedCredits',v_diff,'receiptHash',p_receipt_hash,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_job_reservation(UUID,UUID,UUID,TEXT,INTEGER,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_job_reservation(UUID,UUID,UUID,TEXT,INTEGER,TEXT,NUMERIC) TO service_role;
