-- 649: video-analysis gains the `ultra` tier, backed by gemini-4-carbon.
--
-- `ultra` (decided 2026-11-13) resolves to gemini-4-carbon
-- (VIDEO_ANALYSIS_TIERS.ultra in @nodaro/shared): the deepest-reasoning
-- analysis model reading every window. It prices under its own family,
-- between `mixed` and `smart` in every bucket:
--
--   gemini-4-carbon (new) 60s  349  180s  375  360s 1054  600s 1745
--
-- (base credits, as stored). The bare id (no
-- duration) is the 600s ceiling. Every other row stays as deployed: the bare
-- `video-analysis` id is the MAX of the whole table, which is still
-- smart:600s (2097), so it does not move.
--
-- A new tier has no earlier row to take switches from, so the rows start
-- enabled, unrestricted, in category 'other' like every analysis row.
-- Convergent and idempotent (upsert on credit_cost; an administrator's
-- is_enabled / tier_restriction on a re-run stay as set): re-running is a
-- no-op.
--
-- Numbered 649: dev's sequence is 648.

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('video-analysis:gemini-4-carbon',      1745, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-4-carbon:60s',   349, true, 'other'),  -- 1-min bucket
  ('video-analysis:gemini-4-carbon:180s',  375, true, 'other'),  -- 3-min bucket
  ('video-analysis:gemini-4-carbon:360s', 1054, true, 'other'),  -- 6-min bucket
  ('video-analysis:gemini-4-carbon:600s', 1745, true, 'other')   -- 10-min ceiling
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
