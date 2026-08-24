-- ============================================================================
-- Organizations — E1 / P9: the personal-space gate.
--
-- An organization may decide that its members keep no personal space: every
-- workflow they make belongs to a workspace. Nothing enforced that yet, and
-- one of the two writers that would have to enforce it is called by the
-- BROWSER, directly, bypassing every route — so the rule has to live here.
--
-- Inert on today's data by construction: every clause below requires an
-- ACTIVE membership in an organization, and there are none.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- kind_preset gains a ninth key.
--
-- Restated in full from 332 rather than patched, because it is a single CASE
-- expression and a partial edit is not possible. The eight existing values are
-- byte-identical; diff this against 332 to confirm.
--
-- policy_survives_suspension = false for both kinds: that IS today's
-- behaviour, so no organization changes when this ships. The option that locks
-- people out should be a deliberate act by someone who knows what their
-- contract says, not something they inherit from a default.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kind_preset(p_kind text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'school' THEN '{"admin_access":"edit","default_workflow_visibility":"private","member_access_to_shared":"view","members_can_create_projects":false,"member_caps_enabled":true,"personal_space_enabled":true,"workspace_admins_can_invite":true,"collaborators_can_invite":false,"policy_survives_suspension":false}'::jsonb
    WHEN 'team'   THEN '{"admin_access":"view","default_workflow_visibility":"workspace","member_access_to_shared":"edit","members_can_create_projects":true,"member_caps_enabled":false,"personal_space_enabled":true,"workspace_admins_can_invite":true,"collaborators_can_invite":true,"policy_survives_suspension":false}'::jsonb
  END;
$$;

-- ---------------------------------------------------------------------------
-- org_setting — the ORGANIZATION-level resolver 332 never had.
--
-- 332's effective_setting resolves a setting THROUGH a workspace
-- (workspace override -> org override -> kind preset) and cannot answer a
-- question asked of an organization with no workspace in the picture. This is
-- the same function one rung up: same two lower levels, same NULLIF
-- fall-through (a key present with JSON null counts as "not set"), and the
-- same membership gate.
--
-- The gate is not decoration. Without it this is a settings oracle: any
-- signed-in user could read any organization's configuration by guessing a
-- UUID. That is exactly the hole 332 closed on effective_setting, and it would
-- have been re-opened here.
--
-- org_role() returns NULL for a non-member, so `IS NOT NULL` reads as "the
-- caller belongs to this organization". auth.uid() IS NULL is the service-role
-- path, where the backend has already decided who it is acting for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_setting(p_org_id uuid, p_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR is_admin() OR org_role(p_org_id) IS NOT NULL THEN
      COALESCE(
        (SELECT NULLIF(o.settings -> p_key, 'null'::jsonb) FROM organizations o WHERE o.id = p_org_id),
        (SELECT kind_preset(o.kind) -> p_key                FROM organizations o WHERE o.id = p_org_id)
      )
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- personal_space_enabled_for — does this user still have a personal space?
--
-- True unless some organization that BINDS them says otherwise. Which
-- organizations bind:
--   active     -> always
--   suspended  -> only if it chose policy_survives_suspension. The reason an
--                 organization disables the personal space may be contractual
--                 (work made here belongs to the institution), and an unpaid
--                 invoice does not void a contract — but neither should a
--                 stopped organization strand its members by default.
--   pending    -> never; it has not been approved, so its rules never started
--   deleted    -> never; it is gone
--
-- A user who belongs to no organization is unaffected. That is every user on
-- the platform today, and the assertion that protects all of them is the first
-- one in the proof.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_space_enabled_for(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM organization_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = p_user_id
      AND om.status = 'active'
      AND (
        o.status = 'active'
        OR (o.status = 'suspended'
            AND org_setting(o.id, 'policy_survives_suspension') = 'true'::jsonb)
      )
      AND org_setting(o.id, 'personal_space_enabled') = 'false'::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- ensure_default_project — 119's function with one guard added.
--
-- Restated in full so a reader can diff the two files and see the whole
-- change. Everything below the guard is byte-identical to 119.
--
-- The FRONTEND calls this RPC directly through Supabase JS, so the refusal
-- surfaces as a PostgREST error rather than a route's JSON envelope. The
-- message PREFIX is therefore the contract: a client matches
-- PERSONAL_SPACE_DISABLED and says "choose a workspace". Keep the prefix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_project()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_project_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT personal_space_enabled_for(v_user_id) THEN
    RAISE EXCEPTION 'PERSONAL_SPACE_DISABLED: create this inside a workspace'
      USING ERRCODE = '42501',
            HINT = 'Your organization requires new work to be created in a workspace.';
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

-- ---------------------------------------------------------------------------
-- Grants.
--
-- org_setting takes an ORGANIZATION id and gates on membership, so it
-- discloses nothing to a non-member and `authenticated` may call it.
--
-- personal_space_enabled_for takes a USER id. Granted broadly it becomes an
-- oracle — any signed-in user could ask whether user X belongs to an
-- organization that disabled the personal space. ensure_default_project is a
-- definer and calls it as the owner, needing no grant; the backend twin calls
-- it as service_role. So: service_role only, and `authenticated` explicitly
-- revoked rather than merely unmentioned.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.org_setting(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_setting(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.org_setting(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.personal_space_enabled_for(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.personal_space_enabled_for(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.personal_space_enabled_for(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.personal_space_enabled_for(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_default_project() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_project() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ensure_default_project() TO authenticated;
