-- The files a run fetched from a Video URL node's post link, kept on its
-- execution (decided 2026-10-08).
--
-- A post link saved in the workflow (or set by a request) is not a video file,
-- so the orchestrator downloads it before the first node runs. That file is
-- used for the run and was kept nowhere: a Render final continuation of the
-- run, or a re-pick of the same execution after a deploy, fetched the link
-- again, and a transient failure there refused the final render after the
-- preview was charged. The orchestrator now records what it fetched here, and
-- a continuation (`continueFromExecutionId`) or a re-pick reuses it. A repeated
-- run is a NEW execution and still fetches fresh.
--
-- Shape: `{ nodeId: { link, data } }`: `link` is the post link the files were
-- fetched for (an entry is reused only for a node that still holds that link),
-- `data` the node fields the fetch wrote (the file, its thumbnail, the part,
-- the audio track). NOT part of the input overrides on purpose: the run lock
-- (`findLockedOverrides`) refuses a downloaded-file field on a Video URL node a
-- request did not name, so the files cannot ride the pin. The map is written
-- and read only by the backend with the service role.
--
-- NULL = nothing fetched for this execution (every execution made before this
-- migration, and every run that fetched nothing). NULLABLE, NO DEFAULT, NO
-- BACKFILL. Additive; RLS unchanged (the table is server-write-only, 474).
--
-- Staging runs dev against this shared database before the promotion applies
-- this migration: the backend reads and writes the column only through a
-- missing-column guard (backend/src/lib/execution-video-link-files.ts).
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS video_link_files jsonb;

-- The orchestrator reads it as a node-keyed map; anything else is not a record.
-- NOT VALID: every existing row is NULL, so nothing to scan for.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.workflow_executions'::regclass
       AND conname = 'workflow_executions_video_link_files_object'
  ) THEN
    ALTER TABLE public.workflow_executions
      ADD CONSTRAINT workflow_executions_video_link_files_object
      CHECK (video_link_files IS NULL OR jsonb_typeof(video_link_files) = 'object') NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.workflow_executions.video_link_files IS
  'Files the run fetched from Video URL post links ({ nodeId: { link, data } }); a continuation or a re-pick of the execution reuses them instead of fetching again. NULL = none fetched.';
