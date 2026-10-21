-- A stored listing whose price holds a metered LLM ESTIMATE (metered LLM
-- pricing, Task 12 / R47): a node that calls a model is charged its actual
-- usage per token, so its listed figure is that model's typical call, and the
-- marketplace card, the template card and the app runner show it `~N`.
--
-- Written at publish by the listing estimator (`estimateWorkflowListingCredits`
-- returns its own flag) and by `backend/src/ee/scripts/backfill-llm-listing-prices.ts`;
-- the tutorial seeder writes a built-in template's from its doc. FALSE for a
-- fixed price; NULL for a row stored before this column (read as fixed). A
-- reader shows it only while metered pricing is on: under the tier-pricing
-- rollback (LLM_TIER_PRICING_ROLLBACK) no figure is an estimate.
--
-- RLS is unaffected: the columns ride the tables' existing policies.
ALTER TABLE public.published_apps
  ADD COLUMN IF NOT EXISTS estimated_credits_is_estimate BOOLEAN;

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS estimated_credits_is_estimate BOOLEAN;

COMMENT ON COLUMN public.published_apps.estimated_credits_is_estimate IS
  'The listed price holds a metered LLM estimate (shown ~N while metered pricing is on). NULL: stored before the column.';
COMMENT ON COLUMN public.workflow_templates.estimated_credits_is_estimate IS
  'The listed price holds a metered LLM estimate (shown ~N while metered pricing is on). NULL: stored before the column.';
