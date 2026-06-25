-- Pricing for the omnihuman-1-5 lip-sync provider (KIE OmniHuman 1.5):
-- image + audio → prompt-directed talking avatar. Per-second billing,
-- 27 KIE cr/sec, 60s audio cap. Resolution (720/1080) is a quality lever,
-- not a price lever — no per-resolution rows.
--   Nodaro credits = ceil(KIE_cr / 4) = ceil(27 * seconds / 4):
--     15s → 102, 30s → 203, 60s → 405.
-- Bare id = worst-case 60s ceiling (reserved on unknown-duration workflow runs;
-- reconciled down by the worker).
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts and
-- the MODEL_CATALOG pricing block in packages/shared/src/model-catalog.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('omnihuman-1-5',      405, true, 'lip-sync'),  -- bare = 60s ceiling
  ('omnihuman-1-5:15s',  102, true, 'lip-sync'),
  ('omnihuman-1-5:30s',  203, true, 'lip-sync'),
  ('omnihuman-1-5:60s',  405, true, 'lip-sync')
ON CONFLICT (model_identifier) DO NOTHING;
