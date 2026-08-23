# Organizations

Organizations let a school or a team run on Nodaro Cloud as a group: one
account owns the organization, people belong to it, and the work happens in
**workspaces** — a class, a team — that members share.

> **Availability.** Organizations are a Nodaro Cloud feature and are switched
> on per instance. On an instance where they are not enabled, the endpoints
> below are absent and the [`X-Nodaro-Workspace` header](./api-integration.md#4c-selecting-a-workspace-cloud-organizations)
> is ignored. Self-hosted builds do not include organizations.

## Concepts

| Term | Meaning |
|------|---------|
| **Organization** | The group: a school or a team (`kind`). Has one **owner**, any number of **admins** and **members**, a unique `slug`, and settings that apply to every workspace in it. |
| **Workspace** | Where members work together — a class in a school, a team in a company. Belongs to exactly one organization. Has its own **admins** and **members**, and settings that override the organization's. |
| **Implicit admin** | Organization owners and admins are admins of every workspace in the organization without being listed in it. Adding them to a workspace explicitly gives them that explicit role instead — which is how an organization admin can be made a plain member of one class. |
| **Member status** | `active` or `suspended`, at the organization level and again at the workspace level. A suspended member keeps their seat but cannot act; suspension at the organization level applies everywhere in it. |
| **Organization status** | `pending` (created, awaiting approval), `active`, `suspended` (stopped by the platform), `deleted` (soft-deleted; hidden from its former members). Only an active organization accepts changes. |
| **Approval** | By default a new organization starts `pending` and becomes `active` once the platform approves it. Its owner can see it while it waits; nobody else can, and nothing in it can be changed. |
| **Terms** | Creating a **school** requires accepting the organization terms (`acceptTerms: true`): the owner attests to the authority to enrol students. |

### Roles

| Scope | Roles | What the role allows |
|-------|-------|----------------------|
| Organization | `owner` | Everything an admin can, plus transferring ownership and deleting the organization. Exactly one per organization; cannot be suspended, removed or demoted — ownership moves by transfer. |
| Organization | `admin` | Manage settings, members (except the owner), and workspaces. An admin everywhere in the organization's workspaces. |
| Organization | `member` | Belongs to the organization; sees and works in the workspaces they are added to. |
| Workspace | `admin` | Manage the workspace's settings and members. |
| Workspace | `member` | Works in the workspace. |

### Settings

Settings are layered: a **workspace** override wins over an **organization**
override, which wins over the default for the organization's kind. Unset keys
fall through; setting a key to `false` is a real value, not "unset".

| Key | Type | Meaning |
|-----|------|---------|
| `admin_access` | `view` \| `edit` | What admins may do with a member's workflow. |
| `default_workflow_visibility` | `private` \| `workspace` | The visibility a new workflow gets. |
| `member_access_to_shared` | `view` \| `edit` | What members may do with a workflow shared to the workspace. |
| `members_can_create_projects` | boolean | Whether members may create projects in the workspace. |
| `member_caps_enabled` | boolean | Whether per-member credit caps apply. **Stored now, not yet enforced** — it takes effect when organization billing is enabled, along with `creditCap` on a workspace member. |
| `personal_space_enabled` | boolean | Whether members keep a personal (non-workspace) space. |
| `workspace_admins_can_invite` | boolean | Whether workspace admins may invite new people into the organization. |
| `collaborators_can_invite` | boolean | Whether an editor collaborator may invite further collaborators. |

Organization-only keys: `allowed_email_domains` (lower-case domains, e.g.
`["school.example"]`) and `vocabulary_overrides` (relabel the kind's
vocabulary, e.g. `{ "workspace": "Cohort" }`). Both are replaced wholesale
when updated, never merged.

Defaults by kind — **school**: admins edit, workflows private, members view
shared work, members cannot create projects, caps on, personal space on,
workspace admins can invite, collaborators cannot. **team**: admins view,
workflows visible to the workspace, members edit shared work, members can
create projects, caps off, personal space on, both invite settings on.

## Identity

`GET /v1/me` reports the caller's organizations and workspaces alongside the
profile, each with the caller's own role and status, plus `lastWorkspaceId`.
The organization entries also carry the resolved `vocabulary` for the UI, so
a client never hard-codes "Class" or "Team". `GET /v1/workspaces` returns the
same workspace list on its own.

## Endpoints

All endpoints require authentication. Bodies are JSON; responses are
`{ "data": … }`, list responses `{ "data": [...], "nextCursor": "…" | null }`.
Ids are uuids.

### Organizations

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `POST` | `/v1/orgs` | any signed-in user | `{ name, kind: "school" \| "team", slug?, acceptTerms?, settings? }` — returns `201`; status is `pending` when approval is required. Limited to a few creations per hour per user. |
| `GET` | `/v1/orgs` | — | The caller's organizations with `role` and `memberStatus`. A pending organization is listed for its owner only. |
| `GET` | `/v1/orgs/:id` | member | |
| `PATCH` | `/v1/orgs/:id` | owner, admin | `{ name?, settings? }` — settings merge key by key, then the whole object is re-validated; unknown keys are dropped. |
| `POST` | `/v1/orgs/:id/transfer-ownership` | owner | `{ userId }` — the new owner must be an active admin. Atomic: the old owner becomes an admin in the same step. |
| `DELETE` | `/v1/orgs/:id` | owner | Refused with `409 has_active_workspaces` while any workspace is not archived. Soft-deletes; the slug is freed for reuse. |
| `POST` | `/v1/orgs/:id/leave` | member | The owner cannot leave (`409 owner_cannot_leave`); transfer first. Leaving also removes the caller from every workspace in the organization. |

A slug you **supply** must be free, or the request fails with `409 name_taken`.
Omit it and one is derived from the name (`"Sunrise School"` → `sunrise-school`,
`sunrise-school-2`, …). Slugs are 1–50 lower-case letters, digits and hyphens.

### Organization members

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/orgs/:id/members` | owner, admin | `?limit=50&cursor=…` (max 200). Each row: `userId, role, status, joinedAt, email, displayName, avatarUrl`. |
| `PATCH` | `/v1/orgs/:id/members/:userId` | owner, admin | `{ role?: "admin" \| "member", status?: "active" \| "suspended" }` — the owner's row cannot be changed here. |
| `DELETE` | `/v1/orgs/:id/members/:userId` | owner, admin | Not the owner. Removes the person from every workspace in the organization too. |

### Workspaces

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `POST` | `/v1/orgs/:id/workspaces` | owner, admin | `{ name, slug?, description?, settings? }` — returns `201`. Slugs are unique within the organization. |
| `GET` | `/v1/orgs/:id/workspaces` | member | Members see the workspaces they belong to; owners and admins see all. `?includeArchived=true` adds archived ones. |
| `GET` | `/v1/workspaces` | — | Every workspace the caller belongs to, across organizations. |
| `GET` | `/v1/workspaces/:id` | workspace member | |
| `PATCH` | `/v1/workspaces/:id` | workspace admin | `{ name?, description?, settings? }` |
| `POST` | `/v1/workspaces/:id/archive` | owner, admin | Archived workspaces stay readable; writes into them are refused with `403 workspace_archived`. |
| `POST` | `/v1/workspaces/:id/unarchive` | owner, admin | |

### Workspace members

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/workspaces/:id/members` | workspace member | `?limit&cursor`. Members see `userId, role, displayName, avatarUrl, addedAt`; workspace admins also see `status` and `creditCap`. Email addresses are not on this roster. |
| `POST` | `/v1/workspaces/:id/members` | workspace admin | `{ userId, role: "admin" \| "member" }` — the person must already be an active member of the organization (`400 not_org_member`). |
| `PATCH` | `/v1/workspaces/:id/members/:userId` | workspace admin | `{ role?, status?, creditCap?: number \| null, resetSpend?: boolean }`. `creditCap` is stored now and enforced once budgets are enabled; `resetSpend` is accepted and currently has no effect. |
| `DELETE` | `/v1/workspaces/:id/members/:userId` | workspace admin | Removes the workspace row only; organization membership stays. |

### Invitations

An invitation names one email address. The link carries an unguessable token
that exists only in the email — the API stores its hash — and the person who
follows it sees what they were invited to before signing in.

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `POST` | `/v1/orgs/:id/invitations` | owner, admin — and workspace admins when `workspace_admins_can_invite` is on, into their own workspace only | `{ emails: string[], orgRole?: "admin" | "member", workspaceId?, workspaceRole? }`. Up to 200 addresses per call, lower-cased and de-duplicated. Returns `201` with one row per address: `{ email, status: "sent" | "link_only" | "failed", link? }`. `link` is present whenever the address was not emailed, so the inviter can pass it on. |
| `GET` | `/v1/orgs/:id/invitations` | the same people | `?status=open|accepted|revoked|expired&workspaceId&limit&cursor`. Never returns a token. |
| `DELETE` | `/v1/invitations/:id` | the same people | Revokes; the link stops working. Refused on an invitation that was already accepted. |
| `POST` | `/v1/invitations/:id/resend` | the same people | Issues a **new** token and a new expiry, and sends it again — the previous link stops working. |
| `GET` | `/v1/invitations/by-token/:token` | **public** | What the invitee needs to decide: `{ orgName, kind, vocabulary, inviterName, workspaceName, email (masked), expiresAt, state }`. Rate-limited per IP. |
| `POST` | `/v1/invitations/:token/accept` | the signed-in invitee | The account's email must match the invitation's (`400 email_mismatch`). Joining is atomic; a second acceptance is refused. |

Invitations expire after **14 days**, an organization may create **500 per
day**, and re-inviting an address that already has an open invitation rotates
that invitation onto a fresh token rather than creating a second one.

An invitation to somebody who is already a member is still consumed, but it
does not change their existing role or lift a suspension.

**Email delivery is optional.** An install with `RESEND_API_KEY` and
`EMAIL_FROM` set sends the invitation; without them every address comes back
as `link_only` with its link, and the flow works exactly the same from there.

### Join codes

A join code is eight characters, read aloud in a room. Because it is short it
is bounded: it admits a plain **member** of one workspace, it never lifts a
suspension, and it obeys the organization's `allowed_email_domains`.

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/workspaces/:id/join-code` | workspace admin | `{ code, enabled, rotatedAt, rotatedBy }`, or `null` when no code has been minted. |
| `POST` | `/v1/workspaces/:id/join-code` | workspace admin | `{ action: "rotate" | "enable" | "disable" }`. Enabling a workspace that never had a code mints one; rotating replaces it and the previous code stops working immediately. |
| `POST` | `/v1/workspaces/join` | anyone signed in | `{ code }`. Accepts the spoken forms — `BCDF-GHJK`, lower case, and the letters people mishear (`O` for zero, `I` and `L` for one) are folded. Limited to 10 attempts per minute per account and 30 per minute per IP. |

## Errors

Errors use the standard envelope `{ "error": { "code", "message" } }`; dispatch
on `code`.

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | A field fails validation, a cursor is malformed, or the change is not allowed for that row (for example, editing the owner's membership). |
| 400 | `terms_required` | Creating a school without `acceptTerms: true`. |
| 400 | `not_org_member` | Adding someone to a workspace who is not an active member of its organization. |
| 400 | `token_workspace_mismatch` | A workspace-bound API token used with a header naming another workspace. |
| 401 | `unauthorized` | No valid credentials. |
| 403 | `insufficient_role` | You are a member, but below the role the action needs. |
| 403 | `member_suspended` | Your membership is suspended. |
| 403 | `org_not_active` | The organization is pending or suspended and the action changes something (or you are not its owner and it is pending). |
| 403 | `workspace_archived` | A write into an archived workspace. |
| 403 | `not_a_member` | The `X-Nodaro-Workspace` header names a workspace you cannot select. |
| 404 | `not_found` | No such organization, workspace or member — **or one you are not a member of**. An id route never reveals whether something you cannot see exists. |
| 409 | `name_taken` | The slug you supplied is in use. |
| 409 | `already_a_member` | The person is already in the workspace. |
| 409 | `owner_cannot_leave` | Transfer ownership before leaving. |
| 409 | `has_active_workspaces` | Archive every workspace before deleting the organization. |
| 429 | `rate_limit_exceeded` | Too many organizations created recently, or too many join attempts. |
| 400 | `join_code_invalid` | No such code, the code is disabled, or its workspace is archived — one answer for all three, so a code cannot be used to learn what exists. |
| 400 | `invitation_expired` | The invitation is past its 14 days. |
| 400 | `invitation_revoked` | The invitation was revoked. |
| 400 | `invitation_accepted` | The invitation was already accepted. |
| 400 | `email_mismatch` | The signed-in account's email is not the invited one. |
| 403 | `domain_not_allowed` | The organization only admits listed email domains. |
| 404 | `invitation_not_found` | No invitation for that token — including one whose organization is not active. |
| 429 | `bulk_invite_cap_exceeded` | The organization has reached its daily invitation limit. |

## A first organization, end to end

```bash
# 1. Create a school (pending until approved)
curl -X POST https://app.nodaro.ai/v1/orgs \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Sunrise School","kind":"school","acceptTerms":true}'
# → 201 { "data": { "id": "…", "slug": "sunrise-school", "status": "pending", "role": "owner", … } }

# 2. Once active: open a class
curl -X POST https://app.nodaro.ai/v1/orgs/$ORG/workspaces \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Class 1"}'
# → 201 { "data": { "id": "…", "slug": "class-1", "role": "admin", … } }

# 3. Put a member of the organization into the class
curl -X POST https://app.nodaro.ai/v1/workspaces/$WS/members \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"…","role":"member"}'

# 4. Work inside the class
curl https://app.nodaro.ai/v1/workflows \
  -H "Authorization: Bearer $TOKEN" -H "X-Nodaro-Workspace: $WS"
```

```bash
# 5. Invite a teacher into the class
curl -X POST https://app.nodaro.ai/v1/orgs/$ORG/invitations   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   -d '{"emails":["teacher@school.example"],"workspaceId":"'$WS'","workspaceRole":"admin"}'
# → 201 { "data": [{ "email": "teacher@school.example", "status": "sent" }] }

# 6. Or hand the class a code instead
curl -X POST https://app.nodaro.ai/v1/workspaces/$WS/join-code   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   -d '{"action":"enable"}'
# → 200 { "data": { "code": "BCDFGHJK", "enabled": true, ... } }
```

Budgets, model policy and assignments are documented as they become available.
