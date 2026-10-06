-- Site Capture (POST /v1/site-capture, MCP capture_site): a web page captured as a
-- full-page phone screenshot plus up to 8 section stills, with a section map.
--
-- Pricing: flat, 10 credits per capture. A capture that is blocked by the site,
-- comes back empty or fails is refunded. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('site-capture', 10) ON CONFLICT (model_identifier) DO NOTHING;
