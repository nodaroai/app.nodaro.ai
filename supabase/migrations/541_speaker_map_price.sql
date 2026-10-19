-- 541: Speaker Map, the podcast primitive that works out which camera each
-- speaker is on from the cameras' own microphones (local FFmpeg decode and an
-- in-process level comparison, no external provider). Flat, like Silence
-- Detect: 10 credits a run, the `speaker-map` row the node unit's price.ee.ts
-- states (static-costs-match-migrations.test.ts holds the two together).
-- The node ships hidden; a row for a node no one can run charges nothing.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('speaker-map', 10, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
