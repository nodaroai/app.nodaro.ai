# SDK Quickstart

`@nodaro/client` is a typed REST client for Nodaro. It works in Node, browsers,
and React Native — anywhere `fetch` exists. This walkthrough goes from "install"
to running a workflow end-to-end.

If you just want a method-by-method index, see the
[SDK Reference](./sdk-reference.md). For the OAuth consent flow, see
[OAuth Flow](./oauth-flow.md).

## 1. Install + first request

```bash
npm install @nodaro/client
```

The simplest possible call uses `client.nodes.list()` — it requires no scopes
and works on any reachable Nodaro instance:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

const { data: nodes } = await client.nodes.list()
console.log(`${nodes.length} node types available`)
```

`baseUrl` is your Nodaro server (use `""` for same-origin in a browser app).
`auth` is one of three providers, covered next.

## 2. Three auth modes

The client treats auth as a pluggable strategy. Every request calls
`auth.getToken()` and sends `Authorization: Bearer <token>` if a token is
returned.

### `StaticTokenAuth` — server-side, fixed token

Use when you have a token that doesn't change for the lifetime of the process:

- An OAuth access token your server obtained via the authorization-code flow
- A user API token (prefixed `ndr_...`)
- A developer-app token (prefixed `ndr_app_...`)

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})
```

Header sent: `Authorization: Bearer <your token>`.

### `supabaseAuth` — browser app, live Supabase JWT

Use when your frontend talks to a Nodaro instance that shares the same Supabase
project (the included editor uses this mode). The JWT is pulled live from the
Supabase v2 client on every request, so token refresh is automatic.

```ts
import { createClient, supabaseAuth } from "@nodaro/client"
import { createClient as createSupabase } from "@supabase/supabase-js"

const supabase = createSupabase(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  auth: supabaseAuth(supabase),
})
```

Header sent: `Authorization: Bearer <Supabase access_token>`. Falls back to no
header (anonymous) when no session exists.

### `CallbackAuth` — bring-your-own logic

Use for refresh-token rotation, custom session stores, or anything else that
needs to compute the token on demand:

```ts
import { createClient, CallbackAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new CallbackAuth(async () => {
    const session = await mySessionStore.read()
    if (Date.now() > session.expiresAt - 60_000) {
      await refresh(session)
    }
    return session.accessToken
  }),
})
```

The callback can be sync or async, and may return `null` to skip the header
(anonymous request).

## 3. Error handling

Every resource method throws a typed error subclass on a non-2xx response. Catch
the most specific class first and `NodaroError` last as a catch-all:

```ts
import {
  NodaroError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  InsufficientCreditsError,
  StorageExceededError,
} from "@nodaro/client"

try {
  await client.workflows.run(workflowId)
} catch (err) {
  if (err instanceof UnauthorizedError) {
    // 401 — token expired or invalid. Re-auth and retry.
    redirectToLogin()
  } else if (err instanceof ForbiddenError) {
    if (err.missingScope === "workflows:execute") {
      // 403 with insufficient_scope — request consent for additional scopes.
      requestAdditionalScopes(["workflows:execute"])
    } else {
      // 403 — permission denied for some other reason (RLS, edition gate, etc.)
      showError("Permission denied.")
    }
  } else if (err instanceof InsufficientCreditsError) {
    // 402 — show paywall with required vs available.
    showCreditPaywall({ required: err.required, available: err.available })
  } else if (err instanceof RateLimitedError) {
    // 429 — apply exponential backoff and retry.
    await new Promise(r => setTimeout(r, 2_000))
    return retry()
  } else if (err instanceof StorageExceededError) {
    // 413 — user is over quota. err.limitBytes contains the cap.
    showError(`Storage limit (${err.limitBytes} bytes) exceeded.`)
  } else if (err instanceof NotFoundError) {
    // 404 — resource doesn't exist or isn't visible to this caller.
    showError("Not found.")
  } else if (err instanceof NodaroError) {
    // Any other API error. Log .code and .status for debugging.
    console.error(`API error ${err.status} (${err.code}): ${err.message}`)
  } else {
    // Network failure, AbortError, etc. — not a Nodaro response error.
    throw err
  }
}
```

All Nodaro errors expose:

- `err.message: string`
- `err.code: string` — stable error slug (`"unauthorized"`, `"insufficient_credits"`, etc.)
- `err.status: number` — HTTP status

Specific subclasses add fields:

- `ForbiddenError.missingScope?: string` — set when `code === "insufficient_scope"`
- `InsufficientCreditsError.required?: number` / `.available?: number`
- `StorageExceededError.limitBytes?: number`

## 4. Common workflows

### Run a workflow and poll for completion

`workflows.run()` returns immediately with an `executionId`. Poll
`executions.get()` until the status is terminal:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

const exec = await client.workflows.run(workflowId)
console.log(`Started execution ${exec.executionId}`)

while (true) {
  const { data } = await client.executions.get(exec.executionId)
  console.log(`${data.completedNodes}/${data.totalNodes} nodes done`)

  if (
    data.status === "completed" ||
    data.status === "failed" ||
    data.status === "cancelled" ||
    data.status === "timed_out"
  ) {
    if (data.status !== "completed") {
      throw new Error(`Execution ${data.status}: ${data.errorMessage ?? "no error message"}`)
    }
    console.log(`Done. Used ${data.totalCreditsUsed} credits.`)
    break
  }
  await new Promise(r => setTimeout(r, 2_000))
}
```

You can also run only a subset of nodes by passing `nodeIds`:

```ts
const exec = await client.workflows.run(workflowId, {
  nodeIds: ["text-prompt-1", "image-gen-2"],
})
```

To stop a long-running execution, use `executions.cancel()`. The optional
`mode: "after_current"` lets in-flight nodes finish before stopping; the default
cancels immediately:

```ts
await client.executions.cancel(exec.executionId, { mode: "after_current" })
```

### Run a workflow as a third-party app (OAuth)

The OAuth code exchange and consent UI are out of scope here — they're
documented in [OAuth Flow](./oauth-flow.md). Once your server has an
`access_token`, the call site is identical to the example above:
`new StaticTokenAuth(accessToken)`.

### Create a character end-to-end

Character Studio's full pipeline is scriptable through `client.characters`.
The typical flow: create the row, generate portrait candidates, pick one,
then layer expression / pose / motion assets on top.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

// 1. Create the character row.
const { id: characterId } = await client.characters.create({
  nodeId: "scripted",
  name: "Kira",
  description: "young protagonist with auburn hair",
  style: "realistic",
  seedPrompt: "kira portrait, warm natural lighting",
})

// 2. Generate 4 portrait candidates, auto-attaching to the row.
const { jobIds } = await client.characters.generate({
  name: "Kira",
  seedPrompt: "kira portrait, warm natural lighting",
  count: 4,
  attachToCharacterId: characterId,
})

// 3. Wait for all 4 to complete, then pick a candidate.
for (const jobId of jobIds) {
  while (true) {
    const { data: job } = await client.jobs.get(jobId)
    if (job.status === "completed" || job.status === "failed") break
    await new Promise(r => setTimeout(r, 3_000))
  }
}

// 4. Approve the first candidate (the LLM caption fires inline).
const { portraitUrl, canonicalDescription } =
  await client.characters.approvePortrait(characterId, jobIds[0])

// 5. Layer a smile expression on top.
await client.characters.generateAsset({
  name: "Kira",
  assetType: "expressions",
  variant: "smile",
  attachToCharacterId: characterId,
  attachToColumn: "expressions",
  attachName: "smile",
})

// 6. Animate the portrait into a motion clip.
await client.characters.generateMotion({
  name: "Kira",
  motionPrompt: "slow head turn left, soft smile",
  provider: "kling",
  attachToCharacterId: characterId,
  attachName: "head turn",
})

// 7. Re-fetch — the character now has a portrait, a smile expression,
//    and a motion clip ready to use as a reference in any subsequent
//    generate-image / generate-video call.
const character = await client.characters.get(characterId)
console.log({
  portrait: character.sourceImageUrl,
  canonicalDescription: character.canonicalDescription,
  expressions: character.expressions,
  motions: character.motions,
})
```

For the full surface (including the soft-delete + archive flow, character
duplication, and how to wire character assets into downstream prompts) see
the dedicated [Character Platform](./character-platform.md) guide.

### Create an object end-to-end

Object Studio's full pipeline is scriptable through `client.objects`. The
typical flow: create the row, generate main-image candidates, pick one,
then layer angle / material / variation / motion assets on top.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

// 1. Create the object row.
const { id: objectId } = await client.objects.create({
  nodeId: "scripted",
  name: "Antique Lantern",
  description: "Weathered brass lantern with hand-engraved filigree",
  category: "tool",
  style: "realistic",
})

// 2. Generate 4 candidate main images (deferred attach — we pick after).
const result = await client.objects.generate({
  name: "Antique Lantern",
  count: 4,
})

// `generate()` returns a discriminated union — type-guard for count > 1.
if (!("jobIds" in result)) throw new Error("expected jobIds (count: 4)")
const { jobIds } = result

// 3. Wait for all 4 to complete, then pick a candidate.
for (const jobId of jobIds) {
  while (true) {
    const { data: job } = await client.jobs.get(jobId)
    if (job.status === "completed" || job.status === "failed") break
    await new Promise(r => setTimeout(r, 3_000))
  }
}

// 4. Approve the first candidate (the LLM caption fires inline).
const { sourceImageUrl, canonicalDescription } =
  await client.objects.approveMainImage(objectId, jobIds[0])

// 5. Layer a "gold" materials variant on top — auto-attaches on completion.
await client.objects.generateAsset({
  name: "Antique Lantern",
  assetType: "materials",
  variant: "gold",
  attachToObjectId: objectId,
  attachToColumn: "materials",
  attachName: "gold",
})

// 6. Animate the main image into a motion clip.
//    Defaults: provider="kling-turbo", aspectRatio="1:1" (product-showcase).
await client.objects.generateMotion({
  name: "Antique Lantern",
  motionPrompt: "slow 360 rotation, soft golden rim light",
  sourceImageUrl,
  attachToObjectId: objectId,
  attachName: "rotate-360",
})

// 7. Re-fetch — the object now has a main image, a gold materials
//    variant, and a motion clip ready to use as a reference in any
//    subsequent generate-image / generate-video call.
const object = await client.objects.get(objectId)
console.log({
  mainImage: object.sourceImageUrl,
  canonicalDescription: object.canonicalDescription,
  materials: object.materials,
  motionClips: object.motionClips,
})
```

For the full surface (including the 13-method SDK, the soft-delete +
archive flow, the upstream picker integration, and how to wire object
assets into downstream prompts) see the dedicated
[Object Platform](./object-platform.md) guide.

### Pick the best of N generations (Collect / fan-in)

`client.collect.run()` runs the [Collect node](./nodes/utility/collect.md)
programmatically. Useful when you've generated several candidates and want
to pick the best, concatenate them, vote, or merge as JSON — without
building a workflow on the canvas.

```ts
// Pick the best of 5 generated images
const result = await client.collect.run({
  strategyId: "pick-best-llm",
  strategyConfig: {
    criteria: "sharpest image with no artifacts",
    inputKind: "image-url",
  },
  inputs: [
    "https://r2.nodaro.ai/.../1.jpg",
    "https://r2.nodaro.ai/.../2.jpg",
    "https://r2.nodaro.ai/.../3.jpg",
    "https://r2.nodaro.ai/.../4.jpg",
    "https://r2.nodaro.ai/.../5.jpg",
  ],
})
console.log(result.output)             // chosen URL
console.log(result.meta.selectedIndex) // 0-4
console.log(result.meta.reasoning)     // LLM rationale
```

Other strategies don't need an LLM:

```ts
// Concatenate survivors with a custom separator
const joined = await client.collect.run({
  strategyId: "concat",
  strategyConfig: { separator: "\n---\n" },
  inputs: ["A", "B", "C"],
})

// Majority vote (ties → first)
const winner = await client.collect.run({
  strategyId: "vote",
  inputs: ["red", "blue", "red", "red", "blue"],
})

// Deep-merge JSON fragments into one object
const merged = await client.collect.run({
  strategyId: "merge-json",
  strategyConfig: { strategy: "deep" },
  inputs: [
    JSON.stringify({ a: 1, nested: { x: 1 } }),
    JSON.stringify({ b: 2, nested: { y: 2 } }),
  ],
})
console.log(JSON.parse(merged.output))
// { a: 1, b: 2, nested: { x: 1, y: 2 } }
```

The full set of strategies is: `pick-best-llm`, `concat`, `first-non-empty`,
`count`, `vote`, `merge-json`. If every input is empty / whitespace the
server returns a 400 (`code: "no_valid_inputs"`) which surfaces as a
`NodaroError` subclass.

### Discover available nodes

`nodes.list()` enumerates every node type the server supports, with category,
output type, credit cost, and supported providers. Useful for building a
node palette UI or filtering by capability:

```ts
const { data: nodes } = await client.nodes.list()

const imageGenerators = nodes.filter(n => n.category === "ai-image")
const veoCapable = nodes.filter(n => n.providers?.includes("veo"))
const referenceImageNodes = nodes.filter(n =>
  n.capabilities?.includes("supports-reference-image"),
)

// Get a single descriptor by type slug:
const { data: nanoBanana } = await client.nodes.get("generate-image")
console.log(`Cost: ${nanoBanana.creditCost}`)
```

## 5. Type safety

`@nodaro/client` re-exports types for every response shape and input. Common
imports:

```ts
import type {
  Workflow,
  Project,
  Job,
  WorkflowExecution,
  NodeDescriptor,
  DeveloperApp,
  AccessTokenResponse,
} from "@nodaro/client"

const { data }: { data: Workflow } = await client.workflows.get(id)
//        ^? Workflow with full nodes/edges/settings
```

The client uses generic `request<T>()` internally and casts the JSON response
to the resource type, so TypeScript autocomplete works on every field of
`data`. Snake_case vs camelCase follows the wire format — `Job` is snake_case
(`created_at`, `output_data`) because that's what the server returns;
`Workflow` and `WorkflowExecution` are camelCase.

## 6. Browser vs Node

`@nodaro/client` has zero dependencies and uses only `fetch` and `URL`. Both
are global in:

- Node 18 or newer
- All modern browsers
- React Native (built-in fetch polyfill)
- Cloudflare Workers, Deno, Bun

No fetch polyfill needed. If you're on Node 16 or older, install
`undici` and pass `fetch: undici.fetch` (see section 7).

**CORS for browser apps:** when calling Nodaro from a browser using an OAuth
access token, your origin must be on the developer app's `allowedOrigins`
allowlist. See [OAuth Flow](./oauth-flow.md) for the consent + allowlist
mechanics. Browser apps using `supabaseAuth` are unaffected — those JWTs are
checked against Supabase, not the developer-app allowlist.

## 7. Custom fetch and timeout

Two optional `createClient` options cover most edge cases:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
  fetch: customFetch,    // any fetch-compatible function
  timeoutMs: 120_000,    // default is 60_000
})
```

`fetch` is useful for:

- **Tests** — pass a mock that returns canned `Response` objects
- **Retries** — wrap the global fetch in a retry-on-5xx helper
- **Telemetry** — wrap with OpenTelemetry / Datadog tracing
- **Older Node** — pass `undici.fetch` to use undici on Node 16

`timeoutMs` aborts the request via `AbortController` after the given milliseconds.
Long-running operations like video generation should use `workflows.run()` plus
polling rather than waiting for a single HTTP response — most generation
workflows take longer than any reasonable HTTP timeout.

## Next steps

- [SDK Reference](./sdk-reference.md) — every public export with signature + example
- [OAuth Flow](./oauth-flow.md) — third-party app consent + token exchange
- [API Integration](./api-integration.md) — direct REST patterns without the SDK
- [Architecture](./architecture.md) — how Nodaro executes workflows server-side
