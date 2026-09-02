-- Revert 369: usage reporting for organizations (E2/P15). 369 writes no data,
-- so this revert loses nothing. Drops the five reader functions (full
-- signatures) and the one partial index.
DROP FUNCTION IF EXISTS public.org_usage_variance(TEXT, UUID, DATE, DATE, TEXT, UUID);
DROP FUNCTION IF EXISTS public.org_usage_rows(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID, TIMESTAMPTZ, UUID, INT);
DROP FUNCTION IF EXISTS public.org_usage_totals(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.org_usage_report(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.org_usage_window(DATE, DATE, TEXT);
DROP INDEX IF EXISTS idx_credit_tx_variance_org_created;
