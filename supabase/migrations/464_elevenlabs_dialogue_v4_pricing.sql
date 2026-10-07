-- ElevenLabs Dialogue v4: make the new dialogue model's credit identifier
-- admin-visible in /admin/models. Flat per request, at parity with
-- elevenlabs-dialogue (the STATIC_CREDIT_COSTS fallback carries the same 25).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-dialogue-v4', 25, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
