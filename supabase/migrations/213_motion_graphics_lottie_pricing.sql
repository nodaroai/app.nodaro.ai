-- Pricing for the motion-graphics Lottie engine (LlmFeature "motion-graphics-lottie").
-- Three rows: base (standard tier), economy, premium — mirrors the existing
-- motion-graphics 2/1/3 layout but on the heavier Lottie token profile.
--
-- credits: standard 5, economy 1, premium 8 — sized for ~3K in + 4K out tokens per run.
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('motion-graphics-lottie',          5,  true, 'other'),
  ('motion-graphics-lottie:economy',  1,  true, 'other'),
  ('motion-graphics-lottie:premium',  8,  true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
