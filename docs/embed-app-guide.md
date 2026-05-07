# Embed a Nodaro app in an external UI

> **Scope:** This doc covers exactly one use case — building a custom
> frontend (web or mobile) that runs an *already-published* Nodaro app
> via the REST API. For other Nodaro integration paths (calling
> individual nodes, building workflows programmatically, MCP, OAuth for
> general multi-tenant access), see the links at the bottom of this doc.
>
> **Audience:** AI code generators (Lovable, v0, Bolt, Cursor, Claude,
> ChatGPT). Hand this whole doc to the model — it is self-contained for
> the app-embedding use case.

You are building a web (or mobile) UI that runs an existing **published
Nodaro app** via Nodaro's REST API. The Nodaro app is already built and
deployed; your job is to collect inputs, kick off a run, poll for the
result, and display the output.

This doc is structured so an LLM can follow it linearly:

1. [Three things to know up front](#1-three-things-to-know-up-front)
2. [Step 1 — Probe the app to discover its inputs](#2-step-1--probe-the-app-to-discover-its-inputs)
3. [Step 2 — Probe each node type for field schemas](#3-step-2--probe-each-node-type-for-field-schemas)
4. [Step 3 — Map the discovered schema to a form](#4-step-3--map-the-discovered-schema-to-a-form)
5. [Step 4 — Run the app and poll for results](#5-step-4--run-the-app-and-poll-for-results)
6. [Step 5 — Extract and display the output](#6-step-5--extract-and-display-the-output)
7. [Authentication options](#7-authentication-options)
8. [The server-side secret rule (CRITICAL)](#8-the-server-side-secret-rule-critical)
9. [Error catalog](#9-error-catalog)
10. [Reference templates](#10-reference-templates)

---

## 1. Three things to know up front

| | |
|---|---|
| **Base URL** | `https://app.nodaro.ai` (managed) or your own self-hosted URL |
| **App identifier** | A `slug` — the last path segment of the published app URL (e.g. `https://app.nodaro.ai/app/my-cool-app` → slug is `my-cool-app`) |
| **Run shape** | Async — `POST /v1/app/:slug/run` returns immediately with a `runId`. You **must poll** `GET /v1/app/:slug/runs/:runId` for the result. There are no webhooks. |

There are exactly two probe endpoints you need before writing any UI code:

- `GET /v1/app/:slug` — public, no auth. Returns the app's input schema and metadata.
- `GET /v1/nodes/:type` — public, no auth. Returns the field schema for one node type.

Once you've probed both, you have everything needed to render a typed form.

---

## 2. Step 1 — Probe the app to discover its inputs

Call this first, no auth required:

```bash
curl https://app.nodaro.ai/v1/app/<slug>
```

The response is JSON. The fields you care about (others omitted for brevity):

```jsonc
{
  "id": "uuid",
  "name": "Headline Generator",
  "description": "...",
  "iconUrl": "https://...",
  "version": 3,                        // latest version number
  "estimatedCredits": 5,               // credits one run costs
  "maxRunsPerUserPerDay": null,        // or a number
  "thumbnailNodeId": "node-abc",       // node whose output is the "hero" result
  "snapshotNodes": [                   // the workflow's nodes
    {
      "id": "node-abc",
      "type": "generate-image",        // <-- use this in step 2
      "data": {
        "prompt": "default prompt",    // current/default value for each field
        "model": "flux",
        "aspectRatio": "1:1"
      }
    }
    // ...more nodes...
  ],
  "snapshotEdges": [ /* DAG wiring, usually irrelevant to your UI */ ],
  "snapshotSettings": {
    "presentationSettings": {
      "inputItems": [                  // <-- THIS is the form schema
        {
          "type": "field",
          "id": "item-1",
          "nodeId": "node-abc",
          "field": "prompt",
          "allowedValues": null         // or ["a","b","c"] if the field is restricted
        },
        {
          "type": "field",
          "id": "item-2",
          "nodeId": "node-abc",
          "field": "aspectRatio",
          "allowedValues": ["1:1", "16:9", "9:16"]
        }
        // type can also be "node" | "output" | "richtext" | "group"
      ]
    }
  },
  "versions": [{ "version": 3, "id": "...", "createdAt": "..." }]
}
```

### What `inputItems` items mean

| `type` | Render as |
|---|---|
| `field` | A form input. Read `nodeId`, `field`, optional `allowedValues`. |
| `node` | The whole node's default UI block — you can usually skip this when building a custom form, OR treat as "render every field of this node". |
| `output` | A live output preview (ignore at form-build time; show after run). |
| `richtext` | Static markdown the publisher wrote — render verbatim. |
| `group` | Container with `items: PresentationItem[]`. Recurse. **No nested groups.** |

Use the helper `flattenItems()` mental model: walk `inputItems`, recurse into `group`, collect every `field` item — that's your form.

---

## 3. Step 2 — Probe each node type for field schemas

The `inputItems` from step 1 give you `(nodeId, field)` pairs but **no type info** (text vs slider vs select). To learn the field type, look up the node:

```bash
curl https://app.nodaro.ai/v1/nodes/generate-image
```

Response:

```jsonc
{
  "data": {
    "type": "generate-image",
    "label": "Generate Image",
    "category": "ai-image",
    "description": "Generate an image from a text prompt.",
    "outputType": "image",
    "creditCost": "1-8",
    "providers": ["flux", "nano-banana", "ideogram", "z-image", "grok", "gpt-image", "nano-banana-pro"],
    "capabilities": ["supports-reference-image", "supports-negative-prompt"]
  }
}
```

### Inferring field type when `inputSchema` is missing

Not every node descriptor has a full `inputSchema`. When it doesn't, infer from these rules in order:

1. **`allowedValues` present in the inputItem** → render as `<select>` with those options.
2. **Current value in `snapshotNodes[i].data[field]` is a `boolean`** → toggle/checkbox.
3. **Current value is a `number`** → number input (or slider if the field name matches `*duration`, `*intensity`, `*strength`, `*scale`, `*temperature`).
4. **Current value is a `string` and field name matches `prompt|description|text|content|caption|message`** → multiline `<textarea>`.
5. **Current value is a `string` matching a URL pattern** AND node type starts with `upload-` → file upload widget; submit the public URL of the upload.
6. **Anything else** → single-line `<input type="text">`.

For known field-type hints, see this table (covers ~90% of exposed fields):

| Field name pattern | Type | Notes |
|---|---|---|
| `prompt`, `negativePrompt`, `text`, `description` | textarea | |
| `model`, `provider`, `voice`, `style`, `tone` | select | options come from `allowedValues` or `providers` array |
| `aspectRatio` | select | usually `["1:1","16:9","9:16","4:3","3:4"]` |
| `resolution` | select | usually `["1K","2K","4K"]` or `["720p","1080p","4k"]` |
| `quality` | select | usually `["medium","high"]` or similar |
| `duration`, `nFrames`, `seed`, `temperature` | number | |
| `enableTranslation`, `addAudio`, `headless`, `loop` | toggle | |
| `imageUrl`, `videoUrl`, `audioUrl`, `referenceImage` | URL string | upload elsewhere first; paste resulting URL |

---

## 4. Step 3 — Map the discovered schema to a form

Concrete algorithm to produce a form definition:

```typescript
// Pseudocode — adapt to your framework.
type FormField = {
  nodeId: string
  field: string
  label: string                     // humanize: "aspectRatio" → "Aspect ratio"
  control: "text" | "textarea" | "number" | "toggle" | "select" | "upload"
  options?: Array<string | number | boolean>
  defaultValue: unknown
}

async function buildForm(slug: string, baseUrl: string): Promise<FormField[]> {
  const app = await fetch(`${baseUrl}/v1/app/${slug}`).then(r => r.json())
  const nodesById = new Map(app.snapshotNodes.map(n => [n.id, n]))

  const fields: FormField[] = []
  const walk = (items) => {
    for (const it of items ?? []) {
      if (it.type === "group") walk(it.items)
      if (it.type !== "field") continue
      const node = nodesById.get(it.nodeId)
      const current = node?.data?.[it.field]
      fields.push(toFormField(it, node, current))
    }
  }
  walk(app.snapshotSettings?.presentationSettings?.inputItems ?? [])
  return fields
}
```

Key points your generated UI must respect:

- **Form keys are `nodeId`, not field labels.** When the user submits, the body shape is `{ inputOverrides: { [nodeId]: { [field]: value } } }`.
- **`allowedValues` is enforced server-side.** Submitting a value not in the list returns 400 `validation_error`.
- **Pre-fill defaults from `snapshotNodes[i].data`.** A user who submits without changing anything still gets a meaningful run.
- **Show `estimatedCredits`** somewhere visible — users like knowing the cost.
- **If `maxRunsPerUserPerDay` is set, surface it** (e.g. "You've used 2 of 5 today") to avoid surprise 429s.

---

## 5. Step 4 — Run the app and poll for results

### Start the run (auth required)

```bash
curl -X POST https://app.nodaro.ai/v1/app/<slug>/run \
  -H "Authorization: Bearer ndr_<your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "inputOverrides": {
      "node-abc": { "prompt": "a cat astronaut", "aspectRatio": "16:9" }
    }
  }'
```

Response (`202 Accepted`):

```json
{
  "executionId": "exec-uuid",
  "runId": "run-uuid",
  "status": "pending"
}
```

Optional body fields:
- `version: number` — pin to a specific version (default: latest)
- `runId: uuid` — pre-created draft run (advanced; ignore for first build)

### Poll until done

```bash
curl https://app.nodaro.ai/v1/app/<slug>/runs/<runId> \
  -H "Authorization: Bearer ndr_<your-token>"
```

Response shape:

```jsonc
{
  "id": "run-uuid",
  "executionId": "exec-uuid",
  "status": "pending|running|completed|failed",
  "creditsUsed": 0,
  "thumbnailUrl": null,                       // populated when complete
  "execution": {
    "status": "pending|running|completed|failed",
    "nodeStates": {
      "node-abc": {
        "status": "completed",
        "output": {                           // shape depends on node outputType
          "url": "https://r2.../result.png",  // try these keys, in order:
          "imageUrl": "...",                  //   url, imageUrl, videoUrl,
          "videoUrl": "...",                  //   audioUrl, resultUrl, text
          "audioUrl": "...",
          "resultUrl": "...",
          "text": "..."
        }
      }
    },
    "totalNodes": 5,
    "completedNodes": 5,
    "failedNodes": 0,
    "totalCreditsUsed": 5,
    "errorMessage": null,
    "completedAt": "2026-05-07T..."
  }
}
```

**Polling cadence:** every 2 seconds is fine. Stop when `execution.status` is `completed` or `failed`. Show a progress bar from `completedNodes / totalNodes` while running.

Show errors from `execution.errorMessage` on failure.

---

## 6. Step 5 — Extract and display the output

The "hero" output is whatever `thumbnailNodeId` from step 1 points at. Extract its URL by trying these keys in order on `execution.nodeStates[thumbnailNodeId].output`:

1. `url`
2. `imageUrl`
3. `videoUrl`
4. `audioUrl`
5. `resultUrl`
6. `text` (for text outputs — render directly, not as a URL)

Render based on the node's `outputType` from `GET /v1/nodes/:type`:

| `outputType` | Render as |
|---|---|
| `image` | `<img src={url} />` |
| `video` | `<video src={url} controls />` |
| `audio` | `<audio src={url} controls />` |
| `text` | `<pre>{text}</pre>` or markdown |
| `data` | JSON viewer / treat as opaque |

If `thumbnailNodeId` is null, fall back to the **last node in topological order** (or just iterate `nodeStates` and show every non-empty output).

---

## 6.5. Deleting a run (soft-delete / archive semantics)

```bash
curl -X DELETE https://app.nodaro.ai/v1/app/<slug>/runs/<runId> \
  -H "Authorization: Bearer ndr_<token>"
```

This is a **soft-delete**: the run is moved to the user's archive (hidden from the default run list, but recoverable). The response is `{ "success": true, "archived": true }`.

Why soft, not hard:
- API / SDK / MCP `DELETE` calls cannot accidentally destroy a user's data. If an automation deletes the wrong run, the user can still recover it.
- Restore (`POST /v1/app/:slug/runs/:runId/restore`) and permanent deletion (`DELETE /v1/app/:slug/runs/:runId/permanent`) are intentionally **only exposed through the Nodaro UI** at https://app.nodaro.ai/archived-runs. They are reachable via direct HTTPS for the UI's needs but are not advertised as integration endpoints — your integrations should not call them.

If you need confirmation flow in your UI, ask the user to delete in your app, then call DELETE — they can always recover from Nodaro's archive if needed.

## 7. Authentication options

There are two ways to get a `Bearer` token. Pick one based on your use case.

### Option A — Personal API token (simplest)

> Use when **you** (one Nodaro account) own all runs. Your account pays the credits. Best for a personal tool, internal dashboard, or single-tenant SaaS.

1. Sign in to Nodaro.
2. Go to `/settings/api-tokens` → **New API token**.
3. Copy the `ndr_<64hex>` value (shown once).
4. Store it as a **server-side secret** (see [§8](#8-the-server-side-secret-rule-critical)).
5. Send as `Authorization: Bearer ndr_...` on every call.

Tokens don't expire until revoked. Revoke from the same settings page.

### Option B — OAuth 2.0 (multi-user)

> Use when your app's **end-users have their own Nodaro accounts** and you want each user's runs charged to their account.

This is a standard authorization-code flow. Full walkthrough: [oauth-flow.md](./oauth-flow.md). Summary:

1. **Register a developer app** at `/settings/developer-apps`. Get `clientId` and `clientSecret` (clientSecret shown once).
2. **Redirect the user** to `/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=workflows:execute+jobs:read&state=<csrf>`.
3. **User clicks Allow** → browser redirected to your `redirect_uri` with `?code=ndr_code_<48hex>&state=<echo>`.
4. **Exchange** the code (server-side) at `POST /v1/oauth/token` with `client_id` + `client_secret` + `code`. Receive `access_token` (`ndr_app_<64hex>`, lifetime 90 days).
5. Use `Authorization: Bearer ndr_app_...` on every call. The token carries the user's identity and granted scopes.

**Required scopes for running a published app:** `workflows:execute` (run) and `jobs:read` (poll).

If a 403 `insufficient_scope` comes back, re-do the authorize flow with broader scopes.

### Which to choose

| You | Use |
|---|---|
| Building a personal tool, agency dashboard, or internal automation | **Personal API token** |
| Building a SaaS where customers connect their own Nodaro account | **OAuth** |
| Building a public marketplace tool that runs apps for anonymous visitors | **Personal API token** (you pay; rate-limit per visitor on your side) |

---

## 8. The server-side secret rule (CRITICAL)

> **The Bearer token must never appear in the browser bundle.**

Vite, Next.js, and other bundlers inline any env var prefixed `VITE_*` / `NEXT_PUBLIC_*` into the shipped JS — anyone with devtools can read it and burn your credits.

The required architecture:

```
[Browser UI] ──HTTPS──> [Your server / Edge Function] ──HTTPS──> Nodaro API
                          (holds NODARO_API_TOKEN)
```

Concrete recipes:

| Stack | Where the token lives |
|---|---|
| Lovable + Supabase | Supabase Edge Function secret (`supabase secrets set NODARO_API_TOKEN=...`) |
| Next.js | Server route handler / API route (`process.env.NODARO_API_TOKEN`, **without** `NEXT_PUBLIC_` prefix) |
| SvelteKit / Remix / Nuxt | Server-only env (`$env/static/private` in SvelteKit) |
| Vercel / Netlify Edge Function | Project env var (NOT exposed to client) |
| Cloudflare Worker | Worker secret (`wrangler secret put NODARO_API_TOKEN`) |

**Browser CORS:** since the browser only ever talks to your own server (not Nodaro), you don't need to add your domain to Nodaro's allowed origins. (If you DO call Nodaro from the browser via OAuth, register your origin in the developer app's `allowed_origins`.)

---

## 9. Error catalog

All errors have shape `{ "error": { "code": "...", "message": "..." } }`.

| HTTP | Code | Cause | Action |
|---|---|---|---|
| 400 | `validation_error` | Bad `inputOverrides` shape, value not in `allowedValues`, malformed slug | Fix the request body |
| 401 | `unauthorized` | Missing/expired/revoked token | Re-mint or re-authorize |
| 402 | `insufficient_app_credits` | Token's account is out of credits | Top up credits or switch plan |
| 403 | `insufficient_scope` (with `missingScope` field) | OAuth token doesn't have required scope | Re-do `/oauth/authorize` with broader scopes |
| 404 | `not_found` | Slug or runId doesn't exist (or app deactivated) | Check the slug; surface "App unavailable" |
| 429 | `rate_limit_exceeded` | Daily run cap (`maxRunsPerUserPerDay`) reached | Show "Daily limit reached" UI |
| 500 | `internal_error` | Server fault | Retry once with backoff; alert if persistent |

---

## 10. Reference templates

### Supabase Edge Function (Deno) — proxy + start run + poll

```typescript
// supabase/functions/nodaro-run/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const BASE = Deno.env.get("NODARO_BASE_URL")!       // e.g. https://app.nodaro.ai
const TOKEN = Deno.env.get("NODARO_API_TOKEN")!     // ndr_...
const SLUG = Deno.env.get("NODARO_APP_SLUG")!       // my-cool-app

serve(async (req) => {
  const url = new URL(req.url)

  // Public probe — proxy unauthenticated. No token sent (the upstream is public).
  if (req.method === "GET" && url.pathname.endsWith("/schema")) {
    const r = await fetch(`${BASE}/v1/app/${SLUG}`)
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } })
  }

  // Start a run.
  if (req.method === "POST" && url.pathname.endsWith("/run")) {
    const { inputs } = await req.json()
    const r = await fetch(`${BASE}/v1/app/${SLUG}/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputOverrides: inputs }),
    })
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } })
  }

  // Poll a run.
  const m = url.pathname.match(/\/runs\/([0-9a-f-]{36})$/)
  if (req.method === "GET" && m) {
    const runId = m[1]
    const r = await fetch(`${BASE}/v1/app/${SLUG}/runs/${runId}`, {
      headers: { "Authorization": `Bearer ${TOKEN}` },
    })
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } })
  }

  return new Response("Not found", { status: 404 })
})
```

### Browser-side: discover, run, poll (vanilla TS, no SDK needed)

```typescript
// 1) On mount: probe schema and build a form.
const schema = await fetch("/functions/v1/nodaro-run/schema").then(r => r.json())
const inputItems = schema.snapshotSettings?.presentationSettings?.inputItems ?? []
// ...render form using rules from §3 + §4...

// 2) On submit: POST inputOverrides keyed by nodeId.
const start = await fetch("/functions/v1/nodaro-run/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    inputs: {
      "node-abc": { prompt: form.prompt, aspectRatio: form.aspectRatio },
    },
  }),
}).then(r => r.json())

// 3) Poll every 2s until terminal.
let last = start
while (last.status !== "completed" && last.execution?.status !== "completed"
       && last.status !== "failed" && last.execution?.status !== "failed") {
  await new Promise(res => setTimeout(res, 2000))
  last = await fetch(`/functions/v1/nodaro-run/runs/${start.runId}`).then(r => r.json())
  // updateProgress(last.execution.completedNodes, last.execution.totalNodes)
}

// 4) Extract output.
const tnId = schema.thumbnailNodeId
const out = last.execution?.nodeStates?.[tnId]?.output ?? {}
const heroUrl = out.url ?? out.imageUrl ?? out.videoUrl ?? out.audioUrl ?? out.resultUrl
const heroText = out.text
```

### Probe checklist for the LLM (do all of these before generating UI code)

- [ ] `GET {BASE}/v1/app/{slug}` — got the input schema and defaults
- [ ] For each unique `nodeId` referenced in `inputItems`, looked up `snapshotNodes[i].type`
- [ ] For each unique node type, called `GET {BASE}/v1/nodes/{type}` to learn category, outputType, providers
- [ ] Built a `FormField[]` array using the inference rules in §3
- [ ] Identified the output node (`thumbnailNodeId` or last-in-topological-order) and its `outputType`
- [ ] Confirmed the user has provided either `NODARO_API_TOKEN` (option A) or developer-app credentials (option B)
- [ ] Confirmed the secret will live server-side per §8

---

## See also

- [API Integration](./api-integration.md) — the underlying REST API (per-endpoint access, not full apps)
- [OAuth Flow](./oauth-flow.md) — full multi-user flow, including consent UI and revocation
- [SDK Quickstart](./sdk-quickstart.md) — `@nodaro/client` typed SDK (covers projects/workflows/jobs/executions; published-apps endpoints are not yet wrapped — call them via `fetch` as shown above)
- [Node Reference](./nodes/README.md) — every supported node type
