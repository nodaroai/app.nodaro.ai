---
name: using-nodaro-client
description: Use when integrating the @nodaro/client TypeScript SDK into an application — server-side automation, browser frontends talking to a Nodaro instance, or third-party OAuth apps. Covers install, three auth modes (StaticTokenAuth, supabaseAuth, CallbackAuth), the seven resource classes (workflows, projects, jobs, executions, nodes, developerApps, oauth), and the typed error hierarchy.
---

# Using @nodaro/client

`@nodaro/client` is the typed REST SDK for Nodaro. Use it instead of hand-rolling `fetch` calls.

## Install

```bash
npm install @nodaro/client
```

(Currently not yet on public npm — will land once the project's licensing is finalized. Internal users: install from a local workspace.)

## Three auth modes — pick by environment

### Server-side (most common)

```typescript
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})
```

The token can be:
- An OAuth access token (`ndr_app_<64hex>`) — for third-party apps acting on behalf of a user
- A personal API token (`ndr_<64hex>`) — for the user's own automation

### Browser app (your operator's frontend)

```typescript
import { createClient, supabaseAuth } from "@nodaro/client"
import { createClient as supa } from "@supabase/supabase-js"

const supabase = supa(SUPABASE_URL, SUPABASE_ANON_KEY)
const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",  // empty string = same-origin via proxy
  auth: supabaseAuth(supabase),
})
```

The Supabase session JWT gets sent on every request. If session is null, no auth header.

### Custom auth logic (refresh tokens, etc.)

```typescript
import { createClient, CallbackAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new CallbackAuth(async () => {
    return await refreshTokenIfExpired()  // your logic
  }),
})
```

## Seven resources

```typescript
client.workflows       // list, get, create, update, delete, run
client.projects        // list, get, create, update, delete
client.jobs            // get, cancel
client.executions      // get, listForWorkflow, cancel
client.nodes           // list, get
client.developerApps   // list, get, create, update, delete, rotateSecret
client.oauth           // exchangeCode, revoke, getAppInfo
```

Method signatures match the underlying `/v1/*` REST routes. All return `Promise<{ data: T }>` or `Promise<T>` per the route's response envelope.

## Typed error hierarchy

```typescript
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
  await client.workflows.run(id)
} catch (err) {
  if (err instanceof UnauthorizedError) {
    // 401 — re-auth
  } else if (err instanceof ForbiddenError && err.missingScope) {
    // 403 with insufficient_scope — re-prompt for additional scope
  } else if (err instanceof InsufficientCreditsError) {
    // 402 — surface required vs available
    console.log(`Need ${err.required} credits, have ${err.available}`)
  } else if (err instanceof RateLimitedError) {
    // 429 — backoff
  } else if (err instanceof NodaroError) {
    // catch-all — has .code and .status
    console.log(err.code, err.status)
  }
}
```

## Common recipes

### Run a workflow + poll for completion

```typescript
const exec = await client.workflows.run(workflowId, { nodeIds: ["node-id"] })

while (true) {
  const { data } = await client.executions.get(exec.executionId)
  if (data.status === "completed" || data.status === "failed") break
  await new Promise(r => setTimeout(r, 2000))
}
```

### Discover what nodes are available

```typescript
const { data: nodes } = await client.nodes.list()
const imageGenNodes = nodes.filter(n => n.category === "ai-image")
```

### Run inline with `?wait=true` (no polling)

This is exposed via `client.workflows.run` if the param is supported — check the SDK source. Otherwise fall back to direct `client.request("POST", "/v1/workflows/" + id + "/run?wait=true&timeout=120", ...)` — the underlying client exposes a generic `request` method.

## When NOT to use the SDK

- **SSE / streaming endpoints** (e.g. `/v1/ai-writer/generate-stream`): the SDK doesn't yet expose SSE. Use the project's `streamRequest` helper or raw fetch with a `ReadableStream`.
- **Single-node single-shot routes** (e.g. `/v1/generate-image` directly): if you're just calling one provider, the SDK currently routes through `client.workflows.run` which expects a workflow. For raw single-route calls, use fetch.

## Custom fetch / timeout

```typescript
const client = createClient({
  baseUrl: ...,
  auth: ...,
  fetch: customFetch,       // for retries, OpenTelemetry, tests
  timeoutMs: 120_000,        // default 60_000
})
```

## TypeScript types

The SDK exports types alongside resources. Common ones:

```typescript
import type {
  Workflow, Project, Job, WorkflowExecution, NodeDescriptor,
  DeveloperApp, ExchangeCodeInput, AccessTokenResponse,
} from "@nodaro/client"
```

These match the wire shapes (e.g., `Job` uses snake_case `created_at` because that's what `sanitizeJobForPublic` returns; `Workflow` and `WorkflowExecution` use camelCase because their backend handlers map it).

## Reference

- Full SDK reference: https://nodaroai.github.io/app.nodaro.ai/sdk-reference.md
- Quickstart with end-to-end examples: https://nodaroai.github.io/app.nodaro.ai/sdk-quickstart.md
- Source: `packages/client/src/` in the repo
