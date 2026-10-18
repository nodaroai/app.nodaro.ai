-- Meta Ads + Instagram scrapers: the premium-direct rung of the optional
-- per-post AI analysis (decided 2026-10-17, with gemini-4-argon).
--
-- The analysis tiers are the LLM credit rungs, read through llmCreditRung in
-- @nodaro/shared exactly as the LLM features read them: a model served on its
-- vendor's own API (a `directOnly` one — these routes send no effort and no
-- Advanced flag) moves one rung up, so a premium one bills premium-direct.
-- Every model that is not served direct prices exactly as before.
--
-- Per-post price: CEIL(premium 4 × LLM_PREMIUM_DIRECT_MULTIPLIER 2.5) = 10,
-- the rule every LLM feature's direct rung follows (migration 490). Folded into
-- the scrape's tiered SKU the same way as the other rungs:
--
--   <scrape>:<tier>:analysis:premium-direct   = tier × (1 + 10)
--
-- The formula and the tier set live in packages/shared/src/meta-ads-scrape.ts
-- (Instagram reuses it); mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-analysis:premium-direct', 10) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:10:analysis:premium-direct', 110) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:20:analysis:premium-direct', 220) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:50:analysis:premium-direct', 550) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:100:analysis:premium-direct', 1100) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:200:analysis:premium-direct', 2200) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:500:analysis:premium-direct', 5500) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-analysis:premium-direct', 10) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:10:analysis:premium-direct', 110) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:20:analysis:premium-direct', 220) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:50:analysis:premium-direct', 550) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:100:analysis:premium-direct', 1100) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:200:analysis:premium-direct', 2200) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('instagram-scrape:500:analysis:premium-direct', 5500) ON CONFLICT (model_identifier) DO NOTHING;
