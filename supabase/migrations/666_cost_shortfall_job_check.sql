-- 666: Record jobs charged less than their provider cost, and let a model that keeps falling short be
-- switched off automatically.
--
-- The billing sweep (backend/src/ee/billing/cost-shortfall-sweep.ts) reads every
-- completed job back once its charge is settled and compares the charge with
-- the provider's cost for the job in credits (no markup). A job charged less
-- is recorded here as a `cost_shortfall` credit anomaly. When one model keeps
-- falling short, the sweep switches its pricing row off (`is_enabled`), which
-- refuses new runs with `model_disabled` until an admin switches it back on at
-- Admin -> Models.
--
-- 1. credit_anomalies.anomaly_type gains 'cost_shortfall'. 551's list is the
--    current one (no later migration touches the constraint); every value is
--    kept.
-- 2. Two columns the cost-shortfall rows fill: when the job completed (the pause
--    rule counts jobs close together in time) and the pricing row that
--    switches the run (every run of one model groups under it).
-- 3. One cost-shortfall row per job: concurrent sweeps (replicas, and staging,
--    which shares this database) record a job once.
-- 4. model_pricing.switched_on_at: when the model was last switched back on,
--    stamped by a trigger whichever writer flips it. Jobs that completed
--    before it never count toward a new pause, so lifting a pause is not
--    undone by the losses that caused it.
--
-- Idempotent: re-running changes nothing.

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.credit_anomalies
  DROP CONSTRAINT IF EXISTS credit_anomalies_anomaly_type_check;

ALTER TABLE public.credit_anomalies
  ADD CONSTRAINT credit_anomalies_anomaly_type_check
    CHECK (anomaly_type IN (
      'overcharge',
      'undercharge',
      'unknown_model',
      'zero_cost',
      'reconcile_exhausted',
      'uncollected_overrun',
      'metered_settle_unconfirmed',
      'cost_shortfall'
    ));

-- 2 ---------------------------------------------------------------------------
ALTER TABLE public.credit_anomalies ADD COLUMN IF NOT EXISTS job_completed_at TIMESTAMPTZ;
ALTER TABLE public.credit_anomalies ADD COLUMN IF NOT EXISTS model_switch_id TEXT;

-- 3 ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_anomalies_cost_shortfall_job
  ON public.credit_anomalies (job_id)
  WHERE anomaly_type = 'cost_shortfall';

CREATE INDEX IF NOT EXISTS idx_credit_anomalies_cost_shortfall_model
  ON public.credit_anomalies (model_switch_id, job_completed_at)
  WHERE anomaly_type = 'cost_shortfall';

-- 4 ---------------------------------------------------------------------------
ALTER TABLE public.model_pricing ADD COLUMN IF NOT EXISTS switched_on_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.model_pricing_stamp_switched_on()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_enabled IS TRUE AND OLD.is_enabled IS DISTINCT FROM TRUE THEN
    NEW.switched_on_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS model_pricing_stamp_switched_on ON public.model_pricing;
CREATE TRIGGER model_pricing_stamp_switched_on
  BEFORE UPDATE ON public.model_pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.model_pricing_stamp_switched_on();
