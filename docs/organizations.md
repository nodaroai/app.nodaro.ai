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
| `member_caps_enabled` | boolean | Whether per-member credit caps apply. Enforced at reserve time once workspace-paid runs roll out (the payer-selection stage of the organizations feature), together with `creditCap` on the workspace member. |
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

### Workflow collaborators

A grant gives one person access to one workflow. It is a **floor**: it can
only add access, never take it away, so a `viewer` grant handed to someone
who could already edit the workflow changes nothing.

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/workflows/:id/collaborators` | anyone who may view the workflow | Rows of `{ userId, name, avatarUrl, role, createdAt }`. **Never an email address** — this list is readable by someone granted a look at this one workflow and belonging to nothing else. |
| `POST` | `/v1/workflows/:id/collaborators` | see below | `{ userId }` **or** `{ email }` — exactly one — plus `role: "viewer" \| "editor"`. Returns `201`. Limited to 20 additions per minute per account. |
| `PATCH` | `/v1/workflows/:id/collaborators/:userId` | same as `POST` | `{ role }`. |
| `DELETE` | `/v1/workflows/:id/collaborators/:userId` | same as `POST`, **or yourself** | Leaving is always yours to do: nobody has to ask permission to stop having access. |

**Who may share.** The creator always; a workspace admin where `admin_access`
is `edit`; and anyone else who may edit the workflow where the workspace's
`collaborators_can_invite` is on — off in a school by default, on in a team.
Deliberately *not* "anyone who may edit": changing a piece of work and
deciding who else sees it are different powers.

**Adding by email** matches any address with an account, whatever
organization it belongs to — a class often needs to include someone who is
not in it yet. The address is matched case-insensitively. `404` means no
account; nothing else is disclosed about it.

**A non-member of the workspace is capped at `view`**, editor grant or not:
one person sharing the class's work cannot hand an outsider the ability to
change it. Running is stricter still and needs active membership, so an
outside collaborator can edit the canvas and never spend the class's credits.

An **archived** workspace refuses `POST` and `PATCH` with `403
workspace_archived` — a frozen workspace takes no new sharing. Removing
somebody still works.

You cannot grant to the workflow's creator (they own it) or to yourself
(you already have access, and a grant would outlive the role that allowed
you to write it). Both answer `400`.

A grant takes effect the moment it is written — there is no acceptance step.
The recipient finds the workflow under **Shared with me** (below), and it
also turns up in their search, the same as anything else they can open.

### Work shared with me

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/workflows/shared-with-me` | anyone signed in | Workflows the caller holds a grant on, each with the `grantedRole` that reaches it. Newest first, up to 200. |

Only work that is **not** in a workspace you belong to. Anything shared with
the whole workspace already appears in that workspace's own lists, and
listing it twice would make "shared with me" the less true of the two labels.

### Reaching one workflow

Every by-id workflow route asks one question — what may this person do with
this workflow — and enforces the answer:

| Route | Needs |
|-------|-------|
| `GET /v1/workflows/:id` | `view`. The response carries the caller's own `access`, so an editor opening a workflow they may only read gets a read-only canvas without asking twice. |
| `GET /v1/workflows/:id/access` | `view`. Just the answer — `{ access, workspaceId, visibility, canChangeVisibility }` and never the graph, for a client that already has the workflow and only needs to know what it may do with it. |
| `GET /v1/workflows/:id/export` | `view`. Bundled assets (`?assets=true`) stay scoped to the CALLER: being allowed to read a workflow is not being allowed to walk out with the characters and locations behind it, so a shared export comes back with the graph and without them. |
| `GET /v1/workflows/:id/interface` | `view` |
| `PATCH /v1/workflows/:id` | `edit` |
| `POST /v1/workflows/:parentId/sub-workflows` | `edit` on the parent |
| `POST /v1/workflow-triggers` | the same bar as running — a trigger IS a run, just an unattended one. Every fire re-checks that its owner may still run the workflow, and a trigger whose owner has lost access deactivates itself. |
| `POST /v1/workflows/:id/run` | `edit` **and** active membership when the workflow belongs to a workspace |
| `POST /v1/apps/publish`, `POST /v1/templates/publish` | `own` **and** authorship. Publishing is a disclosure decision, not an edit — and `own` alone does not mean "the creator", so both are required. |
| `PATCH /v1/workflows/:id { settings }` | `edit`, except when the write would change `settings.studio.shared` — the opt-in that makes a workflow readable by `GET /v1/public/workflows/:id` with no auth. That is an audience decision and takes the same authority as `visibility`. |
| `DELETE /v1/workflows/:id` | creator, workspace admin, or platform admin — **never a collaborator**, whatever their grant says |

**What a refusal looks like.** No access at all answers **`404`** — a
workflow you cannot reach is indistinguishable from one that does not exist,
and any other answer would confirm to a stranger that an id is real. Only
when you can already see it and need more does the answer become **`403`**.

**Changing `visibility`** (`PATCH /v1/workflows/:id { visibility }`) is the
creator's or a workspace admin's, not an editor's — flipping a private
workflow to `workspace` publishes someone else's work to the class. On a
workflow that is not in a workspace there is nothing to be visible to, and
the request answers `400 not_workspace_scoped`.

**Deleting somebody else's work is recorded.** The row policies admit only
the creator; a workspace admin can delete a member's workflow through the
API and nowhere else, and the audit entry
(`workflow.deleted_by_admin`) is written *before* the deletion — if it
cannot be written, the deletion does not happen (`503 audit_unavailable`).
Deleting your own work is unchanged and is not audited. A workflow that is
in no workspace has no organization to record an entry under, so nobody but
its creator can delete it at all.

**`GET /v1/workflows/:id/access` answers three permissions separately** —
`canChangeVisibility`, `canShare`, `canRun` — because they are three
different rules. A workspace can let ordinary editors invite collaborators
while reserving the class-wide visibility switch for admins, and `canRun`
can be false while the caller may still edit. Never infer one from another.

### Audit

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/orgs/:id/audit` | owner, org admin | `?cursor&limit`. Newest first. Each entry is `{ id, workspaceId, action, targetType, targetId, details, createdAt, actor }`; `actor` is `null` for anything the system did on nobody's behalf. |

Readable while the organization is **suspended**, unlike every other management
endpoint — the record of what happened is exactly what someone needs when
things have gone wrong.

`action` is an **open vocabulary**: new actions are added as the product
grows, and the schema promises only that the field holds a string. Render the
ones you recognise and fall back to the raw value for the rest — a client that
switched exhaustively over it would break on the first new one.

### Platform administration

On instances that hold new organizations for review, a platform administrator
approves them. These endpoints answer **403**, not 404, to everyone else: they
are a platform surface, not a member one, and there is nothing to conceal
about their existence.

| Method | Path | Who | Body / query |
|--------|------|-----|--------------|
| `GET` | `/v1/admin/orgs` | platform admin | `?status&cursor&limit`. Unfiltered returns every live organization; a soft-deleted one appears only when `status=deleted` is asked for explicitly. Each row carries the owner, the member count and the workspace count. |
| `GET` | `/v1/admin/orgs/:id` | platform admin | One organization, same shape. |
| `PATCH` | `/v1/admin/orgs/:id` | platform admin | `{ status: "active" | "suspended" }`. Approving a `pending` organization and restoring a suspended one are the same call. |

The surface stops there on purpose. A platform administrator decides whether
an organization may **operate** on the instance; renaming it, reading its
members and changing its settings belong to the people who run it.

## Budgets and credits

An organization pays for its members' work in three moves, each one narrower
than the last:

1. **The pool.** The organization buys prepaid credit packs (the same packs and
   prices as personal top-ups) into one org-wide pool. Purchases go through
   Stripe Checkout against the organization's own Stripe customer — never a
   member's card on file.
2. **Allocations.** An owner moves credits from the pool into a workspace's
   budget. Allocation is a *move*, not a copy: the pool goes down by exactly
   what the workspace gains. Credits can be reclaimed back to the pool, but only
   down to what the workspace has already reserved or spent.
3. **Member caps (optional).** Inside a workspace, an admin can cap what a
   single member may spend. Caps bind only where the workspace's settings enable
   them (the school preset does; the team preset does not), and only for
   explicit members — an organization admin acting in the workspace is never
   capped.

Work done inside a workspace is paid by the workspace, whatever the member's
own balance says: the member's personal credits are untouched, and the two
balances are shown side by side. (Workspace-paid runs are live; the budget
console and payer-aware run gate arrive with the next update. Rollout-gated:
instances enable organizations explicitly.) Headroom at every level is
`allocated − reserved − spent`; a run that would exceed it is refused with a
stable error code (`budget_exceeded`, `member_cap_exceeded`) rather than
started.

| Route | Who | Does |
|---|---|---|
| `GET /v1/orgs/:id/credits` | owner / org admin | pool, lifetime purchased, and every workspace's allocation with reserved/spent |
| `POST /v1/orgs/:id/credits/checkout` `{ packId }` | owner | Stripe Checkout URL for one prepaid pack |
| `POST /v1/orgs/:id/workspaces/:wsId/allocate` `{ delta }` | owner | move credits pool ⇄ workspace; returns the new headroom |
| `GET /v1/workspaces/:id/budget` | member | own spend, cap and headroom; admins also get per-member rows |
| `PATCH /v1/workspaces/:id/members/:userId` `{ creditCap, resetSpend }` | workspace admin | cap a member / zero their counted spend |
| `GET /v1/orgs/:id/usage` | owner / org admin | credits by workspace, member, model or day for an inclusive date range; `groupBy=none` pages the runs; `format=csv` exports |
| `GET /v1/workspaces/:id/usage` | member (own runs) / workspace admin (everyone) | the same, scoped to one workspace |

Refunds and disputes claw credits back from the organization's pool,
proportionally to the refunded amount and floored at zero — a pool that
already spent what was refunded records the shortfall instead of going
negative. Deleting an organization requires reclaiming every workspace
allocation first.

**Automations spend the workspace's money.** A webhook trigger's URL is a
bearer capability: whoever holds it can start the run, and once workspace
payment is live, a run of a workspace-homed workflow bills the workspace's
budget. Treat trigger URLs like credentials — anyone you share one with can
spend against the class. Every automated fire (webhook, schedule, Telegram)
re-checks at fire time that the trigger's creator may still run the
workflow; a creator who lost access (grant revoked, membership suspended,
workspace archived) stops the automation, and the workflow's run history
shows one failed entry with the code `run_requires_authenticated_member`
saying why. (Rollout-gated: workspace-paid runs may lag this document.)

### Usage reports

Two read-only endpoints answer "who spent how much on what, when" over the
workspace-paid runs, for an inclusive date range:

- `from` and `to` are inclusive calendar dates (`YYYY-MM-DD`); `tz` is an IANA
  zone name (default `UTC`) and day buckets follow it. The range is at most 366
  days and defaults to the last 30.
- Group by `workspace` (the organization report only), `member`, `model` or
  `day`. `groupBy=none` returns the individual runs, newest first, cursor-paged;
  the cursor comes back as `nextCursor` and is passed in again as `cursor`.
- `format=csv` streams the same report as a CSV attachment.

Each row carries three credit numbers. `credits` is what a run has cost so far —
the settled amount where the run has finished, the held reservation while it is
still running. `settledCredits` and `inFlightCredits` split that sum, so an
admin sees what is final and what is still pending. A run still holding its
reservation is listed as **in flight**; it settles or is refunded when the job
finishes, usually within the reconcile window, and a row that stays in flight
for longer is a support case.

A metered run that cost more than the workspace had left is charged up to the
headroom; the rest is **absorbed by the platform** and listed on its own line,
never against a member. The report totals it as `platformAbsorbedCredits`, and
`chargedToBudget = settledCredits − platformAbsorbedCredits` is what actually
left the workspace budgets.

A plain workspace member sees their OWN usage: the workspace report is narrowed
to them, and asking to group by member is refused. A workspace admin (explicit,
or an organization admin acting in the workspace) sees everyone and may filter
to one member. Organization-level usage is owner and organization admins only.

**CSV.** UTF-8, RFC 4180, CRLF line endings, no byte-order mark. A cell that
begins with `=`, `+`, `-` or `@` is quoted with a leading apostrophe so a
spreadsheet cannot execute it. Exports are limited to ten per minute per user,
and each export is recorded in the audit log before a single byte is streamed —
if that record cannot be written the export is refused rather than left
untracked. A report with more than 5000 groups comes back with `truncated:
true`; narrow the window.

**A known limit.** A member who deletes their account takes their run history
with them; reports show a gap for their past activity. Their workflows and
projects stay with the class, and the platform-absorbed line is unaffected.
Resetting a member's counted spend does not change the report — it zeroes the
cap counter, not the history.

## Errors

Errors use the standard envelope `{ "error": { "code", "message" } }`; dispatch
on `code`.

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | A field fails validation, a cursor is malformed, the change is not allowed for that row (for example, editing the owner's membership), or a usage report is asked for with a bad date, an unknown time zone, a range over 366 days, or a grouping the scope does not allow. |
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
| 503 | `billing_unavailable` | Usage reporting is not yet available on this instance (its reporting functions have not been applied). |
| 503 | `audit_unavailable` | A CSV usage export could not be recorded in the audit log, so it was refused; try again. |
| 409 | `name_taken` | The slug you supplied is in use. |
| 409 | `already_a_member` | The person is already in the workspace. |
| 409 | `owner_cannot_leave` | Transfer ownership before leaving. |
| 409 | `has_active_workspaces` | Archive every workspace before deleting the organization. |
| 429 | `rate_limit_exceeded` | Too many organizations created recently, too many join attempts, or too many CSV usage exports (ten per minute per user). |
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

## From the SDK, the CLI, and MCP

The same endpoints, three ways.

**[SDK](./sdk-reference.md)** — `client.organizations` and
`client.workspaces`. Choose where a request acts with
`createClient({ workspaceId })` or `client.withWorkspace(id)`, which returns a
NEW client rather than mutating a shared one, so two concurrent operations
cannot race over which workspace they are in:

```ts
const classroom = nodaro.withWorkspace(workspaceId)
await classroom.workflows.run(workflowId)   // lands in the class
await nodaro.workflows.run(workflowId)      // lands in the personal space
```

`client.me()` carries the organizations block. Keep its three states apart:
the fields **absent** means the instance has no organizations, present and
**empty** means the account belongs to none, and `organizationsUnavailable`
means the lookup failed — in which case keep whatever selection you had rather
than concluding the person was removed from everything.

`client.organizations.usage / usageRows / usageCsv` and the matching
`client.workspaces` methods return a usage report, its individual runs, or the
same report as CSV text, for a date range.

**[CLI](./cli.md)** — `nodaro org` and `nodaro workspace`. Three ways to say
which workspace a command acts in, each beating the one below:
`--workspace <id>` for one command, `NODARO_WORKSPACE` for a shell or a CI
job, and `nodaro workspace use <id>` saved on the profile.
`nodaro workspace current` reports which of the three decided.
`nodaro org usage` and `nodaro workspace usage` print the report as a table,
`--json` as JSON, and `--csv` writes the CSV to stdout.

**[MCP](./mcp/tools.md)** — `list_workspaces` and `select_workspace`. An MCP
client has no switcher and no header it controls, so the same two questions
become tools. The selection is remembered across sessions and **re-validated
at every one**: a preference is written once and read for months, and
membership can end in between. There is no usage tool yet — usage is read
through the SDK, the CLI, or the API.

## Notes for integrators

**Invitations may come back as links.** `POST /v1/orgs/:id/invitations`
returns one row per address, and a row whose `status` is not `sent` carries a
`link` instead — an install with no mail provider, or a delivery that failed.
Surface it. The invitation exists either way, and without the link nobody can
reach it.

**Third-party app tokens.** `workspaces:read` and `workspaces:write` exist
and are required by the MCP workspace tools; request them if your app uses
those. The organization REST endpoints are not scope-gated yet and are
reachable with a first-party session — that will change, and further scopes
will be added alongside the checks that enforce them, so do not build on a
token continuing to reach these endpoints without asking for anything.

**A pending organization grants nothing.** Where approval is required, a newly
created organization is `pending` until a platform administrator approves it.
Say so to whoever created it, or waiting is indistinguishable from broken.

Model policy and assignments are documented as they become available.
