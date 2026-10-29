# SDK Quickstart

> **No subscription required.** Load any amount of credits (pay-as-you-go)
> and the full API/SDK/MCP surface is available — all models, no watermark,
> credits are valid for 12 months.

`@nodaro/sdk` is a typed REST client for Nodaro. It works in Node, browsers,
and React Native — anywhere `fetch` exists. This walkthrough goes from "install"
to running a workflow end-to-end.

If you just want a method-by-method index, see the
[SDK Reference](./sdk-reference.md). For the OAuth consent flow, see
[OAuth Flow](./oauth-flow.md).

For editable 3D previews, use `client.scene3d.generate`, then `edit` and
`render`. New scenes can combine image/video `references` with immutable GLB
`inputAssets` selectors on an import-capable advanced engine. See the
[3D scene SDK contract](sdk-reference.md#editable-3d-scenes) for availability,
selector shape, and the preview-to-MP4 flow.

## 1. Install + first request

```bash
npm install @nodaro/sdk
```

The simplest possible call uses `client.nodes.list()` — it requires no scopes
and works on any reachable Nodaro instance:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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
import { createClient, supabaseAuth } from "@nodaro/sdk"
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
import { createClient, CallbackAuth } from "@nodaro/sdk"

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
} from "@nodaro/sdk"

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
- `StorageExceededError.limitBytes?: number` / `.reason?: string` — the 413's own code: `file_too_large` is one file over the limit, `storage_limit_exceeded` a full storage

## 4. Common workflows

### Run a workflow and poll for completion

`workflows.run()` returns immediately with an `executionId`. Poll
`executions.get()` until the status is terminal:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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

### Be told when a job finishes, instead of polling (webhooks)

Register an https endpoint once; from then on Nodaro POSTs it every
`job.completed` / `job.failed` of your account, signed with the endpoint's
own secret and retried until your server answers with a 2xx:

```ts
const { data: endpoint, secret } = await client.webhooks.create({ url: "https://example.com/nodaro-webhook" })
// `secret` is shown this once — keep it with your server's config.
await client.webhooks.test(endpoint.id) // a `ping`; see client.webhooks.deliveries(endpoint.id)
```

On the receiving side, check the signature on the raw body before trusting
it:

```ts
import { verifyWebhookSignature } from "@nodaro/sdk"

const event = await verifyWebhookSignature({
  payload: rawBody,
  header: request.headers.get("nodaro-signature"),
  secret: process.env.NODARO_WEBHOOK_SECRET!,
})
if (event.type === "job.completed") console.info(event.data.job.output_data)
```

The events, the body, the retry schedule and verifying by hand in other
languages: [Webhooks](./webhooks.md).

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
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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

// `jobIds` is always present — one entry per candidate (synthesized even from
// legacy single-job responses). `jobId` is a deprecated count===1 alias.
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

### Pick the best of N generations (Reduce / fan-in)

`client.reduce.run()` runs the [Reduce node](./nodes/utility/reduce.md)
programmatically. Useful when you've generated several candidates and want
to pick the best, concatenate them, vote, or merge as JSON — without
building a workflow on the canvas.

```ts
// Pick the best of 5 generated images
const result = await client.reduce.run({
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
const joined = await client.reduce.run({
  strategyId: "concat",
  strategyConfig: { separator: "\n---\n" },
  inputs: ["A", "B", "C"],
})

// Majority vote (ties → first)
const winner = await client.reduce.run({
  strategyId: "vote",
  inputs: ["red", "blue", "red", "red", "blue"],
})

// Deep-merge JSON fragments into one object
const merged = await client.reduce.run({
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

### Plan and render a podcast edit (editorial primitives)

`client.edit` wraps the phase-1 editorial routes. A typical flow: detect
silence, plan a cut from the transcript, then render the plan with `applyEdl`.
Each request returns `{ jobId }`; poll it with `client.jobs.getStatus`.

```ts
import { unwrapEditPlanOutput } from "@nodaro/sdk"

// 1. Detect silence in the recording
const sd = await client.edit.silenceDetect({ audioUrl: masterUrl, thresholdDb: -35 })
const silence = (await client.jobs.getStatus(sd.jobId)).data.output_data.json // SilenceRanges

// 2. Plan a tighten cut from a timed transcript + the detected silence
const plan = await client.edit.editPlan({
  mode: "tighten",
  planTier: "standard",
  transcript,                                    // a transcribe job's output_data.json
  sources: [{ id: "ep", url: masterUrl, kind: "video", role: "master-audio" }],
  silence,
})
const edl = unwrapEditPlanOutput((await client.jobs.getStatus(plan.jobId)).data.output_data)

// 3. Render the plan into a final cut
const render = await client.edit.applyEdl({ edl, output: "video", quality: "final" })
```

`remapTranscript(edl, transcript)` re-times a transcript through an EDL purely
locally — no request — handy for captioning the cut without a render.

Or in one call: `client.edit.tightenEpisode` runs the whole chain —
transcribe, plan, render, with optional captions, music and framing — and
answers one job to poll. Its fee is 11 credits<!-- credits: use-case-fee:tighten-episode --> per run, on top of
its steps; quote a run first with `estimateTightenEpisode`.

```ts
const episode = await client.edit.tightenEpisode({ mediaUrl: masterUrl, musicUrl: bedUrl })
const done = await client.jobs.getStatus(episode.jobId) // output_data.videoUrl (or audioUrl)
```

A conversation filmed on several cameras is one call as well: pass the
cameras' recordings in order as `mediaUrls`, the mixer track as
`masterAudioUrl`, and optionally `cameras` (`wide`, `synced`,
`speakerCameras`). The run lines them up, works out who is on which camera and
cuts to whoever is talking; `output_data.cameras` says who went where. This
needs Speaker Map, which is not yet enabled on nodaro.ai: until it is, the
request is refused `403 node_not_available`.

```ts
const multicam = await client.edit.tightenEpisode({
  mediaUrls: [camAUrl, camBUrl, wideUrl],
  masterAudioUrl: mixerUrl,
  cameras: { wide: 3 },
})
```

Its chapters, for the show notes, are one call too: `client.edit.episodeChapters`
transcribes the recording and plans its chapters; nothing is rendered. Its fee
is 11 credits<!-- credits: use-case-fee:episode-chapters --> per run, on top of its steps (quote it with
`estimateEpisodeChapters`). Not yet enabled on nodaro.ai.

```ts
const chapters = await client.edit.episodeChapters({ mediaUrl: masterUrl })
const listed = await client.jobs.getStatus(chapters.jobId) // output_data.text: "0:00 Intro\n4:05 …"; output_data.json: [{ startMs, title }]
```

A trailer for social media is one call as well: `client.edit.episodeTrailer`
cuts a 20–40 second trailer from the recording and pads it to each format you
choose (default 9:16, 1:1 and 4:5; also 16:9), optionally after an intro card.
Its fee is 11 credits<!-- credits: use-case-fee:episode-trailer --> per run, on top of its steps (quote it with
`estimateEpisodeTrailer`). Not yet enabled on nodaro.ai. It takes the cameras
of one conversation as Tighten Episode does (`mediaUrls`, `masterAudioUrl`,
`cameras`), with the same need for Speaker Map.

```ts
const trailer = await client.edit.episodeTrailer({ mediaUrl: masterUrl, formats: ["9:16", "1:1"] })
const cut = await client.jobs.getStatus(trailer.jobId) // output_data.formats: [{ format: "9:16", url }, { format: "1:1", url }]
```

A pack of short clips is one call too: `client.edit.clipPack` finds the
best moments of the recording (8 by default, about 60 seconds each) and
renders each as its own clip, framed for 9:16 with the speakers stacked and
captioned by default (`framing: null` keeps the recording's shape).
Its fee is 11 credits<!-- credits: use-case-fee:clip-pack --> per run, on top of its steps (quote it with
`estimateClipPack`). Not yet enabled on nodaro.ai. It takes the cameras of
one conversation as Tighten Episode does (`mediaUrls`, `masterAudioUrl`,
`cameras`; each clip then cuts to whoever is talking), with the same need for
Speaker Map, and `framingSource: "tracking"` follows faces.

```ts
const pack = await client.edit.clipPack({ mediaUrl: masterUrl, count: 5 })
const clips = await client.jobs.getStatus(pack.jobId) // output_data.clips: [{ url, title?, hook?, clipKey, thumbnailUrl?, captionsFailed? }, …]
```

To frame a whole recording by speaker without cutting anything, call
`client.edit.speakerLayout`: the video is as long as the recording, each
speaker framed in turn (9:16 with the speakers stacked by default; set
`targetAspect`, `layout`, `switchType`, `emphasisStyle`).
Its fee is 11 credits<!-- credits: use-case-fee:speaker-layout --> per run, on top of its steps (quote it with
`estimateSpeakerLayout`). Not yet enabled on nodaro.ai. It takes the cameras
of one conversation as Tighten Episode does (each speaker is then shown on
their own camera), with the same need for Speaker Map.

```ts
const layout = await client.edit.speakerLayout({ mediaUrl: masterUrl, targetAspect: "9:16" })
const framed = await client.jobs.getStatus(layout.jobId) // output_data.videoUrl: the framed video
```

### Improve a prompt with the Prompt Wizard

`client.promptHelper` is AI assistance for writing prompts for generation
nodes. The quickest path is `enhance()` — a one-shot "improve this prompt":

```ts
const { prompt } = await client.promptHelper.enhance({ nodeType: "generate-image", prompt: "snow leopard on a rock" })
console.log(prompt)
```

For a guided flow, `analyze()` returns questions you answer, then `generate()`
builds the final prompt from those selections. See
[SDK Reference → client.promptHelper](./sdk-reference.md#clientprompthelper).

### Find posts that work, then learn from them (Social Search)

On Nodaro Cloud, `social-search` finds public posts on one platform by keyword
or account, with their numbers. Find the most viewed, then hand the best one
to any node that reads a post:

```ts
const found = await client.nodes.runAndWait("social-search", {
  platform: "tiktok",
  query: "ai video ad",
  count: 40,
  period: "week",
  sort: "popular",
})
const best = found.json[0]
console.log(best?.url, best?.metrics.views)
```

Every post has the same shape on every platform (`SocialPost`). See
[SDK Reference → client.nodes](./sdk-reference.md#clientnodes).

### Apply a mix to a completed Recast

Revisioned Recast audio is capability-gated. Read the server-authored revision,
quote the exact desired mix, then submit it with a fresh UUID. Reuse that UUID
only if the same HTTP request needs a transport retry:

```ts
const { total: availableCredits } = await client.credits.balance()
const status = await client.recast.get(recastId)
if (status.capabilities?.audioLayers === 1 && status.audio) {
  const operation = {
    expectedAudioRevision: status.audio.revision,
    mix: {
      music: { gain: 55, muted: false },
      video: { gain: 100, muted: false },
    },
  }

  const quote = await client.recast.estimateRescore(recastId, operation)
  if (!quote.noOp && availableCredits >= quote.credits) {
    await client.recast.rescore(recastId, {
      ...operation,
      requestId: crypto.randomUUID(),
    })
  }
}
```

The paid operation is asynchronous; poll `client.recast.get(recastId)` until
`audio.pendingRescore` disappears and `audio.revision` changes. See the
[Recast SDK reference](./sdk-reference.md#clientrecast) for replacements,
manifest semantics, and conflict handling.

### Run a trend with your own picture (Cloud)

A trend is a ready-made Nodaro Motion recipe with slots to fill. Pick one, put your
pictures in its slots, quote the run, then start it and follow the job:

```ts
import type { TrendRunRequest } from "@nodaro/sdk"

const { data: cards } = await client.trends.list({ q: "dance" })
const trend = await client.trends.get(cards[0].slug)

const request: TrendRunRequest = {
  // Every required slot needs 1–3 pictures; optional slots left out take the example's (or stay as in the original where it has none).
  slots: Object.fromEntries(
    trend.slots.filter((s) => s.required).map((s) => [s.key, { images: [myPhotoUrl] }]),
  ),
}
const quote = await client.trends.estimate(trend.slug, request)
console.log(`about ${quote.expectedCredits} credits, ${quote.holdCredits} held while it runs`)

const { jobId } = await client.trends.run(trend.slug, request, { idempotencyKey: crypto.randomUUID() })
const job = await client.jobs.get(jobId)
```

Your past runs, with their pictures and results, come back from
`client.trends.runs({ trend: trend.slug })`, and one of them from
`client.trends.getRun(jobId)`; a draft's newest Full Quality try is a run of
its own there (`fullQualityOf` names the draft). `client.trends.tags()` lists
the catalog's tags with their labels in your language, to filter `list({ tag })`
by. See [SDK Reference → client.trends](./sdk-reference.md#clienttrends).

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
console.log(`Cost: ${nanoBanana.creditCost}`) // the credits a run is charged:
// a "min-max" range for a node priced per model. Cloud only — community and
// business installs have no credit system and omit creditCost entirely
```

## 5. Type safety

`@nodaro/sdk` re-exports types for every response shape and input. Common
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
} from "@nodaro/sdk"

const { data }: { data: Workflow } = await client.workflows.get(id)
//        ^? Workflow with full nodes/edges/settings
```

The client uses generic `request<T>()` internally and casts the JSON response
to the resource type, so TypeScript autocomplete works on every field of
`data`. Snake_case vs camelCase follows the wire format — `Job` is snake_case
(`created_at`, `output_data`) because that's what the server returns;
`Workflow` and `WorkflowExecution` are camelCase.

## 6. Browser vs Node

`@nodaro/sdk` needs **Node 20 or newer** (`engines.node: ">=20"`), or any
runtime with a global `fetch` and `URL`:

- Node 20+
- All modern browsers
- React Native (built-in fetch polyfill)
- Cloudflare Workers, Deno, Bun

It depends on two Nodaro packages, installed with it: `@nodaro/shared` (the
wire types and model catalog) and `@nodaro/prompts` (prompt helpers).
`@supabase/supabase-js` and `@supabase/ssr` are optional peer dependencies —
install them only if you use `supabaseAuth` in a browser app.

**CORS for browser apps:** when calling Nodaro from a browser using an OAuth
access token, your origin must be on the developer app's `allowedOrigins`
allowlist. See [OAuth Flow](./oauth-flow.md) for the consent + allowlist
mechanics. Browser apps using `supabaseAuth` are unaffected — those JWTs are
checked against Supabase, not the developer-app allowlist.

## 7. Custom fetch and timeout

Two optional `createClient` options cover most edge cases:

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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

`timeoutMs` aborts the request via `AbortController` after the given milliseconds.
Long-running operations like video generation should use `workflows.run()` plus
polling rather than waiting for a single HTTP response — most generation
workflows take longer than any reasonable HTTP timeout.

## Next steps

- [SDK Reference](./sdk-reference.md) — every public export with signature + example
- [OAuth Flow](./oauth-flow.md) — third-party app consent + token exchange
- [API Integration](./api-integration.md) — direct REST patterns without the SDK
- [Architecture](./architecture.md) — how Nodaro executes workflows server-side

## Claude Code plugin

Developing with Claude Code? One install adds the Nodaro SDK skill (client
patterns, models, credits, OAuth) **and** the hosted MCP connection:

```
/plugin marketplace add nodaroai/app.nodaro.ai
/plugin install nodaro
```

## Draft a document with the LLM, as a job

```ts
const { jobId } = await client.llm.structuredJob({
  system: "You write production plans.",
  input: "A rainy chase through Rome.",
  jsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  origin: "my-app",
})
// later — even from another session
const { data } = await client.jobs.getStatus(jobId)
if (data.status === "completed") console.log((data.output_data as { output: { title: string } }).output.title)
const { data: runs } = await client.jobs.list({ type: "llm-structured", origin: "my-app" })
```

## 3D scenes

The named helpers `client.scene3d.generateAndWait`, `editAndWait`, and
`renderAndWait` follow the same flow. `client.scene3d.capabilities()` reports
which optional authoring engines are available on the connected instance.

See [editable 3D scenes](sdk-reference.md#editable-3d-scenes) for prompt → editable scene → MP4 using `nodes.runAndWait`.


### Review a planned Studio frame

After creating a production from a validated plan, read its frame IDs and current
revisions. Generate a candidate only when the user requests it:

```ts
const { data: capabilities } = await client.studio.capabilities()
const { data: { production } } = await client.studio.get(productionId, { detail: "full" })
const frame = production.keyframes?.[0]
if (frame && capabilities.operations.generateKeyframes) {
  const { data: generation } = await client.studio.generateKeyframe(productionId, {
    keyframeId: frame.id,
    expectedRevision: frame.revision,
    clientRequestId: crypto.randomUUID(), // retain this value when retrying the same request
  })
  // Observe generation.jobIds using client.jobs; reconcile completed results.
}
```

After the jobs finish, call `client.studio.reconcile(productionId)` and display
the candidates for review. `acceptKeyframe` is a separate explicit action with
the reviewed frame revision, previous accepted key and requirement checks.
Generation alone does not accept a candidate or generate a character portrait.

To duplicate your saved linked production, use the server copy operation after
checking its capability:

```ts
if (capabilities.operations.cloneLinkedProductions) {
  const { data: { production: copy } } = await client.studio.clone(production.id, {
    name: `${production.name} copy`,
    expectedVersion: production.version,
  })
  // Open copy.id and review its frames before accepting them.
}
```

The copy starts private, retains its frame inputs using destination storage
quota, and carries no active jobs or frame acceptance. A stale source revision
returns a conflict. Shared media views cannot be copied as editable linked plans.
