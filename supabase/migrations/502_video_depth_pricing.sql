-- 502_video_depth_pricing.sql
-- Video Depth node (`video-depth`): two providers, both billed by the probed
-- clip length and bucketed via composite identifiers `<provider>:<bucket>s`
-- (15s/30s/60s/120s/300s — see packages/shared/src/video-depth.ts,
-- videoDepthCreditId):
--
--   video-depth-anything  (fal Video Depth Anything)
--   depth-anything-frames (Replicate Depth Anything, run per frame)
--
-- The bare provider row is the 300s ceiling (reserved when no length is known).
-- The video-depth worker sets no meteredCost, so the reserved bucket is
-- committed verbatim as the charge. `video-depth` is the node-type fallback
-- (= the cheapest fal bucket). Values match STATIC_CREDIT_COSTS (base credits).
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models
-- (these identifiers are new, so there is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('video-depth-anything',        6000, true, 'video'),  -- bare = 300s ceiling
  ('video-depth-anything:15s',     300, true, 'video'),
  ('video-depth-anything:30s',     600, true, 'video'),
  ('video-depth-anything:60s',    1200, true, 'video'),
  ('video-depth-anything:120s',   2400, true, 'video'),
  ('video-depth-anything:300s',   6000, true, 'video'),  -- 5-min ceiling
  ('depth-anything-frames',        600, true, 'video'),  -- bare = 300s ceiling
  ('depth-anything-frames:15s',     30, true, 'video'),
  ('depth-anything-frames:30s',     60, true, 'video'),
  ('depth-anything-frames:60s',    120, true, 'video'),
  ('depth-anything-frames:120s',   240, true, 'video'),
  ('depth-anything-frames:300s',   600, true, 'video'),  -- 5-min ceiling
  ('video-depth',                  300, true, 'video')   -- node-type fallback
ON CONFLICT (model_identifier) DO NOTHING;
