-- 119_default_project_per_user.sql — Per-user default project
--
-- Adds the notion of a per-user "default" project so the dashboard can
-- offer a one-click "New Workflow" flow without forcing the user to first
-- pick or create a project. Workflows created without a project_id land
-- in the caller's default project. The default project is visible in the
-- normal projects list, can be renamed, but cannot be deleted.
--
-- Components:
--   1) projects.is_default BOOLEAN  + partial unique index ensuring at most
--      one default per user.
--   2) Backfill: every existing profile gets a freshly-created
--      "My Recent Flows" project (we never promote an existing project —
--      that would surprise users who have already chosen a primary
--      workspace). Idempotent via NOT EXISTS, safe to re-apply.
--   3) public.ensure_default_project() RPC — returns the caller's default
--      project id, creating it lazily if missing. SECURITY DEFINER with
--      search_path locked to public per the audit hardening pattern used
--      elsewhere in this repo. Granted to `authenticated` only.
--   4) public.prevent_default_project_delete() BEFORE DELETE trigger —
--      blocks DELETE on rows where is_default = TRUE. Fires for both the
--      Supabase JS path (frontend) and the service-role Fastify path,
--      so the guard cannot be bypassed by either client. Backend handler
--      returns a friendly 409 before this trigger fires; the trigger is
--      the hard safety net.

-- 1. Column + partial unique index ------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_project_per_user
  ON public.projects (user_id)
  WHERE is_default = TRUE;

-- 2. Backfill — create "My Recent Flows" for every existing profile --------
--
-- We intentionally create a NEW project rather than promoting an existing
-- one. Side effect: each existing user gains one extra project after this
-- migration runs. The frontend renders it with a star icon + tooltip so the
-- origin is obvious.

INSERT INTO public.projects (user_id, name, description, settings, is_default)
SELECT p.id,
       'My Recent Flows',
       'Auto-created workspace for new workflows',
       '{}'::jsonb,
       TRUE
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.projects pr
  WHERE pr.user_id = p.id AND pr.is_default = TRUE
);

-- 3. ensure_default_project() RPC ------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_default_project()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_project_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_project_id
  FROM public.projects
  WHERE user_id = v_user_id AND is_default = TRUE
  LIMIT 1;

  IF v_project_id IS NOT NULL THEN
    RETURN v_project_id;
  END IF;

  INSERT INTO public.projects (user_id, name, description, settings, is_default)
  VALUES (
    v_user_id,
    'My Recent Flows',
    'Auto-created workspace for new workflows',
    '{}'::jsonb,
    TRUE
  )
  RETURNING id INTO v_project_id;

  RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_project() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_default_project() TO authenticated;

-- 4. Delete guard trigger ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_default_project_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_default = TRUE THEN
    RAISE EXCEPTION 'cannot delete default project'
      USING ERRCODE = '23514',
            HINT = 'Rename the project instead; default projects are auto-created and cannot be removed.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_default_project_delete ON public.projects;
CREATE TRIGGER guard_default_project_delete
  BEFORE DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_default_project_delete();
