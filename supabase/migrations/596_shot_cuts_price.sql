-- 596: Shot Cuts, the node that lists a video's shots — where each starts and
-- ends, measured from the file with the platform's own scene-cut rule (local
-- FFmpeg decode, no external provider) — and optionally saves each shot's first
-- and last frame. Flat: 1 credit a run, with or without frames, the `shot-cuts`
-- row the node unit's price.ee.ts states (static-costs-match-migrations.test.ts
-- holds the two together). The node ships hidden; a row for a node no one can
-- run charges nothing.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('shot-cuts', 1, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
