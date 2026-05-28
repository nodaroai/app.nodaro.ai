-- 159_add_mmaudio_pricing.sql
-- Seeds model_pricing for the new video-sfx node (Replicate zsxkib/mmaudio).
-- All values are BASE credits (pre-markup); creditGuard applies cost_markup_percent
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
--
-- Schema convention follows migration 113 (kling-avatar per-second pricing):
--   columns = model_identifier, credit_cost, is_enabled, category
--   (model_pricing uses `credit_cost` not `cost`, `model_identifier` not `id`.
--   `tier_restriction` exists but is omitted here — null = unrestricted.
--   See migration 017 for the table definition.)
-- Category 'video' matches existing video-output rows (minimax, kling, sora2-pro, etc.
-- in migration 059) — mmaudio outputs an mp4 with the generated SFX merged in.
--
-- ON CONFLICT DO NOTHING preserves admin overrides set via /admin/models.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('replicate-mmaudio',       1, true, 'video'),  -- base/legacy default (8s bucket)
  ('replicate-mmaudio:8s',    1, true, 'video'),  -- 8 × 0.0359 = 0.29 → ceil 1
  ('replicate-mmaudio:15s',   1, true, 'video'),  -- 15 × 0.0359 = 0.54 → ceil 1
  ('replicate-mmaudio:30s',   2, true, 'video'),  -- 30 × 0.0359 = 1.08 → ceil 2
  ('replicate-mmaudio:60s',   3, true, 'video'),  -- 60 × 0.0359 = 2.15 → ceil 3
  ('replicate-mmaudio:120s',  5, true, 'video'),  -- 120 × 0.0359 = 4.31 → ceil 5
  ('replicate-mmaudio:300s', 11, true, 'video')   -- 300 × 0.0359 = 10.76 → ceil 11
ON CONFLICT (model_identifier) DO NOTHING;
