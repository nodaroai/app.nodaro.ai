-- Cinematic Avatar (HeyGen `type:"cinematic_avatar"`) exact-duration holds.
-- 24 composite identifiers: 2 resolutions × 12 durations (4..15s).
--
-- Format: cinematic-avatar:<resolution>:<durationSec>s
-- Durations: 4..15s (user parameter, known at submit — no bucketing).
--
-- Hold formula applies a 1.5× safety factor over the base credit value so the
-- hold is always ≥ the actual metered charge after runtime markup.
-- The actual charge is computed at job completion from the provider's real
-- cost (Math.ceil(durationSec) × rate); commit_credits refunds any surplus.
--
-- Rate confidence (UNCONFIRMED ESTIMATES — confirm via a paid run before enabling
-- cinematic-avatar in production; recalibrate via `audit-credits` skill):
--   720p:  ESTIMATE (generative Seedance pipeline)
--   1080p: ESTIMATE
--
-- A missing id causes a hard 503 `price_not_configured` at runtime, so ALL
-- 24 ids must be present here AND in STATIC_CREDIT_COSTS (credits.ts).
-- Use ON CONFLICT DO UPDATE to allow recalibration after live cost tests.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- ── 720p ────────────────
  ('cinematic-avatar:720p:4s',    45,  true, 'ai-video'),
  ('cinematic-avatar:720p:5s',    57,  true, 'ai-video'),
  ('cinematic-avatar:720p:6s',    68,  true, 'ai-video'),
  ('cinematic-avatar:720p:7s',    79,  true, 'ai-video'),
  ('cinematic-avatar:720p:8s',    90,  true, 'ai-video'),
  ('cinematic-avatar:720p:9s',   102,  true, 'ai-video'),
  ('cinematic-avatar:720p:10s',  113,  true, 'ai-video'),
  ('cinematic-avatar:720p:11s',  124,  true, 'ai-video'),
  ('cinematic-avatar:720p:12s',  135,  true, 'ai-video'),
  ('cinematic-avatar:720p:13s',  147,  true, 'ai-video'),
  ('cinematic-avatar:720p:14s',  158,  true, 'ai-video'),
  ('cinematic-avatar:720p:15s',  169,  true, 'ai-video'),
  -- ── 1080p ──────────────────────────────────────────────
  ('cinematic-avatar:1080p:4s',   66,  true, 'ai-video'),
  ('cinematic-avatar:1080p:5s',   83,  true, 'ai-video'),
  ('cinematic-avatar:1080p:6s',   99,  true, 'ai-video'),
  ('cinematic-avatar:1080p:7s',  116,  true, 'ai-video'),
  ('cinematic-avatar:1080p:8s',  132,  true, 'ai-video'),
  ('cinematic-avatar:1080p:9s',  149,  true, 'ai-video'),
  ('cinematic-avatar:1080p:10s', 165,  true, 'ai-video'),
  ('cinematic-avatar:1080p:11s', 182,  true, 'ai-video'),
  ('cinematic-avatar:1080p:12s', 198,  true, 'ai-video'),
  ('cinematic-avatar:1080p:13s', 215,  true, 'ai-video'),
  ('cinematic-avatar:1080p:14s', 231,  true, 'ai-video'),
  ('cinematic-avatar:1080p:15s', 248,  true, 'ai-video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
