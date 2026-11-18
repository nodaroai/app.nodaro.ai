-- Replace Audio's price rows (the Nodaro Cloud plugin serves the run at
-- POST /v1/replace-audio and prices it per run, by its mode and by whether
-- its music is made from a prompt). BASE credits per run:
--   replace-audio                     150  keep the speech, music from a file
--   replace-audio:prompt              180  keep the speech, music from a prompt
--   replace-audio:replace-all          50  replace all the sound, music from a file
--   replace-audio:replace-all:prompt   80  replace all the sound, music from a prompt
-- The plugin's floors (staticCreditCosts) are these same values, and they are
-- repeated in STATIC_CREDIT_COSTS so the rows are not ghosts and a host without
-- them prices the same (credit-pricing-migration-sync.test.ts,
-- static-costs-match-migrations.test.ts). Tunable in /admin/models.
--
-- ON CONFLICT DO NOTHING keeps any admin retune, and makes a second run a
-- no-op.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('replace-audio', 150, true, 'video'),
  ('replace-audio:prompt', 180, true, 'video'),
  ('replace-audio:replace-all', 50, true, 'video'),
  ('replace-audio:replace-all:prompt', 80, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
