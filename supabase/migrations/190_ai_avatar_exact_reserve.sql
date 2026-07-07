-- AI Avatar + Cinematic Avatar: exact-duration reserve recalibration.
--
-- Fixes a user-reported over-reservation: an AUDIO-mode ai-avatar held ~4020
-- credits for a clip that actually cost ≈40 credits. Three compounding
-- causes, all in the RESERVE (the metered commit was already refund-only):
--   1. Audio mode reserved the 900s TOP bucket (audio length unknown at reserve).
--   2. The stored hold baked a *1.5 safety factor ON TOP of the admin
--      markup that getModelCreditCostFromDB re-applies at reserve time
--      (redundant double-buffer).
--   3. Coarse low-end buckets (old min 30s) over-reserved short clips.
--
-- This migration:
--   • Re-seeds every ai-avatar id with the MINIMAL at-cost hold value
--     (NO *1.5 safety factor). The runtime markup + bucket-up still guarantee
--     reserved >= metered-actual (equal at each bucket ceiling, where both
--     derive from the same at-cost base).
--   • Adds the 18 NEW fine-grained low-end buckets (5s/10s/15s) per engine×res,
--     bringing ai-avatar from 42 → 60 ids (2 engines × 3 res × 10 buckets:
--     5/10/15/30/60/120/240/360/600/900s). Audio mode now buckets by the
--     ffprobe-probed clip length; un-probed audio falls back to a MODEST 120s
--     (not 900s).
--   • Re-seeds the 24 cinematic-avatar ids with the same minimal-safe formula.
--
-- A missing id causes a hard 503 `price_not_configured` at runtime, so ALL ids
-- must be present here AND in STATIC_CREDIT_COSTS (credits.ts).
-- ON CONFLICT DO UPDATE both inserts new low-end rows AND lowers the existing
-- coarse rows from the redundant *1.5 value to the at-cost value.

-- ════════════════════════════════════════════════════════════════════════════
-- AI Avatar — 60 ids (rate × bucket duration, at-cost)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── avatar-iv · 720p ──────────────────────────────────
  ('heygen-avatar-iv:720p:5s',     15,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:10s',    30,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:15s',    45,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:30s',    90,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:60s',   180,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:120s',  360,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:240s',  720,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:360s', 1080,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:600s', 1800,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:900s', 2700,  true, 'ai-video'),
  -- ── avatar-iv · 1080p ────────────────────
  ('heygen-avatar-iv:1080p:5s',    20,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:10s',   40,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:15s',   60,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:30s',  120,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:60s',  240,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:120s', 480,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:240s', 960,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:360s',1440,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:600s',2400,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:900s',3600,  true, 'ai-video'),
  -- ── avatar-iv · 4k ─────────────────────────
  ('heygen-avatar-iv:4k:5s',       40,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:10s',      80,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:15s',     120,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:30s',     240,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:60s',     480,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:120s',    960,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:240s',   1920,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:360s',   2880,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:600s',   4800,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:900s',   7200,  true, 'ai-video'),
  -- ── avatar-v · 720p ─────────────────────────
  ('heygen-avatar-v:720p:5s',      20,  true, 'ai-video'),
  ('heygen-avatar-v:720p:10s',     40,  true, 'ai-video'),
  ('heygen-avatar-v:720p:15s',     60,  true, 'ai-video'),
  ('heygen-avatar-v:720p:30s',    120,  true, 'ai-video'),
  ('heygen-avatar-v:720p:60s',    240,  true, 'ai-video'),
  ('heygen-avatar-v:720p:120s',   480,  true, 'ai-video'),
  ('heygen-avatar-v:720p:240s',   960,  true, 'ai-video'),
  ('heygen-avatar-v:720p:360s',  1440,  true, 'ai-video'),
  ('heygen-avatar-v:720p:600s',  2400,  true, 'ai-video'),
  ('heygen-avatar-v:720p:900s',  3600,  true, 'ai-video'),
  -- ── avatar-v · 1080p ────────────────────────
  ('heygen-avatar-v:1080p:5s',     25,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:10s',    50,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:15s',    75,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:30s',   150,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:60s',   300,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:120s',  600,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:240s', 1200,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:360s', 1800,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:600s', 3000,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:900s', 4500,  true, 'ai-video'),
  -- ── avatar-v · 4k ───────────────────────────
  ('heygen-avatar-v:4k:5s',        50,  true, 'ai-video'),
  ('heygen-avatar-v:4k:10s',      100,  true, 'ai-video'),
  ('heygen-avatar-v:4k:15s',      150,  true, 'ai-video'),
  ('heygen-avatar-v:4k:30s',      300,  true, 'ai-video'),
  ('heygen-avatar-v:4k:60s',      600,  true, 'ai-video'),
  ('heygen-avatar-v:4k:120s',    1200,  true, 'ai-video'),
  ('heygen-avatar-v:4k:240s',    2400,  true, 'ai-video'),
  ('heygen-avatar-v:4k:360s',    3600,  true, 'ai-video'),
  ('heygen-avatar-v:4k:600s',    6000,  true, 'ai-video'),
  ('heygen-avatar-v:4k:900s',    9000,  true, 'ai-video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ════════════════════════════════════════════════════════════════════════════
-- Cinematic Avatar — 24 ids (rate × exact duration, at-cost)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── 720p ────────────────
  ('cinematic-avatar:720p:4s',    30,  true, 'ai-video'),
  ('cinematic-avatar:720p:5s',    38,  true, 'ai-video'),
  ('cinematic-avatar:720p:6s',    45,  true, 'ai-video'),
  ('cinematic-avatar:720p:7s',    53,  true, 'ai-video'),
  ('cinematic-avatar:720p:8s',    60,  true, 'ai-video'),
  ('cinematic-avatar:720p:9s',    68,  true, 'ai-video'),
  ('cinematic-avatar:720p:10s',   75,  true, 'ai-video'),
  ('cinematic-avatar:720p:11s',   83,  true, 'ai-video'),
  ('cinematic-avatar:720p:12s',   90,  true, 'ai-video'),
  ('cinematic-avatar:720p:13s',   98,  true, 'ai-video'),
  ('cinematic-avatar:720p:14s',  105,  true, 'ai-video'),
  ('cinematic-avatar:720p:15s',  113,  true, 'ai-video'),
  -- ── 1080p ──────────────────────────────────────────────
  ('cinematic-avatar:1080p:4s',   44,  true, 'ai-video'),
  ('cinematic-avatar:1080p:5s',   55,  true, 'ai-video'),
  ('cinematic-avatar:1080p:6s',   66,  true, 'ai-video'),
  ('cinematic-avatar:1080p:7s',   77,  true, 'ai-video'),
  ('cinematic-avatar:1080p:8s',   88,  true, 'ai-video'),
  ('cinematic-avatar:1080p:9s',   99,  true, 'ai-video'),
  ('cinematic-avatar:1080p:10s', 110,  true, 'ai-video'),
  ('cinematic-avatar:1080p:11s', 121,  true, 'ai-video'),
  ('cinematic-avatar:1080p:12s', 132,  true, 'ai-video'),
  ('cinematic-avatar:1080p:13s', 143,  true, 'ai-video'),
  ('cinematic-avatar:1080p:14s', 154,  true, 'ai-video'),
  ('cinematic-avatar:1080p:15s', 165,  true, 'ai-video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
