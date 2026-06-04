-- AI Avatar (HeyGen) duration-bucketed reserve holds.
-- 42 composite identifiers: 2 engines × 3 resolutions × 7 duration buckets.
--
-- Format: heygen-<engine>:<resolution>:<bucketSec>s
-- Buckets: 30s / 60s / 120s / 240s / 360s / 600s / 900s
--   (900s covers the 5000-char@voiceSpeed=0.5 worst case: ceil(5000/12/0.5)=834s)
--
-- Hold formula: [formula removed]  — 1.5× safety factor over base credits
***REDACTED-OSS-SCRUB***
-- The actual charge is computed at job completion from the provider's real
-- USD cost (durationSec × rate); commit_credits refunds any surplus.
--
-- Rate sources:
--   avatar-iv 720p: $0.06/s — ANCHORED (live test, 3.06s = 9 credits)
--   avatar-iv 1080p: $0.08/s — rounded from ~$4/min HeyGen public info
--   avatar-iv 4k: $0.16/s — ESTIMATE (~2× 1080p, not yet live-tested)
--   avatar-v (all): UNPINNED ESTIMATES — must be confirmed before avatar-v ships
--
-- A missing id causes a hard 503 `price_not_configured` at runtime, so ALL
-- 42 ids must be present here AND in STATIC_CREDIT_COSTS (credits.ts).
-- Use ON CONFLICT DO UPDATE to allow recalibration after live Avatar-V tests.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── avatar-iv · 720p ($0.06/s; anchored) ──────────────────────────────────
  ('heygen-avatar-iv:720p:30s',    135,  true, 'ai-video'),   -- $1.80 → ceil(90*1.5)
  ('heygen-avatar-iv:720p:60s',    270,  true, 'ai-video'),   -- $3.60 → ceil(180*1.5)
  ('heygen-avatar-iv:720p:120s',   540,  true, 'ai-video'),   -- $7.20 → ceil(360*1.5)
  ('heygen-avatar-iv:720p:240s',  1080,  true, 'ai-video'),   -- $14.40 → ceil(720*1.5)
  ('heygen-avatar-iv:720p:360s',  1620,  true, 'ai-video'),   -- $21.60 → ceil(1080*1.5)
  ('heygen-avatar-iv:720p:600s',  2700,  true, 'ai-video'),   -- $36.00 → ceil(1800*1.5)
  ('heygen-avatar-iv:720p:900s',  4050,  true, 'ai-video'),   -- $54.00 → ceil(2700*1.5)
  -- ── avatar-iv · 1080p ($0.08/s; rounded from ~$4/min) ────────────────────
  ('heygen-avatar-iv:1080p:30s',   180,  true, 'ai-video'),   -- $2.40 → ceil(120*1.5)
  ('heygen-avatar-iv:1080p:60s',   360,  true, 'ai-video'),   -- $4.80 → ceil(240*1.5)
  ('heygen-avatar-iv:1080p:120s',  720,  true, 'ai-video'),   -- $9.60 → ceil(480*1.5)
  ('heygen-avatar-iv:1080p:240s', 1440,  true, 'ai-video'),   -- $19.20 → ceil(960*1.5)
  ('heygen-avatar-iv:1080p:360s', 2160,  true, 'ai-video'),   -- $28.80 → ceil(1440*1.5)
  ('heygen-avatar-iv:1080p:600s', 3600,  true, 'ai-video'),   -- $48.00 → ceil(2400*1.5)
  ('heygen-avatar-iv:1080p:900s', 5400,  true, 'ai-video'),   -- $72.00 → ceil(3600*1.5)
  -- ── avatar-iv · 4k ($0.16/s; ESTIMATE ~2× 1080p) ─────────────────────────
  ('heygen-avatar-iv:4k:30s',     360,  true, 'ai-video'),    -- $4.80 → ceil(240*1.5)
  ('heygen-avatar-iv:4k:60s',     720,  true, 'ai-video'),    -- $9.60 → ceil(480*1.5)
  ('heygen-avatar-iv:4k:120s',   1440,  true, 'ai-video'),    -- $19.20 → ceil(960*1.5)
  ('heygen-avatar-iv:4k:240s',   2880,  true, 'ai-video'),    -- $38.40 → ceil(1920*1.5)
  ('heygen-avatar-iv:4k:360s',   4320,  true, 'ai-video'),    -- $57.60 → ceil(2880*1.5)
  ('heygen-avatar-iv:4k:600s',   7200,  true, 'ai-video'),    -- $96.00 → ceil(4800*1.5)
  ('heygen-avatar-iv:4k:900s',  10800,  true, 'ai-video'),    -- $144.00 → ceil(7200*1.5)
  -- ── avatar-v · 720p ($0.08/s; UNPINNED ESTIMATE) ─────────────────────────
  ('heygen-avatar-v:720p:30s',    180,  true, 'ai-video'),    -- $2.40 → ceil(120*1.5)
  ('heygen-avatar-v:720p:60s',    360,  true, 'ai-video'),    -- $4.80 → ceil(240*1.5)
  ('heygen-avatar-v:720p:120s',   720,  true, 'ai-video'),    -- $9.60 → ceil(480*1.5)
  ('heygen-avatar-v:720p:240s',  1440,  true, 'ai-video'),    -- $19.20 → ceil(960*1.5)
  ('heygen-avatar-v:720p:360s',  2160,  true, 'ai-video'),    -- $28.80 → ceil(1440*1.5)
  ('heygen-avatar-v:720p:600s',  3600,  true, 'ai-video'),    -- $48.00 → ceil(2400*1.5)
  ('heygen-avatar-v:720p:900s',  5400,  true, 'ai-video'),    -- $72.00 → ceil(3600*1.5)
  -- ── avatar-v · 1080p ($0.10/s; UNPINNED ESTIMATE) ────────────────────────
  ('heygen-avatar-v:1080p:30s',   225,  true, 'ai-video'),    -- $3.00 → ceil(150*1.5)
  ('heygen-avatar-v:1080p:60s',   450,  true, 'ai-video'),    -- $6.00 → ceil(300*1.5)
  ('heygen-avatar-v:1080p:120s',  900,  true, 'ai-video'),    -- $12.00 → ceil(600*1.5)
  ('heygen-avatar-v:1080p:240s', 1800,  true, 'ai-video'),    -- $24.00 → ceil(1200*1.5)
  ('heygen-avatar-v:1080p:360s', 2700,  true, 'ai-video'),    -- $36.00 → ceil(1800*1.5)
  ('heygen-avatar-v:1080p:600s', 4500,  true, 'ai-video'),    -- $60.00 → ceil(3000*1.5)
  ('heygen-avatar-v:1080p:900s', 6750,  true, 'ai-video'),    -- $90.00 → ceil(4500*1.5)
  -- ── avatar-v · 4k ($0.20/s; UNPINNED ESTIMATE) ───────────────────────────
  ('heygen-avatar-v:4k:30s',     450,  true, 'ai-video'),     -- $6.00 → ceil(300*1.5)
  ('heygen-avatar-v:4k:60s',     900,  true, 'ai-video'),     -- $12.00 → ceil(600*1.5)
  ('heygen-avatar-v:4k:120s',   1800,  true, 'ai-video'),     -- $24.00 → ceil(1200*1.5)
  ('heygen-avatar-v:4k:240s',   3600,  true, 'ai-video'),     -- $48.00 → ceil(2400*1.5)
  ('heygen-avatar-v:4k:360s',   5400,  true, 'ai-video'),     -- $72.00 → ceil(3600*1.5)
  ('heygen-avatar-v:4k:600s',   9000,  true, 'ai-video'),     -- $120.00 → ceil(6000*1.5)
  ('heygen-avatar-v:4k:900s',  13500,  true, 'ai-video')      -- $180.00 → ceil(9000*1.5)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
