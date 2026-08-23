import type {
  MemberStatus,
  OrgKind,
  OrgRole,
  OrgSettings,
  OrgStatus,
  WorkspaceRole,
  WorkspaceSettings,
} from "@nodaro/shared"
import { getAuthHeaders } from "@/lib/api"

/**
 * The organization endpoints, typed.
 *
 * A thin client and nothing more: every decision — who may do what, which
 * refusal applies — belongs to the server, and this file must not
 * anticipate any of it. What it does own is the shape of the wire and the
 * one place a failure becomes an `OrgApiError` carrying the code the UI
 * dispatches on.
 *
 * Errors are NOT routed through the core `throwApiError`: these are the
 * organization codes, the UI branches on them (an expired invitation is a
 * state to render, not a toast), and the core thrower would flatten them
 * into a plain Error whose message is all a caller could inspect.
 */

export class OrgApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "OrgApiError"
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = await getAuthHeaders()
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null
  if (!res.ok) {
    const error = payload?.error
    throw new OrgApiError(error?.code ?? "internal_error", error?.message ?? "Something went wrong", res.status)
  }
  return payload?.data as T
}

/**
 * The public preview — deliberately WITHOUT auth headers. The invitee is
 * signed out when they follow the link, and sending a stale session's token
 * (or a workspace header they no longer hold) could only make the request
 * worse, never better.
 */
async function publicRequest<T>(path: string): Promise<T> {
  const res = await fetch(path)
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null
  if (!res.ok) {
    const error = payload?.error
    throw new OrgApiError(error?.code ?? "internal_error", error?.message ?? "Something went wrong", res.status)
  }
  return payload?.data as T
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

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
  role?: OrgRole
  memberStatus?: MemberStatus
}

export interface CreateOrgInput {
  name: string
  kind: OrgKind
  slug?: string
  acceptTerms?: boolean
  settings?: OrgSettings
}

export const listOrganizations = () => request<OrganizationView[]>("/v1/orgs")
export const getOrganization = (id: string) => request<OrganizationView>(`/v1/orgs/${id}`)
export const createOrganization = (body: CreateOrgInput) => request<OrganizationView>("/v1/orgs", { method: "POST", body })
export const updateOrganization = (id: string, body: { name?: string; settings?: OrgSettings }) =>
  request<OrganizationView>(`/v1/orgs/${id}`, { method: "PATCH", body })
export const transferOwnership = (id: string, userId: string) =>
  request<{ orgId: string; ownerUserId: string }>(`/v1/orgs/${id}/transfer-ownership`, { method: "POST", body: { userId } })
export const deleteOrganization = (id: string) =>
  request<{ id: string; status: string }>(`/v1/orgs/${id}`, { method: "DELETE" })
export const leaveOrganization = (id: string) =>
  request<{ orgId: string; left: boolean }>(`/v1/orgs/${id}/leave`, { method: "POST" })

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface OrgMemberView {
  userId: string
  role: OrgRole
  status: MemberStatus
  joinedAt: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface Page<T> {
  data: T[]
  nextCursor: string | null
}

/** Paged reads return the envelope itself — the cursor is part of the answer. */
async function requestPage<T>(path: string): Promise<Page<T>> {
  const headers = await getAuthHeaders()
  const res = await fetch(path, { headers })
  const payload = (await res.json().catch(() => null)) as
    | { data?: T[]; nextCursor?: string | null; error?: { code?: string; message?: string } }
    | null
  if (!res.ok) {
    const error = payload?.error
    throw new OrgApiError(error?.code ?? "internal_error", error?.message ?? "Something went wrong", res.status)
  }
  return { data: payload?.data ?? [], nextCursor: payload?.nextCursor ?? null }
}

export const listOrgMembers = (orgId: string, opts: { cursor?: string; limit?: number } = {}) =>
  requestPage<OrgMemberView>(`/v1/orgs/${orgId}/members${query(opts)}`)
export const updateOrgMember = (orgId: string, userId: string, body: { role?: "admin" | "member"; status?: MemberStatus }) =>
  request<OrgMemberView>(`/v1/orgs/${orgId}/members/${userId}`, { method: "PATCH", body })
export const removeOrgMember = (orgId: string, userId: string) =>
  request<{ removed: boolean }>(`/v1/orgs/${orgId}/members/${userId}`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

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
  role?: WorkspaceRole
  memberStatus?: MemberStatus
}

export const listOrgWorkspaces = (orgId: string, includeArchived = false) =>
  request<WorkspaceView[]>(`/v1/orgs/${orgId}/workspaces${includeArchived ? "?includeArchived=true" : ""}`)
export const getWorkspace = (id: string) => request<WorkspaceView>(`/v1/workspaces/${id}`)
export const createWorkspace = (
  orgId: string,
  body: { name: string; slug?: string; description?: string; settings?: WorkspaceSettings },
) => request<WorkspaceView>(`/v1/orgs/${orgId}/workspaces`, { method: "POST", body })
export const updateWorkspace = (
  id: string,
  body: { name?: string; description?: string | null; settings?: WorkspaceSettings },
) => request<WorkspaceView>(`/v1/workspaces/${id}`, { method: "PATCH", body })
export const setWorkspaceArchived = (id: string, archived: boolean) =>
  request<WorkspaceView>(`/v1/workspaces/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" })

export interface WorkspaceMemberView {
  userId: string
  role: WorkspaceRole
  displayName: string | null
  avatarUrl: string | null
  addedAt: string
  /** Workspace admins only. */
  status?: MemberStatus
  creditCap?: number | null
}

export const listWorkspaceMembers = (id: string, opts: { cursor?: string; limit?: number } = {}) =>
  requestPage<WorkspaceMemberView>(`/v1/workspaces/${id}/members${query(opts)}`)
export const addWorkspaceMember = (id: string, body: { userId: string; role: WorkspaceRole }) =>
  request<WorkspaceMemberView>(`/v1/workspaces/${id}/members`, { method: "POST", body })
export const updateWorkspaceMember = (
  id: string,
  userId: string,
  body: { role?: WorkspaceRole; status?: MemberStatus; creditCap?: number | null },
) => request<WorkspaceMemberView>(`/v1/workspaces/${id}/members/${userId}`, { method: "PATCH", body })
export const removeWorkspaceMember = (id: string, userId: string) =>
  request<{ removed: boolean }>(`/v1/workspaces/${id}/members/${userId}`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

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
 * One row per address. `link` is present whenever the address was NOT
 * emailed — an install without a mail provider, or a delivery that failed —
 * and the UI must surface it, or the invitation exists and nobody can reach
 * it.
 */
export interface InvitationDelivery {
  email: string
  status: "sent" | "link_only" | "failed"
  link?: string
}

export const createInvitations = (
  orgId: string,
  body: { emails: string[]; orgRole?: "admin" | "member"; workspaceId?: string; workspaceRole?: WorkspaceRole },
) => request<InvitationDelivery[]>(`/v1/orgs/${orgId}/invitations`, { method: "POST", body })

export const listInvitations = (
  orgId: string,
  opts: { status?: InvitationState; workspaceId?: string; cursor?: string; limit?: number } = {},
) => requestPage<InvitationView>(`/v1/orgs/${orgId}/invitations${query(opts)}`)

export const revokeInvitation = (id: string) =>
  request<{ id: string; revoked: boolean }>(`/v1/invitations/${id}`, { method: "DELETE" })
export const resendInvitation = (id: string) =>
  request<InvitationDelivery & { id: string }>(`/v1/invitations/${id}/resend`, { method: "POST" })

/** What an invitee sees before signing in. The address comes back masked. */
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

export const previewInvitation = (token: string) =>
  publicRequest<InvitationPreview>(`/v1/invitations/by-token/${encodeURIComponent(token)}`)

export const acceptInvitation = (token: string) =>
  request<{ orgId: string; workspaceId: string | null }>(`/v1/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  })

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

export interface JoinCodeView {
  code: string
  enabled: boolean
  rotatedAt: string
  rotatedBy: string | null
}

export const getJoinCode = (workspaceId: string) => request<JoinCodeView | null>(`/v1/workspaces/${workspaceId}/join-code`)
export const actOnJoinCode = (workspaceId: string, action: "rotate" | "enable" | "disable") =>
  request<JoinCodeView>(`/v1/workspaces/${workspaceId}/join-code`, { method: "POST", body: { action } })
export const joinByCode = (code: string) =>
  request<{ orgId: string; workspaceId: string }>("/v1/workspaces/join", { method: "POST", body: { code } })

// ---------------------------------------------------------------------------

function query(opts: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== "") params.set(key, String(value))
  }
  const s = params.toString()
  return s ? `?${s}` : ""
}
