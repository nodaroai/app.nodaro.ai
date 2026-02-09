-- ============================================
-- Paddle Billing Phase 5 -- Credit Guard Dual-Pool + Storage + Free Tier
-- ============================================
-- Run in Supabase SQL Editor AFTER paddle-schema.sql (Phase 1)
-- This migration adds columns and RPCs required by the updated CreditsService.

-- ============================================
-- 1. New profile columns for daily spending & free tier tracking
-- ============================================

-- Daily spending cap tracking (resets each UTC midnight)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_spent_credits INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_daily_reset TIMESTAMPTZ DEFAULT NOW();

-- ============================================
-- 2. RPC: increment_daily_spent
-- Atomically increments the daily spent counter for a user.
-- Used by CreditsService.reserveCredits() after deduction.
-- ============================================

CREATE OR REPLACE FUNCTION increment_daily_spent(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_amount
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. RPC: increment_llm_requests
-- Atomically increments LLM request counter for a user.
-- Used by CreditsService.trackLlmRequest() in the worker.
-- ============================================

CREATE OR REPLACE FUNCTION increment_llm_requests(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET llm_requests_used = COALESCE(llm_requests_used, 0) + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. RPC: commit_credits
-- Marks a usage log entry as committed (job completed successfully).
-- Optionally updates the actual credits used if different from estimate.
-- ============================================

CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  UPDATE usage_logs
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{status}',
    '"committed"'
  )
  WHERE id = p_usage_log_id;

  -- If actual credits differ from estimate, adjust (no-op if NULL)
  IF p_actual_credits IS NOT NULL THEN
    UPDATE usage_logs
    SET credits_used = p_actual_credits
    WHERE id = p_usage_log_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. RPC: refund_credits
-- Refunds credits from a usage log entry back to the user's topup pool.
-- Marks the log as refunded to prevent double-refund.
-- ============================================

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_status TEXT;
BEGIN
  -- Get usage log details
  SELECT user_id, credits_used,
         COALESCE(metadata->>'status', 'pending')
  INTO v_user_id, v_credits, v_status
  FROM usage_logs
  WHERE id = p_usage_log_id;

  -- Skip if already refunded or committed
  IF v_status IN ('refunded', 'committed') THEN
    RETURN;
  END IF;

  -- Skip if no credits to refund
  IF v_credits IS NULL OR v_credits <= 0 THEN
    RETURN;
  END IF;

  -- Restore credits to topup pool
  UPDATE profiles
  SET topup_credits = topup_credits + v_credits
  WHERE id = v_user_id;

  -- Mark as refunded
  UPDATE usage_logs
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{status}',
    '"refunded"'
  )
  WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. RPC: increment_storage
-- Atomically increments storage_used_bytes for a user.
-- Used by updateStorageUsage() after R2 uploads.
-- ============================================

CREATE OR REPLACE FUNCTION increment_storage(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) + p_bytes)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. RPC: reset_daily_spent
-- Resets daily spent counter and updates the reset timestamp.
-- Called automatically when a new UTC day is detected.
-- ============================================

CREATE OR REPLACE FUNCTION reset_daily_spent(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET daily_spent_credits = 0,
      last_daily_reset = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. Ensure usage_logs table has metadata as JSONB
-- (May already exist from earlier migration)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_logs' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE usage_logs ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;
