-- Allow `cron_reconcile` as a `pipeline_stage_attempts.trigger` value.
--
-- Background: a new periodic cron at `backend/src/ee/pipelines/reconcile-cron.ts`
-- re-enqueues pipelines whose BullMQ orchestration job was lost
-- (lost-wake-up race, Railway rolling restart, manual kill). The cron writes
-- an audit row mirroring the `trigger='resume'` rows that `resume.ts` writes
-- on worker boot, but with `trigger='cron_reconcile'` so the two code paths
-- can be distinguished in the audit log.
--
-- Mirrors migration 132 (D) — drop both auto-named + manually-named CHECKs,
-- then re-add with the extended allowlist.

ALTER TABLE public.pipeline_stage_attempts
  DROP CONSTRAINT IF EXISTS pipeline_stage_attempts_trigger_check;
ALTER TABLE public.pipeline_stage_attempts
  DROP CONSTRAINT IF EXISTS pipeline_stage_attempts_trigger_chk;
ALTER TABLE public.pipeline_stage_attempts
  ADD CONSTRAINT pipeline_stage_attempts_trigger_chk
    CHECK (
      trigger IN (
        'initial',
        'critic_retry',
        'resume',
        'user_edit',
        'chat_refine',
        'director_replan',
        'cron_reconcile'
      )
      OR trigger LIKE 'scene_helper:%'
    );
