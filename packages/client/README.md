# @nodaro/client

Typed REST client for the [Nodaro](https://nodaro.ai) AI workflow platform.

```bash
npm install @nodaro/client
```

## Quick start (server-side, OAuth access token)

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

const projects = await client.projects.list()
const exec = await client.workflows.run(workflowId, {
  nodeIds: ["text-prompt-1"],  // optional subset
})
```

## Quick start (browser, Supabase JWT)

```ts
import { createClient, supabaseAuth } from "@nodaro/client"
import { createClient as supa } from "@supabase/supabase-js"

const supabase = supa(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  auth: supabaseAuth(supabase),
})
```

## OAuth flow (third-party app)

Server-side: exchange a code for an access token after the user clicks "Allow" on the consent screen.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(""),  // no auth for the token exchange itself
})

const tokens = await client.oauth.exchangeCode({
  grant_type: "authorization_code",
  client_id: process.env.NODARO_CLIENT_ID!,
  client_secret: process.env.NODARO_CLIENT_SECRET!,
  code: req.query.code as string,
  redirect_uri: "https://yourapp.com/oauth/callback",
})

// Now use the access_token for subsequent calls
const userClient = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(tokens.access_token),
})
```

## Errors

All resource methods throw a typed error from `@nodaro/client`:

- `UnauthorizedError` (401)
- `ForbiddenError` (403, includes `missingScope` when applicable)
- `NotFoundError` (404)
- `RateLimitedError` (429)
- `InsufficientCreditsError` (402, with `required` and `available`)
- `StorageExceededError` (413)
- `NodaroError` (everything else, includes `code` and `status`)

```ts
import { ForbiddenError, InsufficientCreditsError } from "@nodaro/client"

try {
  await client.workflows.run(id)
} catch (err) {
  if (err instanceof ForbiddenError && err.missingScope === "workflows:execute") {
    // Token doesn't have execute scope — re-auth with broader scopes
  } else if (err instanceof InsufficientCreditsError) {
    console.log(`Need ${err.required} credits, have ${err.available}`)
  } else {
    throw err
  }
}
```

## Resources

| Resource | Purpose |
|----------|---------|
| `client.workflows` | List, get, create, update, delete, run |
| `client.projects` | Workspace organization |
| `client.jobs` | Status + cancellation |
| `client.executions` | Workflow execution status + cancel/list |
| `client.nodes` | Node metadata discovery (Phase 1's `/v1/nodes`) |
| `client.developerApps` | Manage your own OAuth apps |
| `client.oauth` | Code exchange, revoke, app-info |

More resources (assets, credits, social-publish, triggers) coming as the SDK matures.

## Auth modes

| Class | Use when |
|-------|----------|
| `StaticTokenAuth(token)` | You have a fixed token (OAuth access token, API token) — server-side or mobile apps |
| `supabaseAuth(supabase)` | Browser frontend talking to a Nodaro instance you operate (uses live session JWT) |
| `CallbackAuth(fn)` | BYO logic (refresh tokens, custom auth) |

## License

Apache-2.0 — see the repository root LICENSE.
