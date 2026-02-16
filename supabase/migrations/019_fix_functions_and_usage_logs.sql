-- Migration 019: Fix function definitions to match production + add missing functions
-- All functions use CREATE OR REPLACE (idempotent).

-- ============================================================
-- 1. MISSING COLUMNS on usage_logs (used by production RPCs)
-- ============================================================

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'reserved';
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS credits_charged INTEGER;

-- ============================================================
-- 2. FIX — commit_credits (production uses status column, not metadata)
-- ============================================================

CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_log RECORD;
BEGIN
  SELECT * INTO v_log FROM usage_logs WHERE id = p_usage_log_id AND status = 'reserved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  UPDATE usage_logs SET status = 'committed', credits_charged = COALESCE(p_actual_credits, credits_used) WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. FIX — refund_credits (production uses status column, not metadata)
-- ============================================================

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE v_log RECORD;
BEGIN
  SELECT * INTO v_log FROM usage_logs WHERE id = p_usage_log_id AND status = 'reserved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  UPDATE profiles SET topup_credits = topup_credits + v_log.credits_used WHERE id = v_log.user_id;
  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. FIX — increment_storage (match production: no COALESCE/GREATEST)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_storage(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = storage_used_bytes + p_bytes
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. MISSING FUNCTIONS — used by backend or RLS
-- ============================================================

-- is_admin: SECURITY DEFINER function for RLS policies
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_my_role: Returns current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER;

-- get_stats: Admin dashboard stats (called by backend stats.ts)
CREATE OR REPLACE FUNCTION get_stats(p_user_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalExecutions', COUNT(*),
    'successful', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed', COUNT(*) FILTER (WHERE status = 'failed'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'pending', COUNT(*) FILTER (WHERE status IN ('pending', 'queued')),
    'processing', COUNT(*) FILTER (WHERE status = 'processing'),
    'failureRate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE status = 'failed')::numeric / COUNT(*)::numeric) * 100, 1)
      ELSE 0 END,
    'avgImageTime', COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (
      WHERE status = 'completed' AND input_data->>'type' IN (
        'generate-image', 'edit-image', 'image-to-image',
        'generate-character', 'generate-character-asset',
        'generate-object', 'generate-object-asset',
        'generate-location', 'generate-location-asset'
      ))::numeric, 1), 0),
    'avgVideoTime', COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (
      WHERE status = 'completed' AND input_data->>'type' IN (
        'image-to-video', 'text-to-video', 'video-to-video',
        'combine-videos', 'motion-transfer', 'video-upscale', 'trim-video'
      ))::numeric, 1), 0)
  ) INTO result
  FROM jobs
  WHERE (p_user_id IS NULL OR user_id = p_user_id);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- reserve_credits: Atomic credit reservation (deduct + log)
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL,
  p_display_cost_usd NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_profile RECORD;
  v_usage_log_id UUID;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Deduct credits
  IF v_profile.subscription_credits >= p_credits THEN
    v_from_sub := p_credits;
  ELSE
    v_from_sub := v_profile.subscription_credits;
    v_from_topup := p_credits - v_from_sub;
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup,
      daily_spent_credits = daily_spent_credits + p_credits
  WHERE id = p_user_id;

  -- Log usage
  INSERT INTO usage_logs (user_id, job_id, action, provider, credits_used, cost_usd, status, metadata)
  VALUES (p_user_id, p_job_id, 'generate', 'kie', p_credits, p_provider_cost_usd, 'reserved',
          jsonb_build_object('model', p_model_identifier, 'display_cost', p_display_cost_usd))
  RETURNING id INTO v_usage_log_id;

  RETURN v_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- check_credits: Validates user can spend credits (uses tier_config)
CREATE OR REPLACE FUNCTION check_credits(p_user_id UUID, p_required_credits INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_profile RECORD;
  v_tier_config RECORD;
  v_total_available INTEGER;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'User not found');
  END IF;

  -- Reset daily if needed
  IF v_profile.last_daily_reset < CURRENT_DATE THEN
    UPDATE profiles SET daily_spent_credits = 0, last_daily_reset = CURRENT_DATE WHERE id = p_user_id;
    v_profile.daily_spent_credits := 0;
  END IF;

  -- Reset monthly if period ended
  IF CURRENT_TIMESTAMP > v_profile.current_period_end THEN
    SELECT monthly_credits INTO v_tier_config FROM tier_config WHERE tier = v_profile.subscription_tier;
    UPDATE profiles
    SET subscription_credits = v_tier_config.monthly_credits,
        current_period_end = current_period_end + INTERVAL '1 month'
    WHERE id = p_user_id;
    v_profile.subscription_credits := v_tier_config.monthly_credits;
  END IF;

  SELECT * INTO v_tier_config FROM tier_config WHERE tier = v_profile.subscription_tier;

  -- Check daily limit
  IF v_tier_config.daily_credit_limit IS NOT NULL THEN
    IF v_profile.daily_spent_credits + p_required_credits > v_tier_config.daily_credit_limit THEN
      RETURN jsonb_build_object('allowed', false, 'error', 'Daily credit limit exceeded');
    END IF;
  END IF;

  -- Check balance
  v_total_available := v_profile.subscription_credits + v_profile.topup_credits;
  IF v_total_available < p_required_credits THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Insufficient credits', 'balance', v_total_available, 'required', p_required_credits);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'balance', v_total_available);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- decrement_storage: Atomic storage decrement
CREATE OR REPLACE FUNCTION decrement_storage(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, storage_used_bytes - p_bytes)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- check_storage_quota: Check if upload fits within tier quota
CREATE OR REPLACE FUNCTION check_storage_quota(p_user_id UUID, p_file_size BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_usage BIGINT;
  v_quota BIGINT;
  v_tier TEXT;
BEGIN
  SELECT tier, storage_used_bytes
  INTO v_tier, v_current_usage
  FROM public.profiles
  WHERE id = p_user_id;

  v_quota := CASE v_tier
    WHEN 'free' THEN 1073741824
    WHEN 'basic' THEN 10737418240
    WHEN 'pro' THEN 107374182400
    WHEN 'business' THEN 1099511627776
    ELSE 1073741824
  END;

  RETURN (v_current_usage + p_file_size) <= v_quota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- share_workflow_assets: Mark workflow assets as shared
CREATE OR REPLACE FUNCTION share_workflow_assets(p_workflow_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.assets
  SET is_shared = true
  WHERE id IN (
    SELECT DISTINCT (jsonb_array_elements(nodes)->>'assetId')::uuid
    FROM public.workflows
    WHERE id = p_workflow_id
    AND jsonb_array_elements(nodes)->>'assetId' IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- update_assets_updated_at: Trigger function to track asset metadata updates
CREATE OR REPLACE FUNCTION update_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.metadata = jsonb_set(
    COALESCE(NEW.metadata, '{}'::jsonb),
    '{updated_at}',
    to_jsonb(NOW())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: auto-update assets metadata on row update
DROP TRIGGER IF EXISTS assets_updated_at ON assets;
CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_assets_updated_at();
