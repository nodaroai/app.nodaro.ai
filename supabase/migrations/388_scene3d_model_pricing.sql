-- Scene3D previsualization (v1) — model_pricing rows for the two new nodes.
--
-- `generate-3d-scene` and `edit-3d-scene` share ONE LLM feature (`3d-scene`),
-- so the tiered identifiers `buildLlmCreditIdentifier` produces are the three
-- below. `/admin/models` reads model_pricing and nothing else, so without
-- these rows the feature is invisible to admins and unoverridable, even though
-- STATIC_CREDIT_COSTS would still charge correctly at runtime.
--
-- `3d-scene-ops` is the DETERMINISTIC edit lane: the caller supplied explicit
-- operations, they are applied in-process and no model is called. It is priced
-- at 0 on purpose and exists so the admin surface can see (and an operator can
-- price) the lane rather than wonder why some edits never appear in the ledger.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('3d-scene',          30, true, 'other'),
  ('3d-scene:economy',  10, true, 'other'),
  ('3d-scene:premium',  40, true, 'other'),
  ('3d-scene-ops',       0, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
