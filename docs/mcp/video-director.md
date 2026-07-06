# Video Director (narrated motion-graphics)

Author and render narrated, voiceover-paced motion-graphics videos in a single
tool call. The video director is a three-tool family built on the Phase-0
[shot-sequence pipeline](./shot-sequence.md):

- `start_video_director` — loads the motion-director doctrine into your LLM
  so you can author a brief and drive the pipeline yourself.
- `create_explainer` — one-shot: author + render a concept-led explainer video.
- `create_launch_video` — one-shot: author + render a product-launch video.

## Motion graphics vs. animated footage

`start_video_director`, `create_explainer`, and `create_launch_video` are the
**motion-graphics** path — kinetic typography and shapes only, never
illustrated or filmed scenes (see "What Phase-1 can produce" below). If the
user asks for a bare "explainer" without specifying a visual style, both the
tool descriptions and the motion-director doctrine instruct the LLM to confirm
the method with the user *before* calling any tool: motion graphics (this
family — a fixed **~20 credits** via `create_explainer`, or **~11 credits**
driving the Phase-0 pipeline manually) vs. animated illustrated footage
(`get_recipe` → `video-explainer`, **~45 credits per 10-second block**). Only
proceed once the user has chosen, or has already stated a style in the
original ask. See [Content Recipes](./recipes.md) for the `video-explainer`
side of this choice.

## What Phase-1 can produce

Phase-1 visuals are **kinetic typography, simple shapes, and image media** —
`text`, `shape`, and `image` reveal elements anchored to voiceover cues.
On-screen pieces appear the moment the narration speaks their phrase, baked
to the exact frame via forced alignment.

**Phase-1 honest limits:**

- Visuals: text + rectangle/circle/line shapes, plus **image** media (freeform image
  elements and the `device-surface-showcase` / `cursor-ui-demo` image blueprints).
  Video media and the rest of the ~50 named HyperFrames blueprints are not yet available.
- Real-UI capture: deferred. Passing a URL to `create_launch_video` without a
  `brief` returns a "not yet supported" message rather than attempting a
  screenshot; describe the product in `brief` instead. The `device-surface-showcase` /
  `cursor-ui-demo` blueprints render screenshots you already uploaded — they don't
  capture a live site themselves.

## Credit costs

### `start_video_director`

Free. Zero credits. No side effects.

### `create_explainer` and `create_launch_video`

Each one-shot tool runs the full authoring and rendering pipeline. The credits
are charged as four sub-jobs:

| Step | Job type | Credits |
|------|----------|---------|
| Authoring (LLM — writes VO script + shot-sequence brief) | `video-director` | **9** |
| Voiceover synthesis (ElevenLabs v3) | `text-to-speech` | **3** |
| Forced alignment (ElevenLabs — word timings) | `forced-alignment` | **3** |
| Resolve (bake cue anchors to frames) | synchronous, no job | **0** |
| Remotion render | `render-video` | **5** |
| **Total per video** | | **20** |

Arithmetic: 9 + 3 + 3 + 0 + 5 = **20 credits per generated video**.

The authoring credit is refunded if the run fails. Each sub-job (speech,
alignment, render) is metered independently and is refunded only if that step
itself fails — a step that already completed is not refunded when a later step
fails (e.g. if render fails, the speech + alignment credits already spent are
not returned).

**Automatic resolve repair:** the authoring LLM occasionally produces a brief
that violates a resolver invariant (e.g. two scenes with overlapping reveal
timing). When that happens the director silently gives the author ONE
corrective pass — feeding back the resolver's exact error — before failing the
job. The corrected brief must keep the voiceover script and cues byte-identical
to the original (speech and forced alignment have already been generated from
them and are not redone), so only scene/shot/reveal structure and timing may
change. This repair round is free — no extra credits are charged — and is
invisible when it succeeds. If the repair either drifts the script/cues or
still fails the resolver, the job fails exactly as it would without the
repair attempt, with the same stage-prefixed `resolve:` error message.

## Brand

`create_explainer` and `create_launch_video` both accept an optional `brand`
— either a **preset id** (see
[`list_brand_presets`](./tools.md#list_brand_presets), e.g.
`"cobalt-corporate"`) or an **inline token object** `{ palette, fonts, logo }`.
Whichever you pass, its palette and fonts are applied consistently across
every scene the director authors. See
[Brand Typography Ramp](../design/brand-typography-ramp.md) for the full
palette/font model, including the per-role weight/casing/tracking levers.

### Logo image

A brand can also carry a `logo`:

| Field | Type | Notes |
|-------|------|-------|
| `logo.name` | string | Required whenever `logo` is set. The wordmark text — used as the fallback render (see below) and in the tagline layout. |
| `logo.tagline` | string | Optional line shown under the wordmark/logo. |
| `logo.image` | string (https URL) | Optional. **Must be an https URL on your Nodaro CDN** — get one from `request_image_upload` or `upload_image_widget` (see [Upload tools](./tools.md#upload-tools)) before authoring the brief. Raster formats only (PNG, WebP, JPEG) — no SVG. A URL on any other host is rejected when the brief/plan is validated. |
| `logo.imageBackdrop` | string (hex color) | Optional. Renders a rounded color panel behind the logo image — useful when the logo needs contrast against the scene background. Has no effect without `logo.image`. |

When `logo.image` is set, the video director **guarantees** a
[`logo-assemble-lockup`](./shot-sequence.md#blueprint-catalog) scene appears
somewhere in the video — it's the only blueprint that renders the logo image.
You don't need to explicitly request it: if the authored brief doesn't
already include one, the pipeline appends it automatically as a closing beat.

**Fallback:** if the image fails to load at render time, that scene falls
back to the animated text wordmark (`logo.name`) instead — a bad or
unreachable image URL never fails the render. The renderer retries a failing
image a couple of times over a few seconds (holding the render frame each
time) before giving up and falling back, so if you render immediately after
uploading — before the image has finished propagating on the CDN — that
render may still show the wordmark fallback even though the URL is valid.
If that happens, wait briefly and render again.

**Example — `create_explainer` with an inline brand + logo:**

```json
{
  "topic": "How our new analytics dashboard works",
  "brand": {
    "palette": { "bg": "#0B0B12", "text": "#FFFFFF", "accent": "#8B5CF6" },
    "fonts": { "heading": "Montserrat", "body": "Inter" },
    "logo": {
      "name": "NODARO",
      "image": "https://…/uploads/logo.png",
      "imageBackdrop": "#111111"
    }
  }
}
```

**Driving the pipeline manually?** `resolve_shot_sequence`'s brief accepts
the same tokens under `shotSequenceBrief.brandTokens` — but only as the
resolved object shape (`{ palette, fonts, logo }`), never a preset-id string.
Call `list_brand_presets` first and copy a preset's tokens in if you want to
start from one.

## Tool reference

### `start_video_director`

**Scope:** none — always visible (no scope required, all editions).

Returns the motion-director doctrine that instructs the LLM how to:

1. Pick a genre (`explainer` or `product-launch`) and narrative arc.
2. Draft the VO script as discrete cue phrases.
3. Build a `ShotSequenceBrief` JSON object.
4. Drive the Phase-0 pipeline:
   `generate_speech` → `forced_alignment` → `resolve_shot_sequence` →
   `render_shot_sequence`.

Call this tool first when a user asks for a narrated video but wants to
author or review the brief before committing to a render. It is idempotent,
non-destructive, and free — no credits charged, no jobs created.

**Input:** none

**Returns:** The motion-director doctrine (the full authored skill, including
narrative-arc table, VO script bank, shot-sequence method, motion doctrine, and
the `ShotSequenceBrief` machine contract with a worked example).

---

### `create_explainer`

**Scope:** `workflows:execute` — Cloud only.

Author and render a narrated, time-coded **concept-led explainer video** in one
call. The director writes the VO script + shot-sequence brief, generates the
voiceover, aligns it word-by-word, resolves cue anchors to exact frames, and
renders an MP4 on the Remotion engine. In hosts with interactive tool cards
(claude.ai), progress and the finished video render inline in the tool card.
The video is also saved to your Nodaro library.

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `topic` | string (1–8000 chars) | What the explainer should teach or cover. Required. |
| `brand` | string \| object | Optional. A brand preset id or inline brand tokens — see [Brand](#brand) below. |

**Returns:** `{ job_id: string }`. Clients without card support poll `get_job`
to track progress; when complete, the MP4 URL is in `output_data.videoUrl`.

**Example:**

```json
{ "topic": "How transformer self-attention works, in 60 seconds" }
```

---

### `create_launch_video`

**Scope:** `workflows:execute` — Cloud only.

Author and render a narrated **product-launch video** in one call. Pass `brief`
describing the product — what it is, who it is for, the key features, the tone.
The director writes the VO + brief, generates the voiceover, aligns it, and
renders an MP4. In hosts with interactive tool cards (claude.ai), progress and
the finished video render inline in the tool card. The video is also saved to
your Nodaro library.

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `brief` | string (1–8000 chars) | Describe the product to launch (features, audience, tone). Required when no `url`. |
| `url` | string | Not yet supported. Passing `url` without `brief` returns a "Real-UI capture isn't supported yet — pass `brief` instead" message. Passing both (`url` + `brief`) ignores the URL and proceeds with `brief`. |
| `brand` | string \| object | Optional. Same shape as `create_explainer`'s `brand` — see [Brand](#brand) below. |

**Returns:** `{ job_id: string }`. Clients without card support poll `get_job`
to track progress.

**Example:**

```json
{
  "brief": "Nodaro is an AI video studio. Paste a prompt, pick a style, get a finished video. For indie creators and small teams who don't have time to edit. Tone: confident, modern, no jargon."
}
```

---

## Authoring manually with `start_video_director`

If you want to review or refine the brief before rendering — or if you want to
learn the shot-sequence method — use `start_video_director` and drive the
pipeline yourself. The doctrine it returns covers the full workflow:

```
1. Call start_video_director → read the doctrine (free)
2. Draft your voScript + ShotSequenceBrief following the doctrine
3. Call generate_speech(voScript) → wait for job → audioUrl
4. Call forced_alignment(audioUrl, voScript) → wait for job → alignment
5. Call resolve_shot_sequence(brief, audioUrl, alignment) → plan (synchronous)
6. Call render_shot_sequence(plan) → wait for job → MP4
```

Steps 3–6 each consume credits independently (3 + 3 + 0 + 5 = 11 credits for
the four sub-jobs; no separate authoring charge when you write the brief
yourself).

See [Shot Sequence](./shot-sequence.md) for the full brief format, cue-anchor
rules, and element reference.

---

## Related

- [Shot Sequence](./shot-sequence.md) — brief format, pipeline tools, worked
  example
- [Film Director](./film-director.md) — multi-stage director for longer
  productions
- [MCP Tools Reference](./tools.md)
- [Connecting Claude.ai](./connecting-claude.md)
- [Brand Typography Ramp](../design/brand-typography-ramp.md) — the palette/font
  model behind `brand`
- [Brand Image Logo](../design/brand-image-logo.md) — design rationale for the
  logo image capability
