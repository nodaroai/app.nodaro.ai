---
name: nodaro-sdk
description: Use when writing code against @nodaro/sdk, the Nodaro REST API, or building apps on the Nodaro AI video platform — client setup, async generation patterns, model/credit discovery, progress UX, and error handling. Trigger on any mention of Nodaro, @nodaro/sdk, @nodaro/cli, or app.nodaro.ai integration.
---

# Building on Nodaro with @nodaro/sdk

Nodaro is an API-first AI video platform (image / video / voice / music
generation, entity studios, workflows-as-APIs). `@nodaro/sdk` (npm,
Apache-2.0) is the typed client.

<!-- Core kept in sync with docs/sdk-agent-primer.txt + the @nodaro/sdk README. -->

## Setup

```bash
npm install @nodaro/sdk
```

Auth: the user creates a token at https://app.nodaro.ai/settings/api and sets
`NODARO_ACCESS_TOKEN`. Never hardcode tokens.

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"
const client = createClient({
  baseUrl: "https://app.nodaro.ai",
  auth: new StaticTokenAuth(process.env.NODARO_ACCESS_TOKEN!),
})
```

## Core pattern — async generation

All generation is async. `runAndWait` submits, polls, and resolves the output:

```ts
const img = await client.nodes.runAndWait("generate-image", {
  prompt: "…", provider: "nano-banana-2",          // fast + cheap, great default
})
const vid = await client.nodes.runAndWait("generate-video", {
  prompt: "…", imageUrl: img.imageUrl,             // start frame → image-to-video
  provider: "seedance-2-fast", duration: 4,        // platform default; 4/8/12/15s
})
// outputs: .imageUrl / .videoUrl / .audioUrl on the resolved object
```

## Model choice

Omitting `provider` uses the platform default for that node — fine for a v1.
To offer a model picker: `client.nodes.get(type)` → `data.providers`, priced
via `client.credits.modelCosts(providers)`. Full static lists (with credit
costs, as raw markdown an agent can fetch):

- image: https://nodaroai.github.io/app.nodaro.ai/nodes/ai-image/generate-image.md
- video: https://nodaroai.github.io/app.nodaro.ai/nodes/ai-video/generate-video.md

## UX rules (generation takes seconds-to-minutes — never block silently)

- Show intermediate results immediately (render the image while the video
  step still runs).
- Live progress: `runAndWait(type, params, { onProgress: s => setBar(s.progress ?? 0) })`
  (0–100 when reported). Manual loops: `client.jobs.getStatus(jobId)`.
- Cancellation: pass `{ signal }` (AbortSignal) in the same options.

## Rules

- Generations cost credits — catch `InsufficientCreditsError` (`.required` /
  `.available`). All errors are typed classes; see
  [references/errors.md](references/errors.md).
- Prefer `runAndWait` over hand-rolled polling.
- 22 resources on the client — see [references/resources.md](references/resources.md).
- Building a third-party app acting on behalf of other Nodaro users? OAuth —
  see [references/oauth.md](references/oauth.md).
- Full reference: https://nodaroai.github.io/app.nodaro.ai/sdk-reference.md
