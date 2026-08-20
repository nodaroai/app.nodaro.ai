-- MiniMax Hailuo 3 (KIE "minimax-h3") 768P pricing — KIE added a resolution
-- lever (768P | 2K, default 2K) to all three endpoints (text/image/reference-
-- to-video) per docs.kie.ai/market/minimax-h3, verified 2026-08-03.
-- KIE rates: 2K = 36.5 KIE cr/s (unchanged — the existing bare duration rows
-- from migration 298 stay the 2K tier), 768P = 22.5 KIE cr/s. Formula (same
-- conversion as Seedance-2 and the 2K rows):
--   Nodaro credits = ceil(22.5 × duration / 4) × 10
-- Reference-video runs bill unit × (input + output) seconds AT THE SELECTED
-- resolution's rate, and input images beyond the first 5 add 11 KIE cr (27.5
-- credits) each — both reserved via the minimax-h3-credits compute hook, NOT
-- via extra composite rows. Reference audio is free. Values MUST match
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- Per-second duration tiers at the 768P rate (2K stays on the bare ids)
  ('minimax-h3:4s:768p',  230, true, 'video'),
  ('minimax-h3:5s:768p',  290, true, 'video'),
  ('minimax-h3:6s:768p',  340, true, 'video'),
  ('minimax-h3:7s:768p',  400, true, 'video'),
  ('minimax-h3:8s:768p',  450, true, 'video'),
  ('minimax-h3:9s:768p',  510, true, 'video'),
  ('minimax-h3:10s:768p', 570, true, 'video'),
  ('minimax-h3:11s:768p', 620, true, 'video'),
  ('minimax-h3:12s:768p', 680, true, 'video'),
  ('minimax-h3:13s:768p', 740, true, 'video'),
  ('minimax-h3:14s:768p', 790, true, 'video'),
  ('minimax-h3:15s:768p', 850, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
