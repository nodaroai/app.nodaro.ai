-- 275_video_analysis_roll_plan_reprice.sql
--
-- CONVERGENCE MIGRATION — video-analysis was priced for ONE provider call per
-- window while the engine has run best-of-N for many releases. The private
-- formula (videoAnalysisBucketCredits) modelled a single roll, so every
-- additional roll was invisible on the invoice, and the `mixed` rows had to be
-- hand-set because no formula described them at all. The formula now reads the
-- SAME roll plan the engine dispatches (roll-plan.ts in the analysis plugin),
-- and these rows are its regenerated output.
--
-- Two things move at once, and the split matters when reading the numbers:
--   1. CORRECTION (most of it): pure tiers run 3 rolls per window, mixed ran 5.
--      None of that was priced.
--   2. CHANGE (small part): the mixed plan goes 3 fast + 2 pro → 3 fast + 3 pro,
--      so both mixed variants stay IDENTICAL compute and can keep sharing one
--      credit family, and equal groups make dither phases match across models.
--
--   identifier                     was → now (60s · 180s · 360s · 600s)
--   gemini-3-flash (legacy)        1→2 · 1→3 ·  2→6 ·  3→9
--   gemini-3.6-flash (fast)        2→5 · 2→6 · 5→15 · 9→25
--   gemini-3.1-pro (pro)           2→6 · 3→8 · 7→20 · 11→33
--   mixed / mixed-fast             3→10 · 4→13 · 9→35 · 14→57
--
-- Every pricing constant is UNCHANGED — the padding term, the credit cost
-- basis, the ingestion rate, and the per-window output estimate all stay as
-- they were. Only the roll count entered the formula, so the whole delta is
-- compute that was always being spent. The safety margin is the lever if these
-- should land softer; halving it halves every number here.
--
-- DO UPDATE, not DO NOTHING: this is a convergence, and every one of these rows
-- already exists from migrations 247/248/259/273 — DO NOTHING would leave the
-- stale prices in place and silently do nothing at all. The cost is that an
-- admin override set via /admin/models on THESE identifiers is overwritten;
-- re-apply any deliberate override after deploy.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Legacy fast tier (stored raw-id configs still resolve here).
  ('video-analysis:gemini-3-flash',          9, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-3-flash:60s',      2, true, 'other'),
  ('video-analysis:gemini-3-flash:180s',     3, true, 'other'),
  ('video-analysis:gemini-3-flash:360s',     6, true, 'other'),
  ('video-analysis:gemini-3-flash:600s',     9, true, 'other'),
  -- Current fast tier.
  ('video-analysis:gemini-3.6-flash',       25, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-3.6-flash:60s',    5, true, 'other'),
  ('video-analysis:gemini-3.6-flash:180s',   6, true, 'other'),
  ('video-analysis:gemini-3.6-flash:360s',  15, true, 'other'),
  ('video-analysis:gemini-3.6-flash:600s',  25, true, 'other'),
  -- Pro tier.
  ('video-analysis:gemini-3.1-pro',         33, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-3.1-pro:60s',      6, true, 'other'),
  ('video-analysis:gemini-3.1-pro:180s',     8, true, 'other'),
  ('video-analysis:gemini-3.1-pro:360s',    20, true, 'other'),
  ('video-analysis:gemini-3.1-pro:600s',    33, true, 'other'),
  -- Mixed family — `mixed` and `mixed-fast` share this one segment.
  ('video-analysis:mixed',                  57, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:mixed:60s',              10, true, 'other'),
  ('video-analysis:mixed:180s',             13, true, 'other'),
  ('video-analysis:mixed:360s',             35, true, 'other'),
  ('video-analysis:mixed:600s',             57, true, 'other')
ON CONFLICT (model_identifier) DO UPDATE
  SET credit_cost = EXCLUDED.credit_cost,
      is_enabled  = EXCLUDED.is_enabled;
