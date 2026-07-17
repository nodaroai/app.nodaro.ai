-- 259_video_analysis_mixed_pricing.sql
-- Video-analysis MIXED tiers — multi-model best-of-N roll plans (3 fast + 2 pro
-- analysis passes + judge + grounded refine). TWO user-facing tiers ship
-- (`mixed` = judge may pick any roll as the winning skeleton; `mixed-fast` =
-- judge picks among the fast rolls only), but they are the IDENTICAL compute
-- plan, so both price under ONE shared credit family: the `mixed` segment
-- (`videoAnalysisCreditSegment` in packages/shared/src/video-analysis-pricing.ts
-- maps the `mixed-fast` sentinel here — a per-variant split would be a phantom
-- distinction and double the admin surface).
--
-- Ladder = fast + pro per bucket (see VIDEO_ANALYSIS_BUCKET_CREDITS):
--   60s 3 · 180s 4 · 360s 9 · 600s 14   (bare id = unknown-duration 600s ceiling)
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('video-analysis:mixed',        14, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:mixed:60s',     3, true, 'other'),  -- 1-min bucket
  ('video-analysis:mixed:180s',    4, true, 'other'),  -- 3-min bucket
  ('video-analysis:mixed:360s',    9, true, 'other'),  -- 6-min bucket
  ('video-analysis:mixed:600s',   14, true, 'other')   -- 10-min ceiling
ON CONFLICT (model_identifier) DO NOTHING;
