-- 248_video_analysis_pro_reprice.sql
-- Convergence migration: re-anchor the gemini-3.1-pro video-analysis rows to
-- the formula's output at the current pricing constants (see
-- backend/src/lib/pricing/{llm-cost,video-analysis-cost}.ts). Migration 247
-- seeded provisional values computed from an earlier rate registry and
-- pre-reconciliation token assumptions.
--
-- Production reconciliation against actual provider billing confirmed the
-- current per-model token rates and ingestion throughput, superseding the
-- assumptions migration 247 shipped with.
--
-- videoAnalysisBucketCredits at the current constants emits:
--   gemini-3-flash  → 1 / 1 / 2 / 3   (UNCHANGED — 247 rows already correct)
--   gemini-3.1-pro  → 2 / 3 / 7 / 11  (was 13 / 25 / 56 / 94)
--
-- UPDATE (not INSERT..DO NOTHING): 247's provisional pro values are live in
-- prod and MUST converge; scoping the WHERE to each identifier keeps any
-- as-yet-unshipped rows untouched. Flash rows are deliberately not touched.

UPDATE public.model_pricing SET credit_cost = 11
  WHERE model_identifier = 'video-analysis:gemini-3.1-pro';     -- unknown-duration ceiling (600s)
UPDATE public.model_pricing SET credit_cost = 2
  WHERE model_identifier = 'video-analysis:gemini-3.1-pro:60s';  -- 1-min bucket
UPDATE public.model_pricing SET credit_cost = 3
  WHERE model_identifier = 'video-analysis:gemini-3.1-pro:180s'; -- 3-min bucket
UPDATE public.model_pricing SET credit_cost = 7
  WHERE model_identifier = 'video-analysis:gemini-3.1-pro:360s'; -- 6-min bucket
UPDATE public.model_pricing SET credit_cost = 11
  WHERE model_identifier = 'video-analysis:gemini-3.1-pro:600s'; -- 10-min ceiling
