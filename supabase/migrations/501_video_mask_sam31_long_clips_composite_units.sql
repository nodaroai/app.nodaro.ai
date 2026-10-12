-- Video Mask: SAM 3.1 (the new default) beside SAM 3, and clips up to 300 s
-- (segmented in 1,800-frame chunks). One row per model and clip length at the
-- 30 fps basis (`videoMaskCreditId` in @nodaro/shared). Mirrors
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts. The bare
-- `video-mask` id is the ceiling row (SAM 3.1, 300 s).
--
-- Mask Composite becomes length-priced: its row is ONE unit = 5 s of the
-- result (`maskCompositeUnits`), so the shipped flat 20 moves to 10 — only
-- where it still holds the shipped value, so an administrator's retune stays.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('sam-3.1-video:5s', 50),
  ('sam-3.1-video:10s', 95),
  ('sam-3.1-video:15s', 145),
  ('sam-3.1-video:30s', 285),
  ('sam-3.1-video:60s', 565),
  ('sam-3.1-video:90s', 850),
  ('sam-3.1-video:120s', 1130),
  ('sam-3.1-video:180s', 1695),
  ('sam-3.1-video:240s', 2260),
  ('sam-3.1-video:300s', 2825),
  ('sam-3-video:90s', 425),
  ('sam-3-video:120s', 565),
  ('sam-3-video:180s', 848),
  ('sam-3-video:240s', 1130),
  ('sam-3-video:300s', 1413)
ON CONFLICT (model_identifier) DO NOTHING;

UPDATE model_pricing SET credit_cost = 2825 WHERE model_identifier = 'video-mask' AND credit_cost = 283;
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'mask-composite' AND credit_cost = 20;
