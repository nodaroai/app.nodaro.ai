-- 248_video_analysis_pro_reprice.sql
-- [econ-intel comment removed]
-- to the formula's output at the MEASURED constants. Migration 247 seeded
-- provisional values computed from a stale rate registry (gemini-3.1-pro at
-- [figures removed] — Gemini 1.5 Pro list pricing) and pre-measurement
-- token assumptions ([figures removed], ~290 tok/s ingestion).
--
-- [econ-intel comment removed]
-- calls incl. a 596s video) measured:
--   gemini-3-flash   [figures removed]   (was assumed 0.10/0.40)
--   gemini-3.1-pro   [figures removed]   (was assumed 3.50/10.50)
--   [econ-intel comment removed]
--
-- videoAnalysisBucketCredits at the measured constants emits:
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
