-- Choose Best (reduce) — the AI judge (pick-best-llm) now takes a judge model
-- (strategyConfig.llmModel) like every other LLM node, and its price follows
-- the chosen model's tier via buildLlmCreditIdentifier over the feature id
-- "reduce:pick-best-llm":  economy → :economy, standard → bare, premium → :premium.
-- The bare id keeps its existing price (10). Values mirror
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('reduce:pick-best-llm:economy', 3)
  ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('reduce:pick-best-llm:premium', 25)
  ON CONFLICT (model_identifier) DO NOTHING;
