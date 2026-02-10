-- Fix subscriptions table: add columns that may be missing
-- if the table was created manually without the full paddle-schema.sql

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_price_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
