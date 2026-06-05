-- Cinematic Avatar (HeyGen `type:"cinematic_avatar"`) exact-duration holds.
-- 24 composite identifiers: 2 resolutions × 12 durations (4..15s).
--
-- Format: cinematic-avatar:<resolution>:<durationSec>s
-- Durations: 4..15s (user parameter, known at submit — no bucketing).
--
-- Hold formula: [formula removed]  — 1.5× safety factor over base credits
***REDACTED-OSS-SCRUB***
-- The actual charge is computed at job completion from the provider's real
-- USD cost (Math.ceil(durationSec) × rate); commit_credits refunds any surplus.
--
-- Rate sources (UNCONFIRMED ESTIMATES — confirm via a paid run before enabling
-- cinematic-avatar in production; recalibrate via `audit-credits` skill):
--   720p:  $0.15/s — ESTIMATE (generative Seedance pipeline)
--   1080p: $0.22/s — ESTIMATE
--
-- A missing id causes a hard 503 `price_not_configured` at runtime, so ALL
-- 24 ids must be present here AND in STATIC_CREDIT_COSTS (credits.ts).
-- Use ON CONFLICT DO UPDATE to allow recalibration after live cost tests.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── 720p ($0.15/s; ESTIMATE — Seedance generative pipeline) ────────────────
  ('cinematic-avatar:720p:4s',    45,  true, 'ai-video'),   -- $0.60 → ceil(30*1.5)
  ('cinematic-avatar:720p:5s',    57,  true, 'ai-video'),   -- $0.75 → ceil(37.5*1.5)=ceil(56.25)
  ('cinematic-avatar:720p:6s',    68,  true, 'ai-video'),   -- $0.90 → ceil(45*1.5)
  ('cinematic-avatar:720p:7s',    79,  true, 'ai-video'),   -- $1.05 → ceil(52.5*1.5)=ceil(78.75)
  ('cinematic-avatar:720p:8s',    90,  true, 'ai-video'),   -- $1.20 → ceil(60*1.5)
  ('cinematic-avatar:720p:9s',   102,  true, 'ai-video'),   -- $1.35 → ceil(67.5*1.5)=ceil(101.25)
  ('cinematic-avatar:720p:10s',  113,  true, 'ai-video'),   -- $1.50 → ceil(75*1.5)
  ('cinematic-avatar:720p:11s',  124,  true, 'ai-video'),   -- $1.65 → ceil(82.5*1.5)=ceil(123.75)
  ('cinematic-avatar:720p:12s',  135,  true, 'ai-video'),   -- $1.80 → ceil(90*1.5)
  ('cinematic-avatar:720p:13s',  147,  true, 'ai-video'),   -- $1.95 → ceil(97.5*1.5)=ceil(146.25)
  ('cinematic-avatar:720p:14s',  158,  true, 'ai-video'),   -- $2.10 → ceil(105*1.5)
  ('cinematic-avatar:720p:15s',  169,  true, 'ai-video'),   -- $2.25 → ceil(112.5*1.5)=ceil(168.75)
  -- ── 1080p ($0.22/s; ESTIMATE) ──────────────────────────────────────────────
  ('cinematic-avatar:1080p:4s',   66,  true, 'ai-video'),   -- $0.88 → ceil(44*1.5)
  ('cinematic-avatar:1080p:5s',   83,  true, 'ai-video'),   -- $1.10 → ceil(55*1.5)
  ('cinematic-avatar:1080p:6s',   99,  true, 'ai-video'),   -- $1.32 → ceil(66*1.5)
  ('cinematic-avatar:1080p:7s',  116,  true, 'ai-video'),   -- $1.54 → ceil(77*1.5)
  ('cinematic-avatar:1080p:8s',  132,  true, 'ai-video'),   -- $1.76 → ceil(88*1.5)
  ('cinematic-avatar:1080p:9s',  149,  true, 'ai-video'),   -- $1.98 → ceil(99*1.5)
  ('cinematic-avatar:1080p:10s', 165,  true, 'ai-video'),   -- $2.20 → ceil(110*1.5)
  ('cinematic-avatar:1080p:11s', 182,  true, 'ai-video'),   -- $2.42 → ceil(121*1.5)
  ('cinematic-avatar:1080p:12s', 198,  true, 'ai-video'),   -- $2.64 → ceil(132*1.5)
  ('cinematic-avatar:1080p:13s', 215,  true, 'ai-video'),   -- $2.86 → ceil(143*1.5)
  ('cinematic-avatar:1080p:14s', 231,  true, 'ai-video'),   -- $3.08 → ceil(154*1.5)
  ('cinematic-avatar:1080p:15s', 248,  true, 'ai-video')    -- $3.30 → ceil(165*1.5)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
