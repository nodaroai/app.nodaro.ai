-- KIE.ai account balances became fractional (e.g. 2485.98) — the hourly
-- recordKieCreditSnapshot() insert has been failing with
-- `invalid input syntax for type integer: "2485.98"` against the INTEGER
-- column from migration 074, flatlining the /admin/kie-credits history.
-- Store the balance as KIE reports it. Idempotent: re-running the type
-- change on an already-numeric column is a no-op rewrite.
ALTER TABLE kie_credit_snapshots
  ALTER COLUMN credits TYPE numeric USING credits::numeric;
