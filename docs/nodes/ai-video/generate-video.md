# Generate Video

> Unified AI video producer. Drives by connection — text-only mode, image-to-video mode, first+last frame mode, or reference mode, all from one node. Subsumes the legacy Image to Video and Text to Video nodes (auto-migrated on workflow load).

## Overview

The Generate Video node is a single, mode-aware video generation node that replaces the legacy `image-to-video` and `text-to-video` nodes. The same node handles:

- **Text-to-video** — no image input, prompt only
- **Image-to-video** — wire a start frame
- **First + last frame** — wire both start and end frames (VEO 3.x, Kling Turbo, Hailuo Standard, Bytedance Lite, MiniMax)
- **Reference mode** — wire image / video / audio references (Seedance 2, HappyHorse Ref2V, VEO 3.1)

Mode is chosen automatically at execution time from the wiring shape — there is no UI toggle. The same provider catalog is available across all modes; if a provider can't run the requested mode, the route returns a validation error.

## Input handles

| Handle | Direction | Accepts | Required | Notes |
|---|---|---|---|---|
| `prompt` | target | Text producers + visual pickers | At least one of `prompt` / `startFrame` / references | Main prompt input |
| `negative` | target | Text producers | no | Negative prompt (provider-dependent) |
| `startFrame` | target | Image producers | no | First frame (image-to-video mode) |
| `endFrame` | target | Image producers | no | Last frame, paired with `startFrame` |
| `imageReferences` | target | Image producers (ordered, multi) | no | Reference images (Seedance 2 etc.) |
| `videoReferences` | target | Video producers (ordered, multi) | no | Reference videos (Seedance 2) |
| `audio` | target | Audio producers | no | Post-merge audio track |
| `audioReferences` | target | Audio producers (ordered, multi) | no | Conditioning audio (Seedance 2) |
| `assets` | target | Character / Face / Location / Object | no | Identity references |
| `look` | target | Setting / Lens / Lighting / Mood / Style / Color Look / ... | no | Look-family pickers |
| `elements` | target | Person / Pose / Animal / Action FX / ... | no | Elements-family pickers |
| `video` | source | n/a | n/a | Output video URL |

`imageReferences`, `videoReferences`, and `audioReferences` are order-sensitive — drag-to-reorder writes `referenceImageOrder` (and friends) on the node so the order survives workflow saves and is honored at execution.

## Mode dispatch

The backend orchestrator inspects the wired inputs at job-build time and dispatches one of two `jobName` strings to the existing video worker:

| Wired inputs | Dispatched mode | `generationType` hint (VEO) |
|---|---|---|
| No image / no references | `text-to-video` | `TEXT_2_VIDEO` |
| `startFrame` only | `image-to-video` | (unset — default i2v path) |
| `startFrame` + `endFrame` | `image-to-video` | `FIRST_AND_LAST_FRAMES_2_VIDEO` |
| `imageReferences` / `videoReferences` **with** `startFrame` | `image-to-video` | `REFERENCE_2_VIDEO` |
| `imageReferences` only (no `startFrame`) | `text-to-video` — references are forwarded and used by reference-capable models (Gemini Omni, Seedance 2, VEO 3.1) | `REFERENCE_2_VIDEO` |
| `videoReferences` only (no `startFrame`) | `text-to-video`, except Gemini Omni which routes `image-to-video` (its video-edit mode) | `REFERENCE_2_VIDEO` |

`endFrame` only (no `startFrame`) is swapped server-side — the end frame is promoted to `imageUrl` so providers that take a single image (`veo3`, `minimax`, `kling-turbo`, ...) get a usable input.

> **Image-required models.** Models with no text-to-video mode — `kling-3-omni`, `kling-master`, `hailuo-2.3`, `hailuo-2.3-pro`, `bytedance-pro-fast`, `happyhorse-ref2v`, `grok-imagine-video-1.5` — return a clean `image_required` error when run without a `startFrame` image. Reference images alone do **not** satisfy this; they are conditioning inputs, not the start frame. (Derived from the model catalog: `VIDEO_PROVIDERS_REQUIRING_IMAGE` in `@nodaro/shared`.)

## Providers

**Default:** when a request omits `provider`, the platform uses **`seedance-2-fast`** — and when `duration` is also omitted, it defaults to **4 seconds** (the cheapest tier: `seedance-2-fast:4s:480p`, 16 credits). An explicitly chosen provider keeps its own duration semantics. The same default applies to single-node runs, API/SDK calls, and workflow (DAG) execution.


Generate Video covers the union of the legacy image-to-video and text-to-video catalogs (`VIDEO_GEN_PROVIDERS` in `@nodaro/shared`):

| Family | Models | Modes | Notes |
|---|---|---|---|
| VEO 3.x | `veo3` (Quality), `veo3.1` (Fast), `veo3_lite` (Lite) | T2V, I2V, first+last, reference | 4 / 6 / 8s; 720p / 1080p; generate-audio default on; auto-translate |
| Gemini Omni | `gemini-omni-video` | T2V, I2V, video-edit (V2V) | 4 / 6 / 8 / 10s; 720p / 1080p / 4K (4K not on free tier); no prompt-baked audio (external `audio_ids` only — see section); up to 7 reference images; V2V uses trim window ≤ 10 s |
| Kling | `kling`, `kling-turbo`, `kling-3.0`, `kling-master` | T2V, I2V (`kling-master` is I2V-only) | 5 / 10s (Kling 3.0: continuous 3–15s) |
| Seedance / Seedance 2 | `seedance`, `seedance-2`, `seedance-2-fast`, `seedance-2-mini` | T2V, I2V, reference (S2) | S2: 4–15s; aspect 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / **21:9** / **adaptive** — **`adaptive` is the default** (output matches the wired input; was `16:9`). Resolution by variant (separate KIE models): `seedance-2` (full) **480p / 720p / 1080p / 4K**; `seedance-2-fast` **480p / 720p only** (no 1080p, no 4K); `seedance-2-mini` **480p / 720p only**. Up to 9 image + 3 video + 3 audio refs |
| Hailuo | `hailuo-2.3-pro`, `hailuo-2.3`, `hailuo-standard` | T2V (`hailuo-standard`), I2V | 6 / 10s |
| Bytedance | `bytedance-lite`, `bytedance-pro`, `bytedance-pro-fast` | T2V (lite, pro), I2V | 5 / 10s |
| MiniMax | `minimax` | T2V, I2V | Fixed 5s, end-frame supported |
| Grok Imagine 1 | `grok-i2v` (one picker row; remaps to `grok` for T2V) | T2V + I2V — mode auto-selected by image presence | 6 / 10s; resolution + mode (fun/normal/spicy) |
| Grok Imagine 1.5 | `grok-imagine-video-1.5` | I2V (input image required) | 1–15s; 480p / 720p; per-second pricing; offered in the T2V picker too but returns "requires an input image" without one |
| Wan | `wan-i2v` (Wan 2.6), `wan-2.7-i2v` (Wan 2.7), `wan-turbo` | T2V + I2V — Wan 2.6/2.7 are one picker row each (remap to `wan` / `wan-2.7-t2v` for T2V); `wan-turbo` fixed 5s | 5 / 10 / 15s |
| HappyHorse | `happyhorse-i2v` (one picker row; remaps to `happyhorse` for T2V), `happyhorse-ref2v` | T2V + I2V — mode auto-selected by image presence; Ref2V is reference-only (image required) | 3–15s; 720p / 1080p |
| Runway (KIE) | `runway-kie` | T2V, I2V | Fixed configurations |
| Kling 3 Omni | `kling-3-omni` | I2V (input image required) | 3–15s; 720p / 1080p; end frame + up to 7 reference images; native audio; runs on Replicate |
| LTX 2.3 | `ltx-2.3-pro`, `ltx-2.3-fast` | T2V, I2V, audio→V (Pro only) | Pro: 6 / 8 / 10s; Fast: 6–20s; 1080p / 2k / 4k; aspect 16:9 / 9:16; fps 24 / 25 / 48 / 50; supports `last_frame_image` (end-frame interpolation). Fast does not accept audio. |

Source of truth: `IMAGE_TO_VIDEO_PROVIDERS` + `TEXT_TO_VIDEO_PROVIDERS` in `packages/shared/src/model-constants.ts`. Full per-provider pricing and parameters: `/admin/models` in the admin panel, or the `model_pricing` table.

> **Unified picker collapse.** A few models expose a *different* provider id per mode but are one user-facing model — Grok Imagine 1 (`grok-i2v` / `grok`), Wan 2.6 (`wan-i2v` / `wan`), Wan 2.7 (`wan-2.7-i2v` / `wan-2.7-t2v`), HappyHorse (`happyhorse-i2v` / `happyhorse`). The picker shows a **single row** for each (keyed by the image-to-video id); execution remaps it to the correct mode-specific endpoint based on image presence via `resolveVideoProviderForMode` (driven by `VIDEO_MODE_ALIASES` in `@nodaro/shared`). Picking one row therefore works in both text-to-video and image-to-video. Single-id models (VEO, Kling, Seedance, Grok Imagine 1.5, …) are unaffected.

### End-frame support

Providers that accept a paired last frame: `veo3`, `veo3.1`, `veo3_lite` (`imageUrls: [start, end]`), `minimax` (`end_image_url`), `hailuo-standard` (`end_image_url`), `bytedance-lite` (`end_image_url`), `kling-turbo` (`tail_image_url`), `kling-3.0`, `wan-2.7-i2v`, `ltx-2.3-pro` / `ltx-2.3-fast` (`last_frame_image`). Other providers ignore the `endFrame` handle.

### Multimodal references

Seedance 2 (`seedance-2` / `seedance-2-fast` / `seedance-2-mini`) accepts up to 9 image refs, 3 video refs, and 3 audio refs in a single call. **`seedance-2-fast` requires each reference audio clip to be ≤ 15.2 seconds** (audio-driven r2v mode) — longer clips are rejected before the job is created with an `audio_too_long` error. HappyHorse Ref2V accepts 1–9 image refs. VEO 3.1 (`veo3.1`) supports `REFERENCE_2_VIDEO` mode when image references are wired without a start frame. Gemini Omni (`gemini-omni-video`) accepts up to 7 image refs in both modes — with a start frame (i2v) or without one (reference-conditioned t2v).

**Seedance 2 unified inputs (frames + references together).** Seedance 2 no longer has a Frames-vs-References toggle (`data.seedance2InputMode` was removed) — first/last frames and references can all be connected at once, and the dispatch mode is derived from the wiring:

- **With no references connected** (`startFrame` and/or `endFrame` only), the frames are used in exact **first/last-frame** mode (`first_frame_url` / `last_frame_url`).
- **With any reference connected** (image / video / audio), the frames are passed as **prompt-directed reference images** — they join the reference set and are bound in the prompt as `@image_N` (e.g. `Use @image_3 as the opening (first) frame of the video.`) so the model can refer to them, rather than being pinned as exact endpoints.

The node shows an indicator of the active mode, and warns when a wired input would be dropped. Note `audio` (a post-merge soundtrack) is distinct from `audioReferences` (generation-conditioning audio): `audio` always applies as the final soundtrack, while `audioReferences` conditions generation (and triggers audio-driven lip-sync on Seedance 2).

Reference arrays are forwarded to the backend for **every** provider in both dispatch modes; models that don't support them ignore them. (Earlier editor builds dropped reference images on the text-to-video path for all providers except Kling and Seedance 2.)

#### Referencing wired assets in the prompt (`{image:N}` / `{video:N}` / `{audio:N}` tokens)

On reference-capable providers (Seedance 2 etc.), you can point a phrase in the prompt at a specific wired reference so it actually drives the output, instead of being a loose description. Type a token where you want the binding — the editor offers them via the `@` autocomplete, or you can type them directly:

| Token | Resolves to | Use |
|---|---|---|
| `{image:1:person}` | `the person from @image_1` | Bind a subject to reference image 1 |
| `{image:2:jacket}` | `the jacket from @image_2` | Bind an attribute to reference image 2 |
| `{image:1}` (no label) | `the subject in @image_1` | Bind without a noun |
| `{video:1:clip}` | `the clip from @video_1` | Bind to reference **video** 1 |
| `{audio:1:voice}` | `the voice from @audio_1` | Bind to reference **audio** 1 |

**Worked example** — two reference images wired to `imageReferences`, prompt:

```
circle {image:1:person} wearing {image:2:jacket} for a 360 spin
```

resolves in the final prompt to:

```
circle the person from @image_1 wearing the jacket from @image_2 for a 360 spin
```

**Numbering rules:**
- **Image-refs first, then Assets-handle entities.** `{image:N}` numbers the **image-reference** handle (`imageReferences`) first, in attachment order, then the entities wired to the **`assets`** handle — a Character / Location / Object / Animal connected there is itself an `@image_N` reference (its canonical image), numbered **after** the plain image refs. So with one image ref + a wired Object, the object is `{image:2}`. (Characters & Locations also keep their `@name` mentions; the positional `{image:N}` is an additional way to point at them.) `{video:N}` and `{audio:N}` number their own handles independently (a node can have `{image:1}`, `{video:1}`, and `{audio:1}` at once).
- **Consistent everywhere.** The same `@image_N` numbering is produced on the canvas preview, a single-node Run, a full workflow run, and a direct API / MCP / SDK call (which pass the references as `connectedReferences`) — so a prompt behaves identically however it's executed.
- **Start/end frames are NOT user-numbered.** They are auto-bound at the **tail** of the image set. With two reference images wired, a start frame becomes `@image_3` and the model is told `Use @image_3 as the opening (first) frame of the video.` — you never write a `{image:3}` token for a frame.
- **Out-of-range tokens fall back to the bare label.** `{image:5:ghost}` on a node with only two references resolves to `ghost` (no dangling binding).
- **Providers without reference support** ignore the tokens — they are stripped to their bare labels, so the prompt still reads naturally.

### LTX 2.3 — auto-dispatch by wired inputs

LTX 2.3 exposes five task modes on Replicate; Generate Video picks one automatically based on which input handles are wired, so users never see a task toggle:

| Wired inputs | LTX task | Variants |
|---|---|---|
| No `startFrame`, no `audio` | `text_to_video` | Pro + Fast |
| `startFrame` (optionally `endFrame`) | `image_to_video` (with `last_frame_image` when `endFrame` set) | Pro + Fast |
| `audio` connected (no `startFrame`) | `audio_to_video` | Pro only |

LTX 2.3 Fast has its audio handle visually muted because Fast does not accept audio. Wiring an `endFrame` enables LTX's `last_frame_image` parameter for end-frame interpolation.

### Gemini Omni — modes and capabilities

`gemini-omni-video` supports three generation modes, all selected automatically from wired inputs:

| Mode | Dispatch condition | Notes |
|---|---|---|
| Text-to-video | No image / video input wired | Prompt-only generation; wired reference images (no start frame) condition the output in this mode |
| Image-to-video | `startFrame` wired (up to 7 reference images) | Up to 7 image references accepted |
| Video-edit (V2V) | `video` input wired | Source clip trimmed to ≤ 10 s; see trim fields below |

**Key characteristics:**
- **Audio** — Gemini Omni Video does **not** bake audio from the prompt the way VEO does. Per [KIE's model docs](https://docs.kie.ai/market/gemini-omni-video.md), audio is supplied externally via an `audio_ids` array (clips generated by the separate `gemini-omni-audio` model — narration, dialogue, music, or guidance); the video model documents no native audio output and no lip-sync. The Nodaro integration does **not** currently forward audio for Gemini Omni (`runGeminiOmni` in `backend/src/providers/kie/video.ts` sends no `generate_audio` / `audio_ids`), so generated clips carry no platform-managed soundtrack. Consequently Gemini Omni is excluded from [Character voice](#character-voice) — it is neither `native_speech` nor `audio_driven` in the audio-capability SSOT.
- **Resolutions** — 720p, 1080p, and 4K. **4K is not available on the free tier.**
- **Durations** — 4 / 6 / 8 / 10 seconds for 720p / 1080p; 4 / 6 / 8 / 10 seconds for 4K.
- **Reference images** — up to 7 images can be wired into the `imageReferences` handle.
- **V2V trim window** — when a source video is connected, the fields `videoTrimStart` and `videoTrimEnd` (integer seconds) define the trim window, which must span ≤ 10 seconds. The duration is derived automatically from the wired clip; override manually in the config panel if needed.

#### Gemini Omni credit pricing

Composite credit identifier: `gemini-omni-video:<resolution_prefix>:<duration>` (e.g. `gemini-omni-video:4k:8`). Video-edit uses a flat per-call price regardless of output duration.

| Setting | Credits |
|---|---|
| 720p / 1080p · 4 s | 23 |
| 720p / 1080p · 6 s | 30 |
| 720p / 1080p · 8 s | 38 |
| 720p / 1080p · 10 s | 45 |
| 4K · 4 s | 53 |
| 4K · 6 s | 60 |
| 4K · 8 s | 68 |
| 4K · 10 s | 75 |
| Video-edit · 720p / 1080p (flat) | 60 |
| Video-edit · 4K (flat) | 90 |

> **Note:** 4K is blocked on the free tier. Free-tier requests at 4K resolution are rejected with a `tier_restriction` error — upgrade to Basic or higher to use 4K output.

## Credit pricing

Pricing is computed at credit-reservation time via `buildVideoCreditModelIdentifier(provider, duration, sound, mode, videoSize, resolution, hasVideoRef)` in `@nodaro/shared/credit-identifiers`. The `mode` argument is the dispatched mode (`"image-to-video"` or `"text-to-video"`), so T2V and I2V prices can differ per provider (via `T2V_CREDIT_OVERRIDES`).

The model identifier is then looked up in:
1. `model_pricing` DB table (authoritative — admin panel reads from here)
2. `STATIC_CREDIT_COSTS` in `backend/src/ee/billing/credits.ts` (runtime fallback)

If neither has the identifier, the route returns HTTP 503 `price_not_configured` — no silent fallback to 1 credit.

### Worked examples

| Provider | Duration | Resolution | Mode | Refs | Credits |
|---|---|---|---|---|---|
| `veo3` (Quality) | 8s | 1080p | i2v | — | 63 |
| `veo3.1` (Fast) | 8s | 1080p | i2v | — | 17 |
| `veo3_lite` | 8s | 720p | t2v | — | 8 |
| `kling-turbo` | 5s | — | i2v | — | 11 |
| `kling-3.0` | 10s | — | i2v | sound on | doubles base cost |
| `minimax` | 5s | — | i2v | — | 15 |
| `seedance-2` | 8s | 720p | i2v | no ref | 82 |
| `seedance-2` | 8s | 1080p | i2v | no ref | 204 |
| `seedance-2` | 8s | 1080p | i2v | with ref | 124 |
| `seedance-2` | 8s | 4K | i2v | no ref | 416 |
| `seedance-2` | 8s | 4K | i2v | with ref | 256 |
| `seedance-2-fast` | 8s | 720p | i2v | with ref | 40 |
| `seedance-2-mini` | 8s | 720p | i2v | no ref | 41 |
| `seedance-2-mini` | 8s | 480p | i2v | with ref | 12 |
| `grok-imagine-video-1.5` | 8s | 480p | i2v | image required | 30 |
| `grok-imagine-video-1.5` | 8s | 720p | i2v | image required | 51 |
| `grok-imagine-video-1.5` | 15s | 720p | i2v | image required | 95 |

**Grok Imagine 1.5** uses true per-second pricing via the composite identifier `grok-imagine-video-1.5:<N>s:<resolution>` (N = 1–15, resolution = `480p` / `720p`). Credits = `ceil((rate × seconds + 2) / 4)`, where the per-second rate is 14.5 @ 480p and 25 @ 720p and the `+2` covers the required input image. Examples: 4s/480p = 15, 8s/480p = 30, 8s/720p = 51, 15s/720p = 95.

**Seedance 2** (full `seedance-2`) is per-second priced via the composite identifier `seedance-2:<N>s:<resolution>` (no-ref) or `seedance-2:<N>s:<resolution>-ref` (any reference wired). Credits = `ceil(KIE_per_sec × duration / 4)`, where the per-second KIE rate depends on resolution and whether a reference is present:

| Resolution | Per-sec (no ref) | Per-sec (with ref) |
|---|---:|---:|
| 4K | 208 | 128 |
| 1080p | 102 | 62 |
| 720p | 41 | 25 |
| 480p | 19 | 11.5 |

So at 8s: 1080p = `ceil(102×8/4)` = **204** no-ref / `ceil(62×8/4)` = **124** with-ref; 4K = `ceil(208×8/4)` = **416** no-ref / `ceil(128×8/4)` = **256** with-ref. Wiring any reference (image / video / audio) selects the cheaper `-ref` ladder. 4K is the full `seedance-2` only — `seedance-2-fast` (480p / 720p) and `seedance-2-mini` (480p / 720p) are separate, cheaper KIE models with their own ladders (neither has a 1080p SKU).

**Reference videos bill input + output duration.** KIE bills "with video input" runs as `per_sec × (input_video_duration + output_duration)`, not output alone. When one or more reference videos are wired, the runtime ffprobes their durations at reservation time and reserves `ceil(per_sec_with_ref × (Σ reference_video_seconds + output_seconds) / 4)` up front — credits can only be refunded (never up-charged) at commit, so the full duration is reserved. A probe failure assumes the 15s cap (KIE limits total reference video to ≤ 15s) so a blip never under-charges. Reference **images** and **audio** do not add input duration — only reference **videos** do.

Cross-check the runtime table in `/admin/models` for the live numbers — the worked examples above match the `STATIC_CREDIT_COSTS` snapshot at the time of this writing.

### Loop trim add-on

The optional `loopTrim` post-process (PSNR-based smart-loop-cut) adds:

```
ceil(duration / 5) + ceil(framesToTest / 24)
```

credits on top of the base provider cost, with a minimum of 1 each. If smart-loop-cut fails after generation succeeded, the un-trimmed clip is kept and only the add-on is refunded.

| Configuration | Add-on |
|---|---|
| 8s output, framesToTest=16 | +3 credits |
| 8s output, framesToTest=64 | +5 credits |
| 5s output, framesToTest=16 | +2 credits |
| 60s output, framesToTest=16 | +13 credits |

Quality mode (`lossless` vs `precise`) does not affect pricing.

## Character voice

The single-node path — `client.nodes.run("generate-video", { … })` (also the MCP `generate_video` tool and `POST /v1/generate-video`) — can make the clip **speak in a character's saved voice**. Pass a character-voice spec and the route orchestrates the full audio chain server-side, returning **one** `jobId` whose result is the final voiced clip (poll it like any generate-video job — no intermediate jobs to manage). The fields are additive and optional; omit them for today's behavior.

| Field | Type | Notes |
|---|---|---|
| `characterVoices` | `Array<{ voiceId, voiceType?, ttsProvider?, speaker? }>` (max 8) | The voice(s) to speak. `voiceType` is `premade` / `library` / `custom`; `speaker` is the label joined to dialogue lines. |
| `dialogue` | `Array<{ speaker, line }>` (max 50) | Optional structured dialogue. When omitted, the route extracts attributed dialogue (`Anna: "good morning"`) from `prompt`. |

A request is **voiced** only when a spec is present **and** the model can carry dialogue (`videoModelCanSpeakDialogue` — VEO 3.x or Seedance 2). The chain is chosen by the model's audio capability (`getVideoAudioCapability`):

| Audio mode | Models | Chain |
|---|---|---|
| `audio_driven` | `seedance-2`, `seedance-2-fast`, `seedance-2-mini` | Synthesize the dialogue (each line in its own voice) via ElevenLabs Dialogue v3 → feed as reference audio → the model lip-syncs to it. |
| `native_speech` | `veo3`, `veo3.1`, `veo3_lite` | Bake the line during generation, then revoice the baked audio to the primary character voice (ElevenLabs voice-changer, keeping the music/SFX bed). |

**Speaker mapping.** Each `dialogue[].speaker` is matched (case-insensitive) to a `characterVoices[].speaker` to pick that line's `voiceId`. An unmatched speaker falls back to the default (first) voice, mirroring the pipeline's non-fatal missing-voice behavior. Total dialogue text is capped at 5000 characters (the Dialogue v3 limit); lines over the budget are dropped with a log entry.

### Credit pricing (character voice)

The audio step is reserved as an add-on **on top of** the base video cost — same `computeCredits` mechanism as Loop Trim (no double-markup) — and committed only if the step actually runs:

| Mode | Add-on identifier | Add-on credits |
|---|---|---|
| `audio_driven` (Seedance 2) | `elevenlabs-dialogue` | +4 |
| `native_speech` (VEO 3.x) | `elevenlabs-voice-changer` | +4 |

Example: `veo3.1` 8s / 1080p i2v voiced = 17 (base) + 4 (revoice) = **21 credits**.

### Fallback behavior

- **Provider can't voice dialogue** (`none` / `ambient` models — minimax, kling, hailuo, …): the spec is **ignored**, the clip still generates (never failed), and the response carries a non-fatal warning `{ code: "voice_unsupported_for_provider" }`. No audio add-on is charged. Clients should gate the voice UI on `videoModelCanSpeakDialogue` and confirm with the user before sending.
- **No voice resolves** (dialogue / voices empty or unparseable): the clip generates silently and the reserved audio add-on is refunded automatically (committed at the video provider cost only).
- **A chain step fails** (TTS / revoice / generation): the whole job fails and credits are fully refunded.

> **Phase 1 scope.** Single-speaker clips are fully supported in both modes. A multi-speaker prompt produces a correct multi-voice **audio** track (Dialogue v3 voices each line separately) for a single-subject `audio_driven` clip; true per-face lip-sync across multiple on-screen speakers is not yet supported. The silent / ambient-only chain (separate-stems → voice-change → re-merge → lip-sync) for `none` / `ambient` models is deferred to Phase 2.

## Configuration

Most provider-specific fields are exposed in the node's config panel only when the wired provider supports them. The config panel reads from the node's data and writes back the user's choices. The full per-provider matrix is documented in the legacy [Image to Video](./image-to-video.md) page for I2V parameters and [Text to Video](./text-to-video.md) page for T2V parameters — both pages redirect here but the parameter tables remain valid because Generate Video forwards to the same worker handlers.

Common fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| Provider | Select | `kling` | Drives all other field visibility |
| Duration | Select / Number | Provider-specific | See per-provider durations above |
| Resolution | Select | Provider-specific | 480p / 720p / 1080p depending on provider |
| Aspect Ratio | Select | Provider-specific | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / Auto |
| Generate Audio | Checkbox | Provider-specific | VEO 3.x default on |
| Loop Trim | Group | off | Enable + framesToTest + quality |
| Inject Character Context | Checkbox | off | When an upstream Character has identity-injection on |

## Migration from legacy nodes

Existing workflows with `image-to-video` or `text-to-video` nodes auto-migrate to `generate-video` the moment they're loaded into the editor — node `type` is rewritten in-memory and handle ids are renamed. The migration is idempotent.

| Legacy field / handle | Migrated to |
|---|---|
| `image-to-video` node type | `generate-video` |
| `text-to-video` node type | `generate-video` |
| Handle `references` | Handle `imageReferences` |
| Handle `reference-images` | Handle `imageReferences` |
| Handle `reference-videos` | Handle `videoReferences` |
| Handle `reference-audio` | Handle `audioReferences` |
| Handle `cinematography` / `style` | Handle `look` or `elements` (per source picker family) |
| Handle `in` (text-to-video prompt) | Handle `prompt` |
| `data.connectedRefImageOrder` | `data.referenceImageOrder` |
| `data.kling3Mode` | `data.mode` |
| `data.kling3Sound` | `data.sound` |
| `data.seedance2InputMode` | dropped (handles drive behavior now) |

The DAG execution path is unchanged — the orchestrator dispatches the same `image-to-video` or `text-to-video` `jobName` to the same video worker, and the credit identifier formula is shared. Pricing, watermark behavior, and storage handling are identical to the legacy nodes.

## Best practices

- Wire only the inputs the chosen provider supports — the config panel hides incompatible fields, but stale data persists if you switch providers mid-design.
- For perfect-loop output (start frame = end frame), enable Loop Trim to clean up the tail dissolve VEO 3.x adds.
- Use the `prompt` handle for upstream LLM-generated prompts; the config-panel prompt field is a fallback when nothing is wired.
- For identity-locked output, wire a Character node into `assets` and enable Inject Character Context on the Character node.

## Common use cases

- Animate generated images for social-media reels (Kling Turbo / Minimax — cheap, fast).
- Cinematic establishing shots with sound (VEO 3.1 / VEO 3 Quality).
- Multi-shot reference-driven generation (Seedance 2 with multi-image + audio refs).
- Text-only B-roll generation when no source image is needed (Wan 2.7 T2V / Kling 3.0).
- Pre-stitched first+last keyframe transitions (VEO 3.x + Kling Turbo + Hailuo Standard).

## See also

- [Image to Video (legacy)](./image-to-video.md) — redirects to this page; parameter tables remain valid for I2V mode.
- [Text to Video (legacy)](./text-to-video.md) — redirects to this page; parameter tables remain valid for T2V mode.
- [Video to Video](./video-to-video.md) — for modifying existing videos (separate node).
- [Extend Video](./extend-video.md) — for continuing a generated clip with a new prompt.
