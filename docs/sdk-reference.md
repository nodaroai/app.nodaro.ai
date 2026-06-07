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
  - [`client.locations`](#clientlocations)
  - [`client.objects`](#clientobjects)
  - [`client.pipelines`](#clientpipelines)
  - [`client.reduce`](#clientreduce)
  - [`client.promptHelper`](#clientprompthelper)
  - [`client.apps`](#clientapps)
  - [`client.developerApps`](#clientdeveloperapps)
  - [`client.oauth`](#clientoauth)
  - [`client.voices`](#clientvoices)
  - [`client.credits`](#clientcredits)
  - [`client.uploads`](#clientuploads)
  - [`client.presets`](#clientpresets)
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

The instance exposes 17 resource objects: `workflows`, `projects`, `jobs`,
`executions`, `nodes`, `characters`, `locations`, `objects`, `pipelines`,
`reduce`, `promptHelper`, `apps`, `developerApps`, `oauth`, `voices`,
`credits`, `uploads`. It also exposes a low-level
`request<T>(method, path, options)` method for endpoints not yet wrapped by a
resource.

### `class NodaroClient`

You normally call `createClient`, but the class is also exported for
typechecking (`function takesClient(c: NodaroClient) { ... }`).

```ts
import { NodaroClient } from "@nodaro/client"
```

### `client.me()`

Resolves the authenticated user's canonical identity (`GET /v1/me`). A token-
introspection primitive: any valid bearer token (a first-party Supabase JWT or
a developer-app OAuth token) resolves to its owner's identity. Throws
`UnauthorizedError` (401) when the token is missing or invalid.

```ts
const me = await client.me()
// { id, email, displayName, avatarUrl, tier }
```

**Signature:** `me(): Promise<UserIdentity>`

Returns `UserIdentity`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Nodaro user id (= the Supabase auth user id). |
| `email` | `string` | The user's email. |
| `displayName` | `string \| null` | Human-readable display name (from `profiles.full_name`); `null` if unset. |
| `avatarUrl` | `string \| null` | Avatar URL; `null` if unset. |
| `tier` | `string` | Subscription tier (e.g. `"free"`, `"pro"`). |

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
`NodesResource`, `CharactersResource`, `LocationsResource`, `ObjectsResource`,
`PipelinesResource`, `ReduceResource`, `PromptHelperResource`, `AppsResource`,
`DeveloperAppsResource`, `OAuthResource`, `VoicesResource`, `CreditsResource`,
`UploadsResource`.

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

#### `getStatus(id)`

```ts
getStatus(id: string): Promise<{ data: JobStatusResult }>
```

Returns the lean status of a job — id, status, progress, output_data, and
error_message (`GET /v1/jobs/:id/status`). Far less wire + CPU cost than
`get()` because it skips `input_data` JSONB and the public sanitize pass.
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
console.log(data.providers, data.creditCost)
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
until a terminal status, up to `opts.maxMs` (default ~15 min).

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
list(params?: ListLocationsParams): Promise<{ locations: Location[] }>
```

Lists the caller's locations. By default returns active locations only;
pass `archived: true` for an "archive" view.

```ts
const { locations } = await client.locations.list()
const { locations: archived } = await client.locations.list({ archived: true })
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
generations the studio uses to rehydrate spinners after a reload).
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

```ts
const { objects } = await client.objects.list()
const { objects: archived } = await client.objects.list({ archived: true })
```

> `Object` shadows the JS global, which TypeScript handles cleanly via
> local-scope resolution. Callers who need both can alias as
> `import type { Object as NodaroObject } from "@nodaro/client"`.

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
| `pick-best-llm` | `{ criteria: string, inputKind?: "text" \| "image-url" }` |
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
[API Integration §12](./api-integration.md#12-prompt-wizard)) and reserve
credits per call.

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

#### `run(slug, inputs?)`

```ts
run(slug: string, inputs?: Record<string, unknown>): Promise<AppRunResult>
```

Triggers an app run. `inputs` keys must match the app's input-schema field
names. Returns `{ executionId, status, runId? }` — poll via
`client.executions.get(executionId)`.

```ts
const { executionId } = await client.apps.run("pro-headshot", { photo: url })
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
signed-in user's voice clones, and the **voice changer**.

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

```ts
const { voices, hasMore } = await client.voices.searchLibrary({ search: "deep", language: "en" })
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
  stability?: number
  similarityBoost?: number
  style?: number
  removeBackgroundNoise?: boolean
}): Promise<{ jobId: string }>
```

Replace the voice in a recording — or in a whole talking video — with a
different voice (`POST /v1/voice-changer`). Pass **`audioUrl`** to revoice
audio→audio, or **`videoUrl`** to revoice an entire clip: the server demuxes the
audio, runs speech-to-speech, and remuxes the new voice onto the original video.
Exactly one of `audioUrl` / `videoUrl` is required; **when both are sent, video
wins**. `style` is a style exaggeration factor (0–1; default 0 — >0 amplifies
delivery at the cost of latency/stability). `removeBackgroundNoise` off keeps
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

`GET /v1/node-presets/factory` → the built-in catalog for `nodeType` plus
`popularIds` (ids of the most-used quick-picks, in popularity order).

```ts
const { data, popularIds } = await client.presets.listFactory("generate-video")
const popular = data.filter((p) => popularIds.includes(p.id))
```

---

## Type re-exports

Every type used in a public method signature is re-exported from
`@nodaro/client`. Import them with `import type { ... }`.

### Client identity

- `UserIdentity` — return type of `client.me()`: `{ id, email, displayName: string | null, avatarUrl: string | null, tier }`
- `ClientOptions` — `createClient` options: `{ baseUrl, auth, fetch?, timeoutMs? }`

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
- `JobStatusResult` — lean poll shape: `{ id, status, progress?, output_data?, error_message? }`
- `CancelJobResult` — `{ success: true, cancelled: number }`

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
- `RunNodeResult` — `{ jobId: string; ... } | Record<string, unknown>` (discriminated on presence of `jobId`)
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
- `LocationDetail` — `Location` plus in-flight job state
- `LocationReferencePhoto`, `LocationReferencePhotoKind` — mood-board reference shapes
- `CreateLocationInput`, `UpdateLocationInput` — bodies for `create()` / `update()`
- `UpdateLocationResult` — `{ id, updatedAt }`
- `ListLocationsParams` — query params for `list()`
- `GenerateLocationInput`, `GenerateLocationResult` — body + response for `generate()`
- `GenerateLocationAssetInput` — body for `generateAsset()`
- `ApproveMainImageResult` — `{ ..., canonicalDescription: string | null }`
- `RecaptionLocationResult` — `{ canonicalDescription }`
- `LocationAssetType` — asset-bucket enum (re-exported alongside `LOCATION_ASSET_TYPES` runtime tuple)
- `LocationAttachColumn` — attach-column enum (re-exported alongside `LOCATION_ATTACH_COLUMNS` runtime tuple)

### Objects

- `Object` — full object record (camelCase). Re-exportable as `NodaroObject` to avoid shadowing the JS global.
- `ObjectDetail` — `Object` plus in-flight `pendingJobs` bucket.
- `ObjectCategory` — 10-value enum: `"furniture" | "vehicle" | "weapon" | "food" | "clothing" | "electronics" | "nature" | "tool" | "animal" | "other"`. Distinct from location's geography-based set.
- `ObjectReferencePhoto`, `ObjectReferencePhotoKind` — `kind` is one of `"front" | "side" | "detail" | "context" | "moodBoard" | "other"` (6 values; no PII consent unlike locations).
- `ObjectAssetType` — 5-value enum from `@nodaro/shared`: `"angles" | "materials" | "variations" | "motion" | "custom"`. Re-exported from `@nodaro/client` so consumers don't need a second dep.
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
- `AppRun` — a single app-run record
- `ListAppRunsParams` — query params for `listRuns()`
- `DeleteAppRunResult` — `{ success }`-style delete response

### Generic node/edge

Re-exported from `@nodaro/shared` for convenience:

- `GenericNode` — React Flow-compatible node shape used by `Workflow.nodes`
- `GenericEdge` — React Flow-compatible edge shape used by `Workflow.edges`

---

## See also

- [SDK Quickstart](./sdk-quickstart.md) — task-oriented walkthrough
- [OAuth Flow](./oauth-flow.md) — third-party app authorization-code flow
- [API Integration](./api-integration.md) — direct REST patterns
