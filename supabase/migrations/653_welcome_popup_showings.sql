-- The welcome pop-up opens by itself again after a close without an answer
-- (decided 2026-11-16).
--
-- Until now ANY close of the pop-up (×, Escape, a click outside, "Maybe
-- later") stamped welcome_offer_seen_at (426), and a stamped pop-up never
-- opened by itself again. Now only "Maybe later" answers it. A close without
-- an answer lets it open by itself again on a later visit: at most once a day
-- and three times in all. The server decides (backend/src/ee/billing/
-- welcome-popup-rule.ts) from three new columns on the account, so every
-- product and device shares the count:
--
--   welcome_offer_declined_at    "Maybe later" was answered (first one wins)
--   welcome_offer_shown_count    times the pop-up opened by itself
--   welcome_offer_last_shown_at  the last time it did
--
-- welcome_offer_seen_at keeps its column and now means "first shown".
--
-- Backfill: an account that closed the pop-up under the old rule (seen_at
-- set) has that close counted as ONE showing without an answer, made at
-- seen_at, so it may open up to two more times. A close then was not a "Maybe
-- later": nothing is written to declined_at. The guard (nothing counted, no
-- answer) keeps a re-run from touching a row written after this migration.
--
-- Who can write them: the server alone. No column is added to the profiles
-- UPDATE denylist (check_profiles_update_allowed) because none needs it:
-- since 598 a browser session may update one profiles column
-- (last_workspace_id) and a column added later is not writable from the
-- browser until it is granted, which this migration does not do for any of
-- the three. POST /v1/credits/welcome-offer/seen writes them with the service
-- role. Proven by supabase/tests/welcome-popup-showings.behavior.sql.
--
-- A deploy of dev runs ahead of this migration (it lands with the release to
-- main): until the columns exist, every read and write of them falls back to
-- the one seen_at stamp and the old rule (backend/src/ee/billing/welcome-popup.ts).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the backfill's guard. The backfill holds
-- off the set_updated_at trigger, so updated_at is not rewritten.
--
-- profiles is read on every request. The ALTERs take ACCESS EXCLUSIVE on it,
-- so behind a long transaction they would wait and every profile read and
-- write would queue behind them. The lock_timeout (the 2s of 532/536/538)
-- bounds that wait to a failed, safely retried migration instead of a stalled
-- platform. The columns rewrite nothing: two are nullable with no default,
-- and the third's default is a constant (stored once, no table rewrite).
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_offer_declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_offer_shown_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS welcome_offer_last_shown_at timestamptz;

COMMENT ON COLUMN public.profiles.welcome_offer_seen_at IS
  'When the welcome pop-up was first shown (before 653: when it was closed, the one stamp there was).';
COMMENT ON COLUMN public.profiles.welcome_offer_declined_at IS
  'When "Maybe later" was answered on the welcome pop-up; it does not open by itself again. Written by the server only.';
COMMENT ON COLUMN public.profiles.welcome_offer_shown_count IS
  'How many times the welcome pop-up opened by itself (at most once a day is counted). Written by the server only.';
COMMENT ON COLUMN public.profiles.welcome_offer_last_shown_at IS
  'When the welcome pop-up last opened by itself. Written by the server only.';

-- The backfill is bookkeeping, not an edit of the account: profiles'
-- set_updated_at trigger is held off so updated_at keeps its real value.
ALTER TABLE public.profiles DISABLE TRIGGER set_updated_at;

UPDATE public.profiles
   SET welcome_offer_shown_count = 1,
       welcome_offer_last_shown_at = welcome_offer_seen_at
 WHERE welcome_offer_seen_at IS NOT NULL
   AND welcome_offer_shown_count = 0
   AND welcome_offer_last_shown_at IS NULL
   AND welcome_offer_declined_at IS NULL;

ALTER TABLE public.profiles ENABLE TRIGGER set_updated_at;
