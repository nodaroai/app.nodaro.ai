-- Opt-in single-reservation boundary. The existing reserve_credits contract is
-- unchanged; callers choosing this entrypoint can retry a lost HTTP response.
CREATE OR REPLACE FUNCTION public.reserve_job_credits(
  p_user_id UUID, p_credits INTEGER, p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL, p_display_cost_usd NUMERIC DEFAULT NULL,
  p_is_app_run BOOLEAN DEFAULT FALSE, p_daily_limit INTEGER DEFAULT NULL,
  p_web_free_mode BOOLEAN DEFAULT FALSE, p_workspace_id UUID DEFAULT NULL,
  p_on_behalf_of UUID DEFAULT NULL, p_enforce_allowance BOOLEAN DEFAULT FALSE,
  p_watermark BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_usage public.usage_logs%ROWTYPE;
  v_id UUID;
  v_balance INTEGER := 0;
  v_type TEXT;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 OR p_model_identifier IS NULL OR length(p_model_identifier) = 0 THEN
    RAISE EXCEPTION 'JOB_RESERVATION_INVALID: positive credits and a model are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM coalesce(p_on_behalf_of, p_user_id)
    OR v_job.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'JOB_RESERVATION_INACTIVE: owned active job required' USING ERRCODE = '55020';
  END IF;
  IF v_job.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'JOB_RESERVATION_CONFLICT: workspace differs from the job' USING ERRCODE = '55021';
  END IF;
  IF v_job.usage_log_id IS NOT NULL THEN
    SELECT * INTO v_usage FROM public.usage_logs WHERE id = v_job.usage_log_id FOR UPDATE;
    IF NOT FOUND OR v_usage.job_id IS DISTINCT FROM p_job_id
      OR v_usage.user_id IS DISTINCT FROM p_user_id OR v_usage.on_behalf_of IS DISTINCT FROM p_on_behalf_of
      OR v_usage.workspace_id IS DISTINCT FROM p_workspace_id
      OR v_usage.action IS DISTINCT FROM p_model_identifier OR v_usage.credits_used IS DISTINCT FROM p_credits
      OR v_usage.metadata->>'reservation_mode' IS DISTINCT FROM 'job-once'
      OR v_usage.status IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'JOB_RESERVATION_CONFLICT: existing reservation differs or is settled' USING ERRCODE = '55021';
    END IF;
    RETURN jsonb_build_object('usageLogId', v_usage.id, 'creditsReserved', v_usage.credits_used,
      'watermark', coalesce(v_job.should_watermark, false), 'replayed', true);
  END IF;
  -- Never reinterpret an earlier reservation with a missing job pointer as a
  -- new debit. This entrypoint writes its pointer in the debit transaction.
  IF EXISTS (SELECT 1 FROM public.usage_logs WHERE job_id = p_job_id) THEN
    RAISE EXCEPTION 'JOB_RESERVATION_CONFLICT: job already has usage' USING ERRCODE = '55021';
  END IF;
  v_id := public.reserve_credits(p_user_id, p_credits, p_job_id, p_model_identifier,
    p_provider_cost_usd, p_display_cost_usd, p_is_app_run, p_daily_limit,
    p_web_free_mode, p_workspace_id, p_on_behalf_of, p_enforce_allowance);
  SELECT * INTO v_usage FROM public.usage_logs WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_RESERVATION_INVALID: debit has no receipt' USING ERRCODE = '55021'; END IF;
  UPDATE public.usage_logs SET metadata = coalesce(metadata, '{}'::jsonb) || '{"reservation_mode":"job-once"}'::jsonb WHERE id = v_id;
  UPDATE public.jobs SET usage_log_id = v_id, credits = p_credits,
    should_watermark = coalesce(p_watermark, false) WHERE id = p_job_id;
  IF p_workspace_id IS NOT NULL THEN
    v_type := 'org';
  ELSE
    v_type := CASE WHEN coalesce((v_usage.metadata->>'from_topup')::integer, 0) > 0
      AND coalesce((v_usage.metadata->>'from_sub')::integer, 0) = 0 THEN 'topup' ELSE 'subscription' END;
    SELECT coalesce(subscription_credits, 0) + coalesce(topup_credits, 0) INTO v_balance
      FROM public.profiles WHERE id = p_user_id;
  END IF;
  -- The debit ledger belongs to the same transaction. A lost response cannot
  -- produce a missing or duplicate ledger entry on a later retry.
  INSERT INTO public.credit_transactions(user_id, amount, credit_type, source, description,
    job_id, balance_after, workspace_id, org_id)
  VALUES(p_user_id, -p_credits, v_type, CASE WHEN p_workspace_id IS NULL THEN 'usage' ELSE 'org_usage' END,
    'Job ' || p_job_id || ': ' || p_model_identifier, p_job_id, coalesce(v_balance, 0), p_workspace_id, v_usage.org_id);
  RETURN jsonb_build_object('usageLogId', v_id, 'creditsReserved', p_credits,
    'watermark', coalesce(p_watermark, false), 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_job_credits(UUID,INTEGER,UUID,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER,BOOLEAN,UUID,UUID,BOOLEAN,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_job_credits(UUID,INTEGER,UUID,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER,BOOLEAN,UUID,UUID,BOOLEAN,BOOLEAN) TO service_role;
