# `@nodaro/sdk` API Reference

Complete reference for every public export of `@nodaro/sdk`. For a
walkthrough-style introduction, see the [SDK Quickstart](./sdk-quickstart.md).

## Table of contents

- [Subpath entries](#subpath-entries)
- [`createClient(options)`](#createclientoptions)
- [Auth providers](#auth-providers)
- [Errors](#errors)
- [Resources](#resources)
  - [`client.workflows`](#clientworkflows)
  - [`client.projects`](#clientprojects)
  - [`client.sessions`](#clientsessions)
  - [`client.jobs`](#clientjobs)
  - [`client.llm`](#clientllm)
  - [`client.videoPro`](#clientvideopro)
  - [`client.recast`](#clientrecast)
  - [`client.castSwap`](#clientcastswap)
  - [`client.trends`](#clienttrends)
  - [`client.studio`](#clientstudio)
  - [`client.copilot`](#clientcopilot)
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
  - [`client.webhooks`](#clientwebhooks)
  - [`client.voices`](#clientvoices)
  - [`client.media`](#clientmedia)
  - [`client.audio`](#clientaudio)
  - [`client.credits`](#clientcredits)
  - [`client.billing`](#clientbilling)
  - [`client.uploads`](#clientuploads)
  - [`client.library`](#clientlibrary)
  - [`client.gallery`](#clientgallery)
  - [`client.presets`](#clientpresets)
  - [`client.savedPosts`](#clientsavedposts)
  - [`client.collections`](#clientcollections)
  - [`client.palettes`](#clientpalettes)
  - [`client.moodboards`](#clientmoodboards)
  - [`client.competitors`](#clientcompetitors)
  - [`client.pickerCatalogs`](#clientpickercatalogs)
  - [`client.shots`](#clientshots)
  - [`client.community`](#clientcommunity)
  - [`client.templates`](#clienttemplates)
  - [`client.tutorials`](#clienttutorials)
  - [`client.organizations`](#clientorganizations)
  - [`client.workspaces`](#clientworkspaces)
  - [`client.edit`](#clientedit)
- [Type re-exports](#type-re-exports)

---

## Subpath entries

The root `@nodaro/sdk` exports everything on this page. Each resource is also
published as its own entry point, `@nodaro/sdk/<entry>`, which loads only that
resource's module and the types it takes and returns:

`/apps`, `/audio`, `/billing`, `/cast-swap`, `/catalogs`, `/characters`, `/client`, `/collections`, `/community`, `/competitors`, `/copilot`, `/core`, `/creatures`, `/credits`, `/developer-apps`, `/edit`, `/errors`, `/executions`, `/gallery`, `/jobs`, `/library`, `/llm`, `/locations`, `/media`, `/models`, `/moodboards`, `/node-presets`, `/nodes`, `/oauth`, `/objects`, `/organizations`, `/palettes`, `/picker-catalogs`, `/pipelines`, `/projects`, `/prompt-helper`, `/recast`, `/reduce`, `/saved-posts`, `/scene3d`, `/sessions`, `/shots`, `/studio`, `/templates`, `/trends`, `/tutorials`, `/uploads`, `/video-pro`, `/voices`, `/webhooks`, `/workflows`, `/workspaces`

`/client` holds `createClient`, `NodaroClient` and the auth providers;
`/core` holds `NodaroClientCore` (see below) and the same auth providers;
`/errors` holds the error classes and `throwFromResponse`; every other entry is
named after its resource module (`/node-presets` is `client.presets`,
`/webhooks` also holds `verifyWebhookSignature`). A type the SDK re-exports from
`@nodaro/shared` lives in the entry of the resource that uses it.

```ts
import { NotFoundError } from "@nodaro/sdk/errors"
import type { Job, JobStatus } from "@nodaro/sdk/jobs"
```

The root is the union of the entries, and a value imported from an entry is the
same instance as the one imported from the root, so `instanceof NotFoundError`
holds whichever path each side used. `createClient` builds every resource, so
`@nodaro/sdk/client` loads all of them; the narrower entries pay off in code that
needs only errors, types or one resource class. The two older subpaths,
`@nodaro/sdk/supabase` and `@nodaro/sdk/signup-signals`, are unchanged and stay
outside the root.

### A client with only the resources you use

`NodaroClientCore` (`@nodaro/sdk/core`) is the client without its resources:
the options `createClient` takes, the request transport (`request`,
`requestText`, `requestBytes`) and `me()`, `connectedApps()`,
`revokeConnectedApp()`. `NodaroClient` extends it with every resource. Extend
it yourself with only the resources you call, and the other resource modules
are never loaded:

```ts
import { NodaroClientCore, StaticTokenAuth } from "@nodaro/sdk/core"
import { JobsResource } from "@nodaro/sdk/jobs"
import { NodesResource } from "@nodaro/sdk/nodes"

class AppClient extends NodaroClientCore {
  readonly jobs = new JobsResource(this)
  readonly nodes = new NodesResource(this) // polls through `jobs`
}

const client = new AppClient({ baseUrl: "https://nodaro.example.com", auth: new StaticTokenAuth(token) })
await client.nodes.runAndWait("generate-image", { prompt: "a lighthouse at dusk" })
```

Every resource class takes a `NodaroClientCore`. Two need another resource on
the same client, and their constructor type says so, so leaving it out fails to
compile: `NodesResource` needs `jobs` and `Scene3DResource` needs `nodes`.
`withWorkspace` is a `NodaroClient` method; to work in a workspace, pass
`workspaceId` to the constructor.

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

The instance exposes 37 resource objects: `workflows`, `projects`, `jobs`,
`videoPro`, `executions`, `nodes`, `characters`, `locations`, `objects`,
`creatures`, `pipelines`, `reduce`, `promptHelper`, `apps`, `developerApps`,
`oauth`, `voices`, `llm`, `media`, `audio`, `credits`, `uploads`, `library`,
`presets`, `pickerCatalogs`, `catalogs`, `models`, `shots`, `recast`, `castSwap`,
`trends`, `studio`, `community`, `templates`, `tutorials`, `organizations`, `workspaces`. It also exposes a low-level
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

### `client.connectedApps()`

Every app with access to the signed-in user's account (`GET
/v1/me/connected-apps`): developer apps, AI assistants' MCP connectors and
self-hosted installs, newest grant first — the data behind a "Connected apps"
settings screen. See [OAuth Flow](./oauth-flow.md) for what a grant is.

**A signed-in browser session only.** The route answers a Supabase session
token — `supabaseAuth(supabase)`, a `createSharedSupabaseClient` client, or a
`StaticTokenAuth` holding one — and refuses an API key (`ndr_…`) or an app token
(`ndr_app_…`) with `UnauthorizedError` ("Sign in required"): an app must not
list or revoke the grants it lives under. A server-side integration cannot call
it.

```ts
const apps = await client.connectedApps()
// [{ authorizationId, name, kind, homepageUrl, scopes, connectedAt, lastUsedAt }]
```

**Signature:** `connectedApps(): Promise<ConnectedApp[]>`

Returns `ConnectedApp[]`:

| Field | Type | Description |
|-------|------|-------------|
| `authorizationId` | `string` | The grant — what `revokeConnectedApp` takes. |
| `name` | `string \| null` | The app's name. A `dynamic_mcp` client chose its own. |
| `kind` | `DeveloperAppKind` | `user` (a developer app someone registered), `first_party_mcp`, `dynamic_mcp` (an MCP client that registered itself) or `community_instance` (a self-hosted install). |
| `homepageUrl` | `string \| null` | The app's homepage, when it gave one. |
| `scopes` | `DeveloperAppScope[]` | The scopes the grant holds. |
| `connectedAt` | `string` | When the user granted access (ISO 8601). |
| `lastUsedAt` | `string \| null` | The latest use of any token issued under the grant; `null` if never used. |

### `client.revokeConnectedApp(authorizationId)`

Ends an app's access (`POST /v1/me/connected-apps/:authorizationId/revoke`):
the grant and every token issued under it, at once — the app's next call is a
401. Resolves when done. A signed-in browser session only, like
`connectedApps()`. Throws `NotFoundError` when the grant is not the user's or is
already revoked.

```ts
await client.revokeConnectedApp(app.authorizationId)
```

**Signature:** `revokeConnectedApp(authorizationId: string): Promise<void>`

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
  readonly details: Readonly<Record<string, unknown>> // the envelope's other fields
}
```

`details` holds every field of the error envelope (`{ error: { code, message, … } }`)
other than `code` and `message`, as the server sent it — for example a trend
refusal's `slot`, a publish refusal's `reasons`, a validation error's `issues`.
It is set on every class below, and is `{}` when the envelope had nothing else
(or for an error the SDK made itself).

```ts
try {
  await client.trends.run(slug, request)
} catch (err) {
  if (err instanceof NodaroError && err.code === "missing_slot") askFor(err.details.slot as string)
}
```

**Constructor:** `new NodaroError(message: string, code: string, status: number, details?: Record<string, unknown>)`

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

- `code` is the refusal's own code: `"insufficient_credits"` for the caller's
  own balance (and when the server sent none), or another 402 code such as
  `"free_video_limit"` or `"insufficient_app_credits"`. `status = 402`
- `required?: number`
- `available?: number` — the balance (or, for a cap, what the cap has left)
- **Constructor:** `new InsufficientCreditsError(message?: string, required?: number, available?: number, code?: string)`

### `class CreditCapExceededError extends InsufficientCreditsError`

HTTP 402 from a spending cap someone else set, not from the caller's own
balance — topping up does not help; whoever set the cap has to raise it:

| `code` | Cap |
|--------|-----|
| `budget_exceeded` | the workspace's budget |
| `member_cap_exceeded` | your credit cap in that workspace |
| `user_allowance_exceeded` | this deployment's per-user allowance |

It is an `InsufficientCreditsError`, so an existing
`instanceof InsufficientCreditsError` catch still catches it; check
`instanceof CreditCapExceededError` first to tell the two apart.
`CREDIT_CAP_CODES` (a `ReadonlySet<CreditCapCode>`) lists the three codes.

- **Constructor:** `new CreditCapExceededError(code: CreditCapCode, message?: string, required?: number, available?: number)`

### `class StorageExceededError extends NodaroError`

HTTP 413. User's storage cap is reached.

- `code = "storage_exceeded"`, `status = 413`
- `limitBytes?: number`
- **Constructor:** `new StorageExceededError(message?: string, limitBytes?: number)`

### `class WorkflowConflictError extends NodaroError`

HTTP 409, on either of two codes: `workflow_conflict` — an
optimistic-concurrency update (`workflows.update` with
`expectedUpdatedAt`/`expectedVersion`) rejected because another writer updated
the row first — and `production_busy`, the studio production routes' own 409,
where the row kept changing under a read-modify-write until the server ran out
of retries. Same situation, same remedy: re-read and apply again. So it is the
same ERROR, and `catch (e) { if (e instanceof WorkflowConflictError) … }` covers
both, while `code` stays truthful about which arrived.

- `code` — `"workflow_conflict"` (the default) or `"production_busy"`: the
  `WorkflowConflictCode` union, though the field itself is the base class's
  `string`; `status = 409`
- `currentUpdatedAt?: string` — the row's current `updated_at`
- `currentVersion?: number` — the row's current `version`
- `currentRecord?: Record<string, unknown>` — the full current workflow (when
  the server includes it), so no follow-up GET is needed to merge
- **Constructor:** `new WorkflowConflictError(message?: string, currentUpdatedAt?: string, currentVersion?: number, currentRecord?: Record<string, unknown>, code?: WorkflowConflictCode)`

`export type WorkflowConflictCode = "workflow_conflict" | "production_busy"`.

### `class StudioOpError extends NodaroError`

A studio operation batch was refused, and the error names WHICH operation was
wrong. Nothing in the batch was written — a batch applies atomically or not at
all — so fix that one operation and send the whole batch again.

- `opIndex: number` — zero-based index into the `ops` array you sent
- `code` / `status` — whatever the server sent
- **Constructor:** `new StudioOpError(message: string, code: string, status: number, opIndex: number)`

Selected by **shape**, not by a list of codes: any 4xx whose body carries a
numeric `error.opIndex` arrives as this class. So a refusal reason the server
adds later reaches you as a `StudioOpError` with no SDK release in between.

```ts
import { StudioOpError } from "@nodaro/sdk"

try {
  await client.studio.productions.ops(id, { ops, baseVersion })
} catch (err) {
  if (err instanceof StudioOpError) {
    console.error(`operation ${err.opIndex} was refused: ${err.message}`)
  }
}
```

### `class ContinuationRefusedError extends NodaroError`

HTTP 409 that names the job to turn to instead. Continuing a Tighten Episode,
Chapters, Trailer, Clip Pack or Speaker Layout run ([`edit.continueUseCase`](#continueusecaseinput-options)) answers it for
`already_running` (a continuation is under way, or one that already
completed — follow `jobId`), `continuation_superseded` (a later continuation
of that run failed too —
continue `jobId` instead) and `render_final_already_rendered` (a Render final
with this very edit already completed — `jobId` holds its result).

- `jobId: string` — the job the refusal names
- `code` — whatever the server sent; `status = 409`
- **Constructor:** `new ContinuationRefusedError(message: string, code: string, jobId: string)`

Selected for exactly those three codes when the 409 carries a top-level
`jobId` string; every other 409 stays a plain `NodaroError`.

### `class AlreadyRunningError extends NodaroError`

HTTP 409 `already_running` that names the execution under way: the run you
asked to start or continue is still running. Follow `executionId`
(`client.executions.get`) instead of starting it again. Sent by
`workflows.run` and by an app run's Retry
([`apps.resume`](#resumeslug-runid-opts)).

- `executionId: string` — the execution under way
- `code = "already_running"`; `status = 409`
- **Constructor:** `new AlreadyRunningError(message: string, executionId: string)`

Selected when the 409 carries a top-level `executionId` string. One that
names a job (`jobId`) is a [`ContinuationRefusedError`](#class-continuationrefusederror-extends-nodaroerror);
one that names nothing stays a plain `NodaroError`.

### `class AppRunVersionChangedError extends NodaroError`

HTTP 409 `app_run_version_changed`: a Retry of a failed app run
([`apps.resume`](#resumeslug-runid-opts)) was refused because the app is on
another version than the one the run ran, and continuing would mix the two.
Nothing was written or billed. Start the run over with `apps.run` to run the
app's version, or send `{ version: err.runVersion }` to continue on the run's
own version.

- `runVersion?: number` — the version the run ran
- `appVersion?: number` — the version you are on (the `version` you sent, else the app's latest)
- `code = "app_run_version_changed"`; `status = 409`
- **Constructor:** `new AppRunVersionChangedError(message: string, runVersion?: number, appVersion?: number)`

Selected by code; the two numbers are `undefined` when the answer does not
carry them.

### `class StudioPreviewUnavailable extends NodaroError`

Not an HTTP error — thrown by `studio.productions.ops(id, { …, dryRun: true })`
when the deployment cannot preview a batch. **Nothing was sent**: the SDK proves
the flag on an empty batch first (see
[the write protocol](#the-write-protocol)), and this is that probe coming back
without the preview marker, so the caller's own batch never left the process.
Tell the user you cannot preview here rather than applying the batch blind.

- **Constructor:** `new StudioPreviewUnavailable(message?: string)`
- `code = "studio_preview_unavailable"`, `status = 0`

### `class StudioPreviewAppliedError extends NodaroError`

The opposite, and the reason the second answer is checked too: a preview was
asked for and the batch was **applied**. The probe and the batch are two
requests, and a fleet mid-rollout can serve them from different deployments —
the one that took the batch parsed the body in strip mode, dropped the flag and
wrote. The SDK cannot recall a request that has already been answered; what it
can do is refuse to hand the result back as a preview, which would otherwise
show a person what ALREADY happened under the heading of what would.

To recover: **adopt what is on `applied`** — its `production` and `version` are
now the truth, exactly as a plain apply's caller adopts them. Do not re-send the
batch, and do not present it for approval.

- **Constructor:** `new StudioPreviewAppliedError(applied: StudioOpsResponse | undefined, message?: string)`
- `code = "studio_preview_applied"`, `status = 0`
- `applied: StudioOpsResponse | undefined` — the apply reply as the route sent
  it. `undefined` when the answer carried no body to read: whether the batch was
  applied is unknown from here, so re-read the production before deciding
  anything.

### Metered LLM requests: `job_cancelled` and `job_start_failed`

A synchronous LLM request priced per model (metered) can answer two codes that
have no class of their own. They arrive as a `NodaroError` with that `code`
and `status`:

- **409 `job_cancelled`.** The job was cancelled after its credits were held
  but before its call was sent. The call is never sent and nothing is charged.
  Do not retry it as-is: the job was cancelled on purpose.
- **503 `job_start_failed`.** The server could not record that the call is
  starting, so it did not send it. Nothing is charged. Retry it.

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

Besides the `{ error: { code, message } }` envelope most routes send, it reads
the shapes a few older routes still answer with, so their refusals carry a real
`code` and `message` instead of `internal_error` / "Request failed":

| Body | `code` | `message` |
|------|--------|-----------|
| `{ error: "<code>", message? }` (character training, among others) | the string | `message`; with none, the code |
| `{ error: "<code>", error_description }` (OAuth) | the string | `error_description` |
| `{ message, issues: [...] }` (a bare validation answer, HTTP 400) | `validation_error` | `message` |
| `{ statusCode, error: "<reason phrase>", message }` (the server's own, e.g. a route it does not have) | `internal_error` | `message` |

At HTTP 500 and above only the **code** is read from these shapes, never their
text: outside the envelope a 5xx can carry whatever the server failed with (the
server's own answer to an unexpected throw is `{ statusCode: 500, error:
"Internal Server Error", message: <the raw error> }`), so such an error's
`message` is its code, or "Request failed". The envelope's own `message` is read
at every status.

The typed classes are still chosen by status — a 404 is a `NotFoundError`
whatever the body — and one whose body carries no human text keeps its own
default ("Not found", "Authentication required"). An
`InsufficientCreditsError` takes `required` / `available` from the envelope, or
from the `required` / `balance` (a per-user allowance: `remaining`) the credit
guard sends beside it.

---

## Resources

Every resource is constructed automatically by `createClient` and reachable via
`client.<resource>`. The classes are also exported for advanced typechecking
but rarely need to be imported directly:
`WorkflowsResource`, `ProjectsResource`, `JobsResource`, `LlmResource`, `ExecutionsResource`,
`NodesResource`, `CharactersResource`, `LocationsResource`, `ObjectsResource`,
`PipelinesResource`, `ReduceResource`, `PromptHelperResource`, `AppsResource`,
`DeveloperAppsResource`, `OAuthResource`, `VoicesResource`, `CreditsResource`,
`UploadsResource`, `GalleryResource`, `PresetsResource`, `PickerCatalogsResource`, `CatalogsResource`, `CommunityResource`.

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
No auth required — the SDK omits the bearer when no token exists. A studio
production comes back without its owner's working state: the recycle bin, the
runs in flight, the empty media slots and the unsaved editor draft are left out
of `settings.studio`, and each finished take's voice record (`revoiceTo` /
`voiceMode`) is left off the nodes' `data.generatedResults` rows. A UGC video
comes back to anyone but the workflow's owner as a published app ships it: its
UGC nodes and every node made from them without their runs' results, and never
the owner's photo.

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

#### `run(id, params?, options?)`

```ts
run(id: string, params?: RunWorkflowParams, options?: { idempotencyKey?: string }): Promise<RunWorkflowResult>
```

Starts an execution and returns immediately with `{ executionId, status }`.
`options.idempotencyKey` is sent as the `Idempotency-Key` header (at least 8
characters; a shorter one is ignored): retry a request with the same key and it
answers the run it already started (`deduped: true`) instead of starting a
second one. While a run of this workflow is still under way, a new one is
refused with `409 already_running`, thrown as an
[`AlreadyRunningError`](#class-alreadyrunningerror-extends-nodaroerror) whose
`executionId` is the run to follow.
Optionally restrict to a subset of node IDs, and pass `inputOverrides` —
nested `{ nodeId: { field: value } }` node data for THIS run, shallow-merged
over each node's saved data (the overridden node's saved results are not
used; a destination on an outbound node is refused with `400 locked_field`).

```ts
const { executionId } = await client.workflows.run(id, { nodeIds: ["node-1"] })
```

A workflow whose Apply EDL render is set to **Preview** (`quality: "proxy"`) stops at that preview
for a person to review in the editor; a run through the SDK has nobody to
review it, whichever auth it uses (an API key or `supabaseAuth`), so it is refused with `400 preview_review_required` unless the run
sets the render to Final
([details](./api-integration.md#runs-that-would-stop-for-a-review); rolled out under the
`PREVIEW_STOP_RULE_ENABLED` flag, and where it is off nothing is refused):

```ts
await client.workflows.run(id, { inputOverrides: { [renderNodeId]: { quality: "final" } } })
```

A node with Review before render on (Tighten Episode, Trailer, Clip Pack) is refused the same way
(turn its review off for such runs). A failed execution records what held it:
`preview_review_required` / `preview_render_nested` for a render,
`preview_review_required_review_on` / `preview_render_nested_review_on` for a review-on
node, `preview_review_required_mixed` / `preview_render_nested_mixed` for both. Match them
with `isPreviewRefusalCode(code)` from `@nodaro/shared`, never one code. Where the flag is
off, such a run is not refused up front: the nodes before the review-on node run and are
charged, and the node then fails with `preview_review_required` (nothing charged for it).
Whatever the flag, a review-on Tighten Episode fed by a List is refused with
`use_case_review_list_driven`, and a Trailer or a Clip Pack fed by a List (review on or off) with
`use_case_list_driven`.

`continueFromExecutionId` continues an earlier execution of the workflow — your
own, `completed`, of the workflow itself — instead of starting over: the run
executes `nodeIds` only (required with it), and every other node hands on what
that execution produced, never the workflow's saved results in their place (a
node that execution did not run either hands on the saved results it handed on
there; an Edit Plan hands on its plan with your current review applied).
The `inputOverrides` the earlier run applied are recorded on its execution and
applied again, with the continuation's own `inputOverrides` over them, field by
field (an execution that started before they were recorded has none: only the
ones you pass apply).
Render final after a run that stopped at its preview:

```ts
await client.workflows.run(id, {
  nodeIds: [renderNodeId, ...nodesAfterIt],
  inputOverrides: { [renderNodeId]: { quality: "final" } },
  continueFromExecutionId: previewRunId,
})
```

A refused continuation throws before any execution exists: `NotFoundError`
(`continuation_not_found`), or a `NodaroError` whose `code` is
`continuation_subset_required`, `continuation_workflow_mismatch`,
`continuation_version_mismatch` or `continuation_not_completed`
([details](./api-integration.md#continuing-a-run)). A continuation whose payer
cannot cover the nodes it runs — with or without `continueMode` — throws
`InsufficientCreditsError` (`402`) before any execution exists, checked as a
`renderFinal` is.

`continueMode: "from-failed"` continues a run that FAILED from where it stopped
(`continueFromExecutionId` is your own failed run of the workflow): `nodeIds` is
optional — left out, the nodes the run was started on (a run started on named
`nodeIds` is continued on those, a run of every node on every node, and a
continuation of a continuation keeps those of the first run of its chain),
plus every node left failed or held back (by the run, by a newer continuation it
is built on, or by an earlier run of its chain). `nodeIds` you send replace
those nodes, and the run is built on the chain's newest continuation when it
failed or is done (one held at a Preview review still throws
`continuation_preview_pending`, below). Every id in `nodeIds` counts as
named: a node you name that no run of the chain ever ran (each only handed on
its saved results, the node being outside its `nodeIds`) runs and is priced,
and one that ran in any of them is never run again by naming it. A node no run
executes is the exception: a source or upload, a trigger, a parameter picker
or a Group / Collect container hands on what the run handed on, and a node set
to skip (in the workflow or by `inputOverrides`) is never run, nor is a Lottie
Motion Graphics node whose plan the overrides set. A chain one of
whose continuations ran before this rule was recorded hands such a node on as
completed, so naming it there still counts it as done: naming only such nodes
is refused as done, and one named next to a node that failed is left out of the
run. To run it, continue the chain's newest run with `nodeIds` alone (no
`continueMode`) — only when that run completed, and then exactly those nodes
run. When the newest run failed, finish the chain first (continue from the
failure without that node), then continue that completed run with `nodeIds`
alone. `client.executions.get(id)` names the nodes the chain's first run was
started on in `nodeScope` (`null`: every node). Of the rest, the run executes
only the nodes that run did not complete — what it completed is handed on,
never run or charged again. That is per node: a node that failed runs again in full, every list item
included (a few nodes reuse an identical item they already made). Not combinable
with `renderFinal`.

```ts
await client.workflows.run(id, {
  continueFromExecutionId: failedRunId,
  continueMode: "from-failed",
})
```

A run a later continuation supersedes throws a `NodaroError` with `code`
`continuation_superseded`, its message naming that continuation: one that failed
is the one to continue instead; one that completed everything the run left means
the work is done, and its results are on that execution. When the newest later
continuation stopped at a Preview review (of a render, or of a Tighten Episode
with Review before render on), the run throws a
`ContinuationPreviewPendingError` (`code` `continuation_preview_pending`, 409,
exported from `@nodaro/sdk/errors`). It names that continuation in
`executionId`, its renders in `renderNodeIds` and its Tighten Episode nodes in
`reviewNodeIds`. `next` (a `HeldFinalRun`: `continueFromExecutionId`,
`nodeIds`, `inputOverrides`) is the run that finishes them: send it first with
`client.workflows.run(workflowId, error.next)`, then continue. For a single held
render, `next` is that continuation's `renderFinal`: the same run, with the same
credit check before it starts. When the newest later continuation completed only part of
what was left otherwise (a narrower `nodeIds`), the run is built on it instead:
seeded from that continuation, running only what it left, and the result's
`continuedFrom` names it (the run you sent otherwise). A Render final, or a run
of named nodes, that continues the newest later continuation counts as one of
them. A run that did not fail throws `continuation_not_failed`, and one with
nothing left `continuation_subset_required` (409)
([details](./api-integration.md#continuing-a-failed-run)). Send an
`idempotencyKey` with each continuation, so a retry of the same request starts
nothing new:

```ts
await client.workflows.run(
  id,
  { continueFromExecutionId: failedRunId, continueMode: "from-failed" },
  { idempotencyKey: crypto.randomUUID() }, // reuse the same key when retrying this call
)
```

Throws `InsufficientCreditsError` if the user can't cover the worst-case cost.
Requires `workflows:execute` scope when called via OAuth.

#### `renderFinal(id, params)` / `estimateRenderFinal(id, params)`

```ts
renderFinal(id: string, params: RenderFinalParams): Promise<RunWorkflowResult>
estimateRenderFinal(id: string, params: RenderFinalParams): Promise<{ data: RenderFinalQuote }>
```

Renders the final of an [Apply EDL](./nodes/processing-video/apply-edl.md#render-final)
render whose run stopped at its preview, once it has been reviewed — what the
editor's **Render final** button runs: the render at **Final** for this run only
(the node keeps its own Quality), and every node after it; with Camera Switch
between the Edit Plan and the render, Camera Switch runs again first. The server
works out which nodes run, by the editor's own rule, so you send only the render
and the execution that stopped at the preview (`continueFromExecutionId`, your
own `completed` run of the workflow): it continues that execution, and every node
it does not run hands on what that execution produced, the Edit Plan its plan
with the review applied.

`estimateRenderFinal` quotes it first and creates nothing: the nodes it will run,
the override it runs with, its estimated credits (`estimatedCreditsIsEstimate:
true` when the run executes an LLM node, which is charged its actual usage — show
it `~N`), whether the payer can cover them (`sufficient`) and the payer's spendable credits (`available`, `null` when a
workspace budget or a deployment's operator pays). The figures are `null` in an
edition without credits.

```ts
const { data: quote } = await client.workflows.estimateRenderFinal(id, {
  renderNodeId,
  continueFromExecutionId: previewRunId,
})
// quote → { renderNodeId, nodeIds: ["cam", "cut", "captions"], inputOverrides: { cut: { quality: "final" } },
//           estimatedCredits: 530, sufficient: true, available: 4200 }
const { executionId } = await client.workflows.renderFinal(id, {
  renderNodeId,
  continueFromExecutionId: previewRunId,
})
```

Both are refused before anything exists with `render_final_node_not_found` (no
such node), `render_final_not_a_render` (not an Apply EDL render) or a
[continuation code](./api-integration.md#continuing-a-run). `renderFinal` is
otherwise refused as `run` is — `preview_review_required` when another render after
this one still reads Preview (under the `PREVIEW_STOP_RULE_ENABLED` flag; where it is off,
that is not refused). A run its payer cannot cover — checked on the quoted
figure, before any execution exists — throws `InsufficientCreditsError` (`402`),
with `required` and, unless a deployment's operator pays, `available`.
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

### `client.sessions`

Generation sessions inside projects — Project → its sessions → each session's
items, the same on every device. A session's project is fixed at creation;
items are links to your jobs. See [API integration § 4e](./api-integration.md#4e-generation-sessions).

```ts
const { data: session } = await client.sessions.create({ projectId, tool: "create-image", title: "Beach" })

// A job is born in a session when the generation request names it.
await client.nodes.runAndWait("generate-image", {
  prompt: "a red car",
  sessionId: session.id,
  origin: "create-image",
})

const { data: sessions, next } = await client.sessions.list({ projectId })
const { data: items } = await client.sessions.items(session.id)
```

| Method | Signature | Notes |
|--------|-----------|-------|
| `create` | `create(input: CreateSessionInput): Promise<{ data: GenerationSession }>` | `tool` required (`create-image`, …); `projectId?`, `title?`. |
| `list` | `list(params?: ListSessionsParams): Promise<SessionPage<GenerationSession>>` | Newest first. `projectId`, `tool`, `includeArchived`, `limit`, `cursor`. Each session carries `itemCount`, `coverJobId` and up to four `previewUrls` (the cover's image first when one is set). |
| `get` | `get(id: string): Promise<{ data: GenerationSession }>` | |
| `update` | `update(id: string, input: UpdateSessionInput): Promise<{ data: GenerationSession }>` | `title` (`null` = untitled), `archived`, `coverJobId` (one of the session's items, 404 otherwise; `null` = automatic). The project cannot change. |
| `delete` | `delete(id: string): Promise<{ success: true }>` | Its jobs are kept, and stay in every other session holding them. |
| `items` | `items(id: string, params?: ListSessionItemsParams): Promise<SessionPage<SessionItem>>` | The feed, newest first: `jobId`, `addedAt`, `imported`, `importedFrom`, `job`. |
| `importItems` | `importItems(id: string, input: { jobIds: string[] }): Promise<{ data: { imported: number; requested: number } }>` | A link, not a copy; up to 100 of **your** jobs, all-or-nothing (404 if any is not yours). |
| `removeItem` | `removeItem(id: string, jobId: string): Promise<{ success: true }>` | Removes the link only — the job and every other session holding it stay. |

To get work into another project there is no move: `importItems` into a
session there, then `removeItem` from the old one. `sessionId` and `origin`
(`GenerationSessionParams`) are accepted by every request that creates a job —
the platform stamps them on the job whatever the route — and are typed on every
generation params type: `GenerateImageParams`, `GenerateVideoParams`,
`TextToVideoParams`, `TextToSpeechParams`, `VideoUpscaleParams`,
`VideoDepthParams`, `AssembleNarratedVideoParams`, `ImageToImageParams`,
`EditImageParams`, `GenerateMaskParams`, the 3D scene params and the
character / object / location / creature `generate*` inputs. An `origin` that
is not a slug (lowercase letters, digits and dashes, at most 40) is refused with
a `400 validation_error` on every route. `GenerateImageParams` also types
`promptPrefix` / `promptSuffix`, `userPrompt` (the prompt as your user typed
it, stored on the job and never sent to the model) and `count` / `models`
(see [`runBatchAndWait()`](#runbatchandwaittype-params-opts)). A job's
`session_id` shows on `jobs.get()` / `jobs.list()`.

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
`source`, `source_detail`, plus `favorited` (whether the job's owner favorited
it — [`client.gallery`](#clientgallery)) and `rating` (`"good"`, `"bad"` or
`null` — [`rate()`](#rateid-rating)) — both left out when the server cannot read
them for a moment, so treat a missing field as unknown, never as `false` —
`recovering` while a processing job is being
recovered, `credit_status` (the job's credit-reservation lifecycle —
`"reserved"` | `"committed"` | `"refunded"` | `null`, derived server-side
from the usage log) and `credits_charged`. `credits` is the amount **held**
when the job was accepted and never changes; `credits_charged` is what the job
actually cost once that hold settled — it can be lower (the rest goes back to
the balance), `0` when refunded, `null` while the job is running or when it
reserved nothing of its own. Sum `credits_charged` to total spend. `error_hint` is a structured, user-safe failure verdict
(`JobErrorHint`) present on a job the worker classified as a final provider
content-policy block (`kind: "safety-block"` — see [Generate
Image](./nodes/ai-image/generate-image.md#when-the-providers-safety-filter-blocks-a-request)
for what it means and when a fallback model is offered) or that a job policy
registered by the deployment rejected (`kind: "policy-block"`, carrying
`policyId`, `hookPoint: "request" | "result"` and `reason` — user-safe text
written by the deployment's policy, or by the platform when the policy supplies none; show it as-is),
or that ran out of credits partway (`kind: "credits"`, carrying the refusal's
`code` — `insufficient_credits`, or a plan or workspace cap such as
`free_video_limit` or `budget_exceeded`; the job was refunded, so ask the
person to top up and run it again), or whose input video the provider refused
without naming a content-policy class (`kind: "input-refused"`, `subject:
"input_video"` — send a different clip; a `safety-block` carries the same
`subject` when the refused input video also has a class). Admin callers
additionally receive `provider`, `provider_cost`, `display_cost`,
`credits_actual`, `error_detail` (the provider's redacted raw error) and
`reconcile_attempts`. Any other column never reaches any caller. Server-only
values inside job JSON, including Recast's private pre-watermark remux base,
are removed recursively for every caller, including administrators.

An image job's `output_data` carries the image's pixel size — `width` and
`height` of `imageUrl` as stored, and `images` (`{ url, width, height }` per
entry) beside `imageUrls` — on jobs completed after this release. `Job.output_data`
stays `unknown`; cast it to `NodeJobOutput` to read them typed (see
[`runAndWait`](#runandwaittype-params-opts)).

#### `list(params?)`

```ts
list(params?: ListJobsParams): Promise<{ data: Job[]; next: string | null }>

interface ListJobsParams {
  status?: JobStatus | JobStatus[]   // one status or several
  type?: string | string[]           // input_data.type: one value or several (up to 20)
  origin?: string                    // input_data.origin
  favorited?: boolean                // true: only jobs you favorited; false: only the rest
  rating?: "good" | "bad" | "rated" | "unrated"
  batchId?: string                   // the jobs of one generate-image batch
  limit?: number                     // 1–100 (default 50)
  cursor?: string                    // the previous page's `next`
}
```

Your jobs, newest first (`GET /v1/jobs`), cursor-paginated (`limit` ≤ 100;
pass `next` back as `cursor`). `status` takes one status or a list (a job
matching any of them; an unknown status throws a `NodaroError` with code
`validation_error`, status 400). `type` matches
the job's `input_data.type` (the route that created it — `"llm-structured"`,
`"video-analysis"`, …), one value or a list, and `origin` matches
`input_data.origin` (the client app that sent it). `favorited` and `rating`
filter on your own marks: `rating: "rated"` is any rating, `"unrated"` none.
`batchId` matches `input_data.batchId` (the jobs of one generate-image batch —
`count` / `models`).
Every filter is exact-match and they combine with AND. Every job carries
`favorited` and `rating`. A page may hold fewer than `limit` rows — even none —
and still carry a `next`; page on `next`, never on `data.length`.

```ts
const { data: runs, next } = await client.jobs.list({ type: "llm-structured", origin: "studio" })

// Your favorited images and videos that came out well
const { data: keepers } = await client.jobs.list({
  type: ["generate-image", "generate-video"],
  status: "completed",
  favorited: true,
  rating: "good",
})
```

#### `rate(id, rating)`

```ts
rate(id: string, rating: "good" | "bad" | null): Promise<{ data: { jobId: string; rating: "good" | "bad" | null } }>
```

Rates one of your jobs `"good"` or `"bad"`, or clears its rating with `null`
(`PUT /v1/jobs/:id/rating`). One rating per job, and only its owner rates it:
anyone else's job is a `NotFoundError`. The rating reads back as `Job.rating`
and filters `list()`. OAuth apps need the `assets:write` scope. On a server
that does not have ratings yet it throws a `NodaroError` with code
`not_available` (status 503).

```ts
await client.jobs.rate(jobId, "good")
await client.jobs.rate(jobId, null) // clear it
```

#### `fromUpload(params)`

```ts
fromUpload(params: JobFromUploadParams): Promise<{ data: Job }>
```

Records an image edited in the browser — already stored with
`client.uploads.upload` — as a job (`POST /v1/jobs/from-upload`): a completed,
private, free `image-edit` job whose `output_data.imageUrl` is the upload. It
then rates, favorites, lists (`list({ type: "image-edit" })`) and files into a
session like any image job. The source is linked in `input_data`
(`sourceJobId` or `sourceAssetId`, and the `sourceImageUrl` the server read
from it); an edit of a character, object, creature or location image keeps
that link. One upload is one job: the same `assetId` again returns the same
job, so a retry never makes two. OAuth apps need the `assets:write` scope.
Throws `NotFoundError` when the asset, the source or the session is not
yours, `NodaroError` (`validation_error`) when the asset is not an image you
stored or the source has no finished image, and `JobBlockedError` when a job
policy of the deployment refuses the image. Full rules:
[Recording an image edited in the browser](./api-integration.md#recording-an-image-edited-in-the-browser).

| Field | Type | Description |
|-------|------|-------------|
| `assetId` | `string` | The edited image's `assetId`, as `uploads.upload` returned it. |
| `sourceJobId` | `string?` | The job whose image was edited. |
| `sourceImageUrl` | `string?` | Which of `sourceJobId`'s images was edited, when it made several (default: its `imageUrl`). |
| `sourceAssetId` | `string?` | The upload that was edited, when the source is not a job. Not with `sourceJobId`. |
| `editStateUrl` | `string?` | The editor's design state, stored with `uploads.uploadJson`. |
| `sessionId` | `string?` | The generation session to file the job in. |

```ts
const upload = await client.uploads.upload(editedPng)
const { url: editStateUrl } = await client.uploads.uploadJson(designState)
const { data: job } = await client.jobs.fromUpload({
  assetId: upload.assetId!,
  sourceJobId,
  editStateUrl,
  sessionId,
})
```

#### `getStatus(id)`

```ts
getStatus(id: string): Promise<{ data: JobStatusResult }>
```

Returns the lean status of a job — id, status, progress, output_data,
error_message, error_hint, credit_status, and completed_at (when the job
finished, on the server's clock; `null` until it has) (`GET /v1/jobs/:id/status`).
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
`{ success: true, cancelled: number, inFlight?: boolean }`. A running LLM job priced per model (metered) is an exception: if its call
has already started, the cancel answers `{ success: true, cancelled: 0, inFlight: true }`
— the job finishes and is charged only what it used. A job stopped before its
call starts is refunded, except for what an earlier attempt of the same job
already used (a retry after a billed attempt): that is charged.

```ts
const { cancelled } = await client.jobs.cancel(jobId)
```

#### `delete(id)`

```ts
delete(id: string): Promise<DeleteJobResult>
```

Deletes a job and the private media it produced (`DELETE /v1/jobs/:id`). Only
the job's owner (or an admin) may delete it; a job that is still running is
deleted as-is — `cancel(id)` it first when its worker should stop. Returns
`{ success: true }`.

```ts
await client.jobs.delete(jobId)
```

---

### `client.llm`

Structured LLM output: your system prompt and JSON Schema in, a validated
object out. Billed under `llm-structured` for the tokens the call used, at the
model's rate on the lane that served it (see
[Structured LLM output](api-integration.md#structured-llm-output-any-schema) and
[LLM model rates](pricing/llm-models.md)): a typical call is ~18 credits<!-- credits: llm-structured:gemini-3.6-flash -->
on the default Gemini 3.6 Flash and ~154 credits<!-- credits: llm-structured:claude-fable-5 --> on Claude Fable 5,
which is offered. A failure the provider billed is charged for that usage.

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

### `client.studio`

Studio productions: a production is a workflow whose `settings.studio` holds the
shots — each one a framed still, an optional animated clip, and the plan, looks,
cast bindings and voice that made them. The routes are supplied by the Cloud
plugin (**Cloud edition only**); where they are not served they answer the usual
404, so feature-detect with `capabilities()` or `list()`. Full REST contract:
[Studio productions API](./api/studio-productions.md); over MCP:
[Studio productions over MCP](./mcp/studio-productions.md).

The same productions are reached through two groups of methods:

- `client.studio.*` — planned frames, revision-checked edits, editor saves,
  sharing and bundles. These methods return the API response envelope as it
  arrives (`{ data: … }`).
- `client.studio.productions.*` — the production document and its operation
  protocol: atomic batches of operations, run-then-poll generation, sharing and
  copies. These methods return the payload, with typed envelopes.

#### `client.studio.*` — planned frames and revisioned edits

Use `capabilities()` to check per-operation support before exposing
planned-frame controls.

| Method | Purpose |
| --- | --- |
| `capabilities()` | Read plan versions and manual operation support |
| `skill()` | Read the production authoring format |
| `list({ limit?, cursor?, includeArchived? })` | List productions; rows are in `response.data.data` |
| `get(id, { detail?, shotId? })` | Read a production and capabilities without reconciling jobs |
| `validatePlan(plan)` | Validate a plan without creating it |
| `create({ name?, plan? })` | Create a production |
| `clone(id, { name?, projectId?, expectedVersion? })` | Copy a saved production; optional destination project must belong to the caller |
| `importBundle({ bundle, projectId? })` | Import a portable production through the compatible writer, remapping its frame and sequence IDs |
| `appendBundle(id, { bundle, expectedVersion, afterShotId?, applyFilm? })` | Append a complete bundle slice to an editable production with fresh IDs and an exact revision check |
| `edit(id, { ops, baseVersion?, strict?, clientRequestId? })` | Apply semantic operations with revision conditions |
| `saveEditorState(id, { expectedVersion, graph, clientRequestId? })` | Save ordinary editor fields against the loaded revision; preserve protected frame and job state |
| `setShared(id, { shared, allowEditableCopy?, expectedVersion? })` | Change link sharing through the visibility-authorized route |
| `generateKeyframe(id, { keyframeId, expectedRevision, clientRequestId?, overrides? })` | Generate a planned frame without accepting it |
| `generateShot(id, input)` | Submit or quote a still/clip request |
| `reconcile(id)` | Record completed jobs without accepting candidates |
| `acceptKeyframe(id, review, concurrency?)` | Explicitly accept a reviewed candidate |
| `edit(id, { ops: [{ op: "reject_keyframe_result", keyframeId, expectedRevision, resultKey, expectedAcceptedResultKey, reason? }], baseVersion, strict: true })` | Record Needs revision without generating; requires `operations.rejectKeyframes` support |
| `edit(id, { ops: [{ op: "update_sequence_plan", sequenceId, expectedRevision, name, segments }], baseVersion, strict: true })` | Edit ordered `{ shotId, startKeyframeId, endKeyframeId }` segments while preserving existing scene IDs; requires `operations.editSequencePlans` |
| `edit(id, { ops: [{ op: "detach_sequence_segment", sequenceId, shotId, mode, splitSequence: true, expectedSequenceRevision }], baseVersion, strict: true })` | Make one segment independent and split remaining continuous groups; `mode` is `clear` or `keep-accepted`; requires `operations.editSequencePlans` |

The acceptance review supplies `keyframeId`, `expectedRevision`, `resultKey`,
`expectedAcceptedResultKey` (or `null`), and `requirementChecks`. Each check names
its `requirementId` and an outcome of `pass` or `waived`; waivers require a
`waivedReason`. Optional concurrency conditions are `baseVersion`, `strict` and
`clientRequestId`. Conflicts are returned through the normal SDK error path;
the SDK never selects a different result or retries acceptance against a newer
revision automatically.

Check `capabilities.operations.saveEditorState` before using the editor-save
method. It always sends a strict revision condition. A conflicting save returns
HTTP 409; keep the local draft and reload before resolving the conflict. The
snapshot cannot change frame plans, acceptance, endpoint bindings, linked-job
history, protected recycle-bin entries or sharing. Use their dedicated semantic
actions instead.

`reconcile(id)` also checks submitted jobs belonging to scenes in the recycle
bin. A completed clip stays in that scene's stored graph with its original
endpoint pins; it does not recreate the scene on the timeline. Restore it with
`restore_trashed` to recover the result. Clients should reconcile once when
reopening an editable dependency production even if no pending marker is
visible, because the submission response may have been lost. Reconciliation
never starts generation or accepts a candidate.

Use `edit` with a strict `baseVersion` for `remove_shot`, `restore_trashed` and
`purge_trashed`. Detach a bound sequence segment before removing its scene.
When emptying a scoped bin, send `purge_trashed` for the displayed entry IDs;
`clear_trash` empties every bin, including planned frames. Entries carrying
frame dependencies are exempt from automatic pruning of ordinary bin entries.

Check `capabilities.operations.revisionedSharing` and pass `expectedVersion` to
`setShared` to bind sharing or unsharing to the reviewed revision. A concurrent
edit returns HTTP 409 `workflow_conflict`; the SDK does not retry against the
new revision. Only callers allowed to change visibility can use this route.

Check `capabilities.operations.cloneLinkedProductions` before copying a linked
production. Pass its loaded `expectedVersion`; a changed source returns HTTP 409.
The server copies retained frame inputs and historical parent/endpoint pins,
remaps frame/scene/sequence IDs, and clears active jobs and frame acceptance.
The new production starts private and visible. Review and accept its frames
before generating dependent media; copying submits no generation jobs and uses
destination storage quota for retained inputs.

When `capabilities.operations.editableSharedCopies` is true, an owner or workspace
admin may call `setShared(id, { shared: true, allowEditableCopy: true, expectedVersion })`.
This permits authenticated link viewers to call `clone` for the saved live plan,
prompts, cast descriptions, retained reference inputs and take history. The bin
and private review notes are excluded. Copies start private, with fresh frame
acceptance. Turning copying off or unsharing blocks subsequent copy requests;
already admitted copies remain independent. The public media projection carries
only `publicView.editableCopyAllowed`, never the editable plan itself.

`appendBundle` posts to `/v1/studio/productions/:id/import-bundle` and requires
`workflows:write` plus edit access to the destination. It returns the production
and `importedShotIds`/`importedKeyframeIds`. It preserves existing scenes, frames,
jobs, sharing and unrelated settings, and merges imported cast roles. The imported
frame closure needs fresh acceptance. Omit `afterShotId` to append at the end;
an unknown anchor or stale `expectedVersion` fails. `applyFilm: true` explicitly
adopts the incoming film look; existing music, cuts and film brief stay in place.
Check `appendPlannedBundles` or `appendLinkedBundles` in capabilities first.
Linked media has the same owned-source and verified-copy requirements as a new
production import. Neither method starts generation or retries a revision conflict.

`importBundle` posts to `/v1/studio/productions/import-bundle` and creates a new,
private production with remapped scene, frame and sequence IDs. Check
`capabilities.operations.importPlannedBundles` for recipes or ungenerated plans,
and `importLinkedBundles` for retained frame media. A linked bundle carries
`nodaroStudio.sourceWorkflowId` as a lookup hint; the server checks ownership and
verifies every retained image proof before copying bytes. Missing source access
or forged provenance refuses the import before creating its destination. Recipe
bundles need no source production. Neither path transfers acceptance or active
jobs, and neither generates media. Other existing media remains linked by URL.
Optional `projectId` must belong to the caller. The SDK returns the production
response envelope, including the new ID, rather than a raw workflow graph.

Frame generation has no dry-run option. `generateShot` accepts `dryRun` for a
quote. Both use an explicit `clientRequestId` for safe caller retries. A generated
portrait is optional for description-only cast references. See
[dependent-frame behavior](design/dependent-frame-execution.md).

Linked-clip quotes include `inputHash`, accepted `endpointPins`, normalized
duration/resolution/aspect ratio/audio settings, and the `creditIdentifier` used
for the estimate. Pass the reviewed `inputHash` as `expectedInputHash` when
generating the clip. Changed settings or accepted endpoint pins return HTTP 409
`sequence_quote_changed` before submission; request and review a fresh quote.
Credits remain an estimate; the generation route reserves the current price.

When `capabilities.operations.retakeLinkedClips` is true, pass
`retakeResultKey` with `kind: "clip"` and `shotId` to quote a native linked take
using `dryRun: true`. Submit the same take with the reviewed `expectedInputHash`
and a fresh `clientRequestId`. Omit `mode`, `overrides`, and `count`: retakes use
the original stored request and retained endpoint images, even after plans or
acceptance change. Existing takes stay in history. A take without a verifiable
original request or retained images is refused; older and copied takes may be
unavailable for this operation. A retake does not reproduce identical video bytes.

#### `client.studio.productions.*` — the production document

The ENVELOPES are typed; the production DOCUMENT is not. `production` is
`Record<string, unknown>` and `ops` is `unknown[]` — the field-level types ship
with the studio app, the one consumer that narrows them. Everything a caller
branches on is typed: `version`, `rebased`, `receipts`, `warnings`, a quote's
`credits`, a run's `jobIds`.

##### Reads

```ts
productions.skill(): Promise<StudioSkillResponse>                       // GET …/skill — free
productions.validatePlan(plan): Promise<StudioValidatePlanResponse>     // POST …/validate — free
productions.list(opts?): Promise<StudioListProductionsResponse>         // GET … — newest first
productions.get(id, opts?): Promise<StudioProduction>                   // GET …/:id — pure, never lands a job
productions.exportPlan(id, opts?): Promise<StudioExportPlanResponse>    // GET …/:id/export-plan — priced, runs nothing
```

`get(id, { detail: "full" })` adds every result with the context that
regenerates it; `{ shotId }` reads one shot, the cheap re-read after a
generation. `list({ includeArchived: true })` opts into the rows the dashboard
hides. `skill()` returns the authoring guide, the full catalog, the plan's JSON
Schema and the operating guide, rendered server-side from the version that is
live — so they describe the platform you are actually talking to.

##### The write protocol

```ts
productions.create(input?): Promise<StudioProductionResponse>           // POST … — optionally lands a plan
productions.ops(id, input): Promise<StudioOpsResponse>                  // POST …/:id/ops — an atomic batch
productions.ops(id, input & { dryRun: true }): Promise<StudioOpsDryRunResponse>  // …the same batch, previewed
productions.reconcile(id): Promise<StudioReconcileResponse>             // POST …/:id/reconcile — land finished jobs
productions.importPlan(id, plan, opts?): Promise<StudioProductionResponse>
productions.describe(id, input): Promise<StudioJobStartedResponse>      // POST …/:id/describe — a Director run
```

Every change is an **operation**, addressed by stable key — a shot id, a role
slug, a result's job id or url — never by position. That is what lets two
writers hold the same production open: a batch composed against a slightly older
version still applies to the newest document, and the response says
`rebased: true` (`strict: true` refuses instead, with a `409`). A batch is
atomic: one bad operation refuses the whole batch as a `StudioOpError` naming
its index, and nothing is written. `receipts` is one past-tense line per
operation, each carrying `impact` — `{ keyframeIds, shotIds }` — where the
operation's effect reaches past the thing it names, so the caller knows what
else to refresh. Adopt `production` wholesale and carry `version` forward as the next
`baseVersion`. The operation vocabulary is served, not shipped: read it from
`skill()`'s `operating` part.

**Previewing a batch.** `dryRun: true` asks what the batch WOULD do, so a person
can approve an assistant's edits before they land. The reply is
`StudioOpsDryRunResponse` — `{ dryRun: true, version, receipts, warnings }`, with
no `production` and no `rebased`, because no document was produced. Each receipt
is the apply's own receipt plus `class` (the operation's confirmation class, out
of the vocabulary's table) and `restorable` (present only where the operation put
something in the bin). The refusals the batch itself earns, the preview earns
too: a bad operation is still a `StudioOpError` with its `opIndex`, `strict:
true` still conflicts. Contention is the one it cannot reach — a preview never
swaps, so it never gives up busy the way an apply under a rival writer does.

```ts
import { StudioPreviewAppliedError, StudioPreviewUnavailable } from "@nodaro/sdk"

try {
  const preview = await client.studio.productions.ops(id, { ops, baseVersion, dryRun: true })
  for (const r of preview.receipts) console.log(r.class, r.summary, r.restorable ?? false)
} catch (err) {
  if (err instanceof StudioPreviewUnavailable) {
    // Nothing was sent. Say so; do not fall back to applying the batch.
  } else if (err instanceof StudioPreviewAppliedError) {
    // The batch LANDED. Adopt `err.applied.production` / `.version` — do not
    // re-send it, and do not present it for approval. When `applied` is
    // undefined there was no body to read: re-read with `get(id)` first.
  }
}
```

Spell `dryRun: true` as a literal in the call's own object, because the literal
is what selects the preview overload: passed through a variable it widens to
`boolean`, and the call then types as an apply while the runtime still takes the
preview path.

**A preview is TWO requests, deliberately; an apply stays one.** The route parses
its body in strip mode, so a deployment that predates the preview drops the flag
and APPLIES the batch — a caller that learned by sending would already have
written. So the SDK proves the flag on an EMPTY batch first — nothing of yours
rides on it — and sends your batch only when that answer carries the marker.
When it does not you get `StudioPreviewUnavailable`, and your batch never left;
when the deployment refuses the probe outright, that error is passed through as
it stands. And because a fleet mid-rollout can serve the second request from
another deployment, the second answer is checked too: a batch that came back
APPLIED throws `StudioPreviewAppliedError` carrying that write, rather than
being dressed up as a preview. Both are `status = 0` — catch by type. The REST
contract for the two-step is in the
[Studio productions API](./api/studio-productions.md).

##### Generation and media

```ts
productions.generate(id, input): Promise<StudioGenerateResult>          // POST …/:id/generate
productions.generateStill(id, shotId, opts?): Promise<StudioGenerateResult>
productions.generateClip(id, shotId, opts?): Promise<StudioGenerateResult>
productions.frame(id, input): Promise<StudioMediaResponse>              // waits (seconds)
productions.voice(id, input): Promise<StudioMediaResponse>              // waits (seconds)
productions.revoice(id, input): Promise<StudioJobStartedResponse>       // starts; lands via its marker
productions.music(id, input): Promise<StudioJobStartedResponse>         // starts; lands via its marker
```

Run-then-poll: a still or clip run submits the jobs, records a pending marker
and returns — nothing blocks for minutes. `reconcile()` turns the finished jobs
into results with no browser in the loop. The request is assembled server-side
from the shot's own plan, looks and bound references, so a scripted run and a
press of the button in the app produce the same media; `overrides` changes THIS
run without changing the shot. For a clip the **lane** is chosen from the
inputs and reported back as `lane` — never passed in.

```ts
const quote = await client.studio.productions.generateStill(id, "shot-2", {
  count: 2,
  dryRun: true,
})
if (isStudioGenerateEstimate(quote)) console.log(quote.credits) // null = unpriced, not free

const run = await client.studio.productions.generateStill(id, "shot-2", {
  count: 2,
  clientRequestId: crypto.randomUUID(),
})
```

`dryRun: true` prices the run and writes nothing — the reply is the quote,
narrowed with `isStudioGenerateEstimate`. `clientRequestId` makes a retry safe:
the same token answers with the jobs the first call started (`deduped: true`),
having submitted and charged nothing. Never retry a spend without it — and it
is accepted on every spending call here, `frame` and `voice` included, not only
on the two that quote.

##### Audience and copies

```ts
productions.share(id): Promise<StudioProduction>       // POST …/:id/share   — opt in
productions.unshare(id): Promise<StudioProduction>     // POST …/:id/unshare — and back out
productions.clone(id, input?): Promise<StudioProduction>
```

Sharing is its own route rather than an operation: who may see the work is
decided by the owner, never as a side effect of a batch that was editing
something else. A clone starts private and visible — `shared` and `archived`
never travel — and is copied through YOUR view of the source.

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
`analysisJobId`; quote with `estimate` first — creating buys the plan.
`segmentSec` (on `estimate`, `create` and `start`) names how the render packs
scenes into parts — a name, not seconds (`RecastSegmentPack`, the values
exported as `RECAST_SEGMENT_PACKS`): `"scenes-max"` (Long, the fewest seams),
`"scenes"` (Short) or `"max"` (the longest parts the model allows). On
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

### `client.castSwap`

Cast Swap: replace the people, pets, products and/or the location in a short
video with your own reference images, keeping its motion, framing, timing and
sound (the clip's audio is kept, and the result is the clip's length). **Cloud
edition only**: these routes 404 on self-hosted installs. Also importable as
`@nodaro/sdk/cast-swap`. Routes: [Cast Swap](./api-integration.md#13f-cast-swap-cloud-edition);
MCP: `cast_swap`, `estimate_full_quality`, `full_quality`.

```ts
run(params: CastSwapParams, options?: { idempotencyKey?: string }): Promise<{ jobId: string; deduped?: boolean }> // POST /v1/cast-swap → 202 (200 + deduped on a keyed repeat)
estimate(params: CastSwapParams): Promise<CastSwapEstimate> // POST /v1/cast-swap/estimate, free
fullQualityEstimate(jobId: string): Promise<CastSwapFullQualityEstimate> // POST /v1/cast-swap/:jobId/full-quality/estimate, free
fullQuality(jobId: string, params?: { sessionId?: string }): Promise<CastSwapFullQualityResult> // POST /v1/cast-swap/:jobId/full-quality → 202 (200 + existing)
```

```ts
interface CastSwapParams {
  videoUrl: string                 // the source clip, 4–30 s
  roles: Array<
    | { kind: "person"; name: string; images: string[] | null
        body?: "new" | "original"; outfit?: "new" | "original"; hair?: "new" | "original" } // each default "new"
    | { kind: "location"; name?: string; images: string[] | null }                          // name default "the setting"
    | { kind: "pet"; name: string; images: string[] | null
        body?: "new" | "original"; coat?: "new" | "original" }                              // each default "new"
    | { kind: "product"; name: string; images: string[] | null
        shape?: "new" | "original"; finish?: "new" | "original" }                           // each default "new"
  >                                // every role also takes previewName? / inPreview? (preview only, see below);
                                   // ≤ 6 person, ≤ 1 location, ≤ 3 pet, ≤ 3 product roles;
                                   // 0–3 images of ONE subject / place each, ≤ 30 images in all
  references?: Array<{ images: string[]; line: string }> // ≤ 5 fixed references (see below)
  prePrompt?: string               // your own words at the start, before the role instructions; {role:N} as in postPrompt
  postPrompt?: string              // your own words; mention a role as {role:N}, N 1-based over roles
  preview?: boolean                // true = run on 4 s of the clip
  previewStart?: number            // seconds, default 0
  resolution?: "480p" | "720p" | "1080p" // default "480p"
  draft?: boolean                  // default true at 480p, false above; true above 480p is a 400
  prepareReferences?: boolean      // default true: prepare the reference pictures first (see below)
  faceMasking?: CastSwapFaceMasking // default off: mask the faces in the clip first (see below)
  quality?: "draft"                // @deprecated: "draft" = 480p draft; use resolution + draft
  sessionId?: string
  origin?: string
}

interface CastSwapFaceMasking {
  mode: "off" | "always" | "auto" // off = as if left out; auto = only on a retry after the clip is refused
  fill?: "blur" | "depth"         // what covers a masked face; default "blur"
  minFaceHeightPct?: number       // 0..100, default 15: mask faces at least this % of the frame height
  maxFaceHeightPct?: number       // 0..100, default 0 (no limit); when > 0, ≥ minFaceHeightPct
  zone?: { leftPct?: number; rightPct?: number; topPct?: number; bottomPct?: number }
                                  // frame margins, 0..49 % each, default 0: a face centred in one is not masked
  blurStrengthPct?: number        // 0.1..5 % of the frame width, default 2 (fill "blur")
  threshold?: number              // 0.05..0.95, default 0.5: lower finds more faces
}

interface CastSwapEstimate {
  totalCredits: number // castSwap + seedance + references (+ masking with faceMasking "always")
  breakdown: {
    castSwap: number     // the run itself
    seedance: number     // the video model it calls
    references: number   // preparing the reference pictures; 0 when off or nothing to prepare
    masking?: number     // masking the faces; only when faceMasking is on ("auto": = maskingCredits, not in totalCredits)
  }
  maskingCredits?: number // faceMasking "auto": charged only if the masked retry runs; not in totalCredits
  settlesLower: boolean // Auto length: the final charge is expected to be lower
}

interface CastSwapFullQualityEstimate {
  totalCredits: number // castSwap + seedanceHd
  breakdown: {
    castSwap: number     // the Full Quality job's own steps
    seedanceHd: number   // the 1080p render; 0 when an earlier try's render is reused
  }
  availableUntil: string // ISO time: 7 days after the draft completed
}

interface CastSwapFullQualityResult {
  jobId: string
  existing?: boolean // true: this draft's Full Quality was already running or done; nothing new started or charged
}
```

A role with no images (empty or `null`) is skipped: that subject or place
stays as in the video. At least one role with images, a reference, or a
`prePrompt` or `postPrompt`, is required. Each trait (`body`, `outfit`, `hair`; a pet's `body`, `coat`; a
product's `shape`, `finish`) is `"new"`, from your images, or `"original"`,
kept from the video.

**Fixed references** (`references`, `CastSwapReference[]`, at most 5): things
the video should show that no role replaces, each 1–3 images of ONE thing and
the `line` that says what it is (1–500 characters, e.g.
`"the glass she drinks from"`). `{image}` in a line stands for that
reference's first image; a line without it gets it appended. They are sent as
given (never prepared) and their images count toward the 30. A `{role:N}` or
a raw `{image:` / `{video:` / `{audio:` token in a line answers `400`.

**Preview-only role settings** (any kind; a full run ignores both):
`previewName` is the name used instead of `name` in a preview, and
`inPreview: false` leaves the role out of the preview (its images are not sent,
prepared or charged; `{role:N}` keeps its numbering and reads as its
`previewName`, else its `name`). A preview with every role left out (always,
even with a `prePrompt` or `postPrompt`), or with no role kept in it that has
images and no `prePrompt` or `postPrompt`, answers `400 no_roles_in_preview`.

**Reference preparation** (`prepareReferences`, on by default): before the
video, each person, pet and product role's images are turned into one clean
reference picture by an image model. It costs extra credits
(`breakdown.references` in the estimate), charged when it runs, even if the
video then fails; it adds about a minute, and falls back to your own images
for a role whose picture could not be made. Locations are not prepared.
Pass `prepareReferences: false` to use your images as they are.

**Face masking** (`faceMasking`, off by default): the faces in the source clip
are covered before the video model sees it, keeping their movement and lip
timing. `"always"` masks them before the first attempt (its credits are
`breakdown.masking`, in `totalCredits`); `"auto"` starts unmasked and, only if
the video model refuses the source clip, retries once with the faces masked
(any other failure is not retried; the extra credits, charged only then, are
`maskingCredits`, not in `totalCredits`, and `run()` needs credits for both).
`fill` is `"blur"` (default) or `"depth"` (a depth-color view of the face); the
size, `zone` and `threshold` settings choose which faces are masked. A
completed job's output carries `faceMasking: { applied, reason }`: `applied` is
whether the video was made from the masked clip; `reason` is `"always"`,
`"input_refused"` (`auto` retried after the refusal), `"no_faces"` (no face
left to mask after the filters: `always` continues unmasked, `auto` fails with
the original refusal) or `"off"`.

Both routes answer `400` before charging for more roles of a kind than allowed
or more than 30 images in all (`validation_error`), `draft: true` with
`resolution` `"720p"` or `"1080p"` (`validation_error`, "Draft is 480p only."),
a `prePrompt` or `postPrompt` over 4,000 characters, a `faceMasking` setting
out of range (`validation_error`), a `{role:N}` with N outside
1..`roles.length` (empty roles count), a raw `{image:` / `{video:` / `{audio:` token in a role's `name`, the
`prePrompt` or the `postPrompt`, a prompt that would build too long
(`prompt_too_long`: a `{role:N}` reads as the role's name when it sends no
images), a clip outside 4–30 s, or a preview past the clip's end
(`previewStart + 4` > its length); also for an invalid body
(`validation_error`), an address that is not public http(s) (`unsafe_url`) or a
clip whose length cannot be read (`video_unreadable`). Other refusals: `401`,
`402 insufficient_credits` (`run()` only), `404` (a `sessionId` you may not use),
`422 job_blocked`, `503 host_too_old` (both), `503 estimate_unavailable`
(`estimate()` only). The full table is in the
[route reference](./api-integration.md#13f-cast-swap-cloud-edition).

`run()` returns a job id; follow it with `client.jobs.get(jobId)`. Pass
`{ idempotencyKey }` (`CastSwapRunOptions`) to make a retry safe: `run()` sends
it unchanged as the `Idempotency-Key` header (the server takes 8–200
characters and answers `400` otherwise). A repeat with the same key within the
credit guard's dedup window (about 10 s) answers `200 { jobId, deduped: true }`
with an `X-Dedup-Hit` header, a later one `202` with the first run's `jobId`,
and nothing new is started or charged. Without a key no header is sent.
A preview's job keeps every input in its `input_data`, so rerunning it with
`preview: false` renders the full clip with the same choices.

```ts
const params: CastSwapParams = {
  videoUrl,
  roles: [{ kind: "person", name: "the woman dancing", images: [myPhotoUrl], outfit: "original" }],
  preview: true,
}
const quote = await client.castSwap.estimate(params)
const { jobId } = await client.castSwap.run(params, { idempotencyKey: crypto.randomUUID() })
```

**Full Quality.** A finished draft run (a Cast Swap run made as a draft, or a
trend run, whose default is a draft) can be finished at Full Quality within 7
days: `fullQuality(jobId)` re-renders the same take at 1080p, with the clip's
audio, as a new job linked to the draft. It spends credits; quote it first with
`fullQualityEstimate(jobId)` (free), whose `totalCredits` is
`breakdown.castSwap + breakdown.seedanceHd` (`seedanceHd` is 0 when an earlier
failed try of this draft already finished the 1080p render, which is then
reused). One Full Quality per draft: a repeat answers the same job with
`existing: true` and charges nothing; the server keys it by the draft, so no
idempotency key is taken. The new job keeps the draft's origin; `sessionId`
files it in a session. Refusals carry a `CastSwapFullQualityRefusalCode`:
`401 unauthorized`, `404 not_found`, `409 not_completed`, `409 not_a_draft`,
`410 draft_expired`, `409 full_quality_pending`, `409 full_quality_unavailable`,
`402 insufficient_credits` (or a workspace cap), `422 job_blocked`,
`503 job_read_failed` (retryable), `503 estimate_unavailable`,
`503 host_too_old` — the full table is in the
[route reference](./api-integration.md#full-quality).
`full_quality_pending` (`err.details.retryable === true`) is not final: while
an earlier try's 1080p render of the draft is being reviewed, or has not
started yet, both calls refuse with it; try again later.
`full_quality_unavailable` is final (nothing kept to re-render, the finalize
refuses the draft, every try failed). Tell them apart by `err.code`.

```ts
const quote = await client.castSwap.fullQualityEstimate(draftJobId) // free
const { jobId, existing } = await client.castSwap.fullQuality(draftJobId)
```

---

### `client.trends`

Trends: ready-made Cast Swap recipes. A trend is a short clip with slots (the
people, pets, products and place you can replace); fill its slots with your own
pictures and run it. **Cloud edition only**: these routes 404 on self-hosted
installs. Only published trends exist: a draft, unpublished or unknown slug is a
`404` on every method. Also importable as `@nodaro/sdk/trends`. Routes:
[Trends](./api-integration.md#13g-trends-cloud-edition).

```ts
list(params?: ListTrendsParams): Promise<TrendPage<TrendCard>>                  // GET /v1/trends
get(slug: string, params?: { locale?: string }): Promise<TrendDetail>           // GET /v1/trends/:slug
estimate(slug: string, request: TrendRunRequest): Promise<TrendEstimate>        // POST /v1/trends/:slug/estimate, free
run(slug: string, request: TrendRunRequest, options?: { idempotencyKey?: string }): Promise<{ jobId: string }> // POST /v1/trends/:slug/runs → 202
runs(params?: ListTrendRunsParams): Promise<TrendPage<TrendRun>>               // GET /v1/trends/runs
getRun(jobId: string): Promise<TrendRun>                                        // GET /v1/trends/runs/:jobId
tags(params?: { locale?: string }): Promise<TrendTag[]>                         // GET /v1/trends/tags
favorite(slug: string): Promise<void>                                           // PUT /v1/trends/:slug/favorite → 204
unfavorite(slug: string): Promise<void>                                         // DELETE /v1/trends/:slug/favorite → 204
```

`list()` and `runs()` resolve to the page as it arrives (`{ data, next }`; pass
`next` back as `cursor`, `null` on the last page). `get()`, `estimate()`,
`run()`, `getRun()` and `tags()` resolve to the payload, out of the route's
`{ data }` envelope.

```ts
type TrendSlotKind = "person" | "location" | "product" | "pet"
type TrendChoice = "new" | "original"       // make the trait anew from your pictures, or keep the clip's
// The chips of a slot's kind: person body/outfit/hair, pet body/coat, product shape/finish, location none
interface TrendChips { body?: TrendChoice; outfit?: TrendChoice; hair?: TrendChoice; coat?: TrendChoice; shape?: TrendChoice; finish?: TrendChoice }

interface ListTrendsParams {
  q?: string; tag?: string
  favorites?: boolean   // true → only yours (sent as favorites=1)
  locale?: string       // default: your profile's language, then English
  cursor?: string; limit?: number  // 1–60, default 30
}

interface TrendCard {
  id: string; slug: string; name: string; description?: string
  tags: string[]; badges: string[]
  cover: { videoUrl: string; posterUrl?: string; width: number; height: number } // the first example
  needs: Record<TrendSlotKind, number>   // slots of each kind
  durationSec: number
  isFavorite: boolean
}

interface TrendDetail extends TrendCard {
  version: number
  previewSec: 4 | null                   // 4 when a 4 s preview run is offered
  resolutions: ("480p" | "720p" | "1080p")[]
  slots: Array<{ key: string; label: string; kind: TrendSlotKind; required: boolean; hint?: string; defaults?: TrendChips }>
  examples: Array<{ videoUrl: string; posterUrl?: string; width: number; height: number; slots: Record<string, string[]> }>
}

interface TrendRunRequest {
  slots: Record<string, { images?: string[] } & TrendChips> // slot key → 1–3 images + its kind's chips
  example?: number      // 1-based; its pictures fill the optional slots you leave out. Default 1
  details?: string      // ≤ 1,000 characters; mention a slot as {slot:<key>}
  preview?: boolean     // 4 s run, when previewSec is 4
  resolution?: "480p" | "720p" | "1080p" // default "480p"
  draft?: boolean       // only at 480p; default true there
  sessionId?: string    // accepted (and checked), not yet applied: trend runs are not filed into sessions yet
  projectId?: string    // accepted, but not used by the run today
  previewJobId?: string // a full run: the jobId of your own completed preview of this trend (uuid; any other job is ignored)
  origin?: string       // run(): your app's slug (e.g. "tools"), as on any job: the run's job carries it as input_data.origin
}

interface TrendEstimate {
  expectedCredits: number            // what the run is expected to be charged
  holdCredits: number                // what is reserved when it starts
  breakdown: Record<string, number>  // the parts of the quote (with maskingCredits, `masking` is listed but not in the totals)
  maskingCredits?: number            // charged only if the clip is refused and the run retries with the faces masked
}

interface TrendRun {
  jobId: string; status: string; progress: number | null
  error: { code?: string; message: string } | null  // code: safety-block | policy-block | credits | cancelled | failed
  createdAt: string; completedAt: string | null
  trend: { id: string; slug: string; version: number; name: string } // the version it ran
  example: number
  slots: Array<{ key: string; label: string; kind: TrendSlotKind; images: string[]; fromExample: boolean } & TrendChips>
  details?: string
  preview: boolean; resolution: string; draft: boolean
  videoUrl: string | null; posterUrl: string | null  // once completed
  creditsCharged: number | null
  fullQualityOf: string | null       // a Full Quality version: the draft run it was made from; else null
  fullQuality: { jobId: string; status: string } | null // a draft's newest Full Quality try: a pointer only
  fullQualityUntil: string | null    // until when a completed draft can be redone in Full Quality
}

interface TrendTag {
  tag: string     // pass it as list({ tag })
  label: string   // in the resolved locale; the tag itself when it has no label
  count: number   // published trends that carry it
}
```

A Full Quality version of a draft is a run of its own in `runs()` and
`getRun()`: its own `jobId`, status, result and `creditsCharged`, with
`fullQualityOf` naming the draft. It stays listed after the draft is deleted.
The newest Full Quality try per draft is the one listed (running, done, or its
last failure): when a try failed or was cancelled and the draft was tried
again, the older tries are left out of `runs()` (with or without `trend`), and
`getRun()` still reads one by its id. The draft's `fullQuality` is only a
pointer to that newest try (`{ jobId, status }`, or `null` when none was
started), to tell that an upgrade exists; its video and charge are on its own
run (`getRun(fullQuality.jobId)`), never on the draft.

`getRun(jobId)` reads one of your trend runs in the same shape; a job that is
not your own trend run (another user's, a step inside another job, any other
kind of job) is a `NotFoundError`. `tags()` lists the tags in use on published
trends, most used first, with their labels in the resolved locale (`locale`,
else your profile's language, else English).

A required slot left empty is refused with `400 missing_slot`; an optional one
left out takes the chosen example's pictures (`fromExample: true` on the run),
or is refused with `missing_slot` when that example has none for it
(`example_out_of_range` when the trend has no such example).
`estimate()` and `run()` answer `400` before charging for `missing_slot`,
`unknown_slot`, `invalid_choice` (a chip the slot's kind does not take),
`example_out_of_range`, `preview_unavailable`, `invalid_slot_mention` (a
`{slot:<key>}` naming no slot), `prompt_too_long` and `validation_error`; the
slot errors carry the key as `slot`. Other refusals: `401`, `404 not_found`
(the trend is not published; for `run()` also a `sessionId` you may not use),
`502 engine_error`, `503 engine_unsupported` / `trend_unavailable` /
`not_available`. When the video engine refuses, `estimate()` / `run()` get the
trend routes' OWN codes with fixed messages, never the engine's text or
`issues`: `400 trend_run_rejected` (or `clip_out_of_range`,
`preview_out_of_range`, `video_unreadable`, `unsafe_url`,
`raw_reference_token`), `402 insufficient_credits` (or a workspace cap) as
given, `413 storage_limit_exceeded`, `422 job_blocked`, `429 rate_limited`,
`503 engine_unsupported` / `estimate_unavailable`, else `502 engine_error`.
`"runs"` and `"tags"` are never slugs: `get()`, `estimate()`, `run()`,
`favorite()` and `unfavorite()` throw a `TypeError` for them before any
request. The full table
is in the [route reference](./api-integration.md#13g-trends-cloud-edition).

`run()` returns a job id; follow it with `client.jobs.get(jobId)`, or read it
back with `getRun(jobId)` / `runs()`. Pass `{ idempotencyKey }` (`TrendRunOptions`) to make a
retry safe: it is sent unchanged as the `Idempotency-Key` header (8–200
characters, else `400`), and a repeat with the same key answers with the first
run's `jobId`; nothing new is started or charged.

```ts
const { data: cards } = await client.trends.list({ tag: "dance" })
const trend = await client.trends.get(cards[0].slug)
const request: TrendRunRequest = {
  slots: { [trend.slots[0].key]: { images: [myPhotoUrl] } },
  preview: trend.previewSec === 4,
}
const quote = await client.trends.estimate(trend.slug, request)
const { jobId } = await client.trends.run(trend.slug, request, { idempotencyKey: crypto.randomUUID() })
```

---

### `client.copilot`

The assistant's conversation surface (`/v1/copilot/*`). A **thread** is the
conversation, opened on a workflow; a **turn** is one message and everything the
assistant does in answer to it. **Cloud edition only, and in-app only**: every
route here refuses a caller who is not carrying a user's own session JWT with
`403 in_app_only` — an OAuth app token or an API token must not drive someone's
copilot. A deployment with the feature switched off answers `503
feature_disabled` where a thread would be opened or a turn sent, rather than a
`404`, so "not available here" and "no such thread" stay distinguishable.

Unlike `client.studio.productions`, these methods return the API **envelope**
as it arrives: `create`/`list`/`get` resolve to `{ data: … }`, and the payload is
inside it. `stream` is the exception — it yields frames, not a response.

```ts
create(input): Promise<{ data: { thread: CopilotThread; workflow: CopilotThreadWorkflow } }>
list({ workflowId }): Promise<{ data: { thread: CopilotThread | null } }>
get(id, { after?, limit? }): Promise<{ data: { thread: CopilotThread; messages: CopilotMessage[] } }>
archive(id): Promise<{ data: { archived: true } }>
cancel(id): Promise<{ data: { cancelling: true; turnId: string } }>
stream(id, opts): AsyncGenerator<CopilotStreamFrame>
```

`create` takes `workflowId` (an existing workflow) **or** `prompt` (the server
creates one, seeded by it, with an optional `name`). Re-opening a workflow that
already has an active thread answers THAT thread rather than a second one.
`list` reads the active thread for a workflow, or `null`. `get` reads a thread
with its messages — `after` returns only what followed that sequence number,
which is how a panel catches up, and `limit` caps the page at the server's own
ceiling. `archive` is archival, not deletion: the messages stay readable, and it
is refused while a turn is running. `cancel` stops the running turn and answers
which one it asked to stop; that turn's own stream ends with a `done` frame.

A thread carries `runMode` (`"ask"` — propose and wait — or `"auto"`, which runs
within `autoRunLimitCredits`), `modelTier`, `allowPublishing`, `userTurnCount`
and, from `get`, a derived `status` / `activeTurnId`. `surface` names WHICH
assistant the thread belongs to; it is optional on the type, and its absence
means the deployment did not say. The SDK does not choose one — a thread opened
through `create` is the deployment's own default.

#### A turn is a stream of typed frames

`stream(threadId, { message, baseVersion?, tier?, signal? })` POSTs the message
and yields the turn's frames as they arrive (server-sent events), so a caller
renders prose, tool activity and proposals live instead of waiting for a
finished answer. It is the only method here that spends.

```ts
for await (const frame of client.copilot.stream(threadId, { message: "Tidy the graph" })) {
  if (frame.type === "token") process.stdout.write(frame.data.text)
  if (frame.type === "run_proposed") await askTheUser(frame.data)
  if (frame.type === "done") break
}
```

`CopilotStreamFrame` is a discriminated union on `type`. The SDK models
`metadata` (the turn's ids, model, `runMode`, `autoRunLimitCredits` and the rest
of what it is running under), `token` (a chunk of prose), `tool_call`
(`started` → `finished` / `failed`), `workflow_updated`, `workflow_created`,
`run_proposed` (what the turn wants to run, for a person to confirm),
`memory_saved`, `usage` (tokens, and `creditsCharged`) and finally `done`
(`"completed" | "capped" | "cancelled"`) or `error`. A frame's `data` is passed
through untouched, so a field this package does not model still reaches you —
and a frame KIND it does not model is skipped rather than thrown, so a newer
server cannot break an older caller. Read the frames you know and ignore the
rest.

One kind is missing today rather than newer. `run_proposed` is the canvas
surface's frame; a thread on the `studio` surface offers its card as
`action_proposed`, which this version does not model — so `stream` skips it
along with everything else it does not know, and a caller on that surface does
not see the proposal come through.

Two lifetime rules, both deliberate:

- The client's `timeoutMs` is **not** applied to a turn — a turn legitimately
  runs for minutes, and inheriting the request timeout would cut the assistant
  off mid-answer. You own the lifetime: pass `signal`, or stop iterating (the
  reader cancels the body, which ends the request).
- Aborting **rejects** the iteration with the platform's raw `AbortError`, not a
  `NodaroError`, whether it fires before the first frame or between two of them.
  Wrap the loop in `try`/`catch` if a cancelled turn is an ordinary ending in
  your UI. A non-2xx on the opening request still throws the ordinary typed
  error, before any frame.

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

**Reading `nodeStates[nodeId].output`.** A node carries `output` when it
`completed` — and ALSO when it `failed` but the run retained a structured
result. The 3D-scene authoring nodes are the case that exists today: once the
repair budget is spent and only the visual reviewer refuses, the run has already
published a real, renderable revision, so the node fails and the revision is in
`output.plan`. Gate on the FIELD, never on the status — and never read a present
`output` as success:

```ts
import { nodeStateMayCarryOutput } from "@nodaro/sdk"

const node = data.nodeStates["scene-1"]
if (node.status === "failed") {
  console.error(node.error)                 // the verdict stands
  if (node.output?.plan) {
    // …and the draft it retained is still here, billed and addressable.
  }
}
nodeStateMayCarryOutput(node.status) // "completed" | "failed" → true
```

`OUTPUT_BEARING_NODE_STATUSES` (the same two statuses, as a `Set`) and the
`NodeExecutionStatus` union are exported beside it.

**`outcome` and `skipReason`.** A run that found nothing new ends `completed`,
not `failed` (see [Runs that find nothing new](./api-integration.md#runs-that-find-nothing-new)):
a text-requiring node whose wired text came from a node that produced nothing
in this run is skipped with `nodeStates[id].skipReason === "empty_input"`, and
the run carries `outcome: "nothing_new"` once it completes (`"succeeded"`
otherwise; absent until then, and on an older server). The rule the server
derives it with is exported, for a row you already hold:

```ts
import { executionOutcome, countEmptyInputSkips } from "@nodaro/sdk"

const { data } = await client.executions.get(executionId)
if (data.outcome === "nothing_new") {
  console.log(`nothing new — ${countEmptyInputSkips(data.nodeStates)} node(s) had nothing to work on`)
}
executionOutcome(data.status, data.nodeStates) // the same answer, derived client-side
```

`WorkflowExecutionSummary` (from `listForWorkflow`) carries the same `outcome`.

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
  refunding reserved credit holds (status `"cancelled"`). A running LLM job
  priced per model (metered) is cancelled too, but charged what the provider
  already billed for it, and the rest of its hold is refunded. One stopped
  before its call starts is refunded, except for what an earlier attempt of
  the same job already used, which is charged.
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
console.log(data.providers, data.creditCost) // creditCost: the charged price, Cloud only
```

A node charged per unit of its own measure also carries `creditRate`
(`NodeCreditRate`) — Speaker Frames, whose `creditCost` is the word
`"per-1000-frames"`. `creditsPerUnit` is the exact charged credits of one unit,
and a run of N units is charged `Math.ceil(N * creditsPerUnit)`, rounded up
once (`rounding: "ceil-run-total"`), so never multiply the one-unit price from
`/v1/credits/model-cost`. See [Node discovery](./api-integration.md#11-node-discovery).

```ts
const { data: frames } = await client.nodes.get("speaker-frames")
const rate = frames.creditRate // { identifier: "speaker-frames", unit: "1000-frames", creditsPerUnit, minUnits: 1, rounding: "ceil-run-total", note }
const runCredits = rate && Math.ceil(Math.max(rate.minUnits, blocks) * rate.creditsPerUnit)
```

#### `run(type, params?, options?)`

```ts
run(type: string, params?: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<RunNodeResult>
```

`options.idempotencyKey` is sent as the `Idempotency-Key` header: reuse the same
value when you retry a call that timed out, and the platform returns the run it
already started instead of starting (and charging) a second one. Every typed
overload takes it too, the video ones included (`text-to-video`,
`generate-video`, `video-to-video`, `video-upscale`, `assemble-narrated-video`).

Run a single node directly without wrapping it in a workflow. Posts `params`
as the request body to the node's route — `POST /v1/<type>` for most node types
(`generate-image`, `generate-video`, `text-to-speech`, etc.). This is the SDK
equivalent of the MCP server's verb tools and the path the Nodaro CLI uses for
`nodaro nodes run <type>`.

Some node types run on a different route, and `run` posts there for you. The
table is `NODE_RUN_ROUTES`, exported by `@nodaro/shared` (the platform's
workflow engine calls the same routes):

| Node types | Route |
| --- | --- |
| `generate-3d-scene`, `edit-3d-scene` | `/v1/3d-scene/generate`, `/v1/3d-scene/edit` |
| `llm-chat`, `after-effects`, `motion-graphics`, `lottie-overlay`, `3d-title` | `/v1/<type>/generate` |
| `image-to-text` | `/v1/image-to-text/describe` |
| `video-composer` | `/v1/scene-graph/generate` |
| `telegram-channel-feed` | `/v1/telegram-channel/fetch` |
| `suno-generate`, `suno-cover`, `suno-extend`, … (every `suno-*` node) | `/v1/suno/<name>`; `suno-voice` → `/v1/suno/voice/generate` |
| `instagram-post`, `tiktok-post`, `youtube-upload`, `linkedin-post`, `x-post`, `facebook-post`, `telegram-post`, `publish-social` | `/v1/social/publish` |
| `ugc-creator`, `ugc-script`, `ugc-clips`, `ugc-clip`, `ugc-cards` | `/v1/ugc/creator`, `/v1/ugc/script`, … (Cloud plugin) |
| `render-video` with a `planType` | `/v1/render-video/plan` |

The publish route needs a `platform`; a per-platform social node (`x-post`, …)
fills it in from its type when you leave it out, and `publish-social` takes the
`platform` you send.

A node type with no route of its own rejects with a `NodaroError` whose `code`
is `node_not_runnable`, without calling the API. Its message names what to run
instead (the list is `NODE_TYPES_WITHOUT_RUN_ROUTE` in `@nodaro/shared`):
`modify-image` runs through `image-to-image` (or `edit-image` for the
`nano-banana-edit` provider), `upscale-image` and `remove-background` through
`edit-image`, `image-to-video` through `generate-video`; `composite`,
`manual-edit` and `paint-mask` run only inside a workflow, and `scene` and
`generative-pipeline` inside a pipeline.

Node types that run only inside a workflow — inputs, triggers, utilities,
parameter pickers and the like (`upload-image`, `combine-text`, …) — reject the
same way, with `node_not_runnable` naming the type, once the API answers that it
has no route for them. A `404` about a missing resource (a character id that
does not exist, say) stays a `NotFoundError`, and so does a `404` for a type
whose route is in the table above (a platform that predates that route).

Most node types are async: the response includes `{ jobId }` and the actual
generation runs on a worker. Poll `client.jobs.get(jobId)` until completed.
Synchronous node types (`meta-ads-scrape`, for one) return their full result
without a `jobId` field.

```ts
const result = await client.nodes.run("generate-image", {
  prompt: "a snow leopard in the mountains",
  provider: "nano-banana-pro",
})
if ("jobId" in result) {
  const { data: job } = await client.jobs.get(result.jobId)
  console.log(job.output_data)
}
```

The input/source nodes work the same way. A scraper answers synchronously —
the response carries both a `jobId` (for history) and the data — so you can use
the result directly. Meta Ads (`meta-ads-scrape`), for example, pulls public
Facebook + Instagram ads from Meta's Ad Library by keyword, advertiser or Page:

```ts
const result = await client.nodes.run("meta-ads-scrape", {
  mode: "search",          // or "pages" (pageUrls) / "advertiser" (see below)
  query: "running shoes",
  count: 20,               // 1..100 ads; pricing is 1 credit per requested ad, tiered
  period: "30d",           // 24h | 7d | 30d | all
  // formats: ["vertical"],        // keep only phone/square/web creatives (may return fewer)
  // analyze: true,                // attach a per-ad AI analysis object (extra credits per ad)
})
console.log(result.json)   // the array of ads (copy, CTA, images, videos, …)

// By advertiser name instead of keyword — mode "pages" with advertiserNames,
// resolved to Facebook Pages server-side (verified match first):
const byAdvertiser = await client.nodes.run("meta-ads-scrape", {
  mode: "pages",
  advertiserNames: ["Nike", "Adidas"],
  count: 30,
})
console.log(byAdvertiser.resolvedAdvertisers) // [{ name, pageId, url }, …]
```

> Needs an `APIFY_API_TOKEN` on the server, or a connected nodaro.ai account
> (the scrape — including advertiser resolution and AI analysis — is relayed
> and billed there). The CLI runs the identical path: `nodaro nodes run
> meta-ads-scrape --param mode=search --param query="running shoes"`.

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
> **MiniMax H3** (`minimax-h3`) takes the same reference fields (9 images /
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
> **Vidu Q4** (`vidu-q4`) has no text-to-video mode — use
> `run("generate-video", …)` with an `imageUrl` (start frame) or
> `referenceImageUrls`; `run("text-to-video", …)` answers `image_required`. A start frame alone animates that frame
> (`prompt` optional, `aspectRatio` ignored); any `referenceImageUrls` (≤ 15) or
> `referenceAudioUrls` (≤ 3) switches to reference mode, where `prompt` is
> required and a sent `imageUrl` joins the reference images. Reference audio is
> MP3 only, 3–12 s per clip (refused before the job otherwise). No reference
> videos, end frame or seed. `duration` 3–16 (default 5); `resolution`
> `540p` / `720p` / `1080p` / `2k` / `4k` (omitted or unsupported → 720p);
> one per-second price ladder for both modes and audio on or off.
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
> `runAndWait("text-to-speech", …)` default `provider` to `elevenlabs-v4`
> (the default speech model) when omitted — but only when `text` is within
> v4's per-request cap (10,000 chars; see the per-model caps table in the
> [Text to Speech node docs](nodes/ai-audio/text-to-speech.md)). Text longer
> than that without an explicit `provider` falls back to `elevenlabs-turbo`
> (cap 40,000) instead, so integrations that always omit `provider` don't get
> silently truncated by v4's cap. An explicit `provider` is always respected
> regardless of text length (its own cap still clamps the stored record,
> unchanged): pass `provider: "elevenlabs-v3"` to keep v3 (cap 5,000), which
> was the default before v4. A request that omits `provider` and sends 5,001 to
> 10,000 characters now runs, and is billed, on v4 instead of turbo.

> **Continuity across clips.** `run("text-to-speech", { text, previousText, nextText, … })`
> passes the lines spoken just before and after the clip; a model that stitches
> (ElevenLabs v4, v4 Turbo, Turbo v2.5 and Multilingual v2; not v3) keeps one intonation across clips produced separately. Up to 1,000
> characters each; context is not spoken. See the Text to Speech node docs.

> **Presets on `generate-image`.** `GenerateImageParams.presetId` applies a node
> preset (a factory id from `presets.listFactory("generate-image")`, or one of
> yours) exactly as the editor does — prompt and pre/post text, placeholder
> defaults, style, negative prompt, levers — so the job matches the editor's Run.
> Fields you pass override it. A placeholder with no default needs a value in
> `presetVariables` (`{ BRAND: "Acme" }`); without one the call fails with `400
> preset_variables_required` naming it. See [API integration § 4f](./api-integration.md#4f-applying-a-preset-on-v1generate-image-presetid).
>
> ```ts
> await client.nodes.runAndWait("generate-image", {
>   presetId: "generate-image/logo-wordmark",
>   presetVariables: { BRAND: "Acme" },
> })
> ```

> **Typed structured references.**
> `run("generate-image" | "generate-video" | "text-to-video", …)` (and the same
> three on `runAndWait`) have typed overloads — `GenerateImageParams` /
> `GenerateVideoParams` / `TextToVideoParams` (all extend
> `StructuredReferenceParams`). `text-to-video` is the prompt-only video lane, so
> its `prompt` is REQUIRED and the frame fields (`imageUrl` / `endFrameUrl`)
> belong to `generate-video`, the image-to-video lane.
> Pass `connectedReferences: ConnectedReference[]` (the
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

> **Typed image routes.** `image-to-image`, `edit-image`, `split-image` and
> `generate-mask` have typed overloads on `run` (and, for the three that start a
> job, on `runAndWait`), with the params types `ImageToImageParams`,
> `EditImageParams`, `SplitImageParams` and `GenerateMaskParams`. Each takes
> the platform's own vocabularies (`ModifyImageProvider`, `ImageEditProvider`,
> `ImageAspectRatio`, `ImageResolution`, …, re-exported from the SDK); any
> other route field still passes through.
>
> The compile-time check applies when the body is typed as the params type —
> `const params: EditImageParams = …`, or `{ … } satisfies EditImageParams`
> inline. A body written straight into the call that the typed overload rejects
> (a missing `prompt`, an unknown `resolution`, `taskId` on `recraft-upscale`)
> still compiles: it falls through to the untyped `run(type: string, …)`
> overload and resolves the untyped `RunNodeResult` (on `runAndWait`, the
> generic overload's output), and the route answers `400`. Use `satisfies` to
> get the check.
>
> - `run("image-to-image" | "edit-image" | "generate-mask", …)` answers
>   `ImageJobStarted` — `{ jobId: string; adjustments? }` — so `result.jobId`
>   needs no cast. `ImageToImageParams` requires `imageUrl` and `prompt`; its
>   `maskUrl` (white = the area to change, on both models) is sent to the model
>   as its own mask, so only `ideogram-edit` and `flux-fill` use it.
> - `EditImageParams` is one of two forms: `imageUrl` for every provider except
>   the Grok task ops, or `taskId` plus `provider: "grok-upscale" | "grok-2-edit"
>   | "grok-2-segment"` (a prior Grok generation's task id, its job's
>   `output_data.kieTaskId`). A body typed as `EditImageParams` that sends both,
>   or a `taskId` on another provider, does not compile. The provider defaults
>   to `recraft-upscale`; `prompt` is required for `nano-banana-edit` and
>   `grok-2-edit` (a `400` without one); `maskIndexes` is for `grok-2-edit` only.
> - `split-image` is free and synchronous: it creates no job, so `runAndWait`
>   does not apply (it would throw — the answer has no `jobId`). `run` answers
>   `SplitImageResult` — `{ images: { name, url }[] }`, one PNG per tile, in
>   `names` order. `names` must hold exactly `gridCols × gridRows` entries
>   (`gridCols` and `gridRows` each 1–6).
> - `generate-mask` (`POST /v1/generate-mask`) is the SDK's one way to start a
>   Generate Mask job: `GenerateMaskParams` is `@nodaro/shared`'s `GenerateMaskRequest` plus the
>   session fields, and `runAndWait("generate-mask", …)` resolves
>   `GenerateMaskJobOutput` — `NodeJobOutput & GenerateMaskOutput`: `maskUrl`,
>   the mask PNG (white = the subject), and `imageUrl`, the source passed
>   through unchanged.
> - Inpaint on `generate-image`: `GenerateImageParams.baseImageUrl` +
>   `maskUrl` (white = the area to change). Every image model can inpaint: the
>   result's masked area is composited back over the base, and on the models
>   whose `IMAGE_MASK_MODE` is `"prompt"` the area's position is also written
>   into the prompt. `strength` and `guidanceScale` are typed there too.
>
> ```ts
> import type { EditImageParams, GenerateImageParams, GenerateMaskParams } from "@nodaro/sdk"
>
> const { maskUrl } = await client.nodes.runAndWait("generate-mask", { imageUrl, prompt: "the red car" } satisfies GenerateMaskParams)
> await client.nodes.runAndWait("generate-image", { prompt: "a blue car", baseImageUrl: imageUrl, maskUrl } satisfies GenerateImageParams)
> const { jobId } = await client.nodes.run("edit-image", { imageUrl, provider: "topaz-image-upscale", upscaleFactor: "4" } satisfies EditImageParams)
> ```

> **Seedance 2.5 Draft.** `GenerateVideoParams` and `TextToVideoParams` take
> `draft?: boolean`: on `seedance-2-5` the run is a 480p draft (any `resolution`
> becomes 480p; same price as a 480p run). Finalize the take you like with the
> typed `run("video-upscale", { provider: "seedance-2-5-hd", sourceJobId })`
> (`VideoUpscaleParams`, also on `runAndWait`) — the same take re-rendered at
> 1080p, priced from the draft's length. A foreign, unfinished or non-draft
> source is refused with a 4xx before anything is charged. See
> [Seedance 2.5 HD (from draft)](./nodes/processing-video/video-upscale.md#seedance-25-hd-from-draft).

> **Copyright refusals.** `TextToVideoParams` takes `contentPolicyRewrite?: boolean`.
> Absent or `true`, a copyright refusal is retried once with a reworded prompt;
> `false` = a copyright refusal fails the job instead of retrying once with a
> reworded prompt.

> **A name you have no picture for.** The same three params take
> `describedReferences: DescribedReference[]` (also re-exported from the SDK) —
> up to 10 `{ name, description }` entries for a subject you can name and
> describe but have no media for: a cast role nothing is bound to yet, a
> character that exists only in the script. They carry no url, so nothing is
> attached and no `@image_N` seat is used; each becomes a
> `<Name> — <description>.` line, and correlation is by NAME — leave the name in
> your prompt prose and the line tells the model who it is. They are a reference
> channel on their own: send them with no `connectedReferences` and the route
> still assembles. Per-use wording for a reference you DO have a picture for
> goes on the entry itself as `descriptionOverride` (it fills the directive's
> description slot ahead of the entity's stored description, which stays the
> label).

> **Captioning the video / audio rails.** `GenerateVideoParams` and
> `TextToVideoParams` take `referenceVideoCaptions` / `referenceAudioCaptions` —
> string arrays **index-aligned** with `referenceVideoUrls` /
> `referenceAudioUrls`, rendered as `@video_N: <caption>.` / `@audio_N:
> <caption>.` and bounded by the number of rail references that actually ship.
> A blank entry is a hole in the alignment, not a line.

> **Keeping a person's face (Gemini Omni).** `GenerateVideoParams` and
> `TextToVideoParams` take `characterReferences` — up to 3
> `VideoCharacterReference`s (`{ imageUrl, description, bodyImageUrl?, name?, voice? }`;
> `voice` is `{ preset, description?, exampleLine? }` — `preset` is one of the
> `GEMINI_OMNI_VOICE_PRESETS` ids exported by `@nodaro/shared`, and pins one voice
> to that character across clips).
> Only `gemini-omni-video` / `gemini-omni-flash` accept them (any other model
> answers `400`), they cannot be combined with a start frame (`imageUrl`), and
> they share the model's 7-unit input budget with reference images and a source
> video (a character is 1 unit, 2 with a `bodyImageUrl`). They add no credit
> charge. Prefer them over `referenceImageUrls` whenever the face must hold.

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

> **Who is in the shot, by id (`subject`).** `GenerateImageParams` and
> `TextToVideoParams` type an optional `subject` — the exported `Subject` type: a
> flat map of picker field → catalog id(s) for the person, how they are styled and
> the props in frame. You never write prompt text for it; the platform writes the
> wording and folds it in right after your `prompt`, ahead of any `direction`.
> Field names and ids come from the picker catalogs:
> `client.pickerCatalogs.get("person")` / `get("styling")` list each dimension's
> `field` with its `options[].id`, and `get("held-prop")`, `get("material")` and
> `get("animal")` write their `options[].id` to the catalog's `valueField`
> (`heldProp`, `material`, `animal`). A value is one id or a list; ids past a
> dimension's own cap are dropped, not rejected. `customAge` is the one number
> (years, read only with `age: "age-custom"`). Without a preset the route
> validates the map — more than 128 keys, a key over 64 characters, more than 8
> ids on a key or an id over 100 characters is a `400 validation_error`; unknown
> keys and ids within those bounds are skipped, and the job's
> `input_data.subject` keeps exactly the ids that were used. With `presetId`,
> your `subject` replaces the preset's own and is folded into the preset's prompt,
> as `direction` and `structured` are: over-long values are dropped rather than
> rejected, and `input_data` does not record the subject.
>
> ```ts
> import type { Subject } from "@nodaro/sdk"
>
> const subject: Subject = { type: "woman", age: "age-30s", hairBase: "base-short-straight", heldProp: "smartphone" }
> await client.nodes.run("generate-image", { prompt: "on the seawall at dusk", subject })
> ```
>
> Full key list, caps and fold order in the
> [API integration guide](./api-integration.md#structured-subject-subject).

> **Video Depth.** `run("video-depth", …)` / `runAndWait("video-depth", …)`
> have a typed overload — `VideoDepthParams` (`POST /v1/video-depth`). The
> completed job writes the depth video to `videoUrl` (near is bright, far is
> dark), plus a `thumbnailUrl`.
>
> | Field | Type | Default | Description |
> |-------|------|---------|-------------|
> | `videoUrl` | `string` | — | **Required.** The source video, a public http(s) URL. |
> | `provider` | `"video-depth-anything" \| "depth-anything-frames"` | `"video-depth-anything"` | `video-depth-anything` is temporally consistent and takes every lever below; `depth-anything-frames` runs Depth Anything per frame (may flicker) and takes `modelSize` and `colormap` only. |
> | `modelSize` | `"small" \| "base" \| "large"` | `"large"` | Larger is more detailed and slower. |
> | `colormap` | `"grayscale" \| "turbo" \| "inferno" \| "magma" \| "viridis"` | `"grayscale"` | `depth-anything-frames` renders only `grayscale` / `inferno`; any other value becomes `grayscale`. |
> | `resolution` | `"auto" \| "360p" \| "480p" \| "720p" \| "1080p"` | `"auto"` | `video-depth-anything` only. |
> | `sideBySide` | `boolean` | `false` | `video-depth-anything` only: the original and the depth next to each other. |
>
> A lever the chosen provider does not take is ignored and a colormap it
> cannot render becomes `grayscale`, so switching providers never fails a
> request — but every value sent must still be one listed above (anything else
> is a `400 validation_error`). The clip is
> measured before any credits are reserved: too long answers `400
> video_too_long` (`video-depth-anything`: more than 2,400 frames or 300 s;
> `depth-anything-frames`: more than 80 s), a clip that cannot be read answers
> `400 video_unreadable`, and a provider this deployment has turned off
> answers `403 model_not_available` (an omitted `provider` is checked as the
> default) — nothing is reserved on any of them. The vocabularies are re-exported from
> `@nodaro/shared` as `VideoDepthProvider`, `VideoDepthModelSize`,
> `VideoDepthColormap` and `VideoDepthResolution`. Pricing is per input-clip
> length tier — see the [Video Depth node docs](nodes/processing-video/video-depth.md#credit-cost).
>
> ```ts
> const { videoUrl } = await client.nodes.runAndWait("video-depth", {
>   videoUrl: "https://cdn.example.com/clip.mp4",
>   colormap: "turbo",
>   resolution: "720p",
> })
> ```

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
> ("Auto"). One exception: `POST /v1/describe-to-picker` and its text twin
> `POST /v1/text-to-picker` run Claude Opus 5.5 at `"high"` when the field is
> omitted on that model — send another level to change it; any other model,
> their default Gemini 3.8 Flash included, keeps Auto (see
> [Describe to Picker](nodes/ai-image/describe-to-picker.md#credit-cost) for
> what that run costs). Effort has no price of its own: the call is charged for
> the tokens it used at the model's rate, so a higher effort costs more only
> through the reasoning it writes — and any effort on a Claude model runs the
> call on Anthropic's own API, at that lane's rate (see
> [Credit pricing](nodes/ai-text/llm-chat.md#credit-pricing) and
> [LLM model rates](pricing/llm-models.md)). Workflow/canvas LLM nodes carry the same
> field on their node `data` (`reasoningEffort?: LlmReasoningEffort`), and
> `client.promptHelper.*` accepts it directly in its request body.

> **Advanced mode.** The same routes accept `advancedMode: true` (Gemini and
> Claude models), which runs the request on the provider's own API rather than through
> the aggregator. That is the only lane where `temperature`, `maxTokens` and the
> full reasoning-effort range actually take effect — on the default lane those
> levers are not reliably honoured. The call is charged at that lane's rate
> (each model's rates for both lanes are in [LLM model rates](pricing/llm-models.md)). A model with no direct lane
> returns `400 advanced_mode_unsupported`.
> While the model's own provider is not taking requests, an Advanced-mode
> request answers `advanced_mode_unavailable` (400 up front, or 502 mid-call,
> refunded) instead of running on the default lane — turn Advanced mode off to
> run the model. Describe to Picker is the exception: a Claude run there that
> Claude's provider refuses falls back to Gemini 3.8 Flash, as it does with
> Advanced mode off (see
> [Describe to Picker](nodes/ai-image/describe-to-picker.md#credit-cost)); an
> installation with no Anthropic key of its own still answers
> `400 advanced_mode_unavailable`.
> Canvas LLM nodes carry the same field
> on their node `data` (`advancedMode?: boolean`), and the CLI exposes it as
> `--advanced`.
>
> `client.nodes.run(type, params)` posts each LLM-backed node type to its own
> route: `/v1/<type>` for `generate-script`, `image-critic`, `qa-check` and
> `describe-to-picker`, and the nested route for the others (`llm-chat` →
> `/v1/llm-chat/generate`, `image-to-text` → `/v1/image-to-text/describe`,
> `video-composer` → `/v1/scene-graph/generate`, … — see
> [`run`](#runtype-params)). `client.promptHelper.*` takes the same field for
> any node type (always `/v1/prompt-helper/wizard`).
>
> ```ts
> // client.nodes.run() posts generate-script to /v1/generate-script and
> // llm-chat to /v1/llm-chat/generate.
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
> `generate-image`, `image-to-image`, `edit-image`, `split-image`,
> `generate-mask`, `generate-video`, `text-to-video`, `video-to-video`,
> `video-upscale`, `text-to-speech`, `assemble-narrated-video`,
> `social-search`, `video-depth` and the 3D scene nodes are currently the only
> ones with dedicated typed params.

`video-to-video` takes `VideoToVideoParams`: `videoUrl` (required), `prompt`,
`provider` (`wan`, `wan-flash`, `wan-videoedit`, `luma-modify`, `runway-aleph`,
`happyhorse-edit` or the Seedance edit model `seedance-2-5`), `duration`
(`"5"` | `"10"`), `resolution`, `audio`, `multiShots`, `aspectRatio`, `seed`,
`referenceImageUrl`, `negativePrompt`, `videoEditDuration`, `audioSetting`,
`promptExtend`, `draft`, plus `sessionId` / `origin`. A `seedance-2-5` edit also takes
`referenceImageUrls`, `referenceVideoUrls` (extra clips; the source `videoUrl` is
`{video:1}`, these are `{video:2}`, …) and `referenceAudioUrls` — refused on any
other model; numbering and caps in [Video to Video → Seedance 2.5 Edit](nodes/ai-video/video-to-video.md#seedance-25-edit).
The edit is built server-side (see [Video to Video → Seedance 2.5 Edit](nodes/ai-video/video-to-video.md#seedance-25-edit)),
so you send the same body as for any other edit model.

#### `quote(type, params?)`

```ts
quote(type: string, params?: Record<string, unknown>): Promise<NodeQuote>
```

The price of a run before you start it (`POST /v1/quote`). Pass exactly the
body you would pass to `run`: the platform prices it with the run route's own
code — validation, measuring reference clips, the credit id and the amount — and
starts nothing. Typed for `text-to-video`, `generate-video`,
`video-to-video` and `video-upscale` (a Seedance 2.5 draft's 1080p finalize is
priced from the draft); those are the types the platform can quote today (any other
rejects with `400 quote_unsupported`). Cloud only.

```ts
const q = await client.nodes.quote("video-to-video", {
  videoUrl, prompt: "make it black and white", provider: "seedance-2-5", resolution: "480p",
})
q.reserve   // credits held when the run starts
q.expected  // what it should actually cost (the run settles to what it rendered), when known
```

`NodeQuote` is `{ identifier, reserve, expected?, adjustments, warnings }` —
see [Run quotes](api-integration.md#run-quotes) for every field and code.

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

On an image job, `NodeJobOutput` carries the image's pixel size, so a client can
lay out a grid before the images load:

| Field | Type | Description |
|-------|------|-------------|
| `imageUrl` | `string` | The image (the first, when the job made several). |
| `imageUrls` | `readonly string[]` | Every image, when the job made more than one. |
| `width`, `height` | `number` | Pixel size of `imageUrl` as stored — what you download, a free-tier watermark included — with EXIF orientation applied. |
| `images` | `readonly JobOutputImage[]` | Beside `imageUrls`, index-aligned: `{ url, width?, height? }` per image. An entry with no `width` / `height` could not be measured. |

All four size fields are optional: present on image jobs completed after this
release, absent on older jobs and wherever the server could not read the size
(it never guesses one).

**`RunAndWaitOptions`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `signal` | `AbortSignal` | — | Abort the poll loop; rejects with `JobAbortedError` (its `jobId` names the job once submitted). Aborting stops the **waiting** only — the job keeps running and is charged unless `cancelOnAbort` is set. |
| `cancelOnAbort` | `boolean` | `false` | Also cancel the submitted job when `signal` aborts (`POST /v1/jobs/:id/cancel`, which refunds its hold — except a metered LLM job whose call has started: it answers `inFlight: true`, finishes, and is charged what it used). Best effort: a failed cancel still rejects with the `JobAbortedError`. |
| `onProgress` | `(status: JobStatusResult) => void` | — | Called with each lean status observed. |
| `pollMs` | `number` | `2000` | Poll interval in ms. |
| `maxMs` | `number` | `900_000` | Wall-clock cap before `JobTimeoutError`. |
| `idempotencyKey` | `string` | — | `Idempotency-Key` for the submit. Reuse it when retrying a call that timed out, so the run is not started or charged twice. |

Throws (all typed, catchable by `instanceof`):
- `NodaroError` with `code = "batch_requires_run_batch_and_wait"` — a
  `generate-image` request with `count` above 1 or `models` makes several jobs;
  `runAndWait` waits for one, so it refuses before anything is submitted. Use
  [`runBatchAndWait()`](#runbatchandwaittype-params-opts).
- `InsufficientCreditsError` / `StorageExceededError` — surfaced by `run()` before any poll.
- `JobFailedError` — terminal `failed`/`cancelled` (carries `error_message` + `jobId`).
- `JobTimeoutError` — `maxMs` deadline exceeded.
- `JobAbortedError` — `signal` fired. The job itself keeps running unless `cancelOnAbort` is set; to stop it later, `jobs.cancel(err.jobId)`.
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
  provider: "nano-banana-pro",
})
console.log(output.imageUrl, output.width, output.height)

// Several images: one tile per entry, sized before it loads.
for (const image of output.images ?? []) {
  console.log(image.url, image.width ?? "?", image.height ?? "?")
}
```

**Social Search** (`social-search`, Nodaro Cloud) is typed end to end: the
params are `SocialSearchParams` and the resolved output is
`SocialSearchJobOutput` — every post the search found (`json`, an array of
`SocialPost`), plus `platform`, `mode`, `query` and any `warnings`. Priced
per page of 20 results (20 / 40 / 60).

```ts
const found = await client.nodes.runAndWait("social-search", {
  platform: "youtube",
  query: "product demo",
  count: 20,
  period: "month",
  sort: "popular",
})
for (const post of found.json) {
  console.log(post.url, post.metrics.views, post.author.handle)
}
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
An entry that is itself a batch (`count` above 1 or `models`) is refused before
anything is submitted, as in `runAndWait()`.

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

#### `runBatchAndWait(type, params, opts?)`

```ts
runBatchAndWait(
  type: "generate-image",
  params: GenerateImageParams,
  opts?: RunAndWaitOptions,
): Promise<GenerateImageBatchOutput>
```

Several images in ONE call — `count` (1–4 images, each its own job) and/or
`models` (the same request on 2–4 image models, instead of `provider`; with
`count`, per model, at most 8 images) — run to the end. It submits once (with
`opts.idempotencyKey` if given: image *i* is then keyed `<key>:<i>`, so a retry
returns the same jobs and charges nothing again), then waits for every job at
once, each the way `runAndWait()` waits. See [API integration § 4g](./api-integration.md#4g-several-images-in-one-call-count-models)
for the rules (credits for the batch as a whole or not at all, `seed + i`, the
batch id). A `presetId` combines with both: N images of the preset's request,
or the preset applied once per model.

Resolves `{ batch, results }`:

- `batch` — the submit's answer, `GenerateImageBatchResult`: `jobId` (the
  first), `jobIds` (model by model, then image by image), `batchId`, `groups`
  (`{ model, jobIds, credits?, adjustments? }` per model) and `totalCredits?`.
  `nodes.run("generate-image", …)` answers the same object, typed, when the
  params literally set `count` above 1 or `models`.
- `results` — one `BatchJobOutcome` per job, in `batch.jobIds` order:
  `{ jobId, model, status: "completed", output }` or
  `{ jobId, model, status: "error", error }`, where `error` is the typed
  `JobFailedError` / `JobHeldError` / `JobTimeoutError` that ended the wait.
  One image failing never discards the others.

Rejects only before any job exists — the submit's own errors, e.g.
`InsufficientCreditsError` with the batch's total as `required` — and on
`signal` (`JobAbortedError`; `cancelOnAbort` cancels every job). A request for
one image is refused before anything is sent (`code = "not_a_batch"`): wait for
it with `runAndWait()`.

```ts
const { batch, results } = await client.nodes.runBatchAndWait(
  "generate-image",
  { prompt: "a lighthouse at dusk", models: ["gpt-image-2", "flux-2-max"], count: 2, seed: 41 },
  { idempotencyKey: crypto.randomUUID() },
)
console.log(batch.batchId, batch.totalCredits)
for (const r of results) {
  if (r.status === "completed") console.log(r.model, r.output.imageUrl)
  else console.warn(r.model, r.jobId, r.error.message)
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
`durations`), per-variant credit `pricing` — the credits a run is charged
(Cloud only — editions without a credit system omit the field), compact
`promptTips`, and the
`doctrineCovered` truth flag — `true` only when a sourced per-family prompt
doctrine exists for the model, so "vendor doctrine" badges can never
overclaim. The same projection the MCP `list_models` tool serves, so the two
surfaces cannot drift. Public endpoint; cached 5 minutes.

Each `ModelSummary` names its maker and carries the maker's mark (both absent
on an older server):

- `maker?: ModelMaker` — `{ id, name }`, the company that made the model. `id`
  is stable (one per company: `"google"`, `"black-forest-labs"`), so you can
  key your own assets on it; a newer server can add makers, so handle an id
  you do not know. It is not always the `family` the model is grouped under
  (Tongyi-MAI and HappyHorse are Alibaba's, Depth Anything is ByteDance's).
- `logoUrl?: string | null` — the maker's official mark (an SVG) on the
  instance's own media CDN, or `null` when the instance does not publish one
  for that maker: draw a fallback (the maker's name or initial) then. Use the
  address as given; it carries its file's version, so a replaced mark arrives
  under a new address. The MCP tool omits it.

```ts
const catalog = await client.models.list({ kind: "video", mode: "i2v" })
for (const section of catalog.sections)
  for (const family of section.families)
    for (const m of family.models)
      console.log(m.id, m.maker?.name ?? family.family, m.logoUrl ?? "(no mark)", m.doctrineCovered)
```

---

### `client.characters`

Script the full character lifecycle — identity edits, portrait + asset
generation, motion clips, LLM-captioned approval, and (Nodaro Cloud)
[high-fidelity training](#character-training).

A "character" is the canonical identity row that Character Studio drives
(`characters` table). Each row carries the portrait URL, six asset buckets
(`expressions`, `poses`, `motions`, `angles`, `bodyAngles`,
`lightingVariations`), reference photos, and the LLM caption that anchors
identity in downstream prompts.

#### `list(params?)`

```ts
list(params?: ListCharactersParams): Promise<ListCharactersResult>   // { characters, nextCursor }
```

Lists the caller's characters. By default returns active characters only;
pass `archived: true` for an "archive" view. `projectId` further restricts
to a single project. `limit` caps the result (server default 100, max 500).

`q` searches by words: only the characters whose **name or description**
contains every word of it (split on spaces, the first 5), in any order,
ignoring case — `"red car"` finds "Car, red". Every character of a word is
matched as itself (`%`, `_` and `*` are not wildcards; punctuation is kept),
a blank `q` is no search, and it is capped at 200 characters. It combines
with the other filters and with paging — send the same `q` with each
`cursor`. The full rule is in the REST reference ([Search](api-integration.md#search-q)).

```ts
const { characters } = await client.characters.list({ q: "maya pilot", limit: 20 })
```

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

#### `get(id, options?)`

```ts
get(id: string, options?: { candidates?: "alternates" | "all" }): Promise<CharacterDetail>
```

Fetches a single character + three live-progress buckets
(`pendingJobs`, `portraitCandidates`, `previousCandidates`) the studio uses
to rehydrate spinners after a reload. `{ candidates: "all" }` also returns
the current portrait's own take in `previousCandidates`, flagged
`isPortrait: true`; by default it is left out. The flagged take is absent
when its job is older than 7 days or the portrait was not generated by a
job — fall back to `sourceImageUrl` for the picture.

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
to pick a candidate. Pass `attachPortrait: false` to keep every take a
candidate: it completes and lists like any other, but only `approvePortrait()`
sets the portrait.

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

#### Character training

**Nodaro Cloud only** — on other editions these routes do not exist, and each
call throws `NotFoundError` ("Route … not found"). A training builds a
high-fidelity model of the character from its own images; a workflow's Generate
Image node whose prompt @-mentions that one character then runs on it (see
[Character Training](./features/character-training.md)). Each training reserves
**1,650 credits**<!-- credits: character-lora-training -->, takes about 15
minutes, and is refunded if it fails or is cancelled. With an OAuth app token,
`train` and `deleteLora` need the `assets:write` scope (like creating or
deleting the character) and throw `ForbiddenError` (`missingScope:
"assets:write"`) without it; `trainingStatus` needs none, like the character
reads. A session or a personal API key needs no scope.

#### `train(id, input?)`

```ts
train(id: string, input?: TrainCharacterInput): Promise<TrainCharacterResult>
```

Starts a training and resolves at once (HTTP 202) with `{ jobId, trainingId,
triggerWord }`. It trains on every eligible image — the portrait, reference
photos, expressions, poses, head and body angles and lighting variations,
de-duplicated, at most 20 — unless `selectedImageUrls` names a subset (max 200
URLs; empty means all). At least 4 distinct images must remain. Rate-limited to
3 calls a minute; re-training a trained character costs the full price again.

Refusals beyond the typed classes (`ForbiddenError` for a missing scope,
`InsufficientCreditsError`, `RateLimitedError`, `JobBlockedError`, …) are
`NodaroError`s whose `code` is a `TrainCharacterRefusalCode`:

| `code` | Status | Meaning |
|--------|--------|---------|
| `insufficient_training_images` | 400 | Fewer than 4 distinct images; `message` says how many there are. |
| `validation_error` | 400 | A malformed id or `selectedImageUrls`. |
| `already_training_or_not_found` | 409 | A training of this character is in flight — or the character is not yours, or is archived. |
| `claim_failed` | 500 | The training slot could not be claimed; nothing started. Retry. |
| `training_dispatch_failed` | 502 | The training could not be started; the reservation is refunded. The status reads `untrained` afterwards. |
| `public_url_not_configured` | 503 | The deployment cannot receive the provider's completion call. |
| `price_not_configured` | 503 | The deployment has no price for a training. |
| `dedup_race_winner_unresolvable` | 503 | A duplicate of this request was in flight and its outcome could not be read; this one reserved nothing — read `trainingStatus` before retrying. |

```ts
import { NodaroError } from "@nodaro/sdk"

try {
  const { jobId, triggerWord } = await client.characters.train(characterId)
} catch (err) {
  if (err instanceof NodaroError && err.code === "insufficient_training_images") {
    // err.message: "Need at least 4 reference photos to train (have 2). …"
  } else throw err
}
```

#### `trainingStatus(id)`

```ts
trainingStatus(id: string): Promise<CharacterTrainingStatus>
```

Where the character's training stands. `status` is `untrained` (never trained,
the model was removed, or a training could not be started —
`training_dispatch_failed` resets it, even for a character trained before),
`queued` / `training` (in flight), or `succeeded` / `failed` / `cancelled`.
Generation uses the trained model **only while `status` is `succeeded`**.
`error` says why a training failed; `trainedAt` and `version` belong to the last
successful training and stay set through a re-train, a failed or cancelled one,
or one that could not be started — the model is not used in any of those
states; `triggerWord` is added to prompts for you; `imageCount` is how many
images the latest training used. `NotFoundError` for a character that is not
yours or is archived.

There is no wait helper — poll while the status is in flight (every 10 s or so).
The training's job (`jobId` from `train`) also ends `completed`, `failed` or
`cancelled` with it, if you would rather follow `jobs.getStatus(jobId)`.

```ts
let training = await client.characters.trainingStatus(characterId)
while (training.status === "queued" || training.status === "training") {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  training = await client.characters.trainingStatus(characterId)
}
if (training.status !== "succeeded") console.warn(training.status, training.error)
```

#### `deleteLora(id)`

```ts
deleteLora(id: string): Promise<void>
```

Removes the character's trained model: cancels a training in flight (its
reservation is refunded), deletes the model, and clears the record —
`trainingStatus` then reads `untrained`, and generations go back to reference
images. It cannot be undone: a new model is a new, paid training.
`ForbiddenError` for an OAuth app token without `assets:write`;
`NotFoundError` for a character that is not yours or is archived.

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
pass `archived: true` for an "archive" view. `q` keeps the locations whose
name or description contains every word of it — the same word search as
`characters.list()`.

Pagination is **opt-in**: without `limit` you get the full legacy listing
and no `nextCursor`; with `limit` (max 500) you get one page plus a
`nextCursor` to pass back as `cursor` — loop until it is `null`, the same
pattern as `characters.list()`.

```ts
const { locations } = await client.locations.list()
const { locations: archived } = await client.locations.list({ archived: true })
const { locations: cafes } = await client.locations.list({ q: "café" })
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
result to a single project, and `q` keeps the objects whose name or
description contains every word of it — the same word search as
`characters.list()`.

Pagination is **opt-in**: without `limit` you get the full legacy listing
and no `nextCursor`; with `limit` (max 500) you get one page plus a
`nextCursor` to pass back as `cursor` — loop until it is `null`, the same
pattern as `characters.list()`. Applies to `creatures.list()` identically,
`q` included.

```ts
const { objects } = await client.objects.list()
const { objects: archived } = await client.objects.list({ archived: true })
const { objects: cars } = await client.objects.list({ q: "red car" })
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

#### `list(params?)`

```ts
list(params?: ListCreaturesParams): Promise<{ creatures: Creature[]; nextCursor?: string | null }>
```

Lists the caller's creatures — the same parameters as `objects.list()`:
`archived: true` for the archive, `projectId` for one project, `q` for the
creatures whose name or description contains every word of it (the word
search of `characters.list()`), and opt-in paging with `limit` + `cursor`.

```ts
const { creatures } = await client.creatures.list({ q: "dragon" })
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
`approveStage()` / `approveSubGate()` / `acceptMatchCutBreak()`. Requires
`pipelines:execute` scope.

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
approveSubGate(id: string, gate: AnimateSubGate): Promise<{ ok: true; gate: AnimateSubGate; resumed_at: string }>
```

Approve a Stage 7 (`animate_audio_edit`) sub-gate — `silent_cut_preview` or
`dialogue_recheck` (`AnimateSubGate`, the values are `ANIMATE_SUB_GATES` in
`@nodaro/shared`) — so the orchestrator resumes from the next sub-step.
Stage 6's `match_cut_break_pending` is not approved here: the route answers
400 `invalid_sub_gate`, and each break is accepted with
`acceptMatchCutBreak()`. Requires `pipelines:approve`.

```ts
await client.pipelines.approveSubGate(id, "dialogue_recheck")
```

#### `acceptMatchCutBreak(id, sceneId, shotId)`

```ts
acceptMatchCutBreak(id: string, sceneId: string, shotId: string): Promise<{ ok: true; pendingRemaining: number }>
```

Accept one match-cut break that Stage 6 (`scene_images`) flagged. While any
break is pending, the stage pauses at the `match_cut_break_pending` sub-gate,
and its output (`getStage(id, "scene_images")`) lists the pending shot ids
under `match_cut_break_pending`. `sceneId` is the scene entity that holds the
shot. Accepting the last break resumes the stage; `pendingRemaining` says how
many are left. Requires `pipelines:approve`.

```ts
await client.pipelines.acceptMatchCutBreak(id, sceneId, "shot-2")
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
| `pick-best-llm` | `{ criteria: string, inputKind?: "text" \| "image-url", llmModel?: string }` — `llmModel` picks the judge model; the judge's call is charged per token at that model's rate, ~6 credits<!-- credits: reduce:pick-best-llm:claude-sonnet-5.5 --> typical on the default Claude Sonnet 5.5 ([LLM model rates](./pricing/llm-models.md)) |
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
[API Integration §12](./api-integration.md#15-prompt-wizard)). Each call
is charged for the tokens it used at the model's rate (~4 credits<!-- credits: prompt-helper:gemini-3.6-flash --> typical on
the default Gemini 3.6 Flash; [LLM model rates](pricing/llm-models.md)).

All three inputs also accept optional `llmModel`, `reasoningEffort`, `advancedMode`, `temperature` and `maxTokens` fields
(the latter is model-dependent — unsupported or omitted levels fall back to
the vendor default). Both are forwarded to the underlying LLM call and affect
the charge only through the tokens the call uses and the lane it runs on — see
[Credit pricing](nodes/ai-text/llm-chat.md#credit-pricing). The CLI
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

Each app's `estimatedCredits` is its listed price per run. When its price
follows the length of the recording the app is given (an Edit Plan pass, the
render of a whole episode), `perMinuteCredits` is above 0: the price is then
`estimatedCredits` plus `perMinuteCredits` per minute of the recording (both
optional on `PublishedApp`). When the app has a list input its user fills,
`perItemCredits` is above 0: each item beyond the creator's saved items adds
that many credits.

The listed price is a range when a choice the app's user has can cost more:
`maxEstimatedCredits` (with `maxPerMinuteCredits` and `maxPerItemCredits`) is
the most a run can cost over the app's exposed fields, at the creator's
restricted values where set; `estimatedCredits` and its parts are the saved
settings — "from". The `max*` fields are present only when they differ, and are
absent on an app published before the range existed until its next publish.
Templates carry `maxEstimatedCredits` / `maxEstimatedPerMinuteCredits` the same
way. `estimatedCreditsIsEstimate: true` (apps, templates, tutorials) marks a
listed price that holds a metered LLM call's estimate — charged its actual usage
per token — so show it `~N`; it is absent for a fixed price.

```ts
const { data, nextCursor } = await client.apps.list({ search: "headshot", limit: 20 })
```

#### `get(slug)`

```ts
get(slug: string): Promise<{ data: PublishedAppDetail }>
```

Fetches one app's metadata plus its `inputSchema` (the fields end users fill
in) and `outputs` mapping. `runEstimatedCredits`, `runPerMinuteCredits` and
`runPerItemCredits` price the app run alone: the listed price less its
[Render final](./app-view-modes.md#render-final) part, which runs and is
charged separately (all optional; absent from an older server).
`editPlanPerMinute` says whether this server charges an Edit Plan node per
started minute of the recording (`true`) or in 15/30/60/90/120/180-minute steps
(`false`, or absent on an older server).

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

An app that takes a video link (an exposed
[Video URL](./nodes/input/youtube-video.md) node) is run with the link as the
input, for example `client.apps.run("clip-pack", { episode: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })`.
The server downloads a post link itself before the first node runs (a YouTube
video of 4 minutes or more only as a part named with `opts.inputOverrides`);
any other web link is used as it is. See
[Video URL inputs](./embed-app-guide.md#video-url-inputs).

`opts.inputOverrides` is the advanced escape hatch: nested
`{ nodeId: { field: value } }` raw node data for THIS run, which reaches fields
the app does not expose to its end users — such as
[`promptPrefix` / `promptSuffix`](./prompt-pre-post-text.md). It cannot set a
destination on an outbound node (a Webhook Output's `url`, a publisher's
account, a scraper's target) — that is rejected with `400 locked_field`; see
[API integration](./api-integration.md).

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

#### `resume(slug, runId, opts?)`

```ts
resume(slug: string, runId: string, opts: { dryRun: true; version?: number }): Promise<{ data: AppRunResumePlan }>
resume(slug: string, runId: string, opts?: { dryRun?: false; version?: number }): Promise<AppRunResumeResult>
```

Retries a **failed** run from where it stopped — the app page's **Retry**. Only
the steps the run did not complete run, and only those are charged; every step
it completed hands on its result, and a
[UGC Clip](./nodes/ai-video/ugc-clip.md) that failed renders only the clips it
did not finish. The Retry runs the app version the run ran, with the inputs the
run applied: it takes none of its own. The run's execution moves to the
Retry's, so `getRun` then shows it, and a Retry of a Retry continues from what
the latest one completed. A second call made while that Retry is pending is
refused with `already_running` (an `AlreadyRunningError` naming its
execution); only a concurrent double press reaches the same Retry, answered
with `deduped: true`.

- `opts.dryRun` — answer what the Retry would do and start nothing:
  `{ data: AppRunResumePlan }` with `runId`, `continuesExecutionId`,
  `appVersion`, `nodeIds`, `steps` (`{ nodeId, type, label }` — the steps that
  run again), `estimatedCredits` (what it is expected to charge, the creator's
  fee on the app included; `null` without credits), `reusedClips` (clips handed
  back at no cost), `sufficient` (whether your balance and your app credits
  cover it), `available`, and `appCreditsAllowance` — present only when your
  app credits are what stops it (the Retry would be refused
  `insufficient_app_credits`). Show it before a Retry.
- `opts.version` — the app version you expect it to run, the one starting over
  would run (default: the app's latest).

Without `dryRun` it returns `AppRunResumeResult`:
`{ executionId, runId, status: "pending", nodeIds, deduped? }` — poll via
`client.executions.get(executionId)`.

Refusals (nothing is written or billed) carry a code from
`AppRunResumeRefusalCode`:

| `code` | Thrown as | When |
|---|---|---|
| `not_found` | `NotFoundError` | no such run of yours under this app |
| `continuation_not_found` | `NotFoundError` (its `code` reads `not_found`) | the run's execution is not yours |
| `validation_error` | `NodaroError` (400) | a malformed run id or body, or a component's run (it is continued by the run that called it) |
| `app_run_version_unavailable` | `NodaroError` (409) | the version the run ran is gone: start the run over |
| `app_run_version_changed` | `AppRunVersionChangedError` | the app is on another version than the run ran: start over, or send `version: err.runVersion` |
| `continuation_workflow_mismatch` / `continuation_version_mismatch` | `NodaroError` (400) | the run's execution ran another workflow, or another version of it (rare): start the run over |
| `continuation_not_failed` | `NodaroError` (409) | the run completed or was stopped: start it over |
| `already_running` | `AlreadyRunningError` (409, `executionId`) | the run is still running, or a Retry of it is pending: follow `executionId`. Started again elsewhere meanwhile: a plain `NodaroError` |
| `continuation_subset_required` | `NodaroError` (409, or 400) | nothing is left to retry: every step completed (409), or the app runs no step (400) |
| `locked_field` | `NodaroError` (400) | an input the run applied sets a field the app does not let a runner set |
| `preview_review_required` | `NodaroError` (400) | the Retry would stop at a Preview with nobody to review it: retry it from the app page, where a person can review it |
| `insufficient_app_credits` / `insufficient_credits` | `InsufficientCreditsError` (its `code` says which) | your app credits, or balance, cannot cover it |
| `billing_unavailable` | `NodaroError` (503) | billing is briefly unavailable for a workspace run: try again shortly |

To run with other inputs or on the app's current version, start the run over
with `run(slug, inputs)` instead: every step runs, and is charged, again. See
[Retry of a failed app run](./api-integration.md#retry-of-a-failed-app-run).

```ts
import { AppRunVersionChangedError } from "@nodaro/sdk/errors"

const { data: plan } = await client.apps.resume("pro-headshot", runId, { dryRun: true })
console.log(`${plan.steps.length} step(s) again, about ${plan.estimatedCredits} credits`)

try {
  const { executionId } = await client.apps.resume("pro-headshot", runId)
} catch (err) {
  if (err instanceof AppRunVersionChangedError && err.runVersion !== undefined) {
    // Continue on the run's own version anyway (or start over with apps.run).
    await client.apps.resume("pro-headshot", runId, { version: err.runVersion })
  }
}
```

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

Each entry carries `kind`: `"user"` is an app you registered yourself; the
other values (`"dynamic_mcp"`, `"first_party_mcp"`, `"community_instance"`)
are clients that registered themselves. Only `"user"` entries count toward
the five-apps-per-user cap; `create()` answers `400 limit_reached` past it.

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

#### `getAppInfo(clientId, redirectUri?)`

```ts
getAppInfo(clientId: string, redirectUri?: string): Promise<OAuthAppInfo>
```

Fetches public metadata about a developer app for rendering a consent screen.
Public route — no auth needed.

```ts
const info = await client.oauth.getAppInfo("app_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d")
// { name, description, logoUrl, homepageUrl, scopesRequested, kind, redirectUriRegistered: null }

const checked = await client.oauth.getAppInfo(clientId, "https://yourapp.com/oauth/callback")
// checked.redirectUriRegistered is true only for an exactly registered URI
```

### `client.webhooks`

Outbound webhooks: register an https endpoint and Nodaro POSTs it every
`job.completed` / `job.failed` of your account, signed with the endpoint's
own secret, retried with backoff for about 43 hours, every attempt kept in
its delivery log. OAuth app tokens need `jobs:read`; an endpoint a connected
app registers receives only the jobs that app submitted itself. Events,
body, headers, the retry schedule and the rules: [Webhooks](./webhooks.md).

```ts
create(input: CreateWebhookEndpointInput): Promise<CreatedWebhookEndpoint>      // { data, secret }
list(): Promise<{ data: WebhookEndpoint[] }>
get(id: string): Promise<{ data: WebhookEndpoint }>
update(id: string, input: UpdateWebhookEndpointInput): Promise<{ data: WebhookEndpoint }>
delete(id: string): Promise<{ success: true }>
rotateSecret(id: string, input?: RotateWebhookSecretInput): Promise<RotatedWebhookSecret>   // { secret, previousSecretExpiresAt }
deliveries(id: string, params?: ListWebhookDeliveriesParams): Promise<WebhookDeliveryPage>
getDelivery(id: string, deliveryId: string): Promise<{ data: WebhookDelivery }>
test(id: string): Promise<{ data: WebhookDelivery }>
```

#### `create(input)`

`input`: `url` (https on a public host — no `localhost`, private address or
private-network name; use a tunnel to test locally), `events?`
(`"job.completed"` and/or `"job.failed"`, default both), `description?` (up
to 500 characters, one line). Returns the endpoint and its `secret`
(`whsec_…`) — **shown this once**, store it now. One endpoint per address
(`409 url_taken`); at most 10 endpoints per account (`400 limit_reached`).

```ts
const { data: endpoint, secret } = await client.webhooks.create({
  url: "https://example.com/nodaro-webhook",
  events: ["job.completed", "job.failed"],
})
```

#### `update(id, input)`

Any of `url`, `events`, `description` (`null` clears it) and `isActive`.
`isActive: true` also clears an automatic switch-off (`disabledReason:
"consecutive_failures"`, after 50 deliveries in a row failed for good) and
resets `consecutiveFailures`; it answers `409 secret_required` for an
endpoint that predates signing until its secret is rotated.

#### `rotateSecret(id, input?)`

A new secret, returned this once. It signs every delivery from now on
(retries included); the secret it replaces keeps signing beside it — a
second `v1=` in `Nodaro-Signature`, which `verifyWebhookSignature` accepts —
for `input.gracePeriodSeconds` (0–604800, default a day), so you can update
your receiver without a gap. `{ gracePeriodSeconds: 0 }` ends the old secret
at once (one that leaked). Returns `{ secret, previousSecretExpiresAt }`
(`null` when the old secret stopped at once); the endpoint shows the same
`previousSecretExpiresAt` until then.

```ts
const { secret, previousSecretExpiresAt } = await client.webhooks.rotateSecret(endpoint.id)
```

#### `deliveries(id, params?)`

The delivery log, newest first, kept 30 days. `params`: `status?`
(`"pending" | "delivered" | "failed"`), `limit?` (1–100, default 20),
`cursor?` (the previous page's `next`). Each `WebhookDelivery` carries
`event`, `jobId`, `status`, `attempts`, `responseStatus`, `responseBody`
(first 2 KB), `durationMs`, `error`, `requestBody` (the exact body sent;
`null` once delivered), `nextAttemptAt`, `deliveredAt`.

#### `getDelivery(id, deliveryId)`

One delivery of the endpoint's log, by its id.

#### `test(id)`

Queues a `ping` — sent within seconds and tried once, even to an endpoint
that is switched off — and returns its delivery; follow it with
`getDelivery(id, delivery.id)`.

#### `verifyWebhookSignature(options)`

A top-level export (not on `client`) for the receiving side. Pure Web Crypto:
Node 20+, Deno, Bun, Cloudflare Workers, Vercel Edge, browsers.

```ts
verifyWebhookSignature(options: {
  payload: string | Uint8Array | ArrayBuffer   // the raw body, as received
  header: string | readonly string[] | null | undefined   // Nodaro-Signature
  secret: string                               // whsec_…
  toleranceSeconds?: number                    // default 300; 0 turns the check off; anything not finite ≥ 0 throws RangeError
}): Promise<WebhookEvent>
```

Returns the parsed event (`JobWebhookEvent` — `data.job` is a `Job` — or
`PingWebhookEvent`). Throws `WebhookSignatureError`, whose `code` is
`"missing_header"`, `"malformed_header"`, `"signature_mismatch"`,
`"timestamp_outside_tolerance"`, `"invalid_payload"`, `"missing_secret"` or
`"crypto_unavailable"`. The comparison is constant-time.

```ts
import { verifyWebhookSignature, WebhookSignatureError } from "@nodaro/sdk"

export async function POST(request: Request) {
  try {
    const event = await verifyWebhookSignature({
      payload: await request.text(),
      header: request.headers.get("nodaro-signature"),
      secret: process.env.NODARO_WEBHOOK_SECRET!,
    })
    if (event.type === "job.completed") await saveResult(event.data.job)
    return new Response(null, { status: 204 })
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response(err.code, { status: 400 })
    throw err
  }
}
```

---

### `client.voices`

ElevenLabs voices: the premade catalog, the community Voice Library, the
signed-in user's existing voice clones (list / delete), and the **voice changer** —
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
  (`elevenlabs-v4` when the voice is verified for the base model `eleven_v4`,
  then `elevenlabs-v3`, which renders any voice unmodified, then
  `elevenlabs-v4-turbo` when it is verified for the exact id `eleven_v4_turbo`,
  then the cheapest v2 model: `elevenlabs-turbo` preferred, else
  `elevenlabs-multilingual`). Only those two exact ids count in the v4 family:
  a voice verified only for `eleven_v4_turbo` is recommended on
  `elevenlabs-v4-turbo`, not on `elevenlabs-v4`; the other `eleven_v4_…`
  variants (`eleven_v4_hq`, `eleven_v4_exp`, …) are not models of ours and
  count toward nothing. Apps without a provider picker should send it
  as the `provider` when generating speech with this voice, so the voice
  renders on a model it's verified for (that's what keeps generation
  sounding like the library preview).
- `verifiedProviders` — every provider the voice is verified on, in the
  order v4 → v3 → v4 Turbo → turbo → multilingual (`recommendedProvider` is its
  first entry). Apps WITH a provider picker should only override the user's
  choice when it is **not** in this set. Switch on membership, not on a closed
  list of values: a speech model added later joins the set the release it
  ships.

Both hints only name models the deployment offers. On a deployment that does
not offer `elevenlabs-v4` (a curated model list, or a model an admin has
withheld), a voice verified for v4 and v3 recommends `elevenlabs-v3`. A voice
verified only for models the deployment does not offer carries neither field,
the same as a voice with no model metadata: keep the user's current provider.

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

#### `createClone(input)` / `createCloneFromFile(input)` — retired

Voice cloning is no longer offered on Nodaro. Both methods remain on the
client for source compatibility but are `@deprecated`: the routes answer
`410` with `error.code = "voice_cloning_retired"` and the call rejects with
that error. Clones created before the retirement still appear in `listClones()`
and still work as voice ids everywhere a voice is accepted. For a new custom
voice, use `design(input)` below.

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
      engine?: "sts" | "v3" | "v4" // "sts" (default) = speech-to-speech recast; "v3" / "v4" = Re-speak —
                                  // the performance is REGENERATED from the transcript ([audio tags]
                                  // supported). v3 (eleven_v3): stability 0/0.5/1 only; similarityBoost/
                                  // style/useSpeakerBoost ignored. v4 (eleven_v4): any stability 0–1,
                                  // similarityBoost honoured (style/useSpeakerBoost ignored), each line
                                  // generated with its neighbouring lines as context. A Re-speak speaker
                                  // needs transcript text: pass an analysis whose segments[].text carries
                                  // it, or omit analysis and the engine re-speaks from its own
                                  // transcription. A Re-speak speaker is priced by the characters it
                                  // re-speaks — on its engine's Text to Speech rate (per started 100
                                  // characters) where length pricing is on, else per started 1,000.
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
  provider?: "elevenlabs-dialogue" | "elevenlabs-dialogue-v4"  // v3 (default) or v4
  stability?: number                                 // v3: exactly 0, 0.5 or 1; v4: any 0–1
  similarityBoost?: number                           // v4 only (v3 ignores it), 0–1
  languageCode?: string                              // ISO 639-1 hint, auto-detected when omitted
  seed?: number                                      // 0–4294967295; omit for random
  applyTextNormalization?: "auto" | "on" | "off"
}): Promise<{ jobId: string }>
```

Voice a multi-speaker script as ONE audio file (`POST /v1/text-to-dialogue`)
on ElevenLabs Dialogue v3 — the default — or Dialogue v4
(`provider: "elevenlabs-dialogue-v4"`, which also takes any 0–1 `stability`
and a `similarityBoost`). Each line's `voice` is a premade voice name or an
ElevenLabs voice UUID — cloned and Voice Library voices work, mixed casts are
fine, and line text may carry `[audio tags]` like `[laughs]`. At most 5,000
characters total across lines on Dialogue v3 and 10,000 on Dialogue v4 (under
2,000 recommended for best quality) and 10 unique voices per generation. Flat credits per request
under the chosen model's identifier. Poll `jobs.get(jobId)` for
`output_data.audioUrl` and — on every dialogue model, since both return timings
at no extra credits — `output_data.transcript`, a `Transcript`
(`@nodaro/shared`): `words[]` with `startMs` / `endMs` / `speaker` and one
`segments[]` entry per line, `speaker` being the line's `voice` as you sent it.
Pass `transcript.words` to `addCaptions({ captions, autoTranscribe: false })` to
caption the dialogue without a second transcription.

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
  requireAudio?: boolean
}): Promise<{ downloadId: string }>
```

Download a social video (YouTube / TikTok / Instagram / X / Facebook) into your
storage (`POST /v1/download-video`). `maxHeight` caps the resolution (omit for
best available); `sectionStartSec` + `sectionEndSec` (both-or-neither) fetch
only that time range. A download that arrives with no audio stream fails by
default — it is usually a degraded source response, and is retried through
other routes first; pass `requireAudio: false` to accept a clip that really has
no sound. Returns a `downloadId` — not a job id — whose progress streams from
`downloadVideoProgress()`. The finished file lands in your library.

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

#### `addCaptions(input)`

```ts
addCaptions(input: {
  videoUrl: string
  text?: string                       // on "subtitle": the caption itself — ONE static block for the whole video, never transcribed over.
                                      // On a kinetic style: only the fallback when transcription returns nothing
  captions?: Array<{ text: string; startMs: number; endMs: number; timestampMs?: number | null; confidence?: number | null }>
                                      // timestampMs / confidence are accepted but nothing in the render reads them
  autoTranscribe?: boolean            // transcribe the audio when nothing else supplies the words (default true)
  transcribeProvider?: "whisper" | "incredibly-fast-whisper" | "elevenlabs-stt"
                                      // "whisper" has no word timestamps — fine for "subtitle" (phrase timing is enough); on a kinetic
                                      // style it is rejected only when transcription is the render's only caption source
  style?: CaptionStyle                // "subtitle" (static) | "word-highlight" | "karaoke" | "tiktok-words" | "word-pop" | "bouncy"
  position?: "bottom" | "top" | "center"
  fontSize?: number
  color?: string
  backgroundColor?: string
  // Look + motion levers. The STYLING levers (look, fontFamily, fontWeight,
  // strokeColor/strokeWidth, uppercase, positionY, maxWordsPerLine) apply to the
  // static "subtitle" style too — a subtitle carrying any of them renders via Remotion.
  // Only highlightColor and animate stay kinetic-only (rejected 400 on subtitle):
  look?: "outline" | "clean"          // preset; an UNSET look renders as "outline" on the kinetic styles, "clean" on "subtitle"
  fontFamily?: SupportedFontName
  fontWeight?: number                 // 100–900 in 100s
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string             // kinetic only — the spoken/active word colour
  uppercase?: boolean
  positionY?: number                  // caption CENTER as % of height; overrides position
  maxWordsPerLine?: number            // integer 1–20; caps the WORDS per caption line / tiktok-words page, for any input (inert on "word-pop")
  animate?: boolean                   // kinetic only; false freezes per-word motion (default true)
  // Apply different treatments to non-overlapping time ranges in one call:
  segments?: CaptionSegmentInput[]
}): Promise<{ jobId: string }>
```

Burn captions into a video (`POST /v1/add-captions`). Give the words as `text`,
word-timed `captions[]` (one entry per WORD for the kinetic styles), or let it
transcribe (the default). When a call carries more than one source the
precedence is `captions[]` > `transcript` > `text` on `subtitle` >
auto-transcription.

What `text` does depends on the style. On a top-level `"subtitle"` (no
`segments[]`) it **is** the caption: burned as-is as ONE static block shown for
the whole video, never transcribed over — with or without styling levers (`\n`
forces a line break). Omit `text` to caption the speech instead. On a kinetic
style `text` is only the **fallback**, used when transcription returns nothing or
`autoTranscribe` is `false`, and it is then spread evenly across the video as
synthetic word timings. With `segments[]` a top-level `text` is that same
fallback.

On the kinetic styles a `look` preset — `outline`
(Montserrat 900, UPPERCASE, black outline, yellow spoken word — the TikTok read)
or `clean` — drives the styling, and an unset `look` renders as `outline` (on
`subtitle` an unset `look` renders as `clean`); the
explicit levers override individual fields of it. The styling levers (`look`,
`fontFamily`, `fontWeight`, `strokeColor`/`strokeWidth`, `uppercase`,
`positionY`, `maxWordsPerLine`) apply to `subtitle` too — a styled subtitle
renders via Remotion and bills at the kinetic price, while a bare plain-text
subtitle stays on the cheap FFmpeg path. Only `highlightColor` and `animate` stay
kinetic-only.
`animate` (default `true`) freezes the per-word motion when `false` — grouping,
line-holding and the highlight colour stay; set `highlightColor` = `color` for a
fully static line. `segments[]` applies different treatments to non-overlapping
time ranges; a segment that names its own `look` starts fresh from that preset
and does not inherit the top-level explicit levers. Poll `jobs.get(jobId)`.

`maxWordsPerLine` (integer 1–20, optional) caps how many words one caption line —
or one `tiktok-words` page — may hold, **on top of** the rules that already close
a line (the ~85 % frame-width budget, a sentence end, a pause of 0.5 s or more).
`1`–`2` gives the punchy CapCut read; unset fits the width. It applies to
`word-highlight`, `karaoke`, `bouncy`, `tiktok-words` and `subtitle`, and is inert
on `word-pop` (always one word). It costs nothing extra on the kinetic styles; on
`subtitle` it is a styling lever, so that render goes through Remotion and bills
at the kinetic price. It counts whitespace-separated **words**, not caption
entries, so it holds for any input: an entry that alone holds more than N words
(a phrase-level `captions[]` entry, a phrase from an engine without word
timings) is split into consecutive sub-phrases of at most N words, its time span
divided between them in proportion to their character length. The one exception
is a `text` subtitle, where it only sets the line breaks — the block stays one
static block. It exists top-level **and** per segment — a segment that
does not set its own inherits the top-level value:

```ts
await client.media.addCaptions({
  videoUrl: "https://…/talk.mp4",
  style: "word-highlight",
  maxWordsPerLine: 2,                  // no line holds more than two words
})
```

A kinetic style is word-timed, so when the call auto-transcribes,
`transcribeProvider` must be an engine that returns word timestamps —
`incredibly-fast-whisper` (the default here) or `elevenlabs-stt`.
Naming `"whisper"` is rejected with `400 validation_error` on
`transcribeProvider` only when transcription is the render's ONLY possible
caption source; with `text`, `captions[]`, a `transcript`, `autoTranscribe:
false`, or self-sourced `segments[]`, the call is accepted and the
word-timing-less engine is simply never called — the render falls back to that
other source (with only `text`, evenly-spaced synthetic captions). In a
`segments[]` render only a kinetic segment that falls back to the shared
transcription needs word timings.

`subtitle` + auto-transcribe works with **any** engine, `"whisper"` included: a
subtitle draws whole phrase lines, so phrase timing is all it needs. (An
auto-transcribed subtitle renders via Remotion and bills at the kinetic price.)

`word-highlight`, `karaoke` and `bouncy` show ONE held line at a time: words are
grouped into a line that fits the frame, the line closes on a sentence end, a
pause or the `maxWordsPerLine` cap, and the per-word effect (highlight / fill /
bounce) walks word to word inside it. `karaoke` and `bouncy` used to draw the
whole transcript as one block. `word-pop` keeps each word up until the next one
starts, and a `tiktok-words` page never spans a sentence end or a pause and
stays up until the next page starts — both for at most 1.5 s past the last
spoken word. A word's `startMs`/`endMs` is its **spoken** window — what times
the effect — not how long its text is on screen. Full rules:
[Add Captions → Line grouping](./nodes/processing-video/add-captions.md#line-grouping).

A Remotion caption render keeps the **source video's frame rate** (rounded to a
whole number, within 15–60 fps) — it no longer re-times every clip to 30 fps.
Two kinds of source still render at 30 fps: a variable-frame-rate source, and a
clip long enough that its duration × the source rate would exceed the render's
frame cap.

**Transcribe → correct → burn.** Because `captions[]` is exactly the shape
[`audio.transcribe()`](#transcribeinput) returns in `output_data.words`, the two
compose directly — and supplying `captions[]` means add-captions runs no STT of
its own:

```ts
const { jobId } = await client.audio.transcribe({
  audioUrl: "https://…/talk.mp3",
  provider: "elevenlabs-stt",                            // always word-level
})
const { data: job } = await client.jobs.get(jobId)       // poll until completed
const { words } = job.output_data as TranscribeJobOutput // ms, one per word
// …correct a misheard word here: words[7].text = "Nodaro"
await client.media.addCaptions({
  videoUrl: "https://…/talk.mp4",
  captions: words,
  autoTranscribe: false,               // the words above ARE the caption source
  style: "word-highlight",
})
```

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

#### `splitMedia(input)`

```ts
splitMedia(input: {
  videoUrl?: string
  audioUrl?: string
  chunkDuration: number
  minPartDuration?: number
  audioFormat?: "mp3" | "wav" | "aac"
}): Promise<{ jobId: string }>
```

Cut a video and/or an audio file into consecutive parts (`POST /v1/split-media`).
Every part is at most `chunkDuration` seconds (at least 1) and at least
`minPartDuration` (default 4, never above `chunkDuration` — a larger value is a
`400`). Pass `videoUrl`, `audioUrl`, or both (each is split on its own); audio
parts are written in `audioFormat` (`mp3` default). 22 credits<!-- credits: split-media --> per run on Nodaro
Cloud, whatever the number of parts. Poll `jobs.get(jobId)`; the completed job's
`output_data` is a `SplitMediaOutput`:

```ts
interface SplitMediaOutput {
  videoUrls?: string[]             // the video parts, in order
  audioUrls?: string[]             // the audio parts, in order
  chunkCount: number               // the larger of the two lists
  partDurationsSec?: number[]      // each part's exact length (video parts', else audio parts')
  audioPartDurationsSec?: number[] // the audio parts' lengths, only when both were split
}
```

How the parts are cut (on whole frames, a short leftover evened out with the
parts before it, sources up to 3 hours, at most 200 parts per input) is on the
[Split into Chunks](./nodes/processing-audio/split-media.md) node page.

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

#### `videoOverlay(input)`

```ts
videoOverlay(input: VideoOverlayRequest): Promise<{ jobId: string }>

// VideoOverlayRequest (from @nodaro/shared)
{
  videoUrl: string
  layers: Array<{                 // 1–20
    imageUrl: string
    start: number                 // seconds, 0–3600
    end?: number                  // seconds, after start; omitted = to the end of the video
    preset?: "card" | "corner-badge" | "full-frame"
    corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right"   // corner-badge; default bottom-right
    anchor?: OverlayAnchor        // the nine image-overlay anchors
    x?: number                    // −100..100, % of the output frame width
    y?: number                    // −100..100, % of the output frame height
    width?: number                // 1..100, % of the output frame width
    height?: number               // 1..100; omitted = follows the image's aspect
    fit?: "contain" | "cover"
    opacity?: number              // 0..1
    animate?: boolean             // default true
    zIndex?: number               // 0..100
  }>
  outputAspect?: "16:9" | "9:16" | "1:1" | "4:5"
  baseFit?: "contain" | "cover"   // with outputAspect; default cover
  backgroundColor?: string        // #RRGGBB, with outputAspect; default #000000
}
```

Place 1–20 timed image layers over a video (`POST /v1/video-overlay`) —
locally rendered (FFmpeg) in one pass, **22 credits**<!-- credits: video-overlay --> per run whatever the
layer count or length; the base audio is kept untouched. An explicit box
field overrides the preset, and a layer with neither is a corner badge
(bottom-right, or the `corner` it names). Without `outputAspect` the output
keeps the video's own size and frame rate. Poll `jobs.get(jobId)`: the output carries `videoUrl`, `thumbnailUrl`,
`width`, `height`, `durationSec` and `warnings[]`
(`{ layer?, slot?, code, detail }` — `clipped`, `skipped`,
`animated_first_frame`, `audio_reencoded`). Full reference:
[Video Overlay](./nodes/processing-video/video-overlay.md).

#### `videoMask(input)`

```ts
videoMask(input: {
  videoUrl: string
  prompt: string                  // ≤500 chars; commas track several subjects
  threshold?: number              // 0.05..0.95, default 0.5 (lower finds more)
  provider?: "sam-3.1" | "sam-3"  // default sam-3.1; sam-3 is half the price
  holdLastMask?: boolean          // default false; keep the last mask where the subject is lost
  minSubjectHeightPct?: number    // 0..100, default 0 (off); drop regions shorter than this % of the frame height
  maxSubjectHeightPct?: number    // 0..100, default 0 (off); drop regions taller than this % (min > max is a 400)
  zone?: {                        // default null (off); keep regions whose centre is inside these margins
    leftPct?: number; rightPct?: number; topPct?: number; bottomPct?: number  // 0..49 % each, left out = 0
  } | null
  perShot?: boolean               // default false; detect the subject again in every shot (scene cuts found first)
}): Promise<{ jobId: string }>
```

Track a subject described in plain text through a video (`POST /v1/video-mask`,
SAM 3.1 by default, `provider: "sam-3"` at half the price) and get a
black-and-white **mask video** back — white = the subject.
Clips up to 5 minutes at 30 fps (a faster clip counts proportionally longer),
priced by length (`sam-3.1-video:5s` … `:300s`, 55<!-- credits: sam-3.1-video:5s -->–3108 credits<!-- credits: sam-3.1-video:300s -->; SAM 3 about half). Poll
`jobs.get(jobId)`: the output carries `videoUrl` (the mask), `width`,
`height`, `frames`, `shots`, `coverage` (rounded to 4 decimals) and `kept`
(false only when the size / zone filters left nothing on any frame). `zone` drops, on every frame, the
regions whose bounding-box centre lies outside the frame minus the margins
(after the size cuts, before `holdLastMask`). `perShot` finds the clip's scene
cuts first and segments each shot on its own — the subject is detected again
after every cut, `holdLastMask` never crosses a cut, and each shot's mask is
fitted to that shot's exact frame count; on a clip with no cut it gives the
same mask, fitted to the clip's exact frame count. Full reference:
[Video Mask](./nodes/ai-video/video-mask.md).

#### `maskComposite(input)`

```ts
maskComposite(input: {
  foregroundUrl?: string          // required when fill is "video" (the default)
  backgroundUrl: string
  maskUrl: string                 // white = foreground
  invertMask?: boolean
  feather?: number                // 0..20 px, default 2
  grow?: number                   // -10..10 px, default 0
  opacity?: number                // 0..1, default 1 (how strongly the fill covers the background inside the mask)
  fill?: "video" | "pixelate" | "blur"                       // default video (the foreground)
  pixelSizePct?: number           // pixelate: block size, 0.2..10 % of the width, default 1.25
  blurStrengthPct?: number        // blur: sigma, 0.1..5 % of the width, default 2
  backgroundFit?: "cover" | "contain" | "stretch"           // default cover
  audioSource?: "foreground" | "background" | "mix" | "none" // default foreground
}): Promise<{ jobId: string }>
```

Place a foreground video over a background video through a mask video
(`POST /v1/mask-composite`) — local FFmpeg, **11 credits**<!-- credits-rate: mask-composite --> **per started 5 s** of
the result (the video it follows up to 300 s). The result follows
the foreground's size, frame rate and length; the background is fitted and
loops when shorter, the mask holds its last frame. With `fill: "pixelate"`
or `"blur"` the masked area is the background itself, pixelated or blurred:
no `foregroundUrl` is needed (one sent is ignored), the result follows the
background and is priced on its length, and it always carries the
background's sound (`audioSource` is ignored). Full reference:
[Mask Composite](./nodes/processing-video/mask-composite.md).

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

#### `imageOverlay(input)`

```ts
imageOverlay(input: {
  imageUrl: string
  layers: Array<{
    imageUrl: string
    anchor?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right"
    x?: number
    y?: number
    width?: number
    height?: number
    opacity?: number
    rotation?: number
    blend?: "over" | "multiply" | "screen"
    fit?: "contain" | "cover" | "stretch"
    shadow?: { blur: number; offsetX: number; offsetY: number; color: string; opacity: number }
    roundedCorners?: number
    zIndex?: number
    kind?: "image" | "text" | "qr" | "shape"
    text?: OverlayTextStyle
    qr?: OverlayQrStyle
    shape?: OverlayShapeStyle
    effects?: OverlayImageEffects
  }>
  canvas?: { width: number; height: number; backgroundColor?: string }
  baseFit?: "contain" | "cover"
  outputFormat?: "png" | "jpg" | "webp"
  variants?: string[]
  maskMode?: "none" | "layers" | "around" | "outside"
  maskSpread?: number
  qrText?: string
}): Promise<{ jobId: string }>
```

Place 1–12 layers on a base image, pixel-exactly (`POST /v1/image-overlay`) —
a local, deterministic composite, no AI model. A layer is a picture
(`kind: "image"`, default — `imageUrl`), real text (`kind: "text"` with a
`text` object: content, `fontId`, `fontWeight`, `fontSize` as % of the base
height, colour, align, outline, background box), a QR code (`kind: "qr"`,
`qr: { text }`) or a flat shape (`kind: "shape"`, `shape: { shape, color }`). Every layer position and size is a **percentage of the base
image**, so the same call works on a 1K preview and a 4K render: `anchor`
(nine positions, default `"center"`), `x`/`y` (offset from the anchor in %
of the base width/height — on a right/bottom anchor a negative value moves
the layer inward), `width` (% of the base width, default 25; the height
follows the layer's aspect ratio unless `height` is set, in which case
`fit` decides how the source fills the box). `opacity` is 0..1,
`rotation` is in degrees around the layer's centre, `blend` is `"over"`
(default), `"multiply"` or `"screen"`; `shadow` adds a blurred silhouette
under the layer and `roundedCorners` a px radius. SVG layers are rasterised
crisp at the target size. The output keeps the base image's pixel size
unless `canvas` is set (the base is then placed into it with `baseFit`).
`outputFormat` is `"png"` (default, keeps transparency), `"jpg"` or
`"webp"`. Watermark example: `{ anchor: "bottom-right", x: -4, y: -6,
width: 12, opacity: 0.95 }`. Poll `jobs.get(jobId)` for the finished image;
its `output.imageUrl` is the composite (`output.width` / `output.height` its
pixel size), `output.maskUrl` the mask and `output.variants[]` the extra
platform renders (`{ id, label, width, height, url }` — any of the 12 platform
ids in `variants`, all at once if you like; 2.2 credits<!-- credits-rate: image-overlay@0.2 --> per platform on top of
the 11-credit<!-- credits-rate: image-overlay --> base, priced as one charge). A QR layer may set
`qr.fromInput: true` and take its payload from the top-level `qrText` (in a
workflow that is the node's QR link handle — a List column yields one code per
row); a run with the flag set and no `qrText` is refused with a 400 naming it.

#### `suggestOverlayPlacement(input)`

```ts
suggestOverlayPlacement(input: {
  imageUrl: string
  layerAspect?: number
  intent?: string
  safeArea?: { x: number; y: number; w: number; h: number }
  llmModel?: string
}): Promise<{ jobId: string; placement: OverlayPlacement }>
```

Ask a vision model WHERE one overlay layer should sit on a base image (`POST
/v1/image-overlay/suggest-placement`) — it reads the picture and keeps the
element off the faces, the subject and the busiest texture. The answer comes
back in `imageOverlay`'s own percent units — `anchor`, `x`/`y`, `width`
— so it drops straight onto a layer, plus a one-sentence `reason` you can show
a user. Nothing is composited: you apply the placement.

`layerAspect` is the element's width / height (1 = square, the default) so the
proposed box stays in proportion; `intent` says what the element is ("a logo",
"a price badge"); `safeArea` is the always-visible region as fractions of the
canvas (a platform preset's safe area), which the placement is kept inside.
Unlike the other media calls this one answers **synchronously** — there is
nothing to poll, and `jobId` is the billing record (one Describe Image call).

```ts
const { placement } = await nodaro.media.suggestOverlayPlacement({
  imageUrl: base,
  intent: "a logo",
  layerAspect: 2.5,
})
const { reason, ...box } = placement // anchor + x + y + width, ready to use
await nodaro.media.imageOverlay({
  imageUrl: base,
  layers: [{ imageUrl: logo, ...box }],
})
```

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
(separation, isolation, effect, mix, level) plus speech-to-text, exposed
standalone so a consumer can run any single step or assemble its own pipeline.
Every method returns a job id to poll with `client.jobs.get(jobId)`.

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
mix(input: {
  audioUrls: string[]
  trackVolumes?: number[]
  duck?: {
    under: number
    amount?: number
    thresholdDb?: number
    ratio?: number
    attackMs?: number
    releaseMs?: number
  }
  endAt?: "longest" | "voice"
}): Promise<{ jobId: string }>
```

Layer multiple audio tracks into one (`POST /v1/mix-audio`). `audioUrls`
(2–20) are summed; optional `trackVolumes` (0–200% each, positionally) set
per-track level.

`duck` puts a music bed under speech: every track except `audioUrls[under]`
(the voice) dips while that track is loud and rises back in its pauses
(sidechain compression). `amount` (0–100, default 75) is how hard;
`thresholdDb` (-60–0, default -30), `attackMs` (1–2000, default 20),
`releaseMs` (10–9000, default 500) and `ratio` (1–20, overrides `amount`) are
optional fine controls. A ducked mix sums its tracks rather than averaging
them, so the voice keeps its level. The price is the same with or without a
duck.

`endAt` sets where the mix ends: `"longest"` (the default) at the end of its
longest track, `"voice"` ("When the voice ends") when the `duck.under` track
ends, so a music bed longer than the episode is cut there. `"voice"` needs a
`duck`; without one the request is refused with `400 validation_error`.

```ts
await client.audio.mix({
  audioUrls: [voiceUrl, musicUrl],
  trackVolumes: [100, 60],
  duck: { under: 0, amount: 80 },
})
```

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

#### `pitchTempo(input)`

```ts
pitchTempo(input: {
  audioUrl?: string
  videoUrl?: string
  semitones?: number
  tempo?: number
  preserveFormants?: boolean
}): Promise<{ jobId: string }>
```

Shift pitch and/or change tempo with Rubber Band (`POST /v1/pitch-tempo`):
`semitones` −12…+12 (default 0), `tempo` 0.5…2 with the pitch kept (default 1;
fixed at 1 for a video), `preserveFormants` (default `true`). Pass exactly one of
`audioUrl` / `videoUrl` — a video keeps its picture. Inputs up to 30 minutes,
priced per started minute. See [Pitch & Tempo](./nodes/processing-audio/pitch-tempo.md).

#### `combine(input)`

```ts
combine(input: {
  segments: Array<{ url: string; startTime?: number; endTime?: number }>
}): Promise<{ jobId: string }>
```

Concatenate audio segments end-to-end (`POST /v1/combine-audio`). Each segment
is a `url` with an optional `[startTime, endTime]` sub-range.

#### `transcribe(input)`

```ts
transcribe(input: {
  audioUrl: string
  provider?: TranscribeProvider   // "elevenlabs-stt" | "incredibly-fast-whisper" | "whisper"
  language?: string               // force a language; omit to auto-detect
  diarize?: boolean               // label who spoke each word (elevenlabs-stt)
  tagAudioEvents?: boolean        // tag laughter / applause / … (elevenlabs-stt)
  wordTimestamps?: boolean        // ask for per-word timings
}): Promise<{ jobId: string }>
```

Transcribe an audio (or video) track to text (`POST /v1/transcribe`).

Three engines are accepted:

| `provider` | Word timings | Notes |
|------------|--------------|-------|
| `"elevenlabs-stt"` | ✓ always | Scribe — word-level flag or not, and the only lane that honours `diarize` and `tagAudioEvents` |
| `"incredibly-fast-whisper"` | ✓ with `wordTimestamps: true` | ONLY when asked — without the flag the job succeeds and is charged, with phrase `segments` and an empty `words` list |
| `"whisper"` | ✗ | phrase segments only; `wordTimestamps: true` is rejected with `400 validation_error`, before any credit is spent |

**Omitting `provider`** still falls back to the legacy `whisper` lane, so
`wordTimestamps: true` with no `provider` earns the same `400`. Name
`"elevenlabs-stt"`, or `"incredibly-fast-whisper"` with `wordTimestamps: true`,
whenever you want word timings — a kinetic caption render needs them.

Poll `jobs.get(jobId)`. The completed job's `output_data` is a
`TranscribeJobOutput`:

| Field | Units | What it is |
|-------|-------|------------|
| `text` | — | the whole transcript as one string |
| `language` | — | the detected (or requested) language code |
| `words` | **ms** | one entry per word: `{ text, startMs, endMs, speaker? }` — empty when the engine was not asked for word timings (see the table above) |
| `json` | **ms** | the normalized `Transcript` (`{ version, language, words[], segments? }`) — what `client.edit.*` consumes |
| `segments` | **seconds** | the raw per-utterance ranges — *not* ms, unlike everything above. **Legacy lanes only:** `elevenlabs-stt` returns none, so read `words` |

`words` is caption-shaped, so it drops straight into
[`media.addCaptions()`](#addcaptionsinput) as `captions` — see the composition
example there.

---

### `client.credits`

Authenticated user's credit balance, transaction history and per-model cost previews.

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
| `subscription` | `number` | Subscription credits left this month. Reset to `monthlyAllocation` every month — on a yearly plan too — and unused ones do not roll over. |
| `topup` | `number` | One-off purchased credits. |
| `dailySpent` | `number` | Credits spent in the current calendar day. |
| `dailyLimit` | `number \| null` | Daily spending cap (`null` = no cap). |
| `monthlyAllocation` | `number` | Credits the plan grants every month, on monthly and yearly billing alike. |
| `tier` | `string` | Subscription tier (e.g. `"free"`, `"pro"`). |
| `effectiveTier` | `string` | Entitlement tier actually enforced. `"payg"` = pay-as-you-go: no subscription, but purchased credits — all models unlocked, no watermark, no daily cap. |
| `features` | `Record<string, unknown>` | Feature flags for the tier. |
| `periodEnd` | `string \| null` | ISO-8601 end of the current billing period — a year away on a yearly plan, whose subscription credits still reset every month. |
| `appCreditsAllowance` | `number` | Credits earned for app usage (free tier only). |
| `freeGrantState` | `FreeGrantState?` | Where the free signup grant stands: `"unclaimed"`, `"granted"`, `"withheld"` (the account works but the grant did not land — show the activation path) or `"revoked"`. Absent where the deployment has no signup grant. |
| `freeGrantNotice` | `"browser_unmeasured"?` | Only with `freeGrantState: "withheld"`, when the claim showed no browser signals at all: the app may say free credits need a regular browser and a reload. |
| `welcomeOffer` | `WelcomeOfferState?` | Present only while the deployment has the welcome offer switched on — absent means no popup, no banner, no block. See [`claimWelcomeOffer`](#claimwelcomeofferinput). |

**`WelcomeOfferState`:**

| Field | Type | Description |
|-------|------|-------------|
| `popupSeen` | `boolean` | The one-time welcome popup was already shown ([`markWelcomeOfferSeen`](#markwelcomeofferseen)). |
| `consentPending` | `boolean` | The account already has its credits but still owes the email consent; the web apps block creation until a claim records it. |
| `credits` | `number` | The credits a claim grants. Name this figure in the offer instead of hard-coding one — it follows the server when the grant changes. |

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
instead of failing the whole batch. A speech model's per-100-characters row
(`<model>:per-100-chars`) is a valid identifier: it is priced on an instance
that prices speech by length and lands in `missing` where that is off — which
is how a client learns which rule the server charges by. So is
`<model>:per-100-chars:<N>u`, the exact price of a request of N started
hundreds of characters (N from 8 up to the model's per-request cap in
hundreds; any other N lands in `missing`): a request is priced as a whole and
rounded once, so this is the figure to quote — N × the per-100-characters row
can be higher.
The same id shape prices every run charged per unit: `<row>:<N>u` is the
exact price of N units of that row — the minutes of an Apply EDL or Speaker
View render (`apply-edl:4u`), the 5-second units of Trim Video, Loop Video,
Combine Videos, Assemble Narrated Video and Mask Composite (`trim-video:5u`),
the seconds of an LTX 2.3 Pro extend or retake
(`ltx-2.3-pro-retake:per-second:2.5u`; N is fractional where the run's units
are), the started minutes of a dub (`elevenlabs-dubbing:3u`, Hebrew
`elevenlabs-dubbing-v2:3u`; whole minutes, 1 to 30). A row not charged per
unit, or a unit count no run of it can have, lands in `missing`.
A whole Voice Changer Pro convert is `voice-changer-pro:<slot>,<slot>,…`, one
slot per recast voice — `sts-<seconds>`, `respeak-<characters>` (v3),
`respeak-v4-<characters>` (v4), `respeak-v4t-<characters>` (v4 speaking a
translation: send the transcript's characters, the server applies the
re-render allowance), or the bare kind for an unknown measure
(`voice-changer-pro:sts-26.76,respeak-1200,respeak-v4t-800`) — and is answered
with the credits the convert reserves (per-voice prices do not add up to it:
the convert is charged the sum, rounded once). `@nodaro/shared` builds it:
`voiceChangerProQuoteCreditId(slots)`, where a Re-speak slot takes an optional
`engine` (`"v3"` | `"v4"`) and `translated` flag.

**`ModelCostsResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `data` | `Record<string, number>` | Priced identifier → credit cost. |
| `missing` | `string[]` | Identifiers with no pricing row (render `'—'`). |
| `errors` | `string[]` | Identifiers where the lookup itself failed. |
| `estimates` | `string[]?` | The identifiers in `data` whose figure is an **estimate**, not a fixed price: metered LLM price keys (`<feature>:<model>[:direct]`, built by `llmPriceKey` from `@nodaro/shared/llm-models`), charged for the tokens the call actually uses. Show these as `~N`. Omitted when there are none. A metered key in `missing` means the server is not pricing LLM calls per model — show no price for it. |
| `errorCodes` | `Record<string, { code, message }>?` | Why each identifier in `errors` has no price — today `llm_model_unpriced`: a model with no rate on the lane it would be served on (it cannot be run). Omitted when `errors` is empty. |

```ts
const { data, missing } = await client.credits.modelCosts(["nano-banana-pro", "seedance-2-fast"])
console.log(data["nano-banana-pro"])  // its credit price
if (missing.length) console.warn("No price for:", missing)
```

A metered LLM call's estimate (every model's per-token rate is in
[LLM model rates](pricing/llm-models.md)):

```ts
import { llmPriceKey } from "@nodaro/shared/llm-models"

const key = llmPriceKey("llm-chat", "claude-fable-5") // "llm-chat:claude-fable-5"
const { data, estimates } = await client.credits.modelCosts([key])
const shown = estimates?.includes(key) ? `~${data[key]}` : String(data[key])
```

`GET /v1/credits/model-cost?model=<id>` answers one identifier as
`ModelCostResult` — `{ model, creditCost, estimate?: true }`.

#### `transactions(options?)`

```ts
transactions(options?: { limit?: number; cursor?: string }): Promise<CreditTransactionsPage>
```

`GET /v1/credits/transactions` → one page of the caller's credit transactions,
newest first. `limit` is 1–50 (default 20). Pass the page's `nextCursor` as
`cursor` for the next page; it is `null` when there are no more rows. Returns
the whole page, `{ data: CreditTransaction[], nextCursor }`. Cloud edition
only — a self-hosted instance answers 404.

**Which amount to read.** A run first holds credits and is then settled: it is
charged all or part of the hold and the rest goes back to your balance. Sum
`credits_charged` for spend; the hold is not what you paid.

**`CreditTransaction`:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The transaction (usage log) id. |
| `created_at` | `string` | ISO-8601. The paging cursor is the last row's value. |
| `credits_charged` | `number \| null` | What the run cost once settled. Can be lower than the hold; `0` when the hold was refunded; `null` while the hold is still open (`status: "reserved"`). |
| `credits_reserved` | `number \| null` | The hold taken when the run was accepted. Never changes. |
| `credits_used` | `number \| null` | The same hold under its original name, kept for existing integrations. Prefer `credits_charged`. |
| `action` | `string \| null` | The model or operation the credits were for. |
| `provider` | `string \| null` | Provider the run was routed to. |
| `status` | `string \| null` | `"reserved"`, `"committed"` or `"refunded"`. |
| `metadata` | `Record<string, unknown>` | The run's own billing details (model, which of your pools funded it, app-credit movement). |
| `payer` | `"user" \| "workspace"` | `"workspace"` = a class or team budget paid, not your balance. |
| `workspaceId` | `string \| null` | The paying workspace, when `payer` is `"workspace"`. |

```ts
let cursor: string | undefined
let spent = 0
do {
  const page = await client.credits.transactions({ limit: 50, cursor })
  for (const t of page.data) spent += t.credits_charged ?? 0
  cursor = page.nextCursor ?? undefined
} while (cursor)
console.log(`${spent} credits charged`)
```

#### `claimSignupGrant(keys?)`

```ts
claimSignupGrant(keys?: SignupKeys): Promise<SignupGrantClaimResult>
```

`POST /v1/credits/claim-signup-grant` → claims the account's free signup grant,
once, with the browser signals of the page making the claim. Idempotent: a
decided account answers with its state and `granted: false`. Call it once per
page load as soon as the session is known and never wait on it for rendering —
a failed call costs nothing, the next load asks again. Nodaro Cloud only (a
self-hosted instance answers 404).

The signals come from the browser-only subpath `@nodaro/sdk/signup-signals`:
`collectSignupKeys()` returns whatever could be measured within its deadline
(3 s by default), `{}` included — the account works without them. The browser
key needs `@fingerprintjs/fingerprintjs` installed (an optional peer
dependency); without it only the device key is reported.

**`SignupKeys`:** `{ browserKey?: string; deviceKey?: string }` — SHA-256 hex digests.

**`SignupGrantClaimResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `state` | `"unclaimed" \| "granted" \| "withheld" \| "revoked"` | Where the grant stands after the call. |
| `granted` | `boolean` | True only when this call moved the credits. |

```ts
import { collectSignupKeys } from "@nodaro/sdk/signup-signals"

// On boot, once the session is known — fire and forget.
void collectSignupKeys().then((keys) => client.credits.claimSignupGrant(keys)).catch(() => {})
```

#### `claimWelcomeOffer(input?)`

```ts
claimWelcomeOffer(input?: WelcomeOfferClaimInput): Promise<WelcomeOfferClaimResult>
```

`POST /v1/credits/welcome-offer/claim` → the user's "yes" to the welcome offer,
as one server action: the marketing-email consent is recorded, then the free
signup grant is claimed with that consent. The abuse checks still decide —
consent is necessary, not sufficient — so read `grant`. An account whose grant
was already decided only has its consent recorded. Nodaro Cloud only (a
self-hosted instance answers 404).

**Browser session only.** The consent is a person's choice in a browser, so
the route answers a first-party web app signed in with a Supabase session
(`supabaseAuth`) and refuses an API key or an OAuth app token with `403`. It
answers `409 welcome_offer_disabled` while the deployment has the offer off:
show the offer only when `balance().welcomeOffer` is present.

**`WelcomeOfferClaimInput`:** `SignupKeys` (from `collectSignupKeys()`) plus
`sourceApp?: string` — your app's slug (lowercase letters, digits and `-`, up to
40 characters), recorded with the consent. A malformed value is stored as
absent, never refused — and `locale?: string`, the interface language the user
answered in: the id of a language Nodaro ships (`"en"`, `"ja"`, `"pt-BR"`, …),
matched exactly and case-sensitively, so `"en-US"` or `"pt-br"` is stored as
absent. It is recorded with the consent as the language of the latest one.

**`WelcomeOfferClaimResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `consent` | `"granted"` | The email consent is recorded. |
| `grant` | `FreeGrantState` | Where the grant stands after the call: `"granted"` — the grant has landed: this call topped the subscription credits up to `credits`, or it had landed before; `"withheld"` — the abuse checks refused it; `"revoked"` — the grant was taken back earlier and the claim moves nothing; `"unclaimed"` — nothing moved (treat it as a failure and let the user retry). |
| `credits` | `number` | The grant's figure — the same as `balance().welcomeOffer.credits`. A grant tops the subscription credits up to it; it is not added on top of what is there. |

#### `markWelcomeOfferSeen()`

```ts
markWelcomeOfferSeen(): Promise<{ ok: true }>
```

`POST /v1/credits/welcome-offer/seen` → records that the one-time popup was
shown, so `welcomeOffer.popupSeen` turns `true` in every app. Idempotent (the
first stamp wins). A failed call only means the popup may show once more, so
callers usually ignore errors. Same rules as `claimWelcomeOffer`: browser
session only (`403` for API keys and OAuth app tokens), `409
welcome_offer_disabled` while the offer is off, Cloud only.

```ts
import { collectSignupKeys } from "@nodaro/sdk/signup-signals"

const { welcomeOffer } = await client.credits.balance()
if (welcomeOffer && !welcomeOffer.popupSeen) {
  showPopup({ credits: welcomeOffer.credits })            // the server's figure, never a constant
  void client.credits.markWelcomeOfferSeen().catch(() => {})
}

// On "Yes":
const keys = await collectSignupKeys()
const { grant, credits } = await client.credits.claimWelcomeOffer({ ...keys, sourceApp: "my-app", locale: "en" })
if (grant === "granted") showToast(`Your ${credits} free credits are ready`)  // topped up to the figure, not added on top
```

---

### `client.billing`

Plans and prices, the caller's subscription, and how the deployment bills. See
[API integration § 12c](./api-integration.md#12c-plans-and-prices-cloud-edition).
Buying, changing the plan and the payment settings stay in the Nodaro app —
those routes refuse API and app tokens, so the SDK has no method for them; link
the user to the app's pricing page instead.

```ts
// A pricing screen: works signed out.
const { data: plans, topUps } = await client.billing.plans()

// Mark the plan the signed-in account is on.
const { effectiveTier } = await client.billing.subscription()
const current = plans.find((p) => p.id === effectiveTier) // undefined: pay-as-you-go, or a tier not on sale
```

| Method | Returns | Notes |
|--------|---------|-------|
| `plans()` | `Promise<BillingPlansResult>` | `GET /v1/billing/plans`. **Public** — no credential needed, the same answer for every caller. `{ data: BillingPlan[], topUps: BillingTopUp[], topUpRange }`. Nodaro Cloud only (`NotFoundError` on a self-hosted instance). Throws `ForbiddenError` on a deployment that does not sell to its users (the server's code is `self_serve_disabled`), and a `NodaroError` with `status` 503 and `code` `stripe_not_configured`, or `plan_prices_unavailable` for a moment. |
| `subscription()` | `Promise<BillingSubscriptionResult>` | `GET /v1/billing/subscription`. `{ data: BillingSubscription \| null, effectiveTier }` — `data` is `null` when the account never subscribed. `effectiveTier` is the tier its entitlements follow: usually a `BillingPlan` `id`; `"payg"` (no subscription, credits bought); or a tier not on sale, such as `"enterprise"`. Needs a signed-in session, a personal API token without a workflow limit, or an app's OAuth token (a workflow-limited key gets `ForbiddenError`). Nodaro Cloud only. |
| `surface()` | `Promise<BillingSurface>` | `GET /v1/billing/surface`. Public, every edition: whether the deployment meters usage at all (`providerId` is `"none"` when it does not) and the unit costs display in (`displayUnit`). |
| `account()` | `Promise<BillingAccountSummary \| null>` | `GET /v1/billing/account`. The caller's `plan`, `balance` and `dailyAllowance` as the deployment's billing provider reports them, in its `unit`, plus optional fields a provider may add ([§ 12b](./api-integration.md#12b-billing-surface)). `null` when the provider could not answer — not a zero balance. Every edition. |

**`BillingPlan`:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | `"free"`, `"basic"`, `"standard"`, `"pro"`, `"business"`. |
| `name` | `string` | Display name. |
| `prices` | `{ monthly, yearly } \| null` | `null` for the free plan. `monthly` is `{ amount, currency, credits }` (`BillingMonthlyPrice`); `yearly` adds `perMonth`, the yearly amount spread over its months (`BillingYearlyPrice`). `amount` is in the currency's major unit (`12` = 12.00) and `currency` is the ISO-4217 code (`"USD"`). Either may be `null` when Stripe cannot sell it right now (it could not be read, or it is archived) — show it as unavailable, never as free. |
| `prices.*.credits` | `BillingPriceCredits \| null` | What the price grants: `{ amount, per }`, `per` being `"month"` or `"year"`. A yearly price grants the plan's credits every month, as a monthly price does. `null` when the price does not state it. |
| `signupCredits` | `number \| null` | The free plan's one-time grant at sign-up; `null` on a paid plan, whose credits come with each price. |
| `parallelism` | `number` | How many nodes of one workflow run at once. |
| `storageBytes` | `number` | Storage for your media, in bytes. |

`topUps` are the credit packs (`{ id, credits, price }`), smallest first —
`price` is `null` when it cannot be stated right now; `topUpRange`
(`{ min, max, currency }`) is the range of whole amounts that can be loaded as
credits in the app, at the same rate as the packs.

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
| `mimeType` | `string` | Final MIME type after server normalization — the CANONICAL type, which may differ from the one the browser declared (`audio/vnd.dlna.adts` → `audio/aac`, `application/octet-stream` + `clip.mp4` → `video/mp4`). See [Direct uploads](./api-integration.md#direct-uploads). |
| `sizeBytes` | `number` | Stored byte size. |
| `r2Key` | `string` | R2 object key. |

```ts
const result = await client.uploads.upload(file)
console.log(result.url)        // use as sourceImageUrl / audioUrl / videoUrl
console.log(result.assetId)    // reference back to the storage row
```

#### `uploadJson(json)`

```ts
uploadJson(json: Record<string, unknown> | readonly unknown[]): Promise<UploadJsonResult>
```

`POST /v1/upload-json` → stores a JSON document (up to 25 MB) and returns
`{ url }`, its public URL — for example an image editor's design state, passed
to `client.jobs.fromUpload` as `editStateUrl` so the edit can be reopened. The
URL is unguessable but public, so never store a secret in it. It creates no
library item.

### `client.library`

#### `list(params?)`

```ts
list(params?: ListLibraryParams): Promise<ListLibraryResult>
```

`GET /v1/library` → the user's stored media with a storage summary. Filter by
`type` (`image` / `video` / `audio`), paginate with `cursor`/`limit`. Each row carries `jobId`, the job that made the file (`null` for an upload; absent from servers before this field).

`q` searches the filename by words: only the files whose filename contains
every word of it (the first 5), ignoring case, every character of a word
matched as itself (`%`, `_` and `*` are not wildcards). `search` is its
earlier name and still works, but is deprecated; when both are given, `q` is
sent.

```ts
const { data, nextCursor } = await client.library.list({ type: "image", q: "poster" })
```

---

### `client.gallery`

The public gallery of completed generations, and your favorites. A favorite is
a bookmark on a generation — one of your own, or anyone's public one. Your jobs
carry it as `Job.favorited`, and `client.jobs.list({ favorited: true })` lists
them. Not available on a deployment that hides the gallery (the routes answer
404 there).

#### `browse(params?)`

```ts
browse(params?: BrowseGalleryParams): Promise<GalleryPage>

interface BrowseGalleryParams {
  type?: "image" | "video" | "audio"
  userId?: string          // only this person's work; your own id includes your private items
  favoritesOnly?: boolean  // with YOUR own userId: only the items you favorited
  limit?: number           // 1–50 (default 20)
  cursor?: string          // the previous page's nextCursor
}
```

`GET /v1/gallery` → a page of the public gallery, newest completed first:
`{ data: GalleryItem[], nextCursor, totalCount? }` (`totalCount` on the first
page only). No token needed. Each item is `{ id, type, jobName, outputUrl,
thumbnailUrl, createdAt, prompt, model, preview? }`, where `id` is the job id.
`favoritesOnly` lists your own favorites only: pass your own `userId` (from
`client.me()`); anyone else's favorites are refused (`UnauthorizedError`
without a token, `ForbiddenError` with another person's `userId` or none).

```ts
const { data: items, nextCursor } = await client.gallery.browse({ type: "image", limit: 20 })
```

#### `toggleFavorite(jobId)`

```ts
toggleFavorite(jobId: string): Promise<{ favorited: boolean }>
```

`POST /v1/gallery/favorite` → favorites the job, or un-favorites it when it
already is; `favorited` is the job's state after the toggle. You can favorite
your own jobs and public ones; another person's private job is a
`NotFoundError`. OAuth apps need the `assets:write` scope.

```ts
const { favorited } = await client.gallery.toggleFavorite(jobId)
```

#### `favorites()`

```ts
favorites(): Promise<string[]>
```

`GET /v1/gallery/favorites` → your favorited job ids, newest first. OAuth apps
need the `assets:read` or `jobs:read` scope.

```ts
const ids = await client.gallery.favorites()
```

---

### `client.presets`

Your saved node presets (create, update, delete, import, reorder, folders),
your favorites, and the built-in factory catalog. A preset's `data` is captured
node config — merge it into a node's data when you build a workflow to "apply"
the preset. The factory catalog (`listFactory`) is public and needs no token;
for your own library, OAuth app tokens need `presets:read` for the reads and
`assets:write` for the writes; your own API key needs neither (a key limited to
some workflows cannot reach your own presets).

Every preset — `NodePreset` and each factory entry (`FactoryPresetEntry`) —
carries:

- `minReferences` — how many connected reference images it works from (0 =
  none), and `needsImage` (`minReferences > 0`). Reference Sheet, Portrait
  Transformations, Edits and every template using `{image:N}` need at least
  one; run such a preset with that many reference images attached.
- `previewUrl` — an example picture (an absolute URL on the server you asked),
  or `null`. On your own presets, the image you stored with it.

Servers that predate these fields leave them out, so they are optional in the
types.

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
listFactory(nodeType: string): Promise<FactoryPresetsResult>  // { data: FactoryPresetEntry[] }
```

`GET /v1/node-presets/factory` → the built-in catalog for `nodeType`. **Login
is optional:** the catalog is public, so this works on a client with no
credential (`auth: { getToken: async () => null }`) — show the names, example
pictures and photo counts to a visitor who is not signed in, and ask for a
login only when they generate. Your own presets (`list()`) still need a token.

```ts
// Signed out: a client with no credential can still read the catalog
const visitor = createClient({ baseUrl, auth: { getToken: async () => null } })
const { data } = await visitor.presets.listFactory("generate-image")
const withPicture = data.filter((p) => p.previewUrl)        // show the example picture

// A preset that works from photos runs with at least minReferences of them.
const board = data.find((p) => p.id === "generate-image/character-board")!
if (board.needsImage && photos.length >= (board.minReferences ?? 0)) {
  await client.nodes.runAndWait("generate-image", { presetId: board.id, referenceImageUrls: photos })
}
```

#### `create(input)`

```ts
create(input: CreateNodePresetInput): Promise<NodePreset>
```

`POST /v1/node-presets`. `input` is `{ nodeType, name, data, description?, groupId?, tags?, sortOrder?, previewUrl? }`.
The name is unique per node type (`409 name_taken`); `data` is at most 64 KB
and runtime keys are stripped. `previewUrl` must be one of your own images on
this platform — an upload or a finished generation result — that already
exists; anything else is `400 validation_error`. The preset keeps its own copy
of the picture, so the returned `previewUrl` is the copy's address. An account
keeps at most 5,000 presets (`409 limit_reached` past that).

```ts
const preset = await client.presets.create({
  nodeType: "generate-image",
  name: "Studio portrait",
  data: { provider: "gpt-image-2", aspectRatio: "3:4", prompt: "{image:1:person}, studio portrait" },
  previewUrl: imageUrl, // the image of one of your completed jobs, or an upload
})
preset.needsImage // true — the prompt names {image:1}
```

#### `update(id, patch, opts?)`

```ts
update(id: string, patch: UpdateNodePresetInput, opts?: { expectedUpdatedAt?: string }): Promise<NodePreset>
```

`PATCH /v1/node-presets/:id`. Any of `name`, `description`, `data`, `groupId`,
`tags`, `sortOrder`, `previewUrl` (`null` removes the picture). Pass the
`updatedAt` you read as `expectedUpdatedAt` to refuse (`409 conflict`) a change
made elsewhere since.

#### `delete(id, opts?)`

```ts
delete(id: string, opts?: { expectedUpdatedAt?: string }): Promise<{ success: true }>
```

`DELETE /v1/node-presets/:id` — `404` when the preset is not yours.

#### `import(presets)`

```ts
import(presets: ImportNodePresetInput[]): Promise<{ imported: number }>
```

`POST /v1/node-presets/import` — up to 500 `{ nodeType, name, description?, data, previewUrl? }`
at once. A name you already use is kept as "… (imported 2)"; a preset whose
data is empty after stripping is skipped. The entries of the envelope
`nodaro presets export` writes fit as they are.

#### `reorder(input)`

```ts
reorder(input: ReorderNodePresetsInput): Promise<{ ok: true }>
```

`POST /v1/node-presets/reorder` — `{ groups?: [{ id, sortOrder }], presets?: [{ id, groupId?, sortOrder }] }`:
positions, and moves into (or, with `groupId: null`, out of) your folders.

#### `favorites(nodeType)` · `addFavorite(input)` · `removeFavorite(input)`

```ts
favorites(nodeType: string): Promise<string[]>
addFavorite(input: { nodeType: string; presetId: string }): Promise<{ success: true }>
removeFavorite(input: { nodeType: string; presetId: string }): Promise<{ success: true }>
```

`GET` / `POST` / `DELETE /v1/node-presets/favorites`. A favorite is a factory id
(`"generate-image/character-board"`) or one of your preset ids; both writes are
idempotent.

#### `createGroup(input)` · `updateGroup(id, patch)` · `deleteGroup(id)`

```ts
createGroup(input: { nodeType: string; name: string; kind?: "folder" | "section"; sortOrder?: number }): Promise<NodePresetGroup>
updateGroup(id: string, patch: { name?: string; sortOrder?: number }): Promise<NodePresetGroup>
deleteGroup(id: string): Promise<{ success: true }>
```

`/v1/node-preset-groups`. Deleting a folder moves its presets out of it; none
are deleted.

---

### `client.savedPosts`

The inspiration wall: save a post you found (a Social Search result) with a
note and tags, list and filter your saves, change or remove them. A save keeps
a snapshot of the post and a copy of its still in your storage. OAuth app
tokens need `assets:read` for the reads and `assets:write` for the writes
(no-op for user/API-key auth).

#### `list(params?)`

```ts
list(params?: ListSavedPostsParams): Promise<ListSavedPostsResult>
```

`GET /v1/saved-posts` → your saves, newest first. Filter by `platform`, `tag`
or words `q` (in the note, the post's text or its title); page with `cursor`
(the previous page's `nextCursor`) and `limit` (1-100, default 40).

```ts
let page = await client.savedPosts.list({ tag: "hooks" })
for (const save of page.data) console.log(save.url, save.note)
while (page.nextCursor) page = await client.savedPosts.list({ tag: "hooks", cursor: page.nextCursor })
```

#### `save(input)`

```ts
save(input: SavePostInput): Promise<SavedPost>
```

`POST /v1/saved-posts` → save a post (`input.post` is a `SocialPost`, exactly
as Social Search returns it), with an optional `note` and `tags`. Saving a post
that is already saved updates its note and tags and returns the existing save.

```ts
const run = await client.nodes.runAndWait("social-search", { platform: "tiktok", query: "meal prep" })
const save = await client.savedPosts.save({ post: run.json[0], note: "strong opener", tags: ["hooks"] })
```

#### `lookup(postIds)`

```ts
lookup(postIds: readonly string[]): Promise<SavedPostsLookupResult>
```

`POST /v1/saved-posts/lookup` → which of these posts (`SocialPost.id`, up to
200) you saved: `{ saved: [{ postId, id }] }`.

#### `update(id, input)` / `delete(id)`

```ts
update(id: string, input: UpdateSavedPostInput): Promise<SavedPost>
delete(id: string): Promise<void>
```

`PATCH` / `DELETE /v1/saved-posts/:id` → change a save's note or tags, or
remove the save and its copied still.

---

### `client.collections`

Where a workflow's records live: named sets of records a workflow saves to and
reads back (see [Collections](./features/collections.md)). A record holds a
title, a text, a link, media links, up to 50 scalar `fields` and a `source` —
text and links only, never files. The same link saved twice is one record;
past the plan's cap the oldest records are evicted after a write. OAuth app
tokens need `assets:read` for the reads and `assets:write` for the writes
(no-op for user/API-key auth).

#### `list()` / `get(id)`

```ts
list(): Promise<ListCollectionsResult>
get(id: string): Promise<Collection>
```

`GET /v1/collections` → your collections with their `recordCount`, plus
`available` (false on a server whose database has no collections yet) and your
`caps` (`{ collections, records }`, `null` = no limit). `get` reads one.

#### `create(input)` / `update(id, input)` / `delete(id)`

```ts
create(input: { name: string; description?: string }): Promise<Collection>
update(id: string, input: { name?: string; description?: string }): Promise<Collection>
delete(id: string): Promise<void>
```

`POST` / `PATCH` / `DELETE /v1/collections[/:id]`. Creating one past your cap
throws `ForbiddenError` (`collection_limit_reached`); a name you already use
throws `ConflictError` (`name_taken`). Deleting a collection deletes its records.

#### `records(id, params?)`

```ts
records(
  id: string,
  params?: {
    q?: string; since?: string; until?: string;
    usage?: "all" | "unused" | "used"; status?: "active" | "trash"; order?: "newest" | "oldest";
    cursor?: string; offset?: number; limit?: number;
  },
): Promise<ListCollectionRecordsResult>
```

`GET /v1/collections/:id/records` → the records, newest first (`order: "oldest"`
flips it). `q` finds words in the title, text or link; `since` / `until` (ISO)
keep only records saved at or after / before them; `usage` keeps every record
(`all`, the default), only the ones **not used yet** (`unused`) or only the
**used** ones; `status` lists the live records (`active`, the default) or the
**Trash**. Page with `cursor` (the previous page's `nextCursor`) or with
`offset` (a numbered page: `(page − 1) × limit`, at most 1,000,000) and
`limit` (1-100, default 50); a page asked for by `offset` carries `total`,
how many records match the filters in all (a cursor walk never pays for the
count). Each record carries `usedAt` (null until it is used), `usedBy`
(who used it — the shape of `source`) and `deletedAt` (null while it is live);
`source` and `usedBy` carry the workflow's `workflowName` and `projectId` when
it is yours.

#### `setUsed(id, recordId, used, source?)`

```ts
setUsed(id: string, recordId: string, used: boolean, source?: CollectionRecordSource): Promise<CollectionRecord>
```

`PATCH /v1/collections/:id/records/:recordId` → mark a record used (`usedAt`
now, `usedBy` = `source`, by default `{ via: "api" }`) or not used again
(`used: false`). A workflow does the same with a Save to Collection node whose
**Mark the item as used** is on. Throws a `NodaroError` with
`code: "not_available"` (503) on a server whose database predates the usage
release, and a `NotFoundError` (404) for a record that is not yours — or on an
older server, which has no such route.

```ts
const since = new Date(Date.now() - 48 * 3_600_000).toISOString()
let page = await client.collections.records(newsId, { since })
for (const record of page.data) console.log(record.title, record.url)
while (page.nextCursor) page = await client.collections.records(newsId, { since, cursor: page.nextCursor })
```

#### `addRecord(id, input, opts?)`

```ts
addRecord(
  id: string,
  input: { title?; text?; url?; media?; fields?; dedupeKey?; source?; item?: unknown },
  opts?: { idempotencyKey?: string },
): Promise<AddCollectionRecordResult>
```

`POST /v1/collections/:id/records` → save one record. Give the fields, or
`item` — any JSON (a feed post, a search result, an article object) the server
maps to a record (title ← `title` / `headline` / `name`, text ← `text` / `body`
/ `caption` / `description`, link ← `url` / `postUrl` / `link`, media, the rest
as `fields`); explicit fields win. The answer's `outcome` is `inserted`,
`duplicate` (the same link or dedupe key was already there — the existing
record comes back) or `replayed` (a write with the same `idempotencyKey`
already happened); `evicted` says how many of the oldest records went past
your cap.

```ts
// `posts` — any JSON items: a feed's posts, a search's results, articles an LLM wrote
for (const post of posts) {
  const { outcome, evicted } = await client.collections.addRecord(
    newsId,
    { item: post, fields: { topic: "tech" } },
    // One key per item, stable across retries: the item's own id or link, never a counter.
    { idempotencyKey: `telegram-${post.channel}-${post.id}` },
  )
  console.log(outcome, evicted) // "inserted" 0 · "duplicate" 0 · "replayed" 0
}
```

#### `deleteRecord(id, recordId)` / `deleteRecordForever(id, recordId)` / `restoreRecord(id, recordId)` / `bulkRecords(id, input)`

```ts
deleteRecord(id: string, recordId: string): Promise<void>
deleteRecordForever(id: string, recordId: string): Promise<void>
restoreRecord(id: string, recordId: string): Promise<CollectionRecord>
bulkRecords(id: string, input: { ids: string[]; action: "trash" | "restore" | "delete" }): Promise<{ updated: number }>
```

`deleteRecord` moves the record to the collection's **Trash** (`DELETE
/v1/collections/:id/records/:recordId`): it leaves every list, node read,
export and MCP read, keeps its dedupe key (the same story saved again is a
duplicate of it and stays in the Trash), still counts toward the cap, and
`restoreRecord` brings it back. `deleteRecordForever` removes a record that
is already in the Trash for good (`NodaroError` `not_in_trash`, 409, for a
live one). `bulkRecords` does any of the three for up to 100 records at
once; `updated` says how many of the ids were yours in that collection and
changed. On a server whose database predates the Trash every one of these
throws `NodaroError` `not_available` (nothing is deleted in the Trash's
stead).

#### `export(id, params?)`

```ts
export(id: string, params?: { format?: "csv" | "json"; since?: string; until?: string; usage?: "all" | "unused" | "used"; q?: string }): Promise<string>
```

`DELETE /v1/collections/:id/records/:recordId` removes one record.
`GET /v1/collections/:id/export` returns the whole collection as CSV (the
default) or JSON text, newest first, narrowed by `since` and `q`. The text is
read whole under the client's request timeout (`timeoutMs`, 60 s by default):
for a collection of many thousands of records, give the client a longer
timeout or narrow the export with `since`.

---

### `client.palettes`

Your colour palettes — 2–12 `#RRGGBB` colours under a name. On generate-image a
palette is a direction value: `direction.colorLook: paletteDirectionId(id)`
(`"palette:<id>"`) puts every colour, by an everyday name and its hex, into the
prompt. Yours only (another person's id answers 404). See
[Palettes and moodboards](./palettes-and-moodboards.md).

```ts
import { paletteDirectionId } from "@nodaro/sdk"

const palette = await client.palettes.create({ name: "Harbour", colors: ["#0F4C5C", "#E3B23C", "#F28C7A"] })
await client.nodes.runAndWait("generate-image", {
  prompt: "a lighthouse at dusk",
  direction: { colorLook: paletteDirectionId(palette.id) },
})
```

| Method | Returns | Notes |
|--------|---------|-------|
| `list(params?: ListPalettesParams)` | `Promise<PalettePage>` | Newest first. `limit` (1–100, default 50), `cursor`; the page carries `nextCursor`. |
| `get(id: string)` | `Promise<ColorPalette>` | |
| `create(input: CreatePaletteInput)` | `Promise<ColorPalette>` | `name` (1–80), `colors` (2–12 `#RRGGBB`, any case — stored upper case), `description?` (your note, up to 500 — not put into the prompt). |
| `update(id: string, input: UpdatePaletteInput)` | `Promise<ColorPalette>` | Only the fields you pass are written; `description: null` clears it. |
| `delete(id: string)` | `Promise<void>` | A run that still names it answers 404 `direction_not_found`. |

`PALETTE_DIRECTION_PREFIX` (`"palette:"`) and `paletteDirectionId(id)` build the
direction value. OAuth app tokens need `assets:read` for reads and
`assets:write` for writes.

---

### `client.moodboards`

Your moodboards — a description and 1–12 images. On generate-image a moodboard
is a direction value: `direction.style: moodboardDirectionId(id)`
(`"moodboard:<id>"`) puts its description into the prompt and sends its images
to the model as style references, after your own references and up to the
model's reference limit. Images are links (`http(s)`, never `localhost` or a
private address), never copies. See
[Palettes and moodboards](./palettes-and-moodboards.md).

```ts
import { moodboardDirectionId } from "@nodaro/sdk"

const board = await client.moodboards.create({
  name: "Nordic calm",
  description: "Moody Nordic interiors, soft daylight, linen and oak",
  images: [{ url: "https://example.com/a.png", caption: "soft daylight" }, { url: "https://example.com/b.png" }],
})
const out = await client.nodes.run("generate-image", {
  prompt: "a reading corner",
  direction: { style: moodboardDirectionId(board.id) },
})
// out.warnings → [{ code: "moodboard_images_not_sent", message }] when some images did not fit
```

| Method | Returns | Notes |
|--------|---------|-------|
| `list(params?: ListMoodboardsParams)` | `Promise<MoodboardPage>` | Newest first. `limit` (1–100, default 50), `cursor`; the page carries `nextCursor`. |
| `get(id: string)` | `Promise<Moodboard>` | |
| `create(input: CreateMoodboardInput)` | `Promise<Moodboard>` | `name` (1–80), `description?` (up to 1,000 — the words that go into the prompt), `images` (1–12 `{ url, caption? }`, caption up to 200). |
| `update(id: string, input: UpdateMoodboardInput)` | `Promise<Moodboard>` | Only the fields you pass are written; `images` replaces them all; `description: null` clears it. |
| `delete(id: string)` | `Promise<void>` | Deletes the moodboard only; the linked images are untouched. |

`MOODBOARD_DIRECTION_PREFIX` (`"moodboard:"`) and `moodboardDirectionId(id)`
build the direction value. `GenerateImageParams.direction` is typed
(`DirectionFields`), and a run's answer types `warnings?: RunNodeWarning[]`.
A malformed value answers 400, one that is not yours 404
`direction_not_found` — before anything is created or charged. A palette or
moodboard cannot be combined with `presetId` yet: that run answers 400
`validation_error`, as does a preset saved with one in its direction.

---

### `client.competitors`

Brands you track (competitors, or your own), their scans and the action
cards read from them. Nodaro Cloud. Adding, reading and website lookups are
free; a scan costs one Social Search page per search it runs
(`TrackedCompetitor.searches`), and searches that fail are not charged.
OAuth app tokens need `assets:read` / `assets:write`; a scan also needs a
`:write` or `:execute` scope.

| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /v1/competitors` | `TrackedCompetitor[]` |
| `listWithPlan()` | `GET /v1/competitors` | `CompetitorListResult` (`{ data, historyMonths }`: the brands, and how many months of scans your plan keeps) |
| `get(id, { scan? })` | `GET /v1/competitors/:id` | `CompetitorDetail` (latest scan with posts and cards, that scan per platform in `platforms`, scan history; with `scan`, the brand as of that scan) |
| `history(id)` | `GET /v1/competitors/:id/history` | `CompetitorHistory` (`{ scans }`: the brand's scans oldest first, per platform what each found and read; free) |
| `compare(id, { from, to, vsFrom?, vsTo? })` | `GET /v1/competitors/:id/compare` | `CompetitorCompareResult` (`{ periods, posts }`: one or two periods — posts by publish date, usual reach, followers and their change, what worked, the best posts; free) |
| `create(input)` | `POST /v1/competitors` | `TrackedCompetitor` |
| `update(id, input)` | `PATCH /v1/competitors/:id` | `TrackedCompetitor` (`accounts` replaces the whole set; `409 scan_running` for a change to what a running scan was priced on) |
| `delete(id)` | `DELETE /v1/competitors/:id` | `void` |
| `cards()` | `GET /v1/competitors/cards` | `CompetitorCardsResult` (`{ cards, posts, record, brands }`: `brands` gives each brand's latest scan per platform) |
| `lessons(id)` | `GET /v1/competitors/:id/lessons` | `CompetitorLessonsResult` (`{ lessons, posts }`: what the brand's best posts share, per platform; free) |
| `tried()` | `GET /v1/competitors/actions` | `CompetitorActionsResult` (`{ actions, record, posts }`: the cards you marked done and how each went; free) |
| `markDone(cardId, { postUrl? })` | `POST /v1/competitors/actions` | `CardActionResult` (`{ action, posts, created }`; a card marked before returns its mark) |
| `linkPost(markId, postUrl \| null)` | `PATCH /v1/competitors/actions/:id` | `CardActionResult` (the post's full link; `null` removes it) |
| `markSeen(markId)` | `PATCH /v1/competitors/actions/:id` | `CardActionResult` |
| `unmark(markId)` | `DELETE /v1/competitors/actions/:id` | `void` |
| `discover(website)` | `POST /v1/competitor-discover` | `CompetitorDiscovery` |
| `scan(id)` | `POST /v1/competitor-scan` | `{ jobId }` |

**Did it work?** `markDone` a card you acted on (with your post's link when
you have it). Each scan of your own brand (`isOwn`) then judges that post
against your usual on its platform once it is a few days old:
`action.outcome.state` is `worked`, `flat` or `missed` with `ratio`, `reach`
and `usual`, or says why there is no verdict yet. The first verdict stays
(`action.verdict`). `record` sums verdicts per family of advice (`sound`,
`outlier`, `launch`, `complaints`); `/cards` puts a `proven` family first
within each priority. See [API integration](./api-integration.md#16c-competitors-nodaro-cloud).

```ts
const found = await client.competitors.discover("acme.example")
const brand = await client.competitors.create({
  brand: found.brand,
  website: found.website,
  accounts: Object.fromEntries(Object.entries(found.accounts).map(([k, v]) => [k, v!.value])),
})
const { jobId } = await client.competitors.scan(brand.id)
// …poll client.jobs.getStatus(jobId) until completed, then:
const { cards, posts } = await client.competitors.cards()
for (const card of cards) console.log(card.title, "→", card.action, card.evidence.map((id) => posts[id]?.url))

// Did it work? Mark a card done with your post, then read how it went.
await client.competitors.markDone(cards[0]!.id, { postUrl: "https://www.tiktok.com/@you/video/123" })
const { actions, record } = await client.competitors.tried()
for (const a of actions) console.log(a.card.title, a.outcome.state, a.outcome.ratio)
for (const r of record.filter((r) => r.shown)) console.log(`${r.family}: ${r.worked} of ${r.tried} worked`)
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
`fields` (multi-dim), `optionCount`, and `imageCount` — how many of its options
carry an `imageUrl` (0 = no pictures; absent from servers that predate pictures).

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
`position` / `duration` / `intensity`; `character-motion`: `position` /
`pace`) carries both. 404 `not_found` for an unknown type.

**`GetPickerCatalogOptions`:**

| Field | Type | Description |
|-------|------|-------------|
| `detail` | `"compact"` \| `"full"` | `"compact"` (default): `id`, `label`, `category`, `term`, `icon`, `imageUrl` (when the option has a picture). `"full"`: additionally includes each option's `description` and `promptHint` (the prompt fragment it injects). |
| `category` | `string` | Single-dim pickers: filter options to one category. |
| `field` | `string` | Return only this dimension's field — multi-dim pickers (person / styling / framing), and the secondary parameters of a single-dim picker (transition / character-fx: `position` / `duration` / `intensity`; character-motion: `position` / `pace`). |

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

**Pictures.** Every option that has a picture carries an absolute **`imageUrl`**
(`PickerOption.imageUrl`), at both detail levels; an option without one has no
`imageUrl`. `person` and `styling` also return **`sections`**
(`PickerCatalogSection[]`): the topics the editor groups their settings under,
in order — `{ label, fields, imageUrl? }`, where `fields` are the settings'
node-data fields and `imageUrl` is the topic's round picture. Photos (person,
styling, held prop, material, animal) and the music / voice art are served by
the installation itself, so the URLs use its public address; the rendered look
previews come from the Nodaro CDN and only Nodaro Cloud returns them. Use the
URLs as given — file names carry a content hash, so they can be cached for good,
and any origin may load them. See
[Pictures](./api-integration.md#pictures-imageurl-sections) for the full rules.

```ts
const { data } = await client.pickerCatalogs.get("person")
for (const section of data.sections ?? []) {
  // e.g. { label: "Identity", fields: ["type", "age", "ethnicity", "regionalAesthetic"], imageUrl }
  const settings = data.dimensions?.filter((d) => section.fields.includes(d.field)) ?? []
  for (const setting of settings) {
    for (const option of setting.options) {
      renderTile(option.label, option.imageUrl) // imageUrl may be undefined: fall back to the label
    }
  }
}
```

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
| `llmModel` / `reasoningEffort` | `string?` | Standard LLM selection; billed under the route's own `text-to-picker` feature for the tokens its batches used, at the model's rate on the lane that served each ([LLM model rates](pricing/llm-models.md); a default run reads every picker's catalog). A typical run: ~16 credits<!-- credits: text-to-picker:gemini-3.8-flash --> on the default, ~53<!-- credits: text-to-picker:claude-sonnet-5.5 --> on Claude Sonnet 5.5, ~262<!-- credits: text-to-picker:claude-opus-5.5:direct --> on Claude Opus 5.5. Omitted, the run is Gemini 3.8 Flash at Auto — the describe-to-picker default — on the aggregator. `claude-opus-5.5` with no effort runs at `"high"` on Anthropic's own API; any other model with no effort keeps Auto. Claude Fable 5 is offered. |

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
list(opts?: { detail?: "compact" | "full" }): Promise<CatalogsListResponse>
// { curated: boolean; packs: number; version: number; data?: ProjectedCatalog[] }
```

`GET /v1/catalogs` → every registered catalog projected to one flat shape.
`data` is present only when the deployment registered catalog packs
(`curated: true`); with none (`curated: false`) the catalogs are the bundled
ones — read them per picker with `client.pickerCatalogs.get(nodeType)`.
Options carry the same `imageUrl`, and person / styling the same `sections`, as
`client.pickerCatalogs.get`.
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
const setting = data?.find((c) => c.catalogId === "setting")
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

#### `getFull(slug)`

```ts
getFull(slug: string): Promise<{ data: CommunityFullDetail }>
```

`GET /v1/community/detail/:slug/full` → the full read-only detail: the card
plus the stored public snapshot (assets, voice and text) needed to render the
whole listing.

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

A card's `estimatedCredits` is the template's listed price. When the price
follows the length of the recording the template is given,
`estimatedPerMinuteCredits` is above 0 and the price is `estimatedCredits` plus
that many credits per minute of the recording — the Tighten Episode template
lists `82` and `14`, or, on a deployment with the preview stop rule on (where it
renders a Preview first), `132` and `15`: its run plus its Render final. It is
absent or `0` otherwise.

The route also takes `sort=cheapest`, the Templates page's **Fewest credits**:
the price of a 60-minute recording first, lowest first (`estimatedCredits` plus
60 × `estimatedPerMinuteCredits`), so `82` + `14`/min sorts as `922` (`132` +
`15`/min, with the preview stop rule on, as `1032`). The SDK's
`TemplateSort` does not list it yet; pass it through `client.request()`.

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

### `client.edit`

Editorial primitives for podcast / long-form video editing. Eleven
request methods return `{ jobId }` (`EditJobResult`) — poll with
[`client.jobs.getStatus(jobId)`](#getstatusid) — plus five quotes
(`estimateTightenEpisode`, `estimateEpisodeChapters`, `estimateEpisodeTrailer`, `estimateClipPack`, `estimateSpeakerLayout`) and one pure local helper.

| Method | Endpoint | Notes |
|--------|----------|-------|
| `silenceDetect(input)` | `POST /v1/silence-detect` | Keyless ffmpeg silence pass over an audio **or** video source. |
| `audioSync(input)` | `POST /v1/audio-sync` | Keyless: measure how far apart 2–6 recordings' clocks are, from their sound. |
| `speakerMap(input)` | `POST /v1/speaker-map` | Keyless: which camera each speaker is on, from the cameras' own microphones. **Not yet enabled on nodaro.ai.** |
| `applyEdl(input)` | `POST /v1/apply-edl` | Render an edit decision list (EDL) into a video or audio cut. |
| `cameraSwitch(input)` | `POST /v1/camera-switch` | Multicam: put each cut of an EDL on the camera of whoever is speaking (Cloud; flat price). |
| `editPlan(input)` | `POST /v1/edit-plan` | Transcript-driven planner (tighten / clips / chapters / trailer). On a self-hosted install it relays to nodaro.ai (`503 nodaro_connection_required` when not connected). |
| `tightenEpisode(input, options?)` | `POST /v1/tighten-episode` | Tighten Episode: one recording in (or up to six of one conversation, with an optional Master audio — several need Speaker Map, not yet enabled on nodaro.ai), the tightened episode out — transcribe, plan, render, with optional captions, music and framing, in one call. Core; a self-hosted install needs a nodaro.ai connection for the steps that run there (`503 nodaro_connection_required` otherwise). |
| `estimateTightenEpisode(input)` | `POST /v1/tighten-episode/estimate` | What a Tighten Episode run is estimated at. Nothing is created or charged. |
| `episodeChapters(input, options?)` | `POST /v1/episode-chapters` | Chapters: one recording in, its chapters out — transcribe, then plan the chapters, in one call; nothing is rendered. Core; a self-hosted install needs a nodaro.ai connection (`503 nodaro_connection_required` otherwise). **Not yet enabled on nodaro.ai.** |
| `estimateEpisodeChapters(input)` | `POST /v1/episode-chapters/estimate` | What a Chapters run is estimated at. Nothing is created or charged. |
| `episodeTrailer(input, options?)` | `POST /v1/episode-trailer` | Trailer: one video recording in (or up to six of one conversation, with an optional Master audio — several need Speaker Map, not yet enabled on nodaro.ai), a 20–40 second trailer out in each chosen social format (padded, never cropped), optionally after an intro card, in one call. Core; a self-hosted install needs a nodaro.ai connection (`503 nodaro_connection_required` otherwise). **Not yet enabled on nodaro.ai.** |
| `estimateEpisodeTrailer(input)` | `POST /v1/episode-trailer/estimate` | What a Trailer run is estimated at. Nothing is created or charged. |
| `clipPack(input, options?)` | `POST /v1/clip-pack` | Clip Pack: one recording in (or up to six of one conversation, with an optional Master audio — several need Speaker Map, not yet enabled on nodaro.ai), a pack of short clips out — each framed for 9:16 with the speakers stacked and captioned by default (audio clips for an audio recording), in one call. Core; a self-hosted install needs a nodaro.ai connection (`503 nodaro_connection_required` otherwise). **Not yet enabled on nodaro.ai.** |
| `estimateClipPack(input)` | `POST /v1/clip-pack/estimate` | What a Clip Pack run is estimated at. Nothing is created or charged. |
| `speakerLayout(input, options?)` | `POST /v1/speaker-layout` | Speaker Layout: one video recording in (or up to six of one conversation, with an optional Master audio — several need Speaker Map, not yet enabled on nodaro.ai), the whole recording framed by speaker out — the same length, nothing cut — in one call. Core; a self-hosted install needs a nodaro.ai connection (`503 nodaro_connection_required` otherwise). **Not yet enabled on nodaro.ai.** |
| `estimateSpeakerLayout(input)` | `POST /v1/speaker-layout/estimate` | What a Speaker Layout run is estimated at. Nothing is created or charged. |
| `continueUseCase(input, options?)` | `POST /v1/<type>/continue` (`/v1/tighten-episode/continue`, `/v1/episode-chapters/continue`, `/v1/episode-trailer/continue`, `/v1/clip-pack/continue`, `/v1/speaker-layout/continue`) | Continue a Tighten Episode, Chapters, Trailer, Clip Pack or Speaker Layout run as a new job: from where it failed, or (Tighten Episode, Trailer, Clip Pack, Speaker Layout) its Render final after a review. The route is the run's own type. |
| `remapTranscript(edl, transcript)` | — (local) | PURE client-side transform — remaps a transcript through an EDL. **No request.** |

#### `silenceDetect(input)`

```ts
silenceDetect(input: SilenceDetectInput): Promise<EditJobResult>
```

**`SilenceDetectInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audioUrl` | `string` | yes | Audio or video source (the pass reads the shared audio proxy either way). |
| `thresholdDb` | `number` | no | dBFS threshold, ≤ 0. Default `-35`. |
| `minSilenceMs` | `number` | no | Minimum silence length to report. Default `700`. |
| `padMs` | `number` | no | Padding kept around speech (shrinks each range inward). Default `120`. |
| `workflowId` | `string` | no | Associates the run with a workflow (execution-history display). |

The finished job's `output_data.json` is a `SilenceRanges` object
(`{ version, ranges: [{ startMs, endMs }], durationMs }`) — pass that whole
object as `editPlan`'s `silence`.

#### `audioSync(input)`

```ts
audioSync(input: AudioSyncInput): Promise<EditJobResult>
```

**`AudioSyncInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sources` | `AudioSyncSource[]` | yes | 2–6 recordings of one conversation. Each: `{ id, url }` — `id` (1–200 chars, unique) comes back as the offset's `sourceId`; `url` is an audio **or** video source. Use the ids your EDL gives the same recordings. |
| `reference` | `string` | no | The id of the source every offset is measured against (its own offset is `0`). Must be one of `sources`' ids. Default: the first source. |
| `workflowId` | `string` | no | Execution-history display. |

The finished job's `output_data.json` is an `AudioSyncResult`:

```ts
{
  version: number
  reference: string            // the source every offset is measured against
  offsets: Array<{
    sourceId: string
    offsetMs: number           // referenceMs = sourceMs + offsetMs (integer ms)
    confidence: number         // 0–1; below 0.5 a note asks for a check by ear
    driftMsPerHour: number | null // measured, never corrected; null when the overlap was too short
  }>
  notes: string[]              // low confidence, drift past 33 ms over the overlap, no shared sound
}
```

With the master recording as `reference`, each `offsetMs` is exactly that
source's `EdlSource.offsetMs` (`masterMs = sourceMs + offsetMs`). Credits:
`10 × (sources − 1)` — 2 sources 10, 4 sources 30, 6 sources 50. A malformed
request (fewer than 2 or more than 6 sources, a repeated id, a `reference`
that is not one of the ids) throws a `NodaroError` (status 400,
`code: "validation_error"`) naming the problem, before any credits are
reserved.

```ts
const { jobId } = await client.edit.audioSync({
  sources: [
    { id: "mic", url: micUrl },
    { id: "camA", url: camAUrl },
  ],
})
const sync = (await client.jobs.getStatus(jobId)).data.output_data.json // AudioSyncResult
```

#### `speakerMap(input)`

**Not yet enabled on nodaro.ai.**

```ts
speakerMap(input: SpeakerMapInput): Promise<EditJobResult>
```

**`SpeakerMapInput`** (from `@nodaro/sdk/edit`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sources` | `SpeakerMapSource[]` | yes | 2–6 recordings: the cameras, and the master / wide when you name them. Each: `{ id, url, kind? }` — `kind: "audio"` marks a sound-only recording (never anyone's camera); `id` (1–200 chars, unique) is the camera id the map names; use the ids your EDL gives the same recordings. `url` is an audio **or** video source. |
| `transcript` | `Transcript` | yes | The transcript WITH speaker labels. |
| `offsets` | `AudioSyncResult` | no | An `audioSync` result over the same ids; omit when the recordings already share a clock. |
| `masterSourceId` | `string` | no | The master audio: hears everyone, so it is no one's camera. |
| `wideSourceId` | `string` | no | The wide shot: no one's camera; a speaker with no clear camera is shown on it. |
| `marginDb` | `number` | no | How much louder (dB) the loudest camera must be than the next for a speaker to get it, 0–30. Default `3`. |
| `workflowId` | `string` | no | Execution-history display. |

The finished job's `output_data.json` is a `SpeakerMapResult`:

```ts
{
  version: 1
  speakerMap: Record<string, string>   // speaker label → camera id; "" = no clear camera (the wide shot)
  confidence: Record<string, { camera: string; marginDb: number | null }> // the loudest camera's lead over the next
  notes: string[]                      // no clear camera, a camera with no sound, …
  edl?: Edl                            // the recordings as one edit (also on output_data.edl)
}
```

and `output_data.edl` the recordings as one edit on the master clock. While a
speaker talks, the camera that hears them loudest by at least `marginDb` is
theirs; a camera that heard nothing is a note, never a failure. Flat 11 credits<!-- credits: speaker-map -->
per run. A malformed request throws a `NodaroError` (400,
`code: "validation_error"`); a transcript with no speaker labels, 422
`no_speakers` — both before any credits are reserved.

```ts
const { jobId } = await client.edit.speakerMap({
  sources: [{ id: "camA", url: camAUrl }, { id: "camB", url: camBUrl }, { id: "wide", url: wideUrl }],
  transcript,
  offsets: sync,          // an audioSync result
  wideSourceId: "wide",
})
const map = (await client.jobs.getStatus(jobId)).data.output_data.json // SpeakerMapResult
await client.edit.cameraSwitch({ edl, transcript, speakerMapResult: map })
```

#### `applyEdl(input)`

```ts
applyEdl(input: ApplyEdlInput): Promise<EditJobResult>
```

**`ApplyEdlInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `edl` | `Edl` | yes | The edit decision list to render. Media resolves from each `edl.sources[i].url`. |
| `sources` | `string[]` | no | Positional media-URL overrides for `edl.sources[i].url`. |
| `transcript` | `Transcript` | no | Transcript remapped through the cut and returned on the job's `json` output. For a **large** transcript where you only need the re-timed result, use `remapTranscript` locally instead. |
| `output` | `"video" \| "audio"` | no | Default `"video"`. |
| `quality` | `"proxy" \| "final"` | no | Default `"final"`. `"proxy"` is a 720p preview (lighter mono sound on an audio cut), billed per output minute at its own, lower rate — see [Apply EDL](nodes/processing-video/apply-edl.md#credit-cost). |
| `crossfadeMs` | `number` | no | Default crossfade on boundaries without an explicit transition; `0` = hard cuts. Default `0`. |
| `clipKey` | `string` | no | The plan clip this render cuts — `edlSpanKey(clip)` from `@nodaro/shared` (`"<first inMs>-<last outMs>"`). Returned on the job's `output_data.clipKey`. |
| `planBasis` | `string` | no | The plan value this render cuts — `renderReadBasis(value)` from `@nodaro/shared`, 16 lowercase hex digits, where `value` is the Edit Plan's Tighten EDL with any review applied, or the clip this render cuts. A hook edit does not change it. Returned on the job's `output_data.planBasis`. Send it only when the EDL you send is that value itself, not one a later step re-cut from an older plan. Anything other than 16 lowercase hex digits is a `400`. |
| `workflowId` | `string` | no | Execution-history display. |

The finished job's `output_data` carries the cut (`videoUrl` + `thumbnailUrl`, or `audioUrl`), the remapped transcript on `json` when one was sent, `quality` (`"proxy"` or `"final"`), `renderBasis` and, when given, `clipKey` and `planBasis`. `renderBasis` is stamped by the server from what it renders: the fingerprint (`renderSettingsBasis` in `@nodaro/shared`) of the render's `output`, its `crossfadeMs` and the URL of each source of the cut, with `sources` applied. Two renders of the same plan value with the same `planBasis` and `renderBasis` cut the same edit. A `proxy` render is a **preview**: always private, never in the public gallery (see [Apply EDL](nodes/processing-video/apply-edl.md#previews)). A job recorded before `quality` was written reads back with the quality it was ordered at filled in (`"proxy"` is a preview, anything else the final) by `jobs.get`, `jobs.getStatus` and `jobs.list`; the stored job is unchanged.

The EDL is validated at ingress — an unresolvable source, a picture-less
segment on a video edit, or an edit longer than **180 minutes of output**
(the per-render limit, measured on the crossfade-compressed length) throws a
`NodaroError` (status 400, `code: "invalid_edl"`) before any credits are
reserved. Its `message` names the problem, e.g. `EDL failed validation: the
edit renders 200 minutes of output — over the 180-minute limit for one render;
split it into parts of at most 180 minutes`.

#### `tightenEpisode(input, options?)` / `estimateTightenEpisode(input)`

```ts
tightenEpisode(input: TightenEpisodeInput, options?: { idempotencyKey?: string }): Promise<TightenEpisodeJobResult>
estimateTightenEpisode(input: TightenEpisodeInput): Promise<{ data: TightenEpisodeEstimate }>
```

Tighten a podcast recording in one call: the run transcribes it, plans the
tightened cut, renders it and — as set — captions it, frames it and lays a
music bed under it. Only the recording is required (`mediaUrl`, or
`mediaUrls`); a field left out takes the node's default.

**`TightenEpisodeInput`** (with `UseCaseRecordingsInput`, its recordings):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaUrl` | `string` | `mediaUrl` or `mediaUrls` | The recording — a video or audio URL, up to 3 hours. Sent as `mediaUrls: [mediaUrl]`. |
| `mediaUrls` | `string[]` | `mediaUrl` or `mediaUrls` | Instead of `mediaUrl`: the recordings of one conversation, in order (Camera 1, Camera 2…; one may be sound only) — up to six in all with the Master audio; without one, two or more cameras keep a place for the sound, so up to five. See [Several cameras](./nodes/processing-video/tighten-episode.md#several-cameras). **Needs Speaker Map** (below). |
| `masterAudioUrl` | `string` | no | The mixer or recorder track: the episode's sound and the clock the recordings are lined up to. **Needs Speaker Map** (below). |
| `cameras` | `{ wide?, synced?, speakerCameras? }` | no | With several recordings or a Master audio: `wide`, the recording number of the wide shot (`null` for none); `synced: true` when the recordings already share one clock; `speakerCameras`, a speaker number (`"1"` = the first voice heard) → a recording number, `0` for the wide shot, overriding the automatic map. Ignored on one recording with no Master audio. |
| `musicUrl` | `string` | no | A music bed, ducked under the voice and ending with the episode. |
| `output` | `"video" \| "audio"` | no | An audio recording always makes an audio episode. |
| `framing` | `{ aspect, layout } \| null` | no | Frame a video episode with Speaker View, on automatic boxes over the speakers on screen. `aspect`: `"16:9"` \| `"9:16"` \| `"1:1"` \| `"4:5"`; `layout`: `"auto"` \| `"single"` \| `"side-by-side"` \| `"stacked"` \| `"grid"` \| `"pip"` (a layout the aspect does not draw is snapped to one it does). `null` or absent: no framing. |
| `framingSource` | `"auto" \| "static" \| "tracking"` | no | With a framing, how it follows the speakers ([Following faces](./nodes/processing-video/tighten-episode.md#following-faces)): `"static"` (absent) splits the frame evenly by speaker; `"tracking"` follows faces with Speaker Frames (charged per started block of 1,000 sampled frames; a camera shared by several speakers keeps the even split until faces are named; refused `403 node_not_available` where Speaker Frames is not available to the caller); `"auto"` follows faces while Speaker Frames is available to the caller, else the even split. Ignored without a framing. |
| `captions` | `boolean` | no | Captions on a video episode (on by default). |
| `captionStyle` | `CaptionStyle` | no | The captions' look. |
| `reviewBeforeRender` | `boolean` | no | Stop at a quick preview for a person to review; render the full-quality episode afterwards with `continueUseCase({ mode: "render-final" })`. |
| `planTier` | `EditPlanTier` | no | `"economy"` \| `"standard"` \| `"premium"`. |
| `instructions` | `string` | no | Editing instructions for the planner (up to 4 000 characters). |
| `styleGuide` | `string` | no | A style guide for the planner (up to 4 000 characters). |
| `musicDuckAmount` | `number` | no | How far the music dips under the voice, 0–100 (default 75). |

Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a
`TypeError` before any request. **Several recordings or a Master audio need Speaker Map**,
which is not yet enabled on nodaro.ai: until it is, such a request is refused
`403 node_not_available` before anything is probed or charged — send one
recording.

`options.idempotencyKey` is sent as the `Idempotency-Key` header: retry the
same request with the same key and the answer is the run already started
(`deduped: true`), not a second one.

`tightenEpisode` answers `TightenEpisodeJobResult` (the same shape as `UseCaseJobResult`) — `{ jobId, executionId?, deduped? }`.
Poll `jobId`: the finished job's `output_data` holds the episode (`videoUrl`,
or `audioUrl` for an audio episode), the plan's EDL on `json`, and `quality`
(`"proxy"` for a review-on run's preview, `"final"` otherwise). A run on
several recordings or a Master audio adds `cameras`: `{ speakers: [{ speaker,
ordinal, camera, marginDb }], syncNotes, mapNotes }` — who was put on which
recording (`camera` `null` = the wide shot).

`estimateTightenEpisode` answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec, estimate? } }`:
the run's steps at their own rates plus its fee of 11 credits<!-- credits: use-case-fee:tighten-episode --> per run.
The estimate leans high — the render is priced at the recording's full length
and a framed episode's Speaker View at its higher rate, before the edit is
known; the charge follows the minutes actually rendered. On an edition without
credits every credit amount is 0 (`durationSec` is still the recording's). `durationSec` is `null` when the recording's length
could not be read.

Both refuse before anything is created or charged: `400` (`validation_error`,
`media_unreadable`, `media_has_no_audio`, `media_too_long`,
`music_has_no_audio`, and on several recordings `too_many_recordings`,
`recordings_two_audio_only`, `wide_camera_out_of_range`, `invalid_cameras`),
`403 node_not_available`, `503
nodaro_connection_required` (a self-hosted install not connected to nodaro.ai)
or `503 use_case_unavailable`. `tightenEpisode` also throws
`InsufficientCreditsError` when the balance does not cover the estimate.

#### `episodeChapters(input, options?)` / `estimateEpisodeChapters(input)`

```ts
episodeChapters(input: EpisodeChaptersInput, options?: { idempotencyKey?: string }): Promise<UseCaseJobResult>
estimateEpisodeChapters(input: EpisodeChaptersInput): Promise<{ data: UseCaseEstimate }>
```

List a podcast recording's chapters in one call: the run transcribes it, then
plans its chapters, each with a title and a start time. Nothing is rendered.
Only `mediaUrl` is required; a field left out takes the node's default.
**Not yet enabled on nodaro.ai** (see the [node page](./nodes/processing-video/episode-chapters.md)).

**`EpisodeChaptersInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaUrl` | `string` | one of the two | The recording — a video or audio URL, up to 3 hours. Sent as `mediaUrls: [mediaUrl]`. |
| `mediaUrls`, `masterAudioUrl`, `cameras` | | no | Instead of `mediaUrl`: the recordings of one conversation, as on `tightenEpisode` ([`UseCaseRecordingsInput`](#tightenepisodeinput-options--estimatetightenepisodeinput)). Several need Speaker Map (refused `403 node_not_available` where it is not available to you). Both `mediaUrl` and `mediaUrls`, or neither, reject with a `TypeError` before any request. |
| `planTier` | `EditPlanTier` | no | `"economy"` (default) \| `"standard"` \| `"premium"`. |
| `instructions` | `string` | no | Instructions for the chapters, e.g. "5 to 8 chapters" (up to 4 000 characters). |
| `styleGuide` | `string` | no | A style guide for the chapter titles (up to 4 000 characters). |

`options.idempotencyKey` works as on `tightenEpisode`.

`episodeChapters` answers `UseCaseJobResult` — `{ jobId, executionId?, deduped? }`.
Poll `jobId`: the finished job's `output_data.text` is the chapter list as
show notes — one `M:SS Title` line per chapter (once a chapter starts at
1:00:00 or later, every line is `H:MM:SS`), the first at 0:00, the times
strictly increasing (two chapters in the same second keep the first) — and
`output_data.json` the list itself, `[{ startMs, title }]`, the same rows; the
first starts at 0. A run that finds no
chapters fails ("The plan found no chapters in this recording."), and its fee
is refunded.

`estimateEpisodeChapters` answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec, estimate? } }`:
the run's steps at their own rates plus its fee of 11 credits<!-- credits: use-case-fee:episode-chapters --> per run.
A recording whose length cannot be read is estimated at the 180-minute
ceiling. Both refuse before anything is created or charged, with the codes
`tightenEpisode` lists (less the music ones).

#### `episodeTrailer(input, options?)` / `estimateEpisodeTrailer(input)`

```ts
episodeTrailer(input: EpisodeTrailerInput, options?: { idempotencyKey?: string }): Promise<UseCaseJobResult>
estimateEpisodeTrailer(input: EpisodeTrailerInput): Promise<{ data: UseCaseEstimate }>
```

Cut a 20–40 second trailer from a podcast recording in one call and deliver
it in each chosen social format: the run transcribes the recording, plans the
trailer from its strongest moments (the plan picks the length and joins the
moments with its own short crossfades; neither is a setting), renders it,
plays an optional intro card first, and pads it to every format — never
cropped. Only the recording is required (`mediaUrl`, or `mediaUrls`); a field
left out takes the node's default. **Not yet enabled on nodaro.ai** (see the [node page](./nodes/processing-video/episode-trailer.md)).

**`EpisodeTrailerInput`** (with `UseCaseRecordingsInput`, its recordings):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaUrl` | `string` | `mediaUrl` or `mediaUrls` | The recording — a video URL, up to 3 hours (an audio-only recording is refused `media_needs_video`). Sent as `mediaUrls: [mediaUrl]`. |
| `mediaUrls` | `string[]` | `mediaUrl` or `mediaUrls` | Instead of `mediaUrl`: the recordings of one conversation, in order (Camera 1, Camera 2…) — up to six in all with the Master audio; without one, two or more cameras keep a place for the sound, so up to five. See [Several cameras](./nodes/processing-video/episode-trailer.md#several-cameras). **Needs Speaker Map** (as on `tightenEpisode`). |
| `masterAudioUrl` | `string` | no | The mixer or recorder track: the trailer's sound and the clock the recordings are lined up to. **Needs Speaker Map**. |
| `cameras` | `{ wide?, synced?, speakerCameras? }` | no | With several recordings or a Master audio: as on `tightenEpisode`. Ignored on one recording with no Master audio. |
| `introCardUrl` | `string` | no | A short video, 15 s at most, played before the trailer. Make it the recording's size and shape, or one of the two is letterboxed. |
| `formats` | `TrailerFormat[]` | no | `"9:16"` \| `"1:1"` \| `"4:5"` \| `"16:9"` (the list is exported as `TRAILER_FORMATS`; 16:9 is a 1920×1080 landscape). Default `["9:16", "1:1", "4:5"]`. At least one: an empty list is sent as is and refused `400 validation_error`. |
| `reviewBeforeRender` | `boolean` | no | Stop at a quick preview of the trailer for a person to review; render every format afterwards with `continueUseCase({ mode: "render-final" })`. |
| `planTier` | `EditPlanTier` | no | `"economy"` \| `"standard"` (default) \| `"premium"`. |
| `instructions` | `string` | no | Instructions for the trailer (up to 4 000 characters). |
| `styleGuide` | `string` | no | A style guide for the planner (up to 4 000 characters). |

`options.idempotencyKey` works as on `tightenEpisode`. Passing both `mediaUrl`
and `mediaUrls`, or neither, rejects with a `TypeError` before any request;
several recordings or a Master audio are refused `403 node_not_available`
where Speaker Map is not available to you (not yet on nodaro.ai).

`episodeTrailer` answers `UseCaseJobResult` — `{ jobId, executionId?, deduped? }`.
Poll `jobId`: the finished job's `output_data.formats` is `[{ format, url }]`,
one trailer per chosen format in format order, and `output_data.videoUrl` the
trailer of the first chosen format that rendered (`formats[0]`); `output_data.json` is the trailer's EDL and `quality`
is `"proxy"` for a review-on run's preview (`videoUrl` is then the preview, and
`formats` is `[]` until the Render final), `"final"` otherwise. A format that
could not be rendered is named in `output_data.failedFormats`: the run
completes with the others, keeps its fee and is not charged for that format.
A run with no format rendered fails, and its fee is refunded. A run on several
recordings or a Master audio adds `output_data.cameras`, as on `tightenEpisode`.

`estimateEpisodeTrailer` answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec, estimate? } }`:
the run's steps at their own rates plus its fee of 11 credits<!-- credits: use-case-fee:episode-trailer --> per run.
The trailer is quoted at 40 seconds, the longest trailer the plan cuts (its
render, and Combine Videos with an intro card); a Render final
(`continueUseCase`) is quoted on the trailer the run cut (with the review's
edits), plus the intro card. Both refuse before anything is created
or charged, with the codes `tightenEpisode` lists (less the music ones), plus
`400 media_needs_video` (an audio-only recording), `400 intro_card_unreadable`
(an intro card that is not a playable video) and `400 intro_card_too_long`
(longer than 15 s).

#### `clipPack(input, options?)` / `estimateClipPack(input)`

```ts
clipPack(input: ClipPackInput, options?: { idempotencyKey?: string }): Promise<UseCaseJobResult>
estimateClipPack(input: ClipPackInput): Promise<{ data: UseCaseEstimate }>
```

Cut a podcast recording into a pack of short clips in one call: the run
transcribes the recording, plans the clips (each with a title and a hook),
renders each as its own clip — framed with Speaker View on automatic boxes
by default, every clip boxed alike over the episode's speakers — and
captions each on its own transcription. An audio recording makes audio
clips, with no framing or captions. Only the recording is required; a field
left out takes the node's default. It takes the cameras of one conversation
as Tighten Episode does (`mediaUrls`, `masterAudioUrl`, `cameras` —
`ClipPackInput` extends `UseCaseRecordingsInput`; each clip then cuts to
whoever is talking), with the same need for Speaker Map. **Not yet enabled on
nodaro.ai** (see the [node page](./nodes/processing-video/clip-pack.md)).

**`ClipPackInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaUrl` | `string` | yes | The recording — a video or audio URL, up to 3 hours. Sent as `mediaUrls: [mediaUrl]`. |
| `count` | `number` | no | How many clips to find, 1–50 (default 8). The plan may find fewer. |
| `targetDurationSec` | `number` | no | Each clip's target length in seconds, 5–180 (default 60; the bounds are exported as `CLIP_PACK_MIN_TARGET_SEC` / `CLIP_PACK_MAX_TARGET_SEC`). |
| `framing` | `{ aspect, layout?, switchType?, emphasisStyle? } \| null` | no | Frame each video clip with Speaker View: `aspect` (`"16:9"` \| `"9:16"` \| `"1:1"` \| `"4:5"`), `layout` (default `"stacked"`; one the shape does not draw is snapped), `switchType` (`SpeakerSwitchId` from `@nodaro/shared/edl`: `"cut"`, `"pan"`, `"zoom"` or `"xfade:<transition>"`, listed in `SPEAKER_SWITCH_IDS`; default `"pan"`), `emphasisStyle` (`ClipPackEmphasis`, default `"scale"`; `"none"`, or `"scale"`, `"border"` and `"dim"` joined with `"+"`, each once — any other is refused `400 validation_error`). Left out: 9:16, stacked, pan, scale. `null`: no framing (the recording's shape). |
| `framingSource` | `"auto" \| "static" \| "tracking"` | no | With a framing, how it follows the speakers: `"static"` splits the frame evenly (what a request that leaves this out gets); `"tracking"` runs Speaker Frames once over the whole pack (charged per started block of 1,000 sampled frames; refused 403 where Speaker Frames is not available to you); `"auto"` follows faces while Speaker Frames is available to you, else the even split. |
| `captions` | `boolean` | no | Caption each video clip (default `true`). |
| `captionStyle` | `CaptionStyle` | no | The captions' look (default `"karaoke"`). |
| `reviewBeforeRender` | `boolean` | no | Stop at quick previews of the clips for a person to review; render the kept clips afterwards with `continueUseCase({ mode: "render-final", editedEdl })`. |
| `planTier` | `EditPlanTier` | no | `"economy"` \| `"standard"` (default) \| `"premium"`. |
| `instructions` | `string` | no | Instructions for picking the clips (up to 4 000 characters). |
| `styleGuide` | `string` | no | A style guide for the planner (up to 4 000 characters). |

`options.idempotencyKey` works as on `tightenEpisode`.

`clipPack` answers `UseCaseJobResult` — `{ jobId, executionId?, deduped? }`.
Poll `jobId`: the finished job's `output_data.clips` is
`[{ url, title?, hook?, clipKey, thumbnailUrl?, captionsFailed? }]`, one
entry per clip in the plan's order (`thumbnailUrl` on each video clip), and
`output_data.videoUrl` the first clip (`audioUrl` for audio clips);
`output_data.json` is the plan's clip set and `quality` is `"proxy"` for a
review-on run's previews, `"final"` otherwise; a run on several recordings
adds `output_data.cameras`. Every clip is tried: a clip that could not be
rendered (or, on several cameras, whose camera switch failed) is skipped and
not charged, and counted in `output_data.failedClips`; the run completes with the others and keeps its
fee. A clip whose captions could not be added comes uncaptioned, marked
`captionsFailed: true` and counted in `output_data.failedCaptions`; those
captions are not charged. A run with no clip rendered fails, and its fee is
refunded.

`estimateClipPack` answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec, estimate? } }`:
the run's steps at their own rates plus its fee of 11 credits<!-- credits: use-case-fee:clip-pack --> per run.
Each clip is quoted at twice the target length (the charge follows each
clip's real length); a Render final (`continueUseCase`) is quoted on the
clips the run cut that the review keeps. Both refuse before anything is
created or charged, with the codes `tightenEpisode` lists (less the music
ones).

#### `speakerLayout(input, options?)` / `estimateSpeakerLayout(input)`

```ts
speakerLayout(input: SpeakerLayoutInput, options?: { idempotencyKey?: string }): Promise<UseCaseJobResult>
estimateSpeakerLayout(input: SpeakerLayoutInput): Promise<{ data: UseCaseEstimate }>
```

Frame a whole recording by speaker in one call — the same length, nothing
cut: the run transcribes the recording and frames each speaker with Speaker
View over the whole of it. With several recordings of one conversation, they
are lined up and each speaker is shown on their own camera. Only the
recording is required (`mediaUrl`, or `mediaUrls`); a field left out takes
the node's default. **Not yet enabled on nodaro.ai** (see the
[node page](./nodes/processing-video/speaker-layout.md)).

**`SpeakerLayoutInput`** (with `UseCaseRecordingsInput`, its recordings, as on `tightenEpisode`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaUrl` | `string` | `mediaUrl` or `mediaUrls` | The recording — a video URL, up to 3 hours (a run with no picture is refused `400 media_needs_video`). Sent as `mediaUrls: [mediaUrl]`. |
| `mediaUrls`, `masterAudioUrl`, `cameras` | | no | Several recordings of one conversation, as on `tightenEpisode` (see [Several cameras](./nodes/processing-video/speaker-layout.md#several-cameras)). **Needs Speaker Map.** |
| `targetAspect` | `EdlTargetAspect` | no | `"16:9"` \| `"9:16"` (default) \| `"1:1"` \| `"4:5"`. With one recording, a video already as narrow as the shape (or narrower) is refused `400 media_shape`. |
| `layout` | `"auto" \| "single" \| "side-by-side" \| "stacked" \| "grid" \| "pip"` | no | Default `"stacked"`; a layout the shape does not draw is snapped to one it does. |
| `switchType` | `SpeakerSwitchId` | no | The switch at each speaker change (default `"cut"`): `"cut"`, `"pan"`, `"zoom"` or `"xfade:<transition>"`, listed in `SPEAKER_SWITCH_IDS` from `@nodaro/shared/edl`. Any other is refused `400 validation_error`. |
| `emphasisStyle` | `ClipPackEmphasis` | no | Default `"scale"`; `"none"`, or `"scale"`, `"border"` and `"dim"` joined with `"+"`, each once — any other is refused `400 validation_error`. |
| `framingSource` | `"auto" \| "static" \| "tracking"` | no | How the speakers are followed ([Following faces](./nodes/processing-video/speaker-layout.md#following-faces)): `"auto"` (absent) follows faces with Speaker Frames while it is available to the caller, else the even split; `"static"` splits the frame evenly by speaker; `"tracking"` follows faces (charged per started block of 1,000 sampled frames; refused `403 node_not_available` where Speaker Frames is not available to the caller). Faces aren't named after a speaker yet, so a camera shared by several speakers keeps the even split. |
| `reviewBeforeRender` | `boolean` | no | Stop at a quick preview; render it at full quality afterwards with `continueUseCase({ mode: "render-final" })` — with no `editedEdl`: the layout has no cut to change. |

`options.idempotencyKey` works as on `tightenEpisode`. Passing both
`mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any
request.

`speakerLayout` answers `UseCaseJobResult` — `{ jobId, executionId?, deduped? }`.
Poll `jobId`: the finished job's `output_data.videoUrl` is the framed video,
`durationSec` its length, `json` the edit Speaker View drew, `transcript` the
transcript and `quality` `"proxy"` for a review-on run's preview, `"final"`
otherwise; a run on several recordings or a Master audio adds `cameras`, who
was put on which camera. A run on one recording reads the recording's size
before it starts, and may be refused `429 rate_limit_exceeded` (try again in a
moment) when you start too many of those in a minute.

`estimateSpeakerLayout` answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec, estimate? } }`:
the run's steps at their own rates plus its fee of 11 credits<!-- credits: use-case-fee:speaker-layout --> per run.
Speaker View is quoted at its higher rate over the recording's full length (a
recording whose length cannot be read at the 180-minute ceiling); a Render
final (`continueUseCase`) is quoted on the render alone, with no fee. The
estimate never downloads the recording: it refuses a shape (`media_shape`)
only when the recording's size is already known; otherwise the run refuses it.

#### `continueUseCase(input, options?)`

```ts
continueUseCase(input: UseCaseContinueInput, options?: { idempotencyKey?: string }): Promise<UseCaseJobResult>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | `string` | yes | The run to continue — the job `tightenEpisode`, `episodeChapters`, `episodeTrailer`, `clipPack` or `speakerLayout` (or an earlier continuation) answered. |
| `mode` | `"from-failed" \| "render-final"` | yes | `"from-failed"`: keep the steps that finished and run the rest; the fee is held again (the failed run's was refunded). `"render-final"`: render the full-quality result after a review-on preview (Tighten Episode's episode; Trailer's trailer, intro card and every format; Clip Pack's kept clips, each captioned; Speaker Layout's framed video), with the preview's settings and no fee (a Chapters run renders nothing: `render_final_not_preview`). |
| `editedEdl` | `unknown` | no | `"render-final"` only: the reviewer's edit of the plan (an EDL; for a Clip Pack, `{ v: 1, kind: "clips", basis, clips: [{ keep, hook? }] }`, which keeps or drops each clip — one that drops every clip is refused `use_case_nothing_kept`, 409, before anything is held; a Speaker Layout run has no plan, so an `editedEdl` is refused `use_case_no_plan`, 400, before anything is read). |
| `nodeType` | `UseCaseNodeType` | no | The run's node type (`"tighten-episode"` \| `"episode-chapters"` \| `"episode-trailer"` \| `"clip-pack"` \| `"speaker-layout"`; the list is exported as `USE_CASE_NODE_TYPES`). The continuation goes to `POST /v1/<nodeType>/continue`. Never part of the request body. A value that is not in the list throws a `NodaroError` (`invalid_node_type`, 400) before any request. |

**Which route.** With `nodeType`, the continuation goes straight to that
type's route. Without it, `continueUseCase` first reads the job
(`GET /v1/jobs/:id`) for the type the run records (`input_data.type`, else
its `job_type`), then continues on that type's route. That read needs the
`jobs:read` scope on a connected app's token. When the type cannot be read —
a token without that scope (`403 insufficient_scope` naming `jobs:read`), or a
job that records no use-case type — `continueUseCase` throws a `NodaroError`
(`use_case_type_unknown`, 400) asking for `nodeType`, and nothing is posted: no
route is guessed for the run. Any other refusal of the read is thrown as is.
Pass `nodeType` to skip the read. A version of the SDK from before Chapters
knows only `"tighten-episode"`, so it continues a Chapters run on the Tighten
Episode route, which answers `not_found`: upgrade to continue Chapters runs.
A version from before Trailer cannot continue a Trailer run either. One whose
type list is written into the SDK continues it on the Tighten Episode route.
One that reads the list from `@nodaro/shared` throws `use_case_type_unknown`
when the installed `@nodaro/shared` is from before Trailer too, since
`"episode-trailer"` is not in that list. Upgrade to continue Trailer runs.
The same holds for a version from before Clip Pack and a Clip Pack run
(`"clip-pack"`), and for a version from before Speaker Layout and a Speaker
Layout run (`"speaker-layout"`): upgrade to continue their runs.
Earlier versions also continued on the Tighten Episode route whenever the type
could not be read; this version throws instead.

Answers a new job to poll, like `tightenEpisode`. A completed Render final does
not block another Render final of the same preview with a changed edit (the
final steps run and are charged again, still with no fee); the very same edit
again is refused. Refusals throw before any run exists, with the
[continuation codes](./api-integration.md#continuing-a-run):
`not_found` (`NotFoundError`, 404: no such job of yours),
`continuation_not_found` (`NotFoundError`, 404: the run behind it is missing
or not yours), `continuation_workflow_mismatch` (400),
`continuation_version_mismatch` (400), `continuation_subset_required` (400), `continuation_not_failed`,
`continuation_not_completed`, `continuation_settling` (try again in a moment),
`render_final_not_preview` (409), `use_case_nothing_kept` (409: a Clip Pack
review that keeps no clip) and `use_case_no_plan` (400: an `editedEdl` on a
Speaker Layout Render final). A refusal that names another job throws a
`ContinuationRefusedError` (a `NodaroError`, status 409) whose `jobId` is that
job: `already_running` (a continuation under way, or one that already
completed — follow it), `continuation_superseded` (a later
continuation failed too — continue that one instead) and
`render_final_already_rendered` (its result is the one to use). A run whose
payer cannot cover it throws `InsufficientCreditsError` (a `"from-failed"`
run holds the fee again).

```ts
import { ContinuationRefusedError } from "@nodaro/sdk"

try {
  await client.edit.continueUseCase({ jobId, mode: "from-failed" })
} catch (err) {
  if (err instanceof ContinuationRefusedError && err.code === "continuation_superseded") {
    await client.edit.continueUseCase({ jobId: err.jobId, mode: "from-failed" })
  } else throw err
}
```

#### `editPlan(input)`

```ts
editPlan(input: EditPlanInput): Promise<EditJobResult>
```

**`EditPlanInput`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `EditPlanMode` | yes | `"tighten"` \| `"clips"` \| `"chapters"` \| `"trailer"`. A trailer plan's `output_data` is one `Edl`, like tighten. |
| `planTier` | `EditPlanTier` | yes | `"economy"` \| `"standard"` \| `"premium"` — affects quality and the credit bucket. |
| `transcript` | `Transcript` | yes | The timed transcript driving the plan. |
| `sources` | `EditPlanSource[]` | yes | 1–6 media sources. Each: `{ id, url, kind: "video" \| "audio", role?, speakers?, offsetMs? }`. A source's own `offsetMs` wins over a measured one. |
| `silence` | `SilenceRanges` | no | The silence-detect job's `output_data.json` — pass the whole object (an input without `ranges` is silently ignored). |
| `offsets` | `AudioSyncResult \| string` | no | Multicam: an `audioSync` job's `output_data.json`, measured over the **same source ids**. Each source's offset is written onto its `offsetMs` before the request, re-based onto the master's clock (the `master-audio` source, else the first). |
| `transcriptSourceId` | `string` | no | The id of the source the transcript was made from, when you know it. |
| `instructions` | `string` | no | Free-text editing steer. |
| `styleGuide` | `string` | no | Style-guide text. |
| `count` | `number` | no | `"clips"` mode: how many clips to cut. |
| `targetDurationSec` | `number` | no | `"clips"` mode: target duration per clip. |
| `targetAspect` | `"16:9" \| "9:16" \| "1:1" \| "4:5"` | no | Clip aspect. |
| `platform` | `string` | no | Target platform hint. |
| `workflowId` | `string` | no | Execution-history display. |

`editPlan` rejects **before any request or charge** — a `NodaroError` with
`code: "edit_plan_sources"` naming the source — when the master has a non-zero
`offsetMs`, a source's `offsetMs` is not a number, or `transcriptSourceId`
names a source that is off the master's clock; and, with `offsets`, when a
source was not measured, matched weakly (confidence below 0.5: set its
`offsetMs` by hand), or the master was not measured. The same checks run as pure functions in `@nodaro/shared`
(`resolveEditPlanSources`, `applyAudioSyncOffsets`). Each cut goes on the first
camera that has picture for it; a stretch no camera filmed is dropped from the
plan as `no-picture`.

```ts
const sync = (await client.jobs.getStatus(syncJobId)).data.output_data.json
const { jobId } = await client.edit.editPlan({
  mode: "tighten",
  planTier: "standard",
  transcript,                                   // made from the mic
  sources: [
    { id: "mic", url: micUrl, kind: "audio", role: "master-audio" },
    { id: "camA", url: camAUrl, kind: "video" },   // same ids as the audioSync request
  ],
  offsets: sync,
  transcriptSourceId: "mic",
})
```

Read the finished job's `output_data` with `unwrapEditPlanOutput` — it returns
an `Edl` (`tighten`, `trailer`), a bare `Edl[]` (`clips`, unwrapped from `EdlClipSet`), or a
`ChapterSet` (`chapters`), stripping the relay's `viaNodaroCloud` marker.

```ts
const { jobId } = await client.edit.editPlan({
  mode: "clips",
  planTier: "standard",
  transcript,                                  // from a transcribe job's output_data.json
  sources: [{ id: "ep", url: masterUrl, kind: "video", role: "master-audio" }],
  silence,                                      // a silence-detect job's output_data.json
  count: 5,
  targetAspect: "9:16",
})
const done = await client.jobs.getStatus(jobId)
const plan = unwrapEditPlanOutput(done.data.output_data)  // Edl[] for clips
```

#### `cameraSwitch(input)`

```ts
cameraSwitch(input: CameraSwitchInput): Promise<EditJobResult>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `edl` | `Edl` | yes | One EDL — an `editPlan` result (not a clip set). |
| `transcript` | `Transcript` | yes | The transcript WITH speaker labels. |
| `speakerMap` | `Record<string, string>` | no | Speaker label → the EDL source id of their camera. A speaker left out uses the source whose `speakers` names them, else the `wide` source, else any camera with picture. |
| `speakerMapResult` | `SpeakerMapResult \| string` | no | A `speakerMap` job's `output_data.json`, folded into `speakerMap` before the request: a label in `speakerMap` wins, then the result, then the n-th speaker heard gets the n-th camera. Something that is not a Speaker Map result rejects with a `NodaroError` (`code: "not_a_speaker_map"`) before any request. |
| `speakerNames` | `Record<string, string>` | no | Speaker label → display name. |
| `minShotMs` / `leadMs` / `maxShotMs` / `wideEvery` | `number` | no | Shortest shot (2 500), cut lead (200), wide break after (20 000, with a wide source), every N-th cut to the wide (0 = off). |
| `layoutHints` | `boolean` | no | Overlapping speech → a layout hint (default false; Apply EDL renders cut-only edits). |

The finished job's `output_data.json` is the switched EDL (feed it to `applyEdl`)
and `output_data.transcript` the transcript with `speakerNames` applied. A
transcript with no speaker labels rejects with a `NodaroError`
(`code: "no_speakers"`) before any request or charge. Flat price per run.

#### `remapTranscript(edl, transcript)`

```ts
remapTranscript(edl: Edl, transcript: Transcript): Transcript
```

A PURE local transform (no request): returns a new transcript whose word (and
segment) timings are on the EDL's rendered output clock, dropping words in cut
regions and clipping straddlers (a word across two segments that continue each
other on both clocks — no jump in the recording, no crossfade — keeps its full
length). The same remap `applyEdl` performs server-side.

---

## Type re-exports

Every type used in a public method signature is re-exported from
`@nodaro/sdk`. Import them with `import type { ... }`.

### Social Search

- `SocialSearchParams` — the `nodes.run("social-search", …)` body: `{ platform, query, mode?, count?, period?, sort?, region?, country?, activeOnly?, subreddit?, videoKind? }`
- `SocialSearchJobOutput` — what `nodes.runAndWait("social-search", …)` resolves: `{ json: SocialPost[], platform, mode, query, warnings? }`
- `SocialPost` / `SocialPostAuthor` / `SocialPostMetrics` / `SocialPostMedia` — one post, the same shape on every platform
- `SocialPlatform` / `SocialSearchMode` / `SocialSearchPeriod` / `SocialSearchSort` / `SocialSearchCount` / `SocialSearchVideoKind` — the vocabularies

### Saved posts

- `SavedPost` — one save: `{ id, postId, platform, url, post, thumbnailUrl, note, tags, source, createdAt, updatedAt }`
- `SavePostInput` / `UpdateSavedPostInput` — the `save()` / `update()` bodies
- `ListSavedPostsParams` / `ListSavedPostsResult` — `list()`'s filters and page (`{ data, nextCursor }`)
- `SavedPostsLookupResult` — `lookup()`'s answer
- `SavedPostSource` — where a save came from: `picker`, `competitors`, `manual`, `api`

### Competitors

- `TrackedCompetitor` / `CompetitorDetail` — a tracked brand; with its latest scan and history
- `CompetitorScan` / `CompetitorScanSummary` / `CompetitorScanCounts` / `CompetitorPost` — a scan, its counts and its posts (a `SocialPost` plus `role`: `own`, `about` or `market`)
- `ActionCard` / `ActionCardKind` / `ActionCardPriority` — a card: `kind`, `priority`, `params`, `evidence` (post ids), English `title` / `why` / `action`
- `CompetitorCardsResult` / `CompetitorDiscovery` — `cards()` and `discover()` answers
- `CompetitorBrandTally` / `CompetitorPlatformTally` — a brand's latest scan per platform: its own posts and posts about it there, the searches that ran (`searched`) and failed (`failed`), its usual reach (`usual`, `unit`) and its strongest lesson (`top`)
- `CompetitorSearch` / `CompetitorSearchKind` — one search a scan runs (`TrackedCompetitor.searchPlan`): `own` (an account) or `about` (the name) on a platform
- `CreateCompetitorInput` / `UpdateCompetitorInput` / `CompetitorAccounts` / `CompetitorAccountKey` / `CompetitorAboutPlatform` / `CompetitorSchedule` — the request shapes

### Billing

- `BillingPlansResult` / `BillingPlan` / `BillingPlanPrices` / `BillingMoney` / `BillingMonthlyPrice` / `BillingYearlyPrice` / `BillingPriceCredits` / `BillingTopUp` — `billing.plans()`: the plans and credit packs on sale
- `BillingSubscriptionResult` / `BillingSubscription` — `billing.subscription()`
- `BillingSurface` / `BillingAccountSummary` / `BillingUsageCategory` — `billing.surface()` / `billing.account()`

### Client identity

- `UserIdentity` — return type of `client.me()`: `{ id, email, displayName: string | null, avatarUrl: string | null, tier, isAdmin }`
- `ConnectedApp` — an entry of `client.connectedApps()`: `{ authorizationId, name, kind, homepageUrl, scopes, connectedAt, lastUsedAt }`
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
- `RunWorkflowParams` — `{ nodeIds?, inputOverrides?, continueFromExecutionId? }`
- `RunWorkflowResult` — `{ executionId, status }`

### Projects

- `Project` — project record
- `CreateProjectInput`, `UpdateProjectInput`

### Jobs

- `Job` — snake_case wire shape; includes provenance: `source` (`"internal" | "mcp" | "app" | "cli" | "sdk" | "extension" | "web" | "api"`) + `source_detail` (origin host / `extension/<name>` label / `sdk/<version>` / MCP client / app id) so a library view can label or filter media by origin
- `JobStatus` — `"pending" | "queued" | "processing" | "pending_review" | "completed" | "failed" | "cancelled"`. `pending_review` is **in-flight, not terminal**: a job policy registered by the deployment held the output for human review. Keep waiting — it resolves to `completed` (approved), `failed` (rejected, with `error_hint.kind === "policy-block"`) or `cancelled` (the owner cancelled it; a held job is cancellable like any in-flight job), and `credit_status` reads `"reserved"` for the whole hold. `runAndWait` throws `JobHeldError` on the first held tick rather than waiting it out. Only appears on deployments that register a job policy.
- `JobStatusResult` — lean poll shape: `{ id, status, progress?, output_data?, error_message? }`
- `CancelJobResult` — `{ success: true, cancelled: number }`
- `DeleteJobResult` — `{ success: true }`
- `ListJobsParams` / `ListJobsPage` — `jobs.list` filters and page
- `JobRating` — `"good" | "bad"`; `JobRatingFilter` — `JobRating | "rated" | "unrated"` (the `jobs.list` filter)
- `RateJobResult` — `jobs.rate`'s answer: `{ data: { jobId, rating } }`
- `JobFromUploadParams` — `jobs.fromUpload`'s body: `{ assetId, sourceJobId?, sourceImageUrl?, sourceAssetId?, editStateUrl?, sessionId? }`
- `UploadJsonResult` — `uploads.uploadJson`'s answer: `{ url }`

### Gallery

- `GalleryItem` — one gallery card: `{ id, type, jobName, outputUrl, thumbnailUrl, createdAt, prompt, model, preview? }`
- `GalleryMediaType` — `"image" | "video" | "audio"`
- `BrowseGalleryParams` / `GalleryPage` — `gallery.browse` filters and page (`{ data, nextCursor, totalCount? }`)
- `ToggleFavoriteResult` — `{ favorited }`

### LLM

- `LlmStructuredInput`, `LlmStructuredResult<T>`, `LlmStructuredJobInput`, `LlmStructuredJobOutput<T>`

### Video Pro run control

- `StopVideoProResult` — `{ jobId, stopping? } | { jobId, success?, cancelled? }` (pending jobs forward the generic cancel result)
- `ContinueVideoProResult` — `{ jobId, continuedFromJobId?, fromSegment?, segmentCount?, deduped? }`

### Executions

- `WorkflowExecution` — full execution record with per-node state map
- `WorkflowExecutionSummary` — list-row shape. Both carry `kind`: `"execution"` for an orchestrator run, `"job"` for a single-node job listed beside the runs (whose `triggerType` is the lane that started it — `"mcp"` for an MCP client's one-node job)
- `NodeExecutionState` — per-node entry inside `nodeStates`; `output` is present for a `completed` node AND for a `failed` one whose run retained a result
- `NodeExecutionStatus` — per-NODE status: `"pending" | "running" | "completed" | "failed" | "skipped"`
- `OUTPUT_BEARING_NODE_STATUSES` / `nodeStateMayCarryOutput(status)` — the two statuses whose node state may carry `output`
- `ExecutionStatus` — the EXECUTION's own status: `"pending" | "running" | "completed" | "failed" | "cancelled" | "stopping" | "timed_out" | "discarded"`
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
- `VideoDepthParams` — the `nodes.run("video-depth", …)` body: `{ videoUrl, provider?, modelSize?, colormap?, resolution?, sideBySide? }`; its vocabularies `VideoDepthProvider` / `VideoDepthModelSize` / `VideoDepthColormap` / `VideoDepthResolution` are re-exported from `@nodaro/shared`

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
- `TrainCharacterInput` — `{ selectedImageUrls?: string[] }`; `TrainCharacterResult` — `{ jobId, trainingId, triggerWord }`
- `CharacterTrainingStatus` — `{ status, trainingId, error, trainedAt, version, triggerWord, imageCount }`; `CharacterTrainingState` — `"untrained" | "queued" | "training" | "succeeded" | "failed" | "cancelled"`
- `TrainCharacterRefusalCode` — the `code`s `train()` refuses with (see [Character training](#character-training))

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
- `PipelineInput`, `PipelineStatus`, `PipelineMode`, `PipelineStageName`, `SubGateName`, `AnimateSubGate`, `ChatEnabledStage`, `ProposedChange` — re-exported from `@nodaro/shared`
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
- `TranscribeProvider` — the `audio.transcribe()` provider enum (`"elevenlabs-stt" | "whisper" | "incredibly-fast-whisper"`), re-exported from `@nodaro/shared`. `"elevenlabs-stt"` always returns word timings, `"incredibly-fast-whisper"` only with `wordTimestamps: true`, `"whisper"` never
- `TranscribeWord` — one word of an `audio.transcribe()` result: `{ text, startMs, endMs, speaker? }` in MILLISECONDS, structurally the `captions[]` entry `media.addCaptions()` takes
- `TranscribeJobOutput` — a completed transcribe job's `output_data`: `{ text, language?, words?, json?, segments? }` (`words`/`json` in ms, `segments` in SECONDS)

### Credits

- `UserBalance` — full balance + tier record (see `balance()` table above)
- `ModelCostsResult` — `{ data: Record<string, number>; missing: string[]; errors: string[] }`

### Uploads

- `UploadResult` — `{ url, assetId, thumbnailUrl, category, filename, mimeType, sizeBytes, r2Key }` (see `upload()` table above)

### Developer apps

- `DeveloperApp` — app record (without secret)
- `DeveloperAppScope` — union of valid scope strings (the server's list, `OAUTH_SCOPES` in `@nodaro/shared`)
- `DeveloperAppStatus` — `"active" | "suspended" | "pending_review"`
- `CreateDeveloperAppInput`, `UpdateDeveloperAppInput`
- `CreateDeveloperAppResult` — `DeveloperApp & { clientSecret }`
- `RotateSecretResult` — `{ clientSecret }`

### OAuth

- `ExchangeCodeInput` — `{ client_id, client_secret, code, redirect_uri }`
- `AccessTokenResponse` — `{ access_token, token_type, scope, expires_in }`
- `OAuthAppInfo` — public app metadata for consent screens

### Webhooks

- `WebhookEndpoint` — a registered endpoint (never its secret)
- `CreateWebhookEndpointInput`, `UpdateWebhookEndpointInput` — `create()` / `update()` bodies
- `CreatedWebhookEndpoint` — `{ data, secret }` from `create()`
- `RotateWebhookSecretInput` (`{ gracePeriodSeconds? }`), `RotatedWebhookSecret` (`{ secret, previousSecretExpiresAt }`) — `rotateSecret()`
- `WebhookDelivery`, `WebhookDeliveryPage`, `ListWebhookDeliveriesParams` — the delivery log
- `WebhookJobEvent` (`"job.completed" | "job.failed"`), `WebhookEventType` (plus `"ping"`), `WebhookDeliveryStatus`
- `WebhookEvent` = `JobWebhookEvent | PingWebhookEvent` — what your endpoint receives
- `verifyWebhookSignature`, `WebhookSignatureError`, `VerifyWebhookSignatureOptions`, `WebhookSignatureErrorCode` — verifying a delivery

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
- `ResumeAppRunOptions` — third argument to `resume()`: `{ dryRun?, version? }`
- `AppRunResumePlan`, `AppRunResumeStep` — what `resume(…, { dryRun: true })` answers
- `AppRunResumeResult` — the started Retry: `{ executionId, runId, status, nodeIds, deduped? }`
- `AppRunResumeRefusalCode` — the codes a `resume()` refusal carries

### Community

- `CommunityCard` — a public community listing (shared character/location/object); `CommunityFullDetail` — the card plus its public snapshot (`getFull`)
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

## Editable 3D scenes

`client.scene3d` provides named `generate`, `edit`, and `render` methods, plus
`generateAndWait`, `editAndWait`, and `renderAndWait`. They submit the same nodes
shown below. `render` exports the supplied revision without an authoring call.
Use `await client.scene3d.capabilities()` to discover optional Advanced engines;
`advanced: null` means they are unavailable. Explicit engines that are unavailable
are rejected before a Basic generation or its credit checks.

`nodes.run` and `nodes.runAndWait` accept typed `GenerateScene3DParams`, `EditScene3DParams` and `RenderScene3DParams`. Generation/edit completion returns `Scene3DJobOutput` with `scenePlan` and an optional `changeSummary`.

`GenerateScene3DParams.inputAssets` and a Pro prompt source's `inputAssets`
accept up to eight `Scene3DInputAsset` selectors:
`{id, revisionId, assetId, label?}`. They select authorized existing GLBs while
`references` continues to carry appearance images and motion videos. This
requires an advanced engine with import support; Basic and unsupported imports
are refused before charging. The server supplies byte receipts. Do not send
asset URLs or hashes. Reuse identical selectors when submitting a Pro quote.

```typescript
const created = await client.nodes.runAndWait("generate-3d-scene", {
  prompt: "Orbit a single box on a floor over four seconds",
  durationSeconds: 4, fps: 24, aspectRatio: "16:9",
});
const edited = await client.nodes.runAndWait("edit-3d-scene", {
  scenePlan: created.scenePlan,
  expectedRevisionId: created.scenePlan.revisionId,
  operations: [{ op: "set-camera", changes: { focalLengthMm: 50 } }],
});
const clip = await client.nodes.runAndWait("render-video", {
  planType: "3d-scene", plan: edited.scenePlan,
});
```

Scene authoring uses `/v1/3d-scene/generate` and `/v1/3d-scene/edit`. Typed composition rendering uses `/v1/render-video/plan`; legacy template renders retain `/v1/render-video`. For image/video conditioning, pass `references` with explicit appearance/layout/motion roles. See [Generate 3D Scene](nodes/composition/generate-3d-scene.md).

A 3D scene render is priced by the plan's own `width`/`height`: **55 credits**<!-- credits: render-video -->
up to 1920 px on the longest side, **75** above that up to 5.12 megapixels, and
**125** for a larger frame (identifiers `render-video`,
`render-video:3d-large`, `render-video:3d-xlarge` — read the instance's current
numbers from the model-cost API). See
[what a 3D scene render costs](nodes/composition/render-video.md#what-a-3d-scene-render-costs).

SDK versions with the generic `nodes.run(type, params)` overload can use the same node names without typed Scene3D overloads. The server accepts their node-slug generate/edit paths and dispatches `render-video` requests carrying `planType` to the composition renderer. For an interactive preview, check the generate node's `scene3d-embed-v1` capability and use the [3D preview embed](scene3d-embed.md); it does not require a copy of the renderer or any authentication tokens in its messages.

### 3D Render Pro

`client.scene3d.quotePro(params)`, `client.scene3d.runPro(params, options?)` and
`client.scene3d.renderProAndWait(params, options?)` drive the one-operation
node: a `source` goes in, and a single job settles with BOTH `scenePlan` (the
exact composition) and `videoUrl` (the exported MP4), plus the revision, poster,
`shotStills`, validation and renderer metadata. A run that AUTHORED also reports
its own account of the answer — `metadata.summary`, `repairPasses`,
`admissionRetries`, `mechanicalPasses`, `restoredAssertions` and any
`SCENE_AUTHORING_ASSUMPTION` warnings (see below), plus
`metadata.review` when the scene was delivered without the visual reviewer's
approval — because it refused, or because it gave no usable verdict at all.
`nodes.run("pro-3d-render", …)` and
`nodes.runAndWait("pro-3d-render", …)` reach the same routes with the same
typed `Pro3DRenderRunParams` / `Pro3DRenderJobOutput`.

`source` is a strict discriminated union: `{kind:"prompt", prompt, references?}`
authors a new scene; `{kind:"scene", revisionId, sourceJobId}` with **no**
`editPrompt` is a render-only export that costs no authoring (adding one revises
first); `{kind:"local-export", exportId, connectionId}` uses a paired desktop.
`sourceJobId` is required for Basic scenes retained only in job history and
optional for retained revisions, which use current scene permissions.

```typescript
const caps = await client.scene3d.capabilities();
if (caps.pro?.available) {
  const shot = await client.scene3d.renderProAndWait({
    source: {
      kind: "prompt",
      prompt: "A red suitcase rolls behind a central pillar and reappears",
      references: [{ id: "look", kind: "image", role: "appearance", url: appearanceImageUrl }],
    },
    durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 2,
    acceptedSceneSchemaVersions: [2],
  });
  shot.videoUrl;        // the MP4
  shot.sceneRevisionId; // re-export it later, render-only, for no authoring charge
  shot.shotStills;      // one still per shot, ordered by shotIndex — see below
}
```

`shotStills` is `{ shotIndex, frame, assetId, url }[]`, ordered by `shotIndex`
and produced by the same run at no extra credit cost: one still per shot of the
composition, each at the frame that shot opens on (`shotIndex` is 0-based in the
composition's shot order; `frame` is zero-based in the composition's frame
space). A v1 single-shot scene yields exactly one, at frame 0. The field is
optional — a result rendered before it existed simply has none, so read it as
`shot.shotStills ?? []` rather than assuming it is there:

```typescript
for (const still of shot.shotStills ?? []) {
  const bytes = await fetch(still.url, { headers: { Authorization: `Bearer ${token}` } });
  // …then use the bytes, or re-host them somewhere your own pipeline can read.
}
```

Each `url` is an **authenticated** endpoint on this install
(`GET /v1/3d-scene/deliveries/{jobId}/assets/{assetId}`), not a public CDN
link: a delivery's artifacts stay in the private scene bucket, and reads are
re-authorized against the delivery's workflow on every request. Fetch it with
the same credentials you used to run the job — dropping the URL into a plain
`<img>` tag, or handing it to a third-party service to fetch yourself, gets a
`401`.

You can still USE a still as a model reference: pass the URL as you read it (in
`referenceImageUrls`, or by wiring the node's `stills` handle in a workflow) and
the platform grants that run its own short-lived read of that one artifact, in
your name, at dispatch time. The grant expires minutes later and nothing durable
is created — so keep the authenticated URL, not the grant, in anything you store.


`renderProAndWait` quotes the identical body first when `params` carries no
`quoteId`, so the run is admitted against a hash of exactly what was priced.
To show the ceiling before committing, quote explicitly:

```typescript
const quote = await client.scene3d.quotePro(params);   // reserves nothing
// ...show quote.maxCredits and quote.breakdown...
await client.scene3d.runPro({ ...params, quoteId: quote.quoteId });
```

Both run methods send an `Idempotency-Key` — a fresh one per call, or your own
via `options.idempotencyKey`, which you should reuse when retrying a submit that
timed out. `nodes.run` / `nodes.runAndWait` accept the same option for any node.

#### What the run says about its own answer

These fields report what the authoring run assumed and did. Read every one as
optional: an install without an advanced engine, and a result produced before
these existed, simply has none.

```typescript
const summary = shot.metadata?.summary;   // what the planner says it authored
const repairs = shot.repairPasses;        // 0 when accepted first time
const retries = shot.admissionRetries;    // pre-build planner retries
const mechanical = shot.mechanicalPasses; // own allowance, apart from repairPasses
const restored = shot.restoredAssertions; // assertions put back after an answer re-shaped them
const assumptions = (shot.validation?.warnings ?? [])
  .filter((w) => w.code === "SCENE_AUTHORING_ASSUMPTION")
  .map((w) => w.message);
```

`SCENE_AUTHORING_ASSUMPTION` is an authoring caveat — the brief did not say, so
the run decided — carrying the planner's assumption with any normalization the
engine applied to it. Codes are open-ended: treat an unrecognized one as
informational rather than an error.

`repairPasses` counts repairs, never authoring passes, so `0` means "accepted
first time", not "never authored". `admissionRetries` counts something else and
is never folded into it: a recipe the compiler would not admit, re-asked of the
planner with no build and no repair pass spent.

`mechanicalPasses` is counted **apart** from `repairPasses` too, for the same
kind of reason: when a mandatory finding that refused a build carries the
compiler's own structured remedy, the engine applies that remedy and rebuilds
with no planner call — and those passes buy their own quoted allowance (a
`mechanical` line, up to 2, released when unspent) instead of spending one of
your repairs. So the two counts are independent, and a run may legitimately
report more mechanical passes than repairs. Each adds a `REMEDY_AUTO_APPLIED`
warning naming the assertion that refused the build, the change applied, and the
measurement before it.

There is **one** exception, and the quote is what discriminates it: a run quoted
before that allowance existed carries no `mechanical` quote line, and there the
pass charged a repair, making the count a subset of `repairPasses`. The result
reports the same field either way, so read the quote you were given rather than
deriving the accounting from the two numbers.

`restoredAssertions` lists mandatory assertions the engine put back after a
planner answer re-shaped one the feedback had not named — each `{op, path,
value?, assertionId, reason}`, and each also an `ASSERTION_RESTORED` warning. A
repair is invited to change what the feedback names; an assertion outside that
invitation is restored to its last admitted form and the run carries on, rather
than being refused over a value the engine already held.

A render-only export authored nothing and omits the counts entirely rather than
reporting `0`; it also has no summary. Absent is not `0` for `mechanicalPasses`
in particular: an engine that does not report it looks the same as a run that
took none, which is not a claim that the planner authored every repair.

The same fields appear on a `generateAndWait` result when an advanced engine
authored the scene. The deterministic Basic lane asks no model and carries none
of them.

#### A delivery the visual reviewer did not approve

A **completed** result may reach you without the visual reviewer's approval, in
two ways. The video is real and the credits committed in both; `verdict` says
which, and it is a discriminated union, so a `switch` gets a compile-time answer.

- **`"refused"`** — the repair budget was spent, every mandatory check passed,
  and the reviewer still objected, so the scene was delivered with the refusal
  attached.
- **`"unavailable"`** — the review produced no usable verdict. `reason` says
  why: `"provider"` when it never reached its provider, `"unusable"` when the
  provider answered with nothing usable (the full list is
  `SCENE3D_REVIEW_UNAVAILABLE_REASONS`). A repair cannot answer either, so the
  run asks the review once more and, if there is still no usable verdict,
  delivers the assertion-passing scene unreviewed. `attempts` says how many
  times it was asked. **Nobody judged this scene.**

```typescript
import { scene3DReviewNote, scene3DReviewVerdictOf } from "@nodaro/shared";

const review = scene3DReviewVerdictOf(shot);
if (review) {
  // One user-safe sentence for either verdict. Prefer it over writing your own:
  // "the reviewer refused this scene" is an invented opinion when nobody looked.
  console.log(scene3DReviewNote(review));

  if (review.verdict === "unavailable") {
    // review.reason: "provider" (never reached) | "unusable" (answered with nothing usable)
    console.log(`unreviewed (${review.reason}) after ${review.attempts} attempts`);
  }
  for (const objection of review.objections) {
    // category, what, correction?, frames[]
    console.log(objection.category, objection.what, objection.correction);
  }
}
```

Each objection is `{ category, what, correction?, frames }` — `what` is the
finding, `correction` the recipe-level change it asked for where it named one.
There is no `severity`: only blocking findings become objections. `observed` is
the reviewer's account of what it found *correct*, never a substitute for an
objection. Every objection also arrives as a `SCENE_REVIEW_REFUSED` entry in
`validation.warnings[]`, tagged with a `shotId` where its cited frames fall
inside one shot; on the `"unavailable"` arm a `SCENE_REVIEW_UNAVAILABLE` entry
**leads** that array.

Three readings that look right and are not, which is why the helpers exist:

- **`validation.status` is still `"passed"`.** The mandatory checks *did* pass —
  that is why the scene was delivered rather than withheld.
- **`objections` may be empty.** A refusal that named nothing actionable is
  still a refusal, so counting `SCENE_REVIEW_REFUSED` warnings misses it.
- **objections under an `"unavailable"` verdict are not the verdict.** A review
  is batched, and those are whichever batches answered usably before one did not, or before the provider went
  away. An empty list there is silence, not approval.

A visual refusal on its own no longer fails the job. `SCENE_QUALITY_FAILED` now
means a mandatory check failed or the compiler refused the recipe; the
`SCENE_QUALITY_*` warning codes belong to that failed result, and its retained
draft is described in
[3D Render Pro](nodes/composition/pro-3d-render.md#scene_quality_failed-keeps-the-scene-it-built).

`capabilities().pro` reports which engines, quality profiles, styles and aspect
ratios this install can serve — offer controls from that, not from the full
vocabulary. An install without the engine answers
`503 SCENE_CAPABILITY_UNAVAILABLE` and never falls back to Basic authoring; one
with no configured price answers `503 price_not_configured` before reserving
anything. There is no model, reasoning-effort or planner field: the planner is
fixed and server-owned. See
[3D Render Pro](nodes/composition/pro-3d-render.md).

### Scene asset reads

`client.scene3d.getDelivery(jobId)` reads retained export metadata, including its
`sourceKind`, its exact source revision and the descriptors it pinned. Four kinds
appear: `poster` and `validation-report` on every delivery, `shot-still` once per
shot where the render produced a contact sheet (each carrying its own
`shotIndex`, `frame`, `width` and `height`), and — on a `refused-authoring`
delivery alone — `source-json`. For each descriptor, call
`client.scene3d.deliveryAssetBytes(jobId, asset, { signal })` to read bounded
bytes through fresh authentication. Access requires both delivery and source
permissions, including after the source revision has been deleted. These methods
read already published delivery evidence; they do not start a render.

On a `refused-authoring` delivery — a 3D Render Pro run whose recipe the compiler
refused on every pass — `sceneRevisionId` and `sourcePlanSha256` are `null` and
there is no poster, because nothing compiled and no frame was rendered. What that
delivery does carry is the refusal report and, where the run had one to keep, the
planner's last admitted recipe:

```typescript
const recipe = await client.scene3d.retainedRecipe(jobId);
// null when nothing was retained, or when you hold less than edit access.
```

`retainedRecipe` reads the delivery, finds the `source-json` descriptor and
parses its bytes. It answers `null` rather than throwing when there is nothing to
fetch. Three things to know:

- **It needs edit access** to the job's workflow — the same access
  `sourceBytes` needs for a native `.blend`. A reader with less does not see the
  descriptor at all, which is why the answer is `null` rather than an error.
- **The failed job says whether to ask.** `validation.sourceRetained` on the
  failed row is `true` when a recipe was kept and `false` when no pass ever
  cleared admission.
- **It is evidence, not an input.** A refused run published no revision, so there
  is no `{ kind: "scene" }` source to re-run it from; read it to see what was
  attempted and let it inform the next prompt. Reading costs no credits.

`client.scene3d.assetBytes(revisionId, asset, { signal })` fetches a GLB, camera
track, poster or validation report through the authenticated API. Pass the exact
asset descriptor from that retained revision; the SDK caps decoded response bytes
at its declared length. The scene renderer additionally verifies the SHA-256
digest before parsing.

`client.scene3d.sourceBytes(revisionId, { signal })` uses the separate native
source authorization endpoint. Both return an `ArrayBuffer`, use fresh credentials,
respect cancellation, and preserve typed API errors. A native source file is
available only when it represents that exact accepted revision.

Use `client.scene3d.applyEdits(revisionId, { newRevisionId,
expectedContentHash, operations, lockedObjectIds? })` to persist deterministic
v2 edits without authoring. It returns `{ scenePlan, changeSummary }`. Keep the
same `newRevisionId` for retries of the same edit. Adopt the returned scene only
if the user is still editing the request's base revision. Geometry and camera
assets are reused; posters, validation and native downloads are attached again
only after being regenerated for the new revision.

### Character Motion metadata

Character Motion catalog options include optional `motion` metadata at both compact and full detail. It carries authored `requires`, `startPose`/`endPose`, `endVisibility`, `handsAfter`, `needsFreeHands`, `kind`, `fixedPace`, `counterpart`, search `aliases`, and `deprecated`/`replacementId`. Missing fields mean unknown. Preserve retired IDs when loading saved workflows; hide them from new choices. See [Character Motion](nodes/parameters/character-motion.md) for composition, naming, review and advisory-diagnostic behavior. `client.pickerCatalogs.get("character-motion")` exposes this as `PickerOption.motion`; the structural type is `CharacterMotionMetadata` from `@nodaro/shared`.
