-- Pricing for the omnihuman-2-0 lip-sync model (KIE OmniHuman 2.0): one image
-- + 4 to 300 seconds of audio → a 720p talking avatar as long as the audio.
-- A different model from omnihuman-1-5, offered beside it; 1.5's rows stay.
--
-- ONE row, a RATE: the base credits per second of audio. KIE bills 14 credits
-- per second of output; the base is 14 × 2.5 = 35 per second. A run is charged
-- this row × its billed seconds (the audio's length rounded up to a whole
-- second, at least 4 — shorter audio is padded with silence to 4 s), rounded
-- up once and marked up once by the pricing chain (`unitRateBaseCredits`), and
-- quoted under `omnihuman-2-0:per-second:<seconds>u`. No duration buckets, no
-- bare `omnihuman-2-0` row: a path that asked for one would be refused
-- (price_not_configured) rather than priced at a guess.
--
-- Value MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts and
-- the MODEL_CATALOG pricing block in packages/shared/src/model-catalog.ts
-- (static-costs-match-migrations.test.ts). ON CONFLICT DO NOTHING preserves an
-- admin's override.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('omnihuman-2-0:per-second', 35, true, 'lip-sync')
ON CONFLICT (model_identifier) DO NOTHING;
