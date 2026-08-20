-- 302: video-audit ("AI Audit") pricing — both credit families × 4 duration
-- buckets, plus each family's bare (unknown-duration ceiling) id. Matches
-- packages/shared/src/video-analysis-pricing.ts's VIDEO_AUDIT_BUCKET_CREDITS
-- table exactly (10 identifiers total). Same bucket ladder as video-analysis
-- (60/180/360/600s); bare ids equal their family's 600s ceiling — the same
-- "unknown duration → ceiling" convention every video-analysis row already
-- uses.
--
-- Two families, selected by whether an analysis was already wired into the
-- node (buildVideoAuditCreditId): `video-audit` re-audits an existing
-- analysis; `video-audit:auto` has no analysis wired, so the node auto-runs
-- a fast analysis first (hence the higher price).
--
-- Values are the plugin repo generator's outputs — never hand computed. These rows were pre-seeded live on
-- 2026-08-04 (ahead of this migration landing) so `/admin/models` and MCP
-- discovery weren't blocked on the app-repo release; this migration formalizes
-- them as a tracked, idempotent upsert so a fresh environment (staging reset,
-- new prod region) converges on the same values.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit', 1066)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:60s', 213)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:180s', 289)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:360s', 659)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:600s', 1066)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto', 1912)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:60s', 393)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:180s', 474)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:360s', 1173)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:600s', 1912)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
