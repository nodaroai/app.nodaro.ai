-- 703: video-editor projects saved to a person's account.
--
-- Two tables and the three functions the API will write them through. Nothing
-- reads or writes them yet: this migration ships alone so it can reach
-- production before the routes that use it.
--
--   editor_projects          one row per project: its name, the hash and size
--                            of its latest saved content, a revision counter
--                            and the claim that lets one browser tab at a time
--                            edit it (holder_id + holder_seen_at). Soft-deleted
--                            through deleted_at.
--   editor_project_versions  the project's labelled versions, numbered per
--                            project. A version is stored whole ('full') or as
--                            a patch against an earlier full version
--                            (base_number).
--
-- Access: RLS on both tables. A signed-in person may read their own rows (the
-- versions through their project); there is no insert, update or delete
-- policy and no client role holds a write privilege, so every write goes
-- through the backend's service role. The functions are service-role only.
-- supabase/tests/editor-projects.behavior.sql proves the access rules and what
-- the functions do.
--
--   editor_project_save(p_id, p_user, p_holder, p_hash, p_size, p_blob_key,
--                       p_base DEFAULT NULL)
--       Saves new content that the caller has already written to storage
--       under p_blob_key. In order:
--       - `invalid_content` unless p_hash is a SHA-256 in lowercase hex,
--         p_size is zero or more and p_blob_key is 1 to 512 characters
--         (checked before anything is compared or written);
--       - `not_found`, then `not_holder` unless p_holder holds the claim (no
--         age check: the holder always saves);
--       - `base_mismatch` when p_base is given and is not the hash saved now
--         (a never-saved project matches no base), so a save computed from
--         older content never overwrites newer content;
--       - when p_hash is the hash already saved, it only refreshes
--         holder_seen_at and returns saved = false and no previous key (the
--         caller discards the file it wrote);
--       - otherwise it stores the hash, size and key, bumps the revision and
--         updated_at, and returns saved = true with the key it replaced (null
--         on a first save), which the caller may then delete.
--   editor_project_claim(p_id, p_user, p_holder, p_takeover)
--       Takes the claim when there is none, when its holder has not been seen
--       for 90 seconds, when p_holder already holds it, or when p_takeover is
--       set; otherwise returns false.
--   editor_project_release(p_id, p_user, p_holder)
--       Clears the claim when p_holder holds it.
--
-- Each function locks the project row (FOR UPDATE) and finds it only when it
-- belongs to p_user and is not deleted; otherwise it raises `not_found`.
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE everywhere, each policy dropped
-- before it is created, the REVOKE/GRANT statements idempotent. The tables are
-- new: on a first apply the only lock taken on an existing table is the FK's
-- SHARE ROW EXCLUSIVE on auth.users. A re-apply over tables that already exist
-- also takes a brief ACCESS EXCLUSIVE lock on this migration's own two tables
-- for the ADD COLUMN IF NOT EXISTS statements. The lock_timeout bounds every
-- such wait to a failed, safely retried migration instead of a stalled
-- platform.
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.editor_projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  content_hash   TEXT CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  size_bytes     INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  revision       BIGINT NOT NULL DEFAULT 0,
  holder_id      TEXT,
  holder_seen_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- A person's project list, newest first, without the deleted ones.
CREATE INDEX IF NOT EXISTS idx_editor_projects_user_updated
  ON public.editor_projects (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- The storage key of the file holding the project's current content.
ALTER TABLE public.editor_projects
  ADD COLUMN IF NOT EXISTS blob_key TEXT
  CHECK (blob_key IS NULL OR char_length(blob_key) BETWEEN 1 AND 512);

COMMENT ON TABLE public.editor_projects IS
  'A video-editor project saved to a person''s account: its latest content hash and size, a revision counter, and the claim that lets one browser tab edit it at a time. Read by its owner; written only by the service role.';
COMMENT ON COLUMN public.editor_projects.content_hash IS
  'SHA-256, as 64 lowercase hex characters, of the project''s canonical JSON text.';
COMMENT ON COLUMN public.editor_projects.blob_key IS
  'Storage key of the file that holds the project''s current content (null until first saved). A key is unique per save and never reused, so deleting a replaced key can never remove a file a row points to.';
COMMENT ON COLUMN public.editor_projects.holder_id IS
  'The browser tab that holds the edit claim (null when nobody does).';
COMMENT ON COLUMN public.editor_projects.holder_seen_at IS
  'When the holder last claimed or saved. A claim not seen for 90 seconds can be taken by another tab.';

CREATE TABLE IF NOT EXISTS public.editor_project_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES public.editor_projects(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  label        TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  author       TEXT NOT NULL CHECK (char_length(author) BETWEEN 1 AND 60),
  kind         TEXT NOT NULL CHECK (kind IN ('full', 'patch')),
  base_number  INTEGER,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number),
  -- A patch names the full version it is against; a full version names none.
  CONSTRAINT editor_project_versions_base_matches_kind CHECK (
    (kind = 'full' AND base_number IS NULL)
    OR (kind = 'patch' AND base_number IS NOT NULL)
  )
);

-- The storage key of the file holding this version. NOT NULL with no
-- default: this column arrives with the table, which holds no rows anywhere,
-- so the ADD succeeds on a fresh apply and on a re-apply alike.
ALTER TABLE public.editor_project_versions
  ADD COLUMN IF NOT EXISTS blob_key TEXT NOT NULL
  CHECK (char_length(blob_key) BETWEEN 1 AND 512);

COMMENT ON TABLE public.editor_project_versions IS
  'A labelled version of a video-editor project, numbered per project, stored whole or as a patch against an earlier full version. Read by the project''s owner; written only by the service role.';
COMMENT ON COLUMN public.editor_project_versions.base_number IS
  'For a patch, the number of the full version it is against; null for a full version.';
COMMENT ON COLUMN public.editor_project_versions.blob_key IS
  'Storage key of the file that holds this version (a whole file or a difference). Unique per version and never reused.';

-- ---------------------------------------------------------------------------
-- Access: the owner reads, the service role writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.editor_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_project_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.editor_projects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.editor_project_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.editor_projects TO authenticated;
GRANT SELECT ON public.editor_project_versions TO authenticated;
GRANT ALL ON public.editor_projects TO service_role;
GRANT ALL ON public.editor_project_versions TO service_role;

DROP POLICY IF EXISTS editor_projects_owner_select ON public.editor_projects;
CREATE POLICY editor_projects_owner_select ON public.editor_projects
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS editor_project_versions_owner_select ON public.editor_project_versions;
CREATE POLICY editor_project_versions_owner_select ON public.editor_project_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.editor_projects p
    WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- editor_project_save: store new content for the tab that holds the claim.
-- The earlier five-argument form is dropped so only this one exists.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.editor_project_save(UUID, UUID, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.editor_project_save(
  p_id       UUID,
  p_user     UUID,
  p_holder   TEXT,
  p_hash     TEXT,
  p_size     INTEGER,
  p_blob_key TEXT,
  p_base     TEXT DEFAULT NULL
)
RETURNS TABLE (revision BIGINT, saved BOOLEAN, previous_blob_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_row public.editor_projects%ROWTYPE;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_size IS NULL OR p_size < 0
     OR p_blob_key IS NULL OR char_length(p_blob_key) NOT BETWEEN 1 AND 512
  THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  SELECT * INTO v_row
  FROM public.editor_projects ep
  WHERE ep.id = p_id AND ep.user_id = p_user AND ep.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_row.holder_id IS DISTINCT FROM p_holder OR p_holder IS NULL THEN
    RAISE EXCEPTION 'not_holder';
  END IF;

  -- A null saved hash is distinct from any base.
  IF p_base IS NOT NULL AND v_row.content_hash IS DISTINCT FROM p_base THEN
    RAISE EXCEPTION 'base_mismatch';
  END IF;

  IF v_row.content_hash IS NOT DISTINCT FROM p_hash THEN
    UPDATE public.editor_projects ep
    SET holder_seen_at = NOW()
    WHERE ep.id = p_id;
    RETURN QUERY SELECT v_row.revision, FALSE, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.editor_projects ep
  SET content_hash   = p_hash,
      size_bytes     = p_size,
      blob_key       = p_blob_key,
      revision       = ep.revision + 1,
      updated_at     = NOW(),
      holder_seen_at = NOW()
  WHERE ep.id = p_id
  -- v_row was read under the row lock, so its key is the one this replaced.
  RETURNING ep.revision, TRUE, v_row.blob_key;
END;
$$;

-- ---------------------------------------------------------------------------
-- editor_project_claim: take the edit claim when it is free, stale, already
-- ours, or taken over on purpose.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editor_project_claim(
  p_id       UUID,
  p_user     UUID,
  p_holder   TEXT,
  p_takeover BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.editor_projects%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.editor_projects ep
  WHERE ep.id = p_id AND ep.user_id = p_user AND ep.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p_holder IS NULL OR p_holder = '' THEN
    RAISE EXCEPTION 'invalid_holder';
  END IF;

  IF v_row.holder_id IS NULL
     OR v_row.holder_seen_at IS NULL
     OR v_row.holder_seen_at < NOW() - INTERVAL '90 seconds'
     OR v_row.holder_id = p_holder
     OR COALESCE(p_takeover, FALSE)
  THEN
    UPDATE public.editor_projects ep
    SET holder_id = p_holder,
        holder_seen_at = NOW()
    WHERE ep.id = p_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- ---------------------------------------------------------------------------
-- editor_project_release: give the claim up, only by the tab that holds it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editor_project_release(
  p_id     UUID,
  p_user   UUID,
  p_holder TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.editor_projects%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.editor_projects ep
  WHERE ep.id = p_id AND ep.user_id = p_user AND ep.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p_holder IS NULL OR v_row.holder_id IS DISTINCT FROM p_holder THEN
    RETURN FALSE;
  END IF;

  UPDATE public.editor_projects ep
  SET holder_id = NULL,
      holder_seen_at = NULL
  WHERE ep.id = p_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.editor_project_save(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_project_save(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.editor_project_save(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.editor_project_save(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.editor_project_claim(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_project_claim(UUID, UUID, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.editor_project_claim(UUID, UUID, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.editor_project_claim(UUID, UUID, TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.editor_project_release(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_project_release(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.editor_project_release(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.editor_project_release(UUID, UUID, TEXT) TO service_role;
