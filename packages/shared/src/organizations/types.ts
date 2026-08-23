import { z } from "zod"

/**
 * Organizations — wire contract for the second tenancy axis
 * (Organization -> Workspace -> Member).
 *
 * Lives in @nodaro/shared because SDK/MCP consumers need these enums, the
 * request schemas the API validates, and the error codes it returns. This
 * package carries the CONTRACT ONLY — no resolution logic, no presets, no
 * vocabulary, no access rule. Those are server-side.
 */

/**
 * Selects which workspace a request LISTS from and CREATES into. It never
 * authorizes: reading, updating, deleting or running an identified object is
 * decided by that object's own workspace, so a forgotten or forged header can
 * neither widen access nor move a charge.
 *
 * Fastify lower-cases incoming header keys, hence the second constant — read
 * `req.headers[WORKSPACE_HEADER_LOWER]`, send `WORKSPACE_HEADER`.
 */
export const WORKSPACE_HEADER = "X-Nodaro-Workspace"
export const WORKSPACE_HEADER_LOWER = "x-nodaro-workspace"

export const ORG_KINDS = ["school", "team"] as const
export type OrgKind = (typeof ORG_KINDS)[number]

export const ORG_ROLES = ["owner", "admin", "member"] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export const WORKSPACE_ROLES = ["admin", "member"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const MEMBER_STATUSES = ["active", "suspended"] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

/** `pending` = created, awaiting platform-admin approval. */
export const ORG_STATUSES = ["pending", "active", "suspended", "deleted"] as const
export type OrgStatus = (typeof ORG_STATUSES)[number]

/** An explicit per-workflow grant (works for personal workflows too). */
export const COLLABORATOR_ROLES = ["editor", "viewer"] as const
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number]

export const WORKFLOW_VISIBILITIES = ["private", "workspace"] as const
export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number]

/** What an identity may do with a workflow, strongest first. */
export const ACCESS_LEVELS = ["own", "edit", "view", "none"] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/** The access a setting may grant to a non-creator. */
export const GRANTED_ACCESS = ["view", "edit"] as const
export type GrantedAccess = (typeof GRANTED_ACCESS)[number]

export const SUBMISSION_STATUSES = ["submitted", "in_review", "returned", "approved"] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/**
 * Error codes the organization endpoints add to the standard envelope
 * (`{ error: { code, message } }`). Clients dispatch on the code, never on
 * the message text.
 */
export const ORG_ERROR_CODES = [
  "not_a_member",
  "insufficient_role",
  "org_not_active",
  "member_suspended",
  "workspace_archived",
  "personal_space_disabled",
  "token_workspace_mismatch",
  "run_requires_authenticated_member",
  "budget_exceeded",
  "member_cap_exceeded",
  "model_not_allowed",
  "invitation_expired",
  "invitation_revoked",
  "email_mismatch",
  "join_code_invalid",
  "domain_not_allowed",
  "already_started",
  "collab_unavailable",
  // Organization, workspace and membership endpoints.
  "terms_required",
  "not_org_member",
  "already_a_member",
  "owner_cannot_leave",
  "has_active_workspaces",
  // Invitations and join codes.
  "invitation_not_found",
  "invitation_accepted",
  "bulk_invite_cap_exceeded",
] as const
export type OrgErrorCode = (typeof ORG_ERROR_CODES)[number]

/**
 * The settings every organization kind has a default for. `organizations.
 * settings` and `workspaces.settings` store PARTIAL overrides of this shape;
 * `resolveEffectiveSettings` (./settings.ts) produces the full one.
 */
export const PresetSettingsSchema = z.object({
  /** What org/workspace admins may do with a member's workflow. */
  admin_access: z.enum(GRANTED_ACCESS),
  default_workflow_visibility: z.enum(WORKFLOW_VISIBILITIES),
  /** What a plain member may do with a `visibility = workspace` workflow. */
  member_access_to_shared: z.enum(GRANTED_ACCESS),
  members_can_create_projects: z.boolean(),
  member_caps_enabled: z.boolean(),
  /** Whether members keep a personal (non-workspace) space at all. */
  personal_space_enabled: z.boolean(),
  /** Whether a workspace admin may invite NEW people into the org. */
  workspace_admins_can_invite: z.boolean(),
  /** Whether an editor collaborator may invite further collaborators. */
  collaborators_can_invite: z.boolean(),
})
export type PresetSettings = z.infer<typeof PresetSettingsSchema>
export type PresetSettingKey = keyof PresetSettings
export const PRESET_SETTING_KEYS = Object.freeze(
  Object.keys(PresetSettingsSchema.shape) as readonly PresetSettingKey[],
)

/** `workspaces.settings` — per-workspace overrides only. */
export const WorkspaceSettingsSchema = PresetSettingsSchema.partial()
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>

const EMAIL_DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** `organizations.settings` — preset overrides plus org-only keys. */
export const OrgSettingsSchema = PresetSettingsSchema.partial().extend({
  /** Lower-case domains that join codes / domain auto-join accept. Empty = any. */
  allowed_email_domains: z.array(z.string().regex(EMAIL_DOMAIN_PATTERN)).optional(),
  /** Per-org relabelling of the kind vocabulary (./vocabulary.ts). */
  vocabulary_overrides: z.record(z.string(), z.string()).optional(),
})
export type OrgSettings = z.infer<typeof OrgSettingsSchema>
