-- jobs: stop shipping Nodaro's USD economics to the browser, and stop
-- non-media job rows being born public. Two leaks, one table.
--
-- ============================================================================
-- (1) COLUMN VISIBILITY
-- ============================================================================
-- jobs.provider_cost / jobs.display_cost (005_add_app_settings.sql:35-36) are
-- Nodaro's own economics. The jobs SELECT policy (032_consolidate_rls_and_
-- indexes.sql:103-108) is ROW-level only, Supabase grants anon/authenticated
-- table-level SELECT by default, and no migration ever revoked it -- so any
-- signed-in user could read their own rows' provider_cost straight over
-- PostgREST with the browser anon client (frontend/src/lib/supabase.ts:11-16),
-- and via the `is_public = true AND status = 'completed'` disjunct, other
-- people's rows too.
--
-- A COLUMN-LEVEL REVOKE ALONE DOES NOTHING while a table-level grant exists.
-- Verified empirically twice: on PG15 (see 270_gtm_attribution.sql:66-76) and
-- again on PG17 for this change -- after `REVOKE SELECT (provider_cost) ...`,
-- has_column_privilege still returned true and the SELECT still worked.
-- Postgres checks the table ACL first. The only form that works is a
-- table-level REVOKE followed by an explicit column-list GRANT. And PostgREST
-- does NOT silently drop unreadable columns from a `select=*` -- it answers 401
-- 42501 for the whole request (verified against supabase/postgrest:v14.3), so
-- there is no graceful-degradation path; the one browser reader that named the
-- cost columns (the admin Jobs page) MOVES to GET /v1/admin/jobs (service-role
-- + requireAdmin) in this same PR.
--
-- THE COLUMN LIST BELOW IS A MINIMUM, NOT "EVERYTHING EXCEPT THE TWO".
-- Granting every current column would make each future `ALTER TABLE jobs ADD
-- COLUMN` a silent re-leak -- jobs already grew ~28 columns after the initial
-- schema. Granting only what the browser needs inverts the drift direction: a
-- new column is private until somebody deliberately grants it, so forgetting
-- breaks loudly (a 401 in the one Realtime hook) instead of leaking quietly.
--
-- What the browser still needs, and why each column is here:
--   id, user_id, status, output_data -- the Realtime UPDATE payload the
--   location/object studios consume (JobRealtimeRow, frontend/src/components/
--   editor/location-studio/use-jobs-realtime-sync.ts:77-82). The channel filters
--   `user_id=eq.<uid>` and the handler reads `.id`/`.status`/`.output_data`.
--   realtime.apply_rls stamps each column is_selectable via has_column_privilege
--   and silently OMITS the unreadable ones -- but it returns 'Error 401:
--   Unauthorized' when a PRIMARY KEY column is unreadable, so `id` is mandatory,
--   not decorative.
--
-- anon gets NOTHING: the public gallery is served by service-role backend
-- routes (routes/gallery.ts), never a browser-direct read of `jobs`.
--
-- RLS policy EXPRESSIONS are unaffected by column privileges (verified: a policy
-- reading a column the role cannot select still filters correctly), so 032's
-- policy keeps working even though is_public and status-in-the-policy are
-- evaluated on columns the role no longer fully owns.
--
-- INSERT/UPDATE/DELETE grants on jobs are deliberately left alone: the browser
-- never writes jobs, but narrowing writes is a separate change with its own
-- blast radius and does not belong in a leak fix.

REVOKE SELECT ON TABLE public.jobs FROM anon;
REVOKE SELECT ON TABLE public.jobs FROM authenticated;

GRANT SELECT (id, user_id, status, output_data) ON TABLE public.jobs TO authenticated;

-- ============================================================================
-- (2) BIRTH VISIBILITY
-- ============================================================================
-- is_public defaults TRUE (011_gallery_and_private_mode.sql:5) so completed
-- media feeds the public gallery. Non-media rows inherit it:
-- backend/src/routes/prompt-helper.ts:149 inserts via insertJob (no is_public,
-- no job_type), then :267 writes status 'completed' + provider_cost -- which
-- satisfies 032's public disjunct, making every prompt-wizard row readable by
-- EVERY user. ~13 other in-route-completed LLM/helper routes share the shape.
--
-- Fixed at the column DEFAULT rather than at the ~130 insert sites, because:
--   * the two media workers OVERWRITE is_public anyway -- video-worker.ts:208
--     writes is_public at pickup and render-worker.ts:951 at completion -- so
--     the gallery's own filter column and its visibility flag are stamped
--     together, after insert;
--   * nothing is publicly readable before status='completed' (both the gallery
--     route at routes/gallery.ts and the RLS disjunct require it), so the
--     pending window is not exposed either way;
--   * one DDL line covers BOTH insert families -- lib/insert-job.ts and the five
--     direct `insertWithIdempotencyKey("jobs", ...)` sites the existing
--     no-direct-job-insert guard does not match -- plus every future one.
-- It is the same "put it in the database" choice migration 337's
-- clamp_workspace_job_privacy trigger already made, and composes with it.

ALTER TABLE public.jobs ALTER COLUMN is_public SET DEFAULT false;

-- ---------------------------------------------------------------- backfill
-- Point-in-time only. The forward invariant is the DEFAULT above; this flips
-- rows that are already completed+public and can never be gallery media.
--
-- job_type IS NULL is the CONFIRMED leak. Every gallery surface filters
-- `.in("job_type", [...])` -- routes/gallery.ts:139, mcp/tools/gallery.ts,
-- mcp/tools/jobs.ts -- so a NULL job_type row is provably invisible to all of
-- them, and can only be an in-route completion (prompt-helper, ai-writer,
-- llm-chat, the 3d-title/after-effects/lottie helpers, qa-check, image-critic,
-- ...). Flipping these hides nothing that was ever gallery-visible.
UPDATE public.jobs
   SET is_public = false
 WHERE is_public = true
   AND job_type IS NULL;

-- NOT DONE HERE: flipping named non-media job types that DO stamp job_type but
-- complete in-route (webhook-output, telegram-channel, pipeline-final-merge,
-- character-training, ...). Public media legitimately exists OUTSIDE the gallery
-- allowlist (render-worker rows; mcp/tools/gallery.ts hydrates any public+
-- completed row by id), so a blanket "not in the media list" inversion would
-- hide real user content. Confirm the real set against PRODUCTION first, then
-- flip it in a follow-up:
--   SELECT job_type, count(*) FROM jobs
--    WHERE is_public AND status = 'completed' AND job_type IS NOT NULL
--      AND job_type NOT IN (  -- IMAGE_JOBS u VIDEO_JOBS u AUDIO_JOBS, routes/gallery.ts:9-30
--        'generate-image','edit-image','image-to-image',
--        'generate-character','generate-character-asset',
--        'generate-object','generate-object-asset',
--        'generate-location','generate-location-asset',
--        'image-to-video','text-to-video','video-to-video','lip-sync','motion-transfer',
--        'text-to-speech','generate-music','text-to-audio',
--        'suno-generate','suno-cover','suno-extend',
--        'text-to-dialogue','voice-changer','dubbing','voice-remix','voice-design')
--    GROUP BY 1 ORDER BY 2 DESC;
