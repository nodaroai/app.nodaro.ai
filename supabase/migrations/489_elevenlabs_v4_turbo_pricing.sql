-- ElevenLabs v4 Turbo text-to-speech (decided 2026-10-06): the new model's two
-- credit rows, admin-visible in /admin/models. The flat row is what a run costs
-- where length pricing is off, at parity with elevenlabs-turbo (15); the
-- :per-100-chars row is the price of ONE started 100 characters, read only while
-- SPEECH_LENGTH_PRICING_ENABLED is on, at Turbo's rate (2; a request is at least
-- 8 units). Both mirror STATIC_CREDIT_COSTS (tts-pricing-coverage and
-- speech-unit-pricing hold them equal).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-v4-turbo', 15, true, 'audio'),
  ('elevenlabs-v4-turbo:per-100-chars', 2, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
