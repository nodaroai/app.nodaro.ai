-- Social Search node (social-search): search one platform (TikTok, Instagram,
-- YouTube, X, Reddit, LinkedIn, Meta's Ad Library) by keyword or account.
--
-- Pricing: per page of up to 20 results, the same on every platform:
-- social-search:1 / :2 / :3 for 20 / 40 / 60 posts; the bare id is the
-- node's headline price (one page). The table lives in
-- packages/shared/src/social-search.ts (SOCIAL_SEARCH_CREDIT_COSTS) and
-- mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('social-search', 10) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('social-search:1', 10) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('social-search:2', 20) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('social-search:3', 30) ON CONFLICT (model_identifier) DO NOTHING;
