---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Organizations reach the SDK.

`@nodaro/shared` gains the RESPONSE half of the organization wire contract — `OrganizationView`, `OrgMemberView`, `WorkspaceView`, `WorkspaceMemberView`, `InvitationView`, `InvitationDelivery`, `InvitationPreview`, `JoinCodeView`, `OrgAuditEntry`, `OrgPage<T>`, and the `OrganizationSummary` / `WorkspaceSummary` / `MeOrganizations` shapes `GET /v1/me` carries. Contract only: no resolution logic, no access rules, no vocabulary.

`@nodaro/sdk` gains `client.organizations` and `client.workspaces` covering organizations, members, workspaces, invitations, join codes and the audit log, plus `createClient({ workspaceId })` and `client.withWorkspace(id)` — which returns a NEW client rather than mutating a shared one, so two concurrent operations cannot race over which workspace they are in. `client.me()` is now typed to carry the organizations block, keeping its three states distinct: the fields absent (this instance has no organizations), present and empty (you belong to none), and `organizationsUnavailable` (the lookup failed — keep the selection you had).

The workspace header decides SCOPE, never ACCESS: it selects which workspace a list reads from and where a create lands, and cannot widen access or move a charge.
