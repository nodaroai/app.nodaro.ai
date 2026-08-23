import type {
  InvitationDelivery,
  InvitationPreview,
  InvitationState,
  InvitationView,
  MemberStatus,
  OrganizationView,
  OrgKind,
  OrgAuditEntry,
  OrgMemberView,
  OrgPage,
  OrgRole,
  OrgSettings,
  WorkspaceRole,
} from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Organizations, their members, and the invitations that fill them.
 *
 * Every shape here comes from `@nodaro/shared` rather than being restated:
 * the app, the CLI and this SDK all read the same wire, and a shape written
 * out three times is one that drifts in two of them.
 *
 * Nothing in this file decides anything. Whether a caller may invite, remove
 * or rename is the server's answer, delivered as a typed error code, and an
 * SDK that guessed would be wrong the first time a setting changed.
 */

export interface CreateOrgInput {
  name: string
  kind: OrgKind
  /** Derived from the name when omitted; the server resolves collisions. */
  slug?: string
  acceptTerms?: boolean
  settings?: OrgSettings
}

export interface InviteInput {
  emails: string[]
  orgRole?: "admin" | "member"
  /** Also places the invitee in this workspace on accept. */
  workspaceId?: string
  workspaceRole?: WorkspaceRole
}

export interface ListInvitationsOptions {
  status?: InvitationState
  workspaceId?: string
  cursor?: string
  limit?: number
}

export class OrganizationsResource {
  constructor(private client: NodaroClient) {}

  /** The organizations this account belongs to. */
  list(): Promise<{ data: OrganizationView[] }> {
    return this.client.request("GET", "/v1/orgs")
  }

  get(id: string): Promise<{ data: OrganizationView }> {
    return this.client.request("GET", `/v1/orgs/${encodeURIComponent(id)}`)
  }

  /**
   * Create an organization. On instances that require it, `acceptTerms` must
   * be true or the server answers `terms_required` — the SDK does not decide
   * whether terms apply, because only the instance knows.
   *
   * A new organization may come back `pending`: some instances hold new
   * organizations for a platform admin to approve, and a pending one grants
   * nothing until it is active.
   */
  create(input: CreateOrgInput): Promise<{ data: OrganizationView }> {
    return this.client.request("POST", "/v1/orgs", { body: input })
  }

  update(id: string, input: { name?: string; settings?: OrgSettings }): Promise<{ data: OrganizationView }> {
    return this.client.request("PATCH", `/v1/orgs/${encodeURIComponent(id)}`, { body: input })
  }

  /** Soft-delete. The organization stops granting context; nothing is destroyed. */
  delete(id: string): Promise<{ data: { id: string; status: string } }> {
    return this.client.request("DELETE", `/v1/orgs/${encodeURIComponent(id)}`)
  }

  /** Hand the organization to another member. The caller becomes an admin. */
  transferOwnership(id: string, userId: string): Promise<{ data: { orgId: string; ownerUserId: string } }> {
    return this.client.request("POST", `/v1/orgs/${encodeURIComponent(id)}/transfer-ownership`, {
      body: { userId },
    })
  }

  /** Leave. An owner cannot — transfer ownership first (`owner_cannot_leave`). */
  leave(id: string): Promise<{ data: { orgId: string; left: boolean } }> {
    return this.client.request("POST", `/v1/orgs/${encodeURIComponent(id)}/leave`)
  }

  // -- members --------------------------------------------------------------

  listMembers(orgId: string, opts: { cursor?: string; limit?: number } = {}): Promise<OrgPage<OrgMemberView>> {
    return this.client.request("GET", `/v1/orgs/${encodeURIComponent(orgId)}/members`, { query: { ...opts } })
  }

  updateMember(
    orgId: string,
    userId: string,
    input: { role?: "admin" | "member"; status?: MemberStatus },
  ): Promise<{ data: OrgMemberView }> {
    return this.client.request(
      "PATCH",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { body: input },
    )
  }

  removeMember(orgId: string, userId: string): Promise<{ data: { removed: boolean } }> {
    return this.client.request(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    )
  }

  // -- invitations ----------------------------------------------------------

  /**
   * Invite by email. Returns ONE ROW PER ADDRESS, and a row whose `status` is
   * not `sent` carries a `link` instead.
   *
   * Surface that link. An install with no mail provider — every fresh
   * self-host — delivers nothing, and an integration that reports "invited"
   * without showing the link creates invitations nobody can ever reach.
   */
  invite(orgId: string, input: InviteInput): Promise<{ data: InvitationDelivery[] }> {
    return this.client.request("POST", `/v1/orgs/${encodeURIComponent(orgId)}/invitations`, { body: input })
  }

  listInvitations(orgId: string, opts: ListInvitationsOptions = {}): Promise<OrgPage<InvitationView>> {
    return this.client.request("GET", `/v1/orgs/${encodeURIComponent(orgId)}/invitations`, {
      query: { ...opts },
    })
  }

  revokeInvitation(id: string): Promise<{ data: { id: string; revoked: boolean } }> {
    return this.client.request("DELETE", `/v1/invitations/${encodeURIComponent(id)}`)
  }

  resendInvitation(id: string): Promise<{ data: InvitationDelivery & { id: string } }> {
    return this.client.request("POST", `/v1/invitations/${encodeURIComponent(id)}/resend`)
  }

  /**
   * What an invitee sees before signing in — the one organization read that
   * needs no token, so it works while the recipient is still signed out.
   */
  previewInvitation(token: string): Promise<{ data: InvitationPreview }> {
    return this.client.request("GET", `/v1/invitations/by-token/${encodeURIComponent(token)}`)
  }

  /** Accept. Requires an authenticated caller whose email matches the invite. */
  acceptInvitation(token: string): Promise<{ data: { orgId: string; workspaceId: string | null } }> {
    return this.client.request("POST", `/v1/invitations/${encodeURIComponent(token)}/accept`)
  }

  // -- audit ----------------------------------------------------------------

  /**
   * The organization's audit log, newest first. Owner and admins only, and
   * readable while the organization is suspended — the record of what
   * happened is exactly what someone needs when things have gone wrong.
   */
  audit(
    orgId: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<OrgPage<OrgAuditEntry>> {
    return this.client.request("GET", `/v1/orgs/${encodeURIComponent(orgId)}/audit`, { query: { ...opts } })
  }
}

export type { OrgAuditEntry, OrgRole }
