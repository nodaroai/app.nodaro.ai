-- 247_video_analysis_pricing.sql
-- Video-analysis node (Gemini vision → structured shot-list JSON), billed by the
-- analyzed video's duration. Bucketed via composite identifiers
-- `video-analysis:<model>:<bucket>s` (60s/180s/360s/600s — see
-- packages/shared/src/video-analysis-pricing.ts), driven by the node's
-- client-side duration probe (ffprobe for direct video, yt-dlp metadata for
-- YouTube). The bare `video-analysis:<model>` row is the unknown-duration
-- default (600s ceiling); the node-type bare `video-analysis` is the
-- workflow-estimate fallback only (never reserved).
--
--   gemini-3-flash  economy Gemini vision  ($0.10/M in, $0.40/M out)
--   gemini-3.1-pro  premium Gemini vision  ($3.50/M in, $10.50/M out)
--
-- Credits are NOT per-second: the structural formula `videoAnalysisBucketCredits`
-- prices each bucket from its token footprint (windowed at ~290 tok/s + a
-- per-window system prompt), times a 2× safety factor, at 1 credit = $0.02.
-- The video-analysis worker performs a NON-METERED commit (fixed/bucket-priced),
-- so the reserved bucket is committed VERBATIM as the charge — the same
-- kling-avatar / volcengine-lipsync convention (any providerCostUsd is recorded
-- on the job but discarded from the charge).
--
-- [econ-intel comment removed]
-- formula's output at VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS = 5500 (the measured
-- provisional constant). If a real KIE-billed staging run shifts the numbers,
-- the 18b convergence migration re-anchors these rows.
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models
-- (these identifiers are new, so there is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('video-analysis',                       3, true, 'other'),  -- node-type bare (estimate fallback; = flash 600s)
  ('video-analysis:gemini-3-flash',        3, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-3-flash:60s',    1, true, 'other'),  -- 1-min bucket
  ('video-analysis:gemini-3-flash:180s',   1, true, 'other'),  -- 3-min bucket
  ('video-analysis:gemini-3-flash:360s',   2, true, 'other'),  -- 6-min bucket
  ('video-analysis:gemini-3-flash:600s',   3, true, 'other'),  -- 10-min ceiling
  ('video-analysis:gemini-3.1-pro',       94, true, 'other'),  -- unknown-duration ceiling (600s)
  ('video-analysis:gemini-3.1-pro:60s',   13, true, 'other'),  -- 1-min bucket
  ('video-analysis:gemini-3.1-pro:180s',  25, true, 'other'),  -- 3-min bucket
  ('video-analysis:gemini-3.1-pro:360s',  56, true, 'other'),  -- 6-min bucket
  ('video-analysis:gemini-3.1-pro:600s',  94, true, 'other')   -- 10-min ceiling
ON CONFLICT (model_identifier) DO NOTHING;
