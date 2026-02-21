-- 027: Critical & High audit fixes
-- C4: Store watermark decision at reservation time instead of re-deriving in worker

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS should_watermark BOOLEAN DEFAULT false;

-- RPC for refunding subscription credits (used by C2 fix)
CREATE OR REPLACE FUNCTION add_subscription_credits(p_user_id UUID, p_credits INT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET subscription_credits = subscription_credits + p_credits
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
