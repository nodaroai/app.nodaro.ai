-- ===========================================================================
-- 333: Organizations — the two ways in, as atomic RPCs
--
-- Accepting an email invitation and joining a workspace by code each touch
-- several rows under a set of preconditions (the invitation's state, the
-- organization's status, the member's standing, the domain allowlist) that
-- must hold at the moment the rows are written. A route cannot guarantee
-- that across several statements, so each path is ONE function that locks
-- what it reads, re-checks everything, writes, and signals a refusal with a
-- fixed prefix at the start of its message (`INVITATION_EXPIRED: …`) — the
-- route maps prefixes, never prose.
--
-- Both functions are SECURITY DEFINER and callable by the service role ONLY.
-- The route authorizes the caller; the function re-checks the facts.
-- `auth.uid()` wins over the user argument, so a misuse from an
-- authenticated context could never act for someone else.
--
-- Two deliberate asymmetries, enforced here so every writer is covered:
--   * An invitation to someone who is ALREADY a member changes nothing
--     about their membership (an existing role is kept, a suspension is
--     kept) but is still consumed — the invitee followed a link and the
--     link must not stay live.
--   * A join code NEVER reactivates a suspended member: the suspension was
--     an admin's decision, and a code anyone in the class can read must not
--     be able to undo it.
--
-- Additive and idempotent (CREATE OR REPLACE, REVOKE/GRANT repeatable).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- accept_invitation(token hash, user, user email) -> (org_id, workspace_id)
--
--   INVITATION_NOT_FOUND   no row with that token hash
--   INVITATION_REVOKED     revoked_at is set
--   INVITATION_ACCEPTED    accepted_at is set (a second click)
--   INVITATION_EXPIRED     expires_at has passed
--   EMAIL_MISMATCH         the signed-in account's email is not the invitee's
--   ORG_NOT_ACTIVE         the organization is pending, suspended or deleted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_invitation(p_token_hash text, p_user_id uuid, p_user_email text)
RETURNS TABLE (org_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- The OUT columns share their names with table columns; inside the body an
-- unqualified name is always the COLUMN (the ON CONFLICT targets below),
-- and the values returned are read from variables explicitly.
#variable_conflict use_column
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_inv invitations%ROWTYPE;
  v_org_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NO_USER: a user is required' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_inv FROM invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no such invitation' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_REVOKED: the invitation was revoked' USING ERRCODE = '42501';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_ACCEPTED: the invitation was already accepted' USING ERRCODE = '42501';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: the invitation has expired' USING ERRCODE = '42501';
  END IF;
  IF lower(p_user_email) IS DISTINCT FROM v_inv.email THEN
    RAISE EXCEPTION 'EMAIL_MISMATCH: the invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;

  SELECT o.status INTO v_org_status FROM organizations o WHERE o.id = v_inv.org_id;
  IF v_org_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ORG_NOT_ACTIVE: the organization is not active' USING ERRCODE = '42501';
  END IF;

  -- An existing membership keeps its role and its standing.
  INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
  VALUES (v_inv.org_id, v_uid, v_inv.org_role, 'active', v_inv.invited_by)
  ON CONFLICT (org_id, user_id) DO NOTHING;

  IF v_inv.workspace_id IS NOT NULL THEN
    INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status, added_by)
    VALUES (v_inv.workspace_id, v_inv.org_id, v_uid, COALESCE(v_inv.workspace_role, 'member'), 'active', v_inv.invited_by)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;

  UPDATE invitations i SET accepted_at = now(), accepted_by = v_uid WHERE i.id = v_inv.id;

  RETURN QUERY SELECT v_inv.org_id, v_inv.workspace_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- join_workspace_by_code(code, user, user email) -> (org_id, workspace_id)
--
--   JOIN_CODE_INVALID      no such code, or disabled, or the workspace is archived
--                          (one answer for all three: a code must not reveal
--                          which of them is true)
--   ORG_NOT_ACTIVE         the organization is pending, suspended or deleted
--   DOMAIN_NOT_ALLOWED     the organization restricts email domains and the
--                          account's domain is not on the list
--   MEMBER_SUSPENDED       the account is suspended in the organization or
--                          the workspace; a code never lifts that
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_workspace_by_code(p_code text, p_user_id uuid, p_user_email text)
RETURNS TABLE (org_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_ws_id uuid;
  v_org_id uuid;
  v_enabled boolean;
  v_archived_at timestamptz;
  v_org_status text;
  v_domains jsonb;
  v_domain text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NO_USER: a user is required' USING ERRCODE = '42501';
  END IF;

  SELECT jc.workspace_id, jc.enabled, w.org_id, w.archived_at
    INTO v_ws_id, v_enabled, v_org_id, v_archived_at
    FROM workspace_join_codes jc
    JOIN workspaces w ON w.id = jc.workspace_id
   WHERE jc.code = upper(p_code)
     FOR UPDATE OF jc;
  IF NOT FOUND OR NOT v_enabled OR v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'JOIN_CODE_INVALID: that join code is not valid' USING ERRCODE = '42501';
  END IF;

  SELECT o.status, o.settings -> 'allowed_email_domains'
    INTO v_org_status, v_domains
    FROM organizations o WHERE o.id = v_org_id;
  IF v_org_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ORG_NOT_ACTIVE: the organization is not active' USING ERRCODE = '42501';
  END IF;

  -- An empty or absent list means any domain; a non-empty list is exact.
  IF v_domains IS NOT NULL AND jsonb_typeof(v_domains) = 'array' AND jsonb_array_length(v_domains) > 0 THEN
    v_domain := lower(split_part(COALESCE(p_user_email, ''), '@', 2));
    IF v_domain = '' OR NOT (v_domains ? v_domain) THEN
      RAISE EXCEPTION 'DOMAIN_NOT_ALLOWED: this organization only admits listed email domains' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT m.status INTO v_status
    FROM organization_members m WHERE m.org_id = v_org_id AND m.user_id = v_uid;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'MEMBER_SUSPENDED: the membership is suspended' USING ERRCODE = '42501';
  END IF;
  SELECT wm.status INTO v_status
    FROM workspace_members wm WHERE wm.workspace_id = v_ws_id AND wm.user_id = v_uid;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'MEMBER_SUSPENDED: the membership is suspended' USING ERRCODE = '42501';
  END IF;

  INSERT INTO organization_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_uid, 'member', 'active')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status)
  VALUES (v_ws_id, v_org_id, v_uid, 'member', 'active')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN QUERY SELECT v_org_id, v_ws_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_workspace_by_code(text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_workspace_by_code(text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_workspace_by_code(text, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.join_workspace_by_code(text, uuid, text) TO service_role;
