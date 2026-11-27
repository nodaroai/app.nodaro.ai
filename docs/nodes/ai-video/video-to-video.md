# Video to Video

> Edit an existing video by instruction with a text prompt.

## Overview

The Video to Video node edits an existing video from a text instruction: change the weather, the time of day, an object, a colour grade.

What happens to your clip depends on the model. The edit models (**Seedance 2.5 Edit**, the default, Seedance 2.5 Flash Edit, Wan 2.7 VideoEdit, HappyHorse Edit) change the clip itself. **Wan 2.6** and **Wan 2.6 Flash** do not: they take the subject of your clip and make a new clip of the scene your prompt describes — see [Supported Providers](#supported-providers).

**Video Remake is the recommended way to edit, modify, restyle or transfer the motion of a clip.** It keeps the clip's motion, camera and timing and changes what you ask: the cast, a prop, the place, the look (on Nodaro Cloud; elsewhere, where it is offered). Use MCP `video_remake`, the API's `POST /v1/video-remake`, or the SDK's `client.videoRemake.run(…)`. For a restyle (anime, claymation, watercolor, …) give it an art style: `art_style` on MCP, `direction: { "style": "<style id>" }` on the API and the SDK; the style is an id of the `style` picker catalog, on the Nodaro Prism engine. The edit models of this node are for edits by instruction. Over the API, Video Remake's two engines are also named providers of this node's route, which answer its price quote: see [Video Remake's engines as providers](#video-remakes-engines-as-providers-api).

**A node or an API request that names no model runs Seedance 2.5 Edit.** (MCP `modify_video` with no model answers Video Remake's price quote where Video Remake is offered, and runs Seedance 2.5 Edit elsewhere; see [MCP tools](../../mcp/tools.md).) That includes a Video to Video node saved before this was the default and never given a model. Such a run needs a prompt (the edit instruction) and a source clip of 4–30 seconds, renders at 480p unless a resolution is set (an API request that names `seedance-2-5` itself and no resolution keeps that lane's own 720p), keeps the clip's length and aspect ratio, and is priced as described under [Seedance 2.5 Edit — credits](#seedance-25-edit--credits). On an account that has never paid, and on a deployment that does not offer Seedance 2.5, it is refused with that reason; pick another model there.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | seedance-2-5 | AI model for the edit (a node with none set runs this one) |
| Prompt | Textarea | — | Description of the desired transformation |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### Seedance 2.5 Edit — additional fields

These fields apply to **Seedance 2.5 Edit** and **Seedance 2.5 Flash Edit** (`seedance-2-5-flash`, the faster, lower-cost tier), except where a row says otherwise.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Resolution (`v2vResolution`) | Select | 480p | 480p / 720p / 1080p / 4K output (Flash: 480p / 720p; 4K is Seedance 2.5 only — any other model refuses it) |
| Draft (`draft`) | Toggle | off | Seedance 2.5 only (Flash has no draft). Render a 480p **draft** of the edit; finalize the take you like at 1080p with Video Upscale → **Seedance 2.5 HD (from draft)**. Locks Resolution to 480p. See [Draft mode](generate-video.md#seedance-25-draft-mode). |
| Generate Audio (`generateAudio`) | Checkbox | on | Native audio on the generated clip |

Seedance 2.5 deliberately exposes **no** Duration, Aspect Ratio, Audio Setting,
Multi-shot, Expand-prompt or Negative Prompt field on this node — see
*Seedance 2.5 Edit* below for why. It has **no Seed** field either: Seedance 2.5
takes no seed, so repeat runs of the same edit vary. A seed already saved on the
node is cleared once the node is set to Seedance 2.5 in the editor.

### Wan 2.7 VideoEdit — additional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Duration | Select | Auto | Auto / 5s / 10s — target output length |
| Resolution | Select | 1080p | 720p or 1080p output |
| Audio | Select | Auto | Auto = AI-generated audio; Origin = keep source audio |
| Expand prompt | Checkbox | off | AI enhances the prompt before sending to KIE |
| Negative Prompt | Textarea | — | What to avoid in the output |
| Seed | Number | — | Seed for reproducible results |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video to transform
- Cinematography (optional) — parameter pickers whose hints join the prompt
- Text Prompt (optional) — from upstream node
- Negative (optional) — text-only; ignored on the Seedance 2.5 Edit lane
- Image Refs (optional) — **Seedance 2.5 Edit / Flash Edit only**; up to 30 reference images (Flash: 10)
- Audio Refs (optional) — **Seedance 2.5 Edit / Flash Edit only**; up to 10 reference audio clips (Flash: 5, WAV or MP3)

The two reference handles are always visible but dimmed on every other model —
those endpoints take at most one reference image and no reference audio, so the
handle reports "not supported by *[Model]*" and wiring one has no effect.

**Outputs:**
- Transformed video URL

## Seedance 2.5 Edit

Seedance has **no video-to-video endpoint**. It edits a video it is given as a
*reference* when the prompt reads as an edit instruction. So this model's lane
on the node is dispatched as a **text-to-video** job in edit shape:

- The source clip is sent as **reference video 1**, re-encoded first (as every
  Seedance reference video is): the same resolution, frames, frame rate and
  length, sound kept. A clip Seedance produced itself, sent as it came, can
  come back as a near-copy of the input instead of an edit. The result's
  length and the price are unchanged.
- Your prompt is prefixed with `edit @video_1 as follows:` and a newline, so the
  model reads the whole sentence as an instruction about that clip. If your
  prompt already opens with that instruction, it is not added twice.
- Aspect ratio is `adaptive` and duration is `Auto` — the result **keeps the
  source clip's own length and aspect ratio**. That is why the node offers no
  Duration and no Aspect Ratio field for this model.
- The run also tells Seedance outright that the clip is the video to edit (the
  same choice as **The video to edit** on
  [Generate Video](generate-video.md#seedance-25-use-the-reference-video-as)),
  when every clip is 4–30 seconds long, a draft included. A single run, a
  workflow run and an app run do the same.

**From the API or SDK**, send it to `POST /v1/video-to-video` like any other
model of this node — `{ videoUrl, prompt, provider: "seedance-2-5",
resolution?, draft?, audio?, seed?, referenceImageUrl?, referenceImageUrls?,
referenceVideoUrls?, referenceAudioUrls? }`. The server builds the edit body
above itself (`audio` becomes the native sound) and runs it on the same Seedance
reference-video lane, so the price, the clip-length check and the settlement
are the ones described here. `480p`, `draft` and the three reference lists are
accepted for this model only (any other model answers `400`). Price it first
with `POST /v1/quote` (`type: "video-to-video"`). When every clip, the source and
any extra `referenceVideoUrls`, is 4–30 seconds long (a draft included), the server also tells Seedance
outright that the run is an edit, instead of leaving the model to read that from
the prompt.

How the references are numbered, for `{video:N}` / `{image:N}` / `{audio:N}` in
the prompt:

| Field | Tokens |
|---|---|
| `videoUrl` (the clip being edited) | `{video:1}` |
| `referenceVideoUrls` (extra clips — do not repeat `videoUrl`) | `{video:2}`, `{video:3}`, … |
| `referenceImageUrl`, then `referenceImageUrls` | `{image:1}`, `{image:2}`, … (the list starts at `{image:1}` when `referenceImageUrl` is not sent) |
| `referenceAudioUrls` | `{audio:1}`, `{audio:2}`, … |

The caps are the model's own: 10 clips in all, the source included, 30 images
and 10 audio clips on Seedance 2.5; a body over a cap, or a reference audio
clip the model would refuse (too long), is answered `400` before anything is
reserved, and `POST /v1/quote` answers it the same way. A token past the end of its list is dropped
(its label is kept when it has one). Every clip — the source and the extras — is
measured and billed as input seconds (see the credits below).

**The source clip must be 4–30 seconds.** Shorter or longer clips are rejected
by the provider.

**Reference images and `{image:N}`.** Wire images into **Image Refs** and cite
them positionally in the prompt — `{image:1}`, `{image:2}`, … in the order the
edges were made. The editor resolves them to `@image_1`, `@image_2` on the wire,
the same binding Generate Video uses (see
[Generate Video → Referencing wired assets in the prompt](generate-video.md#referencing-wired-assets-in-the-prompt-imagen--videon--audion-tokens)).
Reference audio works the same way with `{audio:N}`.

```
make it black and white, heavy film grain
the woman wears {image:1} and stands in {image:2}
```

**Negative prompts are not sent on this lane** — the edit dispatch carries no
negative field, and Seedance has no native `negative_prompt`. Put what you want
avoided into the instruction itself.

## Video Remake's engines as providers (API)

`POST /v1/video-to-video` (SDK: `client.nodes.run("video-to-video", …)`) also takes Video Remake's two engines as named providers: `"nodaro-prism"` (Nodaro Prism) and `"nodaro-pulse"` (Nodaro Pulse). They are additions: a request that names no provider still runs Seedance 2.5 Edit, and every other provider runs as before. Where Nodaro offers them, Video Remake's Flash choices are named providers too: `"nodaro-prism-flash"` (Nodaro Prism Flash) and `"nodaro-pulse-flash"` (Nodaro Pulse Flash), each its engine's run on the faster, lower-cost model, answered the same way (the quote and the request that runs it, naming the choice). Where a Flash choice is not offered the request is refused `409 flash_not_offered`. A workflow node runs none of these providers (see [Video Remake](../../api-integration.md#13f-video-remake-cloud-edition)).

**For these two providers the route starts nothing.** It answers `200` with Video Remake's price quote for the clip and the prompt, and the request to send to `POST /v1/video-remake` to run it. No job is created and no credits are held; there is no `jobId` in the answer, and `quoteOnly` is `true`:

```json
{
  "quoteOnly": true,
  "message": "Nodaro Prism is a Video Remake engine: this is its price quote, and nothing was started. To run it, send videoRemake.run.body to POST /v1/video-remake.",
  "videoRemake": {
    "quote": {
      "engine": "nodaro-prism",
      "engineName": "Nodaro Prism",
      "totalCredits": 0,
      "expectedCredits": 0,
      "breakdown": { "base": 0, "references": 0, "motion": 0, "motionExpected": 0 },
      "settlesLower": true
    },
    "run": {
      "method": "POST",
      "path": "/v1/video-remake",
      "body": { "videoUrl": "https://…/clip.mp4", "roles": [], "postPrompt": "make it night", "engine": "nodaro-prism" }
    }
  }
}
```

(The zeros stand for the figures of your own clip.) `videoRemake.quote` is what [`POST /v1/video-remake/estimate`](../../api-integration.md#13f-video-remake-cloud-edition) answers for `videoRemake.run.body`, with the engine's name: `totalCredits` is held when the run starts, `expectedCredits` is what it is expected to be charged, and `privacyCredits`, when present, is charged only if a refused clip is retried (a run needs the balance for both). Its `breakdown` may name more parts than the example. The quote also carries `resolution`, the size the run delivers, where the engine answers it. Send `videoRemake.run.body` to `POST /v1/video-remake` as it is to run it (SDK: `client.videoRemake.run(result.videoRemake.run.body)`); add roles, references or an art style there for more than an instruction.

What the request may carry:

- `videoUrl` (the clip, 4–30 s) and `prompt` (what to change; required). The prompt becomes the run's `postPrompt`; the run has no roles.
- `resolution` and `draft`, which are Video Remake's own: `resolution` is the size delivered, on Nodaro Prism and Nodaro Pulse 720p (the default), 1080p or 4k, on their Flash choices 720p (the default) or 1080p (the sizes each offers on the deployment, and the refusals of another, are in [Video Remake](../../api-integration.md#13f-video-remake-cloud-edition)); Nodaro Prism takes `draft` (a 480p draft), Nodaro Pulse takes none.
- Every other field of this route (`duration`, `aspectRatio`, `seed`, `audio`, `multiShots`, `negativePrompt`, `videoEditDuration`, `audioSetting`, `promptExtend`) does not apply to Video Remake and is ignored.
- A reference list (`referenceImageUrl`, `referenceImageUrls`, `referenceVideoUrls`, `referenceAudioUrls`) is refused with `400 validation_error`: Video Remake takes pictures as roles and fixed references, on its own route.

Refusals, each before anything is asked of the engine: `404 not_available` where Video Remake is not served (a self-hosted install); `403 node_not_available` where the deployment does not offer you Video to Video or Video Remake; `403 model_not_available` where it withholds the engine; `503 engine_unavailable` where the engine is not released on the deployment yet. Video Remake's own refusals (a clip outside 4–30 s, an unreadable clip, `draft` on Nodaro Pulse, …) are answered as its estimate route gives them. Nothing falls back to another model.

`POST /v1/quote` with `type: "video-to-video"` and one of these providers answers the same quote in the node quote's shape: `reserve` is `totalCredits`, `expected` is `expectedCredits` when it differs, and `warnings` carries `quote_only_provider` (the run route only quotes this provider).

Only these two ids are taken. They are choices of the API route alone: the Video to Video node in the editor does not list them, and a node that names one is refused (`provider_not_supported`), in a workflow or app run and on the node's own run (a request that carries a `nodeId` or `workflowId`). In a workflow, use the node's own models.

## Supported Providers

| Provider | Credits | Notes |
|----------|---------|-------|
| **Seedance 2.5 Edit** (`seedance-2-5`) | dynamic — see below | Whole-clip prompt-driven edit; keeps source length + ratio; 30 image / 10 audio references; native audio |
| **Seedance 2.5 Flash Edit** (`seedance-2-5-flash`) | dynamic — see below | The same edit, faster and lower-cost: 480p / 720p, 10 image / 5 audio references (WAV or MP3), no draft; native audio |
| **Wan 2.6** (`wan`) | 193 cr<!-- credits: wan --> | Makes a **new** clip featuring the subject of your video, in the scene your prompt describes — it does not edit or restyle the clip; 5 s or 10 s |
| **Wan 2.6 Flash** (`wan-flash`) | 110 cr<!-- credits: wan-flash --> | The same as Wan 2.6, faster: a new clip featuring your video's subject, with optional audio & multi-shot — not an edit of the clip |
| **Wan 2.7 VideoEdit** (`wan-videoedit`) | by the clip's length, at least 352 cr<!-- credits: wan-videoedit --> — see below | Guided editing with reference image, audio control, prompt extend; clip 2–10 s |
| **Luma Modify** (`luma-modify`) | 352 cr<!-- credits: luma-modify --> | Strong at style transfer and artistic modifications |
| **Runway Aleph** (`runway-aleph`) | 385 cr<!-- credits: runway-aleph --> | High-quality transformations, flexible aspect ratio |
| **HappyHorse Edit** (`happyhorse-edit`) | by the clip's length — see below | Clip 3–60 s, 720p (default) or 1080p output |

On Seedance 2.5 Flash the clip you edit, and every reference video, is fitted to what the model takes before it is sent: its size is scaled, shape kept, to a 480p- or 720p-class picture (a picture at exactly 2.5:1 or 1:2.5 may lose up to 2 pixels of its long side to stay inside them) (a 1080p or 4K clip down, a small one up), and its frame rate is set to stay between 24 and 60 frames a second — a constant rate outside that range moved to 24 or 60, and a clip with a variable rate (as phones record) made constant at its nominal rate, held in that range — over the same seconds, so its length and price do not change. A clip wider than 2.5:1 or taller than 1:2.5 is refused before any credits are held (`video_aspect_unsupported`): crop it to a less extreme shape.

### HappyHorse Edit and Wan 2.7 VideoEdit — credits

These two models are priced by the length of the clip you edit. When the run
starts, the server reads the clip's length from the file **before any credits
are held**, on every path (the editor, a workflow or app run, the API, the SDK,
MCP and `POST /v1/quote`). A length a request names is never used. The price
shown before a run is the price the run holds and charges: nothing is settled
afterwards.

**HappyHorse Edit** is charged for every started half-second of the clip, at
the size it renders:

| Size | Per clip second | 3 s clip | 10 s clip | 60 s clip |
|------|-----------------|----------|-----------|-----------|
| 720p (default) | 154<!-- credits-rate: happyhorse-edit:720p:per-4s@0.25 --> | 462 credits<!-- credits: happyhorse-edit:720p:per-4s@0.75 --> | 1540 credits<!-- credits: happyhorse-edit:720p:per-4s@2.5 --> | 9240 credits<!-- credits: happyhorse-edit:720p:per-4s@15 --> |
| 1080p | 264<!-- credits-rate: happyhorse-edit:1080p:per-4s@0.25 --> | 792 credits<!-- credits: happyhorse-edit:1080p:per-4s@0.75 --> | 2640 credits<!-- credits: happyhorse-edit:1080p:per-4s@2.5 --> | 15840 credits<!-- credits: happyhorse-edit:1080p:per-4s@15 --> |

Each size's price row is the price of four clip seconds; a run is that row ×
the started half-seconds ÷ 8, rounded up once. The size is 720p unless the
request (or the node's **Resolution**) says 1080p, and the size priced is the
size sent.

Worked examples: a 3.00-second clip at 720p is 6 half-seconds, 462 credits<!-- credits: happyhorse-edit:720p:per-4s@0.75 -->; a 10.04-second clip at 720p is 21 half-seconds, 1617 credits<!-- credits: happyhorse-edit:720p:per-4s@2.625 -->; a 3.00-second clip at 1080p is 792 credits<!-- credits: happyhorse-edit:1080p:per-4s@0.75 -->.

**Wan 2.7 VideoEdit** is charged per second of the clip it delivers — the
clip's length, or the **Duration** you ask for (5 or 10 s) when that is shorter
— rounded up to a whole second after forgiving 0.05 s, but never less than
its flat price: a run is charged the larger of the two.

- Flat price (the least a run costs): 352 credits<!-- credits: wan-videoedit -->.
- Per second delivered (at 720p and 1080p alike): 66<!-- credits-rate: wan-videoedit:1080p:per-4s@0.25 -->.

| Seconds delivered | Wan 2.7 VideoEdit |
|-------------------|-------------------|
| 2–5 s | 352 credits<!-- credits: wan-videoedit --> |
| 6 s | 396 credits<!-- credits: wan-videoedit:1080p:per-4s@1.5 --> |
| 10 s | 660 credits<!-- credits: wan-videoedit:1080p:per-4s@2.5 --> |

Worked examples: a 3-second clip costs 352 credits<!-- credits: wan-videoedit -->; a 6-second clip costs 396 credits<!-- credits: wan-videoedit:1080p:per-4s@1.5 -->; a 10-second clip costs 660 credits<!-- credits: wan-videoedit:1080p:per-4s@2.5 -->; a 10-second clip with Duration 5 is charged 5 seconds, 352 credits<!-- credits: wan-videoedit -->.

**Limits and refusals.** A clip outside the model's limits is refused with a
`400` before anything is held, and the message names the limit:

- HappyHorse Edit: shorter than 3 seconds (`video_too_short`) or longer than 60
  seconds (`video_too_long` — trim the video first).
- Wan 2.7 VideoEdit: shorter than 2 seconds (`video_too_short`) or longer than
  10 seconds (`video_too_long`; a clip up to 0.05 s past 10 s is accepted and
  charged as 10 s).
- A clip that cannot be read is refused (`video_unreadable`), never priced on a
  guess; a link whose host cannot be reached right now is a retryable `503`.

**The price you see before you run** reads the clip's length from the
workflow — an upload at its recorded length, a clip another node makes in this
run at the length it will produce plus a small allowance. When the length is
not known, the price shown is the most the run can cost (a 60-second clip on
HappyHorse Edit, a 10-second one on Wan 2.7 VideoEdit), marked as an estimate
(≈).

### Seedance 2.5 Edit — credits

Seedance 2.5 Flash Edit is billed the same way on its own `-ref` ladder (480p and
720p). For example, a 5 s clip edited at 480p into a 5 s clip is billed 10 s at
Flash's 480p `-ref` rate: **317**<!-- credits: seedance-2-5-flash:8s:480p-ref@1.25 --> credits.

Because the lane *is* a Seedance reference-video run, it is billed exactly like
one on Generate Video: the price of `clip_seconds + delivered_seconds` seconds
on the `-ref` ladder for the chosen resolution, as one charge rounded up.
At 4K (Seedance 2.5 only), a 5 s clip edited into a 5 s clip is billed 10 s
at the 4K `-ref` rate: **4263**<!-- credits: seedance-2-5:8s:4k-ref@1.25 --> credits. The 4K file is
H.265 (HEVC) 10-bit, kept as the model made it, with a browser-ready copy for
previews.

Duration is `Auto`, so an edit renders the source clip's own length. Once the
clips are measured, the run is **reserved for the longest clip's length rounded
up to a whole second, plus one second** (never more than the model's longest
clip, 30 s), and **refunded down to the length actually delivered**. With the
source clip alone, that is the source clip. Extra reference clips add their
seconds to the input side, and when one is longer than the source the output is
reserved for it, since the model may edit it instead; the edit usually renders
the source clip's length and is refunded down to it. A clip that cannot be
measured is reserved at the worst case instead: the model's longest clip out,
and the per-clip cap in. Your balance must cover the reservation for the run to
start.

The node's price and its Run button show **exactly that reservation**: the
editor asks the server to measure the source clip and price it the way the run
does (`POST /v1/credits/seedance-ref-estimate`, see the
[API reference](../../api-integration.md#seedance-reference-video-estimates)).
While the source clip has not been produced yet, the node shows a range — from
the shortest clip Seedance 2.5 accepts up to the longest — and the Run button
the top of that range; no figure is shown while the clip is being measured.

With **Draft** on, the edit is billed exactly as the 480p edit it is. Finalizing
it at 1080p bills the reference-video rate on the source clip plus the delivered
seconds — a 4 s clip edited into a 4 s draft finalizes for **2090**<!-- credits: seedance-2-5-hd:4s-ref@2 --> credits (see
[Seedance 2.5 HD (from draft)](../processing-video/video-upscale.md#seedance-25-hd-from-draft)).

The formulas, the worked examples and what happens when a clip cannot be
measured are all one place — see Generate Video →
[Auto duration](generate-video.md#credit-pricing) and
[Reference videos bill input + output duration](generate-video.md#credit-pricing).

## Best Practices

- Keep source video short (5-10s) for best results
- On a model that edits the clip, describe the change clearly: "turn the day into a rainy night" rather than describing the entire scene. On Wan 2.6 and Wan 2.6 Flash, describe the scene the new clip should show
- For Seedance 2.5 Edit: write the prompt as an instruction about the clip ("make it black and white", "the woman wears {image:1}") — it is read as one. Start at 480p while iterating; the reservation scales with resolution
- For Wan 2.7 VideoEdit: connect a reference image to guide the visual style of the output
- Use **Expand prompt** when your prompt is very brief — the AI fills in cinematic details
- **Wan 2.6** and **Wan 2.6 Flash** do not edit your clip: they take its subject and make a new 5 s or 10 s clip of the scene your prompt describes. To edit the clip itself, pick **Seedance 2.5 Edit** (the default), **Wan 2.7 VideoEdit** or **HappyHorse Edit**. A restyle is best done with Video Remake and an art style

## Common Use Cases

- Change scene characteristics (day to night, summer to winter)
- Change, add or remove something in the clip by instruction
- Dress a person in a reference image, or place the scene in one (Seedance 2.5 Edit)

## Tips

- A new art style on the same motion (anime, claymation, a 3D look) is best done with Video Remake and an art style; this node's **Looks** presets are edits by instruction
- For structural changes, consider using Image-to-Image on keyframes then Image-to-Video instead
- Use consistent prompts when processing multiple clips for a project
