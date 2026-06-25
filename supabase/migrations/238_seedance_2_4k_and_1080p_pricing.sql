-- Full seedance-2 (KIE bytedance/seedance-2): add 4K pricing + correct the
-- previously-guessed 1080p rates. KIE pricing page verified 2026-06-25:
--   1080p: 102 KIE cr/s (no video) / 62 (with video)
--   4K:    208 KIE cr/s (no video) / 128 (with video)
-- Nodaro credits = ceil(KIE_per_sec × duration / 4). Values MUST match
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- fast/mini are NOT affected (separate KIE models, 480p/720p only).

-- New 4K composites — INSERT only (preserve any future admin override).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedance-2:4s:4k',      208, true, 'video'),
  ('seedance-2:8s:4k',      416, true, 'video'),
  ('seedance-2:12s:4k',     624, true, 'video'),
  ('seedance-2:15s:4k',     780, true, 'video'),
  ('seedance-2:4s:4k-ref',  128, true, 'video'),
  ('seedance-2:8s:4k-ref',  256, true, 'video'),
  ('seedance-2:12s:4k-ref', 384, true, 'video'),
  ('seedance-2:15s:4k-ref', 480, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;

-- 1080p correction — conditional UPDATE: only overwrite rows still at the old
-- (wrong) seeded value, so genuine admin overrides are preserved.
UPDATE model_pricing SET credit_cost = 102 WHERE model_identifier = 'seedance-2:4s:1080p'      AND credit_cost = 62;
UPDATE model_pricing SET credit_cost = 204 WHERE model_identifier = 'seedance-2:8s:1080p'      AND credit_cost = 123;
UPDATE model_pricing SET credit_cost = 306 WHERE model_identifier = 'seedance-2:12s:1080p'     AND credit_cost = 185;
UPDATE model_pricing SET credit_cost = 383 WHERE model_identifier = 'seedance-2:15s:1080p'     AND credit_cost = 231;
UPDATE model_pricing SET credit_cost = 62  WHERE model_identifier = 'seedance-2:4s:1080p-ref'  AND credit_cost = 38;
UPDATE model_pricing SET credit_cost = 124 WHERE model_identifier = 'seedance-2:8s:1080p-ref'  AND credit_cost = 75;
UPDATE model_pricing SET credit_cost = 186 WHERE model_identifier = 'seedance-2:12s:1080p-ref' AND credit_cost = 113;
UPDATE model_pricing SET credit_cost = 233 WHERE model_identifier = 'seedance-2:15s:1080p-ref' AND credit_cost = 141;
