# Transition

> Specify a cinematic transition between frames or shots for connected AI video generation nodes.

## Overview

The Transition parameter node defines a transition effect to apply within AI-generated video clips — how the visual handoff between a start frame and an end frame should play out. Examples: cross-dissolve, fast-forward day-to-night, dissolve to mist, zoom into eye, smash-cut + white-flash. The transition is described as natural-language prompt text and injected into the consumer video node's generation prompt via the standard cinematography pipeline.

Unlike the `transition` field on the Combine Videos node (which is an FFmpeg post-process operation between two finished clips), the Transition parameter node is **diegetic** — it instructs the AI video model to actually generate the transition frame-by-frame inside a single shot.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transition | multi-select | `"auto"` | Catalog entry id, or array of 1-2 ids for compound transitions (e.g., `["smash-cut","white-flash"]`). |
| Position | select | `"auto"` | Where in the clip the transition occurs: `auto` / `start` / `middle` / `end` / `full`. |
| Duration | select | `"auto"` | How long the transition lasts: `auto` / `instant` / `short` (~1s) / `medium` (~2s) / `long` (~3s). |
| Intensity | select | `"auto"` | Energy/character of the transition: `auto` / `subtle` / `natural` / `dynamic` / `crazy`. |
| Pre Text | text | empty | Free-form text prepended to the composed hint. |
| Post Text | text | empty | Free-form text appended to the composed hint. |

All four enum fields default to `auto`, which contributes no prompt text. Setting them to non-`auto` values appends descriptive clauses to the composed hint.

## Catalog (76 entries across 8 categories)

| Category | Examples | Theme |
|---|---|---|
| **Standard** (11) | cross-dissolve, fade-to-black, match-cut, smash-cut, iris, wipe, roll, seamless-match | Classical editing transitions described frame-by-frame for AI rendering |
| **Time & Temporal** (8) | fast-forward (day→night, night→day), seasonal-shift, aging, rewind, weather-shift, flashback | Compressed-time shifts; same scene at different times |
| **Element & Teleport** (14) | dissolve-to-mist, water-splash, sand-storm, fire-burnup, smoke-puff, lightning-flash, ink-splash, sakura-petals, aurora-sweep, magic-sparkles, paint-splash, powder-burst, garden-bloom | Subject dissolves into a natural element and reforms |
| **Morph & Shape-shift** (9) | liquid-morph, pixelate-reform, shatter-glass, origami-fold, vortex-swirl, dream-ripple, wireframe-morph, polygon-shatter, melt-down | Continuous deformation of subject A into subject B |
| **Portal & Inside** (10) | zoom-into-eye, zoom-into-mirror, zoom-into-screen, zoom-into-book, walk-through-door, fall-into-hole, pull-out-reveal, zoom-into-mouth, push-through-glass, soul-jump | Camera pushes into a feature of the subject and emerges in a new world |
| **Physics & Force** (9) | explosion-blast, shockwave, punch-into-camera, debris-shower, gravity-flip, building-explosion, vehicle-explosion, jump-match, hand-swipe | Impact-driven scene changes |
| **Light & Flash** (8) | white-flash, lens-flare-swipe, light-streak, color-invert, sun-glare, lens-crack, dirty-lens-wipe, eye-light-burst | Flash and lens FX |
| **Glitch & Digital** (7) | digital-glitch, vhs-rewind, datamosh, channel-flip, hologram-flicker, display-wipe, double-exposure | Digital corruption transitions |

Two defaults round out the catalog: `auto` (let the model choose) and `none` (hard cut).

## Multi-pick

Up to 2 transitions can be selected and compounded (`action-fx` parity). The composer joins their prompt hints with `", and "`. Examples:
- `["smash-cut", "white-flash"]` — a jarring smash cut blended with a camera-flash bloom.
- `["fast-forward-day-night", "color-invert"]` — time accelerates with a color-flip moment.

A `+` badge in the picker UI promotes a single selection into multi-pick mode; clicking the numbered badge demotes back.

## Graph-aware composition: `startState` / `endState` handles

The node has two input handles that accept any upstream parameter picker (Tone, Framing, Lighting, Camera Motion, Color Look, etc.):

- **`startState`** — describes the start frame's look/state. The composer folds it into the prompt as `"starting from <hints>"`.
- **`endState`** — describes the end frame's look/state. Composes as `"ending at <hints>"`.

Worked example with `fast-forward-day-night`, position=`end`, duration=`medium`, intensity=`dynamic`, startState wired to `[Tone: "warm golden morning light"]`, endState wired to `[Tone: "deep blue moonlit night"]`:

> *"fast-forward time-lapse transition: the sun visibly arcs across the sky, shadows sweep, clouds streak, sky shifts from daylight blue through golden hour to deep night, stars emerge, all while the framing and camera position remain locked on the same scene, the transition occurs at the end of the clip, lasting approximately 2 seconds, with dynamic energy and assertive flourish, starting from warm golden morning light, ending at deep blue moonlit night"*

## Inputs & Outputs

**Inputs:**
- `in` — optional upstream parameter input (rarely used).
- `startState` — optional, accepts a single parameter node (or chain) describing the start frame.
- `endState` — optional, same as `startState` for the end frame.

**Outputs:**
- `out` — composed prompt-hint clause, consumed by downstream AI video nodes (Image-to-Video, Text-to-Video, Video-to-Video, Motion Transfer, etc.) via their `cinematography` handle.

## Supported Providers

Not applicable. The Transition node has no provider call of its own — it emits prompt text that the downstream AI video generation provider interprets. Compatibility varies by provider:

| Provider | Compatibility |
|---|---|
| VEO 3 / VEO 3.1 | Excellent — best long-form coherence on morph and time transitions |
| Kling 2.1 / Kling Turbo | Very good on standard, light, glitch categories |
| Hailuo Standard / 2.3 | Good for standard + element transitions; morph quality varies |
| MiniMax | Limited — sticks closely to user prompt, may ignore exotic transitions |
| Seedance / Bytedance Lite | Hit-or-miss on morph and portal transitions |

## Best Practices

- Use `auto` (the default) when you want the model to choose a sensible transition based on the prompt context.
- Set `position` and `duration` together when you want the transition to occupy a specific portion of the clip — e.g., `position: end, duration: short` for a quick exit transition.
- Wire upstream Tone or Color Look nodes to `startState` / `endState` to give the model concrete visual targets for the transition's beginning and end states.
- Multi-pick (1-2 transitions) for stacking complementary effects: smash-cut + white-flash, match-cut + light-streak, freeze-frame + color-invert.
- The Transition node is automatically suppressed for still-image consumers (Edit Image, Image-to-Image, Generate Image) — a still cannot host a transition.

## Common Use Cases

- Adding intentional cinematic transitions to AI-generated reels and shorts.
- Building time-shift sequences (day-to-night, seasonal, aging) within a single video clip.
- Creating compounded transition effects (e.g., smash-cut + white-flash) for music videos and montages.
- Specifying transition timing and intensity for beat-aligned music-video edits.

## Tips

- The composer rewrites the prompt only when the transition id is non-`auto`. Leaving the default produces no change to downstream prompts.
- For 3+ compound effects, wire two Transition nodes in parallel into the consumer's cinematography handle — both contribute independently.
- The "Composed hint" preview in the config panel shows exactly what gets injected into the downstream prompt at execution time.
- Camera motion during the transition is handled by wiring a Camera Motion node into `startState` or `endState` — no dedicated camera field on the Transition node itself.

## See Also

- [Camera Motion](./camera-motion.md) — for overall clip camera movement (wires into Transition's start/end handles, or directly into video consumers).
- [Tone](./tone.md) — describes the emotional / visual tone of a frame, ideal for `startState` / `endState`.
- [Character FX](./character-fx.md) — applies effects to a character within a clip (different from transition between frames).
