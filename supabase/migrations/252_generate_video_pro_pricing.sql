-- Pricing for generate-video-pro: multi-segment Seedance-2-family stitch fee.
-- The node's per-second segment cost derives from the existing seedance-2*
-- composites at runtime (backend/src/ee/billing/generate-video-pro-credits.ts);
-- this row seeds only the flat fee-base layered on top for a multi-segment
-- (stitched) run. Single-segment runs (<=15s) reserve the underlying
-- seedance-2* composite directly and never touch this row.
--
-- Value MUST match STATIC_CREDIT_COSTS["generate-video-pro"] in
-- backend/src/ee/billing/credits.ts (credit-pricing-migration-sync test).
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('generate-video-pro', 10, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
