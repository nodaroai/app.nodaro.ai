-- Audio Sync node (audio-sync): measures how far apart the clocks of 2-6
-- recordings of one conversation are (local FFmpeg decode + in-process
-- cross-correlation, no external provider), so a multicam edit lines up
-- without anyone typing offsets.
--
-- Pricing: per source ALIGNED to the reference (decided 2026-09-25) —
-- `audio-sync:<n>src` = 10 x (n - 1) credits for n = 2..6 sources: 2 sources
-- cost 10, 6 sources cost 50. Composites only (every lane names one; there is
-- no bare `audio-sync` row). Keyless — community installs run it. Mirrors
-- AUDIO_SYNC_CREDIT_COSTS (backend/src/lib/audio-sync-credit-id.ts), spread
-- into STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('audio-sync:2src', 10),
  ('audio-sync:3src', 20),
  ('audio-sync:4src', 30),
  ('audio-sync:5src', 40),
  ('audio-sync:6src', 50)
ON CONFLICT (model_identifier) DO NOTHING;
