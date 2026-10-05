-- ElevenLabs v4 text-to-speech: make the new model's credit identifier
-- admin-visible in /admin/models. Flat per request, at parity with
-- elevenlabs-v3 (the STATIC_CREDIT_COSTS fallback carries the same 30).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-v4', 30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
