import type {
  JoinCodeView,
  MemberStatus,
  OrgPage,
  UsageLogEntry,
  UsageQuery,
  UsageReport,
  WorkspaceMemberView,
  WorkspaceRole,
  WorkspaceSettings,
  WorkspaceSummary,
  WorkspaceView,
} from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Workspaces — the inner tenancy axis, where work actually lives.
 *
 * Selecting a workspace and belonging to one are different things, and this
 * resource is only about the second. Use {@link NodaroClient.withWorkspace}
 * to decide which workspace a REQUEST acts in; these methods read and change
 * the workspaces themselves.
 */

export interface CreateWorkspaceInput {
  name: string
  slug?: string
  description?: string
  settings?: WorkspaceSettings
}

export class WorkspacesResource {
  constructor(private client: NodaroClient) {}

  /**
   * Every workspace this account belongs to, across all its organizations.
   *
   * An identity read: a stale workspace binding cannot lock a caller out of
   * it, which is what makes it safe to call when a selection has gone bad.
   *
   * Byte-for-byte the list `GET /v1/me` carries, so a client reconciles
   * against one truth rather than two. That is why these are SUMMARIES —
   * enough to render a switcher, not the full view; use {@link get} for that.
   */
  list(): Promise<{ data: WorkspaceSummary[]; lastWorkspaceId: string | null }> {
    return this.client.request("GET", "/v1/workspaces")
  }

  listForOrg(orgId: string, opts: { includeArchived?: boolean } = {}): Promise<{ data: WorkspaceView[] }> {
    return this.client.request("GET", `/v1/orgs/${encodeURIComponent(orgId)}/workspaces`, {
      query: { includeArchived: opts.includeArchived },
    })
  }

  get(id: string): Promise<{ data: WorkspaceView }> {
    return this.client.request("GET", `/v1/workspaces/${encodeURIComponent(id)}`)
  }

  create(orgId: string, input: CreateWorkspaceInput): Promise<{ data: WorkspaceView }> {
    return this.client.request("POST", `/v1/orgs/${encodeURIComponent(orgId)}/workspaces`, { body: input })
  }

  update(
    id: string,
    input: { name?: string; description?: string | null; settings?: WorkspaceSettings },
  ): Promise<{ data: WorkspaceView }> {
    return this.client.request("PATCH", `/v1/workspaces/${encodeURIComponent(id)}`, { body: input })
  }

  /**
   * Archive or restore. Archiving is REVERSIBLE and destroys nothing: the
   * workspace stops accepting new work and stays fully readable, which is
   * what a finished class term needs and a delete would not survive.
   */
  setArchived(id: string, archived: boolean): Promise<{ data: WorkspaceView }> {
    return this.client.request(
      "POST",
      `/v1/workspaces/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`,
    )
  }

  // -- members --------------------------------------------------------------

  listMembers(id: string, opts: { cursor?: string; limit?: number } = {}): Promise<OrgPage<WorkspaceMemberView>> {
    return this.client.request("GET", `/v1/workspaces/${encodeURIComponent(id)}/members`, {
      query: { ...opts },
    })
  }

  /** Add someone who is ALREADY in the organization. To bring in a new person, invite them. */
  addMember(id: string, input: { userId: string; role: WorkspaceRole }): Promise<{ data: WorkspaceMemberView }> {
    return this.client.request("POST", `/v1/workspaces/${encodeURIComponent(id)}/members`, { body: input })
  }

  updateMember(
    id: string,
    userId: string,
    input: { role?: WorkspaceRole; status?: MemberStatus; creditCap?: number | null },
  ): Promise<{ data: WorkspaceMemberView }> {
    return this.client.request(
      "PATCH",
      `/v1/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { body: input },
    )
  }

  removeMember(id: string, userId: string): Promise<{ data: { removed: boolean } }> {
    return this.client.request(
      "DELETE",
      `/v1/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    )
  }

  // -- join codes -----------------------------------------------------------

  /** The workspace's join code, or `null` if none has been created. Admins only. */
  getJoinCode(id: string): Promise<{ data: JoinCodeView | null }> {
    return this.client.request("GET", `/v1/workspaces/${encodeURIComponent(id)}/join-code`)
  }

  /**
   * Rotate, enable or disable the code. Rotating invalidates the old one
   * immediately — that is the point of it, and anyone still holding a link
   * with the old code will be refused.
   */
  actOnJoinCode(id: string, action: "rotate" | "enable" | "disable"): Promise<{ data: JoinCodeView }> {
    return this.client.request("POST", `/v1/workspaces/${encodeURIComponent(id)}/join-code`, {
      body: { action },
    })
  }

  /**
   * Join by code. Another way IN, so a stale workspace binding must not block
   * it — the server treats this as an identity route for that reason.
   */
  join(code: string): Promise<{ data: { orgId: string; workspaceId: string } }> {
    return this.client.request("POST", "/v1/workspaces/join", { body: { code } })
  }

  // -- usage ----------------------------------------------------------------

  /**
   * Credits by member, model or day for this workspace. A plain member sees
   * their OWN runs (the report is self-narrowed and `groupBy: "member"` is
   * refused); a workspace admin sees everyone and may filter `userId`.
   * Inclusive dates, IANA `tz` (default UTC), ≤ 366 days (default last 30).
   */
  usage(
    id: string,
    opts: Omit<UsageQuery, "cursor" | "limit" | "workspaceId" | "groupBy"> & { groupBy?: "member" | "model" | "day" } = {},
  ): Promise<{ data: UsageReport }> {
    return this.client.request("GET", `/v1/workspaces/${encodeURIComponent(id)}/usage`, { query: { ...opts } })
  }

  /** The individual runs behind a report, newest first, cursor-paged. */
  usageRows(id: string, opts: Omit<UsageQuery, "groupBy" | "workspaceId"> = {}): Promise<OrgPage<UsageLogEntry>> {
    return this.client.request("GET", `/v1/workspaces/${encodeURIComponent(id)}/usage`, { query: { ...opts, groupBy: "none" } })
  }

  /** The same report (or the rows, with `groupBy: "none"`) as CSV text. */
  usageCsv(id: string, opts: Omit<UsageQuery, "cursor" | "limit" | "workspaceId"> = {}): Promise<string> {
    return this.client.requestText("GET", `/v1/workspaces/${encodeURIComponent(id)}/usage`, { query: { ...opts, format: "csv" } })
  }
}
