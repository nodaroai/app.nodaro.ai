-- Backfill companion to 347's is_public flip.
--
-- 347 set jobs.is_public DEFAULT false and backfilled the CONFIRMED leak
-- (is_public + completed + job_type IS NULL -- the in-route LLM/helper
-- completions, which are the primary cross-user exposure). It deliberately left
-- the NAMED non-media job_types for a prod-confirmed follow-up. This is that
-- follow-up, done conservatively.
--
-- These three are "action" jobs whose output_data is a DELIVERY RESULT -- a
-- webhook response body, a social/telegram publish outcome -- never a shareable
-- media asset:
--   * webhook-output       (services/workflow-engine/inline-executor.ts:919)
--   * social-publish        (workers/social-publish-worker.ts:63,
--                            routes/social-publish.ts:112 -- which already sets
--                            is_public:false today; this flips rows born public
--                            BEFORE that fix / before 347's default change)
--   * telegram-channel-feed (routes/telegram-channel.ts:65 -- inserts via
--                            insertJob with no is_public, so pre-347 rows
--                            defaulted TRUE)
--
-- Why these are safe to flip and complete:
--   * They never appear in any gallery -- every gallery surface filters
--     .in("job_type", IMAGE_JOBS u VIDEO_JOBS u AUDIO_JOBS) (routes/gallery.ts,
--     mcp/tools/gallery.ts, mcp/tools/jobs.ts) and none of these is a member.
--   * They have no share-by-id media use: their output_data is metadata, not a
--     media URL a share link or MCP hydrate would serve.
--   * The statement is a NO-OP for any of these types with zero public+completed
--     rows, so it cannot hide anything that isn't already the leak it targets.
--
-- Deliberately EXCLUDED:
--   * pipeline-final-merge -- its output IS a merged video (a shareable pipeline
--     deliverable), so flipping it could hide real user media.
--   * every media and media-processing type (video-upscale, combine-videos,
--     merge-video-audio, trim/resize/loop/fade-video, suno-music-video,
--     mix/trim-audio, etc. -- the "Excluded: ... (processing)" sets noted in
--     routes/gallery.ts are still user-facing media reachable by id).
--   * character-lora-training -- not a jobs row (webhook + characters.lora_*
--     CAS-slot driven, per providers/replicate/CLAUDE.md).
--
-- A broader sweep of non-media helper/LLM node types is possible but stays
-- deferred: it needs a prod job_type census to target precisely without risking
-- a media type, and its primary case (NULL job_type) is already closed by 347.
--
-- Point-in-time only. The forward invariant is 347's DEFAULT false; there is no
-- new behavior proof because a one-time backfill is not an invariant (347's
-- jobs-cost-privacy.behavior.sql already pins the DEFAULT).

UPDATE public.jobs
   SET is_public = false
 WHERE is_public = true
   AND status = 'completed'
   AND job_type IN ('webhook-output', 'social-publish', 'telegram-channel-feed');
