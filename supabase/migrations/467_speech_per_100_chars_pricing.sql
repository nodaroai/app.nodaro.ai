-- Length-based speech pricing (decided 2026-10-06): one price row per speech
-- model for each STARTED 100 characters of the text sent, with a minimum of
-- 8 units per request. Read only while SPEECH_LENGTH_PRICING_ENABLED is on.
--
-- The existing flat row of each model (elevenlabs-v3 30, elevenlabs-v4 30,
-- elevenlabs-multilingual 30, elevenlabs-turbo 15, elevenlabs-dialogue 25,
-- elevenlabs-dialogue-v4 25) is NOT changed: it is what a run costs with the flag off, and the price every
-- client that knows nothing of length pricing shows. The legacy `elevenlabs`
-- alias has no row of its own; it prices on turbo's.
--
-- Values mirror STATIC_CREDIT_COSTS (speech-unit-pricing.test.ts holds them
-- equal). ON CONFLICT DO NOTHING: an administrator's retune survives
-- re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-v3:per-100-chars', 4, true, 'audio'),
  ('elevenlabs-v4:per-100-chars', 4, true, 'audio'),
  ('elevenlabs-multilingual:per-100-chars', 4, true, 'audio'),
  ('elevenlabs-turbo:per-100-chars', 2, true, 'audio'),
  ('elevenlabs-dialogue:per-100-chars', 4, true, 'audio'),
  ('elevenlabs-dialogue-v4:per-100-chars', 4, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
