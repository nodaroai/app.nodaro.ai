# Shot Sequence (voiceover-paced motion graphics)

Author a narrated motion-graphics video whose on-screen text and shapes are
revealed in sync with the voiceover — each visual appears the moment the
narration speaks its matching phrase. Three tools form the pipeline; an LLM (or
you) authors a **brief**, and the server bakes word timings into exact frames.

## Flow

1. `generate_speech(script)` → a narration MP3 (job; read `audioUrl` from the job output).
2. `forced_alignment(audio_url, transcript)` → per-word timings (job; read `output_data.alignment`). The transcript MUST be the exact narration script. Costs 3 credits.
3. `resolve_shot_sequence(brief, audio_url, alignment)` → a render-ready plan (synchronous; returns the plan inline + any warnings). No credits.
4. `render_shot_sequence(plan)` → an MP4 (job; appears in your library). Costs 5 credits (standard render fee).

## Authoring a brief

A brief has a `narration` (script + cues), and `scenes → shots → reveals`. A
**cue** is a contiguous phrase of the script; a **reveal** anchors an element to
a cue:

```json
{
  "fps": 30, "width": 1920, "height": 1080, "backgroundColor": "#0b0b0f",
  "narration": {
    "script": "Ship faster. Nodaro turns your idea into video.",
    "cues": [
      { "id": "c_ship", "text": "Ship faster" },
      { "id": "c_idea", "text": "your idea into video" }
    ]
  },
  "scenes": [
    {
      "id": "scene_hook",
      "shots": [{
        "id": "shot_1",
        "reveals": [
          {
            "id": "rv_title",
            "element": { "id": "t1", "type": "text", "text": "Ship faster", "fontFamily": "Inter", "fontSize": 120, "fontWeight": 900, "color": "#ffffff", "x": 200, "y": 450 },
            "revealAt": { "kind": "cue", "cueId": "c_ship", "edge": "start" },
            "enter": { "motion": "slide-up", "durationFrames": 12, "easing": "easeOut" }
          }
        ]
      }]
    }
  ]
}
```

### Anchors

- `{ "kind": "cue", "cueId": "...", "edge": "start" | "end", "offsetMs"?: number }` — reveal at the start (or end) of the cue's spoken phrase, optionally nudged by `offsetMs`.
- `{ "kind": "frame", "frame": 0 }` — a fixed frame, for non-narrated elements (an intro logo, an outro). For a frame-0 poster element, use `"enter": { "motion": "none", "durationFrames": 0 }` so it's opaque on the thumbnail.

### Element lifetime

An element unmounts at its scene's content end — if you want it to persist visibly through the rest of the scene, set `hold` (frames to keep it on-screen after the entrance finishes) and/or `exit` (an exit motion that plays after `hold`).

### Rules that keep it deterministic

- **Cues must be whitespace-exact substrings of the script.** Write spoken forms — "twenty twenty-six", not "2026"; "five dollars", not "$5".
- **Scene cue spans must not interleave.** Each scene owns a contiguous time window; if two scenes' reveals overlap in time, resolve returns `422 scene_overlap`. Keep one scene's reveals before the next scene's.
- **Fonts** must be one of the 20 supported families: Inter, Roboto, Open Sans, Montserrat, Poppins, Raleway, Nunito, Lato, Playfair Display, Merriweather, Lora, EB Garamond, Bebas Neue, Oswald, Anton, Dancing Script, Pacifico, Caveat, Roboto Mono, Fira Code.
- **Entrance motions:** `fade`, `scale-up`, `wipe-in`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `none`.
- **Exit motions:** `fade`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `none`.

## Blueprint catalog

Six parameterised shot-shapes ("blueprints") cover the most common beat roles.
Use `list_shot_shapes` to browse the catalog and `get_shot_shape` to inspect a
blueprint's exact param contract before writing a `blueprint` reveal in a brief.

Blueprints are **text/shape only** — they carry no pricing or credit information.
The standard render-video credit (5 credits) applies to the overall
`render_shot_sequence` call, not to individual blueprints.

| Id | Roles | Default duration (frames) | What it does |
|----|-------|--------------------------|--------------|
| `kinetic-type-beats` | hook | 150 | 1–4 statement lines swap in by hard-cut/scale-pop; final line spring-pops on an accent. |
| `dataviz-countup` | pain_point | 240 | A big number counts up to a value with a label; numbers are the hero. |
| `grid-card-assemble` | feature_showcase, benefit_highlight | 180 | N text cards cascade-assemble into a grid with a staggered entrance. |
| `titlecard-reveal` | benefit_highlight | 120 | One clean title (+ optional subtitle) revealed with one restrained move, then held. |
| `logo-assemble-lockup` | product_intro, branding | 180 | Brand word's letters cascade/assemble into a centered lockup (+ optional tagline). |
| `cta-morph-press` | cta | 150 | A CTA button appears centered; a cursor decelerates in and presses it. |

### `list_shot_shapes()`

Returns the full blueprint catalog as a JSON array. Each entry:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blueprint identifier (kebab-case) |
| `roles` | string[] | Beat roles this blueprint suits (from the doctrine vocabulary) |
| `description` | string | One-line description |
| `defaultDurationFrames` | number | Default scene duration at 30 fps |

No inputs, no scope gate, no credits.

---

### `get_shot_shape(id)`

Returns detailed information for one blueprint.

**Inputs:**

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Blueprint id, e.g. `"titlecard-reveal"`. Call `list_shot_shapes` to browse all ids. |

**Returns** (JSON):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blueprint id |
| `roles` | string[] | Beat roles |
| `description` | string | Description |
| `defaultDurationFrames` | number | Default duration |
| `paramSchema` | object | JSON Schema (OpenAPI 3) for the blueprint's `params` object |
| `example` | object | Filled worked-params example ready to paste into a `blueprint` reveal |

Unknown id → error result (`isError: true`) with the list of known ids.

No scope gate, no credits.

---

## Tool reference

### `forced_alignment(audio_url?, audio_asset_id?, transcript)`

Returns a `job_id`. Poll `get_job`; when complete, the alignment is in
`output_data.alignment` — an array of `[{ word, start, end }]` objects with
timings in **seconds**. Costs **3 credits**.

**Inputs:**

| Field | Type | Notes |
|-------|------|-------|
| `audio_url` | string (URL) | HTTPS URL to the narration audio. Either `audio_url` or `audio_asset_id` is required. |
| `audio_asset_id` | string (UUID) | Asset ID of an existing audio file. Either `audio_url` or `audio_asset_id` is required. |
| `transcript` | string | The exact narration script; must match the audio word-for-word. |

**Returns:** `{ job_id: string }`

---

### `resolve_shot_sequence(brief, audio_url, alignment)`

Pure function (synchronous). Resolves the brief into a render-ready plan by:
- Matching each cue to its word timings (from alignment)
- Converting cue-based reveal anchors to exact frame numbers
- Validating scene temporal non-overlap
- Returning any warnings (e.g. unmatched cue fallback)

No credits.

**Inputs:**

| Field | Type | Notes |
|-------|------|-------|
| `brief` | object | The `ShotSequenceBrief` — narration, scenes, shots, reveals |
| `audio_url` | string (URL) | HTTPS URL to the narration audio (for reference; not re-fetched) |
| `alignment` | array | The `[{ word, start, end }]` array from `forced_alignment` output_data |

**Returns:**

```json
{
  "plan": { ... },
  "warnings": [
    "Cue 'c_id' not found in transcript; reveals fall back to proportional timing"
  ]
}
```

If scenes interleave in time, returns HTTP 422 `scene_overlap`.

---

### `render_shot_sequence(plan)`

Renders the resolved plan into an MP4 video. Returns a `job_id`; the finished
MP4 appears in your library. Costs **5 credits** (the standard render fee for
Remotion videos).

**Inputs:**

| Field | Type | Notes |
|-------|------|-------|
| `plan` | object | The resolved plan from `resolve_shot_sequence` |

**Returns:** `{ job_id: string }`

---

## Example workflow

```
1. Author a narration script and brief
   "Ship faster. Nodaro turns your idea into video."
   (declare cues, scenes, shots, reveals, fonts, motions)

2. Call generate_speech(script) → get audioUrl
   Wait for job to complete

3. Call forced_alignment(audioUrl, script) → get alignment
   Wait for job; extract output_data.alignment

4. Call resolve_shot_sequence(brief, audioUrl, alignment) → get plan
   Returns immediately; check warnings

5. Call render_shot_sequence(plan) → render
   Wait for job; download MP4 from library
```

## Related

- [MCP Tools Reference](./tools.md)
- [Film Director Skill](./film-director.md)
- [Connecting Claude.ai](./connecting-claude.md)
- [Troubleshooting](./troubleshooting.md)
