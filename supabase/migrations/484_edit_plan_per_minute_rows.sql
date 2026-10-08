-- Edit Plan per started minute (decided 2026-10-07).
--
-- The price of an Edit Plan run is ONE rate row and ONE flat row per mode × tier:
--   edit-plan:<mode>:<tier>:per-minute   credits per started source minute
--   edit-plan:<mode>:<tier>:flat         credits once per plan (0 for tighten and chapters)
-- Every id a run reserves, `edit-plan:<mode>:<tier>:<N>m`, costs
--   flat + rate × N
-- whether N is a started-minute count (a plugin that declares
-- supports().editPlanPerMinute) or one of the old 15/30/60/90/120/180-minute
-- steps. The app prices those ids from these two rows on every lookup
-- (backend/src/ee/billing/credits.ts, editPlanMinutesBase), never from a row of
-- their own, so a retune of a rate or flat row moves the listing, every
-- estimate and every reserve together.
--
-- The 72 step rows (migrations 432 and 465) are deleted: their seeded values
-- were exactly this formula at the step, and a step row is no longer read, so
-- keeping it in /admin/models would offer an edit that changes nothing. The
-- bare `edit-plan` row (the table maximum, 1480 = premium clips or trailer at
-- 180 minutes) stays.
--
-- These MUST match backend/src/ee/billing/credits.ts (EDIT_PLAN_STATIC).
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('edit-plan:tighten:economy:per-minute', 2, true, 'other'),
  ('edit-plan:tighten:economy:flat', 0, true, 'other'),
  ('edit-plan:tighten:standard:per-minute', 4, true, 'other'),
  ('edit-plan:tighten:standard:flat', 0, true, 'other'),
  ('edit-plan:tighten:premium:per-minute', 8, true, 'other'),
  ('edit-plan:tighten:premium:flat', 0, true, 'other'),
  ('edit-plan:clips:economy:per-minute', 2, true, 'other'),
  ('edit-plan:clips:economy:flat', 10, true, 'other'),
  ('edit-plan:clips:standard:per-minute', 4, true, 'other'),
  ('edit-plan:clips:standard:flat', 20, true, 'other'),
  ('edit-plan:clips:premium:per-minute', 8, true, 'other'),
  ('edit-plan:clips:premium:flat', 40, true, 'other'),
  ('edit-plan:chapters:economy:per-minute', 2, true, 'other'),
  ('edit-plan:chapters:economy:flat', 0, true, 'other'),
  ('edit-plan:chapters:standard:per-minute', 4, true, 'other'),
  ('edit-plan:chapters:standard:flat', 0, true, 'other'),
  ('edit-plan:chapters:premium:per-minute', 8, true, 'other'),
  ('edit-plan:chapters:premium:flat', 0, true, 'other'),
  ('edit-plan:trailer:economy:per-minute', 2, true, 'other'),
  ('edit-plan:trailer:economy:flat', 10, true, 'other'),
  ('edit-plan:trailer:standard:per-minute', 4, true, 'other'),
  ('edit-plan:trailer:standard:flat', 20, true, 'other'),
  ('edit-plan:trailer:premium:per-minute', 8, true, 'other'),
  ('edit-plan:trailer:premium:flat', 40, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

DELETE FROM public.model_pricing
  WHERE model_identifier ~ '^edit-plan:(tighten|clips|chapters|trailer):(economy|standard|premium):(15|30|60|90|120|180)m$';
