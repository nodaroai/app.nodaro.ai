-- Audio Isolation is charged per started 10 seconds of its audio, as the
-- server reads it before anything is held (decided 2026-11-18): this row is the
-- price of ten seconds, and a run is charged row × its units (at least one, up
-- to the 30-minute cap's 180) — the hold is the charge. Value MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- Only ADDS the row: `elevenlabs-isolation` and `audio-isolation` stay exactly
-- as they are, since the code running when this migration lands still charges
-- them.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('elevenlabs-isolation:per-10s', 10, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
