-- UGC Finish (Cloud only; a private plugin serves it).
--
-- ugc-finish-clips: a free node. On a video whose clips are cut from one recorded
-- speech it runs the plugin's finish job, priced under that job's own row; on any
-- other video it hands the clips on unchanged, with no job. This row holds the
-- node type at 0, as 470_ugc_pricing.sql does for the other UGC nodes.
--
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('ugc-finish-clips', 0)
ON CONFLICT (model_identifier) DO NOTHING;
