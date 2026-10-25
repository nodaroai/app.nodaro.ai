-- Trends can be archived: put away by an admin without being deleted.
--
-- `archived` is a fourth `trends.status`. An archived trend is off the catalog
-- like an unpublished one (every public read asks for `status = 'published'`),
-- and the admin list hides it unless asked to show archived trends. Nothing
-- else changes: its versions, favorites and every run made of it stay, so a
-- user's history keeps its runs. Restoring sets the status back to
-- `unpublished` when it was ever published, else `draft`; publishing an
-- archived trend is refused until it is restored.
--
-- The CHECK is migration 549's inline one (auto-named `trends_status_check`),
-- widened: every existing row already satisfies it.

ALTER TABLE public.trends DROP CONSTRAINT IF EXISTS trends_status_check;
ALTER TABLE public.trends
  ADD CONSTRAINT trends_status_check CHECK (status IN ('draft', 'published', 'unpublished', 'archived'));
