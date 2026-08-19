-- MiniMax Hailuo 3 (KIE "minimax-h3") pricing — serves the generate-video /
-- image-to-video / text-to-video nodes and the reference-audio lip-sync surface.
-- Fixed 2K output (no resolution lever): pricing is per-second only, one seeded
-- tier per allowed duration (4-15s). KIE rate: 36.5 KIE cr/s (docs.kie.ai/market/
-- minimax-h3, verified 2026-08-01). Formula (same conversion as Seedance-2):
--   Nodaro credits = ceil(36.5 × duration / 4) × 10
-- Reference-video runs bill unit × (input + output) seconds and input images
-- beyond the first 5 add 11 KIE cr (27.5 credits) each — both reserved via the
-- minimax-h3-credits compute hook, NOT via extra composite rows. Reference
-- audio is free. Values MUST match STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- Base fallback (6s — the KIE default duration)
  ('minimax-h3',      550, true, 'video'),
  -- Per-second duration tiers (fixed 2K)
  ('minimax-h3:4s',   370, true, 'video'),
  ('minimax-h3:5s',   460, true, 'video'),
  ('minimax-h3:6s',   550, true, 'video'),
  ('minimax-h3:7s',   640, true, 'video'),
  ('minimax-h3:8s',   730, true, 'video'),
  ('minimax-h3:9s',   830, true, 'video'),
  ('minimax-h3:10s',  920, true, 'video'),
  ('minimax-h3:11s', 1010, true, 'video'),
  ('minimax-h3:12s', 1100, true, 'video'),
  ('minimax-h3:13s', 1190, true, 'video'),
  ('minimax-h3:14s', 1280, true, 'video'),
  ('minimax-h3:15s', 1370, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
