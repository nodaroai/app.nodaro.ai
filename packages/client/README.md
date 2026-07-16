# @nodaro/sdk

Typed REST client for the [Nodaro](https://app.nodaro.ai) AI video workflow platform — image / video / voice / music generation, entity studios, and workflows-as-APIs.

```bash
npm install @nodaro/sdk
```

Docs: [Documentation](https://nodaroai.github.io/app.nodaro.ai/) · [SDK Quickstart](https://nodaroai.github.io/app.nodaro.ai/sdk-quickstart.md) · [SDK Reference](https://nodaroai.github.io/app.nodaro.ai/sdk-reference.md) · [llms.txt](https://nodaroai.github.io/app.nodaro.ai/llms.txt)

## Getting credentials

| You are building… | Credential | Where to get it |
|---|---|---|
| A script / backend / CI acting as **yourself** | Personal API token (`ndr_…`) | **[app.nodaro.ai/settings/api](https://app.nodaro.ai/settings/api)** → Generate token → `NODARO_ACCESS_TOKEN` |
| An app acting **on behalf of other Nodaro users** | OAuth app (`client_id` + `client_secret`) | **[app.nodaro.ai/settings/developer-apps](https://app.nodaro.ai/settings/developer-apps)** → New app (redirect URIs, origins, scopes). The `client_secret` is shown **once** — there's a rotate button if you lose it. |
| A frontend for a Nodaro instance **you operate** (self-hosted, or first-party) | Your own Supabase project's URL + anon key | Your deployment's `.env` — see the browser quick start below |

The browser/Supabase mode is **not** for third-party apps against the hosted
app.nodaro.ai — third parties use a personal token or the OAuth flow.

**Not using TypeScript?** Everything here is plain REST — generate a Go /
Rust / Python client from the live [OpenAPI spec](https://app.nodaro.ai/v1/openapi.json)
([how-to](https://nodaroai.github.io/app.nodaro.ai/api-integration.html)).

## Quick start (server-side, personal API token)

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const client = createClient({
  baseUrl: "https://app.nodaro.ai",
  // token: https://app.nodaro.ai/settings/api
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})

const projects = await client.projects.list()
const exec = await client.workflows.run(workflowId, {
  nodeIds: ["text-prompt-1"],  // optional subset
})
```

## LLM quick start

Building with Claude, Cursor, or another coding agent? Two pieces:
**the primer** (reusable context for *any* Nodaro project) and an
**example project brief** (a concrete first app). Paste the primer, then a
brief — yours or ours.

Primer straight to your clipboard
([raw file](https://nodaroai.github.io/app.nodaro.ai/sdk-agent-primer.txt)):

```bash
curl -s https://nodaroai.github.io/app.nodaro.ai/sdk-agent-primer.txt | pbcopy      # macOS
curl -s https://nodaroai.github.io/app.nodaro.ai/sdk-agent-primer.txt | xclip -sel clip  # Linux
```

### The primer — paste into any project

<!-- Keep in sync with docs/sdk-agent-primer.txt (canonical raw copy). -->

````text
You are building against @nodaro/sdk (npm), the typed client for the Nodaro
AI video platform (https://app.nodaro.ai).

Setup:
  npm install @nodaro/sdk
  Auth: the user creates a token at https://app.nodaro.ai/settings/api and
  sets NODARO_ACCESS_TOKEN. Never hardcode tokens.

Core pattern (all generation is async; runAndWait submits + polls + resolves):
  import { createClient, StaticTokenAuth } from "@nodaro/sdk"
  const client = createClient({
    baseUrl: "https://app.nodaro.ai",
    auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
  })
  const img = await client.nodes.runAndWait("generate-image", {
    prompt: "…", provider: "nano-banana-2",          // fast + cheap, great default
  })
  const vid = await client.nodes.runAndWait("generate-video", {
    prompt: "…", imageUrl: img.imageUrl,
    provider: "seedance-2-fast", duration: 4,        // platform default; 4/8/12/15s
  })
  // outputs: .imageUrl / .videoUrl / .audioUrl on the resolved object

Models available (full lists with credit costs, as raw markdown):
  image: https://nodaroai.github.io/app.nodaro.ai/nodes/ai-image/generate-image.md
  video: https://nodaroai.github.io/app.nodaro.ai/nodes/ai-video/generate-video.md
  (or at runtime: client.nodes.get(type) → data.providers + credits.modelCosts)

Model choice:
  - Omitting `provider` uses the platform's default model for that node —
    fine for a v1. To offer users a model picker:
      const { data } = await client.nodes.get("generate-video")  // data.providers
      const costs = await client.credits.modelCosts(data.providers)
    Render provider options with their credit costs next to them.

UX rules (generation takes seconds-to-minutes — never block silently):
  - Show intermediate results immediately: render the image as soon as
    generate-image resolves, WHILE the video step is still running.
  - Show live progress: pass onProgress to runAndWait — it receives the lean
    job status on every poll:
      await client.nodes.runAndWait("generate-video", { … }, {
        onProgress: (s) => setBar(s.progress ?? 0),   // 0–100 when reported
      })
    For manual loops use client.jobs.getStatus(jobId) (id/status/progress).
  - Let the user cancel: pass { signal } (AbortSignal) in the same options.

Rules:
  - Generations cost credits; catch InsufficientCreditsError (has .required /
    .available). All errors are typed classes exported from @nodaro/sdk.
  - Prefer client.nodes.runAndWait over hand-rolled polling; for manual loops
    use client.jobs.getStatus(id) (lean poll endpoint).
  - 22 resources on the client (workflows, characters, voices, pipelines, …):
    full reference https://nodaroai.github.io/app.nodaro.ai/sdk-reference.md
  - Node catalog + per-node params:
    https://nodaroai.github.io/app.nodaro.ai/nodes/ (all pages exist as .md)
````

### Example project brief — "animated postcard"

A proven first build (text in → video out). Paste after the primer:

```text
Build a small web app — "animated postcard":
  1. A prompt box. On submit: generate-image (nano-banana-2) with the prompt.
  2. Show the image IMMEDIATELY when it resolves.
  3. Then generate-video (seedance-2-fast, duration 4) with that image as
     imageUrl and prompt "subtle cinematic motion".
  4. While it renders: progress bar driven by onProgress (% from s.progress),
     and a Cancel button wired to an AbortSignal.
  5. When done, swap the image for the looping video and show a download link.
Keep it to one page. Handle InsufficientCreditsError with a friendly message.
```

## Connect via MCP

Prefer driving Nodaro from an AI client instead of code? The hosted MCP
server exposes generation, workflow, and app tools:

```
https://mcp.nodaro.ai/mcp
```

[![Claude.ai](https://img.shields.io/badge/Claude.ai-connect-D97757?logo=claude&logoColor=white)](https://nodaroai.github.io/app.nodaro.ai/mcp/connecting-claude.html)
[![Cursor](https://img.shields.io/badge/Cursor-connect-111111)](https://nodaroai.github.io/app.nodaro.ai/mcp/connecting-cursor.html)
[![Cline](https://img.shields.io/badge/Cline-connect-7C3AED)](https://nodaroai.github.io/app.nodaro.ai/mcp/connecting-cline.html)
[![Continue](https://img.shields.io/badge/Continue-connect-0B7285)](https://nodaroai.github.io/app.nodaro.ai/mcp/connecting-continue.html)
[![Goose](https://img.shields.io/badge/Goose-connect-1F6FEB)](https://nodaroai.github.io/app.nodaro.ai/mcp/connecting-goose.html)

Claude Code, one line:

```bash
claude mcp add --transport http nodaro https://mcp.nodaro.ai/mcp
```

MCP also ships **[Skills](https://nodaroai.github.io/app.nodaro.ai/mcp/index.html#skills)** —
zero-install agent playbooks that come with the connection:
[Film Director](https://nodaroai.github.io/app.nodaro.ai/mcp/film-director.html)
(10-stage script → final-cut workflow, assembled live on your canvas) and
[Video Director](https://nodaroai.github.io/app.nodaro.ai/mcp/video-director.html)
(one-shot narrated motion-graphics videos).

## Run AI nodes directly

Every generation node is callable without building a workflow. Jobs are
async — `runAndWait` submits, polls, and resolves the output media URL:

```ts
const image = await client.nodes.runAndWait("generate-image", {
  prompt: "a lighthouse at golden hour, cinematic",
})

const video = await client.nodes.runAndWait("generate-video", {
  prompt: "gentle camera push-in, waves rolling",
  imageUrl: image.imageUrl,        // start frame → image-to-video
})

console.log(video.videoUrl)
```

## Quick start (browser, Supabase JWT — self-hosted / first-party)

For a frontend talking to a Nodaro deployment you operate: your users log in
through **your** Supabase project (the same one your Nodaro backend uses), and
their session JWT authenticates SDK calls.

```ts
import { createClient, supabaseAuth } from "@nodaro/sdk"
import { createClient as supa } from "@supabase/supabase-js"

// Your deployment's own values (the same ones in your Nodaro .env)
const supabase = supa(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  auth: supabaseAuth(supabase),
})
```

## OAuth flow (third-party app)

Create the app under **Settings → Developer Apps**, send the user to the
consent screen, then exchange the one-shot code (10-minute TTL) server-side:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const client = createClient({
  baseUrl: "https://app.nodaro.ai",
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
  baseUrl: "https://app.nodaro.ai",
  auth: new StaticTokenAuth(tokens.access_token),
})
```

Full walkthrough: [OAuth flow](https://nodaroai.github.io/app.nodaro.ai/oauth-flow.md).

## Errors

All resource methods throw a typed error from `@nodaro/sdk`:

- `UnauthorizedError` (401)
- `ForbiddenError` (403, includes `missingScope` when applicable)
- `NotFoundError` (404)
- `RateLimitedError` (429)
- `InsufficientCreditsError` (402, with `required` and `available`)
- `StorageExceededError` (413)
- `NodaroError` (everything else, includes `code` and `status`)

```ts
import { ForbiddenError, InsufficientCreditsError } from "@nodaro/sdk"

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
| `client.jobs` | Job status (+ lean `getStatus` for poll loops) and cancellation |
| `client.executions` | Workflow execution status, list, cancel |
| `client.nodes` | Node discovery + direct `run` / `runAndWait` / `runMany` |
| `client.apps` | Published apps: inputs, run, runs history |
| `client.characters` | Character Studio: CRUD, portraits, assets, motion, LoRA |
| `client.locations` | Location Studio: CRUD, assets, atmosphere motion |
| `client.objects` | Object Studio: CRUD, assets, motion |
| `client.creatures` | Creature Studio: CRUD, assets, motion |
| `client.voices` | Voice catalog + clones (from URL or file), voice changer, multi-speaker recast + the interactive `analyze`/stems/`exportMix` flow, design, remix, dubbing |
| `client.pipelines` | Showrunner pipelines: stages, approvals, chat, branch |
| `client.reduce` | Fan-in reducer (pick-best, concat, vote, merge…) |
| `client.promptHelper` | Prompt enhancement / wizard |
| `client.credits` | Balance + per-model cost lookup |
| `client.uploads` | Signed upload URLs for image / video / audio |
| `client.library` | Generated-media library |
| `client.presets` | Node presets (factory + user) |
| `client.pickerCatalogs` | Parameter-picker catalog discovery |
| `client.community` | Shared characters/locations/objects: browse, clone, favorites |
| `client.developerApps` | Manage your own OAuth apps |
| `client.oauth` | Code exchange, revoke, app-info |

## Auth modes

| Class | Use when |
|-------|----------|
| `StaticTokenAuth(token)` | You have a fixed token (personal API token, OAuth access token) — server-side or mobile |
| `supabaseAuth(supabase)` | Browser frontend talking to a Nodaro instance you operate (uses live session JWT) |
| `CallbackAuth(fn)` | BYO logic (refresh tokens, custom auth) |

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
