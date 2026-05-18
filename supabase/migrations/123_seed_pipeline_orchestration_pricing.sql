-- Migration: seed model_pricing rows for the Generative Pipeline orchestrator.
--
-- Pipeline orchestration is variable-cost — the upfront estimate is computed
-- per run and reserved at request time. These rows exist so the admin UI
-- (`/admin/models`, `/admin/llm-models`) lists the pricing fallback used when
-- no estimate is supplied; STATIC_CREDIT_COSTS in
-- `backend/src/ee/billing/credits.ts` is the runtime fallback.
--
-- Per CLAUDE.md "Provider Enum Sync" step 9, every key in
-- STATIC_CREDIT_COSTS needs a matching INSERT here.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Default fallback for pipeline-orchestration credit reservation.
  ('pipeline-orchestration',                30, true, 'pipeline-orchestration'),

  -- Phase 1A composite: ships only Stage 1 (Script). Median of Detection +
  -- Showrunner + Script Critic + Cast Coverage Critic ≈ 30 credits.
  ('pipeline-orchestration:stage_1_only',   30, true, 'pipeline-orchestration')

ON CONFLICT (model_identifier) DO NOTHING;
