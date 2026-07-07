-- AI Avatar (HeyGen) duration-bucketed reserve holds.
-- 42 composite identifiers: 2 engines × 3 resolutions × 7 duration buckets.
--
-- Format: heygen-<engine>:<resolution>:<bucketSec>s
-- Buckets: 30s / 60s / 120s / 240s / 360s / 600s / 900s
--   (900s covers the 5000-char@voiceSpeed=0.5 worst case: ceil(5000/12/0.5)=834s)
--
-- Hold formula applies a 1.5× safety factor over the base credit value so the
-- hold is always ≥ the actual metered charge after runtime markup.
-- The actual charge is computed at job completion from the provider's real
-- cost (durationSec × rate); commit_credits refunds any surplus.
--
-- Rate confidence:
--   avatar-iv 720p — ANCHORED (confirmed via a live test run)
--   avatar-iv 1080p — rounded from published HeyGen per-minute pricing
--   avatar-iv 4k — ESTIMATE (not yet live-tested)
--   avatar-v (all): UNPINNED ESTIMATES — must be confirmed before avatar-v ships
--
-- A missing id causes a hard 503 `price_not_configured` at runtime, so ALL
-- 42 ids must be present here AND in STATIC_CREDIT_COSTS (credits.ts).
-- Use ON CONFLICT DO UPDATE to allow recalibration after live Avatar-V tests.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── avatar-iv · 720p ──────────────────────────────────
  ('heygen-avatar-iv:720p:30s',    135,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:60s',    270,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:120s',   540,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:240s',  1080,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:360s',  1620,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:600s',  2700,  true, 'ai-video'),
  ('heygen-avatar-iv:720p:900s',  4050,  true, 'ai-video'),
  -- ── avatar-iv · 1080p ────────────────────
  ('heygen-avatar-iv:1080p:30s',   180,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:60s',   360,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:120s',  720,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:240s', 1440,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:360s', 2160,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:600s', 3600,  true, 'ai-video'),
  ('heygen-avatar-iv:1080p:900s', 5400,  true, 'ai-video'),
  -- ── avatar-iv · 4k ─────────────────────────
  ('heygen-avatar-iv:4k:30s',     360,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:60s',     720,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:120s',   1440,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:240s',   2880,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:360s',   4320,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:600s',   7200,  true, 'ai-video'),
  ('heygen-avatar-iv:4k:900s',  10800,  true, 'ai-video'),
  -- ── avatar-v · 720p ─────────────────────────
  ('heygen-avatar-v:720p:30s',    180,  true, 'ai-video'),
  ('heygen-avatar-v:720p:60s',    360,  true, 'ai-video'),
  ('heygen-avatar-v:720p:120s',   720,  true, 'ai-video'),
  ('heygen-avatar-v:720p:240s',  1440,  true, 'ai-video'),
  ('heygen-avatar-v:720p:360s',  2160,  true, 'ai-video'),
  ('heygen-avatar-v:720p:600s',  3600,  true, 'ai-video'),
  ('heygen-avatar-v:720p:900s',  5400,  true, 'ai-video'),
  -- ── avatar-v · 1080p ────────────────────────
  ('heygen-avatar-v:1080p:30s',   225,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:60s',   450,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:120s',  900,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:240s', 1800,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:360s', 2700,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:600s', 4500,  true, 'ai-video'),
  ('heygen-avatar-v:1080p:900s', 6750,  true, 'ai-video'),
  -- ── avatar-v · 4k ───────────────────────────
  ('heygen-avatar-v:4k:30s',     450,  true, 'ai-video'),
  ('heygen-avatar-v:4k:60s',     900,  true, 'ai-video'),
  ('heygen-avatar-v:4k:120s',   1800,  true, 'ai-video'),
  ('heygen-avatar-v:4k:240s',   3600,  true, 'ai-video'),
  ('heygen-avatar-v:4k:360s',   5400,  true, 'ai-video'),
  ('heygen-avatar-v:4k:600s',   9000,  true, 'ai-video'),
  ('heygen-avatar-v:4k:900s',  13500,  true, 'ai-video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
