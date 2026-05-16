# `@nodaro/client` API Reference

Complete reference for every public export of `@nodaro/client`. For a
walkthrough-style introduction, see the [SDK Quickstart](./sdk-quickstart.md).

## Table of contents

- [`createClient(options)`](#createclientoptions)
- [Auth providers](#auth-providers)
- [Errors](#errors)
- [Resources](#resources)
  - [`client.workflows`](#clientworkflows)
  - [`client.projects`](#clientprojects)
  - [`client.jobs`](#clientjobs)
  - [`client.executions`](#clientexecutions)
  - [`client.nodes`](#clientnodes)
  - [`client.characters`](#clientcharacters)
  - [`client.developerApps`](#clientdeveloperapps)
  - [`client.oauth`](#clientoauth)
- [Type re-exports](#type-re-exports)

---

## `createClient(options)`

Factory that returns a `NodaroClient` instance with all resource subobjects
attached.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

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

The instance exposes nine resource objects: `workflows`, `projects`, `jobs`,
`executions`, `nodes`, `characters`, `apps`, `developerApps`, `oauth`. It also
exposes a low-level `request<T>(method, path, options)` method for endpoints
not yet wrapped by a resource.

### `class NodaroClient`

You normally call `createClient`, but the class is also exported for
typechecking (`function takesClient(c: NodaroClient) { ... }`).

```ts
import { NodaroClient } from "@nodaro/client"
```

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
import { StaticTokenAuth } from "@nodaro/client"
new StaticTokenAuth("ndr_app_abc123...")
```

**Constructor:** `new StaticTokenAuth(token: string)`

### `class CallbackAuth`

Calls a user-supplied function on every request. The function may be sync or
async, and may return `null` to skip the header (anonymous request).

```ts
import { CallbackAuth } from "@nodaro/client"

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
import { supabaseAuth } from "@nodaro/client"
import { createClient as createSupabase } from "@supabase/supabase-js"

const supabase = createSupabase(URL, ANON_KEY)
const auth = supabaseAuth(supabase)
```

**Signature:** `supabaseAuth(supabase: SupabaseLikeClient): Auth`

The argument is structurally typed — only `supabase.auth.getSession()` is called.
Any client matching that shape works.

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

### `throwFromResponse(status, body)`

Internal helper that maps `(status, JSON body)` to the right error class and
throws it. Exported so custom transports can reuse it. Returns `never`.

```ts
import { throwFromResponse } from "@nodaro/client"
throwFromResponse(403, { error: { code: "insufficient_scope", message: "...", missingScope: "workflows:execute" } })
// → throws ForbiddenError with .missingScope === "workflows:execute"
```

---

## Resources

Every resource is constructed automatically by `createClient` and reachable via
`client.<resource>`. The classes are also exported for advanced typechecking
but rarely need to be imported directly:
`WorkflowsResource`, `ProjectsResource`, `JobsResource`, `ExecutionsResource`,
`NodesResource`, `CharactersResource`, `AppsResource`, `DeveloperAppsResource`,
`OAuthResource`.

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

```ts
await client.workflows.update(id, { name: "Renamed" })
```

#### `delete(id)`

```ts
delete(id: string): Promise<{ success: true }>
```

Deletes a workflow.

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

#### `import(input)`

```ts
import(input: WorkflowExport & { projectId: string }): Promise<{ data: Workflow }>
```

Imports a `WorkflowExport` bundle into the specified project. Re-creates any
bundled assets (characters, objects, locations) under your account. Returns the
full record of the newly created workflow.

```ts
const { data: wf } = await client.workflows.import({ ...bundle, projectId })
```

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

The returned `Job` uses snake_case fields to match the wire format. Sensitive
fields (`provider`, `provider_cost`, `credits_actual`) are stripped server-side
for non-admin callers.

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

Cancels an execution. Default cancels immediately; `mode: "after_current"`
sets the execution to `"stopping"` so in-flight nodes finish first.

```ts
await client.executions.cancel(executionId, { mode: "after_current" })
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
console.log(data.providers, data.creditCost)
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

```ts
const { characters } = await client.characters.list({ projectId, limit: 50 })
```

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

```ts
const { jobIds } = await client.characters.generate({
  name: "Kira",
  seedPrompt: "kira portrait, warm natural lighting",
  count: 4,
  attachToCharacterId,
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

Animates the character's portrait into a motion clip via image-to-video.
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
const info = await client.oauth.getAppInfo("ndr_client_abc123")
// { name, description, logoUrl, homepageUrl, scopesRequested }
```

---

## Type re-exports

Every type used in a public method signature is re-exported from
`@nodaro/client`. Import them with `import type { ... }`.

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

- `Job` — snake_case wire shape
- `JobStatus` — `"pending" | "queued" | "processing" | "completed" | "failed" | "cancelled"`
- `CancelJobResult` — `{ success: true, cancelled: number }`

### Executions

- `WorkflowExecution` — full execution record with per-node state map
- `WorkflowExecutionSummary` — list-row shape
- `NodeExecutionState` — per-node entry inside `nodeStates`
- `ExecutionStatus` — `"pending" | "running" | "completed" | "failed" | "cancelled" | "stopping" | "timed_out"`
- `ExecutionTriggerType` — `"manual" | "webhook" | "schedule" | "app_run" | "single-node"`
- `ListExecutionsForWorkflowParams` — pagination + filters
- `ListExecutionsPage<T>` — `{ data: T[], nextCursor? }`
- `CancelExecutionParams` — `{ mode? }`

### Nodes

- `NodeDescriptor` — public metadata for one node type
- `NodeCategory` — union of category slugs
- `OutputType` — `"text" | "image" | "video" | "audio" | "data" | "none"`
- `NodeInputField`, `NodeInputSchema` — input-schema shapes

### Characters

- `Character` — full character record (camelCase)
- `CharacterDetail` — `Character` plus in-flight `pendingJobs` / `portraitCandidates` / `previousCandidates` buckets
- `CharacterUsage` — `{ workflowCount, workflows: { id, name }[] }`
- `ReferencePhoto`, `ReferencePhotoKind` — identity reference photo shapes
- `UpsertCharacterInput` — body for `upsert()` / `create()` / `update()`
- `UpsertCharacterResult` — `{ id, name? }`
- `ListCharactersParams` — `{ projectId?, archived? }`
- `DuplicateCharacterInput` — `{ nodeId?, projectId? }`
- `GenerateCharacterInput` — body for `generate()`
- `GenerateCharacterResult` — `{ jobId, jobIds[] }`
- `GenerateAssetInput`, `GenerateMotionInput` — bodies for asset / motion generation
- `ApprovePortraitResult` — `{ portraitUrl, canonicalDescription: string | null }`
- `RecaptionResult` — `{ canonicalDescription }`

### Developer apps

- `DeveloperApp` — app record (without secret)
- `DeveloperAppScope` — union of valid scope strings
- `DeveloperAppStatus` — `"active" | "suspended" | "pending"`
- `CreateDeveloperAppInput`, `UpdateDeveloperAppInput`
- `CreateDeveloperAppResult` — `DeveloperApp & { clientSecret }`
- `RotateSecretResult` — `{ clientSecret }`

### OAuth

- `ExchangeCodeInput` — `{ client_id, client_secret, code, redirect_uri }`
- `AccessTokenResponse` — `{ access_token, token_type, scope, expires_in }`
- `OAuthAppInfo` — public app metadata for consent screens

### Generic node/edge

Re-exported from `@nodaro/shared` for convenience:

- `GenericNode` — React Flow-compatible node shape used by `Workflow.nodes`
- `GenericEdge` — React Flow-compatible edge shape used by `Workflow.edges`

---

## See also

- [SDK Quickstart](./sdk-quickstart.md) — task-oriented walkthrough
- [OAuth Flow](./oauth-flow.md) — third-party app authorization-code flow
- [API Integration](./api-integration.md) — direct REST patterns
