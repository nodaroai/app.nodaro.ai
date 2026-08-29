-- 356: video-analysis + video-audit schedule re-derived — recast shot-craft
-- Stage 1.3. The analyser's doctrine grew again, so the plugin's system-prompt
-- token pin moved 8_482 -> 8_706 (cloud-plugins 0.209.0) and 12 of 20 analysis
-- rows plus 6 of 8 audit rows tick up by 1-3 credits (~0.1-0.3%). The legacy
-- `gemini-3-flash` family is unchanged. Values are the output of the plugin's
-- own generator (scripts/gen-va-buckets.mjs), never computed here; the formula
-- and its constants stay private in the cloud-plugins repo.
--
-- Net effect, per bucket:
--
--   gemini-3-flash      60s  180-> 180  180s  185-> 185  360s  515-> 515  600s  847-> 847
--   gemini-3.6-flash    60s  203-> 204  180s  218-> 218  360s  599-> 600  600s  988-> 990
--   gemini-3.1-pro      60s  215-> 216  180s  232-> 232  360s  638-> 639  600s 1052->1053
--   mixed               60s  269-> 269  180s  290-> 290  360s  725-> 727  600s 1171->1174
--   smart               60s  411-> 412  180s  501-> 502  360s 1262->1264  600s 2068->2071
--   video-audit         60s  214-> 214  180s  289-> 290  360s  660-> 661  600s 1068->1070
--   video-audit:auto    60s  394-> 394  180s  474-> 475  360s 1175->1176  600s 1915->1917
--
-- Bare ids (no duration) follow their family's 600s (ceiling) bucket; the bare
-- `video-analysis` id is the MAX of the whole table (= smart:600s). Convergent
-- and idempotent (upsert), matching 355: re-running is a no-op.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis', 2071)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3-flash', 847)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3-flash:60s', 180)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3-flash:180s', 185)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3-flash:360s', 515)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3-flash:600s', 847)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.6-flash', 990)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.6-flash:60s', 204)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.6-flash:180s', 218)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.6-flash:360s', 600)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.6-flash:600s', 990)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.1-pro', 1053)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.1-pro:60s', 216)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.1-pro:180s', 232)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.1-pro:360s', 639)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:gemini-3.1-pro:600s', 1053)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed', 1174)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:60s', 269)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:180s', 290)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:360s', 727)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:mixed:600s', 1174)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart', 2071)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:60s', 412)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:180s', 502)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:360s', 1264)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-analysis:smart:600s', 2071)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit', 1070)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:60s', 214)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:180s', 290)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:360s', 661)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:600s', 1070)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto', 1917)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:60s', 394)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:180s', 475)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:360s', 1176)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-audit:auto:600s', 1917)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
