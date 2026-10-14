-- A published listing's price is a RANGE (decided 2026-10-14): "from" the
-- saved settings — the existing columns, unchanged — "up to" the most a run
-- can cost over the choices the app's user has (every exposed field, at the
-- publisher's restricted values where set; a user-supplied clip at its worst
-- case). Computed at publish by the listing estimator
-- (backend/src/ee/billing/listing-range.ts); a row stored before this, or not
-- yet backfilled (backend/src/ee/scripts/backfill-listing-range.ts), holds NULL and
-- lists its "from" figure alone.
--
-- published_apps (apps and components), mirroring every existing pair — the
-- fee's base (the preview part before the creator's fee) and the listed price:
--   base_max_estimated_credits / max_estimated_credits        fixed
--   base_max_per_minute_credits / max_per_minute_credits      per minute
--   base_max_per_item_credits / max_per_item_credits          per further item
-- workflow_templates (no fee):
--   max_estimated_credits / max_estimated_per_minute_credits
--
-- RLS is unaffected: the columns ride the tables' existing policies.
ALTER TABLE public.published_apps
  ADD COLUMN IF NOT EXISTS base_max_estimated_credits INT CHECK (base_max_estimated_credits >= 0),
  ADD COLUMN IF NOT EXISTS max_estimated_credits INT CHECK (max_estimated_credits >= 0),
  ADD COLUMN IF NOT EXISTS base_max_per_minute_credits INT CHECK (base_max_per_minute_credits >= 0),
  ADD COLUMN IF NOT EXISTS max_per_minute_credits INT CHECK (max_per_minute_credits >= 0),
  ADD COLUMN IF NOT EXISTS base_max_per_item_credits INT CHECK (base_max_per_item_credits >= 0),
  ADD COLUMN IF NOT EXISTS max_per_item_credits INT CHECK (max_per_item_credits >= 0);

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS max_estimated_credits INT CHECK (max_estimated_credits >= 0),
  ADD COLUMN IF NOT EXISTS max_estimated_per_minute_credits INT CHECK (max_estimated_per_minute_credits >= 0);
