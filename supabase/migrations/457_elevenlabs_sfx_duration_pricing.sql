-- ElevenLabs sound effects (Text to Audio) are priced by the length asked
-- for: one row per whole second, 1 base credit per second
-- (`elevenlabs-sfx:1s` … `elevenlabs-sfx:30s`). The requested length is
-- rounded UP to whole seconds; a request that names no length is billed as
-- 5 s. Matches STATIC_CREDIT_COSTS (backend/src/ee/billing/credits.ts) and
-- `textToAudioCreditId` (@nodaro/shared), which picks the row on every path.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-sfx:1s', 1, true, 'audio'),
  ('elevenlabs-sfx:2s', 2, true, 'audio'),
  ('elevenlabs-sfx:3s', 3, true, 'audio'),
  ('elevenlabs-sfx:4s', 4, true, 'audio'),
  ('elevenlabs-sfx:5s', 5, true, 'audio'),
  ('elevenlabs-sfx:6s', 6, true, 'audio'),
  ('elevenlabs-sfx:7s', 7, true, 'audio'),
  ('elevenlabs-sfx:8s', 8, true, 'audio'),
  ('elevenlabs-sfx:9s', 9, true, 'audio'),
  ('elevenlabs-sfx:10s', 10, true, 'audio'),
  ('elevenlabs-sfx:11s', 11, true, 'audio'),
  ('elevenlabs-sfx:12s', 12, true, 'audio'),
  ('elevenlabs-sfx:13s', 13, true, 'audio'),
  ('elevenlabs-sfx:14s', 14, true, 'audio'),
  ('elevenlabs-sfx:15s', 15, true, 'audio'),
  ('elevenlabs-sfx:16s', 16, true, 'audio'),
  ('elevenlabs-sfx:17s', 17, true, 'audio'),
  ('elevenlabs-sfx:18s', 18, true, 'audio'),
  ('elevenlabs-sfx:19s', 19, true, 'audio'),
  ('elevenlabs-sfx:20s', 20, true, 'audio'),
  ('elevenlabs-sfx:21s', 21, true, 'audio'),
  ('elevenlabs-sfx:22s', 22, true, 'audio'),
  ('elevenlabs-sfx:23s', 23, true, 'audio'),
  ('elevenlabs-sfx:24s', 24, true, 'audio'),
  ('elevenlabs-sfx:25s', 25, true, 'audio'),
  ('elevenlabs-sfx:26s', 26, true, 'audio'),
  ('elevenlabs-sfx:27s', 27, true, 'audio'),
  ('elevenlabs-sfx:28s', 28, true, 'audio'),
  ('elevenlabs-sfx:29s', 29, true, 'audio'),
  ('elevenlabs-sfx:30s', 30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

-- The bare engine row now prices the no-duration default (5 s). Guarded on the
-- previous flat price so an administrator's own retune is left alone.
UPDATE public.model_pricing SET credit_cost = 5 WHERE model_identifier = 'elevenlabs-sfx' AND credit_cost = 3;
