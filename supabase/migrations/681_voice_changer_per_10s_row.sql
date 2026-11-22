-- Voice Changer is charged per started 10 seconds of its audio, as the server
-- reads it before anything is held (decided 2026-11-22): this row is the price
-- of ten seconds, and a run is charged row × its units (at least one, up to the
-- 5-minute cap's 30) — the hold is the charge. Value MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- Only ADDS the row: `elevenlabs-voice-changer` and `voice-changer` stay exactly
-- as they are — the voiced-video add-on and the film pipeline still charge the
-- flat row, and the code running when this migration lands still charges it
-- for a Voice Changer run.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('elevenlabs-voice-changer:per-10s', 10, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
