-- 588_repeat_infringers.sql
--
-- Repeat infringers: the record an administrator keeps of each account's
-- substantiated infringements, and of the measures taken on it.
--
-- A complaint is not an infringement. An INFRINGEMENT is recorded by an
-- administrator, from a case whose complainant proved their email, against
-- the account that case names, once per case, with the administrator's
-- reasoning; it can be withdrawn (an appeal upheld, content restored after a
-- counter-notice), with the reason, and a withdrawn one no longer counts.
--
-- A MEASURE is taken on an account by an administrator: a warning, imports of
-- links blocked (for some days, or until lifted), or the account closed (the
-- platform's account block does the closing; this row records the decision).
-- Each follows the step the repeat-infringer policy names for the account's
-- standing infringements (app setting `rights_repeat_infringer_policy`),
-- kept as applied, or says why it departs from it. What the account's owner
-- is told is kept apart from the administrator's own note.
--
-- Both are legal records: never deleted or truncated. Afterwards only the
-- withdrawal, or the lift, moves: once, stamped with the database's clock,
-- written whole with its administrator and reason. A person named on a record
-- clears only when that account is removed (the foreign keys' ON DELETE SET
-- NULL), and is never replaced. Nothing is reachable through PostgREST.
--
-- Refusals: 55000 a record moved in a way it never moves; 55028 a case or an
-- infringement that does not support the write; 55029 a measure of that kind
-- already in force on the account.
--
-- Idempotent: CI re-applies the newest migration.

CREATE TABLE IF NOT EXISTS public.account_infringements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account that infringed. Null once that account is removed: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  complaint_id uuid NOT NULL REFERENCES public.rights_complaints(id),
  -- Why the administrator found the complaint substantiated (never shown to the account).
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  withdraw_reason text CHECK (withdraw_reason IS NULL OR char_length(withdraw_reason) BETWEEN 1 AND 2000),
  CONSTRAINT account_infringements_withdrawn_with_reason CHECK ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
  CONSTRAINT account_infringements_withdrawn_after_recorded CHECK (withdrawn_at IS NULL OR withdrawn_at >= recorded_at)
);

-- One standing infringement per case and account.
CREATE UNIQUE INDEX IF NOT EXISTS account_infringements_one_per_case
  ON public.account_infringements (complaint_id, user_id) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS account_infringements_user_idx
  ON public.account_infringements (user_id, recorded_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.account_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account the measure is taken on. Null once that account is removed: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  -- Null: no end of its own (a warning, a closure, or imports blocked until lifted).
  ends_at timestamptz,
  -- What the account's owner is told (their settings page, a refused import).
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  -- The administrator's own note, never shown to the owner.
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
  -- The case it was taken from, and the infringement it follows, when it does.
  complaint_id uuid REFERENCES public.rights_complaints(id),
  infringement_id uuid REFERENCES public.account_infringements(id),
  -- The account's standing infringements in the policy's window when it was applied.
  infringements_in_window integer NOT NULL CHECK (infringements_in_window >= 0),
  -- The policy step it follows, as the policy read then; or null, and why the administrator departed from it.
  policy_step jsonb CHECK (policy_step IS NULL OR jsonb_typeof(policy_step) = 'object'),
  departure_reason text CHECK (departure_reason IS NULL OR char_length(departure_reason) BETWEEN 1 AND 2000),
  applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lifted_at timestamptz,
  lifted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lift_reason text CHECK (lift_reason IS NULL OR char_length(lift_reason) BETWEEN 1 AND 2000),
  -- Named: a later kind is added by dropping and re-adding it.
  CONSTRAINT account_sanctions_kind CHECK (kind IN ('warning', 'imports_blocked', 'closed')),
  CONSTRAINT account_sanctions_follows_or_departs CHECK ((policy_step IS NULL) <> (departure_reason IS NULL)),
  CONSTRAINT account_sanctions_lifted_with_reason CHECK ((lifted_at IS NULL) = (lift_reason IS NULL)),
  -- A warning is an event: it is never lifted, and has no end.
  CONSTRAINT account_sanctions_warning_stands CHECK (kind <> 'warning' OR (lifted_at IS NULL AND ends_at IS NULL)),
  -- A closure has no end of its own: it lasts until it is lifted.
  CONSTRAINT account_sanctions_closure_has_no_end CHECK (kind <> 'closed' OR ends_at IS NULL),
  CONSTRAINT account_sanctions_ends_after_applied CHECK (ends_at IS NULL OR ends_at > applied_at),
  -- Lifted only while in force: a measure that ended is not lifted after the fact.
  CONSTRAINT account_sanctions_lifted_while_in_force CHECK (lifted_at IS NULL OR (lifted_at >= applied_at AND (ends_at IS NULL OR lifted_at < ends_at)))
);

CREATE INDEX IF NOT EXISTS account_sanctions_user_idx
  ON public.account_sanctions (user_id, applied_at DESC) WHERE user_id IS NOT NULL;
-- The import gate's question: is a measure on this account's imports in force?
CREATE INDEX IF NOT EXISTS account_sanctions_standing_idx
  ON public.account_sanctions (user_id, kind) WHERE lifted_at IS NULL AND kind <> 'warning';

ALTER TABLE public.account_infringements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_sanctions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_infringements FROM anon, authenticated;
REVOKE ALL ON public.account_sanctions FROM anon, authenticated;

-- A person named on a record moves only one way: cleared, when that account
-- is removed (the foreign keys' ON DELETE SET NULL). plpgsql on purpose: each
-- of its reads takes a fresh snapshot, so inside that cascade the removed
-- profile is already gone. The triggers below call it as whoever writes the
-- row, which is the server's role: granted to it by name, never left to a
-- default.
CREATE OR REPLACE FUNCTION public.rights_record_person_kept(old_value uuid, new_value uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF old_value IS NOT DISTINCT FROM new_value THEN
    RETURN true;
  END IF;
  RETURN new_value IS NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = old_value);
END;
$$;
REVOKE ALL ON FUNCTION public.rights_record_person_kept(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rights_record_person_kept(uuid, uuid) TO service_role;

-- What an infringement may be, as it is written and as it moves:
--   INSERT  standing, by a named administrator, from a case whose complainant
--           proved their email, against the account that case names (55028);
--           the case is locked while this is checked; stamped by the clock.
--   UPDATE  nothing recorded changes. The withdrawal is taken once, whole
--           (when, by whom, why), stamped by the clock, never redated.
--   DELETE  never.
CREATE OR REPLACE FUNCTION public.preserve_account_infringement() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_case record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An infringement record cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL OR NEW.withdraw_reason IS NOT NULL THEN
      RAISE EXCEPTION 'An infringement is recorded standing' USING ERRCODE = '55000';
    END IF;
    IF NEW.recorded_by IS NULL THEN
      RAISE EXCEPTION 'An infringement names the administrator who recorded it' USING ERRCODE = '55000';
    END IF;
    -- A missing case is the foreign key's to refuse.
    SELECT c.user_id, c.verified_at INTO v_case FROM public.rights_complaints c WHERE c.id = NEW.complaint_id FOR SHARE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF v_case.verified_at IS NULL THEN
      RAISE EXCEPTION 'An infringement is recorded from a case whose complainant proved their email' USING ERRCODE = '55028';
    END IF;
    IF NEW.user_id IS NULL OR v_case.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'An infringement is recorded against the account its case names' USING ERRCODE = '55028';
    END IF;
    NEW.recorded_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.complaint_id IS DISTINCT FROM OLD.complaint_id
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'An infringement record is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT public.rights_record_person_kept(OLD.user_id, NEW.user_id)
     OR NOT public.rights_record_person_kept(OLD.recorded_by, NEW.recorded_by) THEN
    RAISE EXCEPTION 'A person on an infringement record is never replaced' USING ERRCODE = '55000';
  END IF;

  IF OLD.withdrawn_at IS NOT NULL THEN
    IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR NEW.withdraw_reason IS DISTINCT FROM OLD.withdraw_reason
       OR NOT public.rights_record_person_kept(OLD.withdrawn_by, NEW.withdrawn_by) THEN
      RAISE EXCEPTION 'An infringement is withdrawn once' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.withdrawn_at IS NOT NULL THEN
    IF NEW.withdrawn_by IS NULL OR NEW.withdraw_reason IS NULL THEN
      RAISE EXCEPTION 'A withdrawal names its administrator and its reason' USING ERRCODE = '55000';
    END IF;
    NEW.withdrawn_at := clock_timestamp();
  ELSIF NEW.withdrawn_by IS NOT NULL OR NEW.withdraw_reason IS NOT NULL THEN
    RAISE EXCEPTION 'A withdrawal is written whole, at once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_account_infringement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_account_infringement ON public.account_infringements;
CREATE TRIGGER preserve_account_infringement
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_infringements
  FOR EACH ROW EXECUTE FUNCTION public.preserve_account_infringement();

-- Never truncated (the function is migration 577's).
DROP TRIGGER IF EXISTS refuse_account_infringements_truncate ON public.account_infringements;
CREATE TRIGGER refuse_account_infringements_truncate
  BEFORE TRUNCATE ON public.account_infringements
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- What a measure may be, as it is written and as it moves:
--   INSERT  in force, on a named account, by a named administrator. Taken
--           from a case, that case's complainant proved their email and the
--           case names the account; following an infringement, it is a
--           standing one of the same account (55028; both locked while this
--           is checked). An import block or a closure already in force on the
--           account is not taken again (55029): the check holds a lock per
--           account and kind, so two administrators at once cannot both take
--           it. Stamped by the clock.
--   UPDATE  nothing applied changes. The lift is taken once, whole (when, by
--           whom, why), stamped by the clock, while the measure is in force.
--   DELETE  never.
CREATE OR REPLACE FUNCTION public.preserve_account_sanction() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_case record;
  v_infringement record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A measure on an account cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'A measure names the account it is taken on' USING ERRCODE = '55000';
    END IF;
    IF NEW.applied_by IS NULL THEN
      RAISE EXCEPTION 'A measure names the administrator who took it' USING ERRCODE = '55000';
    END IF;
    IF NEW.lifted_at IS NOT NULL OR NEW.lifted_by IS NOT NULL OR NEW.lift_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A measure is taken in force' USING ERRCODE = '55000';
    END IF;
    IF NEW.complaint_id IS NOT NULL THEN
      SELECT c.user_id, c.verified_at INTO v_case FROM public.rights_complaints c WHERE c.id = NEW.complaint_id FOR SHARE;
      IF FOUND AND (v_case.verified_at IS NULL OR v_case.user_id IS DISTINCT FROM NEW.user_id) THEN
        RAISE EXCEPTION 'A measure from a case is taken on the account a verified case names' USING ERRCODE = '55028';
      END IF;
    END IF;
    IF NEW.infringement_id IS NOT NULL THEN
      SELECT i.user_id, i.withdrawn_at INTO v_infringement FROM public.account_infringements i WHERE i.id = NEW.infringement_id FOR SHARE;
      IF FOUND AND (v_infringement.user_id IS DISTINCT FROM NEW.user_id OR v_infringement.withdrawn_at IS NOT NULL) THEN
        RAISE EXCEPTION 'A measure follows a standing infringement of the same account' USING ERRCODE = '55028';
      END IF;
    END IF;
    NEW.applied_at := clock_timestamp();
    IF NEW.kind <> 'warning' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('account_sanctions:' || NEW.user_id::text || ':' || NEW.kind, 0));
      IF EXISTS (
        SELECT 1 FROM public.account_sanctions s
         WHERE s.user_id = NEW.user_id AND s.kind = NEW.kind AND s.lifted_at IS NULL
           AND (s.ends_at IS NULL OR s.ends_at > NEW.applied_at)
      ) THEN
        RAISE EXCEPTION 'A measure of this kind is already in force on the account' USING ERRCODE = '55029';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.complaint_id IS DISTINCT FROM OLD.complaint_id OR NEW.infringement_id IS DISTINCT FROM OLD.infringement_id
     OR NEW.infringements_in_window IS DISTINCT FROM OLD.infringements_in_window
     OR NEW.policy_step IS DISTINCT FROM OLD.policy_step OR NEW.departure_reason IS DISTINCT FROM OLD.departure_reason THEN
    RAISE EXCEPTION 'A measure on an account is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT public.rights_record_person_kept(OLD.user_id, NEW.user_id)
     OR NOT public.rights_record_person_kept(OLD.applied_by, NEW.applied_by) THEN
    RAISE EXCEPTION 'A person on a measure is never replaced' USING ERRCODE = '55000';
  END IF;

  IF OLD.lifted_at IS NOT NULL THEN
    IF NEW.lifted_at IS DISTINCT FROM OLD.lifted_at OR NEW.lift_reason IS DISTINCT FROM OLD.lift_reason
       OR NOT public.rights_record_person_kept(OLD.lifted_by, NEW.lifted_by) THEN
      RAISE EXCEPTION 'A measure is lifted once' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.lifted_at IS NOT NULL THEN
    IF NEW.lifted_by IS NULL OR NEW.lift_reason IS NULL THEN
      RAISE EXCEPTION 'A lift names its administrator and its reason' USING ERRCODE = '55000';
    END IF;
    NEW.lifted_at := clock_timestamp();
  ELSIF NEW.lifted_by IS NOT NULL OR NEW.lift_reason IS NOT NULL THEN
    RAISE EXCEPTION 'A lift is written whole, at once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_account_sanction() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_account_sanction ON public.account_sanctions;
CREATE TRIGGER preserve_account_sanction
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_sanctions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_account_sanction();

DROP TRIGGER IF EXISTS refuse_account_sanctions_truncate ON public.account_sanctions;
CREATE TRIGGER refuse_account_sanctions_truncate
  BEFORE TRUNCATE ON public.account_sanctions
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();
