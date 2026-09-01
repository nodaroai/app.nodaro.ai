-- App-reports W0 (spec 2026-09-01-app-reports-triage-design.md §6.1).
--
-- WHY A NEW COLUMN. `jobs.error_message` is the SANITIZED, user-facing string
-- (providers/kie/client.ts createSanitizedError collapses every unmatched KIE
-- failure to "Generation failed. Please try again…"); the provider's own
-- failCode/failMsg lived only in Railway logs. `reconcile_last_error`
-- (migration 138) cannot host it: terminal reconcile writers overwrite it with
-- machine tags ('upstream_failed', 'exhausted', …) and it stores err.message,
-- i.e. the same sanitized text.
--
-- WHAT LANDS HERE. The provider's raw error, passed through
-- backend/src/lib/provider-error-detail.ts redactProviderDetail() (URLs → host
-- only, bearer/secret query params stripped, 500-char cap). Written by the
-- video worker and the reconcile writers that hold a raw error; NULL for
-- writers that have no provider error (sync-sweep, execution crons).
--
-- VISIBILITY. Operator-only. Migration 347 revoked SELECT on public.jobs from
-- anon/authenticated and granted an explicit column list, so this column is
-- unreadable over PostgREST/Realtime by construction. DO NOT add a GRANT.
-- The API exposes it only to admins via routes/jobs.ts sanitizeJobForPublic
-- (an allowlist since this PR).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS error_detail text;

COMMENT ON COLUMN public.jobs.error_detail IS
  'Redacted raw provider error (host-only URLs, no secrets, <=500 chars). Operator-only; never granted to authenticated.';
