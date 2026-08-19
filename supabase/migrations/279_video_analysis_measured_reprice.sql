-- Reprice video-analysis (updated per-bucket schedule).
--
-- The bare `video-analysis` row tracks the table MAXIMUM (see migration 277): it
-- is the unknown-model AND unknown-duration fallback feeding a pre-run balance
-- gate, so it must bound every row.
--
-- Idempotent + convergent, matching 275/276/277. (Numbered 279: 278 was taken by
-- allow_url_import_upload_source, which landed on dev while this was in review.)
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('video-analysis:gemini-3-flash:60s', 21, true, 'other'),
  ('video-analysis:gemini-3-flash:180s', 24, true, 'other'),
  ('video-analysis:gemini-3-flash:360s', 68, true, 'other'),
  ('video-analysis:gemini-3-flash:600s', 112, true, 'other'),
  ('video-analysis:gemini-3-flash', 112, true, 'other'),
  ('video-analysis:gemini-3.6-flash:60s', 54, true, 'other'),
  ('video-analysis:gemini-3.6-flash:180s', 63, true, 'other'),
  ('video-analysis:gemini-3.6-flash:360s', 175, true, 'other'),
  ('video-analysis:gemini-3.6-flash:600s', 291, true, 'other'),
  ('video-analysis:gemini-3.6-flash', 291, true, 'other'),
  ('video-analysis:gemini-3.1-pro:60s', 84, true, 'other'),
  ('video-analysis:gemini-3.1-pro:180s', 96, true, 'other'),
  ('video-analysis:gemini-3.1-pro:360s', 269, true, 'other'),
  ('video-analysis:gemini-3.1-pro:600s', 448, true, 'other'),
  ('video-analysis:gemini-3.1-pro', 448, true, 'other'),
  ('video-analysis:mixed:60s', 137, true, 'other'),
  ('video-analysis:mixed:180s', 158, true, 'other'),
  ('video-analysis:mixed:360s', 443, true, 'other'),
  ('video-analysis:mixed:600s', 739, true, 'other'),
  ('video-analysis:mixed', 739, true, 'other'),
  ('video-analysis', 739, true, 'other')
ON CONFLICT (model_identifier) DO UPDATE
  SET credit_cost = EXCLUDED.credit_cost,
      is_enabled  = EXCLUDED.is_enabled;
