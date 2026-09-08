-- Keep opt-in job settlement decisions through worker restarts and human review.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS billing_force_refund BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_usage_logs_managed_reserved ON public.usage_logs(id)
  WHERE status='reserved' AND metadata->>'reservation_mode'='job-once';

CREATE OR REPLACE FUNCTION public.checkpoint_job_settlement(
  p_job_id UUID, p_user_id UUID, p_usage_log_id UUID, p_sequence INTEGER,
  p_actual_credits INTEGER, p_ready BOOLEAN, p_receipt_hash TEXT,
  p_provider_cost_usd NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_usage public.usage_logs%ROWTYPE;
  v_prior JSONB;
  v_next JSONB;
BEGIN
  IF p_sequence IS NULL OR p_sequence<1 OR p_sequence>10000
    OR p_actual_credits IS NULL OR p_actual_credits<0 OR p_ready IS NULL
    OR p_receipt_hash IS NULL OR p_receipt_hash !~ '^[a-f0-9]{64}$'
    OR (p_provider_cost_usd IS NOT NULL AND (p_provider_cost_usd<0 OR p_provider_cost_usd>100000)) THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_INVALID: invalid checkpoint' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM p_user_id OR v_job.usage_log_id IS DISTINCT FROM p_usage_log_id THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: owned job and reservation required' USING ERRCODE='55021';
  END IF;
  SELECT * INTO v_usage FROM public.usage_logs WHERE id=p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR v_usage.job_id IS DISTINCT FROM p_job_id
    OR coalesce(v_usage.on_behalf_of,v_usage.user_id) IS DISTINCT FROM p_user_id
    OR v_usage.metadata->>'reservation_mode' IS DISTINCT FROM 'job-once'
    OR p_actual_credits>v_usage.credits_used THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: checkpoint exceeds or differs from reservation' USING ERRCODE='55021';
  END IF;
  v_prior:=v_usage.metadata->'job_settlement_checkpoint';
  v_next:=jsonb_build_object('version',1,'sequence',p_sequence,'actualCredits',p_actual_credits,
    'ready',p_ready,'receiptHash',p_receipt_hash,'providerCostUsd',p_provider_cost_usd);
  -- Exact reply recovery remains legal after the job advanced to review/terminal.
  IF v_prior=v_next THEN RETURN v_next; END IF;
  IF v_job.status NOT IN ('pending','processing') OR v_usage.status<>'reserved'
    OR v_usage.metadata ? 'job_settlement'
    OR (v_prior IS NOT NULL AND ((v_prior->>'sequence')::integer>=p_sequence
      OR (v_prior->>'actualCredits')::integer>p_actual_credits
      OR (v_prior->>'ready')::boolean)) THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: checkpoint cannot replace current decision' USING ERRCODE='55021';
  END IF;
  UPDATE public.usage_logs SET metadata=metadata || jsonb_build_object('job_settlement_checkpoint',v_next) WHERE id=p_usage_log_id;
  RETURN v_next;
END;
$$;
REVOKE ALL ON FUNCTION public.checkpoint_job_settlement(UUID,UUID,UUID,INTEGER,INTEGER,BOOLEAN,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_job_settlement(UUID,UUID,UUID,INTEGER,INTEGER,BOOLEAN,TEXT,NUMERIC) TO service_role;

-- Core completion/cancel/review/reconcile paths call this without knowing the
-- private pricing recipe. The persisted checkpoint, not a current rate, wins.
CREATE OR REPLACE FUNCTION public.settle_checkpointed_job_reservation(p_usage_log_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_job_id UUID;
  v_job public.jobs%ROWTYPE;
  v_usage public.usage_logs%ROWTYPE;
  v_checkpoint JSONB;
  v_actual INTEGER;
  v_hash TEXT;
  v_cost NUMERIC;
  v_result JSONB;
BEGIN
  SELECT job_id INTO v_job_id FROM public.usage_logs WHERE id=p_usage_log_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('managed',false); END IF;
  -- Same lock order as reserve, checkpoint and final settle.
  SELECT * INTO v_job FROM public.jobs WHERE id=v_job_id FOR UPDATE;
  SELECT * INTO v_usage FROM public.usage_logs WHERE id=p_usage_log_id FOR UPDATE;
  IF v_usage.metadata->>'reservation_mode' IS DISTINCT FROM 'job-once' THEN
    RETURN jsonb_build_object('managed',false);
  END IF;
  IF v_job.id IS NULL OR v_job.usage_log_id IS DISTINCT FROM p_usage_log_id THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: managed job missing or changed' USING ERRCODE='55021';
  END IF;
  IF v_job.status NOT IN ('completed','failed','cancelled') THEN
    RETURN jsonb_build_object('managed',true,'deferred',true);
  END IF;
  -- A prior exact finalizer (including the explicit settlement port) is final.
  IF v_usage.metadata ? 'job_settlement' THEN
    v_checkpoint:=v_usage.metadata->'job_settlement';
    v_result:=public.settle_job_reservation(v_job.id,v_job.user_id,p_usage_log_id,
      v_job.status,(v_checkpoint->>'actualCredits')::integer,v_checkpoint->>'receiptHash',
      (v_checkpoint->>'providerCostUsd')::numeric);
    RETURN jsonb_build_object('managed',true,'deferred',false,'settlement',v_result);
  END IF;
  v_checkpoint:=v_usage.metadata->'job_settlement_checkpoint';
  IF v_job.status='completed' AND (v_checkpoint IS NULL OR coalesce((v_checkpoint->>'ready')::boolean,false) IS NOT TRUE) THEN
    RAISE EXCEPTION 'JOB_SETTLEMENT_NOT_READY: completed job has no final decision' USING ERRCODE='55022';
  END IF;
  v_actual:=CASE WHEN v_job.status='failed' OR v_job.billing_force_refund THEN 0
    ELSE coalesce((v_checkpoint->>'actualCredits')::integer,0) END;
  v_cost:=(v_checkpoint->>'providerCostUsd')::numeric;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('version',1,'jobId',v_job.id,
    'status',v_job.status,'forceRefund',v_job.billing_force_refund,'actualCredits',v_actual,
    'checkpointHash',v_checkpoint->>'receiptHash')::text,'UTF8')),'hex');
  v_result:=public.settle_job_reservation(v_job.id,v_job.user_id,p_usage_log_id,v_job.status,v_actual,v_hash,v_cost);
  RETURN jsonb_build_object('managed',true,'deferred',false,'settlement',v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_checkpointed_job_reservation(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_checkpointed_job_reservation(UUID) TO service_role;
