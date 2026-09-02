import type {
  MemberStatus,
  OrgKind,
  OrgRole,
  OrgSettings,
  OrgStatus,
  UsageGroupBy,
  WorkspaceRole,
  WorkspaceSettings,
} from "./types.js"

/**
 * What the organization endpoints RETURN.
 *
 * `types.ts` carries what a client must send and the codes it must dispatch
 * on; this carries the other half of the same wire contract — the shapes that
 * come back. It lives here for the same reason: the SDK, the CLI, the app and
 * any third-party integration all read these, and a shape described in three
 * places is a shape that drifts in two of them.
 *
 * CONTRACT ONLY, like its sibling. There is no resolution logic here, no
 * access rule, no vocabulary — a view names fields, it does not decide who
 * may see them. Fields the server omits for a caller without the standing to
 * see them are OPTIONAL here rather than nullable: absent means "not for
 * you", `null` means "genuinely unset", and a client that cannot tell those
 * apart will render the wrong thing.
 */

export interface OrganizationView {
  id: string
  slug: string
  name: string
  kind: OrgKind
  status: OrgStatus
  ownerUserId: string
  settings: OrgSettings
  termsAcceptedAt: string | null
  createdAt: string
  updatedAt: string
  /** The CALLER's role. Absent on a read that did not establish membership. */
  role?: OrgRole
  memberStatus?: MemberStatus
}

export interface OrgMemberView {
  userId: string
  role: OrgRole
  status: MemberStatus
  joinedAt: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface WorkspaceView {
  id: string
  orgId: string
  name: string
  slug: string
  description: string | null
  settings: WorkspaceSettings
  defaultProjectId: string | null
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** The CALLER's role. Absent on a read that did not establish membership. */
  role?: WorkspaceRole
  memberStatus?: MemberStatus
}

export interface WorkspaceMemberView {
  userId: string
  role: WorkspaceRole
  displayName: string | null
  avatarUrl: string | null
  addedAt: string
  /** Workspace admins only — absent for a plain member's read. */
  status?: MemberStatus
  creditCap?: number | null
}

/** Where an invitation stands. `expired` is derived from `expiresAt`, not stored. */
export type InvitationState = "open" | "accepted" | "revoked" | "expired"

export interface InvitationView {
  id: string
  orgId: string
  workspaceId: string | null
  email: string
  orgRole: OrgRole
  workspaceRole: WorkspaceRole | null
  invitedBy: string | null
  state: InvitationState
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
}

/**
 * One row per address a create/resend was asked for.
 *
 * `link` is present whenever the address was NOT emailed — an install with no
 * mail provider, or a delivery that failed. A client MUST surface it: the
 * invitation exists either way, and without the link nobody can reach it.
 */
export interface InvitationDelivery {
  email: string
  status: "sent" | "link_only" | "failed"
  link?: string
}

/**
 * What an invitee sees BEFORE signing in — the one organization read that
 * needs no token. `email` comes back masked, so the invitee can recognise
 * their own address without the link disclosing it to whoever holds it.
 */
export interface InvitationPreview {
  orgName: string
  kind: OrgKind
  vocabulary: Record<string, string>
  inviterName: string | null
  workspaceName: string | null
  email: string
  expiresAt: string
  state: InvitationState
}

export interface JoinCodeView {
  code: string
  enabled: boolean
  rotatedAt: string
  rotatedBy: string | null
}

/**
 * What `GET /v1/me` reports about the caller's memberships.
 *
 * Deliberately a SUMMARY, not the full views above: this is the payload every
 * client loads on every session start, and it answers one question — what am
 * I a member of, and what may I call each thing. Names, roles, and the
 * resolved vocabulary are here because a switcher cannot render without them;
 * descriptions, timestamps and default projects are not, because a switcher
 * never shows them and `GET /v1/orgs/:id` exists.
 *
 * The settings block is narrowed to the three keys a CLIENT can act on. The
 * rest of an organization's settings are enforced server-side, and shipping
 * them here would invite a client to enforce them badly.
 */
export interface OrganizationSummary {
  id: string
  slug: string
  name: string
  kind: OrgKind
  status: OrgStatus
  /** The caller's own role and standing — always present in this payload. */
  role: OrgRole
  memberStatus: MemberStatus
  settings: {
    personal_space_enabled: boolean
    allowed_email_domains: string[]
    vocabulary_overrides: Record<string, string>
  }
  /** Resolved labels, so no client hard-codes "Class" or "Team". */
  vocabulary: Record<string, string>
}

export interface WorkspaceSummary {
  id: string
  orgId: string
  name: string
  slug: string
  role: WorkspaceRole
  memberStatus: MemberStatus
  archived: boolean
}

/**
 * The organizations block on `GET /v1/me`.
 *
 * THREE distinct states, and a client that collapses them is wrong in a way
 * users feel: the fields ABSENT means this install has no organizations at
 * all; present and empty means the account belongs to none; and
 * `organizationsUnavailable` means the lookup FAILED — in which case a
 * client must KEEP whatever selection it already had, because telling someone
 * their school vanished during a cache blip is worse than a stale switcher.
 */
export interface MeOrganizations {
  organizations?: OrganizationSummary[]
  workspaces?: WorkspaceSummary[]
  lastWorkspaceId?: string | null
  organizationsUnavailable?: boolean
}

/**
 * One recorded action in an organization's audit log.
 *
 * `action` is an OPEN vocabulary and a client must not exhaust it: new
 * actions are added as the product grows, and a switch that throws on an
 * unknown one turns a new feature into a broken page. Render what you
 * recognise, fall back to the raw string for the rest.
 *
 * `actor` is null for anything the system did on nobody's behalf.
 */
export interface OrgAuditEntry {
  id: string
  workspaceId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, unknown>
  createdAt: string
  actor: { userId: string; displayName: string | null; email: string | null } | null
}

/** A cursor-paged read. The cursor is part of the answer, not a side channel. */
export interface OrgPage<T> {
  data: T[]
  nextCursor: string | null
}

/**
 * Usage reporting. What `GET /v1/orgs/:id/usage` and
 * `GET /v1/workspaces/:id/usage` return. No cost/USD field appears anywhere —
 * a report shows CREDITS a class or team spent, never the platform's own rates
 * (pricing-leak class, guarded by organizations-types.test.ts and the
 * migration guard).
 */

/** One bucket of a usage report. Exactly one of workspace/member/model/day is set. */
export interface UsageReportRow {
  key: string
  workspace: { id: string; name: string | null; slug: string | null; archived: boolean } | null
  member: { userId: string; displayName: string | null; email: string | null } | null
  model: string | null
  /** `YYYY-MM-DD` in the report's `tz`. */
  day: string | null
  runCount: number
  appRunCount: number
  /** Settled where known, the held reservation otherwise. = settledCredits + inFlightCredits. */
  credits: number
  settledCredits: number
  inFlightCredits: number
  inFlightRuns: number
}

/**
 * A platform-absorbed line for one workspace, split by ORIGIN (never attributed
 * to a member). Two ledgers share the `org_usage_variance` source: a
 * `metered_overrun` (a metered run's overrun beyond the budget — it HAS a
 * settled usage_logs counterpart) and an `app_markup` shortfall (an
 * approved-app markup the budget could not cover — it has NO usage_logs row).
 * `other` is a future/unrecognised origin.
 */
export interface UsageVarianceRow {
  workspace: { id: string; name: string | null; slug: string | null } | null
  kind: "metered_overrun" | "app_markup" | "other"
  credits: number
  rowCount: number
}

/**
 * Totals over the WHOLE window — every usage_logs row in [from, to] after the
 * scope / userId / workspaceId narrowing — never over the returned `rows`.
 * Unaffected by `truncated`; equals a `groupBy=day` report's column-wise sum.
 */
export interface UsageReportTotals {
  runCount: number
  credits: number
  settledCredits: number
  inFlightCredits: number
  /** Metered-overrun variance in the window — a run's overrun the platform absorbed. */
  platformAbsorbedCredits: number
  /** Approved-app markup shortfall the platform absorbed. It has NO usage_logs run, so it is not in the figures above. */
  appMarkupAbsorbedCredits: number
  /**
   * settledCredits − platformAbsorbedCredits: the METERED settlement that
   * reached the workspace budget(s). App markup charged to a budget (migration
   * 352) is not a usage_logs row and is not included here; when a markup
   * shortfall is absorbed this figure under-reports and may go negative — it is
   * NOT `workspace_budgets.spent_credits`.
   */
  chargedToBudget: number
}

export interface UsageReport {
  scope: "org" | "workspace"
  scopeId: string
  from: string
  to: string
  tz: string
  groupBy: Exclude<UsageGroupBy, "none">
  /** Present when a member's self-view or an admin's `?userId=` narrowed the report. */
  userId: string | null
  /** Present when an org report was narrowed to one workspace. */
  workspaceId: string | null
  rows: UsageReportRow[]
  variance: UsageVarianceRow[]
  totals: UsageReportTotals
  /**
   * True when more than 5000 buckets existed and the tail of `rows` was dropped
   * — narrow the window. Only `rows` is incomplete; `totals` and `variance`
   * cover the whole window regardless.
   */
  truncated: boolean
}

/** One usage_logs row as an organization sees it. No cost fields, ever. */
export interface UsageLogEntry {
  id: string
  createdAt: string
  workspace: { id: string; name: string | null; slug: string | null } | null
  member: { userId: string; displayName: string | null; email: string | null } | null
  jobId: string | null
  model: string
  status: "reserved" | "committed"
  creditsReserved: number
  creditsSettled: number | null
  credits: number
  isAppRun: boolean
}

/** Query parameters shared by both usage routes (dates inclusive, IANA tz). */
export interface UsageQuery {
  from?: string
  to?: string
  tz?: string
  groupBy?: UsageGroupBy
  workspaceId?: string
  userId?: string
  cursor?: string
  limit?: number
}
