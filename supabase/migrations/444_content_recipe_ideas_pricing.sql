-- Content Recipe + Content Ideas ("steal the format"). Cloud-only nodes: the
-- implementation is a private plugin; these are the public prices users pay.
--
-- Content Recipe (content-recipe): one structured model call over one post's
-- material, flat per call by the chosen model's tier (decided 2026-10-01):
--   economy 5 / standard 20 / premium 35.
--
-- Content Ideas (content-ideas): charged per batch of up to five ideas
-- (decided 2026-10-02). A run of 1-5 ideas bills the base id, a run of 6-10
-- the `content-ideas:10` id, priced at two batches:
--   1-5 ideas:  economy 10 / standard 35 / premium 50
--   6-10 ideas: economy 20 / standard 70 / premium 100
--
-- The id rule lives in packages/shared/src/content-recipe-ideas.ts; mirrors
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('content-recipe:economy', 5),
  ('content-recipe', 20),
  ('content-recipe:premium', 35),
  ('content-ideas:economy', 10),
  ('content-ideas', 35),
  ('content-ideas:premium', 50),
  ('content-ideas:10:economy', 20),
  ('content-ideas:10', 70),
  ('content-ideas:10:premium', 100)
ON CONFLICT (model_identifier) DO NOTHING;
