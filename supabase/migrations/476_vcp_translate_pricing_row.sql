-- Voice Changer Pro: the translate step of "Re-speak in another language"
-- (translate the transcript, then re-speak it with a v4 voice), decided 2026-10-06.
--
--   voice-changer-pro-translate  the FLOOR, in credits, of a metered translation:
--                                the step is charged on the translation model's
--                                measured usage, never below this floor and never
--                                above the reservation ceiling the request sized
--                                from its source characters. Admin-tunable here;
--                                the plugin seeds the same value as its DB-down fallback.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('voice-changer-pro-translate', 2, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
