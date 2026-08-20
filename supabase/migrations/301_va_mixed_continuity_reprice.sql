-- 301: VA mixed-family reprice — continuity pass joins mixed/mixed-fast (2026-08-04).
-- Flat +40 credits per bucket (CONTINUITY_PASS_USD 0.04 x SAFETY 2 / 0.002).
-- Values are the plugin repo generator's outputs;
-- must match packages/shared/src/video-analysis-pricing.ts exactly.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed', 1169)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:60s', 268)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:180s', 289)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:360s', 724)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:600s', 1169)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
