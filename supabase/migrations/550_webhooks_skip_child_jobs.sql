-- 550: a child job sends no webhook event.
--
-- A child job (`parent_job_id` set: a step a worker-side handler ran for its
-- parent, such as Cast Swap's Seedance edit, its reference preparation or its
-- Full Quality upscale) is shown only through its parent: the jobs list leaves
-- it out and every read of a job by id answers it to its owner as a job that
-- does not exist. Its input holds what the handler sent on the user's behalf,
-- so an event for it would hand that input to the owner's endpoint (and keep it
-- in the delivery log). The capture now skips it, as it already skips a job of
-- a Component node's inner run or a use-case node's hidden run.
--
-- 1. The capture: the same function as migration 521's, with the child check
--    added first; its grants are unchanged (CREATE OR REPLACE keeps them).
--
-- 2. DATA CHANGE — the deliveries already recorded for a child job, before
--    this migration: each one's kept body (`payload`, the job as it was sent,
--    its input included) is dropped, and one not yet sent for good is closed.
--    See the UPDATE at the end.
CREATE OR REPLACE FUNCTION public.webhooks_record_job_event(
  p_job_id uuid,
  p_user_id uuid,
  p_event text,
  p_source text,
  p_source_detail text,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '200ms'
AS $$
BEGIN
  -- A child job is reported only through its parent.
  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id
       AND j.parent_job_id IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  IF p_execution_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workflow_executions e
     WHERE e.id = p_execution_id
       AND (e.is_component_execution IS TRUE OR e.trigger_type = 'use_case')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.webhook_deliveries (webhook_id, user_id, job_id, event, status, next_retry_at)
  SELECT w.id, w.user_id, p_job_id, p_event, 'pending', clock_timestamp()
    FROM public.webhooks w
   WHERE w.user_id = p_user_id
     AND w.is_active
     AND p_event = ANY (w.events)
     AND (
       w.app_id IS NULL
       OR (
         p_source = 'app'
         AND p_source_detail = w.app_id::text
         AND EXISTS (
           SELECT 1 FROM public.developer_app_authorizations a
            WHERE a.app_id = w.app_id
              AND a.user_id = p_user_id
              AND a.revoked_at IS NULL
              AND 'jobs:read' = ANY (a.scopes_granted)
         )
       )
     );
END;
$$;

REVOKE ALL ON FUNCTION public.webhooks_record_job_event(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 2. The deliveries already recorded for a child job. A kept body is the text
--    of the first attempt and is sent again on every retry (521's
--    record_webhook_delivery_attempt keeps it while a delivery is `pending`, and
--    keeps it on a delivery closed with `attempts_exhausted`); the delivery log
--    (GET /v1/webhook-endpoints/:id/deliveries) shows it as `requestBody`.
--    So, for a delivery whose job is a child:
--    - its body is dropped (`payload = NULL`), whatever its status;
--    - a `pending` one (waiting, retrying or leased) is closed as the
--      dispatcher closes a delivery whose job is gone — the `skipped` outcome
--      of record_webhook_delivery_attempt, i.e. status `failed`, no due time,
--      no lease, no body — so it is never sent again. `failed` is the only
--      closed status 521's state machine has (`webhook_deliveries_status_valid`:
--      pending | delivered | failed), and `pending` needs a due time
--      (`webhook_deliveries_pending_is_due`), so closing it is the only way to
--      stop the resend. `last_error` says why: `child_job`.
--    A `delivered` row keeps no body already (521 drops it on delivery); it is
--    left as it is. A sender already holding a lease when this runs may still
--    finish that one attempt; its outcome is then refused (521 records an
--    attempt only on a row still `pending`).
--    No trigger fires on these columns (521's guards watch webhook_id, user_id
--    and job_id only), and `webhook_deliveries` has no updated_at.
--    Only the two job events are touched: 521's event check is enforced on
--    any row an UPDATE writes, so a row with another event is left alone
--    rather than failing the whole migration.
UPDATE public.webhook_deliveries d
   SET payload = NULL,
       status = CASE WHEN d.status = 'pending' THEN 'failed' ELSE d.status END,
       next_retry_at = CASE WHEN d.status = 'pending' THEN NULL ELSE d.next_retry_at END,
       lease_until = CASE WHEN d.status = 'pending' THEN NULL ELSE d.lease_until END,
       last_error = CASE WHEN d.status = 'pending' THEN 'child_job' ELSE d.last_error END
 WHERE d.job_id IS NOT NULL
   AND d.event IN ('job.completed', 'job.failed')
   AND (d.payload IS NOT NULL OR d.status = 'pending')
   AND EXISTS (
     SELECT 1 FROM public.jobs j
      WHERE j.id = d.job_id
        AND j.parent_job_id IS NOT NULL
   );
