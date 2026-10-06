-- edit-plan trailer mode (podcast editing, Track D1): one short teaser EDL
-- built from a recording's strongest moments. Priced exactly like `clips` —
-- the tier's per-source-minute rate × the duration bucket, plus the clips flat:
--   perMinute(tier) × bucketMinutes + clipsFlat(tier)
--   perMinute:  economy 2, standard 4, premium 8   (credits per source-minute)
--   clipsFlat:  economy 10, standard 20, premium 40 (once per plan)
-- Composite id `edit-plan:trailer:<tier>:<bucket>m`, 3 tiers × 6 buckets
-- (15/30/60/90/120/180 min) = 18 rows, each equal to its `edit-plan:clips:…`
-- twin from migration 432. The bare `edit-plan` row (1480, the table MAX) is
-- NOT re-seeded: trailer's MAX equals clips', so the bound it carries holds.
--
-- These MUST match backend/src/ee/billing/credits.ts (EDIT_PLAN_STATIC).
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('edit-plan:trailer:economy:15m',     40, true, 'other'),
  ('edit-plan:trailer:economy:30m',     70, true, 'other'),
  ('edit-plan:trailer:economy:60m',    130, true, 'other'),
  ('edit-plan:trailer:economy:90m',    190, true, 'other'),
  ('edit-plan:trailer:economy:120m',   250, true, 'other'),
  ('edit-plan:trailer:economy:180m',   370, true, 'other'),
  ('edit-plan:trailer:standard:15m',    80, true, 'other'),
  ('edit-plan:trailer:standard:30m',   140, true, 'other'),
  ('edit-plan:trailer:standard:60m',   260, true, 'other'),
  ('edit-plan:trailer:standard:90m',   380, true, 'other'),
  ('edit-plan:trailer:standard:120m',  500, true, 'other'),
  ('edit-plan:trailer:standard:180m',  740, true, 'other'),
  ('edit-plan:trailer:premium:15m',    160, true, 'other'),
  ('edit-plan:trailer:premium:30m',    280, true, 'other'),
  ('edit-plan:trailer:premium:60m',    520, true, 'other'),
  ('edit-plan:trailer:premium:90m',    760, true, 'other'),
  ('edit-plan:trailer:premium:120m',  1000, true, 'other'),
  ('edit-plan:trailer:premium:180m',  1480, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
