-- Pricing for edit-video-pro: replace-span Seedance-2 bridge fee.
-- The node's per-second segment cost derives from the existing seedance-2*
-- `-ref` composites at runtime (backend/src/ee/billing/edit-video-pro-credits.ts);
-- this row seeds only the flat fee-base layered on top of every replace run.
--
-- Value MUST match STATIC_CREDIT_COSTS["edit-video-pro"] in
-- backend/src/ee/billing/credits.ts (credit-pricing-migration-sync test).
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('edit-video-pro', 10, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
