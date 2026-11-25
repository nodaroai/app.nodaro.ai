-- 711: how many bytes of video-editor project files one person holds.
--
--   editor_project_storage_bytes(p_user)
--       The sum of size_bytes of p_user's live projects' current files
--       (editor_projects.size_bytes; null until first saved, counted as 0)
--       plus the size_bytes of every version of those projects. A deleted
--       project counts for nothing (its files are deleted with it), and only
--       p_user's own projects count.
--
-- The API calls it before a save or a version cut writes a file, to hold each
-- person under a ceiling of stored project bytes. It reads through the
-- existing indexes: the person's live projects through
-- idx_editor_projects_user_updated (partial, deleted_at IS NULL), and each
-- project's versions through the UNIQUE (project_id, number) index. No new
-- index is needed.
--
-- Service-role only, like the other editor-project functions; SECURITY
-- DEFINER with the search_path pinned. supabase/tests/
-- editor-project-storage-bytes.behavior.sql proves what it counts and who may
-- call it.
--
-- Re-runnable: CREATE OR REPLACE, and the REVOKE/GRANT statements are
-- idempotent. It touches no table.

CREATE OR REPLACE FUNCTION public.editor_project_storage_bytes(p_user UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((
      SELECT SUM(ep.size_bytes)::BIGINT
      FROM public.editor_projects ep
      WHERE ep.user_id = p_user AND ep.deleted_at IS NULL
    ), 0)
    + COALESCE((
      SELECT SUM(v.size_bytes)::BIGINT
      FROM public.editor_project_versions v
      JOIN public.editor_projects ep ON ep.id = v.project_id
      WHERE ep.user_id = p_user AND ep.deleted_at IS NULL
    ), 0)
$$;

COMMENT ON FUNCTION public.editor_project_storage_bytes(UUID) IS
  'Bytes of video-editor project files a person holds: their live projects'' current files plus every version of those projects. Service role only.';

REVOKE ALL ON FUNCTION public.editor_project_storage_bytes(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_project_storage_bytes(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.editor_project_storage_bytes(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.editor_project_storage_bytes(UUID) TO service_role;
