-- Video Mask (video-mask) + Mask Composite (mask-composite).
--
-- Video Mask: text-prompted video segmentation (SAM 3 on fal). One row per
-- clip length at the 30 fps basis (`videoMaskCreditId` in @nodaro/shared —
-- a faster clip is priced proportionally longer); the run measures its clip
-- and reserves exactly one row. The bare id is the ceiling row. Mirrors
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
--
-- Mask Composite: local FFmpeg (foreground over background through a mask
-- video), flat 20 credits like Merge Video + Audio. Keyless — community
-- installs run it.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('video-mask', 283),
  ('sam-3-video:5s', 25),
  ('sam-3-video:10s', 48),
  ('sam-3-video:15s', 73),
  ('sam-3-video:30s', 143),
  ('sam-3-video:60s', 283),
  ('mask-composite', 20)
ON CONFLICT (model_identifier) DO NOTHING;
