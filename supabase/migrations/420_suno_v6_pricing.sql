-- Suno V6 family (V6 / V6 Wild / V6 Mini) — KIE's current Suno generation
-- (docs.kie.ai/suno-api/generate-music, 2026-09). Every pre-V6 version is
-- marked "Discontinued" upstream but stays accepted for saved workflows, so
-- the existing rows (suno, suno-v5, suno-v5_5) are left untouched.
--
-- One row per version so an admin can reprice a single version without a
-- code change. Values MUST match STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts, the `pricing` rows on each MODEL_CATALOG
-- entry (packages/shared/src/model-catalog.ts) and SUNO_VERSION_CREDIT_KEYS
-- (packages/shared/src/credit-identifiers.ts).
--
-- 30 credits derives from KIE's published 12 credits per generate request
-- through the platform's standard conversion — identical to every prior
-- Suno version (migration 108 for V5.5, re-based by 288).
--
-- `/admin/models` reads model_pricing and nothing else, so without these rows
-- the versions are invisible to admins even though they generate correctly.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('suno-v6',      30, true, 'audio'),
  ('suno-v6_wild', 30, true, 'audio'),
  ('suno-v6_mini', 30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
