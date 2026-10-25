# Generate Video

> Unified AI video producer. Drives by connection — text-only mode, image-to-video mode, first+last frame mode, or reference mode, all from one node. Subsumes the legacy Image to Video and Text to Video nodes (auto-migrated on workflow load).

## Overview

The Generate Video node is a single, mode-aware video generation node that replaces the legacy `image-to-video` and `text-to-video` nodes. The same node handles:

- **Text-to-video** — no image input, prompt only
- **Image-to-video** — wire a start frame
- **First + last frame** — wire both start and end frames (VEO 3.x, Kling Turbo, Hailuo Standard, Bytedance Lite, MiniMax); Kling 4.0 Keyframes adds up to 8 in-between frames
- **Reference mode** — wire image / video / audio references (Seedance 2, HappyHorse Ref2V, VEO 3.1 **Fast / Lite**, Kling 4.0)

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
| `settings` | target | Aspect Ratio / Duration / Provider / Motion | no | Sets the node's aspect ratio, duration and model from a wired node, and adds a Motion clause to the prompt (see below) |
| `video` | source | n/a | n/a | Output video URL |

`imageReferences`, `videoReferences`, and `audioReferences` are order-sensitive — drag-to-reorder writes `referenceImageOrder` (and friends) on the node so the order survives workflow saves and is honored at execution.

### Settings input

One `settings` input takes the Generation Settings nodes — [Aspect Ratio](../parameters/aspect-ratio.md), [Duration](../parameters/duration.md), [Provider](../parameters/provider.md) and [Motion](../parameters/motion.md). The first three replace the node's own field at run time; Motion adds a clause to the prompt. The node lists what is wired as chips (e.g. `16:9 · 8s · Seedance 2`), and the settings panel shows those fields as connected.

- **Aspect Ratio** replaces `aspectRatio`. A ratio the model doesn't render runs as the nearest one it does (`4:5` on Seedance 2 runs as `3:4`).
- **Duration** replaces `duration`, fitted to the nearest length the model renders; a tie goes to the shorter length. A 60-second Duration node runs as 15 s on Seedance 2 and 8 s on VEO 3.1 (4 / 6 / 8 s).
- **Provider** replaces `provider`. It must name a video model this node runs; a Provider set to an image model stops the run before anything is charged, and the error names the Provider node.
- **Motion** adds how much the shot moves ("subtle, gentle motion…" / "moderate, natural motion…" / "dynamic, energetic motion…") beside the Look hints, under the same Inject Look switch.
- When two nodes of one kind are wired, the last connection wins.

The price is the price of the wired values: the Run button, the workflow total and the reservation all use the fitted duration and the wired model. A note under the Run button says so while a setting is wired.

## Mode dispatch

The backend orchestrator inspects the wired inputs at job-build time and dispatches one of two `jobName` strings to the existing video worker:

| Wired inputs | Dispatched mode | `generationType` hint (VEO) |
|---|---|---|
| No image / no references | `text-to-video` | `TEXT_2_VIDEO` |
| `startFrame` only | `image-to-video` | (unset — default i2v path) |
| `startFrame` + `endFrame` | `image-to-video` | `FIRST_AND_LAST_FRAMES_2_VIDEO` |
| `imageReferences` / `videoReferences` **with** `startFrame` | `image-to-video` | `REFERENCE_2_VIDEO` |
| `imageReferences` only (no `startFrame`) | `text-to-video` — references are forwarded and used by reference-capable models (Gemini Omni, Seedance 2, VEO 3.1 Fast / Lite). **Exception:** a split-id model whose text-to-video twin cannot carry references routes `image-to-video` with the references as its images — Grok Imagine 1 (`grok-i2v`; its `grok` text endpoint has no image parameter), derived from the model catalog's reference caps | `REFERENCE_2_VIDEO` |
| `videoReferences` only (no `startFrame`) | `text-to-video`, except Gemini Omni which routes `image-to-video` (its video-edit mode) | `REFERENCE_2_VIDEO` |

`endFrame` only (no `startFrame`) is swapped server-side — the end frame is promoted to `imageUrl` so providers that take a single image (`veo3`, `minimax`, `kling-turbo`, ...) get a usable input.

> **Image-required models.** Models with no text-to-video mode — `kling-3-omni`, `kling-master`, `hailuo-2.3`, `hailuo-2.3-pro`, `bytedance-pro-fast`, `happyhorse-ref2v`, `grok-imagine-video-1.5` — return a clean `image_required` error when run without a `startFrame` image. On the text-to-video path, reference images alone do **not** satisfy this; they are conditioning inputs, not the start frame. (The split-id exception above — Grok Imagine 1 — never reaches that path with references wired.) (Derived from the model catalog: `VIDEO_PROVIDERS_REQUIRING_IMAGE` in `@nodaro/shared`.)
>
> On the image-to-video endpoint (`POST /v1/generate-video`) the same models now return an `image_required` error too — and for a model that carries image references (Kling 3 Omni, HappyHorse Ref2V, Grok i2v) the message says references are an accepted alternative *on that endpoint*, while a model with no reference capability is told it needs a start frame. Every other provider gets a `validation_error` naming `/v1/text-to-video` as the prompt-only lane. In the editor, Run is disabled on a Generate Video node whose model has no text-to-video mode and no image wired, and the button's tooltip names the model.

## Providers

**Default:** when a request omits `provider`, the platform uses **`seedance-2-fast`** — and when `duration` is also omitted, it defaults to **4 seconds** (the cheapest tier: `seedance-2-fast:4s:480p`, 176 credits<!-- credits: seedance-2-fast:4s:480p -->). An explicitly chosen provider keeps its own duration semantics. The same default applies to single-node runs, API/SDK calls, and workflow (DAG) execution.


Generate Video covers the union of the legacy image-to-video and text-to-video catalogs (`VIDEO_GEN_PROVIDERS` in `@nodaro/shared`):

| Family | Models | Modes | Notes |
|---|---|---|---|
| VEO 3.x | `veo3` (Quality), `veo3.1` (Fast), `veo3_lite` (Lite) | T2V, I2V, first+last — **reference on Fast and Lite only** | 4 / 6 / 8s; 720p / 1080p; generate-audio default on; auto-translate. **Reference mode runs at 8s** — VEO accepts no other length once image references are wired, so a 4s or 6s request is run at 8s (VEO pricing is flat across the three lengths, so the credit cost is unchanged). Quality has no reference mode, so its runs always honour the requested length |
| Gemini Omni | `gemini-omni-video` (Pro), `gemini-omni-flash` (Flash) | T2V, I2V, video-edit (V2V) | 4 / 6 / 8 / 10s; 720p / 1080p / 4K (4K not on free tier); generates an audio track by default and takes audio direction from the prompt, but no in-model dialogue (see section); up to 7 reference images; V2V uses trim window ≤ 10 s. `gemini-omni-flash` is the cheaper, faster sibling on an **identical** request shape — same duration menu, same resolution tiers, same 16:9 / 9:16-only aspect, same 7-unit input quota (a wired source video takes 2 units) |
| Kling | `kling`, `kling-turbo`, `kling-3.0`, `kling-master` | T2V, I2V (`kling-master` is I2V-only) | 5 / 10s (Kling 3.0: continuous 3–15s) |
| Seedance 2 | `seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `seedance-2-5` | T2V, I2V, reference (S2) | S2: 4–15s; **`seedance-2-5`: 4–30s in one shot**. Aspect 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / **21:9** / **adaptive** — **`adaptive` is the default** (output matches the wired input; was `16:9`); on `seedance-2-5` a wired start frame forces `adaptive` (any explicit ratio is rejected, so the frame sets the ratio). Resolution by variant (separate KIE models): `seedance-2` (full) **480p / 720p / 1080p / 4K**; `seedance-2-fast` **480p / 720p only** (no 1080p, no 4K); `seedance-2-mini` **480p / 720p only**; `seedance-2-5` **480p / 720p / 1080p** (no 4K; 1080p added 2026-08-17). Refs: up to 9 image + 3 video + 3 audio (**`seedance-2-5`: 30 / 10 / 10**) |
| MiniMax H3 | `minimax-h3` | T2V, I2V (first/last frame), reference | 4–15s (any second, default 6); resolution **2K (default) / 768P** (768P is the cheaper per-second rate); aspect 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 + **adaptive** (default; pure T2V requires a concrete ratio and renders 16:9 when left on adaptive). Up to 9 image + 3 video + 3 audio refs; audio always on |
| Hailuo | `hailuo-2.3-pro`, `hailuo-2.3`, `hailuo-standard` | T2V (`hailuo-standard`), I2V | 6 / 10s |
| Bytedance | `bytedance-lite`, `bytedance-pro`, `bytedance-pro-fast` | T2V (lite, pro), I2V | 5 / 10s |
| MiniMax | `minimax` | T2V, I2V | Fixed 5s, end-frame supported |
| Grok Imagine 1 | `grok-i2v` (one picker row; remaps to `grok` for T2V) | T2V + I2V — mode auto-selected by image presence | 6 / 10s; resolution + mode (fun/normal/spicy) |
| Grok Imagine 1.5 | `grok-imagine-video-1.5` | I2V (input image required) | 1–15s; 480p / 720p; per-second pricing; offered in the T2V picker too but returns "requires an input image" without one |
| Wan | `wan-i2v` (Wan 2.6), `wan-2.7-i2v` (Wan 2.7), `wan-turbo` | T2V + I2V — Wan 2.6/2.7 are one picker row each (remap to `wan` / `wan-2.7-t2v` for T2V); `wan-turbo` fixed 5s | 5 / 10 / 15s |
| Wan 3.0 | `wan-3` (Wan 3.0), `wan-3-prime` (Wan 3.0 Prime) | T2V, I2V (first/last frame), reference | **2–30s, any whole second** (default 5); 480p / 720p / 1080p (default **720p**); aspect **adaptive** (default) / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 — no 21:9; up to 10 image + 5 video + 5 audio refs (a wired first/last frame **folds into the reference pool** — the provider takes frames or references, never both); ambient audio on by default (switchable off). `wan-3-prime` is the **high-speed** variant — faster turnaround at a higher per-second price, not a higher-quality tier |
| Vidu Q4 | `vidu-q4` | I2V (start frame), reference — **image required** (no text-to-video) | **3–16s, any whole second** (default 5); **540p / 720p / 1080p / 2K / 4K** (default **720p**; 4K not on the free tier). One id over two provider endpoints, picked by what is wired: a **start frame alone** animates that frame (the prompt is optional; the output keeps the frame's shape, so the aspect ratio is not sent); **any reference image or reference audio** switches to reference mode (up to **15 image + 3 audio** refs, a prompt is **required**, aspect 16:9 (default) / 9:16 / 1:1 / 4:3 / 3:4). No end frame and no reference videos. Native audio on by default (switchable off); reference audio is **MP3 only, 3–12s per clip** |
| HappyHorse 1.1 | `happyhorse-i2v` (one picker row; remaps to `happyhorse` for T2V), `happyhorse-ref2v` | T2V + I2V — mode auto-selected by image presence; Ref2V is reference-only (image required) | 3–15s; 720p / 1080p; per-second pricing; 9 aspect ratios (T2V/Ref2V) incl. 4:5 / 5:4 / 21:9 / 9:21 |
| Runway (KIE) | `runway-kie` | T2V, I2V | Fixed configurations |
| Kling 3 Omni | `kling-3-omni` | I2V (input image required) | 3–15s; 720p / 1080p; end frame + up to 7 reference images; native audio; runs on Replicate |
| Kling 4.0 | `kling-4` (Kling 4.0), `kling-4-keyframes` (Kling 4.0 Keyframes) | `kling-4`: T2V, reference (images, videos, characters, voices); `kling-4-keyframes`: T2V, start / in-between / end frames | **3–30s, any whole second** (default 5); **720p (default) / 1080p** — any other value renders and bills 720p; aspect **auto** (default; follows the materials, 16:9 with none) / 16:9 / 9:16 / 1:1 / 21:9; native audio always on (no toggle); no seed; prompt up to 8,000 characters. `kling-4` takes up to **10 image + 5 video refs, 7 characters and 3 voice clips — 15 materials in all**; `kling-4-keyframes` takes a start frame, up to **8 in-between frames** and an end frame, capped by duration. See [Kling 4.0](#kling-40-references-characters-and-keyframes) |
| LTX 2.3 | `ltx-2.3-pro`, `ltx-2.3-fast` | T2V, I2V, audio→V (Pro only) | Pro: 6 / 8 / 10s; Fast: 6–20s; 1080p / 2k / 4k; aspect 16:9 / 9:16; fps 24 / 25 / 48 / 50; supports `last_frame_image` (end-frame interpolation). Fast does not accept audio. |

> **Seedance 1.5 (`seedance`) was retired on 2026-10-25** — the provider stopped serving it. A saved node, an app input or an API call that still names `seedance` runs, and is charged, as **`seedance-2-mini`**: same duration (4 / 8 / 12s are all within Mini's 4–15s), and 1080p runs, and is charged, as 720p, Mini's highest resolution (it renders 480p / 720p). A node that never set a resolution runs at Mini's default, 480p. The run confirmation quotes that Mini price.

Source of truth: `IMAGE_TO_VIDEO_PROVIDERS` + `TEXT_TO_VIDEO_PROVIDERS` in `packages/shared/src/model-constants.ts`. Full per-provider pricing and parameters: `/admin/models` in the admin panel, or the `model_pricing` table.

> **Unified picker collapse.** A few models expose a *different* provider id per mode but are one user-facing model — Grok Imagine 1 (`grok-i2v` / `grok`), Wan 2.6 (`wan-i2v` / `wan`), Wan 2.7 (`wan-2.7-i2v` / `wan-2.7-t2v`), HappyHorse (`happyhorse-i2v` / `happyhorse`). The picker shows a **single row** for each (keyed by the image-to-video id); execution remaps it to the correct mode-specific endpoint based on image presence via `resolveVideoProviderForMode` (driven by `VIDEO_MODE_ALIASES` in `@nodaro/shared`). Picking one row therefore works in both text-to-video and image-to-video. Single-id models (VEO, Kling, Seedance, Grok Imagine 1.5, …) are unaffected. **Wan 3.0 does not collapse** — `wan-3` and `wan-3-prime` are each a single id serving both text-to-video and image-to-video on one endpoint, so there is no `wan-3-t2v` twin and nothing remaps. **Vidu Q4 does not collapse either** — `vidu-q4` is one id over two image-driven endpoints (image-to-video and reference-to-video) and has no text-to-video mode at all: picked in the text-to-video picker or run with nothing wired, it returns the "requires an input image" error before any credits are reserved. **Kling 4.0 does not collapse** — `kling-4` and `kling-4-keyframes` are two picker rows for two provider endpoints (references, or keyframes), and each runs text-to-video on its own endpoint when nothing is wired.

### End-frame support

Providers that accept a paired last frame: `veo3`, `veo3.1`, `veo3_lite` (`imageUrls: [start, end]`), `minimax` (`end_image_url`), `hailuo-standard` (`end_image_url`), `bytedance-lite` (`end_image_url`), `kling-turbo` (`tail_image_url`), `kling-3.0`, `wan-2.7-i2v`, `wan-3` / `wan-3-prime` (`last_frame_url`, which the provider accepts only alongside a start frame), `ltx-2.3-pro` / `ltx-2.3-fast` (`last_frame_image`), `kling-4-keyframes` (`last_frame_url` — with or without a start frame; an end frame alone is allowed). `kling-4` takes an end frame as a reference image instead: it joins the reference images after your own and is named in the prompt as the closing frame. Other providers ignore the `endFrame` handle. **Vidu Q4 has no end frame** on either endpoint: its `endFrame` handle is disabled in the editor, and an end frame sent alongside a start frame through the API is not forwarded. Through the API, an `endFrameUrl` with no `imageUrl` is refused as missing its image. In a workflow, an end frame wired with no start frame (possible only in an imported or agent-written graph) is used as the start frame, as it is for every model that does not fold it into references.

### Multimodal references

Seedance 2 (`seedance-2` / `seedance-2-fast` / `seedance-2-mini`) accepts up to 9 image refs, 3 video refs, and 3 audio refs in a single call; **`seedance-2-5` raises those caps to 30 / 10 / 10** and accepts reference audio up to 30 s per clip. **Reference videos for Seedance 2.5 must each be 2–30 seconds, and 30 seconds in total.** A clip outside that range is rejected before the run starts with a `video_too_long` error, so no credits are spent — trim it with a Trim Video node upstream and run again. The same check runs on single-node runs, workflow runs and published-app runs alike, always before any credits are reserved. **`seedance-2-fast` requires each reference audio clip to be ≤ 15.2 seconds** (audio-driven r2v mode) — longer clips are rejected before the job is created with an `audio_too_long` error. MiniMax H3 (`minimax-h3`) mirrors the same 9 / 3 / 3 caps through the same input resolver (frames fold into the reference pool when any reference is wired): **reference videos must each be 2–15 seconds, and 15 seconds in total** — a clip outside that range is rejected before the run starts with the same `video_too_long` error, so no credits are spent — reference audio is ≤ 15s per clip (enforced pre-submit with the same `audio_too_long` error) and **cannot be used alone** — it must ride with an image or video reference. HappyHorse Ref2V accepts 1–9 image refs, addressed in its own `[Image N]` vocabulary: `[Image 1]` is your first reference, and a wired start frame is appended after your references and named in that vocabulary as the opening frame. Grok Imagine 1 (`grok-i2v`) takes up to 7 images the same way, addressed `@image(n)`. VEO 3.1 **Fast** (`veo3.1`) and **Lite** (`veo3_lite`) flip to `REFERENCE_2_VIDEO` mode whenever image references are wired — **with or without a start frame** — and that mode runs at **8 seconds** whatever length was asked for (VEO supports no other reference-mode duration; pricing is flat across 4/6/8s, so this costs the same). It is under a 3-ingredient cap, following the platform frame-slot convention below: your references take the first seats (so `@image_1` is your first reference), a wired start frame — and end frame — follow them, bound in the prompt as the opening and closing frame, and at the cap the frames are **kept** while trailing references are dropped (the node reports the drop). A start frame, an end frame and references therefore leave one seat for a reference. **VEO 3.1 Quality (`veo3`) has no reference-to-video mode** — the provider serves it on Fast and Lite only, so Quality's reference handles are disabled and a reference sent through the API is ignored rather than failing the run (and its runs keep the length you asked for); use Fast or Lite when you need reference conditioning, or wire Quality with frames alone. Gemini Omni (`gemini-omni-video` / `gemini-omni-flash`) accepts up to 7 image inputs in both modes — with a start frame (i2v) or without one (reference-conditioned t2v). In i2v your references come first as **identity references, not frames** (`@image_1..N`, your own ordinals), and the start frame is appended after them, bound in the prompt as the opening frame; wiring a source video reserves 2 of the 7 slots, and references beyond the quota are **dropped, not rejected** — the start frame is always kept (the node reports how many). Wan 3.0 (`wan-3` / `wan-3-prime`) accepts up to **10 image + 5 video + 5 audio** references. Each reference video and audio clip is **1–15 s** with a **≤ 15 s combined** cap per media type, and with a reference video wired the provider additionally requires **input video duration + output duration ≤ 30 s**. On the Wan wire the reference arrays are **mutually exclusive** with the first/last frame parameters — so, exactly like Seedance 2 and MiniMax H3, the platform **folds** rather than rejects: with any reference wired, a start/end frame is appended to `reference_image_urls` **after** your own images (leaving their ordinals unchanged) and named in the prompt as the opening/closing frame. The pair is never sent together, and the run is never rejected for the combination. Vidu Q4 (`vidu-q4`) accepts up to **15 image + 3 audio** references and **no reference videos**. Its reference endpoint takes no frame parameter, so the same fold applies: with any reference image or reference audio wired, a start frame is appended to the reference images **after** your own (their ordinals stay unchanged) and named in the prompt as the opening frame. Reference mode **requires a prompt** — a reference run with an empty prompt is refused with a `400` before any credits are reserved — and reference audio needs at least one image to ride with (a start frame counts). **Reference audio must be MP3, each clip 3–12 seconds**: a WAV / M4A / other clip, or one outside that range, is refused before the run starts (`audio_format_unsupported`, `audio_too_short` or `audio_too_long`), on single-node, workflow and published-app runs alike, so no credits are spent. Nothing converts a clip for you — export it as MP3 first. Refer to references in the prompt by ordinal — the editor's reference tokens write `@image_N` / `@audio_N`.

**Where a start frame goes when references are wired (every model whose frames and reference images share one list).** Your reference images always come first, in your order, so an image token N (`{image:N}` in the editor, `{ref:<id>}` or a typed `@image_N` through the API) always means **your Nth reference**. A wired start frame — and an end frame, on models that take one — is appended after them and named in the prompt as the opening (closing) frame, in the model's own reference syntax (`@image_N`; Grok `@image(n)`; HappyHorse `[Image N]`). At the model's image cap the frames are kept and trailing references are dropped; the node reports the drop. This applies to the Seedance 2 family, MiniMax H3, Wan 3.0, Vidu Q4, Kling 4.0 (`kling-4`), Gemini Omni, VEO 3.1 Fast / Lite, Grok Imagine 1 and HappyHorse Ref2V. (Kling 4.0 Keyframes is different: its frames are real start / end frames and its Image References are the in-between frames, so nothing is appended.) (Before 2026-10-18, Gemini Omni, VEO, Grok and HappyHorse put the start frame first, so image 1 was the frame on those models.)

**References alone (no start frame).** Every model whose provider runs from reference images alone accepts a run with references wired and no start frame — in the editor, in a workflow or published-app run, and through the API alike: the Seedance 2 family, MiniMax H3, Wan 3.0, Gemini Omni, VEO 3.1 Fast and Lite, Grok Imagine 1 (`grok-i2v`), HappyHorse Ref2V, Vidu Q4 and Kling 4.0 — and Kling 4.0 Keyframes, whose in-between frames run without a start frame. The models with a text-to-video mode run it there with the references attached; Vidu Q4 and HappyHorse Ref2V, which have none, run it on their reference endpoint, and each Kling 4.0 id runs it on its own endpoint. The catalog marks these models with the `reference-to-video` feature (`GET /v1/models`). With nothing wired at all, a model with no text-to-video mode still answers "requires an input image". Kling 3 Omni is the exception: it has no working dispatch path today, so it is not offered.

**Seedance 2 unified inputs (frames + references together).** Seedance 2 no longer has a Frames-vs-References toggle (`data.seedance2InputMode` was removed) — first/last frames and references can all be connected at once, and the dispatch mode is derived from the wiring:

- **With no references connected** (`startFrame` and/or `endFrame` only), the frames are used in exact **first/last-frame** mode (`first_frame_url` / `last_frame_url`).
- **With any reference connected** (image / video / audio), the frames are passed as **prompt-directed reference images** — they join the reference set and are bound in the prompt as `@image_N` (e.g. `Use @image_3 as the opening (first) frame of the video.`) so the model can refer to them, rather than being pinned as exact endpoints.

The node shows an indicator of the active mode, and warns when a wired input would be dropped. Note `audio` (a post-merge soundtrack) is distinct from `audioReferences` (generation-conditioning audio): `audio` always applies as the final soundtrack, while `audioReferences` conditions generation (and triggers audio-driven lip-sync on Seedance 2).

Reference arrays are forwarded to the backend for **every** provider in both dispatch modes; models that don't support them ignore them. (Earlier editor builds dropped reference images on the text-to-video path for all providers except Kling and Seedance 2.)

#### Kling 4.0 references, characters and keyframes

Kling 4.0 is two model ids over two provider endpoints. Both run **3–30 s** (any whole second, default 5) at **720p** (default) or **1080p** — any other resolution renders and bills 720p — with native audio always on (there is no toggle), no seed, and a prompt of up to 8,000 characters. The aspect ratio is `auto` (default: it follows the materials, and renders 16:9 when there are none), `16:9`, `9:16`, `1:1` or `21:9`. Kling models are not available on free credits.

**Kling 4.0 (`kling-4`).** With nothing wired it is text-to-video. Otherwise it takes up to **10 reference images, 5 reference videos (each 2–30 s), 7 characters and 3 voice clips, at most 15 materials in all** (a wired start or end frame counts as an image).

- **Frames join the reference images.** A wired start frame (or end frame) is appended after your own reference images and named in the prompt as the opening (closing) frame — the same fold as Wan 3.0 and Vidu Q4.
- **Characters become named subjects.** A wired Character node reaches the model as a subject named after the character: its portrait plus up to 3 more of its images. A character with only one image stays a plain reference image. Through the API, send subjects in `characterReferences` (see [Character references](#character-references-gemini-omni)): an entry's `imageUrl`, optional `bodyImageUrl` and up to 3 optional `extraImageUrls` are the subject's 2–4 images, and its `name` is how the prompt calls it.
- **Audio References become named voices** — `@Voice1`, `@Voice2`, `@Voice3`, in the order they are wired.
- **Reference videos** must each be 2–30 seconds; a clip outside that range is refused before the run starts, so no credits are spent. By default the output's sound is generated; `keepOriginalSound: true` on the API (`keep_original_sound` on the MCP `generate_video` tool) keeps a reference video's own sound instead. It is ignored when no reference video is sent.
- **Naming materials in the prompt.** Write `@image_1`, `@image_2` … for reference images, `@video_1` … for reference videos, a character by `@Name`, and a voice clip as `@audio_1` … (the platform maps it to that voice). The editor's reference tokens write these for you. The provider refuses a prompt that names a material the request does not carry, so the platform removes the `@` from any such mention — the word stays in the prompt — and the run still starts.
- **Over 15 materials** is refused with a `400` before any credits are reserved (`character_references_quota` when the request carries `characterReferences`, `validation_error` otherwise).
- **Price.** Reference images, characters and voice clips add nothing. A reference **video** switches the run to a per-second reference rate on a longer billed duration — see [Credit pricing](#credit-pricing).

**Kling 4.0 Keyframes (`kling-4-keyframes`).** A start frame, up to **8 in-between frames** and an end frame. The in-between frames are the node's **Image References** input, in the order shown in the settings panel (drag to reorder); over the API they are `referenceImageUrls`, in order. An end frame alone is allowed, and with no frame at all it is text-to-video. The aspect ratio applies only when no frame is attached; otherwise the output follows the start frame's shape. The total number of frames (start + in-between + end) is capped by the clip's duration:

| Duration | 3s | 4s | 5s | 6s | 7s | 8s | 9s or longer |
|---|---|---|---|---|---|---|---|
| Frames in all, at most | 4 | 5 | 6 | 7 | 8 | 9 | 10 |

More frames than the cap, or more than 8 in-between frames, is refused with a `400` (`validation_error`) before any credits are reserved — for example "Kling 4.0 Keyframes takes at most 4 frames in all (start + in-between + end) for a 3s clip; …". In the prompt, name the frames `@first_frame`, `@keyframe_1` … and `@last_frame`; the editor's `@image_N` tokens become `@keyframe_N` on this model. Kling 4.0 Keyframes takes no reference videos, audio or characters.

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
- **API callers can address a reference by id instead of position.** A direct API / SDK / MCP call that passes `connectedReferences` may write `{ref:<id>}` (or `{ref:<id>:label}`) with the entry's own `id`; the platform substitutes the `@image_N` seat after numbering, so the client never computes `N`. Unattached references drop to the label or the entry's name. The editor itself always writes `{image:N}`. See [API Integration](../../api-integration.md#structured-references-connectedreferences-on-video).

### LTX 2.3 — auto-dispatch by wired inputs

LTX 2.3 exposes five task modes on Replicate; Generate Video picks one automatically based on which input handles are wired, so users never see a task toggle:

| Wired inputs | LTX task | Variants |
|---|---|---|
| No `startFrame`, no `audio` | `text_to_video` | Pro + Fast |
| `startFrame` (optionally `endFrame`) | `image_to_video` (with `last_frame_image` when `endFrame` set) | Pro + Fast |
| `audio` connected (no `startFrame`) | `audio_to_video` | Pro only |

LTX 2.3 Fast has its audio handle visually muted because Fast does not accept audio. Wiring an `endFrame` enables LTX's `last_frame_image` parameter for end-frame interpolation.

### Gemini Omni (Pro & Flash) — modes and capabilities

`gemini-omni-video` (Pro) and `gemini-omni-flash` (Flash) share one request shape and both support the same three generation modes, all selected automatically from wired inputs:

| Mode | Dispatch condition | Notes |
|---|---|---|
| Text-to-video | No image / video input wired | Prompt-only generation; wired reference images (no start frame) condition the output in this mode |
| Image-to-video | `startFrame` wired (up to 7 reference images) | Up to 7 image references accepted |
| Video-edit (V2V) | `video` input wired | Source clip trimmed to ≤ 10 s; see trim fields below |

**Key characteristics:**
- **Audio** — Gemini Omni generates an audio track on **every** render, and takes its direction from your prompt. Per [Google's model docs](https://ai.google.dev/gemini-api/docs/omni), *"By default the model will try to generate an appropriate audio track for a video"*, and you steer it in prose — *"Include calm background music"*, *"The audio is a low tinny radio broadcast in the background"*, *"Sound design: gentle breeze, distant bird chirps"*. There is no audio on/off parameter anywhere in the request, so the track cannot be switched off; write what you want to hear instead.

  What it will **not** do on this path is speak. The same docs scope spoken dialogue to multi-turn extension via `previous_interaction_id` — *"Generating spoken dialogue or speech is supported when extending previously generated videos via multi-turn"* — and [KIE's request schema](https://docs.kie.ai/market/gemini-omni-video) exposes no such field, so that path is unreachable here. Reference audio is out too (*"Uploading audio references is unsupported in the current version of the API"*), and while KIE's schema also lists an `audio_ids` array fed by the separate `gemini-omni-audio` model — which takes a preset voice name, never an uploaded recording, so it cannot carry a real speaker's voice (a source video can) — the Nodaro integration forwards one ONLY when you pin a voice to a character reference (see [Pinning a voice](#pinning-a-voice-to-a-character-reference)); otherwise `runGeminiOmni` in `backend/src/providers/kie/video.ts` sends no `audio_ids`. So both SKUs are `ambient` in the audio-capability SSOT — neither `native_speech` nor `audio_driven` — and Gemini Omni stays excluded from [Character voice](#character-voice). `gemini-omni-flash` behaves identically on every point above.
- **Resolutions** — 720p, 1080p, and 4K on **both** SKUs. **4K is not available on the free tier.** (Flash's API also lists a 360p tier; Nodaro does not expose it — it falls in the same credit band as 720p/1080p, so it could only hand you a worse render at the same price.)
- **Durations** — 4 / 6 / 8 / 10 seconds for 720p / 1080p; 4 / 6 / 8 / 10 seconds for 4K.
- **Aspect ratio** — **16:9 or 9:16 only**, and the model requires one on every call (it does not pick a default of its own). Nodaro always sends one: leave the field untouched and you get **16:9**; any other ratio reaching the API (`1:1`, `4:3`, `21:9`, `Auto`, …) is snapped to whichever of 16:9 / 9:16 is closest rather than rejected.
- **Reference images** — up to 7 images can be wired into the `imageReferences` handle (both SKUs).
- **Choosing between them** — **Flash** is the cheaper, faster SKU; **Pro** is the higher-cost tier. Everything else — the 4 / 6 / 8 / 10 s menu, the resolution tiers, the aspect constraint, the reference quota and the V2V trim window — is identical, so the choice is purely price and turnaround.
- **V2V trim window** — when a source video is connected, the fields `videoTrimStart` and `videoTrimEnd` (integer seconds) define the trim window, which must span ≤ 10 seconds. The duration is derived automatically from the wired clip; override manually in the config panel if needed.

#### Character references (Gemini Omni)

Reference images steer a Gemini Omni clip but do not hold a face: the provider treats an image reference as loose context for "characters, scenes, styles, or storyboard guidance", and the person in the clip comes back looking different. To keep a real person's face, send a **character reference** — a portrait plus a description — through the API (`characterReferences` on `POST /v1/generate-video` and `POST /v1/text-to-video`, `character_references` on the MCP `generate_video` tool, `characterReferences` on the SDK's `GenerateVideoParams` / `TextToVideoParams`). The editor node has no control for it yet.

Each entry takes the portrait `imageUrl`, a `description` (appearance, clothing, style; ≤ 2000 characters), an optional full-body `bodyImageUrl`, an optional `name` (≤ 100 characters) and an optional `voice` (see [Pinning a voice](#pinning-a-voice-to-a-character-reference)). Up to **3** per request on Gemini Omni, **7** on Kling 4.0.

- **Models:** `gemini-omni-video`, `gemini-omni-flash` and Kling 4.0 (`kling-4`). Any other model answers `400` (`character_references_unsupported`) rather than running without the face lock.
- **Kling 4.0 takes them as named subjects**, and the rest of this list describes Gemini Omni. On `kling-4` each entry's `imageUrl`, `bodyImageUrl` and up to 3 `extraImageUrls` are the subject's images (2–4; an entry with a single image is sent as a plain reference image), the prompt calls it `@<name>`, and a start or end frame is allowed. Characters count against Kling's 15-material budget instead of the unit budget below, there is no character to create, and a `voice` is refused with `400` (`character_voice_unsupported`) — Kling's voices are audio clips (`referenceAudioUrls`). See [Kling 4.0](#kling-40-references-characters-and-keyframes).
- **No start or end frame.** A character reference cannot be combined with a start frame (`imageUrl`) or an end frame (`endFrameUrl`); the request answers `400` (`character_references_with_start_frame` / `character_references_with_end_frame`) instead of silently dropping one of them. This is a current Nodaro limit, not a provider rule. Use references and, if needed, a source video in the same request.
- **Input budget.** Characters share the model's 7-unit input quota with reference images (1 unit each) and a source video (2 units): `images + 2 × videos + characters ≤ 7`, where a character counts 1 unit, or 2 when it carries a `bodyImageUrl`. Over budget answers `400` (`character_references_quota`) — nothing is truncated.
- **Same character, reused.** Nodaro creates the character from your portrait on the first run and remembers it for 24 hours, so an identical reference (same images, description, name and voice) is not created again on the next run. A voiced and an unvoiced copy of the same person are two different characters.
- **A failed character creation fails the run** — it never falls back to sending the portrait as a plain reference image — and the run's credits are refunded like any failed generation.
- **Price.** Character references add **no credit charge**: the run is priced by the same duration / resolution tier as any other Gemini Omni run.
- **Observable.** The references you sent are recorded on the job's input.

```json
{
  "provider": "gemini-omni-flash",
  "prompt": "She looks into the camera and says hello.",
  "characterReferences": [
    {
      "imageUrl": "https://example.com/assets/portrait.png",
      "description": "A woman in her thirties with short silver hair and a utility jacket",
      "name": "Ava"
    }
  ]
}
```

##### Pinning a voice to a character reference

Left to itself the model improvises a voice for each clip, so the same person sounds different from one generation to the next. Add a `voice` to a character reference to **pin one voice persona** to that character:

```json
{
  "imageUrl": "https://example.com/assets/portrait.png",
  "description": "A woman in her thirties with short silver hair and a utility jacket",
  "name": "Ava",
  "voice": { "preset": "kore", "description": "warm, unhurried, slightly husky", "exampleLine": "Good evening, everyone." }
}
```

| Field | Required | Meaning |
|---|---|---|
| `voice.preset` | yes | The base voice — one of the 30 presets below. |
| `voice.description` | no | Free text on timbre, pace and emotion (≤ 2000 characters). |
| `voice.exampleLine` | no | One sample line the persona says (≤ 120 characters). |

Nodaro creates the persona once and attaches it to the character **and** to the video request, so it drives that character's speech; an identical voice is remembered for 24 hours and reused. A voice is a preset plus your description — it is never a recording of a real speaker (use a source video for that).

- **Models and limits.** Gemini Omni only (Kling 4.0 refuses a `voice` — give it a voice clip instead). A request carries at most **3 distinct voices** (a voice is its preset, description, example line and the character's `name`; two characters with all four identical count once); more answers `400` (`character_voices_over_limit`). Voices do not count against the 7-unit input budget.
- **Description and policy.** The voice `description` is treated like the character `description`: it passes through the same content policies. The `preset` must be one of the ids below or the request answers `400` (`validation_error`).
- **A failed voice creation fails the run** — it never falls back to an unvoiced character — and credits are refunded like any failed generation. A voice adds **no credit charge**.
- **MCP.** The `generate_video` tool exposes the preset only, as `voice_preset` on each `character_references` entry; the description and example line are API / SDK levers.
- **Not verified end to end.** Nodaro has not yet confirmed against live generations how strongly a pinned persona holds across clips; keep describing the speech you want in the prompt.

The 30 presets (gender, style and pitch are the provider's own labels):

| Preset | Gender | Style | Pitch |
|---|---|---|---|
| `achernar` | female | soft | high |
| `achird` | male | friendly | mid |
| `algenib` | male | raspy | low |
| `algieba` | male | easygoing | mid-low |
| `alnilam` | male | steady | mid-low |
| `aoede` | female | brisk | mid |
| `autonoe` | female | bright | mid |
| `callirrhoe` | female | easygoing | mid |
| `charon` | male | intellectual | low |
| `despina` | female | smooth | mid |
| `enceladus` | male | breathy | low |
| `erinome` | female | clear | mid |
| `fenrir` | male | lively | younger |
| `gacrux` | female | mature | mid |
| `iapetus` | male | clear | mid-low |
| `kore` | female | capable | mid |
| `laomedeia` | female | cheerful | mid-high |
| `leda` | female | young | mid-high |
| `orus` | male | steady | mid-low |
| `puck` | male | cheerful | mid |
| `pulcherrima` | genderless | forward | mid-high |
| `rasalgethi` | male | intellectual | mid |
| `sadachbia` | male | vivid | low |
| `sadaltager` | male | knowledgeable | mid |
| `schedar` | male | smooth | mid-low |
| `sulafat` | female | warm | mid |
| `umbriel` | male | smooth | low |
| `vindemiatrix` | female | gentle | mid |
| `zephyr` | female | bright | mid-high |
| `zubenelgenubi` | male | casual | mid-low |

#### Gemini Omni credit pricing

Composite credit identifier: `<model>:<resolution_prefix>:<duration>` — e.g. `gemini-omni-video:4k:8`, `gemini-omni-flash:6`. The 720p / 1080p band carries no resolution prefix; 4K adds `4k:`. Video-edit uses a flat per-call price regardless of output duration (`:vref`, or `:4k:vref` at 4K). **A request that omits `duration` is priced and rendered at the 8 s tier** — so it bills the `:8` row, 297<!-- credits: gemini-omni-flash:8 --> for `gemini-omni-flash` and 418<!-- credits: gemini-omni-video:8 --> for `gemini-omni-video`. (The credit builder always emits a `:N` composite on this family, so neither model's bare identifier is reachable from the generate path; `gemini-omni-video`'s legacy bare row (347<!-- credits: gemini-omni-video -->) is never charged.)

| Setting | `gemini-omni-flash` (Flash) | `gemini-omni-video` (Pro) |
|---|---:|---:|
| 720p / 1080p · 4 s | 176<!-- credits: gemini-omni-flash:4 --> | 253<!-- credits: gemini-omni-video:4 --> |
| 720p / 1080p · 6 s | 231<!-- credits: gemini-omni-flash:6 --> | 330<!-- credits: gemini-omni-video:6 --> |
| 720p / 1080p · 8 s (default) | 297<!-- credits: gemini-omni-flash:8 --> | 418<!-- credits: gemini-omni-video:8 --> |
| 720p / 1080p · 10 s | 352<!-- credits: gemini-omni-flash:10 --> | 495<!-- credits: gemini-omni-video:10 --> |
| 4K · 4 s | 407<!-- credits: gemini-omni-flash:4k:4 --> | 583<!-- credits: gemini-omni-video:4k:4 --> |
| 4K · 6 s | 462<!-- credits: gemini-omni-flash:4k:6 --> | 660<!-- credits: gemini-omni-video:4k:6 --> |
| 4K · 8 s | 528<!-- credits: gemini-omni-flash:4k:8 --> | 748<!-- credits: gemini-omni-video:4k:8 --> |
| 4K · 10 s | 583<!-- credits: gemini-omni-flash:4k:10 --> | 825<!-- credits: gemini-omni-video:4k:10 --> |
| Video-edit · 720p / 1080p (flat) | 462<!-- credits: gemini-omni-flash:vref --> | 660<!-- credits: gemini-omni-video:vref --> |
| Video-edit · 4K (flat) | 693<!-- credits: gemini-omni-flash:4k:vref --> | 990<!-- credits: gemini-omni-video:4k:vref --> |

> **Free credits:** until an account buys anything, video is limited to clips of up to 4 seconds at the model's lowest resolution, and Kling and Seedance 2.5 are not available — see [Free credits](../../features/free-credits.md#video-on-free-credits).

> **Note:** 4K is blocked on the free tier. Free-tier requests at 4K resolution are rejected with a `tier_restriction` error — upgrade to Basic or higher to use 4K output.

## Cinematic direction by id (`direction`, API / SDK)

On the canvas you set a look and a motion by **wiring parameter-picker nodes**
into the node's handles. A direct API / SDK / MCP caller does the same thing
with the optional `direction` object on `POST /v1/generate-video` (and
`POST /v1/text-to-video`): a flat map of catalog ids, one key per dimension,
which the platform folds into the prompt itself. You send ids; the platform owns
the wording — so a saved shot picks up improved phrasing instead of freezing the
hint text your client wrote, and re-generating it never double-bakes.

```json
"direction": {
  "cameraMotion": "dolly-in",
  "shotSize": "medium-shot",
  "timeOfDay": "dawn",
  "colorLook": "teal-orange",
  "temporalSpeed": "slow-motion"
}
```

- **Keys are the picker field names** the canvas already uses. Look dimensions:
  framing (`shotSize`, `angle`, `coverage`, `composition`, `vantage`), camera
  (`cameraFormat`, `lens`), lighting (`timeOfDay`, `lightingStyle`,
  `lightingDirection`, `lightingRatio`, `colorTemperature`), look (`colorLook`,
  `atmosphere`, `style`, `mood`, `aesthetic`), scene (`setting`, `era`,
  `backdrop`), plus `pose` and `compositionEffect`. Motion dimensions:
  `cameraMotion`, `actionFx`, `temporalSpeed`, `temporalFreeze`,
  `temporalDirection`, `temporalShutter`, `transition`, `loopSubject`. Valid ids
  come from `GET /v1/picker-catalogs`; on a deployment with registered catalog
  **packs** that endpoint also lists pack-added ids, which are accepted but
  render no clause.
- **Camera motion leads**, then the rest in the platform's canonical order —
  not your object's key order.
- **Motion dimensions render as short terms, look dimensions as full clauses.**
  `transition: "cross-dissolve"` injects the term, not the sentence explaining
  it: terse motion cues read better to a video model, and video prompt ceilings
  are tight.
- **Motion stays in the prompt body; the look moves to a `[style]:` section.**
  Camera motion is part of the shot, so it reads with your prose. The look
  clauses land after a blank line under a `[style]:` header — a film line
  (`cameraFormat`, `colorLook`, `style`, `era`) and a scene line for the rest.
  Select no look dimension and there is no section at all.
- **Stills-only dimensions are accepted and ignored here** (`aperture`,
  `shutterSpeed`, `isoValue`, `postProcess`, `photoGenre`, `photographer`,
  `renderQuality`), so one client-side look map can be sent to either surface
  unchanged.
- **A value is one id or an array.** Multi-pick dimensions honor their own cap; a
  single-pick key handed an array takes the first entry. Exceeding a dimension's
  cap truncates rather than 400ing, and unknown keys / unknown ids are skipped
  silently — but the wire bounds (8 entries per key, 100 characters per id) do
  reject.
- **Absent ≠ empty.** A missing key means "no hint", never a default; a
  `direction` that renders nothing leaves your prompt byte-for-byte untouched.
- The clauses fold into the prompt **before** reference assembly, so a bound
  character's identity directives still wrap the whole description. The final
  prompt is then clamped to the provider's ceiling (Kling 2.x: 1000 characters; Kling 4.0: 8,000) and
  the clamp cuts the tail, so send the dimensions that carry the shot.

[Extend Video](./extend-video.md) deliberately has no `direction` field — its
prompt continues an existing clip, where re-stating the look is the wrong lever.

Full semantics: [API integration guide](../../api-integration.md#cinematic-direction-on-the-video-routes).

### The same ids stored on the node

A Generate Video **node** can carry that same `direction` object (and the
structured prompt fields `structured`) in its own data, written by an API / MCP
author or by an app that emits Nodaro graphs. The canvas honors them: a
single-node run, a whole-workflow run and the config panel's final-prompt
preview all fold them the same way, once, at the model call — so the graph
stores ids and the wording is produced fresh each run instead of being frozen
into the prompt text. The same applies to the legacy standalone Image to Video
and Text to Video nodes.

**`structured` is node data only.** `direction` is literally the wire field
documented above — the same object, the same ids. `structured` is not: neither
`POST /v1/generate-video` nor `POST /v1/text-to-video` declares it, so a
`structured` key sent to either is dropped by request validation without a 400
and without reaching the prompt. Only `POST /v1/generate-image` accepts
`structured` on the wire. On a video **node** it folds as described here; over
the video wire, put the same content in `prompt`.

The **video** verbosity policy applies exactly as it does on the wire: motion
dimensions render their compact term, look dimensions their full clause.

Stored ids are **additive** to any wired parameter-picker node: the wired hint
lands first, the stored ids after, exactly as two wired pickers of one family
behave. They fold into the prompt body **before** reference assembly, so a bound
character's identity directives still wrap the whole description. A node that
carries neither key is untouched — its prompt reaches the model byte-for-byte as
before. Node presets and workflow export/import capture the ids along with the
rest of the node, which is deliberate: a preset should carry its look.

## Credit pricing

Pricing is computed at credit-reservation time via `buildVideoCreditModelIdentifier(provider, duration, sound, mode, videoSize, resolution, hasVideoRef)` in `@nodaro/shared/credit-identifiers`. With a wired [Settings input](#settings-input), `provider` and `duration` are the wired model and the fitted duration. The `mode` argument is the dispatched mode (`"image-to-video"` or `"text-to-video"`), so T2V and I2V prices can differ per provider (via `T2V_CREDIT_OVERRIDES`).

The model identifier is then looked up in:
1. `model_pricing` DB table (authoritative — admin panel reads from here)
2. `STATIC_CREDIT_COSTS` in `backend/src/ee/billing/credits.ts` (runtime fallback)

The run is charged that row at the deployment's own pricing settings — the price the Run button shows, and every figure on this page.

If neither has the identifier, the route returns HTTP 503 `price_not_configured` — no silent fallback to 1 credit<!-- credits: n/a -->.

**Audio default (`sound` omitted).** When the request doesn't set `sound`, the `:audio` composite follows the model's own default: `kling-3.0` generates audio by default, so an intent-less request is billed at the `:audio` rate (pass `sound: false` for the cheaper silent tier); `kling` (2.6) defaults to silent. Explicit `sound: true` / `false` always wins.

### When no duration is set

A request with no `duration` renders the model's own default length and is
charged for that length — never a flat 5 seconds. The default is the model's
`defaultDuration` (listed by `GET /v1/models` and the MCP `list_models` tool), the
same value the editor's Run button, the workflow total, the server and MCP
estimates and the reservation all use, and it is the length sent to the
provider, so the price and the render cannot differ. A **reference video** run
reserves its output seconds at that same length.

| Model | Default length | Charged as | Credits |
|---|---|---|---|
| `seedance-2` | 8s | `seedance-2:8s:720p` | 902<!-- credits: seedance-2:8s:720p --> |
| `seedance-2-fast` | 8s | `seedance-2-fast:8s:720p` | 726<!-- credits: seedance-2-fast:8s:720p --> |
| `seedance-2-mini` | 8s | `seedance-2-mini:8s:720p` | 451<!-- credits: seedance-2-mini:8s:720p --> |
| `seedance-2-5` | 8s | `seedance-2-5:8s:720p` | 1386<!-- credits: seedance-2-5:8s:720p --> |
| `grok-i2v` | 6s | `grok-i2v:6s` | 55<!-- credits: grok-i2v:6s --> |
| `hailuo-2.3-pro` | 6s | `hailuo-2.3-pro:6s` | 143<!-- credits: hailuo-2.3-pro:6s --> |
| `kling` | 5s | `kling:5s` | 152<!-- credits: kling:5s --> |
| `ltx-2.3-pro` | 6s | `ltx-2.3-pro:1080p:6s` | 264<!-- credits: ltx-2.3-pro:1080p:6s --> |

(The Seedance rows are shown at 720p; an omitted resolution is a separate lever,
described above.) A **duration the model does not offer** is charged as the
nearest length it does:

| Model | You set | Rendered and charged as | Credits |
|---|---|---|---|
| `kling` | 7s | `kling:5s` | 152<!-- credits: kling:5s --> |
| `kling` | 8s | `kling:10s` | 303<!-- credits: kling:10s --> |
| `grok-i2v` | 8s | `grok-i2v:6s` | 55<!-- credits: grok-i2v:6s --> |
| `grok-i2v` | 15s | `grok-i2v:10s` | 88<!-- credits: grok-i2v:10s --> |
| `ltx-2.3-pro` | 7s | `ltx-2.3-pro:1080p:6s` | 264<!-- credits: ltx-2.3-pro:1080p:6s --> |

### Worked examples

| Provider | Duration | Resolution | Mode | Refs | Credits |
|---|---|---|---|---|---|
| `veo3` (Quality) | 8s | 1080p | i2v | — | 1100<!-- credits: veo3 --> |
| `veo3.1` (Fast) | 8s | 1080p | i2v | — | 187<!-- credits: veo3.1:1080p --> |
| `veo3_lite` | 8s | 720p | t2v | — | 83<!-- credits: veo3_lite --> |
| `kling-turbo` | 5s | — | i2v | — | 121<!-- credits: kling-turbo:5s --> |
| `kling-3.0` | 10s | — | i2v | sound on | 1100<!-- credits: kling-3.0:10s:audio --> |
| `minimax` | 5s | — | i2v | — | 158<!-- credits: minimax --> |
| `minimax-h3` | 6s | 2K (default) | any | ≤ 5 input images | 605<!-- credits: minimax-h3:6s --> |
| `minimax-h3` | 8s | 2K (default) | any | ≤ 5 input images | 803<!-- credits: minimax-h3:8s --> |
| `minimax-h3` | 15s | 2K (default) | any | ≤ 5 input images | 1507<!-- credits: minimax-h3:15s --> |
| `minimax-h3` | 8s | 768P | any | ≤ 5 input images | 495<!-- credits: minimax-h3:8s:768p --> |
| `minimax-h3` | 15s | 768P | any | ≤ 5 input images | 935<!-- credits: minimax-h3:15s:768p --> |
| `minimax-h3` | 8s out | 2K (default) | reference | + 5s reference video | 1306<!-- credits: minimax-h3:8s@1.625 --> |
| `minimax-h3` | 8s out | 768P | reference | + 5s reference video | 806<!-- credits: minimax-h3:8s:768p@1.625 --> |
| `minimax-h3` | 6s | 2K (default) | reference | 8 input images (3 over the free 5) | 693<!-- credits: (minimax-h3:6s + 80) --> |
| `seedance-2` | 8s | 720p | i2v | no ref | 902<!-- credits: seedance-2:8s:720p --> |
| `seedance-2` | 8s | 1080p | i2v | no ref | 2244<!-- credits: seedance-2:8s:1080p --> |
| `seedance-2` | 8s | 1080p | i2v | with ref | 1364<!-- credits: seedance-2:8s:1080p-ref --> |
| `seedance-2` | 8s | 4K | i2v | no ref | 4576<!-- credits: seedance-2:8s:4k --> |
| `seedance-2` | 8s | 4K | i2v | with ref | 2816<!-- credits: seedance-2:8s:4k-ref --> |
| `seedance-2-fast` | 8s | 720p | i2v | with ref | 440<!-- credits: seedance-2-fast:8s:720p-ref --> |
| `seedance-2-mini` | 8s | 720p | i2v | no ref | 451<!-- credits: seedance-2-mini:8s:720p --> |
| `seedance-2-mini` | 8s | 480p | i2v | with ref | 132<!-- credits: seedance-2-mini:8s:480p-ref --> |
| `seedance-2-5` | 8s | 480p | i2v | no ref | 616<!-- credits: seedance-2-5:8s:480p --> |
| `seedance-2-5` | 8s | 720p | i2v | no ref | 1386<!-- credits: seedance-2-5:8s:720p --> |
| `seedance-2-5` | 8s | 720p | i2v | with ref | 836<!-- credits: seedance-2-5:8s:720p-ref --> |
| `seedance-2-5` | 8s | 1080p | i2v | no ref | 2508<!-- credits: seedance-2-5:8s:1080p --> |
| `seedance-2-5` | 8s | 1080p | i2v | with ref | 1507<!-- credits: seedance-2-5:8s:1080p-ref --> |
| `seedance-2-5` | 30s | 720p | i2v | no ref | 5203<!-- credits: seedance-2-5:30s:720p --> |
| `seedance-2-5` | 30s | 1080p | i2v | no ref | 9405<!-- credits: seedance-2-5:30s:1080p --> |
| `grok-imagine-video-1.5` | 8s | 480p | i2v | image required | 330<!-- credits: grok-imagine-video-1.5:8s:480p --> |
| `grok-imagine-video-1.5` | 8s | 720p | i2v | image required | 561<!-- credits: grok-imagine-video-1.5:8s:720p --> |
| `grok-imagine-video-1.5` | 15s | 720p | i2v | image required | 1045<!-- credits: grok-imagine-video-1.5:15s:720p --> |
| `happyhorse-i2v` | 5s | 720p | i2v | — | 319<!-- credits: happyhorse-i2v:5s:720p --> |
| `happyhorse-i2v` | 5s | 1080p | i2v | — | 407<!-- credits: happyhorse-i2v:5s:1080p --> |
| `happyhorse-ref2v` | 15s | 1080p | i2v | 1–9 ref images | 1199<!-- credits: happyhorse-ref2v:15s:1080p --> |
| `wan-3` | 2s | 480p | any | no ref | 44<!-- credits: wan-3:2s:480p --> |
| `wan-3` | 5s | 720p (default) | any | no ref | 220<!-- credits: wan-3:5s:720p --> |
| `wan-3` | 8s | 1080p | any | no ref | 704<!-- credits: wan-3:8s:1080p --> |
| `wan-3` | 30s | 1080p | any | no ref | 2640<!-- credits: wan-3:30s:1080p --> |
| `wan-3-prime` | 2s | 480p | any | no ref | 77<!-- credits: wan-3-prime:2s:480p --> |
| `wan-3-prime` | 5s | 720p (default) | any | no ref | 352<!-- credits: wan-3-prime:5s:720p --> |
| `wan-3-prime` | 8s | 1080p | any | no ref | 1111<!-- credits: wan-3-prime:8s:1080p --> |
| `wan-3-prime` | 30s | 1080p | any | no ref | 4158<!-- credits: wan-3-prime:30s:1080p --> |
| `vidu-q4` | 3s | 540p | i2v / reference | any refs | 66<!-- credits: vidu-q4:3s:540p --> |
| `vidu-q4` | 5s | 720p (default) | i2v / reference | any refs | 209<!-- credits: vidu-q4:5s:720p --> |
| `vidu-q4` | 8s | 1080p | i2v / reference | any refs | 429<!-- credits: vidu-q4:8s:1080p --> |
| `vidu-q4` | 5s | 4K | i2v / reference | any refs | 858<!-- credits: vidu-q4:5s:4k --> |
| `vidu-q4` | 16s | 4K | i2v / reference | any refs | 2750<!-- credits: vidu-q4:16s:4k --> |
| `kling-4` | 3s | 720p | any | no ref video | 242<!-- credits: kling-4:3s:720p --> |
| `kling-4` | 5s | 720p (default) | any | no ref video | 396<!-- credits: kling-4:5s:720p --> |
| `kling-4` | 5s | 1080p | any | no ref video | 594<!-- credits: kling-4:5s:1080p --> |
| `kling-4` | 30s | 1080p | any | no ref video | 3509<!-- credits: kling-4:30s:1080p --> |
| `kling-4` | 5s out | 720p | reference | + 4s reference video (billed 10s) | 468<!-- credits: kling-4:8s:720p-ref@1.25 --> |
| `kling-4` | 10s out | 720p | reference | + 15s reference video (billed 25s) | 1170<!-- credits: kling-4:8s:720p-ref@3.125 --> |
| `kling-4-keyframes` | 10s | 720p | keyframes | any frames | 792<!-- credits: kling-4-keyframes:10s:720p --> |
| `gemini-omni-flash` | 8s | 720p | any | no ref | 297<!-- credits: gemini-omni-flash:8 --> |
| `gemini-omni-flash` | 10s | 4K | any | no ref | 583<!-- credits: gemini-omni-flash:4k:10 --> |
| `gemini-omni-flash` | — | 720p | video-edit | 1 source video | 462<!-- credits: gemini-omni-flash:vref --> |

**Grok Imagine 1.5** uses true per-second pricing via the composite identifier `grok-imagine-video-1.5:<N>s:<resolution>` (N = 1–15, resolution = `480p` / `720p`). Each length has its own price, the required input image included — about 40 credits a second @ 480p and about 69 @ 720p. Examples: 4s/480p = 165<!-- credits: grok-imagine-video-1.5:4s:480p -->, 8s/480p = 330<!-- credits: grok-imagine-video-1.5:8s:480p -->, 8s/720p = 561<!-- credits: grok-imagine-video-1.5:8s:720p -->, 15s/720p = 1045<!-- credits: grok-imagine-video-1.5:15s:720p -->. **A request that omits `duration` renders and bills 8 s** (`grok-imagine-video-1.5:8s:…`).

**HappyHorse 1.1** (`happyhorse` T2V / `happyhorse-i2v` / `happyhorse-ref2v`) is per-second priced via the composite identifier `<id>:<N>s:<resolution>` (N = 3–15, resolution = `720p` / `1080p`), with identical rates across all three modes. Each length has its own price — about 62 credits a second @ 720p and about 80 @ 1080p. Examples: 5s/720p = 319<!-- credits: happyhorse:5s:720p -->, 5s/1080p = 407<!-- credits: happyhorse:5s:1080p -->, 10s/720p = 627<!-- credits: happyhorse:10s:720p -->, 15s/1080p = 1199<!-- credits: happyhorse:15s:1080p -->. When resolution is unspecified the run renders and bills at 720p.

**Seedance 2** (full `seedance-2`) is per-second priced via the composite identifier `seedance-2:<N>s:<resolution>` (no-ref) or `seedance-2:<N>s:<resolution>-ref` (any reference wired). Each length has its own price, which depends on resolution and on whether a reference is present — about these many credits a second:

| Resolution | Credits/sec (no ref) | Credits/sec (with ref) |
|---|---:|---:|
| 4K | ≈ 572 | ≈ 352 |
| 1080p | ≈ 280 | ≈ 170 |
| 720p | ≈ 113 | ≈ 69 |
| 480p | ≈ 52 | ≈ 32 |

So at 8s: 1080p = **2244**<!-- credits: seedance-2:8s:1080p --> no-ref / **1364**<!-- credits: seedance-2:8s:1080p-ref --> with-ref; 4K = **4576**<!-- credits: seedance-2:8s:4k --> no-ref / **2816**<!-- credits: seedance-2:8s:4k-ref --> with-ref. Wiring any reference (image / video / audio) selects the cheaper `-ref` ladder. 4K is the full `seedance-2` only — `seedance-2-fast` (480p / 720p) and `seedance-2-mini` (480p / 720p) are separate, cheaper models with their own ladders (neither has a 1080p SKU).

**Seedance 2.5** (`seedance-2-5`) uses the same `-ref` split, on its own prices — and one tier per second across its full **4–30s** range, so no duration rounds up to a coarser tier. About these many credits a second:

| Resolution | Credits/sec (no ref) | Credits/sec (with ref) |
|---|---:|---:|
| 1080p | ≈ 314 | ≈ 188 |
| 720p | ≈ 173 | ≈ 105 |
| 480p | ≈ 77 | ≈ 47 |

So at 8s: 1080p = **2508**<!-- credits: seedance-2-5:8s:1080p --> no-ref / **1507**<!-- credits: seedance-2-5:8s:1080p-ref --> with-ref; 720p = **1386**<!-- credits: seedance-2-5:8s:720p --> / **836**<!-- credits: seedance-2-5:8s:720p-ref -->; 480p = **616**<!-- credits: seedance-2-5:8s:480p --> / **374**<!-- credits: seedance-2-5:8s:480p-ref -->. At its 30s maximum: 1080p = **9405**<!-- credits: seedance-2-5:30s:1080p --> no-ref / **5654**<!-- credits: seedance-2-5:30s:1080p-ref --> with-ref; 720p = **5203**<!-- credits: seedance-2-5:30s:720p --> / **3135**<!-- credits: seedance-2-5:30s:720p-ref -->; 480p = **2310**<!-- credits: seedance-2-5:30s:480p --> / **1408**<!-- credits: seedance-2-5:30s:480p-ref -->. The 1080p tier arrived on 2026-08-17; Seedance 2.5 still has **no 4K SKU** — for 4K, use the full `seedance-2`. **A request that omits `duration` renders and bills 8 s** (`seedance-2-5:8s:…`), and a reference-video reservation counts those 8 output seconds.

**MiniMax H3** (`minimax-h3`) is per-second priced at two resolution rates. The composite is `minimax-h3:<N>s` (N = 4–15) for **2K** — the default, and what any non-768P resolution value renders and bills as — and `minimax-h3:<N>s:768p` for **768P**, the cheaper tier. Each length has its own price — about 100 credits a second @2K and about 62 @768P. Examples: @2K 4s = 407<!-- credits: minimax-h3:4s -->, 6s = 605<!-- credits: minimax-h3:6s --> (the default duration), 8s = 803<!-- credits: minimax-h3:8s -->, 15s = 1507<!-- credits: minimax-h3:15s -->; @768P 4s = 253<!-- credits: minimax-h3:4s:768p -->, 6s = 374<!-- credits: minimax-h3:6s:768p -->, 8s = 495<!-- credits: minimax-h3:8s:768p -->, 15s = 935<!-- credits: minimax-h3:15s:768p -->. There is no `-ref` dimension. Two extra billing dimensions are reserved dynamically on top of the composite:

- **Reference-video input seconds** bill at the selected resolution's per-second rate: the run is priced as one charge for `Σ reference_video_seconds + output_seconds` seconds at the tier's 8s price ÷ 8 (about 100 credits a second @2K, about 62 @768P), rounded up to a whole credit. Examples: 8s output + a 5s reference video = **1306**<!-- credits: minimax-h3:8s@1.625 --> @2K, **806**<!-- credits: minimax-h3:8s:768p@1.625 --> @768P.
- **Input images beyond the first 5** (counting frames folded into the reference pool) add about 30 credits each, whatever the resolution, priced together with the clip. Example @2K: 6s output with 8 pool images = **693**<!-- credits: (minimax-h3:6s + 80) -->. Reference audio is free.

**Reference videos bill input + output duration.** A run with a reference video is billed as `per_sec × (input_video_duration + output_duration)`, not output alone (Kling 4.0 counts the input differently — output + the longer of the output and the input; see below). When one or more reference videos are wired, the runtime ffprobes their durations at reservation time and reserves the full scaled base up front (per-second base rate = the provider's 8s composite ÷ 8, on the `-ref` ladder for Seedance 2 and Kling 4.0 and the selected resolution tier's ladder for MiniMax H3) — credits can only be refunded (never up-charged) at commit, so the full duration is reserved. A reference clip that cannot be measured counts as the provider's per-clip cap (30 s on Seedance 2.5 and Kling 4.0, 15 s otherwise) so a blip never under-charges. Reference **images** and **audio** do not add input duration — only reference **videos** do (and for `minimax-h3`, images beyond the first 5 add the per-image surcharge above). On the Seedance 2 family and Kling 4.0 the editor quotes this exact reservation: the node's price and its Run button come from the server, which measures the wired reference videos and prices them the way the run does (`POST /v1/credits/seedance-ref-estimate`, see the [API reference](../../api-integration.md#seedance-reference-video-estimates)). While a wired reference video has not been produced yet, the node shows a range — from the shortest clip the model accepts up to its worst case — and the Run button the top of that range; no figure is shown while the clips are being measured. The server's own estimates — a workflow run's estimate and a published app's listed price — price the run the same way: an uploaded reference clip is measured, and a clip they cannot know (one a node in the run generates, or one the app's user uploads) at the model's worst case, so a quote is never below what the run reserves.

**Seedance 2 reference runs reserve for an edit and settle to what was delivered.** With a video wired, Seedance may treat the run as an **edit** of that clip (see *Seedance 2.5 video editing* below), and an edit renders the clip's own length rather than the node's Duration. The reservation therefore bills the output at the **longer of the requested duration and the longest reference clip**. When the run completes, the platform measures the delivered clip and settles to the price of `Σ reference_video_seconds + delivered_seconds` seconds at that rate, refunding the rest — so a style run pays exactly its requested duration and an edit pays for the length it rendered. Example, `seedance-2-5` @1080p (the 8 s `-ref` price ÷ 8 a second) with a 30 s clip wired and Duration 12 s: reserved for 30 + 30 seconds = **11303**<!-- credits: seedance-2-5:8s:1080p-ref@7.5 -->; a style run that delivers 12 s settles to 30 + 12 seconds = **7913**<!-- credits: seedance-2-5:8s:1080p-ref@5.25 -->; an edit that delivers the full 30 s settles at the reservation. The reference clips are measured once, when the run is reserved, and the settlement prices the input side from those same measurements — only the delivered clip is measured at the end. A reference clip that could not be measured counts as the provider's per-clip cap both ways (30 s on Seedance 2.5, 15 s otherwise), the summed input never above the provider's total cap; a delivered clip that cannot be measured settles at the reservation. The settlement is never above the reservation, and it applies whether the run is completed by the worker or by the recovery sweep that finishes a run whose worker died.

**Auto duration (Seedance 2 family).** Duration **Auto** (`duration: -1` on the API, SDK and MCP) lets the model pick the clip length: the source clip's own length when Seedance treats the run as a video edit, a length within the model's range otherwise. Because only the model knows the length, an Auto run is **reserved at the model's longest clip** — 30 s on `seedance-2-5`, 15 s on `seedance-2` / `seedance-2-fast` / `seedance-2-mini` — and **settled to what was delivered**, refunding the rest. With no reference video wired, the delivered clip is priced exactly as a fixed-duration request of that length: its seconds (rounded up, ignoring a container overhang under a quarter second) select the same `<id>:<N>s:<resolution>` tier. Example, `seedance-2-5` @480p: reserved at `seedance-2-5:30s:480p` = **2310**<!-- credits: seedance-2-5:30s:480p -->; a delivered 5 s clip settles at `seedance-2-5:5s:480p` = **385**<!-- credits: seedance-2-5:5s:480p -->. On the 2.0 family the delivered length lands on the 4 / 8 / 12 / 15 s ladder like any fixed request — a 6 s clip from `seedance-2` @720p settles at `seedance-2:8s:720p` = **902**<!-- credits: seedance-2:8s:720p -->, against a `seedance-2:15s:720p` = **1694**<!-- credits: seedance-2:15s:720p --> reservation. With a reference video wired, Auto rides the reference-video settlement above, with the model's longest clip as the requested duration. A delivered clip that cannot be measured settles at the reservation. Your balance must cover the reservation for the run to start. Models outside the Seedance 2 family ignore Auto and render their default duration.

**Wan 3.0** (`wan-3`) and **Wan 3.0 Prime** (`wan-3-prime`) are per-second priced via the composite identifier `<id>:<N>s:<resolution>` (N = 2–30, resolution = `480p` / `720p` / `1080p` — lowercase in the identifier even though the provider's own wire enum is uppercase; the platform normalizes it). Each length has its own price — about these many credits a second:

| Resolution | `wan-3` credits/sec | `wan-3-prime` credits/sec |
|---|---:|---:|
| 480p | ≈ 22 | ≈ 34 |
| 720p | ≈ 44 | ≈ 69 |
| 1080p | ≈ 88 | ≈ 139 |

Examples — `wan-3` @480p: 2s = 44<!-- credits: wan-3:2s:480p -->, 5s = 110<!-- credits: wan-3:5s:480p -->, 8s = 176<!-- credits: wan-3:8s:480p -->, 30s = 660<!-- credits: wan-3:30s:480p -->; @720p: 5s = 220<!-- credits: wan-3:5s:720p -->, 8s = 352<!-- credits: wan-3:8s:720p -->, 10s = 440<!-- credits: wan-3:10s:720p -->, 30s = 1320<!-- credits: wan-3:30s:720p -->; @1080p: 5s = 440<!-- credits: wan-3:5s:1080p -->, 8s = 704<!-- credits: wan-3:8s:1080p -->, 30s = 2640<!-- credits: wan-3:30s:1080p -->. `wan-3-prime` @480p: 2s = 77<!-- credits: wan-3-prime:2s:480p -->, 5s = 176<!-- credits: wan-3-prime:5s:480p -->, 8s = 275<!-- credits: wan-3-prime:8s:480p -->, 30s = 1012<!-- credits: wan-3-prime:30s:480p -->; @720p: 5s = 352<!-- credits: wan-3-prime:5s:720p -->, 8s = 561<!-- credits: wan-3-prime:8s:720p -->, 10s = 693<!-- credits: wan-3-prime:10s:720p -->, 30s = 2079<!-- credits: wan-3-prime:30s:720p -->; @1080p: 5s = 693<!-- credits: wan-3-prime:5s:1080p -->, 8s = 1111<!-- credits: wan-3-prime:8s:1080p -->, 30s = 4158<!-- credits: wan-3-prime:30s:1080p -->. There is no `-ref` dimension — wiring a reference does not select a different ladder. **When `resolution` is omitted (or set to a tier Wan 3.0 doesn't offer) the run renders *and* bills at 720p**, so the bare identifiers `wan-3` (220<!-- credits: wan-3 -->) and `wan-3-prime` (352<!-- credits: wan-3-prime -->) are that default tier at the default 5s duration.

**Reference videos on Wan 3.0 bill output seconds only.** The `input + output` rule above does **not** apply to `wan-3` / `wan-3-prime` — a wired reference video adds no input seconds to the reserve. The provider's own reference-video limits — each clip 1–15 s, ≤ 15 s combined, and input video duration + output duration ≤ 30 s — are **documented, not pre-flighted**: an over-long reference video is rejected by the provider mid-run, after credits are reserved (the reservation is refunded). Reference **audio** is the exception: the ≤ 15 s per-clip cap is checked before the job is submitted, with the same `audio_too_long` error as the Seedance / Hailuo family.

**Not forwarded (out of scope).** Wan 3.0's `duration: -1` (model-chosen length), its document-to-video (`reference_file_urls`) and webpage-to-video (`reference_link_urls`) modes, and its `nsfw_checker` switch are not exposed. On both Gemini Omni SKUs, `audio_ids` is forwarded only for a character's pinned `voice`, and `character_ids` through the API's `characterReferences` field (see [Character references](#character-references-gemini-omni)) — the editor node has no control for either yet.

**Vidu Q4** (`vidu-q4`) is per-second priced via the composite identifier `vidu-q4:<N>s:<resolution>` (N = 3–16, resolution = `540p` / `720p` / `1080p` / `2k` / `4k` — lowercase, which is also the provider's own wire spelling; `2K` / `4K` are accepted and normalized). **One ladder serves both endpoints and audio on or off** — no `-ref` and no `:audio` dimension, and reference images or audio add nothing to the price. Each length has its own price — about these many credits a second (each length's price is rounded up, so short clips sit slightly above the rate):

| Resolution | `vidu-q4` credits/sec |
|---|---:|
| 540p | ≈ 20 |
| 720p | ≈ 42 |
| 1080p | ≈ 53 |
| 2K | ≈ 84 |
| 4K | ≈ 172 |

Examples — 5s: 540p = 99<!-- credits: vidu-q4:5s:540p -->, 720p = 209<!-- credits: vidu-q4:5s:720p -->, 1080p = 264<!-- credits: vidu-q4:5s:1080p -->, 2K = 418<!-- credits: vidu-q4:5s:2k -->, 4K = 858<!-- credits: vidu-q4:5s:4k -->; the shortest clip, 3s @540p = 66<!-- credits: vidu-q4:3s:540p -->; the longest, 16s @4K = 2750<!-- credits: vidu-q4:16s:4k -->; 8s @1080p = 429<!-- credits: vidu-q4:8s:1080p -->. **When `resolution` is omitted (or set to a tier Vidu Q4 doesn't offer) the run renders *and* bills at 720p, and when `duration` is omitted it renders and bills 5s** — so the bare identifier `vidu-q4` (209<!-- credits: vidu-q4 -->) is the 5s @ 720p default. The **4K tier is not available on the free tier**; every other tier is.

**Kling 4.0** (`kling-4`) and **Kling 4.0 Keyframes** (`kling-4-keyframes`) are per-second priced via the composite identifier `<id>:<N>s:<resolution>` (N = 3–30, resolution = `720p` / `1080p`) — one price per second of length, the same on both ids. Audio is always on and included; there is no `:audio` dimension, and reference images, characters, voice clips and frames add nothing. Examples — @720p: 3s = 242<!-- credits: kling-4:3s:720p -->, 5s = 396<!-- credits: kling-4:5s:720p -->, 10s = 792<!-- credits: kling-4:10s:720p -->, 30s = 2354<!-- credits: kling-4:30s:720p -->; @1080p: 5s = 594<!-- credits: kling-4:5s:1080p -->, 10s = 1177<!-- credits: kling-4:10s:1080p -->, 30s = 3509<!-- credits: kling-4:30s:1080p -->; Kling 4.0 Keyframes 10s @720p = 792<!-- credits: kling-4-keyframes:10s:720p -->. **When `resolution` is omitted (or set to anything but `1080p`) the run renders *and* bills at 720p, and when `duration` is omitted it renders and bills 5s** — so the bare identifiers `kling-4` (396<!-- credits: kling-4 -->) and `kling-4-keyframes` (396<!-- credits: kling-4-keyframes -->) are the 5s @ 720p default. Kling models are not available on free credits.

**Reference videos on Kling 4.0 bill output + the longer of output and input.** A `kling-4` run with a reference video is priced per second of **billed duration = output + max(output, total reference-video seconds)** — a clip shorter than the output counts as the output's length. It is billed at the reference-video rate, the `kling-4:8s:<resolution>-ref` price ÷ 8 a second (about 47 credits a second @720p, about 70 @1080p), the whole run priced once and rounded up to a credit. Examples @720p: a 5 s output with a 4 s clip bills 5 + 5 = 10 s = **468**<!-- credits: kling-4:8s:720p-ref@1.25 -->; a 10 s output with a 15 s clip bills 10 + 15 = 25 s = **1170**<!-- credits: kling-4:8s:720p-ref@3.125 -->. As on Seedance 2, the clips are measured when the run is reserved (a clip that cannot be measured counts as 30 s), the run reserves that worst case, and on completion it settles to the length actually delivered, refunding any difference. Unlike a Seedance edit, Kling 4.0 always renders the requested length, so a reference clip never lengthens the output. Reference images, characters and voice clips without a video stay on the plain per-second ladder above.

Every figure above is what a run is charged on Nodaro Cloud; `GET /v1/credits/model-cost?model=<composite>` returns the live price of any composite.

### Loop trim add-on

The optional `loopTrim` post-process (PSNR-based smart-loop-cut) adds:

```
11 × (ceil(duration / 5) + ceil(framesToTest / 24))
```

credits on top of the clip's price, at least 11 for each part — the same unit as Trim Video's smart loop cut: 11 credits<!-- credits-rate: trim-video --> per started 5 seconds of output and 11 per started 24 frames searched. The clip and the add-on are priced as one run, so the add-on adds exactly this. If smart-loop-cut fails after generation succeeded, the un-trimmed clip is kept and only the add-on is refunded. The add-on applies to a single-node run, MCP and SDK calls; inside a workflow the trim runs without it.

| Configuration | Add-on |
|---|---|
| 8s output, framesToTest=16 | +33 credits<!-- credits-rate: trim-video@3 --> |
| 8s output, framesToTest=64 | +55 credits<!-- credits-rate: trim-video@5 --> |
| 5s output, framesToTest=16 | +22 credits<!-- credits-rate: trim-video@2 --> |
| 60s output, framesToTest=16 | +143 credits<!-- credits-rate: trim-video@13 --> |

Quality mode (`lossless` vs `precise`) does not affect pricing.

## Character voice

The single-node path — `client.nodes.run("generate-video", { … })` (also the MCP `generate_video` tool and `POST /v1/generate-video`) — can make the clip **speak in a character's saved voice**. Pass a character-voice spec and the route orchestrates the full audio chain server-side, returning **one** `jobId` whose result is the final voiced clip (poll it like any generate-video job — no intermediate jobs to manage). The fields are additive and optional; omit them for today's behavior.

| Field | Type | Notes |
|---|---|---|
| `characterVoices` | `Array<{ voiceId, voiceType?, ttsProvider?, speaker? }>` (max 8) | The voice(s) to speak. `voiceType` is `premade` / `library` / `custom`; `speaker` is the label joined to dialogue lines. |
| `dialogue` | `Array<{ speaker, line }>` (max 50) | Optional structured dialogue. When omitted, the route extracts attributed dialogue (`Anna: "good morning"`) from `prompt`. |

A request is **voiced** only when a spec is present **and** the model can carry dialogue (`videoModelCanSpeakDialogue` — VEO 3.x, Kling 2.6 / 3.0 / 3 Omni, or Seedance 2). The chain is chosen by the model's audio capability (`getVideoAudioCapability`):

| Audio mode | Models | Chain |
|---|---|---|
| `audio_driven` | `seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `seedance-2-5`, `minimax-h3` (audio always on — no toggle) | Synthesize the dialogue (each line in its own voice) via ElevenLabs (direct API — any voice mix works: premade, Voice Library, and cloned voices, no premade-only restriction) → feed as reference audio → the model lip-syncs to it. A single voice renders on that voice's own `ttsProvider`; a multi-speaker cast renders in one dialogue call on **Dialogue v4** when every voice names a speech model with the same dialogue twin (today: every voice on `elevenlabs-v4`), otherwise on **Dialogue v3** (the default — a mixed cast, a voice with no model, or a model with no dialogue twin). |
| `native_speech` | `veo3`, `veo3.1`, `veo3_lite` (always on); `kling`, `kling-3.0` (behind the `sound` toggle — enabling it on Kling raises the credit cost, see the `:audio` composites below); `kling-3-omni` (audio included in the flat rate) | Bake the line during generation, then revoice the baked audio to the primary character voice (ElevenLabs voice-changer, keeping the music/SFX bed). |

**Wan 3.0** (`wan-3` / `wan-3-prime`) carries an ambient audio track (on by default, switchable off) but is not a dialogue model in the audio-capability SSOT — it is neither `native_speech` nor `audio_driven`, so a character-voice spec on it is ignored with the non-fatal `voice_unsupported_for_provider` warning and no audio add-on is charged. **Vidu Q4** (`vidu-q4`) is classified the same way: its `audio` lever (on by default) generates synchronized sound, but in-model dialogue has not been verified on the platform, so it is `ambient` and a character-voice spec is ignored with the same warning. **Kling 4.0** (`kling-4` / `kling-4-keyframes`) is classified the same way: its native audio is always on, but in-model dialogue has not been verified on the platform yet, so it is `ambient` too.

Kling models speak scripted dialogue natively: quote the line in the prompt (optionally with a voice description, e.g. `[Anna: warm calm voice]: "good morning"`) and enable sound. Kling 2.6 voices are English/Chinese; other languages are auto-translated to English by the model.

**Speaker mapping.** Each `dialogue[].speaker` is matched (case-insensitive) to a `characterVoices[].speaker` to pick that line's `voiceId`. An unmatched speaker falls back to the default (first) voice, mirroring the pipeline's non-fatal missing-voice behavior. Total dialogue text is capped at the chosen dialogue model's limit (5,000 characters on Dialogue v3, 10,000 on Dialogue v4); lines over the budget are dropped with a log entry.

**References ride along.** Images, videos and audio wired to the node reach the model on the voiced path exactly as on an unvoiced run, with one substitution: on an `audio_driven` model the synthesised dialogue track takes the audio-reference slot. A Seedance reference-video run is reserved and settled like an unvoiced one (see *Reference videos bill input + output duration* under pricing), with the audio add-on on top.

### Credit pricing (character voice)

The audio step is reserved as an add-on **on top of** the clip's price — same `computeCredits` mechanism as Loop Trim (the base cost is never counted twice) — and committed only if the step actually runs:

| Mode | Add-on identifier | Add-on credits |
|---|---|---|
| `audio_driven` (Seedance 2 / MiniMax H3) | the model the track is synthesised on: `elevenlabs-dialogue-v4` for a multi-voice cast whose every voice is on `elevenlabs-v4`, `elevenlabs-dialogue` for any other multi-voice cast, else the voice's own text-to-speech model | By length — every started 100 characters of the voiced lines (a single voice's lines are counted joined by a space, as they are sent), at least 8 units; 4.4<!-- credits-rate: elevenlabs-v4:per-100-chars --> credits per unit on Dialogue v3, Dialogue v4, v3, v4 and Multilingual v2 (so 1–800 characters add 35.2<!-- credits-rate: elevenlabs-v4:per-100-chars@8 -->, 5,000 add 220<!-- credits-rate: elevenlabs-v4:per-100-chars@50 -->, and 10,000 on Dialogue v4 add 440<!-- credits-rate: elevenlabs-v4:per-100-chars@100 -->), 2.2<!-- credits-rate: elevenlabs-v4-turbo:per-100-chars --> on Turbo v2.5 and v4 Turbo (17.6<!-- credits-rate: elevenlabs-v4-turbo:per-100-chars@8 --> and 110<!-- credits-rate: elevenlabs-v4-turbo:per-100-chars@50 -->). Where a Cloud-edition install leaves `SPEECH_LENGTH_PRICING_ENABLED` off: a flat 27.5<!-- credits-rate: elevenlabs-dialogue -->, whichever dialogue model the cast renders on |
| `native_speech` (VEO 3.x) | `elevenlabs-voice-changer` | +44<!-- credits-rate: elevenlabs-voice-changer --> |

The dialogue add-on is reserved under the identifier of the model the cast actually renders on, chosen once when the request is accepted and forwarded to the worker.

The clip and its add-on are priced as one run, so the add-on adds exactly the amount above. Example: `veo3.1` 8s / 1080p i2v voiced = 187<!-- credits: veo3.1:1080p --> (the clip) + 44<!-- credits-rate: elevenlabs-voice-changer --> (revoice) = **231 credits**<!-- credits: (veo3.1:1080p + elevenlabs-voice-changer) -->.

### Fallback behavior

- **Provider can't voice dialogue** (`none` / `ambient` models — minimax, kling, hailuo, Gemini Omni, Wan 3.0, Vidu Q4, Kling 4.0, …): the spec is **ignored**, the clip still generates (never failed), and the response carries a non-fatal warning `{ code: "voice_unsupported_for_provider" }`. No audio add-on is charged. Clients should gate the voice UI on `videoModelCanSpeakDialogue` and confirm with the user before sending.
- **No voice resolves** (dialogue / voices empty or unparseable): the clip generates silently and the reserved audio add-on is refunded automatically (committed at the video provider cost only).
- **A chain step fails** (TTS / revoice / generation): the whole job fails and credits are fully refunded.

> **Phase 1 scope.** Single-speaker clips are fully supported in both modes. A multi-speaker prompt produces a correct multi-voice **audio** track (the cast's dialogue model voices each line separately) for a single-subject `audio_driven` clip; true per-face lip-sync across multiple on-screen speakers is not yet supported. The silent / ambient-only chain (separate-stems → voice-change → re-merge → lip-sync) for `none` / `ambient` models is deferred to Phase 2.

## Content policy

Some providers screen generated output against content policies (for example, resemblance to protected film/TV content) and reject a job after generation. When that happens, Generate Video doesn't just fail: it asks an LLM to rewrite the prompt once — keeping the same subjects, camera language, and mood while removing or softening whatever triggered the screen — and automatically retries with the rewritten prompt, at no extra credit cost. If the retry succeeds, the job completes normally and the result records what changed (`contentPolicyRewrite` in the job output for this node; [Generate Video Pro](./generate-video-pro.md) records the equivalent per-segment as `contentPolicyRewrites`). If the provider rejects the rewritten prompt too, or the rewrite itself doesn't produce a usable result, the job fails with the provider's real rejection reason rather than a generic error.

## Configuration

Most provider-specific fields are exposed in the node's config panel only when the wired provider supports them. The config panel reads from the node's data and writes back the user's choices. The full per-provider matrix is documented in the legacy [Image to Video](./image-to-video.md) page for I2V parameters and [Text to Video](./text-to-video.md) page for T2V parameters — both pages redirect here but the parameter tables remain valid because Generate Video forwards to the same worker handlers.

Common fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| Provider | Select | `kling` | Drives all other field visibility |
| Duration | Select / Number | 4 s on a new node (the API default) | See per-provider durations above |
| Resolution | Select | Provider-specific | 480p / 720p / 1080p depending on provider |
| Aspect Ratio | Select | Provider-specific | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / Auto |
| Generate Audio | Checkbox | Provider-specific | VEO 3.x default on |
| Loop Trim | Group | off | Enable + framesToTest + quality |
| Frame fit | Select | `Match output size` | How a wired start/end frame is reshaped before the model sees it |
| Send frames as | Select | `Auto` | Whether that frame rides as a frame or as a bound reference image |
| Inject Character Context | Checkbox | off | When an upstream Character has identity-injection on |
| Motion hint | Checkbox + Select (`subtle` / `moderate` / `dynamic`) | off; `moderate` once ticked | Adds "<step> motion" (e.g. `dynamic motion`) to the prompt, before the Look hints, with or without a start frame. Separate from a [Motion](../parameters/motion.md) node wired into the `settings` input, which adds its own fuller clause. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### Resolution, aspect ratio and duration corrections

Every model exposes a different set of resolutions, aspect ratios and durations,
and the node lets you type a value the wired provider may not support (a saved
workflow can also carry a value from a provider you switched away from). Rather
than fail the run — which would take every already-generated, already-billed
sibling node down with it — the platform **corrects** the value to one the model
accepts, and **you are billed for the corrected value, because it is also the
value actually sent to the provider.**

- **Off-list values snap to the NEAREST option, never the cheapest or the first
  in the list.** A `4k` request on a model that tops out at 1080p renders 1080p
  (not the 480p floor); a portrait `9:21` becomes `9:16` (never landscape
  `16:9`).
- **An omitted resolution is sent at the band it is priced at.** Where the
  platform declares a model's default band, that band is now what the provider is
  asked for as well as what you pay for — previously the field could be left
  unset and the provider chose for itself. The value is recorded on the job, so
  you can always see what was sent.
- **`4K` and `4k` mean the same thing.** Spelling is canonicalised before
  pricing, so an uppercase `4K` on LTX 2.3 prices and renders the 4K band
  instead of falling back to 1080p.
- **`Auto` / `adaptive` are passed through untouched** — they are instructions to
  the provider ("match the input"), not concrete ratios, so they are resolved at
  render time rather than snapped to a fixed ratio.
- **An omitted duration is the model's own default length** (see
  [When no duration is set](#when-no-duration-is-set)), and **a duration the model
  does not offer moves to the nearest one it does — a tie goes to the shorter
  length.** What you are billed for is the length rendered: a 7s Kling request
  renders and bills 5s, an 8s one 10s. **LTX 2.3** is priced on a fixed ladder of
  durations per resolution band (Pro: 6 / 8 / 10s at every band; Fast: up to 20s
  at 1080p, 6 / 8 / 10s at 2k / 4k), so a duration between rungs moves to the
  nearest one — a 7s LTX request renders and bills 6s.
- **A few models ignore an unsupported resolution** and render a fixed default
  rather than the nearest band: `minimax-h3` renders 2K for anything that is not
  `768P`, and the `wan-3` family, `vidu-q4` and both Kling 4.0 ids render 720p. For those the correction targets
  the band the provider will actually produce, so the price still matches the
  render.

Through the API these corrections are returned in the response — see
[Parameter corrections](../../api-integration.md#4d-parameter-corrections-adjustments).

**Seedance 2.5 in a workflow:** an untouched Generate Video node has always *sent*
`480p` (the first band in the model's list) while being *priced* at the model's
720p default. Those two now agree at **480p** — the tier actually rendered — so a
workflow that never touched the Resolution field bills less than it used to. Set
Resolution explicitly to 720p or 1080p if you want the higher tier.

**Seedance 2.5 video editing — Aspect ratio and Duration follow the source clip.**
With a video wired into `videoReferences`, Seedance decides for itself, from your
prompt, whether the run is an ordinary generation using that clip as a reference
or an **edit** of it ("remove the sign", "make it black and white"). When it reads
the prompt as an edit, the output inherits the source clip's ratio and length, and
the provider refuses any explicit Aspect ratio or Duration:

> The parameters `ratio` and `duration` specified in the request are not valid.
> Seedance identified your task as video editing based on your prompt.

Nothing in the node predicts that verdict — the same node with the same video is a
normal reference run under a different sentence — so the platform **resubmits the
run once automatically** with the two values the provider asked for, and the node
returns the edited video instead of failing. Your settings are still tried first,
so a reference run keeps the ratio and duration you chose; only a run Seedance
itself classified as an edit is re-shaped. The source clip must still be **4–30
seconds** for edit mode to be available at all.

To ask for an edit **up front** instead of relying on the resubmit, set Aspect
ratio to **Adaptive** and Duration to **Auto** — that is exactly the shape edit
mode requires, so the run goes through on the first submit.

**Credits for an edit.** Because an edit renders the source clip's length, the
run is reserved as if it were one — the output billed at the longer of your
Duration and the clip — and settled to the length actually delivered once the
run completes (a style run is refunded down to its Duration). The formula and a
worked example are under *Reference videos bill input + output duration* in the
pricing section above.

### Seedance 2.5 Draft mode

On **Seedance 2.5** (`seedance-2-5`) the node has a **Draft** switch. A draft is a
480p render of your shot that you can later **finalize at 1080p as the same take** —
same seed, prompt, references, timing and audio setting, frame for frame — with a
Video Upscale node set to **Seedance 2.5 HD (from draft)**
([details and pricing](../processing-video/video-upscale.md#seedance-25-hd-from-draft)).
Use it to iterate cheaply on a shot and only pay for 1080p once you like the take.

- **Draft renders at 480p only.** With Draft on, the Resolution field is locked to
  480p; a request or workflow that sends Draft with another resolution is priced
  and rendered at 480p, and the change is reported back (see
  [Parameter corrections](../../api-integration.md#4d-parameter-corrections-adjustments)).
- **A draft costs exactly what a 480p run costs** — the same `seedance-2-5:<N>s:480p`
  row (or `480p-ref` with a reference video). Example: an 8 s draft = **616**<!-- credits: seedance-2-5:8s:480p --> credits;
  a 4 s draft = **308**<!-- credits: seedance-2-5:4s:480p -->.
- **Finalizing costs extra**, priced from the draft's own length — for a 4 s draft
  without a reference video, **1738**<!-- credits: seedance-2-5-hd:4s --> credits. The Video Upscale node shows the
  exact price once the draft is wired into it. Draft + finalize is therefore more
  than one direct 1080p run (308<!-- credits: seedance-2-5:4s:480p --> + 1738<!-- credits: seedance-2-5-hd:4s --> = 2046<!-- credits: seedance-2-5:4s:480p + seedance-2-5-hd:4s --> vs 1254<!-- credits: seedance-2-5:4s:1080p --> at 4 s), but cheaper as soon
  as a direct 1080p would need **two or more tries** (2 × 308 + 1738 = 2354<!-- credits: 2*seedance-2-5:4s:480p + seedance-2-5-hd:4s --> vs
  2 × 1254 = 2508<!-- credits: 2*seedance-2-5:4s:1080p -->).
- **Audio carries over.** An Audio input merged onto the draft, or a voiced clip's
  dialogue track, is mixed onto the 1080p render the same way.
- **Drafts are kept for about 7 days.** Finalize within that window.
- Draft is ignored on every other model, and only offered where the model supports it.

API / SDK: `draft: true` on `POST /v1/generate-video` or `POST /v1/text-to-video`
(and on the Seedance 2.5 Edit lane of Video to Video). MCP: `draft: true` on
`generate_video`, `animate_image` and `modify_video`.

### Start and end frame handling

A start frame that is not already the size the model renders gets reshaped by the
provider, and some models do it one frame into the clip: frame 0 is your image,
and the rest of the video is very slightly taller or wider. Seedance 2.5 did this
on five of ten measured runs with a 940x1672 image, and on none of three runs with
the same image resized to 720x1280.

**Frame fit** decides what happens to the frame before it is sent.

| Value | What it does |
|---|---|
| `Match output size` (default) | Resizes the frame to the exact pixel size the model renders for the chosen resolution and ratio |
| `Match aspect ratio` | Only corrects the aspect ratio, with the smallest possible pixel change |
| `Keep original` | Sends the frame untouched |

When the model, resolution and ratio have been measured, the panel names the target
under the select, for example “Frames are fitted to 720×1280 before sending.”

The target size is measured from real renders per model, resolution and ratio,
because models do not always render the ratio they are asked for. Minimax H3 at
768P returns 768x1344 for a 9:16 request, and Seedance 2.0 at 480p 16:9 returns
864x496 where Seedance 2.5 returns 854x480. For a combination we have not
measured, `Match resolution` falls back to `Match ratio`, and `Match ratio` falls
back to leaving the frame alone. Nothing is ever guessed.

When your image is more than 5% away from the target shape — a square photo into a
9:16 video, say — the frame is centre-cropped to the target ratio first and then
resized, so the subject is never squashed.

**Send frames as** decides how the frame travels.

| Value | What it does |
|---|---|
| `Auto` (default) | Picks per model, and the option names what it resolves to: “Auto (as frame)” or “Auto (as reference image)” |
| `Frame` | Always a real start frame |
| `Reference image` | Always a reference image, bound in the prompt as the opening frame |

The Seedance 2.0 family (fast, standard and mini) zooms the frame about 2% and
loses 11–26% brightness within six frames when the image is sent as a frame; the
same models hold their look from frame 0 when it is sent as a reference. Every
other model measured reproduces your opening frame more faithfully as a frame, so
`Auto` leaves them in frame mode. On a model that takes no reference images the
setting is hidden and has no effect.

Two limits worth knowing. Reference delivery never drops one of your own
reference images to make room: if the frames would push the request past the
model's image limit, the frame stays a frame. And when your request already
carries reference images, several models cannot keep a real start frame at all —
Seedance and Wan move it into the reference list, Minimax H3 switches endpoints,
and Veo 3.1 drops the end frame. That is provider behaviour, unchanged by these
settings.

API and SDK callers set `frameFit` and `frameDelivery` on `POST /v1/generate-video`.
Both are optional and default as above.

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
