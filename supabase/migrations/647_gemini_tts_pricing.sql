-- Google's Gemini text-to-speech on KIE, one speaker (decided 2026-11-12,
-- provisional until re-measured on staging): four models, two credit rows
-- each, admin-visible in /admin/models.
--
-- `<id>:per-1k-chars` is the rate a request is charged at while
-- SPEECH_LENGTH_PRICING_ENABLED is on: the text sent is counted as every
-- speech model's is — started 100 characters, at least 8 — and a request costs
-- its hundreds × this row ÷ 10, rounded up once. Quoted per 1,000 because the
-- rate is under one credit per 100 characters, which a whole-credit row
-- cannot hold. The flat `<id>` row is what a run costs where length pricing is
-- off: the price of 1,000 characters. Base = KIE's measured cost per 1,000
-- characters × 2.5, rounded up. Both mirror STATIC_CREDIT_COSTS
-- (static-costs-match-migrations and the speech pricing tests hold them equal).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('gemini-3-8-flash-lite-tts', 4, true, 'audio'),
  ('gemini-3-8-flash-lite-tts:per-1k-chars', 4, true, 'audio'),
  ('gemini-3-8-flash-tts', 6, true, 'audio'),
  ('gemini-3-8-flash-tts:per-1k-chars', 6, true, 'audio'),
  ('gemini-3-1-flash-tts', 13, true, 'audio'),
  ('gemini-3-1-flash-tts:per-1k-chars', 13, true, 'audio'),
  ('gemini-2-5-pro-tts', 16, true, 'audio'),
  ('gemini-2-5-pro-tts:per-1k-chars', 16, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
