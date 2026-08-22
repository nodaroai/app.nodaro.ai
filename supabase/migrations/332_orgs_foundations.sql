-- Multi-tenant organizations — foundations.
--
-- Adds the second tenancy axis: Organization -> Workspace -> Member. Until now
-- Nodaro had exactly one axis (`user_id`); nothing here changes that one. This
-- migration is additive and greenfield — no existing table gains a scoping
-- column in this epic (content scoping is the next epic's migration).
--
-- Layering notes:
--
--   * `kind_preset` / `effective_setting` / `ws_setting_bool` land here, with
--     the tables they read (`organizations`, `workspaces`) — even though their
--     first RLS consumers arrive with content scoping. Later migrations must
--     NOT redefine them.
--   * `org_member_status` / `workspace_member_status` exist so suspension can
--     be asked independently of role: the role helpers keep returning a role
--     for a suspended member (callers need "is admin?" and "is suspended?" as
--     separate facts — a resolver that returns NULL for suspended would let
--     creator/admin fast paths run before suspension is checked).
--   * `workflow_access` is NOT here: it reads `workflows.workspace_id`, a
--     column the content-scoping migration adds. It lands there.
--   * Organization creation is approval-gated by default: a new row is
--     `pending` until a platform admin activates it, and the gate itself is
--     the `org_creation_requires_approval` app setting (seeded true below),
--     so self-serve can be switched on at runtime without a schema change.
--     The column DEFAULT is `pending` on purpose — a writer that forgets the
--     gate creates a dormant organization, not a live one.
--   * Ownership transfer is one atomic RPC (`transfer_org_ownership`): the
--     single-owner partial unique index forbids two owners even transiently,
--     so the demote / promote / pointer update must be one transaction.
--   * Join codes live in their own admin-only table rather than as a column on
--     `workspaces`. A column would need column-level grants or a projection
--     view to hide it from plain members — both silently undone by a later
--     table-level GRANT. A separate table with an admin-only policy cannot
--     regress that way.
--
-- Function security: every SECURITY DEFINER helper here is revoked from
-- PUBLIC *and* anon, then granted to authenticated (service_role keeps its
-- default grant). The `COALESCE(auth.uid(), p_user_id)` pattern (auth.uid()
-- always wins) stops an authenticated caller from impersonating via
-- p_user_id, but the `anon` role has no auth.uid() either — without the
-- revoke, an unauthenticated PostgREST call could probe
-- `workspace_role($ws, $user)` as a membership oracle. Supabase grants anon
-- explicitly through default privileges, so `FROM PUBLIC` alone is not enough
-- (same lesson as the asset-RPC lockdowns in 170/200).

-- ===========================================================================
-- 1. Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1..50 chars, lower-case alphanumerics and hyphens, no leading/trailing hyphen.
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind              text NOT NULL CHECK (kind IN ('school','team')),
  -- RESTRICT, not CASCADE: deleting a profile that owns an organization must
  -- fail loudly rather than silently taking the org (and its billing) along.
  owner_user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- pending = created, awaiting platform-admin approval (see the header).
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','deleted')),
  deleted_at        timestamptz,
  -- Organization Terms addendum — required at create time for kind='school',
  -- where the owner attests to the authority to enrol students.
  terms_accepted_at timestamptz,
  terms_accepted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Validated by Zod (OrgSettingsSchema in @nodaro/shared) at the route.
  -- Partial overrides of the kind preset, plus org-only keys.
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_terms_accepted_by ON organizations(terms_accepted_by) WHERE terms_accepted_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_members (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','member')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  invited_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by ON organization_members(invited_by) WHERE invited_by IS NOT NULL;
-- Exactly one owner per organization. `organizations.owner_user_id` is the
-- denormalised pointer the RESTRICT FK and billing hang off; this row is the
-- membership itself. Ownership transfer updates both in one transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_owner ON organization_members(org_id) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS workspaces (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  description        text,
  -- Per-workspace overrides; resolution is workspace -> org -> kind preset
  -- (see `effective_setting` below). Validated by WorkspaceSettingsSchema.
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- FK added by the content-scoping migration (projects gains workspace_id
  -- there); a plain uuid until then.
  default_project_id uuid,
  archived_at        timestamptz,
  created_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug),
  -- Target for the composite FK on workspace_members below.
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(org_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON workspaces(created_by) WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL,
  -- Denormalised so the DB itself enforces both invariants below without a
  -- trigger: removing someone from the organization cascades to every
  -- workspace, and a workspace membership can never point at a workspace in
  -- another org.
  org_id       uuid NOT NULL,
  user_id      uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin','member')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  credit_cap   integer CHECK (credit_cap IS NULL OR credit_cap >= 0),
  added_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, org_id) REFERENCES workspaces(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id)      REFERENCES organization_members(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ws_members_org_user ON workspace_members(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ws_members_added_by ON workspace_members(added_by) WHERE added_by IS NOT NULL;

-- Admin-only (see the header). 8 chars from the Crockford base32 alphabet
-- minus vowels, so a code never spells a word. This CHECK is the format's
-- single public definition; the server's generator is pinned to it by test.
CREATE TABLE IF NOT EXISTS workspace_join_codes (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[0-9BCDFGHJKMNPQRSTVWXYZ]{8}$'),
  enabled      boolean NOT NULL DEFAULT false,
  rotated_at   timestamptz NOT NULL DEFAULT now(),
  rotated_by   uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_join_codes_rotated_by ON workspace_join_codes(rotated_by) WHERE rotated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- null = an org-level invite with no workspace landing. The composite FK
  -- below guarantees a workspace invitation never points at another org's
  -- workspace (same device as workspace_members).
  workspace_id   uuid,
  email          text NOT NULL CHECK (email = lower(email)),
  org_role       text NOT NULL DEFAULT 'member' CHECK (org_role IN ('admin','member')),
  workspace_role text CHECK (workspace_role IN ('admin','member')),
  -- sha256 of 32 random bytes. The raw token exists only in the email.
  token_hash     text NOT NULL UNIQUE,
  invited_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at    timestamptz,
  accepted_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, org_id) REFERENCES workspaces(id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_workspace ON invitations(workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON invitations(invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_accepted_by ON invitations(accepted_by) WHERE accepted_by IS NOT NULL;
-- One open invite per (org, email, workspace): a resend refreshes the token
-- in place instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_open
  ON invitations(org_id, email, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS organization_audit_log (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Not FKs on purpose: an audit row must outlive the workspace or actor it
  -- describes.
  workspace_id uuid,
  actor_id     uuid,
  -- OrgAuditAction union in TS; single writer audit() in ee/orgs.
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_audit_org_created ON organization_audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_ws_created ON organization_audit_log(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

-- Which workspace the user was last in, so a fresh session restores context.
-- Deliberately self-updatable: check_profiles_update_allowed pins its columns
-- by explicit name, so a column it does not name stays freely updatable by
-- the profile owner. The FK only requires the workspace to exist — a user can
-- point this at a workspace they do not belong to. It is a UI hint and must
-- never be read as authorization.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_last_workspace ON profiles(last_workspace_id) WHERE last_workspace_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.workspaces;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Approval gate (see the header). Admin-editable at runtime like every
-- other app setting; absent row = the same default.
INSERT INTO app_settings (key, value)
VALUES ('org_creation_requires_approval', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- 2. Membership + settings helpers (SECURITY DEFINER)
--
-- House style follows is_admin()/apply_workflow_delta: SECURITY DEFINER,
-- STABLE, SET search_path = public, EXCEPTION -> harmless default, and
-- v_uid := COALESCE(auth.uid(), p_user_id) so auth.uid() ALWAYS wins — only
-- the service role (no auth.uid()) can ask about another user.
--
-- Each has a pure TypeScript twin on the server. Until a CI parity job runs
-- both against a live Postgres, each side pins the shared literals by test.
-- ===========================================================================

-- Role in the organization: 'owner' | 'admin' | 'member' | NULL.
-- Returns the role regardless of suspension — ask org_member_status for that.
CREATE OR REPLACE FUNCTION org_role(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO v_role FROM organization_members
   WHERE org_id = p_org_id AND user_id = v_uid;
  RETURN v_role;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Membership status in the organization: 'active' | 'suspended' | NULL.
CREATE OR REPLACE FUNCTION org_member_status(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM organization_members
   WHERE org_id = p_org_id AND user_id = v_uid;
  RETURN v_status;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Role in the workspace: 'admin' | 'member' | NULL.
-- Org owners/admins are implicit workspace admins — they hold 'admin' here
-- WITHOUT a workspace_members row (and are skipped by member-spend tracking).
-- An explicit workspace_members row wins over the implicit rule, so a
-- deliberate per-workspace demotion of an org admin is possible.
CREATE OR REPLACE FUNCTION workspace_role(p_ws_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_role text;
  v_org_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT wm.role INTO v_role FROM workspace_members wm
   WHERE wm.workspace_id = p_ws_id AND wm.user_id = v_uid;
  IF v_role IS NOT NULL THEN RETURN v_role; END IF;

  SELECT om.role INTO v_org_role
    FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id AND om.user_id = v_uid
   WHERE w.id = p_ws_id;
  IF v_org_role IN ('owner','admin') THEN RETURN 'admin'; END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Membership status in the workspace: 'active' | 'suspended' | NULL.
-- Suspended at either level is suspended: an explicit workspace row combines
-- with the org status; implicit admins (org owner/admin, no row) carry their
-- org status.
CREATE OR REPLACE FUNCTION workspace_member_status(p_ws_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_ws_status text;
  v_org_role text;
  v_org_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT om.role, om.status INTO v_org_role, v_org_status
    FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id AND om.user_id = v_uid
   WHERE w.id = p_ws_id;

  SELECT wm.status INTO v_ws_status FROM workspace_members wm
   WHERE wm.workspace_id = p_ws_id AND wm.user_id = v_uid;

  IF v_ws_status IS NOT NULL THEN
    IF v_org_status = 'suspended' THEN RETURN 'suspended'; END IF;
    RETURN v_ws_status;
  END IF;

  IF v_org_role IN ('owner','admin') THEN
    RETURN COALESCE(v_org_status, 'active');
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Settings resolution: workspace.settings -> organization.settings -> preset.
-- kind_preset is the presets' single public definition; the server's copy is
-- pinned to this literal by test.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kind_preset(p_kind text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'school' THEN '{"admin_access":"edit","default_workflow_visibility":"private","member_access_to_shared":"view","members_can_create_projects":false,"member_caps_enabled":true,"personal_space_enabled":true,"workspace_admins_can_invite":true,"collaborators_can_invite":false}'::jsonb
    WHEN 'team'   THEN '{"admin_access":"view","default_workflow_visibility":"workspace","member_access_to_shared":"edit","members_can_create_projects":true,"member_caps_enabled":false,"personal_space_enabled":true,"workspace_admins_can_invite":true,"collaborators_can_invite":true}'::jsonb
  END;
$$;

-- Readable by the service role, platform admins, and members of the workspace
-- (explicit or implicit) — SECURITY DEFINER bypasses the RLS on the tables it
-- reads, so the membership gate lives here. Anyone else gets NULL, the same
-- answer as for a workspace that does not exist.
-- A key present with JSON null counts as "not set" (NULLIF), so an override
-- cleared by writing null falls through to the next level exactly like a
-- missing key; the TypeScript twin's `??` does the same.
CREATE OR REPLACE FUNCTION effective_setting(p_workspace_id uuid, p_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR is_admin() OR workspace_role(p_workspace_id) IS NOT NULL THEN
      COALESCE(
        (SELECT NULLIF(settings -> p_key, 'null'::jsonb) FROM workspaces WHERE id = p_workspace_id),
        (SELECT NULLIF(o.settings -> p_key, 'null'::jsonb) FROM organizations o JOIN workspaces w ON w.org_id = o.id WHERE w.id = p_workspace_id),
        (SELECT kind_preset(o.kind) -> p_key FROM organizations o JOIN workspaces w ON w.org_id = o.id WHERE w.id = p_workspace_id)
      )
    ELSE NULL
  END;
$$;

-- Total: a non-boolean value (a string, a number, an absent key) is false
-- rather than a cast error inside a policy.
CREATE OR REPLACE FUNCTION ws_setting_bool(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(effective_setting(p_workspace_id, p_key) = 'true'::jsonb, false);
$$;

-- Close the anonymous-oracle gap (see header): authenticated + service_role
-- only. REVOKE on a role that never held the privilege is a harmless no-op.
REVOKE EXECUTE ON FUNCTION public.org_role(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_role(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.org_role(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.org_member_status(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_member_status(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.org_member_status(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.workspace_role(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workspace_role(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.workspace_role(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.workspace_member_status(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workspace_member_status(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.workspace_member_status(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.effective_setting(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_setting(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.effective_setting(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ws_setting_bool(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ws_setting_bool(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.ws_setting_bool(uuid, text) TO authenticated;

-- ===========================================================================
-- 2b. Ownership transfer — one transaction, service-role only
--
-- The caller (a route, after its own authorization) passes the acting user
-- and the target. Every precondition is re-checked here under row locks so
-- two concurrent transfers serialize, and the demotion runs BEFORE the
-- promotion: uq_org_single_owner rejects a second owner even for the
-- duration of one statement sequence. Failures are RAISEd with a stable
-- prefix the route maps to an error code (the reserve_credits convention).
-- Returns the previous owner's id so the route can write the audit row.
-- ===========================================================================

CREATE OR REPLACE FUNCTION transfer_org_ownership(p_org_id uuid, p_actor_id uuid, p_new_owner_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_status text;
  v_actor_status text;
  v_target_role text;
  v_target_status text;
BEGIN
  -- FOR NO KEY UPDATE: serializes concurrent transfers without blocking the
  -- FOR KEY SHARE locks that child-row inserts (workspaces, memberships) take
  -- on the parent — no key column changes here.
  SELECT owner_user_id, status INTO v_owner, v_status
    FROM organizations WHERE id = p_org_id FOR NO KEY UPDATE;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND: organization % does not exist', p_org_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('pending','active') THEN
    RAISE EXCEPTION 'ORG_NOT_TRANSFERABLE: organization is %', v_status USING ERRCODE = '42501';
  END IF;
  IF v_owner <> p_actor_id THEN
    RAISE EXCEPTION 'NOT_OWNER: only the current owner may transfer ownership' USING ERRCODE = '42501';
  END IF;
  IF p_new_owner_id = v_owner THEN
    RAISE EXCEPTION 'SAME_OWNER: target already owns the organization' USING ERRCODE = '22023';
  END IF;

  -- Lock the membership rows involved for the duration of the swap.
  PERFORM 1 FROM organization_members
   WHERE org_id = p_org_id AND (user_id IN (v_owner, p_new_owner_id) OR role = 'owner')
   FOR NO KEY UPDATE;

  SELECT status INTO v_actor_status
    FROM organization_members WHERE org_id = p_org_id AND user_id = p_actor_id;
  IF v_actor_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ACTOR_SUSPENDED: the owner''s membership is not active' USING ERRCODE = '42501';
  END IF;

  SELECT role, status INTO v_target_role, v_target_status
    FROM organization_members WHERE org_id = p_org_id AND user_id = p_new_owner_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_MEMBER: target is not a member of the organization' USING ERRCODE = '42501';
  END IF;
  IF v_target_role <> 'admin' THEN
    RAISE EXCEPTION 'TARGET_NOT_ADMIN: ownership can only pass to an organization admin' USING ERRCODE = '42501';
  END IF;
  IF v_target_status <> 'active' THEN
    RAISE EXCEPTION 'TARGET_SUSPENDED: target membership is suspended' USING ERRCODE = '42501';
  END IF;

  -- Demote by ROLE, not by the owner pointer: if the pointer and the owner row
  -- ever disagree, this heals the drift instead of colliding with the
  -- single-owner index.
  UPDATE organization_members SET role = 'admin'
   WHERE org_id = p_org_id AND role = 'owner';
  UPDATE organization_members SET role = 'owner'
   WHERE org_id = p_org_id AND user_id = p_new_owner_id;
  UPDATE organizations SET owner_user_id = p_new_owner_id
   WHERE id = p_org_id;

  RETURN v_owner;
END;
$$;

-- Service role only: the route authorizes, this function re-checks.
REVOKE EXECUTE ON FUNCTION public.transfer_org_ownership(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_org_ownership(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transfer_org_ownership(uuid, uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_org_ownership(uuid, uuid, uuid) TO service_role;

-- ===========================================================================
-- 3. Invitation escalation guard
--
-- A workspace-scoped inviter (workspace admin with no org role of their own)
-- must not be able to grant org_role='admin' through the shared invitation
-- path — only an org owner/admin may. Enforced in the DB so every writer
-- (route, bulk import, admin tool) is covered, on INSERT and on any UPDATE
-- that touches the role, the inviter, or the org (a resend refreshes the row
-- in place).
-- Invariant to keep in mind: org_role() lets auth.uid() win over its user
-- argument, so under an authenticated session the guard validates the SESSION
-- user, not NEW.invited_by. Writes are service-role only today; if a client
-- write path is ever added, it must set invited_by = auth.uid() itself.
-- ===========================================================================

CREATE OR REPLACE FUNCTION check_invitation_org_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_role = 'admin'
     AND (NEW.invited_by IS NULL
          OR COALESCE(org_role(NEW.org_id, NEW.invited_by), '') NOT IN ('owner','admin')) THEN
    RAISE EXCEPTION 'only an org owner or admin may invite with org_role=admin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_check_invitation_org_role ON invitations;
CREATE TRIGGER trg_check_invitation_org_role
  BEFORE INSERT OR UPDATE OF org_role, invited_by, org_id ON invitations
  FOR EACH ROW EXECUTE FUNCTION check_invitation_org_role();

-- ===========================================================================
-- 4. RLS
--
-- The backend reaches these tables through the service role (unaffected by
-- policies). Client policies are deliberately NARROW, per table — "SELECT for
-- members" as a blanket rule would leak invitee emails, audit detail, member
-- spend/caps, and the join code to every student:
--
--   organizations           SELECT: own membership (any status — a suspended
--                           member must still be able to see that they are).
--   workspaces              SELECT: workspace member (explicit or implicit).
--                           Nothing secret lives on this table.
--   organization_members    SELECT: own row, or org owner/admin.
--   workspace_members       SELECT: own row, or workspace admin (implicit
--                           admins included via workspace_role).
--   workspace_join_codes    SELECT: workspace admin only.
--   invitations             SELECT: managing admins, or the invitee (own
--                           email) for the accept flow. Never all members.
--   organization_audit_log  SELECT: org owner/admin only (workspace admins
--                           get a scoped read through the API).
--   ALL writes on all seven service-role only (routes). No client INSERT /
--                           UPDATE / DELETE policy exists, and a guard test
--                           keeps it that way.
-- ===========================================================================

ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_join_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  is_admin()
  OR (status <> 'deleted' AND org_role(id) IS NOT NULL)
);

DROP POLICY IF EXISTS organization_members_select ON organization_members;
CREATE POLICY organization_members_select ON organization_members FOR SELECT USING (
  is_admin()
  OR user_id = (select auth.uid())
  OR org_role(org_id) IN ('owner','admin')
);

DROP POLICY IF EXISTS workspaces_select ON workspaces;
CREATE POLICY workspaces_select ON workspaces FOR SELECT USING (
  is_admin()
  OR workspace_role(id) IS NOT NULL
);

DROP POLICY IF EXISTS workspace_members_select ON workspace_members;
CREATE POLICY workspace_members_select ON workspace_members FOR SELECT USING (
  is_admin()
  OR user_id = (select auth.uid())
  OR workspace_role(workspace_id) = 'admin'
);

DROP POLICY IF EXISTS workspace_join_codes_select ON workspace_join_codes;
CREATE POLICY workspace_join_codes_select ON workspace_join_codes FOR SELECT USING (
  is_admin()
  OR workspace_role(workspace_id) = 'admin'
);

DROP POLICY IF EXISTS invitations_select ON invitations;
CREATE POLICY invitations_select ON invitations FOR SELECT USING (
  is_admin()
  OR org_role(org_id) IN ('owner','admin')
  OR (workspace_id IS NOT NULL AND workspace_role(workspace_id) = 'admin')
  -- invitations.email is stored lower-case; profiles.email is copied verbatim
  -- from the auth provider, so normalize it here.
  OR email = lower((SELECT p.email FROM profiles p WHERE p.id = (select auth.uid())))
);

DROP POLICY IF EXISTS organization_audit_log_select ON organization_audit_log;
CREATE POLICY organization_audit_log_select ON organization_audit_log FOR SELECT USING (
  is_admin()
  OR org_role(org_id) IN ('owner','admin')
);
