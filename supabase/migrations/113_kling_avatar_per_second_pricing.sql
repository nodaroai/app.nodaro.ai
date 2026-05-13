-- 113_kling_avatar_per_second_pricing.sql
-- Kling AI Avatar 2.0 upgrade (KIE announcement 2026-05-11): max input audio
-- raised from 15s to 5min, billed per-second.
--   Standard (720p): 8 KIE cr/sec → 2 Nodaro cr/sec
--   Pro      (1080p): 16 KIE cr/sec → 4 Nodaro cr/sec
--
-- Credit reservation now uses composite identifiers `<provider>:<bucket>s`
-- bucketed at 15s / 30s / 60s / 120s / 300s (see packages/shared/src/lip-sync-pricing.ts).
-- Bare `kling-avatar` / `kling-avatar-pro` rows from migration 065 remain as
-- the back-compat default when no audioDurationSec is supplied.
--
-- ON CONFLICT DO NOTHING preserves admin overrides set via /admin/models.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('kling-avatar:15s',       30, true, 'lip-sync'),
  ('kling-avatar:30s',       60, true, 'lip-sync'),
  ('kling-avatar:60s',      120, true, 'lip-sync'),
  ('kling-avatar:120s',     240, true, 'lip-sync'),
  ('kling-avatar:300s',     600, true, 'lip-sync'),
  ('kling-avatar-pro:15s',   60, true, 'lip-sync'),
  ('kling-avatar-pro:30s',  120, true, 'lip-sync'),
  ('kling-avatar-pro:60s',  240, true, 'lip-sync'),
  ('kling-avatar-pro:120s', 480, true, 'lip-sync'),
  ('kling-avatar-pro:300s',1200, true, 'lip-sync')
ON CONFLICT (model_identifier) DO NOTHING;
