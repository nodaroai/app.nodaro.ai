/**
 * `@nodaro/sdk/organizations` — the `organizations` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
// The wire shapes themselves live in @nodaro/shared and are re-exported here
// so an integration needs one dependency, not two.
export {
  OrganizationsResource,
  type CreateOrgInput,
  type InviteInput,
  type ListInvitationsOptions,
} from "../resources/organizations.js"

export type {
  InvitationDelivery,
  InvitationPreview,
  InvitationState,
  InvitationView,
  JoinCodeView,
  MeOrganizations,
  OrganizationSummary,
  OrganizationView,
  OrgAuditEntry,
  OrgErrorCode,
  OrgKind,
  OrgMemberView,
  OrgPage,
  OrgRole,
  OrgSettings,
  OrgStatus,
  MemberStatus,
  UsageGroupBy,
  UsageLogEntry,
  UsageQuery,
  UsageReport,
  UsageReportRow,
  UsageReportTotals,
  UsageVarianceRow,
  WorkspaceMemberView,
  WorkspaceRole,
  WorkspaceSettings,
  WorkspaceSummary,
  WorkspaceView,
} from "@nodaro/shared/organizations"

export { USAGE_GROUP_BYS, WORKSPACE_HEADER } from "@nodaro/shared/organizations"
