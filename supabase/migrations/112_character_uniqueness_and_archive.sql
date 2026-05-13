-- Character Studio v2: characters as first-class library entries.
--
-- Two locked-in invariants:
--   1. Each user has at most one ACTIVE character with a given name (case-insensitive).
--      So a user can have one "Kira" but renaming to "kira" is also a conflict; lets
--      "@Kira" be the unambiguous reference downstream when picking by name.
--   2. Soft-delete via `deleted_at` — the library "Delete" button now archives, so
--      canvas nodes referencing an archived character continue to load (the
--      `GET /v1/characters/:id` endpoint stays oblivious to deleted_at). The library
--      list filters them out by default; an `?archived=true` view restores them.
--
-- The partial unique index uses `WHERE deleted_at IS NULL` so archiving a "Kira" frees
-- the name for a fresh "Kira" without permanently destroying the old data.

-- 1. soft-delete column
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. dedupe pre-existing rows so the unique index can be created cleanly.
-- Rule: rank duplicates by created_at; the oldest keeps the name, the rest get
-- " (2)", " (3)", … appended. Case-insensitive comparison so "Kira" and "kira"
-- count as duplicates.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY user_id, LOWER(name) ORDER BY created_at, id) AS rn,
    name
  FROM public.characters
  WHERE deleted_at IS NULL
)
UPDATE public.characters c
SET name = ranked.name || ' (' || ranked.rn || ')'
FROM ranked
WHERE c.id = ranked.id AND ranked.rn > 1;

-- 3. partial unique index over active rows (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS characters_user_name_active_unique
  ON public.characters (user_id, LOWER(name))
  WHERE deleted_at IS NULL;

-- 4. supporting index for the default "active characters for this user" query.
CREATE INDEX IF NOT EXISTS idx_characters_user_active
  ON public.characters (user_id, deleted_at);

-- 5. workflow-usage lookup used by the "Archive" confirmation modal to show
-- the user how many workflows reference this character before it disappears
-- from the library list. The check digs into workflows.nodes (JSONB array) to
-- find any node whose `data.characterDbId` matches. SECURITY DEFINER so the
-- backend's service-role client can call it; the user_id filter inside scopes
-- the result to the caller's own workflows.
CREATE OR REPLACE FUNCTION public.character_workflow_usage(
  p_character_id UUID,
  p_user_id UUID
) RETURNS TABLE(workflow_id UUID, workflow_name TEXT)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT w.id, w.name
  FROM public.workflows w,
       jsonb_array_elements(w.nodes) AS n
  WHERE n->'data'->>'characterDbId' = p_character_id::text
    AND w.user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.character_workflow_usage(UUID, UUID)
  TO authenticated, service_role;
