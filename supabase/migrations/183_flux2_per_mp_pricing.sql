-- Migration: seed per-MP×ref model_pricing rows for BFL Flux 2 image models
--
-- Replaces the old resolution-less `flux-2-max:Nref` rows (which baked in a
***REDACTED-OSS-SCRUB***
-- 0%-base per-MP×ref grid derived from the canonical formula in
-- `packages/shared/src/flux2-pricing.ts` (flux2BaseCredits).
--
-- Formula:
--   1 credit = $0.02 (base unit)
--   flux2CostUsd(model, outputMP, refCount) = base + perOutMP*outputMP + perRefMP*outputMP*refCount
--   flux2BaseCredits(model, mp, ref) = ceil(round(cost/0.02*1000)/1000)
--
-- Rates:
--   flux-2-klein: base=$0,     perOutMP=$0.006, perRefMP=$0.006
--   flux-2-pro:   base=$0.015, perOutMP=$0.015, perRefMP=$0.015
--   flux-2-max:   base=$0,     perOutMP=$0.07,  perRefMP=$0.03
--
-- MP values: 0.5, 1, 2, 4.  refCount values: 0..8.  Total grid: 3×4×9 = 108 rows.
-- Identifier format: `<model>:<mp>MP:<n>ref`  (e.g. `flux-2-max:2MP:1ref`)
-- Default (admin display): `flux-2-klein`=1 (1MP 0ref), `flux-2-pro`=3 (2MP 0ref), `flux-2-max`=7 (2MP 0ref)
--
-- Removes: `flux-2-max:Nref` (old resolution-less format, N=1..8) — superseded by :MP:Nref.
-- Also reseeds: bare `flux-2-klein`, `flux-2-pro`, `flux-2-max` to correct 0%-base values.

-- 1. Remove stale resolution-less flux-2-max:Nref rows (old format without MP tier)
DELETE FROM public.model_pricing
  WHERE model_identifier ~ '^flux-2-max:[0-9]+ref$';

-- 2. Seed correct base rows + full 108-row per-MP×ref grid
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Base rows (representative default-resolution 0-ref, for admin display)
  ('flux-2-klein', 1, true, 'generate-image'),  -- 1MP 0ref: $0.006 → 1cr
  ('flux-2-pro',   3, true, 'generate-image'),  -- 2MP 0ref: $0.045 → 3cr
  ('flux-2-max',   7, true, 'generate-image'),  -- 2MP 0ref: $0.14  → 7cr

  -- ── flux-2-klein (base=$0, perOutMP=$0.006, perRefMP=$0.006) ──
  -- 0.5 MP (cost = 0.006*0.5 + 0.006*0.5*ref = 0.003 + 0.003*ref)
  ('flux-2-klein:0.5MP:0ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:1ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:2ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:3ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:4ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:5ref', 1, true, 'generate-image'),
  ('flux-2-klein:0.5MP:6ref', 2, true, 'generate-image'),
  ('flux-2-klein:0.5MP:7ref', 2, true, 'generate-image'),
  ('flux-2-klein:0.5MP:8ref', 2, true, 'generate-image'),
  -- 1 MP (cost = 0.006 + 0.006*ref)
  ('flux-2-klein:1MP:0ref', 1, true, 'generate-image'),
  ('flux-2-klein:1MP:1ref', 1, true, 'generate-image'),
  ('flux-2-klein:1MP:2ref', 1, true, 'generate-image'),
  ('flux-2-klein:1MP:3ref', 2, true, 'generate-image'),
  ('flux-2-klein:1MP:4ref', 2, true, 'generate-image'),
  ('flux-2-klein:1MP:5ref', 2, true, 'generate-image'),
  ('flux-2-klein:1MP:6ref', 3, true, 'generate-image'),
  ('flux-2-klein:1MP:7ref', 3, true, 'generate-image'),
  ('flux-2-klein:1MP:8ref', 3, true, 'generate-image'),
  -- 2 MP (cost = 0.012 + 0.012*ref)
  ('flux-2-klein:2MP:0ref', 1, true, 'generate-image'),
  ('flux-2-klein:2MP:1ref', 2, true, 'generate-image'),
  ('flux-2-klein:2MP:2ref', 2, true, 'generate-image'),
  ('flux-2-klein:2MP:3ref', 3, true, 'generate-image'),
  ('flux-2-klein:2MP:4ref', 3, true, 'generate-image'),
  ('flux-2-klein:2MP:5ref', 4, true, 'generate-image'),
  ('flux-2-klein:2MP:6ref', 5, true, 'generate-image'),
  ('flux-2-klein:2MP:7ref', 5, true, 'generate-image'),
  ('flux-2-klein:2MP:8ref', 6, true, 'generate-image'),
  -- 4 MP (cost = 0.024 + 0.024*ref)
  ('flux-2-klein:4MP:0ref', 2, true, 'generate-image'),
  ('flux-2-klein:4MP:1ref', 3, true, 'generate-image'),
  ('flux-2-klein:4MP:2ref', 4, true, 'generate-image'),
  ('flux-2-klein:4MP:3ref', 5, true, 'generate-image'),
  ('flux-2-klein:4MP:4ref', 6, true, 'generate-image'),
  ('flux-2-klein:4MP:5ref', 8, true, 'generate-image'),
  ('flux-2-klein:4MP:6ref', 9, true, 'generate-image'),
  ('flux-2-klein:4MP:7ref', 10, true, 'generate-image'),
  ('flux-2-klein:4MP:8ref', 11, true, 'generate-image'),

  -- ── flux-2-pro (base=$0.015, perOutMP=$0.015, perRefMP=$0.015) ──
  -- 0.5 MP (cost = 0.015 + 0.015*0.5 + 0.015*0.5*ref = 0.0225 + 0.0075*ref)
  ('flux-2-pro:0.5MP:0ref', 2, true, 'generate-image'),
  ('flux-2-pro:0.5MP:1ref', 2, true, 'generate-image'),
  ('flux-2-pro:0.5MP:2ref', 2, true, 'generate-image'),
  ('flux-2-pro:0.5MP:3ref', 3, true, 'generate-image'),
  ('flux-2-pro:0.5MP:4ref', 3, true, 'generate-image'),
  ('flux-2-pro:0.5MP:5ref', 3, true, 'generate-image'),
  ('flux-2-pro:0.5MP:6ref', 4, true, 'generate-image'),
  ('flux-2-pro:0.5MP:7ref', 4, true, 'generate-image'),
  ('flux-2-pro:0.5MP:8ref', 5, true, 'generate-image'),
  -- 1 MP (cost = 0.015 + 0.015 + 0.015*ref = 0.030 + 0.015*ref)
  ('flux-2-pro:1MP:0ref', 2, true, 'generate-image'),
  ('flux-2-pro:1MP:1ref', 3, true, 'generate-image'),
  ('flux-2-pro:1MP:2ref', 3, true, 'generate-image'),
  ('flux-2-pro:1MP:3ref', 4, true, 'generate-image'),
  ('flux-2-pro:1MP:4ref', 5, true, 'generate-image'),
  ('flux-2-pro:1MP:5ref', 6, true, 'generate-image'),
  ('flux-2-pro:1MP:6ref', 6, true, 'generate-image'),
  ('flux-2-pro:1MP:7ref', 7, true, 'generate-image'),
  ('flux-2-pro:1MP:8ref', 8, true, 'generate-image'),
  -- 2 MP (cost = 0.015 + 0.030 + 0.030*ref = 0.045 + 0.030*ref)
  ('flux-2-pro:2MP:0ref', 3, true, 'generate-image'),
  ('flux-2-pro:2MP:1ref', 4, true, 'generate-image'),
  ('flux-2-pro:2MP:2ref', 6, true, 'generate-image'),
  ('flux-2-pro:2MP:3ref', 7, true, 'generate-image'),
  ('flux-2-pro:2MP:4ref', 9, true, 'generate-image'),
  ('flux-2-pro:2MP:5ref', 10, true, 'generate-image'),
  ('flux-2-pro:2MP:6ref', 12, true, 'generate-image'),
  ('flux-2-pro:2MP:7ref', 13, true, 'generate-image'),
  ('flux-2-pro:2MP:8ref', 15, true, 'generate-image'),
  -- 4 MP (cost = 0.015 + 0.060 + 0.060*ref = 0.075 + 0.060*ref)
  ('flux-2-pro:4MP:0ref', 4, true, 'generate-image'),
  ('flux-2-pro:4MP:1ref', 7, true, 'generate-image'),
  ('flux-2-pro:4MP:2ref', 10, true, 'generate-image'),
  ('flux-2-pro:4MP:3ref', 13, true, 'generate-image'),
  ('flux-2-pro:4MP:4ref', 16, true, 'generate-image'),
  ('flux-2-pro:4MP:5ref', 19, true, 'generate-image'),
  ('flux-2-pro:4MP:6ref', 22, true, 'generate-image'),
  ('flux-2-pro:4MP:7ref', 25, true, 'generate-image'),
  ('flux-2-pro:4MP:8ref', 28, true, 'generate-image'),

  -- ── flux-2-max (base=$0, perOutMP=$0.07, perRefMP=$0.03) ──
  -- 0.5 MP (cost = 0.07*0.5 + 0.03*0.5*ref = 0.035 + 0.015*ref)
  ('flux-2-max:0.5MP:0ref', 2, true, 'generate-image'),
  ('flux-2-max:0.5MP:1ref', 3, true, 'generate-image'),
  ('flux-2-max:0.5MP:2ref', 4, true, 'generate-image'),
  ('flux-2-max:0.5MP:3ref', 4, true, 'generate-image'),
  ('flux-2-max:0.5MP:4ref', 5, true, 'generate-image'),
  ('flux-2-max:0.5MP:5ref', 6, true, 'generate-image'),
  ('flux-2-max:0.5MP:6ref', 7, true, 'generate-image'),
  ('flux-2-max:0.5MP:7ref', 7, true, 'generate-image'),
  ('flux-2-max:0.5MP:8ref', 8, true, 'generate-image'),
  -- 1 MP (cost = 0.07 + 0.03*ref)
  ('flux-2-max:1MP:0ref', 4, true, 'generate-image'),
  ('flux-2-max:1MP:1ref', 5, true, 'generate-image'),
  ('flux-2-max:1MP:2ref', 7, true, 'generate-image'),
  ('flux-2-max:1MP:3ref', 8, true, 'generate-image'),
  ('flux-2-max:1MP:4ref', 10, true, 'generate-image'),
  ('flux-2-max:1MP:5ref', 11, true, 'generate-image'),
  ('flux-2-max:1MP:6ref', 13, true, 'generate-image'),
  ('flux-2-max:1MP:7ref', 14, true, 'generate-image'),
  ('flux-2-max:1MP:8ref', 16, true, 'generate-image'),
  -- 2 MP (cost = 0.14 + 0.06*ref)
  ('flux-2-max:2MP:0ref', 7, true, 'generate-image'),
  ('flux-2-max:2MP:1ref', 10, true, 'generate-image'),
  ('flux-2-max:2MP:2ref', 13, true, 'generate-image'),
  ('flux-2-max:2MP:3ref', 16, true, 'generate-image'),
  ('flux-2-max:2MP:4ref', 19, true, 'generate-image'),
  ('flux-2-max:2MP:5ref', 22, true, 'generate-image'),
  ('flux-2-max:2MP:6ref', 25, true, 'generate-image'),
  ('flux-2-max:2MP:7ref', 28, true, 'generate-image'),
  ('flux-2-max:2MP:8ref', 31, true, 'generate-image'),
  -- 4 MP (cost = 0.28 + 0.12*ref)
  ('flux-2-max:4MP:0ref', 14, true, 'generate-image'),
  ('flux-2-max:4MP:1ref', 20, true, 'generate-image'),
  ('flux-2-max:4MP:2ref', 26, true, 'generate-image'),
  ('flux-2-max:4MP:3ref', 32, true, 'generate-image'),
  ('flux-2-max:4MP:4ref', 38, true, 'generate-image'),
  ('flux-2-max:4MP:5ref', 44, true, 'generate-image'),
  ('flux-2-max:4MP:6ref', 50, true, 'generate-image'),
  ('flux-2-max:4MP:7ref', 56, true, 'generate-image'),
  ('flux-2-max:4MP:8ref', 62, true, 'generate-image')

ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
