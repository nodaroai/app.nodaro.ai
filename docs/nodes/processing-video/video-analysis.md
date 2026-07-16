# Video Analysis

> Break a video down scene-by-scene into a prompt-ready, AI-recreatable JSON breakdown — segmented shots, layered audio, and castable entity slots.

## Overview

The Video Analysis node ingests a video and returns a structured, scene-segmented
breakdown built for AI re-creation. It cuts the video at natural boundaries into
scenes of **at most 8 seconds** (one image/video generation maps to one scene),
and for each scene emits a self-contained visual description, shot type, camera
movement, its concurrent audio layers, and any transition out. Recurring
people, objects, and places are lifted out as reusable **entity slots** so a
scene can later be re-cast onto your own characters, objects, or locations.

- **Scene-segmented** — every scene is a single castable shot. A scene that
  genuinely can't be cut to 8 seconds or less is kept whole and flagged
  `oversized` (see [Output](#output)).
- **Windowed for long videos** — videos up to 180 seconds are analyzed in a
  single pass. Longer videos (up to the 10-minute cap) are analyzed in
  overlapping ~150-second windows (5s overlap) and merged into one continuous,
  renumbered result.

## Inputs & Outputs

**Inputs:** Video (optional handle) — a wired upstream video, or a YouTube URL
set in config.
**Outputs:** Analysis JSON (`meta` + `slots` + `scenes[]`) on the `json` output
handle. The full result is also stored in the job's `output_data`.

### Source precedence

You provide the source one of two ways:

- **Wired video** — connect any video producer to the node's video input.
- **YouTube URL** — set `youtubeUrl` in the node config.

**Precedence, not exactly-one:** a wired video input **always wins**. A stale
`youtubeUrl` left in config alongside a wired video never rejects the run and is
ignored — the wired video is analyzed. YouTube URLs must be `youtube.com` /
`youtu.be` hosts; **live streams are rejected** (wait for the stream to end and
the VOD to become available). Any source is capped at **10 minutes (600s)**.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Analysis Quality (`llmModel`) | Select | `pro` | `fast` (economy) or `pro` (default — higher fidelity, costs more; see [Credit Cost](#credit-cost)) |
| Result Selection (`selectionMode`) | Select | `choose` | `choose` — keep the strongest of several analysis passes. `combine` — keep the strongest pass, then fold in details from the other passes that are verified against the footage (slightly slower, most complete) |
| Analysis Focus (`analysisFocus`) | Text (≤2000 chars) | — | Steer what the model pays attention to, e.g. "focus on the product shots and on-screen text" |

**Two quality tiers, no model to pick.** You choose a *tier* — `fast` for an
economy pass or `pro` for higher fidelity — not a specific model. The underlying
analysis model is selected for you (Video Analysis requires native video *and*
audio understanding, which only a subset of models provide) and is intentionally
not surfaced, so a tier's backing model can improve over time without changing
your workflow.

**Result Selection.** Every run analyzes the video several times and grades the
passes. `choose` keeps the single strongest pass. `combine` additionally reviews
the discarded passes for details the winner missed (named places, on-screen
text, brands, extra audio layers), re-checks each one against the actual
footage, and folds in only what is confirmed — the scene timeline itself is
never altered. `combine` never produces less than `choose`: if the extra pass
fails or degrades the result, the strongest pass is kept as-is.

**Analysis Focus steers attention, never format.** It biases what the model
attends to; it does **not** change the output JSON shape, the ≤8s scene
segmentation, or the field set. Leave it empty for a general-purpose breakdown.

## Output

The result validates against the shared `videoAnalysisResultSchema`
(`packages/shared/src/video-analysis.ts`) — the single source of truth for this
contract. Three top-level keys: `meta`, `slots`, and `scenes[]`.

### `meta`

| Field | Type | Description |
|-------|------|-------------|
| `durationSec` | number | Probed video duration in seconds. |
| `width` | integer | Frame width in pixels. |
| `height` | integer | Frame height in pixels. |
| `aspectRatio` | string | Snapped to a standard ratio (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`) when within 3%, otherwise a reduced `w:h`. |
| `title` | string, optional | Source title when known (e.g. the YouTube video title). |
| `language` | string, optional | Dominant spoken language when detected. |

### `slots[]` — castable entity slots

Recurring people / objects / places extracted once so they can be re-cast with
your own entities.

| Field | Type | Description |
|-------|------|-------------|
| `slotId` | string | Stable lowercase-hyphen id, referenced from a scene's `visual` as `{slot:<slotId>}`. |
| `label` | string | Human-readable name for the recurring entity. |
| `source` | enum | Entity family this slot casts from: `wired-character` / `wired-object` / `wired-location` / `wired-creature`. |
| `role` | string | The entity's role in the video (e.g. "narrator", "hero product"). |
| `description` | string | Self-contained visual description used to render the slot when no cast entity is bound. |

### `scenes[]`

| Field | Type | Description |
|-------|------|-------------|
| `sceneNumber` | integer | 1-based scene index across the whole video. |
| `startSec` | number | Scene start in seconds. |
| `endSec` | number | Scene end in seconds (`endSec > startSec`). |
| `label` | string | Short scene label. |
| `shotType` | string | e.g. "wide", "close-up", "over-the-shoulder". |
| `camera` | string | Camera movement (may be empty for a locked-off shot). |
| `visual` | string | Raw visual description carrying `{slot:<id>}` tokens for future casting — **not the field to render from**. |
| `visualResolved` | string | Self-contained, prompt-ready visual description — **the field downstream consumers read**. |
| `oversized` | boolean, optional | Present and `true` when the scene exceeds 8 seconds (couldn't be cut shorter). Still one generation per scene. |
| `transitionOut` | enum, optional | Transition into the next scene: `cut` / `fade` / `wipe` / `whip`. |
| `audio` | array | Concurrent audio layers (empty array `[]` = silence) — see below. |
| `slotRefs` | string[] | Slot ids referenced by this scene, derived from its `visual` `{slot:x}` tokens. |

**`audio`** — an **array of concurrent sound layers**. Real footage stacks sound
(a music bed under dialogue over ambient sfx), so a scene captures every
simultaneous layer as its own entry: a music bed + a sung vocal + a water splash
is three entries. An **empty array `[]` means genuine silence** — there is no
`silence` mode. Each layer:

| Field | Type | Description |
|-------|------|-------------|
| `mode` | enum | `speech` / `music` / `sfx`. |
| `content` | string | `speech`: verbatim words; `music` / `sfx`: generation-ready description. |
| `voice` | string, optional | Speaker / voice descriptor — `speech` layers only. |

**Read `visualResolved`, not `visual`.** `visual` retains `{slot:x}` tokens so
the scene can be re-cast onto your own characters / objects / locations later;
`visualResolved` is the token-expanded, self-contained version and is the field
every downstream consumer should render from today.

## Credit Cost

Video Analysis is **dynamically priced** by duration bucket and quality tier. The
bucket is the smallest of **60s / 180s / 360s / 600s** that fits the video's
probed duration; each tier has its own per-bucket price. The table below is
published as `VIDEO_ANALYSIS_BUCKET_CREDITS` in
`packages/shared/src/video-analysis-pricing.ts` (the credit prices users are
charged) — generated and drift-guarded internally, never hand-written.

| Tier | ≤60s | ≤180s | ≤360s | ≤600s |
|------|------|-------|-------|-------|
| `fast` (economy) | 1 | 1 | 2 | 3 |
| `pro` (default) | 2 | 3 | 7 | 11 |

> These values are the internal pricing formula's current outputs, with the
> formula's token and rate constants anchored to live billing measurements.

Longer videos cost more because they are analyzed in more overlapping windows (a
video over 180s is split into ~150-second windows), and the `pro` tier costs
more per token than the `fast` tier.

**±3-second duration tolerance.** Credits are reserved up front from the bucket
that fits the probed (metadata) duration. After download, the worker re-probes
the true duration and re-checks the bucket with a **±3-second grace**
(`VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC`) — `ffprobe` floats routinely run a
fraction of a second over a nominal length, and zero tolerance would wrongly
bump a genuine 1:00 / 3:00 / 6:00 / 10:00 video into the next (pricier) bucket.

**Missing-duration fallback.** If the duration can't be determined at submit
time, the ceiling bucket (≤600s) price is reserved. In practice the route probes
duration first and rejects un-probeable sources, so this fallback is only a
safety net.

## Limits

- **Maximum duration:** 600 seconds (10 minutes) for any source. Enforced
  strictly at submit time, then re-checked worker-side after download (±3s
  grace, as above).
- **YouTube hosts only:** `youtube.com` / `youtu.be`. Other URL hosts are
  rejected.
- **No live streams:** a YouTube live stream is rejected up front — analyze the
  VOD once the stream ends.
- **Windowing:** videos over 180 seconds are analyzed in overlapping ~150-second
  windows (5s overlap) and merged; ≤180s runs as a single pass.

## Best Practices

- The default `pro` tier suits most breakdowns — higher-fidelity scene and entity
  detail. Drop to the `fast` tier for a cheaper, quicker pass when you can trade
  some fidelity.
- Set **Analysis Focus** to bias the model toward what matters for your
  re-creation (product shots, on-screen text, a specific character) — but don't
  expect it to change the JSON shape.
- Render scenes from `visualResolved`. Only touch `visual` / `slotRefs` if you
  are building a casting layer that re-binds `{slot:x}` tokens to your own
  entities.

## Common Use Cases

- Reverse-engineer a reference video into a shot-by-shot recreation plan.
- Extract a reusable cast of entity slots from a video to re-shoot with your own
  characters, objects, and locations.
- Produce prompt-ready per-scene descriptions to feed image/video generation
  nodes.
- Pull each scene's layered audio (speech quotes plus music/sfx descriptions —
  every concurrent layer) for a matching soundtrack pass.
