-- ============================================================
-- Migration: Paddle → Stripe
-- Rename tables and columns from paddle_* to stripe_*
-- ============================================================

-- Rename paddle_customers → stripe_customers
ALTER TABLE paddle_customers RENAME TO stripe_customers;
ALTER TABLE stripe_customers RENAME COLUMN paddle_customer_id TO stripe_customer_id;

-- Update indexes on stripe_customers
ALTER INDEX IF EXISTS idx_paddle_customers_user RENAME TO idx_stripe_customers_user;
ALTER INDEX IF EXISTS idx_paddle_customers_paddle RENAME TO idx_stripe_customers_stripe;

-- Rename columns in subscriptions
ALTER TABLE subscriptions RENAME COLUMN paddle_subscription_id TO stripe_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN paddle_price_id TO stripe_price_id;

-- Update index on subscriptions
ALTER INDEX IF EXISTS idx_subscriptions_paddle RENAME TO idx_subscriptions_stripe;

-- Rename column in transactions
ALTER TABLE transactions RENAME COLUMN paddle_transaction_id TO stripe_transaction_id;

-- Rename column in credit_transactions (if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions'
    AND column_name = 'paddle_transaction_id'
  ) THEN
    ALTER TABLE credit_transactions RENAME COLUMN paddle_transaction_id TO stripe_transaction_id;
  END IF;
END $$;

-- Update RLS policies on stripe_customers
DROP POLICY IF EXISTS "Users read own paddle customer" ON stripe_customers;
CREATE POLICY "Users read own stripe customer" ON stripe_customers
  FOR SELECT USING (user_id = auth.uid());

-- Update unique constraint name (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paddle_customers_paddle_customer_id_key'
  ) THEN
    ALTER TABLE stripe_customers
      RENAME CONSTRAINT paddle_customers_paddle_customer_id_key
      TO stripe_customers_stripe_customer_id_key;
  END IF;
END $$;

-- Update unique constraint on transactions (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_paddle_transaction_id_key'
  ) THEN
    ALTER TABLE transactions
      RENAME CONSTRAINT transactions_paddle_transaction_id_key
      TO transactions_stripe_transaction_id_key;
  END IF;
END $$;
