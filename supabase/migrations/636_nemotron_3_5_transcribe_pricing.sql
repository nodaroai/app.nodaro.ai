-- Nemotron 3.5 Transcribe (NVIDIA speech-to-text on KIE; decided 2026-11-12):
-- a Transcribe engine priced per STARTED minute of the file, whatever the
-- options (a plain transcript, word timings with speakers, or a translation).
-- The price is 0.75 base credits a minute, which no whole-credit row can hold,
-- so the rate row prices FOUR minutes: a run reserves
-- `nemotron-3-5-transcribe:<N>m` (N = 1..60, measured before the hold), which
-- billing prices as this row × N ÷ 4, rounded up once — never a row of its own.
-- The bare engine id is the 60-minute maximum (3 × 60 ÷ 4 = 45): no run
-- reserves it (the route and the workflow run measure the file first); it
-- bounds any path that names the engine alone. Admins retune the per-4-minute
-- rate here, in /admin/models. Values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nemotron-3-5-transcribe:per-4m', 3, true, 'audio'),
  ('nemotron-3-5-transcribe', 45, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
