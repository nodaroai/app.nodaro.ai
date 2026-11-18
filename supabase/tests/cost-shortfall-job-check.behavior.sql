-- ============================================================================
-- Behavioral proof: migration 666 (cost-shortfall job check).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back.
--
-- WHY THIS PROOF EXISTS. The billing sweep (backend/src/ee/billing/
-- cost-shortfall-sweep.ts) switches a losing model off and counts, toward a new
-- pause, only jobs that completed after the model was last switched back on
-- (`model_pricing.switched_on_at`). Several writers flip the switch (the admin
-- models page, the pricing upsert, the toggle route, the sweep itself), so the
-- stamp is a trigger, asserted here for each shape of write. A later migration
-- that drops the trigger would let a lifted pause be re-applied at once by the
-- losses that caused it.
--
-- Also asserted: the anomaly type is accepted, and a job has one cost-shortfall
-- row at most (concurrent sweeps record it once).
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled)
VALUES ('bc_probe_model', 10, true)
ON CONFLICT (model_identifier) DO NOTHING;

-- 1. A row created on, or edited while on, is not stamped.
SELECT pg_temp.assert_eq('a new row carries no stamp',
  (SELECT switched_on_at::text FROM public.model_pricing WHERE model_identifier = 'bc_probe_model'), NULL);
UPDATE public.model_pricing SET credit_cost = 11 WHERE model_identifier = 'bc_probe_model';
SELECT pg_temp.assert_eq('an edit while on stamps nothing',
  (SELECT switched_on_at::text FROM public.model_pricing WHERE model_identifier = 'bc_probe_model'), NULL);

-- 2. Switching off stamps nothing.
UPDATE public.model_pricing SET is_enabled = false WHERE model_identifier = 'bc_probe_model';
SELECT pg_temp.assert_eq('switching off stamps nothing',
  (SELECT switched_on_at::text FROM public.model_pricing WHERE model_identifier = 'bc_probe_model'), NULL);

-- 3. Switching back on (an UPDATE) stamps now().
UPDATE public.model_pricing SET is_enabled = true WHERE model_identifier = 'bc_probe_model';
SELECT pg_temp.assert_eq('switching on with an UPDATE stamps the time',
  (SELECT (switched_on_at = now())::text FROM public.model_pricing WHERE model_identifier = 'bc_probe_model'), 'true');

-- 4. Switching back on through the pricing upsert stamps it too.
UPDATE public.model_pricing SET is_enabled = false, switched_on_at = NULL WHERE model_identifier = 'bc_probe_model';
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled)
VALUES ('bc_probe_model', 12, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost, is_enabled = EXCLUDED.is_enabled;
SELECT pg_temp.assert_eq('switching on with an upsert stamps the time',
  (SELECT (switched_on_at = now())::text FROM public.model_pricing WHERE model_identifier = 'bc_probe_model'), 'true');

-- 5. The anomaly type and the one-row-per-job rule.
SELECT pg_temp.assert_eq('cost_shortfall is an accepted anomaly type',
  (SELECT (pg_get_constraintdef(oid) LIKE '%cost_shortfall%')::text FROM pg_constraint
    WHERE conname = 'credit_anomalies_anomaly_type_check'), 'true');
SELECT pg_temp.assert_eq('one cost-shortfall row per job',
  (SELECT (indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(job_id)%' AND indexdef LIKE '%cost_shortfall%')::text
     FROM pg_indexes WHERE indexname = 'uq_credit_anomalies_cost_shortfall_job'), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
