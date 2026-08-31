-- 362: usage_logs.on_behalf_of (SAI item 9 — deployment payer). When one
-- designated account pays for every action on an instance, the RPC writes
-- usage_logs.user_id as the PAYER (it is the debit user); this column keeps
-- the REQUESTER attributable — the /usage page's per-user consumption view
-- and any per-user auditing key on it. ATTRIBUTION ONLY, never settlement:
-- commit/refund key on the row id and user_id alone, and the column is
-- stamped best-effort after the reserve (a failed stamp loses attribution
-- for one row, nothing else).
--
-- NULL everywhere except deployment-payer instances; the partial index keeps
-- the mainline write path and index size untouched.

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS on_behalf_of UUID;

CREATE INDEX IF NOT EXISTS idx_usage_logs_on_behalf_of
  ON usage_logs (on_behalf_of, created_at)
  WHERE on_behalf_of IS NOT NULL;
