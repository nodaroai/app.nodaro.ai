-- Performance indexes for common query patterns

-- 1. Jobs: user listing with cursor pagination (jobs.ts:84)
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at
  ON jobs (user_id, created_at DESC);

-- 2. Jobs: cancellable jobs by user+status (cancel-jobs.ts:82)
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_status
  ON jobs (user_id, status);

-- 3. Assets: library listing with cursor pagination (library.ts:81)
CREATE INDEX IF NOT EXISTS idx_assets_user_id_created_at
  ON assets (user_id, created_at DESC);

-- 4. Assets: duplicate URL check (library.ts:378)
CREATE INDEX IF NOT EXISTS idx_assets_user_id_r2_url
  ON assets (user_id, r2_url);

-- 5. Assets: cleanup service batch query (cleanup-service.ts:118)
CREATE INDEX IF NOT EXISTS idx_assets_cleanup
  ON assets (user_id, created_at) WHERE r2_key IS NOT NULL;

-- 6. Subscriptions: active subscription lookups (billing.ts:83,121)
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id_status
  ON subscriptions (user_id, status, created_at DESC);

-- 7. Credit transactions: skipped — table created in 017_billing_schema.sql
-- Index idx_credit_transactions_user_id_created_at is created there instead.

-- 8. Usage logs: admin usage history (supersedes separate single-column indexes)
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id_created_at
  ON usage_logs (user_id, created_at DESC);
