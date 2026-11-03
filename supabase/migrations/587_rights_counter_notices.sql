-- 587_rights_counter_notices.sql
--
-- Counter-notices: what the owner of content restricted after a copyright
-- notice sends to have it restored (17 U.S.C. § 512(g)(3)). The account's
-- owner submits it in their own session through the backend
-- (lib/counter-notices.ts); nothing is reachable through PostgREST.
--
-- A counter-notice is a sworn statement and a legal record: it is never
-- deleted, the table is never truncated, and what the sender submitted (their
-- details, what they identified, the declaration they affirmed, when it was
-- received, and the restore window fixed then) never changes. Only its
-- handling moves, and each step happens once, stamped with the database's
-- clock and the administrator who took it: forwarded to the complainant, a
-- court action received, that court action ended, the counter-notice
-- declined, the content restored. The sender's personal details, and what an
-- administrator notes of a court action (a caption names people), are stored
-- ENCRYPTED (lib/instance-cipher.ts, bound to this purpose, the row and the
-- column), never in the clear.
--
-- One counter-notice per restriction, from the restricted content's owner,
-- for a standing restriction of an open copyright case: the database checks
-- each of these as the row is written, under lock, so a lift or a case
-- closing at the same moment cannot slip between the check and the write.
-- The restore window is the New York calendar dates within which the content
-- may be restored (lib/business-days.ts): fixed when the counter-notice is
-- received, so a later change to how days are counted never moves a window
-- already given.
--
-- Three rules hold across tables, whoever writes:
--   1. Every lift of a restriction settles its counter-notice: the restore is
--      stamped in the lift's own transaction (a trigger on the restriction),
--      and a counter-notice is marked restored only once its restriction is
--      lifted.
--   2. A court action recorded on a counter-notice holds the content: no lift
--      of its restriction until the court action is recorded as ended. The
--      lift locks the counter-notice after the restriction, so a court action
--      and a restore never both land.
--   3. A case cannot be closed while one of its counter-notices waits for a
--      decision (neither restored, nor held by a court action, nor
--      declined): the restore deadline of a closed case would pass unseen.
--
-- Idempotent: CI re-applies the newest migration.

CREATE SEQUENCE IF NOT EXISTS public.rights_counter_notices_reference_seq;

CREATE TABLE IF NOT EXISTS public.rights_counter_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The number the sender is given and quotes: CN-<year>-<at least 6 digits>
  -- (the number grows past 999999 rather than wrapping into a duplicate).
  reference text NOT NULL UNIQUE
    DEFAULT ('CN-' || to_char(now(), 'YYYY') || '-' || to_char(nextval('public.rights_counter_notices_reference_seq'), 'FM999999000000')),
  complaint_id uuid NOT NULL REFERENCES public.rights_complaints(id),
  restriction_id uuid NOT NULL UNIQUE REFERENCES public.content_restrictions(id),
  -- The account that sent it: the restricted content's owner. Null once that
  -- account is deleted: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The sender, encrypted.
  name_enc text NOT NULL,
  email_enc text NOT NULL,
  address_enc text NOT NULL,
  phone_enc text NOT NULL,
  signature_enc text NOT NULL,
  -- What was restricted and where it was before, as the sender identified them.
  content_identification text NOT NULL CHECK (char_length(content_identification) BETWEEN 1 AND 4000),
  location_before text NOT NULL CHECK (char_length(location_before) BETWEEN 1 AND 4000),
  -- The declaration (good faith under penalty of perjury; jurisdiction and
  -- service of process), affirmed: when, and a hash of the text shown.
  declaration_hash text NOT NULL,
  perjury_affirmed_at timestamptz NOT NULL,
  jurisdiction_affirmed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  window_opens_on date NOT NULL,
  window_closes_on date NOT NULL CHECK (window_closes_on >= window_opens_on),
  -- Handling: each step set once, with the administrator who took it.
  forwarded_at timestamptz,
  forwarded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  court_action_at timestamptz,
  court_action_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  court_action_note_enc text,
  court_action_ended_at timestamptz,
  court_action_ended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  court_action_ended_note_enc text,
  -- Declined as not a valid counter-notice; the reason is shown to the sender.
  declined_at timestamptz,
  declined_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  declined_reason text CHECK (declined_reason IS NULL OR char_length(declined_reason) BETWEEN 1 AND 2000),
  restored_at timestamptz,
  restored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- When the window's opening and its last day were noted on the case's log.
  window_opened_noted_at timestamptz,
  window_closing_noted_at timestamptz,
  -- Where the submission came from: the hashed network and the agent.
  network_hash text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A court action ends only after it was received.
  CONSTRAINT rights_counter_notices_court_action_ends_after_it CHECK (court_action_ended_at IS NULL OR court_action_at IS NOT NULL),
  -- Content held by a court action is restored only after that court action, once it ended.
  CONSTRAINT rights_counter_notices_restored_after_court_action
    CHECK (restored_at IS NULL OR court_action_at IS NULL OR (court_action_ended_at IS NOT NULL AND court_action_at < restored_at)),
  -- A declined counter-notice is answered by no court action.
  CONSTRAINT rights_counter_notices_declined_or_court_action CHECK (declined_at IS NULL OR court_action_at IS NULL),
  -- A decline says why.
  CONSTRAINT rights_counter_notices_declined_with_reason CHECK ((declined_at IS NULL) = (declined_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS rights_counter_notices_complaint_idx ON public.rights_counter_notices (complaint_id, received_at);
CREATE INDEX IF NOT EXISTS rights_counter_notices_user_idx ON public.rights_counter_notices (user_id) WHERE user_id IS NOT NULL;
-- The counter-notices still waiting for a decision: the window's notes, and the case-closing guard.
CREATE INDEX IF NOT EXISTS rights_counter_notices_waiting_idx ON public.rights_counter_notices (window_opens_on)
  WHERE restored_at IS NULL AND court_action_at IS NULL AND declined_at IS NULL;
-- An owner's restrictions a case led to (Settings → Content restrictions).
CREATE INDEX IF NOT EXISTS content_restrictions_owner_idx ON public.content_restrictions (owner_user_id, restricted_at DESC)
  WHERE complaint_id IS NOT NULL;

ALTER TABLE public.rights_counter_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_counter_notices FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.rights_counter_notices_reference_seq FROM anon, authenticated;

-- What a counter-notice may be, as it is written and as it moves:
--   INSERT  only for a standing restriction of an open copyright case, by the
--           restricted content's owner, with no step taken yet. The
--           restriction and the case are locked while this is checked (55027).
--   UPDATE  what was submitted never changes. Each step is set once, stamped
--           with the clock at the write (so steps taken one after another
--           keep their order), and its administrator and its note are written
--           with it, never after; the restore only once the restriction is
--           lifted (rule 1). A person named on it clears only when that
--           account is removed (the foreign keys' ON DELETE SET NULL), and is
--           never replaced. The window's notes are bookkeeping: claimed from
--           null, released back to null when their note failed, never redated.
--   DELETE  never.
CREATE OR REPLACE FUNCTION public.preserve_rights_counter_notice() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  steps text[] := ARRAY['forwarded', 'court_action', 'court_action_ended', 'declined', 'restored'];
  -- The note each step may carry, written with it.
  step_notes jsonb := '{"court_action": "court_action_note_enc", "court_action_ended": "court_action_ended_note_enc", "declined": "declined_reason"}';
  window_notes text[] := ARRAY['window_opened_noted_at', 'window_closing_noted_at'];
  handling text[] := ARRAY[
    'user_id', 'updated_at', 'window_opened_noted_at', 'window_closing_noted_at',
    'forwarded_at', 'forwarded_by', 'court_action_at', 'court_action_by', 'court_action_note_enc',
    'court_action_ended_at', 'court_action_ended_by', 'court_action_ended_note_enc',
    'declined_at', 'declined_by', 'declined_reason', 'restored_at', 'restored_by'
  ];
  old_j jsonb;
  new_j jsonb;
  stamp jsonb := '{}'::jsonb;
  step text;
  at_col text;
  by_col text;
  note_col text;
  taking boolean;
  col text;
  v_restriction record;
  v_case record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A counter-notice cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_j := to_jsonb(NEW);
    FOREACH col IN ARRAY handling LOOP
      IF col NOT IN ('user_id', 'updated_at') AND (new_j ->> col) IS NOT NULL THEN
        RAISE EXCEPTION 'A counter-notice arrives with no step taken (%)', col USING ERRCODE = '55000';
      END IF;
    END LOOP;
    -- A missing restriction or case is the foreign keys' to refuse.
    SELECT r.complaint_id, r.owner_user_id, r.lifted_at INTO v_restriction
      FROM public.content_restrictions r WHERE r.id = NEW.restriction_id FOR SHARE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    SELECT c.kind, c.status INTO v_case
      FROM public.rights_complaints c WHERE c.id = NEW.complaint_id FOR SHARE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF v_restriction.lifted_at IS NOT NULL THEN
      RAISE EXCEPTION 'A counter-notice answers a standing restriction; this one was lifted' USING ERRCODE = '55027';
    END IF;
    IF v_restriction.complaint_id IS DISTINCT FROM NEW.complaint_id THEN
      RAISE EXCEPTION 'A counter-notice answers the case its restriction followed' USING ERRCODE = '55027';
    END IF;
    IF NEW.user_id IS NULL OR v_restriction.owner_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'A counter-notice is sent by the restricted content''s owner' USING ERRCODE = '55027';
    END IF;
    IF v_case.kind <> 'copyright' THEN
      RAISE EXCEPTION 'A counter-notice answers a copyright notice' USING ERRCODE = '55027';
    END IF;
    IF v_case.status IN ('resolved', 'closed') THEN
      RAISE EXCEPTION 'A counter-notice answers an open case; this one is %', v_case.status USING ERRCODE = '55027';
    END IF;
    RETURN NEW;
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);
  IF (new_j - handling) <> (old_j - handling) THEN
    RAISE EXCEPTION 'A counter-notice''s submission is immutable' USING ERRCODE = '55000';
  END IF;

  FOREACH step IN ARRAY steps LOOP
    at_col := step || '_at';
    by_col := step || '_by';
    note_col := step_notes ->> step;
    taking := (old_j ->> at_col) IS NULL AND (new_j ->> at_col) IS NOT NULL;
    IF (old_j ->> at_col) IS NOT NULL AND (new_j ->> at_col) IS DISTINCT FROM (old_j ->> at_col) THEN
      RAISE EXCEPTION 'A counter-notice''s % is set once', at_col USING ERRCODE = '55000';
    END IF;
    IF taking THEN
      stamp := stamp || jsonb_build_object(at_col, clock_timestamp());
    END IF;
    IF taking AND step = 'restored'
       AND NOT EXISTS (SELECT 1 FROM public.content_restrictions r WHERE r.id = NEW.restriction_id AND r.lifted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A counter-notice is restored only with its restriction lifted' USING ERRCODE = '55000';
    END IF;
    IF (new_j ->> by_col) IS DISTINCT FROM (old_j ->> by_col) THEN
      IF (new_j ->> by_col) IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (old_j ->> by_col)::uuid) THEN
          RAISE EXCEPTION 'A counter-notice''s % clears only when that account is removed', by_col USING ERRCODE = '55000';
        END IF;
      ELSIF (old_j ->> by_col) IS NOT NULL OR NOT taking THEN
        RAISE EXCEPTION 'A counter-notice''s % is written with its step, never after', by_col USING ERRCODE = '55000';
      END IF;
    END IF;
    IF note_col IS NOT NULL AND (new_j ->> note_col) IS DISTINCT FROM (old_j ->> note_col)
       AND NOT ((old_j ->> note_col) IS NULL AND taking) THEN
      RAISE EXCEPTION 'A counter-notice''s % is written with its step, never after', note_col USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF (new_j ->> 'user_id') IS DISTINCT FROM (old_j ->> 'user_id') THEN
    IF (new_j ->> 'user_id') IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (old_j ->> 'user_id')::uuid) THEN
      RAISE EXCEPTION 'A counter-notice''s sender is never replaced' USING ERRCODE = '55000';
    END IF;
  END IF;

  FOREACH col IN ARRAY window_notes LOOP
    IF (old_j ->> col) IS NOT NULL AND (new_j ->> col) IS NOT NULL AND (new_j ->> col) <> (old_j ->> col) THEN
      RAISE EXCEPTION 'A counter-notice''s % is not redated', col USING ERRCODE = '55000';
    END IF;
  END LOOP;

  NEW := jsonb_populate_record(NEW, stamp || jsonb_build_object('updated_at', now()));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_rights_counter_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_rights_counter_notice ON public.rights_counter_notices;
CREATE TRIGGER preserve_rights_counter_notice
  BEFORE INSERT OR UPDATE OR DELETE ON public.rights_counter_notices
  FOR EACH ROW EXECUTE FUNCTION public.preserve_rights_counter_notice();

-- Never truncated (the function is migration 577's).
DROP TRIGGER IF EXISTS refuse_rights_counter_notices_truncate ON public.rights_counter_notices;
CREATE TRIGGER refuse_rights_counter_notices_truncate
  BEFORE TRUNCATE ON public.rights_counter_notices
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- Rule 2: a lift of a restriction whose counter-notice carries a court action
-- not yet ended is refused (55025), whoever lifts. The counter-notice is
-- locked here, after the restriction the update already holds: a court action
-- recorded at the same moment either lands first (and this refuses) or waits
-- and finds the content restored.
CREATE OR REPLACE FUNCTION public.hold_restriction_for_court_action() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_notice record;
BEGIN
  IF OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL THEN
    SELECT n.court_action_at, n.court_action_ended_at, n.restored_at INTO v_notice
      FROM public.rights_counter_notices n WHERE n.restriction_id = NEW.id FOR UPDATE;
    IF FOUND AND v_notice.restored_at IS NULL
       AND v_notice.court_action_at IS NOT NULL AND v_notice.court_action_ended_at IS NULL THEN
      RAISE EXCEPTION 'A court action holds this content until it is recorded as ended' USING ERRCODE = '55025';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hold_restriction_for_court_action() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hold_restriction_for_court_action ON public.content_restrictions;
CREATE TRIGGER hold_restriction_for_court_action
  BEFORE UPDATE OF lifted_at ON public.content_restrictions
  FOR EACH ROW EXECUTE FUNCTION public.hold_restriction_for_court_action();

-- Rule 1: every lift settles its counter-notice, in the lift's own
-- transaction, whoever lifts (lift_content_restriction, migration 581, or any
-- other writer): restored by whoever lifted it.
CREATE OR REPLACE FUNCTION public.settle_counter_notice_on_lift() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL THEN
    UPDATE public.rights_counter_notices
       SET restored_at = NEW.lifted_at, restored_by = NEW.lifted_by
     WHERE restriction_id = NEW.id AND restored_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_counter_notice_on_lift() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS settle_counter_notice_on_lift ON public.content_restrictions;
CREATE TRIGGER settle_counter_notice_on_lift
  AFTER UPDATE OF lifted_at ON public.content_restrictions
  FOR EACH ROW EXECUTE FUNCTION public.settle_counter_notice_on_lift();

-- Rule 3: a case is not closed while one of its counter-notices waits for a
-- decision: restore the content, record the court action, or decline the
-- counter-notice first (55026).
CREATE OR REPLACE FUNCTION public.refuse_case_close_while_counter_notice_waits() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed')
     AND EXISTS (SELECT 1 FROM public.rights_counter_notices n
                  WHERE n.complaint_id = NEW.id
                    AND n.restored_at IS NULL AND n.court_action_at IS NULL AND n.declined_at IS NULL) THEN
    RAISE EXCEPTION 'A counter-notice on this case waits for a decision' USING ERRCODE = '55026';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_case_close_while_counter_notice_waits() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refuse_case_close_while_counter_notice_waits ON public.rights_complaints;
CREATE TRIGGER refuse_case_close_while_counter_notice_waits
  BEFORE UPDATE OF status ON public.rights_complaints
  FOR EACH ROW EXECUTE FUNCTION public.refuse_case_close_while_counter_notice_waits();
