-- 646: video-analysis fast tier moves to gemini-3.8-flash.
--
-- KIE dropped gemini-3-flash's channel (every call answers code 422 "The
-- channel is not supported"), so the fast tier now resolves to
-- gemini-3.8-flash (VIDEO_ANALYSIS_TIERS.fast in @nodaro/shared) and
-- gemini-3-flash becomes a legacy fast backing: its rows stay exactly as they
-- are, for stored raw-model configs.
--
-- Only the rows the model swap touches move, regenerated on the deployed
-- schedule's basis (migration 357); every other row stays as deployed:
--
--   gemini-3.8-flash (new) 60s  186  180s  193  360s  534  600s  880
--   mixed                  60s  270-> 275  180s  291-> 298  360s  729-> 748  600s 1177->1209
--   smart                  60s  413-> 416  180s  503-> 508  360s 1267->1280  600s 2076->2097
--   video-audit:auto       60s  396-> 401  180s  475-> 483  360s 1178->1197  600s 1921->1953
--
-- `mixed` and `smart` move because their plans roll the fast model too; the
-- `video-audit:auto` family is the audit base plus the fast row. Bare ids (no
-- duration) follow their family's 600s bucket; the bare `video-analysis` id is
-- the MAX of the whole table (= smart:600s).
--
-- The new gemini-3.8-flash rows take their switches (is_enabled,
-- tier_restriction, category) from the matching gemini-3-flash row, so a fast
-- tier an administrator switched off or restricted stays that way. Convergent
-- and idempotent (upsert on credit_cost): re-running is a no-op.

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction, category)
SELECT
  rate.model_identifier,
  rate.credit_cost,
  CASE WHEN earlier.model_identifier IS NULL THEN true ELSE earlier.is_enabled END,
  earlier.tier_restriction,
  CASE WHEN earlier.model_identifier IS NULL THEN 'other' ELSE earlier.category END
FROM (VALUES
  ('video-analysis:gemini-3.8-flash', 880, 'video-analysis:gemini-3-flash'),
  ('video-analysis:gemini-3.8-flash:60s', 186, 'video-analysis:gemini-3-flash:60s'),
  ('video-analysis:gemini-3.8-flash:180s', 193, 'video-analysis:gemini-3-flash:180s'),
  ('video-analysis:gemini-3.8-flash:360s', 534, 'video-analysis:gemini-3-flash:360s'),
  ('video-analysis:gemini-3.8-flash:600s', 880, 'video-analysis:gemini-3-flash:600s')
) AS rate(model_identifier, credit_cost, earlier_identifier)
LEFT JOIN public.model_pricing AS earlier ON earlier.model_identifier = rate.earlier_identifier
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis', 2097)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed', 1209)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:60s', 275)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:180s', 298)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:360s', 748)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:600s', 1209)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart', 2097)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:60s', 416)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:180s', 508)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:360s', 1280)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:600s', 2097)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto', 1953)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:60s', 401)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:180s', 483)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:360s', 1197)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:600s', 1953)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
