# `@nodaro/sdk` API Reference

Complete reference for every public export of `@nodaro/sdk`. For a
walkthrough-style introduction, see the [SDK Quickstart](./sdk-quickstart.md).

## Table of contents

- [`createClient(options)`](#createclientoptions)
- [Auth providers](#auth-providers)
- [Errors](#errors)
- [Resources](#resources)
  - [`client.workflows`](#clientworkflows)
  - [`client.projects`](#clientprojects)
  - [`client.jobs`](#clientjobs)
  - [`client.llm`](#clientllm)
  - [`client.videoPro`](#clientvideopro)
  - [`client.recast`](#clientrecast)
  - [`client.executions`](#clientexecutions)
  - [`client.nodes`](#clientnodes)
  - [`client.models`](#clientmodels)
  - [`client.characters`](#clientcharacters)
  - [`client.locations`](#clientlocations)
  - [`client.objects`](#clientobjects)
  - [`client.creatures`](#clientcreatures)
  - [`client.pipelines`](#clientpipelines)
  - [`client.reduce`](#clientreduce)
  - [`client.promptHelper`](#clientprompthelper)
  - [`client.apps`](#clientapps)
  - [`client.developerApps`](#clientdeveloperapps)
  - [`client.oauth`](#clientoauth)
  - [`client.voices`](#clientvoices)
  - [`client.media`](#clientmedia)
  - [`client.audio`](#clientaudio)
  - [`client.credits`](#clientcredits)
  - [`client.uploads`](#clientuploads)
  - [`client.library`](#clientlibrary)
  - [`client.presets`](#clientpresets)
  - [`client.pickerCatalogs`](#clientpickercatalogs)
  - [`client.shots`](#clientshots)
  - [`client.community`](#clientcommunity)
  - [`client.templates`](#clienttemplates)
  - [`client.tutorials`](#clienttutorials)
  - [`client.organizations`](#clientorganizations)
  - [`client.workspaces`](#clientworkspaces)
- [Type re-exports](#type-re-exports)

---

## `createClient(options)`

Factory that returns a `NodaroClient` instance with all resource subobjects
attached.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})
```

**Options (`ClientOptions`):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | `string` | yes | Backend URL like `"https://nodaro.example.com"`. Use `""` for same-origin in browser apps. Trailing slash is stripped. |
| `auth` | `Auth` | yes | Auth provider — `StaticTokenAuth`, `supabaseAuth(...)`, or `CallbackAuth`. |
| `fetch` | `typeof fetch` | no | Custom fetch implementation. Default: `globalThis.fetch`. |
| `timeoutMs` | `number` | no | Per-request timeout. Default: `60_000`. |
| `workspaceId` | `string` | no | The workspace every request acts in, sent as `X-Nodaro-Workspace`. See [`client.withWorkspace`](#clientwithworkspaceworkspaceid). Omit for the caller's personal space. |
| `clientLabel` | `string` | no | Value sent as the `X-Nodaro-Client` header. Default `sdk/<version>`. The backend records it as the job's origin, so an operator can tell SDK traffic from CLI traffic from browser sessions. `@nodaro/cli` overrides it with `cli/<version>`; set it yourself only if you are building another wrapper. The DEFAULT label is not sent from a browser (the `Origin` header already identifies the app, and Nodaro prefers it) — an explicit `clientLabel` is always sent. |

The instance exposes 30 resource objects: `workflows`, `projects`, `jobs`,
`videoPro`, `executions`, `nodes`, `characters`, `locations`, `objects`,
`creatures`, `pipelines`, `reduce`, `promptHelper`, `apps`, `developerApps`,
`oauth`, `voices`, `media`, `audio`, `credits`, `uploads`, `library`,
`presets`, `pickerCatalogs`, `catalogs`, `models`, `shots`, `recast`, `community`,
`templates`, `tutorials`, `organizations`, `workspaces`. It also exposes a low-level
`request<T>(method, path, options)` method for endpoints not yet wrapped by a
resource.

### `class NodaroClient`

You normally call `createClient`, but the class is also exported for
typechecking (`function takesClient(c: NodaroClient) { ... }`).

```ts
import { NodaroClient } from "@nodaro/sdk"
```

### `client.withWorkspace(workspaceId)`

Returns a **new** client that acts in `workspaceId`, sharing this one's auth,
base URL, timeout and fetch. Pass `null` for the personal space.

```ts
const classroom = client.withWorkspace(workspaceId)
await classroom.workflows.run(workflowId)   // lands in the class
await client.workflows.run(workflowId)      // lands in the personal space
```

A new client rather than a setter, deliberately: a mutable selection means two
concurrent operations race over which workspace they are in, and the loser
creates work in the wrong place with nothing failing. A per-workspace client
cannot be raced.

The workspace decides **scope**, never **access**: which workspace a list
reads from and where a create lands. Reading, updating, deleting or running
something you name by id is governed by that object's own workspace — so a
forgotten workspace cannot hide your work and a wrong one cannot reach anyone
else's. See [Selecting a workspace](./api-integration.md#4c-selecting-a-workspace-cloud-organizations).

**Signature:** `withWorkspace(workspaceId: string | null): NodaroClient`

### `client.me()`

Resolves the authenticated user's canonical identity (`GET /v1/me`). A token-
introspection primitive: any valid bearer token (a first-party Supabase JWT or
a developer-app OAuth token) resolves to its owner's identity. Throws
`UnauthorizedError` (401) when the token is missing or invalid.

```ts
const me = await client.me()
// { id, email, displayName, avatarUrl, tier, isAdmin }
```

**Signature:** `me(): Promise<UserIdentity>`

Returns `UserIdentity`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Nodaro user id (= the Supabase auth user id). |
| `email` | `string` | The user's email. |
| `displayName` | `string \| null` | Human-readable display name (from `profiles.full_name`); `null` if unset. |
| `avatarUrl` | `string \| null` | Avatar URL; `null` if unset. |
| `tier` | `string` | Stored subscription tier (e.g. `"free"`, `"pro"`). For the entitlement tier actually enforced (including `"payg"`), read `effectiveTier` from [`client.credits.balance()`](#clientcredits). |
| `isAdmin` | `boolean` | Whether the user holds an admin role. **Descriptive only** — use it to decide whether to render admin UI instead of capability-probing an admin endpoint; every admin API stays enforced server-side regardless. |

On an instance with [organizations](./organizations.md) the same object also
carries `organizations`, `workspaces`, `lastWorkspaceId`. Three states, and
collapsing them is wrong in a way users feel:

| What you see | What it means | What to do |
|--------------|---------------|------------|
| the fields are **absent** | this instance has no organizations at all | never show a switcher |
| present and **empty** | the account belongs to none | offer to create or join one |
| `organizationsUnavailable: true` | the lookup **failed** | keep the selection you already had — telling someone their school vanished during a cache blip is worse than a stale switcher |

---

## Auth providers

Every request calls `auth.getToken()` and sends `Authorization: Bearer <token>`
when a non-null token is returned.

### `Auth` (interface)

```ts
interface Auth {
  getToken(): Promise<string | null>
}
```

Any object that satisfies this shape can be used as `auth`.

### `class StaticTokenAuth`

Wraps a fixed string. Use for server-side code with an OAuth access token, an
API token (`ndr_...`), or a developer-app token (`ndr_app_...`).

```ts
import { StaticTokenAuth } from "@nodaro/sdk"
new StaticTokenAuth("ndr_app_abc123...")
```

**Constructor:** `new StaticTokenAuth(token: string)`

### `class CallbackAuth`

Calls a user-supplied function on every request. The function may be sync or
async, and may return `null` to skip the header (anonymous request).

```ts
import { CallbackAuth } from "@nodaro/sdk"

new CallbackAuth(async () => {
  const session = await sessionStore.read()
  return session?.accessToken ?? null
})
```

**Constructor:** `new CallbackAuth(fn: () => string | null | Promise<string | null>)`

### `supabaseAuth(supabase)`

Pulls the JWT live from a Supabase v2 client. Use for browser frontends talking
to a Nodaro instance backed by the same Supabase project.

```ts
import { supabaseAuth } from "@nodaro/sdk"
import { createClient as createSupabase } from "@supabase/supabase-js"

const supabase = createSupabase(URL, ANON_KEY)
const auth = supabaseAuth(supabase)
```

**Signature:** `supabaseAuth(supabase: SupabaseLikeClient): Auth`

The argument is structurally typed — only `supabase.auth.getSession()` is called.
Any client matching that shape works.

### `createSharedSupabaseClient(options)` — `@nodaro/sdk/supabase`

Browser Supabase client that stores the session in **cookies** instead of
localStorage — optionally scoped to a parent domain so several apps on sibling
subdomains share one login (sign in on any of them, signed in on all; sign out
anywhere, signed out everywhere).

```ts
import { createSharedSupabaseClient } from "@nodaro/sdk/supabase"
import { supabaseAuth } from "@nodaro/sdk"

const supabase = createSharedSupabaseClient({
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  cookieDomain: ".example.com", // optional — omit for host-only cookies
})
const auth = supabaseAuth(supabase)
```

**Signature:** `createSharedSupabaseClient<Db = any>(options: { url: string; anonKey: string; cookieDomain?: string }): SupabaseClient<Db>`

- `cookieDomain` is applied only when the page's hostname is that domain or a
  subdomain of it; on any other host (`localhost`, preview URLs) cookies stay
  host-only, so local dev keeps per-origin sessions.
- On first load it adopts an existing localStorage session (the storage
  supabase-js used previously) into the cookie, then removes the old key — an
  already-signed-in user survives the switch. Dead tokens are discarded.
- Ships as a separate subpath so the base SDK stays Supabase-free.
  `@supabase/ssr` and `@supabase/supabase-js` are **optional peer
  dependencies** — install both to use this export.

---

## Errors

All errors thrown by resource methods extend `NodaroError`. Catch the most
specific subclass first.

### `class NodaroError`

Base class for every API error.

```ts
class NodaroError extends Error {
  readonly code: string    // e.g. "internal_error", "validation_failed"
  readonly status: number  // HTTP status
}
```

**Constructor:** `new NodaroError(message: string, code: string, status: number)`

### `class UnauthorizedError extends NodaroError`

HTTP 401. Token missing, expired, or invalid.

- `code = "unauthorized"`, `status = 401`
- **Constructor:** `new UnauthorizedError(message?: string)`

### `class ForbiddenError extends NodaroError`

HTTP 403. Permission denied. When the server returns
`code: "insufficient_scope"`, the missing scope is exposed via `missingScope`.

- `code = "forbidden"`, `status = 403`
- `missingScope?: string` — set when scope check failed
- **Constructor:** `new ForbiddenError(message?: string, missingScope?: string)`

### `class NotFoundError extends NodaroError`

HTTP 404. Resource doesn't exist or isn't visible to this caller.

- `code = "not_found"`, `status = 404`
- **Constructor:** `new NotFoundError(message?: string)`

### `class RateLimitedError extends NodaroError`

HTTP 429. Apply backoff and retry.

- `code = "rate_limited"`, `status = 429`
- **Constructor:** `new RateLimitedError(message?: string)`

### `class InsufficientCreditsError extends NodaroError`

HTTP 402. Caller doesn't have enough credits to start the operation. Both
fields are present on production servers but optional in the type for
forward-compat.

- `code = "insufficient_credits"`, `status = 402`
- `required?: number`
- `available?: number`
- **Constructor:** `new InsufficientCreditsError(message?: string, required?: number, available?: number)`

### `class StorageExceededError extends NodaroError`

HTTP 413. User's storage cap is reached.

- `code = "storage_exceeded"`, `status = 413`
- `limitBytes?: number`
- **Constructor:** `new StorageExceededError(message?: string, limitBytes?: number)`

### `class WorkflowConflictError extends NodaroError`

HTTP 409 `workflow_conflict`. An optimistic-concurrency update
(`workflows.update` with `expectedUpdatedAt`/`expectedVersion`) was rejected
because another writer updated the row first. Merge onto `currentRecord` and
retry with its fresh token instead of clobbering the other writer.

- `code = "workflow_conflict"`, `status = 409`
- `currentUpdatedAt?: string` — the row's current `updated_at`
- `currentVersion?: number` — the row's current `version`
- `currentRecord?: Record<string, unknown>` — the full current workflow (when
  the server includes it), so no follow-up GET is needed to merge
- **Constructor:** `new WorkflowConflictError(message?: string, currentUpdatedAt?: string, currentVersion?: number, currentRecord?: Record<string, unknown>)`

### `class JobBlockedError extends NodaroError`

HTTP 422 `job_blocked`. A job policy registered by this deployment refused the
generation **before it ran** — no job was created and nothing was charged.
`message` is user-safe text written by the deployment's policy (or by the platform, when the policy supplies none); show it as-is.
Do not retry the identical request: the platform does not retry a refused
request, and whether it would be judged differently is the deployment's
policy's business. Only occurs on deployments that register a job policy (see
[deployment.md](./deployment.md#surface-profile-nodaro_surface_profile)).

- **Constructor:** `new JobBlockedError(message?: string)`
- `code = "job_blocked"`, `status = 422`

### `class JobHeldError extends NodaroError`

Not an HTTP error — thrown by `nodes.runAndWait()` / `runMany()` on the first
poll tick that observes `pending_review`, so a held job never burns `maxMs`
and never masquerades as a `JobTimeoutError`. The job is **not** cancelled:
the output exists, a human is reviewing it, and the reservation stays
`reserved` until they decide. Re-fetch with `jobs.get(jobId)` later, or poll
`jobs.getStatus()` yourself. Only occurs on deployments that register a job
policy.

- **Constructor:** `new JobHeldError(message: string, jobId: string)` — same
  argument order as the other poll-loop errors.
- `code = "job_held"`, `status = 0`, `jobId`

### `throwFromResponse(status, body)`

Internal helper that maps `(status, JSON body)` to the right error class and
throws it. Exported so custom transports can reuse it. Returns `never`.

```ts
import { throwFromResponse } from "@nodaro/sdk"
throwFromResponse(403, { error: { code: "insufficient_scope", message: "...", missingScope: "workflows:execute" } })
// → throws ForbiddenError with .missingScope === "workflows:execute"
```

---

## Resources

Every resource is constructed automatically by `createClient` and reachable via
`client.<resource>`. The classes are also exported for advanced typechecking
but rarely need to be imported directly:
`WorkflowsResource`, `ProjectsResource`, `JobsResource`, `LlmResource`, `ExecutionsResource`,
`NodesResource`, `CharactersResource`, `LocationsResource`, `ObjectsResource`,
`PipelinesResource`, `ReduceResource`, `PromptHelperResource`, `AppsResource`,
`DeveloperAppsResource`, `OAuthResource`, `VoicesResource`, `CreditsResource`,
`UploadsResource`, `PresetsResource`, `PickerCatalogsResource`, `CatalogsResource`, `CommunityResource`.

All "data" responses follow the envelope `{ data: T }` — the SDK returns the
envelope as-is. Mutation responses (`delete`, `cancel`) return `{ success: true }`.

### `client.workflows`

#### `list(params)`

```ts
list(params: { projectId: string }): Promise<{ data: Workflow[] }>
```

Lists workflows in a project. Returns metadata only — `nodes`, `edges`,
`settings`, and `sourcePrompt` are omitted.

```ts
const { data } = await client.workflows.list({ projectId })
```

Throws `UnauthorizedError`, `ForbiddenError`, `NotFoundError` (project not visible).

#### `get(id)`

```ts
get(id: string): Promise<{ data: Workflow }>
```

Fetches a workflow including its full nodes/edges/settings.

```ts
const { data: wf } = await client.workflows.get(workflowId)
```

#### `getPublic(id)`

```ts
getPublic(id: string): Promise<{ data: Workflow }>
```

Fetches a publicly-shared workflow by id (`GET /v1/public/workflows/:id`) — the
unauthenticated share-by-link read. Returns the workflow's nodes/edges/settings
ONLY when the workflow is opted into sharing server-side
(`settings.studio.shared === true`); otherwise throws `NotFoundError`.
No auth required — the SDK omits the bearer when no token exists.

```ts
const { data: wf } = await client.workflows.getPublic(workflowId)
```

#### `create(input)`

```ts
create(input: CreateWorkflowInput): Promise<{ data: Workflow }>
```

Creates a workflow under a project. `input.projectId` is required; everything
else is optional and falls back to server defaults. Returns the full record.

```ts
const { data: wf } = await client.workflows.create({
  projectId,
  name: "My workflow",
  nodes: [],
  edges: [],
})
```

#### `update(id, input)`

```ts
update(id: string, input: UpdateWorkflowInput): Promise<{ data: Workflow }>
```

PATCHes a workflow. Any subset of fields is allowed.

Optimistic concurrency: pass `expectedVersion` (the integer `version` from a
prior read — bumped by the database on every content change) to make the
update conditional; on a mismatch the API returns `409 workflow_conflict`
with `currentVersion`, `currentUpdatedAt`, and `currentRecord` — the full
current workflow — so you can merge your changes onto the fresh record and
retry without a follow-up GET. The SDK surfaces the 409 as
`WorkflowConflictError` (fields: `currentUpdatedAt`, `currentVersion`,
`currentRecord`). `expectedUpdatedAt` (string token) remains supported.
Transient run-state keys on node `data` (`executionStatus`, `currentJobId`,
progress counters) are stripped server-side and never persist.

```ts
import { WorkflowConflictError } from "@nodaro/sdk"

try {
  await client.workflows.update(id, { settings, expectedUpdatedAt: loadedAt })
} catch (err) {
  if (err instanceof WorkflowConflictError && err.currentRecord) {
    const merged = mergeSettings(err.currentRecord.settings, settings)
    await client.workflows.update(id, {
      settings: merged,
      expectedUpdatedAt: err.currentUpdatedAt,
    })
  } else throw err
}
```

```ts
await client.workflows.update(id, { name: "Renamed", expectedVersion: 7 })
```

`thumbnailUrl` sets the workflow's preview image — an already-hosted image URL,
or `null` to clear it:

```ts
await client.workflows.update(id, { thumbnailUrl: "https://cdn.example.com/thumb.jpg" })
```

#### `delete(id)`

```ts
delete(id: string): Promise<{ success: true }>
```

Deletes a workflow. Throws `NotFoundError` when the id doesn't exist or
isn't yours — the delete is never a silent no-op.

```ts
await client.workflows.delete(id)
```

#### `run(id, params?)`

```ts
run(id: string, params?: RunWorkflowParams): Promise<RunWorkflowResult>
```

Starts an execution and returns immediately with `{ executionId, status }`.
Optionally restrict to a subset of node IDs.

```ts
const { executionId } = await client.workflows.run(id, { nodeIds: ["node-1"] })
```

Throws `InsufficientCreditsError` if the user can't cover the worst-case cost.
Requires `workflows:execute` scope when called via OAuth.

#### `export(workflowId, opts?)`

```ts
export(workflowId: string, opts?: { assets?: boolean }): Promise<{ data: WorkflowExport }>
```

Exports a workflow as a portable JSON bundle. Pass `opts.assets = true` to
include character/object/location entity data in the bundle.

```ts
const { data: bundle } = await client.workflows.export(workflowId, { assets: true })
```

**Portability.** A bundle is only as portable as the media it points at. When
nodes reference URLs that another instance cannot fetch — typically a
self-hosted install's own storage on `localhost`, a LAN address, or an
`.internal` name — the bundle carries a `portability` section listing them:

```ts
bundle.portability?.unreachableMedia
// [{ nodeId: "n1", nodeLabel: "Video URL", field: "videoUrl", url: "http://localhost:3000/storage/…" }]
```

Absent when every media URL is publicly reachable. Such a bundle still imports,
but those nodes will not run on the other instance until the media is
re-uploaded there.

#### `import(input)`

```ts
import(input: WorkflowExport & { projectId: string }): Promise<{ data: Workflow; importReport?: WorkflowImportReport }>
```

Imports a `WorkflowExport` bundle into the specified project. Re-creates any
bundled assets (characters, objects, creatures, locations) under your account
and re-points the graph at them — both the entity nodes' `*DbId` fields and
every `@`-chip (`ConnectedReference`) bound in node data **or in the workflow's
freeform `settings`**, so a graph that binds its entities only through chips
arrives bound rather than dangling. Returns the full record of the newly created
workflow.

Media the bundle references on other hosts is **copied onto this instance's
storage** where it is reachable (up to 25 distinct files for the graph's media
and 25 more for the bundled entities' — the two budgets are separate, so neither
can starve the other; images up to 20 MB, video/audio up to 50 MB), so the
workflow runs from local copies rather than someone else's host. URLs in
`settings` follow those copies but never trigger one of their own. A bundled
**entity's** images are copied
whoever hosts them — they are the exporter's bytes, and their delete, quota
sweep and retention reaper answer to the exporter, not to you. Those copies
count against your storage quota; when it runs out the workflow still lands and
the entities that did not fit are named in the report.

`importReport` says what happened:

```ts
const { data: wf, importReport } = await client.workflows.import({ ...bundle, projectId })
importReport
// {
//   rehosted: 3,                                  // copied onto this instance
//   unreachable: [{ nodeId, nodeLabel, field, url }], // private hosts — left as-is
//   skipped: [{ nodeId, field, url, reason: "HTTP 404" }],
//   assetIdMap: { "<bundled entity id>": "<the row created for it>" },
//   assetsSkipped: [{ kind: "character", id, name: "Kira", reason: "Storage limit exceeded" }],
// }
```

`assetIdMap` is present whenever the bundle carried `assets`. The server has
already re-pointed every chip inside the nodes it stored; the map is for chips
a client holds **outside** the graph. `assetsSkipped` appears only when
something was left out.

#### `setVisibility(id, visibility)`

```ts
setVisibility(id: string, visibility: WorkflowVisibility): Promise<{ data: Workflow }>
```

Sets a workflow's visibility — `"private"` (the creator plus anyone explicitly
added as a collaborator) or `"workspace"` (everyone in the workflow's
workspace). Only the creator or a workspace admin may change it; anyone else
gets `403`. A thin wrapper over `update()` — the visibility lever also lives on
`PATCH /v1/workflows/:id`.

#### `move(id, { projectId })`

```ts
move(
  id: string,
  params: { projectId: string },
): Promise<{ data: Workflow; droppedCollaborators: { userId: string; name: string | null }[] }>
```

Moves a workflow to another project (its folder is cleared). If the move takes
the workflow out of a workspace, collaborator grants that came from that
workspace are dropped and returned as `droppedCollaborators`.

#### `sharedWithMe()`

```ts
sharedWithMe(): Promise<{ data: (Workflow & { grantedRole: CollaboratorRole })[] }>
```

Workflows other people shared with you — grants on work that is **not** in a
workspace you belong to (workspace work already appears in that workspace's own
lists). Each carries the `grantedRole` you hold.

#### `collaborators`

The people a workflow is shared with, reached as `client.workflows.collaborators`:

```ts
collaborators.list(workflowId): Promise<{ data: Collaborator[] }>
collaborators.add(workflowId, { userId?, email?, role }): Promise<{ data: { userId, role } }>
collaborators.update(workflowId, userId, { role }): Promise<{ data: { userId, role } }>
collaborators.remove(workflowId, userId): Promise<{ success: true }>
```

`add` takes **exactly one** of `userId` or `email` (any address — the person
need not already have an account), at `role` `"viewer"` or `"editor"`. `remove`
also lets a collaborator remove themselves. Listing never returns email
addresses.

---

### `client.projects`

#### `list()`

```ts
list(): Promise<{ data: Project[] }>
```

Lists the authenticated user's projects.

```ts
const { data } = await client.projects.list()
```

#### `get(id)`

```ts
get(id: string): Promise<{ data: Project }>
```

```ts
const { data } = await client.projects.get(id)
```

#### `create(input)`

```ts
create(input: CreateProjectInput): Promise<{ data: Project }>
```

```ts
const { data } = await client.projects.create({ name: "New project" })
```

#### `update(id, input)`

```ts
update(id: string, input: UpdateProjectInput): Promise<{ data: Project }>
```

At least one field must be supplied.

```ts
await client.projects.update(id, { description: "Updated" })
```

#### `delete(id)`

```ts
delete(id: string): Promise<{ success: true }>
```

```ts
await client.projects.delete(id)
```

---

### `client.jobs`

A "job" is a single AI generation unit (one image, one video render, one TTS
call). Workflows produce one job per AI node.

#### `get(id)`

```ts
get(id: string): Promise<{ data: Job }>
```

```ts
const { data: job } = await client.jobs.get(jobId)
```

The returned `Job` uses snake_case fields to match the wire format. Non-admin
callers receive an explicit allowlist of job fields — `id`, `status`,
`progress`, `input_data`, `output_data`, `error_message`, `error_hint`,
`created_at`, `started_at`, `completed_at`, `user_id`, `credits`, `job_type`,
`source`, `source_detail`, plus `recovering` while a processing job is being
recovered and `credit_status` (the job's credit-reservation lifecycle —
`"reserved"` | `"committed"` | `"refunded"` | `null`, derived server-side
from the usage log). `error_hint` is a structured, user-safe failure verdict
(`JobErrorHint`) present on a job the worker classified as a final provider
content-policy block (`kind: "safety-block"` — see [Generate
Image](./nodes/ai-image/generate-image.md#when-the-providers-safety-filter-blocks-a-request)
for what it means and when a fallback model is offered) or that a job policy
registered by the deployment rejected (`kind: "policy-block"`, carrying
`policyId`, `hookPoint: "request" | "result"` and `reason` — user-safe text
written by the deployment's policy, or by the platform when the policy supplies none; show it as-is). Admin callers
additionally receive `provider`, `provider_cost`, `display_cost`,
`credits_actual`, `error_detail` (the provider's redacted raw error) and
`reconcile_attempts`. Any other column never reaches any caller. Server-only
values inside job JSON, including Recast's private pre-watermark remux base,
are removed recursively for every caller, including administrators.

#### `list(params?)`

```ts
list(params?: { type?: string; origin?: string; limit?: number; cursor?: string }): Promise<{ data: Job[]; next: string | null }>
```

Your jobs, newest first (`GET /v1/jobs`), cursor-paginated (`limit` ≤ 100;
pass `next` back as `cursor`). `type` matches the job's `input_data.type`
(the route that created it — `"llm-structured"`, `"video-analysis"`, …) and
`origin` matches `input_data.origin` (the client app that sent it). Both are
exact-match and combine.

```ts
const { data: runs, next } = await client.jobs.list({ type: "llm-structured", origin: "studio" })
```

#### `getStatus(id)`

```ts
getStatus(id: string): Promise<{ data: JobStatusResult }>
```

Returns the lean status of a job — id, status, progress, output_data,
error_message, error_hint, and credit_status (`GET /v1/jobs/:id/status`).
Far less wire + CPU cost than
`get()` because it skips `input_data` JSONB and cost/provider columns. Its
`output_data` still receives the server-only JSON redaction described above.
Intended for poll loops. Same auth and ownership semantics as `get()`.

```ts
const { data } = await client.jobs.getStatus(jobId)
if (data.status === "completed") console.log(data.output_data)
```

#### `cancel(id)`

```ts
cancel(id: string): Promise<CancelJobResult>
```

Cancels a job and refunds any reserved credit holds. Returns
`{ success: true, cancelled: number }`.

```ts
const { cancelled } = await client.jobs.cancel(jobId)
```

---

### `client.llm`

Structured LLM output: your system prompt and JSON Schema in, a validated
object out. Billed under `llm-structured` per model tier.

#### `structured(input)`

```ts
structured<T>(input: LlmStructuredInput): Promise<{ jobId: string; output: T; usage: { inputTokens: number; outputTokens: number } }>
```

`POST /v1/llm/structured`, synchronous — a call may run several minutes,
longer than the client's default 60 s `timeoutMs`. Construct the client with
a larger `timeoutMs` for it, or use `structuredJob`.

#### `structuredJob(input)`

```ts
structuredJob(input: LlmStructuredJobInput): Promise<{ jobId: string }>
```

The same call as a job (`POST /v1/llm/structured/jobs`). Poll
`jobs.getStatus(jobId)`; `output_data` is an `LlmStructuredJobOutput` —
`{ stage }` while running, then `{ output, inputTokens, outputTokens }`.
`label` names the run; `videoUrl` (+ `videoAnalysis`) analyzes a video first
and drafts from the analysis (the analysis is a separate job you own,
`output_data.analysisJobId`). Throws `NotFoundError` on a platform that
predates the route. An instance that proxies its LLM calls to nodaro.ai
answers `503 provider_unavailable` permanently — surfaced as a generic
`NodaroError` with that code; treat it as unavailable here, not as transient.

```ts
const { jobId } = await client.llm.structuredJob({
  system, input: brief, jsonSchema, schemaName: "studio_production", origin: "studio", label: brief.slice(0, 80),
})
```

---

### `client.videoPro`

Run control for the segmented long-video engine ([Generate Video Pro](./nodes/ai-video/generate-video-pro.md), Cloud edition). Generation is dispatched like any node run; these act on an existing run.

#### `stop(jobId)`

```ts
stop(jobId: string): Promise<StopVideoProResult>
```

Gracefully stops a processing run: the in-flight segment is abandoned (still billed), remaining segments are skipped, the completed segments are stitched into the job's final video, and the untouched reserve is refunded. A job that hasn't started is cancelled with a full refund. Keep polling the job — it completes with `output_data.pro.stopped = true`.

```ts
await client.videoPro.stop(jobId)
const { data } = await client.jobs.getStatus(jobId) // → completed, partial video
```

#### `continueRun(jobId, opts?)`

```ts
continueRun(jobId: string, opts?: { fromSegment?: number }): Promise<ContinueVideoProResult>
```

Continues a stopped / failed / completed run as a **new job** — segments below `fromSegment` (1-based; default = first not-yet-delivered) are reused, everything from it on is regenerated. Billed only for the regenerated segments plus the flat pro fee. Returns the new `jobId` to poll.

```ts
const { jobId: childId, fromSegment } = await client.videoPro.continueRun(jobId, { fromSegment: 4 })
```

---

### `client.recast`

Recast runs + the authored-script import lane ("movie as JSON"). **Cloud
edition only** — these routes 404 on self-hosted installs. Full REST contract:
[API integration §13c–13d](./api-integration.md#13c-recast-cloud-edition);
authoring guide: [Recast authoring](./mcp/recast-authoring.md).

#### `authoringSkill()`

```ts
authoringSkill(): Promise<string>
```

`GET /v1/video-analysis/authoring-skill` → the generated authoring guide
(markdown): the script document contract, enum vocabularies, bounds, audio
rules, and a validated worked example. Free.

#### `validateScript(script)`

```ts
validateScript(script: Record<string, unknown>): Promise<RecastScriptValidation>
```

`POST /v1/video-analysis/import/validate` → `{ valid, errors, warnings }`.
Each error carries `path`, `message`, and usually a `hint` written for an LLM
repair loop — fix and re-validate until `valid: true`. Free, persists nothing.

#### `importScript(script, { rightsAttested: true })`

```ts
importScript(script: Record<string, unknown>, opts: { rightsAttested: true }): Promise<RecastScriptImportResult>
```

`POST /v1/video-analysis/import` → `{ jobId, created, warnings, json }`.
Stores the validated document as a completed analysis job; `json` is the
document **with server-derived fields** — always prefer it over your input.
Idempotent (`created: false` on an identical re-import). `rightsAttested:
true` is required (403 otherwise): authored recasts render **Faithful —
exactly as written**, so only import work you own. Free.

#### Run lane

```ts
estimate(input: EstimateRecastInput): Promise<RecastEstimate>        // quote credits, free
create(input: CreateRecastInput): Promise<{ recastId: string }>      // buys the plan
get(recastId: string): Promise<RecastRunSnapshot>                    // poll status + pending interactive step
estimateRescore(recastId: string, input: EstimateRecastRescoreInput): Promise<RecastRescoreQuote>
rescore(recastId: string, input: RecastRescoreRequestV2): Promise<RecastRescoreResponse>
start(recastId: string, opts?): Promise<{ gvpJobId?: string }>       // render a planned run (idempotent)
resolveGate(recastId: string, input: ResolveRecastGateInput): Promise<Record<string, unknown>>
```

`create` requires `workflowId` (an existing workflow you own) and
`analysisJobId`; quote with `estimate` first — creating buys the plan. On
interactive runs the platform advances every non-gate step server-side; poll
`get()` and answer pending gates (`cast` / `sheet` / `anchors` / `music`) with
`resolveGate` — the pick itself is free. Gates only open for gate kinds the
run's `create` declared in `clientCapabilities` (e.g. `["sheet-gate"]`);
undeclared kinds are decided automatically.

For a completed take, `get()` may also return
`capabilities.audioLayers: 1` and a server-authored
`RecastAudioManifestV1`. Its `present` object is the logical lane set;
`layers` contains the CORS-ready preview files that actually exist;
`bakedEffectiveGain` describes the current download; and
`pendingRescore` identifies a durable in-flight operation. Do not synthesize a
revision or infer baked contents from a missing preview derivative.

Use `estimateRescore()` before `rescore()` and pass the same complete desired
operation to both. The paid call additionally requires a UUID `requestId`; reuse
it only for an identical transport retry:

```ts
const status = await client.recast.get(recastId)
const revision = status.audio?.revision
if (status.capabilities?.audioLayers === 1 && revision) {
  const operation = {
    expectedAudioRevision: revision,
    mix: {
      music: { gain: 60, muted: false },
      video: { gain: 85, muted: false },
    },
  } satisfies EstimateRecastRescoreInput

  const quote = await client.recast.estimateRescore(recastId, operation)
  if (!quote.noOp) {
    const result = await client.recast.rescore(recastId, {
      ...operation,
      requestId: crypto.randomUUID(),
    })
    // Poll get(recastId); status.audio.pendingRescore is reload-safe.
    console.log(result)
  }
}
```

An operation may contain a mix, one Music replacement (`audioUrl` or
`sections`), or a replacement plus its desired mix. `RecastRescoreResponse` is
either `{ recastId, jobId }` or the job-free no-op response
`{ recastId, noOp: true, audioRevision }`. See
[API integration §13c](./api-integration.md#revisioned-audio-layers) for manifest
semantics, validation, compatibility, and `400` / `409` errors.

For a revisioned replacement, normally send the complete desired `mix`. Omitting
it is a narrow compatibility path and succeeds only for the exact fixed legacy
bake (bed Music 35 + Video 100, or replace Music 100); otherwise the server
returns `409 legacy_mix_mismatch`.

---

### `client.executions`

A "workflow execution" is one orchestrator-driven run of a workflow. It groups
N jobs (one per AI node) plus inline node states.

#### `get(id)`

```ts
get(id: string): Promise<{ data: WorkflowExecution }>
```

Returns the full execution including per-node state map. Falls back to a
synthetic single-node-job shape on the server when the ID matches a standalone
job.

```ts
const { data } = await client.executions.get(executionId)
console.log(data.status, data.completedNodes, data.totalNodes)
```

#### `listForWorkflow(workflowId, params?)`

```ts
listForWorkflow(
  workflowId: string,
  params?: ListExecutionsForWorkflowParams,
): Promise<ListExecutionsPage<WorkflowExecutionSummary>>
```

Cursor-paginated list of executions for one workflow. Merges proper executions
with standalone single-node jobs.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `limit` | `number` | Page size. |
| `cursor` | `string` | Opaque cursor from a previous page. |
| `status` | `string` | Comma-separated, e.g. `"pending,running"`. |
| `source` | `"editor" \| "all"` | `"editor"` excludes app-run / webhook / schedule executions. |

```ts
const { data, nextCursor } = await client.executions.listForWorkflow(
  workflowId,
  { limit: 20, status: "completed" },
)
```

#### `cancel(id, params?)`

```ts
cancel(id: string, params?: CancelExecutionParams): Promise<{ success: true }>
```

Cancels an execution. Three modes:

- **default** (no `mode`) — cancels immediately, killing in-flight jobs and
  refunding reserved credit holds (status `"cancelled"`).
- **`mode: "after_current"`** — sets the execution to `"stopping"` so in-flight
  nodes finish (and land on the canvas + My Library) before the run stops.
- **`mode: "discard"`** — stops scheduling new nodes WITHOUT cancelling in-flight
  jobs (external AI calls can't be killed mid-flight). Those jobs finish and are
  saved to My Library, but their results are detached from the live canvas
  (status `"discarded"`). No refund — the jobs completed.

```ts
await client.executions.cancel(executionId, { mode: "after_current" })
await client.executions.cancel(executionId, { mode: "discard" })
```

---

### `client.nodes`

Public node-metadata discovery. Both endpoints are publicly cacheable for 5
minutes server-side.

#### `list()`

```ts
list(): Promise<{ data: NodeDescriptor[] }>
```

Lists every node type the server supports.

```ts
const { data: nodes } = await client.nodes.list()
const imageGenerators = nodes.filter(n => n.category === "ai-image")
```

#### `get(type)`

```ts
get(type: string): Promise<{ data: NodeDescriptor }>
```

Fetches one descriptor by its type slug (e.g. `"generate-image"`,
`"generate-video"`).

```ts
const { data } = await client.nodes.get("generate-image")
console.log(data.providers, data.creditCost) // creditCost: Cloud only
```

#### `run(type, params?)`

```ts
run(type: string, params?: Record<string, unknown>): Promise<RunNodeResult>
```

Run a single node directly without wrapping it in a workflow. Posts `params`
as the request body to `POST /v1/<type>` — the route convention every
generation node follows (`generate-image`, `image-to-video`, `text-to-speech`,
etc.). This is the SDK equivalent of the MCP server's verb tools and the path
the Nodaro CLI uses for `nodaro nodes run <type>`.

Most node types are async: the response includes `{ jobId }` and the actual
generation runs on a worker. Poll `client.jobs.get(jobId)` until completed.
Inline node types (`combine-text`, etc.) return their full result synchronously
without a `jobId` field.

```ts
const result = await client.nodes.run("generate-image", {
  prompt: "a snow leopard in the mountains",
  provider: "recraft",
})
if ("jobId" in result) {
  const { data: job } = await client.jobs.get(result.jobId)
  console.log(job.output_data)
}
```

> **Parameter corrections.** For the image node types (`generate-image`,
> `image-to-image`, `edit-image`) the result may carry `adjustments` — one
> entry per parameter the server corrected because the chosen model does not
> accept the value you sent. The run proceeds with the corrected value and the
> credits reserved match it. `adjustments` is absent when nothing changed.
>
> ```ts
> const result = await client.nodes.run("generate-image", {
>   prompt: "a snow leopard",
>   provider: "gpt-image-2",
>   aspectRatio: "3:2",
> })
> if ("adjustments" in result && result.adjustments?.length) {
>   for (const a of result.adjustments) {
>     console.warn(`${a.field}: ${a.from} → ${a.to ?? "(dropped)"} — ${a.reason}`)
>   }
> }
> ```
>
> Full semantics: [Parameter corrections](./api-integration.md#4d-parameter-corrections-adjustments).

> **Seedance 2 video** (`run("text-to-video" | "generate-video", …)`):
> `seedance-2` (full) accepts `resolution: "4k"` and `aspectRatio: "adaptive"`
> (plus `"21:9"`); `seedance-2-fast` / `seedance-2-mini` are 480p / 720p only,
> and `seedance-2-5` spans 480p / 720p / 1080p (no 4K). `seedance-2-5` runs to **30s** in a single call (the rest
> stop at 15s) and takes 30 image / 10 video / 10 audio references; when a start
> frame is wired it renders at that frame's aspect and rejects an explicit
> `aspectRatio`.
> **MiniMax Hailuo 3** (`minimax-h3`) takes the same reference fields (9 images /
> 3 videos / 3 audio) at `resolution: "2K"` (default) or `"768P"` (cheaper
> per-second rate; any other value renders and bills as 2K) — ref-video input
> seconds bill like Seedance 2 at the selected tier's rate, and input images
> beyond the first 5 add a per-image surcharge (audio refs are free but must
> accompany an image/video ref).
> **Wan 3.0** (`wan-3`, `wan-3-prime`) takes 10 image / 5 video / 5 audio
> references, each video and audio clip 1–15 s and ≤ 15 s combined per type —
> but its reference arrays are **mutually exclusive with the start/end frame
> fields (`imageUrl` / `endFrameUrl`)**, so sending both is a conflict rather
> than the Seedance-style fold-in. `duration` is a whole number 2–30
> (default 5); `resolution` is `480p` / `720p` / `1080p` (send the lowercase
> display value — the platform
> normalizes to the provider's uppercase enum, and an omitted or unsupported
> value renders and bills at 720p); `aspectRatio` defaults to `"adaptive"`.
> Reference videos bill output seconds only here, and input + output duration
> must stay ≤ 30 s. `wan-3-prime` is the high-speed, higher-priced SKU on the
> same schema.
> **Gemini Omni Flash** (`gemini-omni-flash`) is the cheaper, faster sibling of
> `gemini-omni-video` on an identical request shape — same 4 / 6 / 8 / 10
> `duration` menu (8 s when omitted), same 720p / 1080p / 4K tiers, same
> 16:9 / 9:16-only aspect, same 7-unit input quota.
> `resolution` / `aspectRatio` are pass-through strings — an unsupported value
> is ignored, never a 400. Start/end frames and references can coexist (the
> frames become prompt-directed `Image N` references; the resolver picks the
> mode, no toggle). Reference videos are billed `unit × (input + output)`
> duration — the runtime ffprobes each `referenceVideoUrls` clip and scales the
> per-second `-ref` rate by the input-video plus output duration. Per-resolution
> rates are in the [Generate Video node docs](nodes/ai-video/generate-video.md).

> **Text to Speech provider default.** `run("text-to-speech", …)` and
> `runAndWait("text-to-speech", …)` default `provider` to `elevenlabs-v3`
> when omitted — but only when `text` is within v3's per-request cap
> (3,000 chars; see the per-model caps table in the
> [Text to Speech node docs](nodes/ai-audio/text-to-speech.md)). Text longer
> than that without an explicit `provider` falls back to `elevenlabs-turbo`
> (cap 40,000) instead, so legacy integrations that always omit `provider`
> don't get silently truncated by v3's tighter cap. An explicit `provider` is
> always respected regardless of text length (its own cap still clamps the
> stored record, unchanged).

> **Typed structured references.** `run("generate-image" | "generate-video", …)`
> have typed overloads — `GenerateImageParams` / `GenerateVideoParams` (both extend
> `StructuredReferenceParams`). Pass `connectedReferences: ConnectedReference[]` (the
> editor's wired-reference shape, re-exported from the SDK) + `referenceOrder` for
> labeled, ordered references the route assembles into `@image_N` directives —
> instead of hand-building a prose "Image N is …" guide. Each `ConnectedReference`
> may also carry an opt-in (default-off)
> `identityLock?: { enabled: boolean; text?: string }`: with `enabled: true` the
> route prepends a short identity-lock fidelity line for that reference (`text`
> overrides the built-in per-source wording; `{ref}` is the placeholder for the
> reference's binding — `reference image A` / `@image_N`), honored when the route
> assembles in the hybrid reference format. See the
> [Reference Roles guide](./reference-roles-guide.md) for the role-label + lock
> model.

> **Naming an image reference in the prompt.** On
> `run("generate-image", …)`, a media reference (`source: "wired-image"` or
> `"manual"`) is mentionable by the slug of its `defaultName` —
> `@<name-slug>:<index>[:<role>]`, e.g. `@town:1` or `@town:1:background`. The
> mention renders that reference's binding (or its role phrase) at the position
> you typed it, instead of leaving it in the trailing auto-attach block. There
> is no slug field to set: name the reference and it becomes mentionable, and
> the index is correlation only — never a seat you compute. `~lock` / `~nolock`
> apply as on character mentions. `@nodaro/shared` exports the grammar itself
> (`imageMentionSlug`, `parseImageMentionToken`, `findImageMentionTokens`,
> `knownImageSlugsFromRefs`) so a client can render the same preview the server
> will assemble, and `toConnectedReference({ kind: "image", … })` builds the
> reference entry. Honored in the hybrid reference format; under the legacy
> format the token stays literal text. See
> [API Integration](./api-integration.md) for the full grammar.

> **Cinematic direction by id.** `run("generate-image" | "generate-video" |
> "text-to-video", …)` also takes an optional `direction` object — a flat map of **catalog ids** (`shotSize`,
> `lightingStyle`, `style`, `mood`, `photographer`, `era`, …) the platform folds
> into the prompt as its own hint clauses — the look ones into a trailing
> `[style]:` section (a film line then a scene line), so you send ids and the
> wording stays
> platform-owned. Values are a single id or an array (multi-pick dimensions honor
> their own cap; exceeding a dimension's cap truncates rather than 400ing, while
> the wire bounds — 8 entries per key, 100 characters per id — do reject).
> Absent ≠ empty: a missing key means "no hint", an empty `direction` leaves your
> `prompt` untouched, and unknown keys / unknown ids are skipped silently rather
> than rejected — so deploy the platform before a client that starts sending new
> dimensions. Valid ids come from `client.pickerCatalogs.list()` (on a deployment
> with registered catalog packs, pack-added ids are listed and accepted but
> render no clause — only base-catalog ids fold). The video runs take the same
> object and add the motion dimensions (`cameraMotion`, which folds first,
> `actionFx`, the `temporal*` keys, `transition`, `loopSubject`); motion
> dimensions render as short terms and stay in the prompt body, where look
> dimensions render full clauses in the `[style]:` section, and
> a stills-only key sent to a video run is accepted and simply contributes
> nothing, so one look map serves both surfaces. `run("extend-video", …)` has no
> `direction` — its prompt continues an existing clip. Full key list and
> semantics in the
> [API integration guide](./api-integration.md#cinematic-direction-direction-on-generate-image)
> (video specifics:
> [the video routes](./api-integration.md#cinematic-direction-on-the-video-routes)).

> **Assemble Narrated Video.** `run("assemble-narrated-video", …)` also has a
> typed overload — `AssembleNarratedVideoParams`: `blocks: { videoUrl: string;
> audioUrl?: string }[]` (1–60, in play order) plus `voiceVolume` (0–200,
> default 100), `clipAudioVolume` (0–200, default 40), `maxSlowdown` (1–2,
> default 1.5), `trimStartFrames` / `trimEndFrames` (0–120, default 0). See the
> [Assemble Narrated Video node docs](nodes/processing-video/assemble-narrated-video.md)
> for the fit policy and credit formula (`3 + ceil(blocks / 6)`).
>
> **Reasoning effort.** LLM-backed feature routes accept an optional
> `reasoningEffort` field in the request body: `"none" | "low" | "medium" |
> "high" | "xhigh" | "max"`, model-dependent (see the model table in the
> [Generate Text node docs](nodes/ai-text/llm-chat.md#model-selector)). Omit
> it — or pick a level the model doesn't support — for the vendor default
> ("Auto"). `xhigh` and `max` bill **one tier up** (economy → standard,
> standard → premium); see
> [Reasoning effort](nodes/ai-text/llm-chat.md#reasoning-effort) for the
> exact rule and worked examples. Workflow/canvas LLM nodes carry the same
> field on their node `data` (`reasoningEffort?: LlmReasoningEffort`), and
> `client.promptHelper.*` accepts it directly in its request body.

> **Advanced mode.** The same routes accept `advancedMode: true` (Gemini models
> only), which runs the request on the provider's own API rather than through
> the aggregator. That is the only lane where `temperature`, `maxTokens` and the
> full reasoning-effort range actually take effect — on the default lane those
> levers are not reliably honoured. It bills **one credit tier up**, and this
> bump is independent of the effort bump above. A model with no direct lane
> returns `400 advanced_mode_unsupported`. Canvas LLM nodes carry the same field
> on their node `data` (`advancedMode?: boolean`), and the CLI exposes it as
> `--advanced`.
>
> `client.nodes.run(type, params)` POSTs `params` straight to `POST
> /v1/<type>` — that matches the registered route only for `generate-script`,
> `image-critic`, `qa-check`, and `describe-to-picker`. Other LLM-backed node
> types register at a nested path instead: `llm-chat` →
> `/v1/llm-chat/generate`, `after-effects` → `/v1/after-effects/generate`,
> `motion-graphics` → `/v1/motion-graphics/generate`, `lottie-overlay` →
> `/v1/lottie-overlay/generate`, `3d-title` → `/v1/3d-title/generate`,
> `image-to-text` → `/v1/image-to-text/describe`, `video-composer` →
> `/v1/scene-graph/generate`. For those, call `client.request("POST",
> "<path>", { body: params })` directly, or use `client.promptHelper.*`
> (always `/v1/prompt-helper/wizard`, regardless of node type).
>
> ```ts
> // Bare-path node type — client.nodes.run() posts directly to /v1/generate-script.
> await client.nodes.run("generate-script", {
>   prompt: "A 3-scene product launch script for a smart water bottle.",
>   llmModel: "gpt-5.6-sol",
>   reasoningEffort: "high",
> })
>
> // client.promptHelper.* takes the same field and works for any node type —
> // it always posts to /v1/prompt-helper/wizard.
> await client.promptHelper.enhance({
>   nodeType: "generate-image",
>   prompt: "a snow leopard in the mountains",
>   reasoningEffort: "high",
> })
> ```

> Every other node type keeps the generic `Record<string, unknown>` body —
> `generate-image`, `generate-video`, and `assemble-narrated-video` are
> currently the only three with dedicated typed params.

#### `runAndWait(type, params?, opts?)`

```ts
runAndWait(
  type: string,
  params?: Record<string, unknown>,
  opts?: RunAndWaitOptions,
): Promise<NodeJobOutput>
```

Runs a single async node to completion: calls `run()`, extracts the `jobId`,
then client-polls `jobs.getStatus(jobId)` every `opts.pollMs` (default 2000 ms)
until a terminal status, up to `opts.maxMs` (default ~15 min). A `pending_review`
status ends the poll on the first tick it is observed — with `JobHeldError`,
not by waiting out `maxMs` — because that status is a human's decision pending,
not the job's own progress.

Resolves the job's typed `output_data` (`NodeJobOutput`) on `completed`.

**`RunAndWaitOptions`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `signal` | `AbortSignal` | — | Abort the poll loop; rejects with `JobAbortedError`. |
| `onProgress` | `(status: JobStatusResult) => void` | — | Called with each lean status observed. |
| `pollMs` | `number` | `2000` | Poll interval in ms. |
| `maxMs` | `number` | `900_000` | Wall-clock cap before `JobTimeoutError`. |

Throws (all typed, catchable by `instanceof`):
- `InsufficientCreditsError` / `StorageExceededError` — surfaced by `run()` before any poll.
- `JobFailedError` — terminal `failed`/`cancelled` (carries `error_message` + `jobId`).
- `JobTimeoutError` — `maxMs` deadline exceeded.
- `JobAbortedError` — `signal` fired.
- `JobHeldError` — the job entered `pending_review` (`code = "job_held"`, carries `jobId`; see
  [Errors](#class-jobhelderror-extends-nodaroerror)). Only on
  deployments that register a job policy. It does NOT cancel the job: the
  output exists and a human is reviewing it, and the reservation stays
  `reserved` for the whole hold. Do not re-run the request — a duplicate would
  be held too. Re-fetch with `jobs.get(jobId)` later: it resolves to
  `completed` (approved), `failed` (rejected, with
  `error_hint.kind === "policy-block"` and a user-safe `reason`) or
  `cancelled` (you cancelled it — a held job is cancellable like any in-flight
  job), or surface "awaiting review" to your user and poll `jobs.getStatus()`
  yourself.
- `JobBlockedError` — surfaced by `run()` before any poll: the deployment's
  job policy refused the generation (HTTP 422 `job_blocked`, see
  [Errors](#class-jobblockederror-extends-nodaroerror)).

> **Slow recoveries can outlive the default `maxMs`.** If the platform's worker
> abandons a job after the provider already delivered, the job stays
> `processing` while the reconcile system self-heals it — the status payload
> carries `recovering: true` during that window, and recovery can take tens of
> minutes for slow models. A `JobTimeoutError` does NOT cancel the job: it
> usually still completes server-side and lands in your library; re-fetch with
> `jobs.get(jobId)` later, or raise `maxMs` for long-running models.

```ts
const output = await client.nodes.runAndWait("generate-image", {
  prompt: "a snow leopard in the mountains",
  provider: "recraft",
})
console.log(output.imageUrl)
```

#### `runMany(type, paramsList, opts?)`

```ts
runMany(
  type: string,
  paramsList: Record<string, unknown>[],
  opts?: RunAndWaitOptions,
): Promise<RunManyResult[]>
```

Fan out N async runs of the same node type concurrently — the candidate-grid
path (generate N stills/clips in parallel). Each runs via `runAndWait()`;
resolves once ALL settle, to an array of `{ jobId, output }` in input order.
Rejects if any single run rejects. A shared `signal` aborts the whole batch.

```ts
const results = await client.nodes.runMany("generate-image", [
  { prompt: "snow leopard, sunrise" },
  { prompt: "snow leopard, golden hour" },
  { prompt: "snow leopard, blue hour" },
])
for (const { jobId, output } of results) {
  console.log(jobId, output.imageUrl)
}
```

---

### `client.models`

#### `list(options?)`

```ts
list(opts?: { kind?: "image" | "video" | "audio"; mode?: string; family?: string; featuredOnly?: boolean }): Promise<ModelsListResult>
```

`GET /v1/models` → the model catalog grouped by kind and vendor family:
capability sheets (`modes`, `features`, `aspectRatios`, `resolutions`,
`durations`), per-variant credit `pricing` (Cloud only — editions without a
credit system omit the field), compact `promptTips`, and the
`doctrineCovered` truth flag — `true` only when a sourced per-family prompt
doctrine exists for the model, so "vendor doctrine" badges can never
overclaim. The same projection the MCP `list_models` tool serves, so the two
surfaces cannot drift. Public endpoint; cached 5 minutes.

```ts
const catalog = await client.models.list({ kind: "video", mode: "i2v" })
for (const section of catalog.sections)
  for (const family of section.families)
    for (const m of family.models) console.log(m.id, m.doctrineCovered)
```

---

### `client.characters`

Script the full character lifecycle — identity edits, portrait + asset
generation, motion clips, and LLM-captioned approval.

A "character" is the canonical identity row that Character Studio drives
(`characters` table). Each row carries the portrait URL, six asset buckets
(`expressions`, `poses`, `motions`, `angles`, `bodyAngles`,
`lightingVariations`), reference photos, and the LLM caption that anchors
identity in downstream prompts.

#### `list(params?)`

```ts
list(params?: ListCharactersParams): Promise<{ characters: Character[] }>
```

Lists the caller's characters. By default returns active characters only;
pass `archived: true` for an "archive" view. `projectId` further restricts
to a single project. `limit` caps the result (server default 100, max 500).

Cursor-paginated — one call returns **at most `limit` rows**, so a single
call is not "all characters" for anyone above that count. Page until
`nextCursor` is `null`:

```ts
const all: Character[] = []
let cursor: string | undefined
do {
  const page = await client.characters.list({ projectId, cursor })
  all.push(...page.characters)
  cursor = page.nextCursor ?? undefined
} while (cursor)
```

A single page, when that is all you need:

```ts
const { characters, nextCursor } = await client.characters.list({ projectId, limit: 50 })
```

`nextCursor` is opaque — echo it back as `cursor`, never parse or persist it.
The underlying keyset is `(created_at, id)` ordered `DESC`, so rows sharing a
`created_at` are not skipped at page boundaries. A malformed cursor throws a
`validation_error` rather than silently restarting from page 1.

#### `get(id)`

```ts
get(id: string): Promise<CharacterDetail>
```

Fetches a single character + three live-progress buckets
(`pendingJobs`, `portraitCandidates`, `previousCandidates`) the studio uses
to rehydrate spinners after a reload.

```ts
const character = await client.characters.get(characterId)
```

Soft-deleted characters are returned by id intentionally so canvas nodes
that hold a stale `characterDbId` keep loading.

#### `upsert(input)` / `create(input)` / `update(id, input)`

```ts
upsert(input: UpsertCharacterInput): Promise<{ id: string; name?: string }>
create(input: Omit<UpsertCharacterInput, "id"> & { name: string }): Promise<{ id: string; name?: string }>
update(id: string, input: Omit<UpsertCharacterInput, "id">): Promise<{ id: string; name?: string }>
```

`upsert()` creates when `input.id` is omitted and updates when it is set.
`create()` and `update()` are thin wrappers that pin `id` for you. On UPDATE
only the fields you supply are written; omitted fields are not touched —
including `name`, which is optional on UPDATE (the route accepts partial
updates without forcing you to re-send the existing name).

Name collisions return 409 `name_taken`. To auto-number a placeholder, pass
the placeholder name imported from `@nodaro/shared`.

```ts
const { id } = await client.characters.create({
  nodeId: "scripted",
  name: "Kira",
  description: "young protagonist with auburn hair",
  style: "realistic",
  seedPrompt: "kira portrait, warm natural lighting",
  identityLock: "strict", // off | soft | strict — face-preservation strength for Studio asset generation (default strict)
})
```

#### `delete(id)`

```ts
delete(id: string): Promise<{ success: true; archived: true }>
```

Soft-deletes (archives) a character. The row is hidden from `list()` by
default but still loadable via `get(id)`. Use `restore(id)` to un-archive.

#### `restore(id)`

```ts
restore(id: string): Promise<{ id: string; name: string }>
```

Un-archives a soft-deleted character. If the name now collides with another
active character, the server auto-suffixes `"(restored)"` and returns the
effective name.

#### `duplicate(id, input?)`

```ts
duplicate(id: string, input?: DuplicateCharacterInput): Promise<{ id: string; name: string }>
```

Forks a character to a new row with `"(copy)"` suffix. Asset URLs are
shared by reference; the new row diverges by regenerating any of them.

#### `usage(id)`

```ts
usage(id: string): Promise<CharacterUsage>
```

Returns the count of workflows that reference this character. Powers the
library's "Archive" confirmation modal.

#### `generate(input)`

```ts
generate(input: GenerateCharacterInput): Promise<{ jobId: string; jobIds: string[] }>
```

Fires the portrait-generation pipeline (`POST /v1/generate-character`).
With `count > 1`, all jobs are reserved up-front before any is enqueued —
mid-batch failures roll back atomically.

When `attachToCharacterId` is set, the worker writes the result directly to
the row's `source_image_url`; for multi-candidate runs, use `approvePortrait()`
to pick a candidate.

Optional `quality` (`"medium"` / `"high"` / `"basic"`) and `resolution`
(`"1K"` / `"2K"` / `"4K"` / `"0.5 MP"` / `"1 MP"` / `"2 MP"` / `"4 MP"`)
select the image model's output tier and are **credit-affecting** — they price
exactly like Generate Image (composite ids such as `gpt-image:high` /
`nano-banana-pro:4K`, so a 4K/high run reserves more than the model's base
cost). A value the chosen model doesn't support is ignored, never rejected.
`generateAsset()` accepts the same two fields.

```ts
const { jobIds } = await client.characters.generate({
  name: "Kira",
  seedPrompt: "kira portrait, warm natural lighting",
  count: 4,
  attachToCharacterId,
  provider: "gpt-image",
  quality: "high", // credit-affecting: prices as gpt-image:high
})
```

#### `generateAsset(input)`

```ts
generateAsset(input: GenerateAssetInput): Promise<{ jobId: string }>
```

Generates a single expression / pose / lighting / angle variant from the
character's anchor portrait. Pass the `attachTo*` triple to auto-append
the result to the row's named bucket on completion.

```ts
await client.characters.generateAsset({
  name: "Kira",
  assetType: "expressions",
  variant: "smile",
  attachToCharacterId,
  attachToColumn: "expressions",
  attachName: "smile",
})
```

#### `generateMotion(input)`

```ts
generateMotion(input: GenerateMotionInput): Promise<{ jobId: string }>
```

Animates the character's portrait into a motion clip via Generate Video (image-to-video mode).
The result is appended to the `motions[]` bucket when
`attachToCharacterId` is set. The route can fall back to the row's anchor
portrait when `sourceImageUrl` is omitted.

```ts
await client.characters.generateMotion({
  name: "Kira",
  motionPrompt: "slow head turn left, soft smile",
  provider: "kling",
  attachToCharacterId,
  attachName: "head turn",
})
```

#### `approvePortrait(id, candidateJobId)`

```ts
approvePortrait(id: string, candidateJobId: string): Promise<ApprovePortraitResult>
```

Picks a completed `generate()` candidate as the character's canonical
portrait. Sets `source_image_url` and fires an LLM caption (Claude Sonnet
vision) inline. Returns the new portrait URL plus the caption.

`canonicalDescription` is `null` when the LLM call sub-failed (portrait
still set — retry with `recaption()`).

```ts
const { portraitUrl, canonicalDescription } =
  await client.characters.approvePortrait(characterId, candidateJobId)
```

#### `recaption(id)`

```ts
recaption(id: string): Promise<{ canonicalDescription: string }>
```

Re-runs the LLM caption against the current portrait. Returns 400
`no_portrait` if none is set; 502 on LLM failure.

```ts
const { canonicalDescription } = await client.characters.recaption(characterId)
```

---

### `client.locations`

Script the full location lifecycle — identity edits, establishing-shot +
variant generation, atmosphere motion clips, and LLM-captioned approval.

A "location" is the canonical environment row that Location Studio drives
(`locations` table). Each row carries the main image URL, six asset buckets
(`timeOfDay`, `weather`, `seasons`, `angles`, `lighting`,
`atmosphereMotions`), reference photos, and the LLM caption that anchors
the setting in downstream prompts. See
[Location Platform](location-platform.md) for the full data-model
walkthrough.

#### `list(params?)`

```ts
list(params?: ListLocationsParams): Promise<{ locations: Location[]; nextCursor?: string | null }>
```

Lists the caller's locations. By default returns active locations only;
pass `archived: true` for an "archive" view.

Pagination is **opt-in**: without `limit` you get the full legacy listing
and no `nextCursor`; with `limit` (max 500) you get one page plus a
`nextCursor` to pass back as `cursor` — loop until it is `null`, the same
pattern as `characters.list()`.

```ts
const { locations } = await client.locations.list()
const { locations: archived } = await client.locations.list({ archived: true })
const page = await client.locations.list({ limit: 100 })          // page 1
const next = await client.locations.list({ limit: 100, cursor: page.nextCursor! })
```

#### `listArchived(params?)`

```ts
listArchived(params?: Omit<ListLocationsParams, "archived">): Promise<{ locations: Location[] }>
```

Convenience wrapper for `list({ archived: true })`. Returns soft-deleted
rows so callers can drive a UI "Archived" tab without re-encoding the
query param. Mirrors `client.objects.listArchived`.

```ts
const { locations: archived } = await client.locations.listArchived()
```

#### `get(id)`

```ts
get(id: string): Promise<LocationDetail>
```

Fetches a single location including `pendingJobs` (in-flight asset
generations the studio uses to rehydrate spinners after a reload) and
`previousCandidates` (completed candidate main images whose URL differs from
the current `sourceImageUrl`, newest first, max 5 — the "pick from N / keep the
original" strip; promote one with `approveMainImage(id, jobId)`).
Soft-deleted locations are returned by id intentionally so canvas nodes
that hold a stale `locationDbId` keep loading.

```ts
const location = await client.locations.get(locationId)
```

#### `create(input)` / `update(id, input)`

```ts
create(input: CreateLocationInput): Promise<{ id: string }>
update(id: string, input: UpdateLocationInput): Promise<UpdateLocationResult>
```

`create()` requires `name` + `nodeId` (the route 400s otherwise). For MCP /
SDK callers without a canvas node, use the `"mcp-managed"` sentinel.

`update()` is a partial — only the fields you pass get written. Worker-
owned asset buckets are intentionally NOT exposed on this surface (a stale
snapshot save would clobber `append_location_asset` writes from a worker).

**`UpdateLocationInput` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Location name. |
| `description` | `string` | Free-text description. |
| `category` | `string` | Location category. |
| `style` | `string` | Visual style (e.g. `"realistic"`, `"anime"`). |
| `sourceImageUrl` | `string` | Main establishing-shot URL. |
| `referencePhotos` | `LocationReferencePhoto[]` | Mood-board refs (cap 20). |
| `canonicalDescription` | `string` | LLM-authored caption. |
| `styleLock` | `boolean` | Whether asset gens should anchor to canonical style. |
| `piiConsentAt` | `string` | ISO-8601 timestamp recording when PII consent was captured for reference photos. |
| `expectedUpdatedAt` | `string` | Optimistic-concurrency token (row's current `updated_at`). |

Optimistic-concurrency: pass `expectedUpdatedAt` to require the row's
`updated_at` still matches; on mismatch the route returns 409
`concurrent_modification`. The SDK surfaces that as a generic `NodaroError`
with the same code — catch it, re-fetch, merge, and retry.

```ts
const { id } = await client.locations.create({
  nodeId: "mcp-managed",
  name: "Rainy Tokyo Alley",
  description: "Neon-soaked alley with vending machines",
  category: "urban",
  style: "realistic",
})

await client.locations.update(id, {
  canonicalDescription: "...",
  styleLock: false,
  // PII consent for reference photos (Phase 2 #7) — set when first
  // attaching `referencePhotos` to record that the user has rights.
  piiConsentAt: new Date().toISOString(),
  expectedUpdatedAt: location.updatedAt,
})
```

#### `delete(id)` / `restore(id)`

```ts
delete(id: string): Promise<{ success: true; archived: true }>
restore(id: string): Promise<{ id: string; name: string }>
```

Soft-delete + un-archive. `delete()` is the only delete operation the SDK
exposes; permanent destruction is UI-only by design. If a restored name
collides (case-insensitive) with an active row, the server auto-suffixes
`(restored)` and returns the effective name.

```ts
await client.locations.delete(locationId)
const { name } = await client.locations.restore(locationId)
```

#### `generate(input)`

```ts
generate(input: GenerateLocationInput): Promise<GenerateLocationResult>
```

Fires `POST /v1/generate-location` to produce one or more candidate
establishing-shot images. With `count > 1`, all jobs are reserved up-front
before any is enqueued — mid-batch failures roll back atomically.

When `attachToLocationId` is set AND `count === 1`, the worker writes the
result directly to the row's `source_image_url`; otherwise call
`approveMainImage()` after picking a candidate.

Optional `quality` (`"medium"` / `"high"` / `"basic"`) and `resolution`
(`"1K"` / `"2K"` / `"4K"` / `"0.5 MP"` / `"1 MP"` / `"2 MP"` / `"4 MP"`)
select the image model's output tier and are **credit-affecting** — they price
exactly like Generate Image (composite ids such as `gpt-image:high` /
`nano-banana-pro:4K`, so a 4K/high run reserves more than the model's base
cost). A value the chosen model doesn't support is ignored, never rejected.
`generateAsset()` accepts the same two fields.

```ts
// Single candidate — auto-attaches on completion
const { jobId } = await client.locations.generate({
  name: "Rainy Tokyo Alley",
  description: "Neon-soaked alley with vending machines",
  attachToLocationId: locationId,
})

// Multi-candidate
const { jobIds } = await client.locations.generate({
  name: "Rainy Tokyo Alley",
  count: 4,
})
```

#### `generateAsset(input)`

```ts
generateAsset(input: GenerateLocationAssetInput): Promise<{ jobId: string }>
```

Fires `POST /v1/generate-location-asset` to produce a single variant.
`assetType` is one of `timeOfDay` / `weather` / `seasons` / `angles` /
`lighting` / `custom`. When the studio path is set (`attachToLocationId` +
`attachToColumn` + `attachName`), the worker appends `{ name: attachName,
url: <result> }` to the named JSONB bucket on completion.

```ts
const { jobId } = await client.locations.generateAsset({
  name: "Rainy Tokyo Alley",
  assetType: "weather",
  variant: "storm",
  attachToLocationId: locationId,
  attachToColumn: "weather",
  attachName: "storm",
})
```

#### `generateSurroundContinuation(input)`

```ts
generateSurroundContinuation(input: GenerateSurroundContinuationInput): Promise<{ jobId: string }>
```

> **Cloud edition only.** The route is registered on every edition, but
> Community/Business requests get an immediate `403 edition_required` before
> any processing happens.

Fires `POST /v1/generate-surround-continuation` to produce the next seamless
360° ring view as an image-to-image continuation of `referenceImageUrl` (the
previous ring view). The platform builds the half-carry composite server-side
(carry the reference's trailing half per `direction`, gray the rest), paints the
gray region, then color-harmonizes the painted half to the carried half so there
is no tonal seam down the frame's center — the carried half stays pixel-exact, so
adjacent ring views stitch perfectly. `direction` is `right` / `up` / `down`;
`carriedFraction` defaults to `0.5`. When the studio path is set, the worker
appends the result to the location's bucket (studio uses `attachToColumn:
"angles"`, `attachName: "Surround 45°"`).

```ts
const { jobId } = await client.locations.generateSurroundContinuation({
  referenceImageUrl: previousRingView,
  direction: "right",
  degrees: 45,
  provider: "nano-banana-pro",
  aspectRatio: "16:9",
  attachToLocationId: locationId,
  attachToColumn: "angles",
  attachName: "Surround 45°",
})
```

#### `generateMotion(input)`

```ts
generateMotion(input: GenerateLocationMotionInput): Promise<{ jobId: string }>
```

Fires `POST /v1/generate-location-motion` to animate the location's
establishing shot into an atmospheric motion clip (Generate Video,
image-to-video mode). The attach column is hardcoded server-side to
`atmosphere_motions` (locations have a single motion bucket so callers
don't supply `attachToColumn`).

```ts
// New atmosphere clip from the approved main image
const { jobId } = await client.locations.generateMotion({
  name: "Rainy Tokyo Alley",
  motionPrompt: "slow dolly-in, neon signs flicker, light rain falling",
  sourceImageUrl: mainImageUrl,
  provider: "kling",
  attachToLocationId: locationId,
  attachName: "neon dolly-in",
})
```

#### `approveMainImage(id, candidateJobId)`

```ts
approveMainImage(id: string, candidateJobId: string): Promise<ApproveMainImageResult>
```

Approves a completed `generate()` candidate as the location's main image.
Sets `source_image_url` + fires the LLM caption (Claude Sonnet vision)
inline. Returns the new main-image URL plus the caption.

Caption-failure semantics: `canonicalDescription` is `null` when the LLM
sub-call failed (the wire sends `""`, but the SDK normalizes `""` → `null`
before returning so callers see `string | null`). The main image is still set;
call `recaption()` to retry.

```ts
const { sourceImageUrl, canonicalDescription } =
  await client.locations.approveMainImage(locationId, candidateJobId)
```

#### `recaption(id)`

```ts
recaption(id: string): Promise<RecaptionLocationResult>
```

Re-fires the LLM caption against the location's current main image. 502s
on LLM failure (unlike `approveMainImage` which preserves the side-effect
and normalizes the caption to `null`); 400 `no_source_image` if no main
image is set yet.

```ts
const { canonicalDescription } = await client.locations.recaption(locationId)
```

---

### `client.objects`

Script the full object (prop / product / vehicle / etc.) lifecycle —
identity edits, main-image + variant generation, motion clips, and
LLM-captioned approval.

An "object" is the canonical product / prop row that Object Studio
drives (`objects` table). Each row carries the main image URL, four asset
buckets (`angles`, `materials`, `variations`, `motionClips`), reference
photos, and the LLM caption that anchors the prop in downstream prompts.
See [Object Platform](object-platform.md) for the full data-model
walkthrough.

#### `list(params?)`

```ts
list(params?: ListObjectsParams): Promise<{ objects: Object[] }>
```

Lists the caller's objects. By default returns active objects only; pass
`archived: true` for an "archive" view. Optional `projectId` scopes the
result to a single project.

Pagination is **opt-in**: without `limit` you get the full legacy listing
and no `nextCursor`; with `limit` (max 500) you get one page plus a
`nextCursor` to pass back as `cursor` — loop until it is `null`, the same
pattern as `characters.list()`. Applies to `creatures.list()` identically.

```ts
const { objects } = await client.objects.list()
const { objects: archived } = await client.objects.list({ archived: true })
const page = await client.objects.list({ limit: 100 })            // page 1
const next = await client.objects.list({ limit: 100, cursor: page.nextCursor! })
```

> `Object` shadows the JS global, which TypeScript handles cleanly via
> local-scope resolution. Callers who need both can alias as
> `import type { Object as NodaroObject } from "@nodaro/sdk"`.

#### `listArchived(params?)`

```ts
listArchived(params?: Omit<ListObjectsParams, "archived">): Promise<{ objects: Object[] }>
```

Convenience wrapper for `list({ archived: true })`. Returns soft-deleted
rows so callers can drive a UI "Archived" tab without re-encoding the
query param.

```ts
const { objects } = await client.objects.listArchived()
```

#### `get(id)`

```ts
get(id: string): Promise<ObjectDetail>
```

Fetches a single object including `pendingJobs` (in-flight asset
generations the studio uses to rehydrate spinners after a reload).

Soft-deleted (archived) objects are NOT returned by id — the route
enforces `deleted_at IS NULL` and surfaces archived rows as a uniform 404
`not_found`. The SDK throws `NotFoundError`.

```ts
const object = await client.objects.get(objectId)
```

#### `create(input)` / `update(id, input)`

```ts
create(input: CreateObjectInput): Promise<{ id: string }>
update(id: string, input: UpdateObjectInput): Promise<UpdateObjectResult>
```

`create()` requires `name` + `nodeId` (the route 400s otherwise). For MCP /
SDK callers without a canvas node, use the `"mcp-managed"` sentinel.

`update()` is a partial — only the fields you pass get written. Worker-
owned asset buckets are intentionally NOT exposed on this surface (a stale
snapshot save would clobber `append_object_asset` writes from a worker).

Optimistic-concurrency: pass `expectedUpdatedAt` to require the row's
`updated_at` still matches; on mismatch the route returns 409
`concurrent_modification`. The SDK surfaces that as a generic `NodaroError`
with the same code — catch it, re-fetch, merge, and retry.

> Objects do **not** carry a `piiConsentAt` field. Reference photos on
> object rows attach without a dedicated consent gate (unlike locations
> Phase 2 #7, objects are inanimate by definition).

```ts
const { id } = await client.objects.create({
  nodeId: "mcp-managed",
  name: "Antique Lantern",
  description: "Weathered brass lantern with hand-engraved filigree",
  category: "tool",
  style: "realistic",
})

await client.objects.update(id, {
  canonicalDescription: "...",
  styleLock: false,
  expectedUpdatedAt: object.updatedAt,
})
```

#### `delete(id)` / `restore(id)`

```ts
delete(id: string): Promise<{ success: true; archived: true }>
restore(id: string): Promise<{ id: string; name: string }>
```

Soft-delete + un-archive. `delete()` is the idempotent soft path —
repeating it on an already-archived row is a no-op. If a restored name
collides (case-insensitive) with an active row, the server auto-suffixes
`(restored)` and returns the effective name.

```ts
await client.objects.delete(objectId)
const { name } = await client.objects.restore(objectId)
```

#### `permanentDelete(id)`

```ts
permanentDelete(id: string): Promise<{ success: true; permanent: true }>
```

Hard-delete (permanent) an object — the row + every R2 asset it
references. Archived rows ONLY: active objects return 400 `not_archived`.
Call `delete()` first to archive, then `permanentDelete()` to destroy.

Mirrors the `app_runs` permanent-delete pattern (archive-first) so a
stray SDK / curl caller cannot bypass the studio's archive-first UI flow.

```ts
await client.objects.delete(objectId)
await client.objects.permanentDelete(objectId)
```

The MCP surface intentionally omits this operation — destructive ops
driven by an LLM are unsafe to expose.

#### `generate(input)`

```ts
generate(input: GenerateObjectInput): Promise<GenerateObjectResult>
```

Fires `POST /v1/generate-object` to produce one or more candidate main
images. With `count > 1`, all jobs are reserved up-front before any is
enqueued — mid-batch failures roll back atomically.

When `attachToObjectId` is set AND `count === 1`, the worker writes the
result directly to the row's `source_image_url`; otherwise call
`approveMainImage()` after picking a candidate.

`GenerateObjectResult` **always** returns `{ jobIds: string[] }` (one id per
candidate). `jobId?` is a deprecated `count === 1` back-compat alias — prefer
`jobIds`. Iterate `result.jobIds` regardless of `count`:

```ts
// Single candidate — auto-attaches on completion
const result = await client.objects.generate({
  name: "Antique Lantern",
  description: "Weathered brass lantern",
  attachToObjectId: objectId,
})

// jobIds is always present — one entry per candidate
for (const jobId of result.jobIds) {
  // poll each candidate (worker auto-attaches on completion when count === 1)
}
```

`seedPromptHint` (parameter-picker pass-through) is a top-level field —
pass it to compose a catalog selection (e.g. "antique brass lantern" from
the Material picker) into the generated prompt.

#### `generateAsset(input)`

```ts
generateAsset(input: GenerateObjectAssetInput): Promise<{ jobId: string }>
```

Fires `POST /v1/generate-object-asset` to produce a single variant.
`assetType` is one of `angles` / `materials` / `variations` / `motion` /
`custom`. When the studio path is set (`attachToObjectId` +
`attachToColumn` + `attachName`), the worker appends
`{ name: attachName, url: <result> }` to the named JSONB bucket on
completion.

**Studio-gated LLM draft:** when `attachToObjectId` is set and
`description` is omitted, the route first invokes an LLM to draft a
per-variant prompt fragment off the parent object's
`canonical_description` + the new variant name. Without `attachToObjectId`,
the route trusts the caller-supplied prompt as-is.

> `attachToColumn` is REQUIRED for `assetType === "custom"` — the worker
> can't infer the bucket from the asset type. For canonical asset types
> (`angles` / `materials` / `variations` / `motion`), the column is
> derived automatically by the route.

```ts
const { jobId } = await client.objects.generateAsset({
  name: "Antique Lantern",
  assetType: "materials",
  variant: "gold",
  attachToObjectId: objectId,
  attachToColumn: "materials",
  attachName: "gold",
})
```

#### `generateMotion(input)`

```ts
generateMotion(input: GenerateObjectMotionInput): Promise<{ jobId: string }>
```

Fires `POST /v1/generate-object-motion` to animate the object's main
image into a motion clip (Generate Video, image-to-video mode). The
attach column is hardcoded server-side to `motion_clips` (objects have
a single motion bucket so callers don't supply `attachToColumn`).

Object-specific defaults vs location:

- `provider` defaults to `"kling-turbo"` (not location's `"kling"`).
- `aspectRatio` defaults to `"1:1"` server-side via
  `resolveObjectAspectRatio({ assetType: "motion" })` — objects are
  product-showcase framing, not cinematic establishing shots. Objects
  have their own 5-value `ObjectAspectRatio` enum
  (`1:1` / `3:4` / `16:9` / `9:16` / `4:3`) with `4:3` added vs. the
  character set to support classic product-catalogue aspect ratios.

Pass `refineFromVideoUrl` to route through video-to-video using that clip
as the source instead of running Generate Video from `sourceImageUrl` —
use to iterate an existing clip with a new prompt without shifting
composition.

> `sourceImageUrl` is REQUIRED. Image-to-video needs a source frame and
> the route has no fallback — supply the canonical product-shot URL
> explicitly.

```ts
// New motion clip from the approved main image
const { jobId } = await client.objects.generateMotion({
  name: "Antique Lantern",
  motionPrompt: "slow 360 rotation, soft golden rim light",
  sourceImageUrl: mainImageUrl,
  provider: "kling-turbo",
  attachToObjectId: objectId,
  attachName: "rotate-360",
})

// Refine an existing clip (video-to-video)
const { jobId: refineJobId } = await client.objects.generateMotion({
  name: "Antique Lantern",
  motionPrompt: "same shot but slow hover instead of rotation",
  sourceImageUrl: mainImageUrl,
  refineFromVideoUrl: existingRotationClipUrl,
  provider: "wan-i2v",
  attachToObjectId: objectId,
})
```

#### `approveMainImage(id, candidateJobId, expectedUpdatedAt?)`

```ts
approveMainImage(
  id: string,
  candidateJobId: string,
  expectedUpdatedAt?: string,
): Promise<ApproveObjectMainImageResult>
```

Approves a completed `generate()` candidate as the object's main image.
Sets `source_image_url` + fires the LLM caption (Claude Sonnet vision)
inline. Returns the new main-image URL plus the caption.

Caption-failure semantics: `canonicalDescription` is `null` when the LLM
sub-call failed (the wire sends `""`, but the SDK normalizes `""` → `null`
before returning so callers see `string | null`). The main image is still set;
call `recaption()` to retry.

Optimistic-concurrency: pass `expectedUpdatedAt` to gate the update on
the row's current `updated_at`; on mismatch the route returns 409
`concurrent_modification` carrying the fresh token.

```ts
const { sourceImageUrl, canonicalDescription } =
  await client.objects.approveMainImage(objectId, candidateJobId)
```

#### `recaption(id)`

```ts
recaption(id: string): Promise<RecaptionObjectResult>
```

Re-fires the LLM caption against the object's current main image. 502s
on LLM failure (unlike `approveMainImage` which preserves the side-effect
and normalizes the caption to `null`); 400 `main_image_required` if no
main image is set yet.

The route is a **pure idempotent retry** — it does NOT accept an
`expectedUpdatedAt` parameter (per Phase E1 calibration finding: backend
route is idempotent retry, not gated on optimistic-concurrency). The
method signature is therefore `recaption(id)` with no second argument.

```ts
const { canonicalDescription } = await client.objects.recaption(objectId)
```

---

### `client.creatures`

Creature library CRUD (`/v1/creatures`) — the creature row is a structural
sibling of objects (angles / poses / variations / motionClips buckets,
`species` free-text delta) with two creature-specific additions:

- **`boards`** — named Creature Boards (`Array<{ name, url }>`, max 24):
  dense reference sheets rendered by the `generate-image/creature-board`
  factory preset, one per variant/mood. USER-owned: flows through create and
  update (whole-array replace), unlike the worker-owned asset buckets.
  Community publish snapshots boards and clones hand each consumer their own
  copy to extend.
- **`voice`** — the "talking creature" stack (`CreatureVoice | null`),
  IDENTICAL in shape and flow to `Character["voice"]`:
  `{ voiceId, voiceName, traits, voiceType?, previewUrl?, ttsProvider? }`.
  Pass `voice: null` on update to clear. On community publish the voice
  carries by KIND exactly like characters — premade + library voices carry
  fully; custom clones reduce to display name + preview sample (never a
  usable `voiceId` cross-user).

**Making a creature talk** — the speech routes are generic, so no
creature-specific endpoints exist (or are needed); drive them through the
node runner exactly like Boards drive generate-image:

```ts
// 1. Render speech with the creature's voice.
const speech = await client.nodes.runAndWait("text-to-speech", {
  text: "I knocked the vase off the shelf. I regret nothing.",
  voice: creature.voice!.voiceId,
  provider: creature.voice!.ttsProvider,
  voiceType: creature.voice!.voiceType,
})
// 2. Lip-sync the audio onto the creature's main image.
const clip = await client.nodes.runAndWait("lip-sync", {
  imageUrl: creature.sourceImageUrl!,
  audioUrl: speech.audioUrl,
  provider: "kling-avatar",
})
```

The same node also **dubs an existing video** — pass `videoUrl` + a video-input
provider instead of an image. `volcengine-lipsync` is the cheapest dubbing option
and the only one with multi-speaker support (extra fields pass straight through to
the route; via the CLI use `--param videoUrl=… --param provider=volcengine-lipsync …`):

```ts
const dub = await client.nodes.runAndWait("lip-sync", {
  videoUrl: "https://…/scene.mp4",
  audioUrl: "https://…/new-vocal.mp3",
  provider: "volcengine-lipsync",
  mode: "basic",          // complex scenes
  openScenedet: true,     // multi-speaker: scene detection + speaker ID (basic mode)
  audioDurationSec: 42,   // buckets per-second pricing; absent → 5-min ceiling, no refund
})
```

Binding a creature into a shot uses the shared reference contract:
`toConnectedReference({ kind: "creature", id, name, url, description })`
(from `@nodaro/shared`) emits a `wired-creature` reference — it auto-attaches
to generate-image and receives a creature/animal-subject identity directive
(anatomy, markings, coloration lock) with zero typing.

---

### `client.pipelines`

Story-to-Video pipeline operations. Pipelines orchestrate multi-stage AI
production runs (script → characters → objects → locations → shot list →
scene images → animate + audio + edit → post merge).

#### `create(input)`

```ts
create(input: PipelineInput): Promise<{ id: string }>
```

Start a new pipeline (headless film generation) — the programmatic equivalent
of the studio's "Create film". In Auto mode the engine self-advances to
completion; poll `get()` for status and `getTimeline()` for the assembled
output. In manual/guided mode, drive it with `pendingApprovals()` +
`approveStage()` / `approveSubGate()`. Requires `pipelines:execute` scope.

```ts
const { id } = await client.pipelines.create({ /* PipelineInput */ })
```

#### `get(id)`

```ts
get(id: string): Promise<PipelineRecord>
```

Fetch current pipeline state: `status`, `current_stage`, credit counters,
`mode`, and `failure_reason` (set when `status='failed'`). Poll this to track
a headless Auto run to completion. Requires `pipelines:read`.

```ts
const pipeline = await client.pipelines.get(id)
console.log(pipeline.status, pipeline.current_stage)
```

#### `list()`

```ts
list(): Promise<PipelineRecord[]>
```

List the caller's pipelines (most recent first). Requires `pipelines:read`.

```ts
const pipelines = await client.pipelines.list()
```

#### `cancel(id)`

```ts
cancel(id: string): Promise<{ ok: true }>
```

Cancel a running pipeline. Unspent reserved credits refund. Idempotent on an
already-terminal pipeline. Requires `pipelines:execute`.

```ts
await client.pipelines.cancel(id)
```

#### `pendingApprovals(id)`

```ts
pendingApprovals(id: string): Promise<PendingApproval[]>
```

Stages currently `awaiting_approval`. Empty in a clean Auto run (the engine
self-approves); populated in manual/guided mode at each gate.
Requires `pipelines:read`.

```ts
const approvals = await client.pipelines.pendingApprovals(id)
```

#### `approveStage(id, stage, edits?)`

```ts
approveStage(id: string, stage: PipelineStageName, edits?: unknown): Promise<{ ok: true }>
```

Approve a stage so the engine advances. An optional `edits` JSON-Patch is
applied to the stage output before approval. Requires `pipelines:approve`.

```ts
await client.pipelines.approveStage(id, "script")
// With edits (JSON Patch):
await client.pipelines.approveStage(id, "script", [{ op: "replace", path: "/title", value: "New Title" }])
```

#### `rejectStage(id, stage, feedback)`

```ts
rejectStage(id: string, stage: PipelineStageName, feedback: string): Promise<{ ok: true }>
```

Reject a stage with feedback; the engine re-runs it incorporating the note.
Requires `pipelines:approve`.

```ts
await client.pipelines.rejectStage(id, "script", "Make the story darker and more suspenseful")
```

#### `approveSubGate(id, gate)`

```ts
approveSubGate(id: string, gate: SubGateName): Promise<{ ok: true; gate: SubGateName; resumed_at: string }>
```

Approve a Stage-7 sub-gate (`dialogue_recheck` / `silent_cut`) so the
orchestrator resumes from the next sub-step. Requires `pipelines:approve`.

```ts
await client.pipelines.approveSubGate(id, "dialogue_recheck")
```

#### `getStage(id, stage)`

```ts
getStage(id: string, stage: PipelineStageName): Promise<{ status: string; output: unknown; critic_feedback: unknown }>
```

Read a single stage's `status`, `output`, and `critic_feedback`. Useful for
inspecting the script/plan before approving. Requires `pipelines:read`.

```ts
const { status, output } = await client.pipelines.getStage(id, "script")
```

#### `getTimeline(id)`

```ts
getTimeline(id: string): Promise<PipelineTimeline>
```

Assembled timeline — ordered scene composites + durations + audio URLs +
live animate progress (`animateProgress`). The output a headless caller
renders or hands to a downstream editor. Requires `pipelines:read`.

```ts
const timeline = await client.pipelines.getTimeline(id)
for (const scene of timeline.scenes) {
  console.log(scene.compositeUrl, scene.durationSeconds)
}
```

#### `branch(id, { fromStage })`

```ts
branch(id: string, input: BranchPipelineInput): Promise<BranchPipelineResult>
```

Re-run a completed pipeline from a specific stage. Creates a new pipeline with
lineage tracked. Upstream stages are cloned as approved. The original pipeline
remains in `status='completed'`. Requires `pipelines:execute` scope.

```ts
const result = await client.pipelines.branch("pipe-1", { fromStage: "scene_images" })
console.log(`New pipeline: ${result.pipelineId}`)
// result: { pipelineId, clonedStages, clonedEntities }
```

#### `chatStage(pipelineId, stage, message)`

```ts
chatStage(
  pipelineId: string,
  stage: ChatEnabledStage,
  message: string,
): Promise<ChatStageResult>
```

Send a chat message to the Showrunner Refinement Director (Guided Mode).
Persists user + assistant turns; returns the assistant's reply and an optional
`proposed_change` the user can `applyChatProposal()` to commit.

Requires `pipelines:approve` scope. The pipeline must have `mode='guided'` and
the stage must be `awaiting_approval`.

```ts
const { content, proposed_change } = await client.pipelines.chatStage(
  id,
  "script",
  "Can you make the protagonist's motivation clearer in scene 2?",
)
```

#### `applyChatProposal(pipelineId, stage, turnId)`

```ts
applyChatProposal(
  pipelineId: string,
  stage: ChatEnabledStage,
  turnId: string,
): Promise<ApplyChatProposalResult>
```

Accept a proposed change from a prior assistant turn. Routes through
`applyStageEdit` (validates JSON Patch + per-stage schema + reference
integrity, inserts a new attempt row, flips the stage to approved).

Returns `{ applied: true, attemptId, newOutput }` on success, or
`{ applied: false, error }` on recoverable failures (the backend already
inserted a follow-up assistant turn with a hint). Hard failures throw via the
standard error pipeline (HTTP 409). Requires `pipelines:approve` scope.

```ts
const result = await client.pipelines.applyChatProposal(id, "script", turnId)
if (result.applied) {
  console.log("Approved:", result.newOutput)
} else {
  console.log("Recoverable failure:", result.error.code)
}
```

#### `getStageChat(pipelineId, stage)`

```ts
getStageChat(pipelineId: string, stage: ChatEnabledStage): Promise<{ turns: ChatTurn[] }>
```

Fetch the chat history for a stage. Returns an empty array when no turns exist
yet. Used by the frontend chat panel on initial mount; subsequent updates arrive
via SSE (`chat:turn` events). Requires `pipelines:read` scope.

```ts
const { turns } = await client.pipelines.getStageChat(id, "script")
```

---

### `client.reduce`

Run the Reduce (fan-in) node directly — pick the best of N inputs,
concatenate, vote, or merge JSON. Mirrors the MCP `reduce` tool.

#### `run(input)`

```ts
run(input: ReduceInput): Promise<ReduceResult>
```

**`ReduceInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `strategyId` | `ReduceStrategyId` | yes | `pick-best-llm` \| `concat` \| `first-non-empty` \| `count` \| `vote` \| `merge-json` |
| `strategyConfig` | `Record<string, unknown>` | no | Strategy-specific config (see below). Defaults to `{}` (each strategy's defaults). |
| `inputs` | `string[]` | yes | Up to 1000 input strings. |
| `workflowId` | `string` | no | Associates this reduce run with a workflow (for execution-history display). |

**`strategyConfig` per strategy:**

| Strategy | Config shape |
|----------|--------------|
| `pick-best-llm` | `{ criteria: string, inputKind?: "text" \| "image-url", llmModel?: string }` — `llmModel` picks the judge model (economy/standard/premium credit tiers apply) |
| `concat` | `{ separator?: string }` (default `"\n\n"`) |
| `first-non-empty` | `{}` |
| `count` | `{}` |
| `vote` | `{ caseSensitive?: boolean }` (default `false`) |
| `merge-json` | `{ strategy?: "deep" \| "shallow" }` (default `"deep"`) |

**`ReduceResult`:**

```ts
{
  jobId: string
  output: string         // chosen / joined value (stringified)
  meta: {
    selectedIndex?: number  // set by pick-best-llm, vote
    reasoning?: string      // set by pick-best-llm
    summary: string         // always present
  }
}
```

```ts
const result = await client.reduce.run({
  strategyId: "pick-best-llm",
  strategyConfig: { criteria: "sharpest", inputKind: "image-url" },
  inputs: [url1, url2, url3, url4, url5],
})
console.log(result.output, result.meta.reasoning)
```

Throws a `NodaroError` (status 400, `code: "no_valid_inputs"`) when every
input is empty / whitespace. Credits are reserved by the same
`creditGuard` middleware used by all generation routes, so insufficient
credits surface as `InsufficientCreditsError`.

---

### `client.promptHelper`

AI prompt assistance for generation nodes. All three methods delegate to
`POST /v1/prompt-helper/wizard` (see
[API Integration §12](./api-integration.md#15-prompt-wizard)) and reserve
credits per call.

All three inputs also accept optional `llmModel`, `reasoningEffort`, `advancedMode`, `temperature` and `maxTokens` fields
(the latter is model-dependent — unsupported or omitted levels fall back to
the vendor default). Both are forwarded to the underlying LLM call and affect
credit cost the same way as every other LLM-backed node — see
[Reasoning effort](nodes/ai-text/llm-chat.md#reasoning-effort). The CLI
exposes the same lever as `--llm-model <id>` / `--reasoning-effort <level>`
on `nodaro prompt wizard/analyze/generate/enhance`.

#### `analyze(input)`

```ts
analyze(input: AnalyzeInput): Promise<{ jobId: string; questions: WizardQuestion[] }>
```

Turns a rough idea into guided questions for a target node type. Pair the
returned `questions` with `generate()`.

```ts
const { questions } = await client.promptHelper.analyze({
  nodeType: "generate-image",
  prompt: "a snow leopard",
})
```

#### `generate(input)`

```ts
generate(input: GenerateInput): Promise<{ jobId: string; prompt: string; recommendedModel?: RecommendedModel }>
```

Builds a single optimized prompt from the selected answers. Each selection is
`{ category, value, isCustom }`.

```ts
const { prompt } = await client.promptHelper.generate({
  nodeType: "generate-image",
  selections: [{ category: "subject", value: "snow leopard", isCustom: false }],
})
```

#### `enhance(input)`

```ts
enhance(input: EnhanceInput): Promise<{ jobId: string; prompt: string; recommendedModel?: RecommendedModel }>
```

One-shot "improve this prompt" — skips the questions round-trip and returns the
optimized prompt directly.

```ts
const { prompt } = await client.promptHelper.enhance({ nodeType: "generate-image", prompt: "a snow leopard" })
```

---

### `client.apps`

Browse and run published apps — a workflow wrapped in a curated input/output
presentation. `list()` and `get()` are public; `run()` and the run-history
methods authenticate as the caller.

#### `list(params?)`

```ts
list(params?: ListAppsParams): Promise<ListAppsResult>
```

Cursor-paginated browse of published apps. Optional `search`, `category`, and
`limit` (server caps at 50).

```ts
const { data, nextCursor } = await client.apps.list({ search: "headshot", limit: 20 })
```

#### `get(slug)`

```ts
get(slug: string): Promise<{ data: PublishedAppDetail }>
```

Fetches one app's metadata plus its `inputSchema` (the fields end users fill
in) and `outputs` mapping.

```ts
const { data: app } = await client.apps.get("pro-headshot")
```

#### `run(slug, inputs?, opts?)`

```ts
run(slug: string, inputs?: Record<string, unknown>, opts?: RunAppOptions): Promise<AppRunResult>
```

Triggers an app run. `inputs` keys must match the app's input-schema field
names. Returns `{ executionId, status, runId? }` — poll via
`client.executions.get(executionId)`.

`opts.inputOverrides` is the advanced escape hatch: nested
`{ nodeId: { field: value } }` raw node data for THIS run, which reaches fields
the app does not expose to its end users — such as
[`promptPrefix` / `promptSuffix`](./prompt-pre-post-text.md).

```ts
const { executionId } = await client.apps.run("pro-headshot", { photo: url })

// Wrap the app's prompt with hidden text for one run
await client.apps.run(
  "pro-headshot",
  { photo: url },
  { inputOverrides: { n1: { promptPrefix: "Studio portrait of" } } },
)
```

#### `listRuns(slug, params?)` / `getRun(slug, runId)`

```ts
listRuns(slug: string, params?: ListAppRunsParams): Promise<{ data: AppRun[]; nextCursor?: string | null }>
getRun(slug: string, runId: string): Promise<{ data: AppRun }>
```

List past runs for an app, or fetch one run by id.

#### `deleteRun(slug, runId)`

```ts
deleteRun(slug: string, runId: string): Promise<{ success: true; archived: true }>
```

Archives (soft-deletes) a run. Restoration and permanent deletion are UI-only
by design — SDK / MCP / API delete callers can't destroy data.

```ts
await client.apps.deleteRun("pro-headshot", runId)
```

---

### `client.developerApps`

Manage your own OAuth developer apps. Only the owner can read or modify their
apps; secrets are returned exactly once.

#### `list()`

```ts
list(): Promise<{ data: DeveloperApp[] }>
```

```ts
const { data } = await client.developerApps.list()
```

#### `get(id)`

```ts
get(id: string): Promise<{ data: DeveloperApp }>
```

```ts
const { data } = await client.developerApps.get(appId)
```

#### `create(input)`

```ts
create(input: CreateDeveloperAppInput): Promise<{ data: CreateDeveloperAppResult }>
```

Creates an app. The response includes `clientSecret` — store it now, the
server only keeps a hash.

```ts
const { data } = await client.developerApps.create({
  name: "My integration",
  redirectUris: ["https://example.com/oauth/callback"],
  scopesRequested: ["workflows:read", "workflows:execute"],
})
console.log(data.clientId, data.clientSecret) // save both
```

**Input rules:**

- `redirectUris`: 1-10 entries, each `https://...` or `http://localhost...`
- `allowedOrigins`: 0-5 bare origins (no path/query/hash)
- `scopesRequested`: at least 1 scope from the `DeveloperAppScope` union

#### `update(id, input)`

```ts
update(id: string, input: UpdateDeveloperAppInput): Promise<{ data: DeveloperApp }>
```

```ts
await client.developerApps.update(appId, {
  redirectUris: ["https://example.com/oauth/callback", "https://staging.example.com/oauth/callback"],
})
```

#### `delete(id)`

```ts
delete(id: string): Promise<{ success: true }>
```

Throws `NotFoundError` when the id doesn't exist or isn't yours.

```ts
await client.developerApps.delete(appId)
```

#### `rotateSecret(id)`

```ts
rotateSecret(id: string): Promise<RotateSecretResult>
```

Generates a new `clientSecret` and invalidates the old one. The new secret is
returned exactly once.

```ts
const { clientSecret } = await client.developerApps.rotateSecret(appId)
```

---

### `client.oauth`

OAuth 2.0 + RFC 7009 endpoints used by third-party app servers. The full
authorization-code flow is documented in [OAuth Flow](./oauth-flow.md).

#### `exchangeCode(input)`

```ts
exchangeCode(input: ExchangeCodeInput): Promise<AccessTokenResponse>
```

Server-side authorization-code exchange. The SDK adds
`grant_type: "authorization_code"` automatically.

**NEVER call this from a browser** — `client_secret` must stay on the server.

```ts
const tokens = await client.oauth.exchangeCode({
  client_id: process.env.NODARO_CLIENT_ID!,
  client_secret: process.env.NODARO_CLIENT_SECRET!,
  code: req.query.code as string,
  redirect_uri: "https://example.com/oauth/callback",
})
// tokens: { access_token, token_type, scope, expires_in }
```

#### `revoke(token)`

```ts
revoke(token: string): Promise<{ success: true }>
```

Revokes an access token (RFC 7009). Always returns success even for unknown
tokens — the spec forbids leaking validity.

```ts
await client.oauth.revoke(accessToken)
```

#### `getAppInfo(clientId)`

```ts
getAppInfo(clientId: string): Promise<OAuthAppInfo>
```

Fetches public metadata about a developer app for rendering a consent screen.
Public route — no auth needed.

```ts
const info = await client.oauth.getAppInfo("app_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d")
// { name, description, logoUrl, homepageUrl, scopesRequested }
```

### `client.voices`

ElevenLabs voices: the premade catalog, the community Voice Library, the
signed-in user's voice clones (from URL or file), and the **voice changer** —
one-shot single-voice / multi-speaker recasts plus the interactive Voice
Changer Pro flow (`analyze` → `recast({ output: "stems" })` → `exportMix`),
voice design/remix, and dubbing.

#### `list()`

```ts
list(): Promise<Voice[]>
```

List the premade ElevenLabs voices (`GET /v1/voices`). Falls back to a curated
set server-side when no ElevenLabs API key is configured.

```ts
const voices = await client.voices.list()
```

#### `searchLibrary(params?)`

```ts
searchLibrary(params?: VoiceLibraryParams): Promise<VoiceLibraryResponse>
```

Search the shared/community Voice Library (`GET /v1/voices/library`). All
params are optional and forwarded as a querystring; `undefined` / `null` /
empty-string values are omitted so server defaults apply. `hasMore` in the
response drives "load more" pagination.

Each returned voice may carry model-verification hints derived from the
library's `verified_languages` metadata:

- `recommendedProvider` — the best TTS provider the voice is verified on
  (`elevenlabs-v3` preferred when the voice is verified for it — v3 is the
  fully-multilingual default and renders any voice unmodified — else the
  cheapest v2 model: `elevenlabs-turbo` preferred, else
  `elevenlabs-multilingual`). Apps without a provider picker should send it
  as the `provider` when generating speech with this voice, so the voice
  renders on a model it's verified for (that's what keeps generation
  sounding like the library preview).
- `verifiedProviders` — every provider the voice is verified on (v3 first
  when present, then turbo). Apps WITH a provider picker should only
  override the user's choice when it is **not** in this set.

```ts
const { voices, hasMore } = await client.voices.searchLibrary({ search: "deep", language: "en" })
const v = voices[0]
await client.nodes.run("text-to-speech", {
  text: "Hello!",
  voice: v.voice_id,
  voiceType: "library",
  ...(v.recommendedProvider ? { provider: v.recommendedProvider } : {}),
})
```

#### `listClones()`

```ts
listClones(): Promise<VoiceClone[]>
```

List the signed-in user's voice clones (`GET /v1/voice-clones`). Unwraps the
`{ voiceClones }` envelope to the bare array.

```ts
const clones = await client.voices.listClones()
```

#### `createClone(input)`

```ts
createClone(input: { name: string; audioUrl: string }): Promise<VoiceClone>
```

Clone a voice from an already-uploaded audio URL (`POST /v1/voice-clones/from-url`).
Costs credits. Returns the created `VoiceClone` — `elevenlabsVoiceId` is the
id to use at text-to-speech time.

```ts
const clone = await client.voices.createClone({
  name: "My Custom Voice",
  audioUrl: "https://cdn.example.com/sample.mp3",
})
console.log(clone.elevenlabsVoiceId)
```

#### `createCloneFromFile(input)`

```ts
createCloneFromFile(input: {
  name: string
  file: Blob | Uint8Array | ArrayBuffer
  filename?: string      // upload part name, default "sample"
  contentType?: string   // MIME when `file` is a raw buffer, default "audio/mpeg"
}): Promise<VoiceClone>
```

Clone a voice from an audio **file you hold in memory**
(`POST /v1/voice-clones`, multipart, ≤10 MB) — the counterpart to
`createClone`, which clones from an already-uploaded URL. Pass a `Blob`/`File`
in the browser or a `Uint8Array`/`Buffer` in Node. Costs credits. The returned
clone's `elevenlabsVoiceId` is the id to synthesize/recast with.

```ts
import { readFileSync } from "node:fs"
const clone = await client.voices.createCloneFromFile({
  name: "Narrator",
  file: readFileSync("./sample.wav"),
  filename: "sample.wav",
  contentType: "audio/wav",
})
```

#### `deleteClone(id)`

```ts
deleteClone(id: string): Promise<void>
```

Delete one of the user's voice clones (`DELETE /v1/voice-clones/:id`).

```ts
await client.voices.deleteClone(cloneId)
```

#### `change(input)`

```ts
change(input: {
  voiceId: string
  audioUrl?: string
  videoUrl?: string
  model?: string           // speech-to-speech model override
  stability?: number
  similarityBoost?: number
  style?: number
  useSpeakerBoost?: boolean
  seed?: number            // deterministic STS seed (integer) for reproducible output
  removeBackgroundNoise?: boolean
}): Promise<{ jobId: string }>
```

Replace the voice in a recording — or in a whole talking video — with a
different voice (`POST /v1/voice-changer`). Pass **`audioUrl`** to revoice
audio→audio, or **`videoUrl`** to revoice an entire clip: the server demuxes the
audio, runs speech-to-speech, and remuxes the new voice onto the original video.
Exactly one of `audioUrl` / `videoUrl` is required; **when both are sent, video
wins**. `style` is a style exaggeration factor (0–1; default 0 — >0 amplifies
delivery at the cost of latency/stability). `useSpeakerBoost` sharpens fidelity
to the target speaker (small latency cost); `seed` makes the output reproducible
across runs. `removeBackgroundNoise` off keeps
the music/SFX bed under the new voice; on yields a clean voice-only result.
Runs async — poll `client.jobs.get(jobId)`.

```ts
// Audio → audio
const { jobId } = await client.voices.change({
  audioUrl: "https://cdn.example.com/speech.mp3",
  voiceId: "Rachel",
})

// Video → revoiced video (output_data has videoUrl + audioUrl)
const { jobId: vjobId } = await client.voices.change({
  videoUrl: "https://cdn.example.com/talking.mp4",
  voiceId: "Aria",
})
```

#### `recast(input)`

```ts
type VoiceChangerProVoice =
  | string
  | {
      voiceId: string
      engine?: "sts" | "v3"       // "sts" (default) = speech-to-speech recast; "v3" = Re-speak —
                                  // the performance is REGENERATED from the transcript with eleven_v3
                                  // ([audio tags] supported; stability 0/0.5/1 only; similarityBoost/
                                  // style/useSpeakerBoost ignored). A v3 speaker needs transcript text:
                                  // pass an analysis whose segments[].text carries it, or omit analysis
                                  // and the engine re-speaks from its own transcription.
      stability?: number          // 0–1
      similarityBoost?: number    // 0–1
      style?: number              // 0–1, default 0
      useSpeakerBoost?: boolean
      seed?: number               // int 0–4294967295 — reproducible STS for this speaker
      volumeMode?: "match" | "normalize" | "manual"  // default "match"
      volume?: number             // 0–200 (%), used only when volumeMode === "manual"
    }

recast(input: {
  audioUrl?: string
  videoUrl?: string
  orderedVoices: Array<VoiceChangerProVoice | null>  // 1–8 entries; null = keep that speaker's original voice
  model?: string
  preserveBackground?: boolean             // default true
  separationQuality?: "fast" | "best"      // default "fast"
  removeBackgroundNoise?: boolean
  musicVolumeMode?: "match" | "normalize" | "manual"  // level of preserved background, default "match"
  musicVolume?: number                     // 0–200 (%), used only when musicVolumeMode === "manual"
  voiceFx?: {                              // reverb/echo on the combined voices, pre-background-remix
    preset: AudioFxPreset                  // reverb space / telephone / megaphone / echo / custom
    wetDryMix?: number                     // 0–100, reverb wetness
    delayMs?: number                       // 20–2000, echo delay
    decay?: number                         // 0–1, echo decay
  }
  output?: "video" | "stems"               // default "video"; "stems" = dry per-track stems for an interactive mix
  analysis?: VcpAnalysis                   // a prior analyze() result — skips re-detection (the fast-path)
}): Promise<{ jobId: string }>
```

Recast each detected speaker in a multi-speaker recording to a different voice
(`POST /v1/voice-changer-pro`). `orderedVoices` maps speaker-detection positions to
voices — speaker 0 → `orderedVoices[0]`, speaker 1 → `orderedVoices[1]`, etc.
Speakers beyond the end of `orderedVoices` keep their original voice. Each entry
is **either a bare voice id** (premade name or ElevenLabs UUID) **or an object**
with per-voice ElevenLabs speech-to-speech settings (`stability`,
`similarityBoost`, `style`, `useSpeakerBoost`, `seed`) plus a loudness
`volumeMode` (`"match"` matches the original speaker, `"normalize"` applies
loudnorm, `"manual"` uses `volume` as a percentage). A per-voice `seed`
(integer 0–4294967295) makes that speaker's recast reproducible across runs.

An entry may also be **`null`** — a keep-slot: that speaker keeps their original
voice while later speakers are still recast. At least one entry must be non-null
(all-null is rejected). Keep-slots don't cost credits — pricing counts recast
speakers only.

Pass **`audioUrl`** for audio → audio recast, or **`videoUrl`** to recast the
audio track of a video clip (the server demuxes, recasts, and remuxes).

Voice and music are **always separated first** — before recasting, the source is
split into an isolated vocal stem and a music/SFX stem. `preserveBackground`
(default `true`) only controls whether that music/instrumental stem is mixed
back under the new voices; set it `false` for a clean voice-only result.
`separationQuality` selects the quality of the voice/music separation: `"fast"`
(default, quicker — preserves more of the voice) or `"best"` (finer voice/music
separation).
`removeBackgroundNoise` additionally denoises the result. `musicVolumeMode` sets
the level of the preserved background (only relevant when `preserveBackground` is
on): `"match"` (default) keeps the original level, `"normalize"` loudnorms it,
`"manual"` uses `musicVolume`%. `voiceFx` applies a
reverb/echo to the **combined** recast voices **before** the background is mixed
back in (so the effect sits on the voices, not the music/SFX bed): reverb presets
(`"room"`, `"hall"`, `"church"`, …) use `wetDryMix`; the `"echo"` / `"custom"`
presets use `delayMs` + `decay`. Cloud-only — costs credits and runs async; poll
`client.jobs.get(jobId)` for the result (`output_data.videoUrl` +
`output_data.audioUrl` in video mode).

`output` selects the result shape: `"video"` (default) renders the finished
merged result; `"stems"` returns the **dry, unleveled per-track stems** instead,
so you can drive an interactive mix in your own UI and render later with
`exportMix()`. `analysis` accepts a prior `analyze()` result (see below) to
**skip re-detection** — the recast reuses the already-separated stems and
speaker segments, so re-recasting with different voice assignments doesn't pay
detection again.

```ts
// Two-speaker audio recast (bare voice ids)
const { jobId } = await client.voices.recast({
  audioUrl: "https://cdn.example.com/dialogue.mp3",
  orderedVoices: ["Rachel", "Aria"],
  preserveBackground: true,
})

// Recast speakers 1 and 3, keep speaker 2's original voice (keep-slot)
const { jobId: kept } = await client.voices.recast({
  audioUrl: "https://cdn.example.com/panel.mp3",
  orderedVoices: ["Rachel", null, "Aria"],
})

// Reproducible recast (per-voice seed) + a hall reverb on the voices
const { jobId: reverbed } = await client.voices.recast({
  audioUrl: "https://cdn.example.com/dialogue.mp3",
  orderedVoices: [
    { voiceId: "Rachel", seed: 12345 },
    { voiceId: "Aria", seed: 67890 },
  ],
  voiceFx: { preset: "hall", wetDryMix: 35 },
})

// Per-voice settings + finer separation
const { jobId: tuned } = await client.voices.recast({
  audioUrl: "https://cdn.example.com/dialogue.mp3",
  orderedVoices: [
    { voiceId: "Rachel", stability: 0.6, similarityBoost: 0.8 },
    { voiceId: "Aria", volumeMode: "manual", volume: 120 },
  ],
  separationQuality: "best",
})

// Multi-speaker video recast
const { jobId: vjobId } = await client.voices.recast({
  videoUrl: "https://cdn.example.com/interview.mp4",
  orderedVoices: ["Callum", "Charlotte", "Liam"],
})
```

#### `analyze(input)`

```ts
analyze(input: {
  audioUrl?: string       // exactly one of audioUrl / videoUrl
  videoUrl?: string
  separationQuality?: "fast" | "best"
  suggestTitle?: boolean
}): Promise<{ jobId: string }>
```

Detect the speakers in a clip **without recasting yet**
(`POST /v1/voice-changer-pro/analyze`, Cloud only) — the first step of the
interactive flow. Separates voice from music once and diarizes the vocals.
The completed job's `output_data` carries the separated stem urls
(`vocalsUrl`, `backgroundUrl`), the detected `speakers` (each with `id`,
time `segments`, `firstStartSec`, `wordCount`, `snippet`), the detected
language (`languageCode` + `languageProbability`), and — with `suggestTitle` —
an LLM-proposed `suggestedTitle`. That `output_data` is exactly the
`VcpAnalysis` shape: pass it back as `recast({ …, analysis })` to skip
re-detection on every subsequent recast. Flat-priced; runs async.

#### `exportMix(input)`

```ts
exportMix(input: VcpExportInput): Promise<{ jobId: string }>
// VcpExportInput = {
//   videoUrl: string                      // stream-copied, never re-encoded
//   tracks: VcpExportTrack[]              // ≤16; at least one un-muted
//   voiceFx?: VoiceChangerProInput["voiceFx"]
// }
// VcpExportTrack = { url: string, gain: number /* 0–200 */, muted: boolean, kind?: "voice" | "background" }
```

Render the final video from a mixed set of stems
(`POST /v1/voice-changer-pro/export`, Cloud only) — the last step of the
interactive flow, after `recast({ output: "stems" })`. Per-lane `gain`/`muted`
and the export-time `voiceFx` (voice lanes only — never a `"background"` lane)
are applied at render; the video stream is copied, so the export is
bit-identical to your preview and iterating the mix before exporting is free.
All-muted mixes are rejected (400). Flat-priced; poll `client.jobs.get(jobId)`
for `output_data.videoUrl`.

```ts
// The interactive flow end-to-end: analyze once, recast to stems, render.
const { jobId: aJob } = await client.voices.analyze({ videoUrl, suggestTitle: true })
const analysis = (await pollUntilDone(aJob)).output_data as VcpAnalysis

const { jobId: rJob } = await client.voices.recast({
  videoUrl,
  orderedVoices: ["Rachel", null, "Aria"],   // speaker 2 keeps their voice
  output: "stems",
  analysis,                                   // skip re-detection
})
const stems = (await pollUntilDone(rJob)).output_data

const { jobId: eJob } = await client.voices.exportMix({
  videoUrl,
  tracks: [
    { url: stems.tracks[0].url, gain: 100, muted: false },
    { url: stems.tracks[1].url, gain: 90, muted: false },
    { url: stems.backgroundUrl, gain: 70, muted: false, kind: "background" },
  ],
  voiceFx: { preset: "hall", wetDryMix: 25 },
})
```

#### `design(input)`

```ts
design(input: {
  text: string               // preview line, 100–1000 chars
  voiceDescription: string
  model?: string
  loudness?: number          // -1..1
  guidanceScale?: number     // 0–100
  seed?: number
  quality?: number
  shouldEnhance?: boolean
  userPrompt?: string
}): Promise<{ jobId: string }>
```

Design a brand-new synthetic voice from a text description
(`POST /v1/voice-design`, ElevenLabs text-to-voice). The completed job carries
an audio preview and the reusable generated voice id.

#### `remix(input)`

```ts
remix(input: {
  text: string               // 1–5000 chars
  voiceDescription: string
  userPrompt?: string
}): Promise<{ jobId: string }>
```

Generate speech in a voice described in natural language, without cloning
(`POST /v1/voice-remix`).

#### `dub(input)`

```ts
dub(input: {
  audioUrl?: string          // exactly ONE source of the three
  videoUrl?: string          // video in → the dubbed VIDEO out (+ audio track)
  sourceUrl?: string         // public YouTube/TikTok/direct link — ElevenLabs fetches it
  targetLanguage: string     // ISO code, e.g. "es", "pt-BR"
  sourceLanguage?: string    // auto-detected when omitted
  numSpeakers?: number       // 0 = auto; 1–20 — improves separation when known
  disableVoiceCloning?: boolean
  dropBackgroundAudio?: boolean
  startTime?: number         // dub only this window of the source (seconds)
  endTime?: number
  highestResolution?: boolean // keep the source resolution on video dubs
  useProfanityFilter?: boolean
  targetAccent?: string      // experimental
  watermark?: boolean        // ElevenLabs' own watermark on video dubs
}): Promise<{ jobId: string }>
```

Dub audio — or a whole video — into another language while preserving each
speaker's voice (`POST /v1/dubbing`). Video mode completes with
`output_data.videoUrl` (the dubbed clip) plus `output_data.audioUrl` (the
dubbed track alone). Priced per minute of the dubbed span (minimum 1 minute);
the span is capped at 30 minutes — use `startTime`/`endTime` for longer
sources.

#### `textToDialogue(input)`

```ts
textToDialogue(input: {
  dialogue: Array<{ text: string; voice: string }>  // in speaking order
  stability?: 0 | 0.5 | 1
  languageCode?: string                              // ISO 639-1 hint, auto-detected when omitted
  seed?: number                                      // 0–4294967295; omit for random
  applyTextNormalization?: "auto" | "on" | "off"
}): Promise<{ jobId: string }>
```

Voice a multi-speaker script as ONE audio file (`POST /v1/text-to-dialogue`,
ElevenLabs Dialogue v3). Each line's `voice` is a premade voice name or an
ElevenLabs voice UUID — cloned and Voice Library voices work, mixed casts are
fine, and line text may carry `[audio tags]` like `[laughs]`. At most 5,000
characters total across lines (under 2,000 recommended for best quality) and
10 unique voices per generation. Poll `jobs.get(jobId)` for
`output_data.audioUrl`.

---

### `client.media`

Media ingestion + trimming — the source-preparation steps a pipeline needs
before it has a clip to work on. Each generation-style op returns a job id to
poll with `client.jobs.get(jobId)`; `videoMetadata` is a direct read.

#### `downloadVideo(input)`

```ts
downloadVideo(input: {
  url: string
  maxHeight?: number
  sectionStartSec?: number
  sectionEndSec?: number
}): Promise<{ downloadId: string }>
```

Download a social video (YouTube / TikTok / Instagram / X / Facebook) into your
storage (`POST /v1/download-video`). `maxHeight` caps the resolution (omit for
best available); `sectionStartSec` + `sectionEndSec` (both-or-neither) fetch
only that time range. Returns a `downloadId` — not a job id — whose progress
streams from `downloadVideoProgress()`. The finished file lands in your library.

#### `downloadVideoProgress(downloadId, opts?)`

```ts
downloadVideoProgress(
  downloadId: string,
  opts?: { signal?: AbortSignal },
): AsyncGenerator<DownloadVideoProgress>
```

Stream a download's live progress (`GET /v1/download-video/progress/:id`,
server-sent events) as an async iterable. Yields
`{ phase, percent, videoUrl?, thumbnailUrl?, error? }` roughly every 500ms
until the download reaches `completed` (the event carries the stored
`videoUrl`) or `failed` (the event carries `error`), then ends. The progress
state expires server-side shortly after the download finishes — start
iterating promptly after `downloadVideo()` returns. No request timeout is
applied (large imports legitimately take minutes); pass an `AbortSignal` to
cancel.

```ts
const { downloadId } = await client.media.downloadVideo({
  url: "https://youtu.be/dQw4w9WgXcQ",
  maxHeight: 720,
})
for await (const ev of client.media.downloadVideoProgress(downloadId)) {
  console.log(`${ev.phase} ${ev.percent}%`)
  if (ev.phase === "completed") console.log("stored at", ev.videoUrl)
}
```

#### `trimVideo(input)`

```ts
trimVideo(input: {
  videoUrl: string
  startTime?: number
  endTime?: number
  trimStartFrames?: number
  trimEndFrames?: number
  trimStartSeconds?: number
  trimEndSeconds?: number
  keepFirstSeconds?: number
  keepLastSeconds?: number
}): Promise<{ jobId: string }>
```

Trim a video to a range (`POST /v1/trim-video`). Give the range in whichever
unit fits: `startTime`/`endTime` seconds, `trim*Frames`, `trim*Seconds`, or
`keepFirstSeconds`/`keepLastSeconds`.

#### `trimAudio(input)`

```ts
trimAudio(input: {
  videoUrl?: string
  audioUrl?: string
  audioFormat?: "mp3" | "wav" | "aac"
  startTime?: number
  endTime?: number
}): Promise<{ jobId: string }>
```

Trim (and extract) audio from a video or audio source (`POST /v1/trim-audio`)
to `[startTime, endTime]` seconds, in `audioFormat` (`mp3` default).

#### `stillToVideo(input)`

```ts
stillToVideo(input: {
  imageUrl: string
  audioUrl: string
  motion?: "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "ken-burns"
  intensity?: number
  resolution?: "720p" | "1080p" | "4K"
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3"
  fps?: 24 | 30
  fit?: "cover" | "contain"
  padColor?: string
}): Promise<{ jobId: string }>
```

Turn one still image + one audio track into an MP4
(`POST /v1/still-to-video`) — locally rendered (FFmpeg), no AI model,
**zero credits**. The output duration is the audio's duration; there is no
duration field. `motion` (default `none`) animates the still at `intensity`
1–10; `fit: "contain"` letterboxes with `padColor` instead of cropping.

#### `slideshow(input)`

```ts
slideshow(input: {
  imageUrls: string[]
  audioUrl?: string
  imageDurations?: Array<number | null>
  perImageDuration?: number
  transition?: string
  transitionDuration?: number
  motion?: "none" | "zoom-in" | "zoom-out" | "ken-burns" | "alternate"
  intensity?: number
  resolution?: "720p" | "1080p" | "4K"
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3"
  fps?: 24 | 30
  fit?: "cover" | "contain"
  padColor?: string
}): Promise<{ jobId: string }>
```

Turn 2–100 images + one optional audio track into an MP4 slideshow
(`POST /v1/slideshow`) — locally rendered (FFmpeg), **zero credits**. With
audio, the output duration is the audio's duration (equal split unless
`imageDurations` pins rows — `null` = auto; mismatched pinned sums scale
proportionally, disclosed in the job output). Without audio: N ×
`perImageDuration`, silent output. For a single image use `stillToVideo`.

#### `saveToStorage(input)`

```ts
saveToStorage(input: {
  mediaUrl: string
  filename?: string
  mediaType?: "image" | "video" | "audio"
}): Promise<{ jobId: string }>
```

Copy an external media URL into your Nodaro storage
(`POST /v1/save-to-storage`) — a server-side fetch, so nothing round-trips
through the client.

#### `imageCollage(input)`

```ts
imageCollage(input: {
  imageUrls: string[]
  imageSizes?: Array<0 | 1 | 2 | 3>
  numbered?: boolean
  imageLabels?: Array<string | null>
  badgePosition?: "top-left" | "top-right"
  layout?: "smart" | "grid"
  resolution?: "2K" | "4K"
  aspectRatio?: string
  gap?: number
  backgroundColor?: string
}): Promise<{ jobId: string }>
```

Composite 2–30 images into ONE large 2K/4K collage (`POST /v1/image-collage`).
`layout` is `"smart"` (default — justified rows at each image's exact aspect
ratio, no cropping; the output height floats) or `"grid"` (uniform,
letterboxed cells). `imageSizes` is index-aligned with `imageUrls` and gives
per-image **relative** size hints for the smart layout: `0` auto ("don't
care", default), `1` big (~2× linear vs medium), `2` medium, `3` small
(~½ linear). All-equal hints change nothing; grid ignores them. `numbered`
stamps a 1-based sequence number at each image's corner in
`imageUrls` order — storyboard mode (default off). `badgePosition` picks
that corner for numbers and labels alike: `"top-left"` (default — the
storyboard convention) or `"top-right"`. `imageLabels` is
index-aligned with `imageUrls` and shows an optional caption after the
number as `3 · Close-up` (the label alone when `numbered` is off);
`null`/`""` = no label for that image, each ≤ 80 chars, and a label too
long to fit its image is ellipsized. Badges never change the layout, the
output size, or the credit cost. Poll
`jobs.get(jobId)` for the finished image.

#### `videoMetadata(input)`

```ts
videoMetadata(input: { url: string }): Promise<VideoMetadata>
```

Probe a social video's metadata (`POST /v1/video-metadata`) — duration,
dimensions, title, live status — **without** downloading it. A direct read,
not a job. Use it to decide whether to trim before importing.

#### `process(input)`

```ts
process(input: {
  sourceUrl: string
  type: "video" | "audio"
  trim?: { startTime: number; endTime: number }
  crop?: { x: number; y: number; width: number; height: number }
  format?: "mp4" | "webm" | "mp3" | "wav" | "m4a" | "aac"
  deleteSource?: boolean
}): Promise<{ data: { url: string; thumbnailUrl: string | null; assetId: string | null; sizeBytes: number; mimeType: string; metadata: Record<string, unknown> } }>
```

Cut or crop a stored file (`POST /v1/media/process`) — synchronous and free,
the source-preparation sibling of the priced `trimVideo` node. `deleteSource:
true` removes the source afterwards when it is yours and nothing else
references it.

---

### `client.audio`

Audio primitives — the building blocks Voice Changer Pro composes internally
(separation, isolation, effect, mix, level), exposed standalone so a consumer
can run any single step or assemble its own pipeline. Every method returns a
job id to poll with `client.jobs.get(jobId)`.

#### `separate(input)`

```ts
separate(input: {
  audioUrl: string
  mode?: "vocal_instrumental" | "stems"
  quality?: "auto" | "fast" | "best"
}): Promise<{ jobId: string }>
```

Separate an audio track into stems (`POST /v1/audio-separation`, Demucs).
`"vocal_instrumental"` (default) splits voice from music/SFX; `"stems"`
returns the full drums/bass/other/… breakdown.

#### `isolate(input)`

```ts
isolate(input: { audioUrl: string }): Promise<{ jobId: string }>
```

Isolate the primary voice and strip background noise
(`POST /v1/audio-isolation`).

#### `applyFx(input)`

```ts
applyFx(input: {
  audioUrl: string
  preset?: AudioFxPreset
  mix?: number
  delayMs?: number
  decay?: number
  eqLow?: number
  eqHigh?: number
}): Promise<{ jobId: string }>
```

Apply a reverb / echo / telephone / megaphone effect (`POST /v1/audio-fx`) —
the same presets the voice changer's `voiceFx` uses, standalone. `mix` (0–100)
is the reverb wet/dry; `delayMs` + `decay` drive `echo`/`custom`;
`eqLow`/`eqHigh` (dB) shape telephone/megaphone.

#### `mix(input)`

```ts
mix(input: { audioUrls: string[]; trackVolumes?: number[] }): Promise<{ jobId: string }>
```

Layer multiple audio tracks into one (`POST /v1/mix-audio`). `audioUrls`
(2–20) are summed; optional `trackVolumes` (0–200% each, positionally) set
per-track level.

#### `adjustVolume(input)`

```ts
adjustVolume(input: {
  audioUrl?: string
  videoUrl?: string
  volume?: number
  normalize?: boolean
  fadeIn?: number
  fadeOut?: number
}): Promise<{ jobId: string }>
```

Adjust an audio (or a video's audio) level (`POST /v1/adjust-volume`):
`volume` % (default 100), `normalize` to loudnorm, `fadeIn`/`fadeOut` seconds.

#### `combine(input)`

```ts
combine(input: {
  segments: Array<{ url: string; startTime?: number; endTime?: number }>
}): Promise<{ jobId: string }>
```

Concatenate audio segments end-to-end (`POST /v1/combine-audio`). Each segment
is a `url` with an optional `[startTime, endTime]` sub-range.

---

### `client.credits`

Authenticated user's credit balance and per-model cost previews.

#### `balance()`

```ts
balance(): Promise<UserBalance>
```

`GET /v1/user/credits` → the authenticated user's credit balance and tier info.
Throws `UnauthorizedError` (401) when signed out.

**`UserBalance`:**

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total available credits. |
| `subscription` | `number` | Credits from the current subscription cycle. |
| `topup` | `number` | One-off purchased credits. |
| `dailySpent` | `number` | Credits spent in the current calendar day. |
| `dailyLimit` | `number \| null` | Daily spending cap (`null` = no cap). |
| `monthlyAllocation` | `number` | Credits allocated per billing cycle. |
| `tier` | `string` | Subscription tier (e.g. `"free"`, `"pro"`). |
| `effectiveTier` | `string` | Entitlement tier actually enforced. `"payg"` = pay-as-you-go: no subscription, but purchased credits — all models unlocked, no watermark, no daily cap. |
| `features` | `Record<string, unknown>` | Feature flags for the tier. |
| `periodEnd` | `string \| null` | ISO-8601 end of the billing period. |
| `appCreditsAllowance` | `number` | Credits earned for app usage (free tier only). |

```ts
const balance = await client.credits.balance()
console.log(`${balance.total} credits available (${balance.tier} tier)`)
```

#### `modelCosts(ids)`

```ts
modelCosts(ids: string[]): Promise<ModelCostsResult>
```

`POST /v1/credits/model-costs` → batch credit cost lookup for editor cost
previews. Capped at the first 50 identifiers. Preserves fault-isolation:
identifiers with no pricing row land in `missing`; lookup failures in `errors`,
instead of failing the whole batch.

**`ModelCostsResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `data` | `Record<string, number>` | Priced identifier → credit cost. |
| `missing` | `string[]` | Identifiers with no pricing row (render `'—'`). |
| `errors` | `string[]` | Identifiers where the lookup itself failed. |

```ts
const { data, missing } = await client.credits.modelCosts(["recraft:v3", "kling:v2.1"])
console.log(data["recraft:v3"])  // e.g. 2
if (missing.length) console.warn("No price for:", missing)
```

---

### `client.uploads`

Upload a file to R2 and get back a public URL + storage metadata.

#### `upload(file)`

```ts
upload(file: File): Promise<UploadResult>
```

Upload one file (`POST /v1/upload`, multipart). The SDK's `request` method
detects the `FormData` body and lets the runtime set the multipart boundary.
Returns the persisted asset's public URL and storage metadata. Throws
`StorageExceededError` (413) over the storage cap.

**`UploadResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Public R2 URL of the stored asset. |
| `assetId` | `string \| null` | Storage row id; `null` when unauthenticated. |
| `thumbnailUrl` | `string \| null` | Generated thumbnail URL (images/video); `null` for audio or on failure. |
| `category` | `string` | Server-classified asset category (`"image"` / `"video"` / `"audio"`). |
| `filename` | `string` | Display filename (server override or original). |
| `mimeType` | `string` | Final MIME type after server normalization. |
| `sizeBytes` | `number` | Stored byte size. |
| `r2Key` | `string` | R2 object key. |

```ts
const result = await client.uploads.upload(file)
console.log(result.url)        // use as sourceImageUrl / audioUrl / videoUrl
console.log(result.assetId)    // reference back to the storage row
```

### `client.library`

#### `list(params?)`

```ts
list(params?: ListLibraryParams): Promise<ListLibraryResult>
```

`GET /v1/library` → the user's stored media with a storage summary. Filter by
`type` (`image` / `video` / `audio`), paginate with `cursor`/`limit`.

---

### `client.presets`

Read your saved node presets and the built-in factory catalog. Read-only over
the SDK today. A preset's `data` is captured node config — merge it into a
node's data when you build a workflow to "apply" the preset. Requires the
`presets:read` scope for OAuth app tokens (no-op for user/API-key auth).

#### `list(nodeType?)`

```ts
list(nodeType?: string): Promise<NodePreset[]>
```

`GET /v1/node-presets` → your custom presets, newest first. Pass a `nodeType`
(e.g. `"generate-image"`) to filter.

```ts
const presets = await client.presets.list("generate-image")
const cinematic = presets.find((p) => p.name === "Cinematic Portrait")
// apply: spread cinematic.data into the node's config when creating a workflow
```

#### `listGroups(nodeType?)`

```ts
listGroups(nodeType?: string): Promise<NodePresetGroup[]>
```

`GET /v1/node-preset-groups` → your preset folders/sections.

#### `listFactory(nodeType)`

```ts
listFactory(nodeType: string): Promise<FactoryPresetsResult>
```

`GET /v1/node-presets/factory` → the built-in catalog for `nodeType`.

```ts
const { data } = await client.presets.listFactory("generate-video")
const orbit = data.find((p) => p.id === "generate-video/orbit-360")
```

---

### `client.pickerCatalogs`

Discover the valid values for **parameter-picker** nodes — the curated catalogs
(setting, mood, person, lens, framing, …) whose selection contributes a
descriptive clause to a downstream node's prompt. Both endpoints are public
(no auth) and publicly cacheable for 5 minutes server-side
(`Cache-Control: public, max-age=300`).

> This is the over-the-wire discovery surface. If you can `import` from
> `@nodaro/shared`, prefer doing so — the catalogs ship as pure, typed,
> tree-shakeable data (see [Parameter Picker Catalogs](./picker-catalogs.md)).
> The SDK endpoints exist for clients that can't bundle the package (and back
> the MCP `get_picker_catalog` tool).

#### `list()`

```ts
list(): Promise<{ data: PickerCatalogSummary[] }>
```

`GET /v1/picker-catalogs` → a directory of every picker: `nodeType`, `label`,
`catalogId`, `kind` (`"single"` / `"multi"`), `valueField` (single-dim) or
`fields` (multi-dim), and `optionCount`.

```ts
const { data } = await client.pickerCatalogs.list()
const moods = data.find((c) => c.nodeType === "mood")
```

#### `get(nodeType, opts?)`

```ts
get(nodeType: string, opts?: GetPickerCatalogOptions): Promise<{ data: PickerCatalog }>
```

`GET /v1/picker-catalogs/:nodeType` → one picker's catalog of valid ids. Single-
dim pickers carry `options`; multi-dim pickers carry `dimensions` (one
`{ field, label, options }` per field); a single-dim picker with secondary
parameter fields beside its main picker (`transition`, `character-fx`:
`position` / `duration` / `intensity`) carries both. 404 `not_found` for an
unknown type.

**`GetPickerCatalogOptions`:**

| Field | Type | Description |
|-------|------|-------------|
| `detail` | `"compact"` \| `"full"` | `"compact"` (default): `id`, `label`, `category`, `term`, `icon`. `"full"`: additionally includes each option's `description` and `promptHint` (the prompt fragment it injects). |
| `category` | `string` | Single-dim pickers: filter options to one category. |
| `field` | `string` | Return only this dimension's field — multi-dim pickers (person / styling / framing), and the secondary parameters of a single-dim picker (transition / character-fx: `position` / `duration` / `intensity`). |

```ts
const { data } = await client.pickerCatalogs.get("mood", { detail: "full" })
const serene = data.options?.find((o) => o.id === "serene")
console.log(serene?.promptHint) // the clause this option injects downstream
console.log(serene?.term) // the compact form — "serene mood"; `label` stays display-only
```

Every option also carries **`term`** at *both* detail levels — the short
professional phrase to inject when you want a compact instruction instead of the
full `promptHint` sentence. Render `label`, inject `term`; never derive one from
the other. A no-op option (`auto` / `none`) has `term: ""` because it injects
nothing.

#### `analyzeText`

```ts
analyzeText(params: TextToPickerParams): Promise<TextToPickerResult>
```

`POST /v1/text-to-picker` → fill picker selections from a **free-text scene
description** ("AI Fill"): the text twin of describe-to-picker. Returns
`{ jobId, pickerJson, gaps }` where `pickerJson` is keyed
`pickerType → dimension → catalog id(s)` — hydrate pickers from it verbatim,
then let the user tweak. Dimensions the text says nothing about are omitted
(the analyzer is instructed not to guess).

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | The scene/shot description (up to the prompt ceiling). |
| `targetPickers` | `string[]?` | Picker node types to fill. Omit for **all** analyzable pickers — the server batches the analysis per catalog family and merges. |
| `instructions` | `string?` | Extra guidance for the analyzer. |
| `llmModel` / `reasoningEffort` | `string?` | Standard LLM selection; billed as the describe-to-picker feature. |

`gaps` reports described attributes no catalog id represents well
(`missingItems` / `missingCategories`) — surface as "we couldn't infer X —
pick one".

```ts
const { pickerJson, gaps } = await client.pickerCatalogs.analyzeText({
  text: "Neon-soaked Tokyo alley at night, rain, handheld tracking shot, moody synthwave",
})
console.log(pickerJson["setting"], pickerJson["camera-motion"], gaps)
```

---

### `client.catalogs`

The **server-driven** catalog projection: every picker catalog in one call,
reflecting the deployment's registered *vendored packs* (a deployment can
replace / extend / deny a catalog's options). Where `client.pickerCatalogs`
fetches one picker at a time, `client.catalogs.list()` returns the whole set at
once — so a thin client that renders its own pickers honors the deployment's
curation. Public (no auth), publicly cacheable for 5 minutes.

#### `list(opts?)`

```ts
list(opts?: { detail?: "compact" | "full" }): Promise<{ data: ProjectedCatalog[] }>
```

`GET /v1/catalogs` → every registered catalog projected to one flat shape.
`detail: "compact"` (default) carries `id`, `label`, `category`, `term`, `icon`;
`detail: "full"` additionally carries each option's `description` and
`promptHint`. A single-dim catalog carries `options`; a multi-dim catalog
carries `dimensions` (one `{ field, label, options }` per field). The shape is
tag/policy-free.

`term` rides at **both** detail levels on purpose: a thin client that renders
its own pickers can display `label` and inject the short professional `term`
without a second, heavier `detail: "full"` fetch.

```ts
const { data } = await client.catalogs.list({ detail: "full" })
const setting = data.find((c) => c.catalogId === "setting")
console.log(setting?.options?.[0]?.promptHint) // full mechanism sentence
console.log(setting?.options?.[0]?.term) // compact professional term
```

---

### `client.shots`

Cine shots — the Share → Remix record behind `/s/:id` share links. A shot
stores builder state (picker `selectionState`, prompts, target `models`,
`@`-mention `entityRefs`, `resultUrls`) under an unguessable 12-char id that
doubles as the share capability. Rows default to **private**; sharing is an
explicit visibility toggle. `resultUrls` must be plain public http(s) URLs —
signed URLs are rejected so a token can never leak into a share record.

```ts
create(input?: CreateShotInput): Promise<{ id: string }>   // POST /v1/shots
get(id: string): Promise<{ shot: Shot }>                   // GET  /v1/shots/:id — public shots readable by anyone with the id; private = owner only (404 otherwise)
update(id: string, input: UpdateShotInput): Promise<{ shot: Shot }>  // PATCH — owner only, any subset (e.g. { visibility: "public" })
delete(id: string): Promise<void>                          // DELETE — owner only
```

---

### `client.community`

Browse, favorite, clone, and report the **admin-curated** community library of
shared characters, locations, and objects. See
[Community Library](./community-library.md) for the feature overview and the
likeness/consent safety rules.

> **Multi-user editions only.** These routes exist on **Business** and **Cloud**
> instances; on a **Community** (single-user) instance they return `404`
> (surfaced as `NotFoundError`).

**Publishing is intentionally NOT in the SDK.** It is an admin/editor-only
action, and the publish route rejects the personal/OAuth tokens the SDK uses.

A `CommunityEntityType` is `"character" | "location" | "object"`. A listing is
returned as a `CommunityCard` (snake_case fields mirroring the wire shape).

#### `browse(params?)`

```ts
browse(params?: BrowseCommunityParams): Promise<BrowseCommunityResult>
```

`GET /v1/community/browse` → a page of public listings plus a `nextCursor`. Pass
the returned `nextCursor` back as `cursor` to fetch the next page (`null` when
there are no more results).

**`BrowseCommunityParams`:**

| Field | Type | Description |
|-------|------|-------------|
| `entityType` | `CommunityEntityType` | Filter to a single asset kind. |
| `q` | `string` | Full-text search across title / description / tags. |
| `category` | `string` | Filter to a single category. |
| `sort` | `"newest" \| "popular"` | Order results. Defaults to `"newest"`. |
| `cursor` | `string` | Cursor token from a previous page. |
| `limit` | `number` | Page size; the backend caps at 50 (default 20). |

```ts
const { data, nextCursor } = await client.community.browse({
  entityType: "character",
  sort: "popular",
  limit: 20,
})
```

#### `get(slug)`

```ts
get(slug: string): Promise<{ data: CommunityCard }>
```

`GET /v1/community/detail/:slug` → a single listing by its slug. Throws
`NotFoundError` when the listing is missing or inactive.

```ts
const { data: listing } = await client.community.get("detective-mara")
```

#### `favorites()`

```ts
favorites(): Promise<{ data: CommunityCard[] }>
```

`GET /v1/community/favorites` → the listings you've favorited.

```ts
const { data: faves } = await client.community.favorites()
```

#### `clone(id, entityType)`

```ts
clone(id: string, entityType: CommunityEntityType): Promise<CloneListingResult>
```

`POST /v1/community/listings/:id/clone` → copy a listing into your library as an
**independent snapshot** (its assets are copied into your own storage, so the
clone survives the original being changed or taken down). Returns
`{ entityType, id }` — the new asset's kind and id. Requires the `assets:write`
scope when called with an OAuth app token. Throws `StorageExceededError` (413)
when your account is over its storage limit.

```ts
const { id } = await client.community.clone(listingId, "character")
// `id` is the new character in your own library
```

#### `favorite(id)`

```ts
favorite(id: string): Promise<FavoriteListingResult>
```

`POST /v1/community/listings/:id/favorite` → toggle a favorite. Returns
`{ favorited }` — `true` after adding, `false` after removing.

```ts
const { favorited } = await client.community.favorite(listingId)
```

#### `report(id, reason)`

```ts
report(id: string, reason: CommunityReportReason): Promise<ReportListingResult>
```

`POST /v1/community/listings/:id/report` → flag a listing for moderation.
`reason` is one of `"real_person_no_consent"` (depicts a real person without
consent), `"inappropriate"`, `"ip_violation"`, or `"other"`. Returns
`{ ok: true }`.

```ts
await client.community.report(listingId, "real_person_no_consent")
```

---

### `client.templates`

The workflow-template marketplace — the public-by-design surfaces only:
browse, a single template with its full snapshot, and the free
clone-into-my-project action. Creator and admin surfaces (publish, mine,
favorites, metadata patch, tutorial flags) are deliberately not part of the
public SDK contract.

#### `browse(params?)`

```ts
browse(params?: BrowseTemplatesParams): Promise<BrowseTemplatesResult>
```

`GET /v1/templates/browse` → cursor-paginated marketplace cards (no auth
required). `params`: `cursor`, `limit`, `category`, `outputType`, `tag`,
`search` (full-text), `sort` (`"newest"` default | `"popular"` |
`"most-favorited"`), `nodeType`, `provider`, `complexity`. Returns
`{ data: TemplateBrowseCard[], nextCursor: string | null }` — pass
`nextCursor` back as `cursor` for the next page.

```ts
const page = await client.templates.browse({ sort: "popular", search: "trailer" })
```

#### `get(slug)`

```ts
get(slug: string): Promise<Template>
```

`GET /v1/templates/:slug` → one public template including its full workflow
snapshot (`snapshotNodes` / `snapshotEdges` / `snapshotSettings`) for
read-only viewers. 404 when the slug is unknown, unlisted, or inactive.

#### `clone(slug, params)`

```ts
clone(slug: string, params: CloneTemplateParams): Promise<CloneTemplateResult>
```

`POST /v1/templates/:slug/clone` → clone the template into one of the
caller's projects. Free — no credits charged. `params`:
`{ projectId, name? }` (name defaults to the template's). Returns
`{ workflowId, projectId }`.

```ts
const { workflowId } = await client.templates.clone("noir-trailer", { projectId })
```

---

### `client.tutorials`

#### `list()`

```ts
list(): Promise<{ categories: TutorialCategory[] }>
```

`GET /v1/tutorials` → every enabled tutorial category with its video
tutorials (`videos`) and flow tutorials (`flows` — workflow templates flagged
as tutorials; each flow's `slug` feeds `client.templates.get`/`clone`).
Public, read-only; curation is an admin surface outside the public SDK.

---

### `client.organizations`

[Organizations](./organizations.md) — a school or a team, the people in it,
and the invitations that fill it. Only on instances that have them; elsewhere
every call answers 404.

Nothing here decides anything. Whether a caller may invite, remove or rename
is the server's answer, delivered as a typed error code
([the table](./organizations.md#errors)) — an SDK that guessed would be wrong
the first time a setting changed.

| Method | Endpoint | Notes |
|--------|----------|-------|
| `list()` | `GET /v1/orgs` | What this account belongs to. |
| `get(id)` | `GET /v1/orgs/:id` | |
| `create(input)` | `POST /v1/orgs` | `{ name, kind: "school" | "team", slug?, acceptTerms?, settings? }`. May return `status: "pending"` — see below. |
| `update(id, input)` | `PATCH /v1/orgs/:id` | `{ name?, settings? }` |
| `delete(id)` | `DELETE /v1/orgs/:id` | Soft-delete. Nothing is destroyed. |
| `transferOwnership(id, userId)` | `POST /v1/orgs/:id/transfer-ownership` | The caller becomes an admin. |
| `leave(id)` | `POST /v1/orgs/:id/leave` | An owner cannot — transfer first (`owner_cannot_leave`). |
| `listMembers(orgId, { cursor?, limit? })` | `GET /v1/orgs/:id/members` | Returns `{ data, nextCursor }`. |
| `updateMember(orgId, userId, input)` | `PATCH /v1/orgs/:id/members/:userId` | `{ role?, status? }` |
| `removeMember(orgId, userId)` | `DELETE /v1/orgs/:id/members/:userId` | |
| `invite(orgId, input)` | `POST /v1/orgs/:id/invitations` | `{ emails, orgRole?, workspaceId?, workspaceRole? }`. **Read the note below.** |
| `listInvitations(orgId, opts)` | `GET /v1/orgs/:id/invitations` | `{ status?, workspaceId?, cursor?, limit? }` |
| `revokeInvitation(id)` | `DELETE /v1/invitations/:id` | |
| `resendInvitation(id)` | `POST /v1/invitations/:id/resend` | |
| `previewInvitation(token)` | `GET /v1/invitations/by-token/:token` | **Public** — works while the invitee is still signed out. The address comes back masked. |
| `acceptInvitation(token)` | `POST /v1/invitations/:token/accept` | Requires a signed-in caller whose email matches. |
| `audit(orgId, { cursor?, limit? })` | `GET /v1/orgs/:id/audit` | Newest first. Readable while the organization is suspended. |
| `usage(orgId, opts)` | `GET /v1/orgs/:id/usage` | Credits by `workspace`, `member`, `model` or `day`. Owner and org admins. `{ from?, to?, tz?, groupBy?, workspaceId?, userId? }`, inclusive dates, IANA `tz`, ≤ 366 days. |
| `usageRows(orgId, opts)` | `GET /v1/orgs/:id/usage?groupBy=none` | The individual runs behind a report, newest first, cursor-paged. |
| `usageCsv(orgId, opts)` | `GET /v1/orgs/:id/usage?format=csv` | The same report (or the rows) as CSV text. |

`invite` returns **one row per address**, and a row whose `status` is not
`sent` carries a `link` instead — an install with no mail provider, or a
delivery that failed. Surface it: the invitation exists either way, and
without the link nobody can reach it.

`audit` entries carry an `action` from an **open vocabulary**. Render the
ones you recognise and fall back to the raw string; a client that switched
exhaustively over it would break on the first new action.

`usage` reports three credit figures per row. `credits` is what a run has cost
so far — settled where the run finished, the held reservation otherwise — and
`settledCredits` and `inFlightCredits` split it. A metered run that overran the
workspace's headroom has the excess absorbed by the platform; the totals report
it as `platformAbsorbedCredits`, and `chargedToBudget = settledCredits −
platformAbsorbedCredits` is the metered settlement that reached the budget. An
approved-app markup the budget could not cover is absorbed separately as
`appMarkupAbsorbedCredits`; it has no run in the report, so it is not in
`chargedToBudget` (which is therefore not, by itself, the workspace's spent
figure). Totals cover the whole window even when a grouping is `truncated`.

---

### `client.workspaces`

Workspaces — the inner tenancy axis, where work lives. Belonging to a
workspace and *acting in* one are different things: this resource is the
first, [`withWorkspace`](#clientwithworkspaceworkspaceid) is the second.

| Method | Endpoint | Notes |
|--------|----------|-------|
| `list()` | `GET /v1/workspaces` | `{ data, lastWorkspaceId }`. Byte-for-byte the list `GET /v1/me` carries, so there is one truth to reconcile against — these are **summaries**, not full views. |
| `listForOrg(orgId, { includeArchived? })` | `GET /v1/orgs/:id/workspaces` | |
| `get(id)` | `GET /v1/workspaces/:id` | The full view. |
| `create(orgId, input)` | `POST /v1/orgs/:id/workspaces` | `{ name, slug?, description?, settings? }` |
| `update(id, input)` | `PATCH /v1/workspaces/:id` | `{ name?, description?, settings? }` |
| `setArchived(id, archived)` | `POST /v1/workspaces/:id/archive` | `/unarchive` | Reversible, destroys nothing: the workspace stops accepting new work and stays fully readable. |
| `listMembers(id, { cursor?, limit? })` | `GET /v1/workspaces/:id/members` | |
| `addMember(id, input)` | `POST /v1/workspaces/:id/members` | `{ userId, role }`. The person must already be in the organization; to bring in a new one, invite them. |
| `updateMember(id, userId, input)` | `PATCH /v1/workspaces/:id/members/:userId` | `{ role?, status?, creditCap? }` |
| `removeMember(id, userId)` | `DELETE /v1/workspaces/:id/members/:userId` | |
| `getJoinCode(id)` | `GET /v1/workspaces/:id/join-code` | `null` when none has been minted. Admins only. |
| `actOnJoinCode(id, action)` | `POST /v1/workspaces/:id/join-code` | `"rotate" | "enable" | "disable"`. Rotating invalidates the old code immediately. |
| `join(code)` | `POST /v1/workspaces/join` | Another way IN, so a stale workspace selection never blocks it. |
| `usage(id, opts)` | `GET /v1/workspaces/:id/usage` | By `member`, `model` or `day`. A member sees their own runs; an admin sees everyone and may filter `userId`. |
| `usageRows(id, opts)` | `GET /v1/workspaces/:id/usage?groupBy=none` | The runs behind a report, newest first, cursor-paged. |
| `usageCsv(id, opts)` | `GET /v1/workspaces/:id/usage?format=csv` | The same report (or the rows) as CSV text. |

---

## Type re-exports

Every type used in a public method signature is re-exported from
`@nodaro/sdk`. Import them with `import type { ... }`.

### Client identity

- `UserIdentity` — return type of `client.me()`: `{ id, email, displayName: string | null, avatarUrl: string | null, tier, isAdmin }`
- `ClientOptions` — `createClient` options: `{ baseUrl, auth, fetch?, timeoutMs?, clientLabel?, workspaceId? }`

### Organizations

Re-exported from `@nodaro/shared`, so an integration needs one dependency and
not two.

- `OrganizationView` / `OrgMemberView` / `WorkspaceView` / `WorkspaceMemberView` — the full records
- `OrganizationSummary` / `WorkspaceSummary` / `MeOrganizations` — what `GET /v1/me` and `GET /v1/workspaces` carry
- `InvitationView` / `InvitationDelivery` / `InvitationPreview` / `InvitationState` — invitations; `InvitationDelivery.link` is the one to surface
- `JoinCodeView`, `OrgAuditEntry`, `OrgPage<T>`
- `OrgKind` / `OrgRole` / `WorkspaceRole` / `MemberStatus` / `OrgStatus` / `OrgSettings` / `WorkspaceSettings`
- `UsageReport` / `UsageReportRow` / `UsageVarianceRow` / `UsageReportTotals` — the grouped report; `UsageLogEntry` — a row of `usageRows`; `UsageQuery` / `UsageGroupBy` / `USAGE_GROUP_BYS` — the query and its `groupBy` values
- `OrgErrorCode` — the codes to dispatch on; `WORKSPACE_HEADER` — the header name; `USAGE_GROUP_BYS` — the report groupings

### Templates & tutorials

- `TemplateBrowseCard` / `BrowseTemplatesParams` / `BrowseTemplatesResult` / `TemplateSort` — marketplace browse
- `Template` — full public template incl. `snapshotNodes` / `snapshotEdges` / `snapshotSettings`
- `CloneTemplateParams` / `CloneTemplateResult` — `{ projectId, name? }` → `{ workflowId, projectId }`
- `TutorialCategory` / `TutorialVideoItem` / `TutorialFlowItem` — grouped `client.tutorials.list()` response

### Workflows

- `Workflow` — workflow record (full record on `get`/`create`/`update`, metadata only on `list`)
- `ListWorkflowsParams` — `{ projectId }`
- `CreateWorkflowInput` — `{ projectId, name, ... }`
- `UpdateWorkflowInput` — partial workflow fields
- `RunWorkflowParams` — `{ nodeIds? }`
- `RunWorkflowResult` — `{ executionId, status }`

### Projects

- `Project` — project record
- `CreateProjectInput`, `UpdateProjectInput`

### Jobs

- `Job` — snake_case wire shape; includes provenance: `source` (`"internal" | "mcp" | "app" | "cli" | "sdk" | "extension" | "web" | "api"`) + `source_detail` (origin host / `extension/<name>` label / `sdk/<version>` / MCP client / app id) so a library view can label or filter media by origin
- `JobStatus` — `"pending" | "queued" | "processing" | "pending_review" | "completed" | "failed" | "cancelled"`. `pending_review` is **in-flight, not terminal**: a job policy registered by the deployment held the output for human review. Keep waiting — it resolves to `completed` (approved), `failed` (rejected, with `error_hint.kind === "policy-block"`) or `cancelled` (the owner cancelled it; a held job is cancellable like any in-flight job), and `credit_status` reads `"reserved"` for the whole hold. `runAndWait` throws `JobHeldError` on the first held tick rather than waiting it out. Only appears on deployments that register a job policy.
- `JobStatusResult` — lean poll shape: `{ id, status, progress?, output_data?, error_message? }`
- `CancelJobResult` — `{ success: true, cancelled: number }`
- `ListJobsParams` / `ListJobsPage` — `jobs.list` filters and page

### LLM

- `LlmStructuredInput`, `LlmStructuredResult<T>`, `LlmStructuredJobInput`, `LlmStructuredJobOutput<T>`

### Video Pro run control

- `StopVideoProResult` — `{ jobId, stopping? } | { jobId, success?, cancelled? }` (pending jobs forward the generic cancel result)
- `ContinueVideoProResult` — `{ jobId, continuedFromJobId?, fromSegment?, segmentCount?, deduped? }`

### Executions

- `WorkflowExecution` — full execution record with per-node state map
- `WorkflowExecutionSummary` — list-row shape
- `NodeExecutionState` — per-node entry inside `nodeStates`
- `ExecutionStatus` — `"pending" | "running" | "completed" | "failed" | "cancelled" | "stopping" | "timed_out" | "discarded"`
- `ExecutionTriggerType` — `"manual" | "webhook" | "schedule" | "app_run" | "single-node"`
- `ListExecutionsForWorkflowParams` — pagination + filters
- `ListExecutionsPage<T>` — `{ data: T[], nextCursor? }`
- `CancelExecutionParams` — `{ mode?: "after_current" | "discard" }`

### Nodes

- `NodeDescriptor` — public metadata for one node type
- `NodeCategory` — union of category slugs
- `OutputType` — `"text" | "image" | "video" | "audio" | "data" | "none"`
- `NodeInputField`, `NodeInputSchema` — input-schema shapes
- `PromptAffixFields` — the `{ promptPrefix?, promptSuffix? }` node-data contract for [pre & post text](./prompt-pre-post-text.md); `PROMPT_PREFIX_KEY` / `PROMPT_SUFFIX_KEY` are the matching key constants (value exports, not types)
- `RunNodeResult` — `{ jobId: string; ... } | Record<string, unknown>` (discriminated on presence of `jobId`)
- `RunNodeAdjustment` — one parameter correction on the image node types: `{ field: "aspectRatio" | "resolution" | "quality" | "duration", from, to?, reason }` (re-exported from `@nodaro/shared`'s `ModelInputAdjustment`); see [Parameter corrections](./api-integration.md#4d-parameter-corrections-adjustments)
- `NodeJobOutput` — typed `output_data` shape: `{ audioUrl?, videoUrl?, imageUrl?, thumbnailUrl?, [k]: unknown }`
- `RunAndWaitOptions` — `{ signal?, onProgress?, pollMs?, maxMs? }`
- `RunManyResult` — `{ jobId: string; output: NodeJobOutput }`

### Characters

- `Character` — full character record (camelCase)
- `CharacterDetail` — `Character` plus in-flight `pendingJobs` / `portraitCandidates` / `previousCandidates` buckets
- `CharacterUsage` — `{ workflowCount, workflows: { id, name }[] }`
- `ReferencePhoto`, `ReferencePhotoKind` — identity reference photo shapes
- `UpsertCharacterInput` — body for `upsert()` / `create()` / `update()`
- `UpsertCharacterResult` — `{ id, name? }`
- `ListCharactersParams` — `{ projectId?, archived?, limit? }`
- `DuplicateCharacterInput` — `{ nodeId?, projectId? }`
- `GenerateCharacterInput` — body for `generate()`
- `GenerateCharacterResult` — `{ jobId, jobIds[] }`
- `GenerateAssetInput`, `GenerateMotionInput` — bodies for asset / motion generation
- `ApprovePortraitResult` — `{ portraitUrl, canonicalDescription: string | null }`
- `RecaptionResult` — `{ canonicalDescription }`

### Locations

- `Location` — full location record (camelCase)
- `LocationDetail` — `Location` plus in-flight `pendingJobs` + completed `previousCandidates` buckets
- `LocationReferencePhoto`, `LocationReferencePhotoKind` — mood-board reference shapes
- `CreateLocationInput`, `UpdateLocationInput` — bodies for `create()` / `update()`
- `UpdateLocationResult` — `{ id, updatedAt }`
- `ListLocationsParams` — query params for `list()`
- `GenerateLocationInput`, `GenerateLocationResult` — body + response for `generate()`
- `GenerateLocationAssetInput` — body for `generateAsset()`
- `GenerateSurroundContinuationInput` — body for `generateSurroundContinuation()`
- `ApproveMainImageResult` — `{ ..., canonicalDescription: string | null }`
- `RecaptionLocationResult` — `{ canonicalDescription }`
- `LocationAssetType` — asset-bucket enum (re-exported alongside `LOCATION_ASSET_TYPES` runtime tuple)
- `LocationAttachColumn` — attach-column enum (re-exported alongside `LOCATION_ATTACH_COLUMNS` runtime tuple)

### Objects

- `Object` — full object record (camelCase). Re-exportable as `NodaroObject` to avoid shadowing the JS global.
- `ObjectDetail` — `Object` plus in-flight `pendingJobs` bucket.
- `ObjectCategory` — 10-value enum: `"furniture" | "vehicle" | "weapon" | "food" | "clothing" | "electronics" | "nature" | "tool" | "animal" | "other"`. Distinct from location's geography-based set.
- `ObjectReferencePhoto`, `ObjectReferencePhotoKind` — `kind` is one of `"front" | "side" | "detail" | "context" | "moodBoard" | "other"` (6 values; no PII consent unlike locations).
- `ObjectAssetType` — 5-value enum from `@nodaro/shared`: `"angles" | "materials" | "variations" | "motion" | "custom"`. Re-exported from `@nodaro/sdk` so consumers don't need a second dep.
- `ObjectAttachColumn` — 4-value enum from `@nodaro/shared`: `"angles" | "materials" | "variations" | "motion_clips"`. Re-exported alongside `OBJECT_ATTACH_COLUMNS` runtime tuple.
- `ObjectAspectRatio` — 5-value enum: `"1:1" | "3:4" | "16:9" | "9:16" | "4:3"`. Re-exported alongside `OBJECT_ASPECT_OPTIONS` / `OBJECT_ASPECT_DEFAULTS` runtime tuples. Distinct from `CharacterAspectRatio` because objects support an extra `4:3` framing for product-showcase shots.
- `CreateObjectInput`, `UpdateObjectInput`, `UpsertObjectInput` — bodies for `create()` / `update()` / `upsert()`. `expectedUpdatedAt` lives on `UpdateObjectInput` + `UpsertObjectInput`.
- `UpdateObjectResult`, `UpsertObjectResult` — `{ id }` (create) or `{ id, updatedAt }` (update).
- `ListObjectsParams` — `{ archived?, projectId? }`.
- `GenerateObjectInput`, `GenerateObjectResult` — body + response (always `{ jobIds: string[] }`; `jobId?` is a deprecated `count === 1` alias).
- `GenerateObjectAssetInput`, `GenerateObjectAssetResult` — `{ jobId }`.
- `GenerateObjectMotionInput`, `GenerateObjectMotionResult` — `{ jobId }`. `aspectRatio` field is `ObjectAspectRatio` (5-value union).
- `ApproveObjectMainImageResult` — `{ sourceImageUrl, canonicalDescription: string | null }` (the wire sends `""` on LLM sub-failure but the SDK normalizes `""` → `null` before returning).
- `RecaptionObjectResult` — `{ canonicalDescription }`.

### Pipelines

- `PipelineRecord` — pipeline state: `{ id, status, current_stage, spent_credits, reserved_credits, upfront_credit_estimate, branched_from_pipeline_id, branched_from_stage, mode, failure_reason, current_progress_message }`
- `PipelineStatus`, `PipelineMode`, `PipelineStageName`, `SubGateName`, `ChatEnabledStage` — re-exported from `@nodaro/shared`
- `PipelineInput` — body for `create()`, re-exported from `@nodaro/shared`
- `PendingApproval` — `{ stage_name: PipelineStageName; output: unknown }`
- `PipelineTimeline` — `{ fps, width, height, scenes, musicUrl?, narrationUrl?, animateProgress? }`
- `BranchPipelineInput` — `{ fromStage: PipelineStageName }`
- `BranchPipelineResult` — `{ pipelineId, clonedStages, clonedEntities }`
- `ChatTurn` — one persisted turn: `{ id, turn_n, role, content, proposed_change, llm_call_id, applied_to_attempt_id, created_at }`
- `ChatStageResult` — assistant reply: `{ turnId, role: "assistant", content, proposed_change }`
- `ApplyChatProposalResult` — `{ applied: true; attemptId; newOutput } | { applied: false; error: { code, detail? } }`
- `ProposedChange` — discriminated union re-exported from `@nodaro/shared`

### Reduce

- `ReduceStrategyId` — union of reduction-strategy slugs
- `ReduceMeta` — per-reduction metadata
- `ReduceInput` — body for `reduce()`
- `ReduceResult` — reduction response

### Prompt helper

- `AnalyzeInput`, `AnalyzeResult` — body + response for `analyze()`
- `GenerateInput` — body for `generate()`
- `EnhanceInput` — body for `enhance()`
- `PromptResult` — shared prompt response shape
- `WizardQuestion`, `WizardOption`, `WizardSelection` — prompt-wizard Q&A shapes (re-exported from `@nodaro/shared`)
- `RecommendedModel` — wizard model recommendation (re-exported from `@nodaro/shared`)
- `WizardNodeContext` — node context passed into the wizard (re-exported from `@nodaro/shared`)

### Voices

- `Voice` — premade ElevenLabs voice record, re-exported from `@nodaro/shared`
- `VoiceClone` — user clone record (`elevenlabsVoiceId` is the TTS-time id), re-exported from `@nodaro/shared`
- `VoiceLibraryParams` — query params for `searchLibrary()`, re-exported from `@nodaro/shared`
- `VoiceLibraryResponse` — `{ voices: Voice[]; hasMore: boolean; ... }`, re-exported from `@nodaro/shared`
- `VoiceChangerProInput` — full `recast()` input (see its section above)
- `VoiceChangerProVoice` — one `orderedVoices` entry: voice id string or per-voice settings object
- `VcpAnalyzeInput` — `analyze()` input
- `VcpAnalysis` / `VcpAnalysisSpeaker` — an analyze result, reshaped for `recast({ analysis })`
- `VcpExportInput` / `VcpExportTrack` — `exportMix()` input / one mix lane
- `VoiceDesignInput`, `VoiceRemixInput`, `DubbingInput` — inputs for `design()` / `remix()` / `dub()`
- `AudioFxPreset` — the fx preset union used by `voiceFx.preset` and `audio.applyFx`, re-exported from `@nodaro/shared`

### Media & audio

- `VideoMetadata` — `media.videoMetadata()` result (best-effort probe fields)
- `DownloadVideoProgress` — one `media.downloadVideoProgress()` event: `{ phase, percent, videoUrl?, thumbnailUrl?, error? }`
- `MediaProcessInput`, `MediaProcessResult` — `media.process()` input / stored-file result

### Credits

- `UserBalance` — full balance + tier record (see `balance()` table above)
- `ModelCostsResult` — `{ data: Record<string, number>; missing: string[]; errors: string[] }`

### Uploads

- `UploadResult` — `{ url, assetId, thumbnailUrl, category, filename, mimeType, sizeBytes, r2Key }` (see `upload()` table above)

### Developer apps

- `DeveloperApp` — app record (without secret)
- `DeveloperAppScope` — union of valid scope strings
- `DeveloperAppStatus` — `"active" | "suspended" | "pending_review"`
- `CreateDeveloperAppInput`, `UpdateDeveloperAppInput`
- `CreateDeveloperAppResult` — `DeveloperApp & { clientSecret }`
- `RotateSecretResult` — `{ clientSecret }`

### OAuth

- `ExchangeCodeInput` — `{ client_id, client_secret, code, redirect_uri }`
- `AccessTokenResponse` — `{ access_token, token_type, scope, expires_in }`
- `OAuthAppInfo` — public app metadata for consent screens

### Apps

- `PublishedApp` — published-app list/summary record
- `PublishedAppDetail` — full published-app record with input schema
- `ListAppsParams` — query params for `list()`
- `ListAppsResult` — paginated `list()` response
- `AppRunResult` — response from running an app
- `RunAppOptions` — third argument to `run()`: `{ inputOverrides?: Record<string, Record<string, unknown>> }`
- `AppRun` — a single app-run record
- `ListAppRunsParams` — query params for `listRuns()`
- `DeleteAppRunResult` — `{ success }`-style delete response

### Community

- `CommunityCard` — a public community listing (shared character/location/object)
- `CommunityEntityType` — `"character" | "location" | "object"`
- `CommunitySort` — `"newest" | "popular"`
- `CommunityReportReason` — accepted `report()` reasons
- `BrowseCommunityParams` — query params for `browse()`
- `BrowseCommunityResult` — paginated `browse()` response
- `CloneListingResult` — `{ entityType, id }` from `clone()`
- `FavoriteListingResult` — `{ favorited }` from `favorite()`
- `ReportListingResult` — `{ ok }` from `report()`

### Picker catalogs

- `PickerCatalogSummary` — one row of `pickerCatalogs.list()`: `{ nodeType, label, catalogId, kind, valueField?, fields?, optionCount }`
- `PickerCatalog` — full catalog from `pickerCatalogs.get()`: single-dim carries `options`, multi-dim carries `dimensions`
- `PickerOption` — one selectable id: `{ id, label, description?, category?, promptHint?, term?, icon? }` (`promptHint` present only with `detail: "full"`; `term` — the short professional term to inject, `label` being display-only — present at both detail levels)
- `PickerDimension` — a multi-dim field: `{ field, label, options }`
- `GetPickerCatalogOptions` — `get()` options: `{ detail?, category?, field? }`

### Generic node/edge

Re-exported from `@nodaro/shared` for convenience:

- `GenericNode` — React Flow-compatible node shape used by `Workflow.nodes`
- `GenericEdge` — React Flow-compatible edge shape used by `Workflow.edges`

---

## See also

- [SDK Quickstart](./sdk-quickstart.md) — task-oriented walkthrough
- [OAuth Flow](./oauth-flow.md) — third-party app authorization-code flow
- [API Integration](./api-integration.md) — direct REST patterns
