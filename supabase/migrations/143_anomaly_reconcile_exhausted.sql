-- 143: Add 'reconcile_exhausted' to credit_anomalies.anomaly_type CHECK constraint.
--
-- Phase 5 of external-call reconciliation (spec §5.5 + §7). When a per-provider
-- reconcile handler bumps `jobs.reconcile_attempts` past MAX_ATTEMPTS (=18,
-- ≈90min wall-clock), the shared `bumpAttemptsOrExhaust` helper force-fails
-- the job + refunds the user + inserts a row here so the admin can review.
--
-- The original constraint (migration 072) is inline-CHECK with the
-- auto-generated name `credit_anomalies_anomaly_type_check`. We drop + re-add
-- with the new value appended. `IF EXISTS` makes the drop safe across replays.
ALTER TABLE public.credit_anomalies
  DROP CONSTRAINT IF EXISTS credit_anomalies_anomaly_type_check;

ALTER TABLE public.credit_anomalies
  ADD CONSTRAINT credit_anomalies_anomaly_type_check
    CHECK (anomaly_type IN (
      'overcharge',
      'undercharge',
      'unknown_model',
      'zero_cost',
      'reconcile_exhausted'
    ));
