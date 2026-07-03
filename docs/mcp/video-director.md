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

Phase-1 visuals are **kinetic typography and simple shapes** — `text` and
`shape` reveal elements anchored to voiceover cues. On-screen pieces appear
the moment the narration speaks their phrase, baked to the exact frame via
forced alignment.

**Phase-1 honest limits:**

- Visuals: text + rectangle/circle/line shapes only. The ~50 named HyperFrames
  blueprints (device-showcase, SVG-ring, push-through, cursor-demo) are **not**
  available. A "product launch" is kinetic-type/shape-driven, not a UI showcase.
- Real-UI capture: deferred. Passing a URL to `create_launch_video` without a
  `brief` returns a "not yet supported" message rather than attempting a
  screenshot; describe the product in `brief` instead.

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
