-- ============================================================================
-- What a person made while their outputs were private stays private, after
-- they switch back to public AND after a plan drop returns the setting to
-- public (a drop from Standard/Pro/Business to Free/Basic).
--
-- Migration 706 keeps private for good the rows the private switch HID
-- (jobs.hidden_by_owner_at). Two kinds of row it does not mark:
--   - a row completed while private: it is is_public = false, and stayed so
--     only because no writer happens to set an existing row public later;
--   - a job queued while private and picked up after the switch back: the
--     worker reads the preference at pickup, so it completed public.
-- Both were made while private.
--
-- 1. profiles.outputs_public_since: when the outputs setting last went from
--    private to public. NULL for an account that never did. Stamped by the
--    database itself (trigger below) on every false → true write of
--    public_outputs, whoever writes it — the settings route, or the plan-drop
--    reset `tierColumns` spreads (lib/private-outputs-plan.ts) — so it is in
--    the SAME update as the switch and no application writer can miss it. A
--    nullable column with no default: a metadata change, nothing rewritten.
--
--    profiles.outputs_public_reason says which: 'plan' when the same update
--    changed the tier (only a plan drop from a plan with private outputs to
--    one without writes public_outputs = true with a tier), 'owner' otherwise
--    (the person's own switch back). The Settings card tells a 'plan' reset
--    apart by it. Both columns are written ONLY by that trigger: any other
--    write of them, by any role, is put back. Defense in depth: migration 598
--    already leaves the signed-in role no UPDATE on these columns, so this
--    holds even against a future grant or a service-role writer.
--
-- 2. outputs_public_notices: one row per plan-drop reset — the email that
--    tells the person. Inserted by an AFTER trigger on that same update,
--    keyed (user, the stamp), so a reset enqueues exactly one notice and a
--    repeated write (true over true) enqueues nothing. The sender
--    (ee/notifications/outputs-public-notice.ts, the 5-minute cron) claims a
--    row before it sends. Service role only: RLS on, no policies.
--
-- 3. keep_private_owner_jobs_private (706) gains a third rule: a row CREATED
--    before its owner's outputs_public_since is never written public. Its two
--    rules stay (a marked row; an owner whose setting is private now). The
--    function is replaced in place; its two triggers on jobs and their WHEN
--    clauses are unchanged, so it still runs only on a transition TO public,
--    with the same one-row primary-key read of profiles.
--
-- No row is scanned or rewritten. profiles is read on every request: the
-- ADD COLUMNs, the constraint and the CREATE TRIGGERs take short table locks there, so the wait
-- is bounded; a timeout fails the migration, which is safe to retry.
-- ============================================================================
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS outputs_public_since timestamptz;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS outputs_public_reason text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_outputs_public_reason_check;
-- NOT VALID: every row is NULL, nothing to check under the lock; new writes are checked.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_outputs_public_reason_check
  CHECK (outputs_public_reason IS NULL OR outputs_public_reason IN ('owner', 'plan')) NOT VALID;

COMMENT ON COLUMN public.profiles.outputs_public_reason IS
  'Why public_outputs last went from false to true: plan (a plan drop, the tier changed in the same update) or owner (the person''s own switch). Written only by trigger trg_stamp_outputs_public_since. Migration 713.';

COMMENT ON COLUMN public.profiles.outputs_public_since IS
  'When public_outputs last went from false to true (stamped by trigger trg_stamp_outputs_public_since). A job created before it is never written public (keep_private_owner_jobs_private). NULL: never switched back. Migration 713.';

CREATE OR REPLACE FUNCTION public.stamp_outputs_public_since()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.public_outputs IS FALSE AND NEW.public_outputs IS TRUE THEN
    NEW.outputs_public_since := now();
    NEW.outputs_public_reason := CASE WHEN NEW.tier IS DISTINCT FROM OLD.tier THEN 'plan' ELSE 'owner' END;
  ELSE
    -- Any other write of the stamp is put back: only this trigger writes it.
    NEW.outputs_public_since := OLD.outputs_public_since;
    NEW.outputs_public_reason := OLD.outputs_public_reason;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_outputs_public_since() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_outputs_public_since ON public.profiles;
CREATE TRIGGER trg_stamp_outputs_public_since
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  -- Evaluated without entering PL/pgSQL: every other profiles update costs a few comparisons.
  WHEN (
    (OLD.public_outputs IS FALSE AND NEW.public_outputs IS TRUE)
    OR NEW.outputs_public_since IS DISTINCT FROM OLD.outputs_public_since
    OR NEW.outputs_public_reason IS DISTINCT FROM OLD.outputs_public_reason
  )
  EXECUTE FUNCTION public.stamp_outputs_public_since();

CREATE TABLE IF NOT EXISTS public.outputs_public_notices (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_since timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'unknown', 'failed', 'given_up', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, public_since)
);

COMMENT ON TABLE public.outputs_public_notices IS
  'One email per plan-drop reset of private outputs to public (enqueued by trg_enqueue_outputs_public_notice). Sent by ee/notifications/outputs-public-notice.ts. Migration 713.';

ALTER TABLE public.outputs_public_notices ENABLE ROW LEVEL SECURITY;
-- No policies, no grants: the service role only.
REVOKE ALL ON public.outputs_public_notices FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_outputs_public_notices_open
  ON public.outputs_public_notices (created_at)
  WHERE status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION public.enqueue_outputs_public_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.outputs_public_notices (user_id, public_since)
  VALUES (NEW.id, NEW.outputs_public_since)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_outputs_public_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_outputs_public_notice ON public.profiles;
CREATE TRIGGER trg_enqueue_outputs_public_notice
  AFTER UPDATE OF public_outputs ON public.profiles
  FOR EACH ROW
  WHEN (OLD.public_outputs IS FALSE AND NEW.public_outputs IS TRUE AND NEW.outputs_public_reason = 'plan')
  EXECUTE FUNCTION public.enqueue_outputs_public_notice();

CREATE OR REPLACE FUNCTION public.keep_private_owner_jobs_private()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.hidden_by_owner_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.user_id
       AND (
         p.public_outputs IS FALSE
         -- Made while private: created before the owner last switched back.
         OR (p.outputs_public_since IS NOT NULL AND NEW.created_at < p.outputs_public_since)
       )
  ) THEN
    NEW.is_public := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.keep_private_owner_jobs_private() FROM PUBLIC, anon, authenticated;
