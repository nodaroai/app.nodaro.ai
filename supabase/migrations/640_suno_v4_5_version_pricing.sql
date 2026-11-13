-- Suno V4_5PLUS / V4_5ALL / V4_5 get a price row each (decided 2026-11-12), as
-- V5 and V6 have: a generate, cover or extend run on one of them is now
-- reserved and charged under its version's row (`SUNO_VERSION_CREDIT_KEYS` in
-- packages/shared/src/credit-identifiers.ts) instead of the operation's
-- (`suno-generate` / `suno-cover` / `suno-extend`). Each is now also a model-
-- catalog entry, so a deployment's model restriction can name it.
--
-- 30 credits: the base those runs were charged under the operation's row, so
-- no run changes price. Values MUST match STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts and the `pricing` rows of each
-- MODEL_CATALOG entry (packages/shared/src/model-catalog.ts).
--
-- `/admin/models` reads model_pricing and nothing else, so without these rows
-- the versions are invisible to admins.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('suno-v4_5plus', 30, true, 'audio'),
  ('suno-v4_5all',  30, true, 'audio'),
  ('suno-v4_5',     30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
