-- Marketing-email consent, Cloud-only (served behind hasCredits()).
--
-- WHAT THIS IS. One row per (user, consent kind) recording whether the user
-- agreed to receive marketing/lifecycle email, how many times we've shown the
-- prompt, and the last state we pushed to Loops. It is the SOURCE OF TRUTH for
-- "may we email this person"; the Loops contact list is a downstream mirror
-- (see ee/lib/consent-loops-sync.ts) that is reconciled best-effort.
--
-- STATE MACHINE (status):
--   pending    - never answered; shown on a cadence up to a lifetime cap.
--   granted    - said yes; ON the list.
--   declined   - clicked "No thanks"; terminal, never asked again, OFF the list.
--   withdrawn  - was granted then opted out in settings; OFF the list, but
--                re-asked on a (gentler) cadence.
--   stopped    - hit the lifetime ask cap without ever granting; OFF the list.
--                Re-opens (asked again) only if an admin later raises the cap.
-- The ask cadence + the lifetime cap are admin-configurable (app_settings keys
-- consent_*, read by ee/lib/consent-config.ts); NONE of them live here.
--
-- SERVICE-ROLE ONLY. RLS is on with zero policies and the table is revoked from
-- anon/authenticated: every read and write goes through the backend
-- (routes/consent.ts under a verified JWT), never through PostgREST. This is the
-- same posture as signup_signals (365) and the reason profiles' self-writable
-- columns (270) are a cautionary tale — a consent record a user could PATCH is
-- worthless as a lawful-basis record.

CREATE TABLE IF NOT EXISTS public.user_consents (
  user_id          uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Future-proofing that costs nothing: a second consent kind (terms, etc.)
  -- needs no new table. Everything today is 'marketing_email'.
  kind             text    NOT NULL DEFAULT 'marketing_email',
  status           text    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','granted','declined','withdrawn','stopped')),
  -- Lifetime count of times the prompt was actually SHOWN (across every app +
  -- the pending and withdrawn phases). The lifetime cap is checked against this.
  times_shown      integer NOT NULL DEFAULT 0,
  last_shown_at    timestamptz,
  granted_at       timestamptz,
  declined_at      timestamptz,
  withdrawn_at     timestamptz,
  stopped_at       timestamptz,
  -- The consent_version (an app_settings value) the user agreed to. Lets a
  -- material change to the consent copy re-open granted users later if wanted.
  consent_version  integer,
  -- Which Nodaro surface the user answered on (app/studio/voice/recast/...).
  -- Self-reported by the client, best-effort attribution only.
  source_app       text,
  -- Loops reconciliation. loops_dirty = "the contact's subscribed state may be
  -- stale" (set on any status change that a Loops contact should reflect); the
  -- backfill sweep pushes and clears it. Shows never touch these columns.
  -- loops_sync_attempts caps retries: after N consecutive failures the sweep
  -- gives up (clears loops_dirty) and leaves the row visibly 'error' rather than
  -- retrying a permanently-failing contact forever. Reset to 0 on success.
  loops_dirty      boolean NOT NULL DEFAULT false,
  loops_sync_attempts integer NOT NULL DEFAULT 0,
  loops_synced_at  timestamptz,
  loops_sync_status text CHECK (loops_sync_status IS NULL OR loops_sync_status IN ('synced','error')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

-- The sweep scans only dirty rows; keep that scan off a full-table seq scan.
CREATE INDEX IF NOT EXISTS idx_user_consents_loops_dirty
  ON public.user_consents (updated_at)
  WHERE loops_dirty = true;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_consents FROM anon;
REVOKE ALL ON public.user_consents FROM authenticated;

-- ---------------------------------------------------------------------------
-- consent_try_show — atomic "should we show it, and if so stamp the show".
--
-- ONE locked read + one guarded write, so the four apps sharing a session can
-- never double-count a show: the SELECT ... FOR UPDATE serializes concurrent
-- callers; the second re-reads the just-stamped row and finds it ineligible.
--
-- The cadence differs by state (pending vs withdrawn), so BOTH cadences are
-- passed in and the function picks per the row's current status. The lifetime
-- cap (p_max) applies to every non-granted state. The Nth show is allowed and
-- flips the row to 'stopped' so the (N+1)th never fires.
--
-- did_show=true means THIS call stamped a show (the caller should render the
-- prompt). Terminal/granted rows, an exhausted cap, or an un-elapsed cadence
-- all return false.
--
-- SECURITY DEFINER + the REVOKEs below: PostgREST publishes public functions at
-- /rest/v1/rpc/, and this one mutates state, so it must never be callable by a
-- logged-in user directly. Only the service-role backend calls it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consent_try_show(
  p_user_id uuid,
  p_kind text,
  p_pending_cadence_seconds integer,
  p_withdrawn_cadence_seconds integer,
  p_max integer
) RETURNS TABLE (did_show boolean, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.user_consents%ROWTYPE;
  v_cadence integer;
BEGIN
  -- Create the pending row on first sighting; never overwrite an existing one.
  -- The row is guaranteed to exist by the time SELECT runs (INSERT either
  -- created it or hit the conflict), and FOR UPDATE serializes concurrent
  -- callers so two apps sharing a session cannot both stamp the same show.
  INSERT INTO public.user_consents (user_id, kind)
    VALUES (p_user_id, p_kind)
    ON CONFLICT (user_id, kind) DO NOTHING;

  SELECT * INTO r FROM public.user_consents
    WHERE user_id = p_user_id AND kind = p_kind
    FOR UPDATE;

  -- 'granted' and 'declined' are the ONLY states that never show again.
  -- 'stopped' (hit the cap without granting) is deliberately NOT terminal here:
  -- it re-opens if an admin later RAISES the cap, because eligibility is decided
  -- by times_shown vs the CURRENT p_max below, not by a frozen flag.
  IF r.status IN ('granted','declined') THEN
    RETURN QUERY SELECT false, r.status;
    RETURN;
  END IF;

  v_cadence := CASE WHEN r.status = 'withdrawn'
                    THEN p_withdrawn_cadence_seconds
                    ELSE p_pending_cadence_seconds END;

  IF r.times_shown >= p_max
     OR (r.last_shown_at IS NOT NULL
         AND r.last_shown_at > now() - make_interval(secs => v_cadence)) THEN
    RETURN QUERY SELECT false, r.status;
    RETURN;
  END IF;

  UPDATE public.user_consents
     SET times_shown  = times_shown + 1,
         last_shown_at = now(),
         -- Only pending/stopped roll to 'stopped' at the cap; a 'withdrawn' user
         -- who exhausts the cap STAYS withdrawn (they granted once — they are not
         -- "never answered"). A 'stopped' row shown again because the cap was
         -- raised flips back to 'pending' unless this show re-hits the cap.
         status = CASE
                    WHEN status IN ('pending','stopped') AND times_shown + 1 >= p_max THEN 'stopped'
                    WHEN status = 'stopped' THEN 'pending'
                    ELSE status
                  END,
         stopped_at = CASE
                    WHEN status IN ('pending','stopped') AND times_shown + 1 >= p_max THEN now()
                    ELSE stopped_at
                  END,
         updated_at = now()
   WHERE user_id = p_user_id AND kind = p_kind
   RETURNING status INTO r.status;

  RETURN QUERY SELECT true, r.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consent_try_show(uuid, text, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consent_try_show(uuid, text, integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consent_try_show(uuid, text, integer, integer, integer) FROM authenticated;

COMMENT ON TABLE public.user_consents IS
  'Marketing-email consent, source of truth for "may we email this user". Cloud-only. Service-role only (RLS on, no policies). Loops is a downstream mirror.';
