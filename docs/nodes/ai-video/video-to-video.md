# Video to Video

> Transform existing video using AI with a text prompt.

## Overview

The Video to Video node applies AI-powered transformations to an existing video based on a text prompt. Use it for style transfer, content modification, or creative re-interpretation of video footage.

What happens to your clip depends on the model. The edit models (Seedance 2.5 Edit, Wan 2.7 VideoEdit, HappyHorse Edit) change the clip itself. **Wan 2.6** and **Wan 2.6 Flash**, the default, do not: they take the subject of your clip and make a new clip of the scene your prompt describes — see [Supported Providers](#supported-providers).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | wan | AI model for transformation |
| Prompt | Textarea | — | Description of the desired transformation |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### Seedance 2.5 Edit — additional fields

These fields apply to **Seedance 2.5 Edit** and **Seedance 2.5 Flash Edit** (`seedance-2-5-flash`, the faster, lower-cost tier), except where a row says otherwise.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Resolution (`v2vResolution`) | Select | 480p | 480p / 720p / 1080p output (Flash: 480p / 720p) |
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
- On a model that edits the clip, describe the transformation clearly: "change to anime style" rather than describing the entire scene. On Wan 2.6 and Wan 2.6 Flash, describe the scene the new clip should show
- For Seedance 2.5 Edit: write the prompt as an instruction about the clip ("make it black and white", "the woman wears {image:1}") — it is read as one. Start at 480p while iterating; the reservation scales with resolution
- For Wan 2.7 VideoEdit: connect a reference image to guide the visual style of the output
- Use **Expand prompt** when your prompt is very brief — the AI fills in cinematic details
- **Wan 2.6** and **Wan 2.6 Flash** do not edit your clip: they take its subject and make a new 5 s or 10 s clip of the scene your prompt describes. To restyle or edit the clip itself, pick **Seedance 2.5 Edit**, **Wan 2.7 VideoEdit** or **HappyHorse Edit**

## Common Use Cases

- Apply artistic styles to recorded footage (painterly, anime, cinematic)
- Change scene characteristics (day to night, summer to winter)
- Create variations of existing video content
- Transform live-action footage into animated styles

## Tips

- V2V works best when the transformation is stylistic rather than structural — changing colors and textures works better than adding or removing objects
- For structural changes, consider using Image-to-Image on keyframes then Image-to-Video instead
- Use consistent prompts when processing multiple clips for a project
