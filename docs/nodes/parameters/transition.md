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
| Duration | select | `"auto"` | How long the transition lasts: `auto` / `instant` / `short` (~1s) / `medium` (~2s) / `long` (~3s). On a cut, only `short` on `seamless-match` or `jump-match` has an effect: it makes a blended cut (see below). |
| Intensity | select | `"auto"` | Energy/character of the transition: `auto` / `subtle` / `natural` / `dynamic` / `crazy`. Ignored for a cut (see below). |
| Direction | select | `"auto"` | **Wipe only** — shown while `wipe` is picked, stored as `wipeDirection`: `auto` / `left-to-right` / `right-to-left` / `top-to-bottom` / `bottom-to-top` / `top-left-to-bottom-right` / `top-right-to-bottom-left`. See [Wipe direction](#wipe-direction). |
| Style | select | the row's default look | **Styled rows only** (`debris-shower`, `garden-bloom`, `smoke-puff`, `sakura-petals`, `aurora-sweep`, `sand-storm`, `white-flash`) — shown while one is picked, stored as `style`. Each row has its own looks; the first is the row's default, labelled by its name ("Full cover (default)"). See [Style](#style). |
| Pre Text | text | empty | Free-form text prepended to the composed hint. |
| Post Text | text | empty | Free-form text appended to the composed hint. |
| Hint mode  | select       | `full`    | Does not change how the transition itself is written — always `<name> (<description>)` (see below). It still sets the detail level of the pickers wired into `startState` / `endState`. See [Prompt hint mode](./README.md#prompt-hint-mode). |

All the enum fields (Transition, Position, Duration, Intensity, the wipe's Direction and a row's Style) default to `auto`. For Position, Duration, Intensity and Direction, `auto` contributes no prompt text; Style's `auto` is the row's default look. Setting Position, Duration or Intensity appends a descriptive clause to the composed hint; Direction changes the wipe's own description, and Style swaps the row's whole description for another look.

Position, Duration and Intensity are catalogs, not free values: the `transition` picker catalog exposes them as `dimensions` beside its `options` (`GET /v1/picker-catalogs/transition`, `client.pickerCatalogs.get("transition")`, the MCP `get_picker_catalog` tool, or `TRANSITION_POSITIONS` / `TRANSITION_DURATIONS` / `TRANSITION_INTENSITIES` from `@nodaro/prompts`), each row carrying the exact clause it injects. The [Character FX](./character-fx.md) node has the same three fields with the same ids but its own wording — read each node's own rows. See [Parameter Picker Catalogs](../../picker-catalogs.md#single-dimension-pickers-with-secondary-parameters-transition-character-fx).

**How a transition reads in the video prompt.** Each picked transition is written as its short name followed by the full description of how it plays out, in parentheses: `<name> (<description>)`. For example, `whip pan (the camera whips sideways at high speed, smearing the frame into heavy horizontal motion blur, and the second shot enters already travelling in the same direction before it settles into its framing)`. The name alone was not enough for video models to perform the transition. The description does not repeat a leading heading: any "Heading:" of up to five words at the start of a description (for example `match cut:` or `whip pan transition:`) is removed, including on rows a catalog pack adds, and a transition whose description is only its name is written as the name alone. Position, Duration and Intensity follow the parentheses: `…), lasting approximately 1 second, with natural timing`. This is the same in both hint modes, and the same for a transition sent in the `direction` field of a video request. Transitions never reach image prompts.

**Inside a shot's time window.** When the transition is written into one shot of a multi-shot prompt (`0-2s — …`, `2-4s — …`), the Position wording refers to that shot, not the whole clip: `the transition occurs in the middle of this shot` instead of `… of the clip`, and `full` (on a transition that is not a cut) reads `the transition spans this entire shot` instead of `… the entire clip`. `@nodaro/prompts` callers opt in with `composeTransitionHintFromConnections(id, startHints, endHints, timing, mode, { scope: "shot" })`; without it the wording is the clip's.

**Cuts are worded as true hard cuts.** Eight transitions are cuts — the change happens between two frames: `none` (hard cut), `snap-to-black`, `match-cut`, `smash-cut`, `seamless-match`, `jump-cut`, `jump-match` and `action-relay`. When every picked transition is a cut:

- The parentheses end, once, with an explicit anti-blend instruction: `match cut (the last picture of the first shot and the first picture of the second share one shape, at the same place and the same size in the frame. The camera holds that shape in place across the cut. On the next frame everything around the shape has changed while the shape itself stays put. The shot ends on the second shot, fully resolved, with no flash frame or zoom between the two; an abrupt single-frame hard cut, no dissolve, crossfade or superimposition; the two images never blend)`. Without it, video models often render a cut as a short dissolve. With two cuts picked, the instruction appears once, in the first one's parentheses — the part of the prompt kept longest when a long prompt has to be shortened for a model's length limit.
- Duration and Intensity add no clause to the prompt. Both describe how a transition plays out over time ("lasting approximately 1 second", "with natural timing"), and on a cut either one makes video models blend the two images instead of cutting. (On `seamless-match` and `jump-match`, Duration `short` changes the cut itself instead: see **Blended cut** below.)
- Position still applies — where the cut lands is a real choice — except `full`: a single-frame cut cannot span the whole clip, so `full` adds nothing to the prompt. `start`, `middle` and `end` still place the cut.
- **Blended cut.** On `seamless-match` and `jump-match`, Duration `short` replaces the anti-blend instruction with `instead of a hard cut, the two shots blend into each other over about 1 second` ("about 1 second" is the `short` row's own wording): `invisible cut (the camera motion, color palette, and on-screen motion at the end of the first shot continue exactly across the cut into the second shot, so the boundary is invisible and the two shots feel like one unbroken take; instead of a hard cut, the two shots blend into each other over about 1 second)`. Everything else stays as on a hard cut: Position still applies, `full` adds nothing, and there is no duration or intensity clause. Every other Duration on these two (`auto`, `instant`, `medium`, `long`), and any Duration on the other six cuts, keeps the hard cut. Picked together, the two rows blend, with the sentence once, in the first one's parentheses; picked with any other cut, they stay a hard cut. A transition sent in the `direction` field of a video request has no Duration, so it is always a hard cut.

When two transitions are picked and only one is a cut, no anti-blend instruction is added and Duration and Intensity are kept.

In the editor, the Transition panel offers only the controls a pick takes: on a cut, Position without `full` and no Intensity; on `seamless-match` and `jump-match`, Duration as **Blend** — **Hard cut** (stored as `auto`) or **Short (~1s)**; on the other six cuts, no Duration at all. A value saved earlier that a cut ignores (`full`, or `medium` on `seamless-match`) stays on the node and is shown as what it renders: Auto, or Hard cut. Changing the pick follows one rule. Switching from a pick that is not all cuts (a transition that is not a cut, two transitions of which only one is a cut, or nothing picked, `auto` included) to a pick that is all cuts (one cut, or two) clears Duration and Intensity: they timed and shaped the transition being left, and a Short carried over would turn `seamless-match` or `jump-match` into a blend nobody chose. Every other change keeps every setting as it was, including clearing the pick: from all cuts to all cuts, from all cuts to a pick that is not all cuts, and from one pick that is not all cuts to another.

For clients: the `@nodaro/prompts` picker catalog (`getPickerCatalog("transition")`) marks the cut rows `instant: true`, the two blendable rows `blendable: true`, and the duration step that blends them (`short`) `blendsCut: true`; `@nodaro/prompts` also exports `isInstantTransition`, `isBlendableTransition` and `blendedCutClause`. A client hides Intensity and Position `full` on a cut, and offers Duration as Blend (Hard cut / Short) only on the blendable rows. The flags are on the `@nodaro/prompts` catalog only: `GET /v1/picker-catalogs/transition` and the MCP `get_picker_catalog` tool do not carry them, `instant` included.

<a id="wipe-direction"></a>

**Wipe direction.** The `wipe` transition has one extra setting of its own, **Direction**, stored on the node as `wipeDirection`. It changes the words inside the wipe's parentheses and nothing else — the levers still follow them:

| `wipeDirection` | The wipe as the prompt reads it |
|---|---|
| `auto` (or absent) | `linear wipe (a clean straight edge sweeps across the frame, revealing the second shot behind it)` |
| `left-to-right` | `linear wipe (a clean vertical edge sweeps across the frame from left to right, revealing the second shot behind it)` |
| `right-to-left` | `linear wipe (a clean vertical edge sweeps across the frame from right to left, revealing the second shot behind it)` |
| `top-to-bottom` | `linear wipe (a clean horizontal edge sweeps down the frame from top to bottom, revealing the second shot behind it)` |
| `bottom-to-top` | `linear wipe (a clean horizontal edge sweeps up the frame from bottom to top, revealing the second shot behind it)` |
| `top-left-to-bottom-right` | `linear wipe (a clean diagonal edge sweeps across the frame from the top-left corner to the bottom-right corner, revealing the second shot behind it)` |
| `top-right-to-bottom-left` | `linear wipe (a clean diagonal edge sweeps across the frame from the top-right corner to the bottom-left corner, revealing the second shot behind it)` |

A wipe saved before Direction existed reads as `auto`. The picker catalog publishes the rows on the `wipe` option as `params` (see [Per-option parameters](../../picker-catalogs.md#per-option-parameters-a-wipes-direction)); `@nodaro/prompts` callers pass the choice as `composeTransitionHintFromConnections(id, startHints, endHints, timing, mode, { optionValues: { wipeDirection: "left-to-right" } })`. A wipe sent in the `direction` field of a video request has no direction setting and reads as `auto`.

<a id="style"></a>

**Style.** Seven rows have more than one tested look, offered as **Style** and stored on the node as `style`. A style replaces the row's whole description inside the parentheses; the row's name and the levers stay as they are. The field is shared, but every row declares its own looks, and every id except `auto` starts with the row's id, so a style never carries over to another row: a value that is not one of the picked row's looks reads as the default.

| Row | Style | `style` | What it looks like |
|---|---|---|---|
| `smoke-puff` | Engulf (default) | `auto` (or absent) | Smoke billows up around the subject, and the new subject appears inside it |
| `smoke-puff` | Full cover | `smoke-puff-full-cover` | Smoke from the subject fills the whole screen, then clears on the next scene |
| `sand-storm` | Full cover (default) | `auto` (or absent) | A wall of sand hides the whole picture, then clears on the next scene |
| `sand-storm` | Light sweep | `sand-storm-light-sweep` | A streak of blown sand crosses the screen with the next scene already behind it |
| `aurora-sweep` | Sky glow (default) | `auto` (or absent) | Aurora light glows over the scene, then fades to reveal the next one |
| `aurora-sweep` | Veil | `aurora-sweep-veil` | Aurora curtains drop over the whole picture, then fade to reveal the next scene |
| `sakura-petals` | Swirling veil (default) | `auto` (or absent) | A swirl of pink petals veils the picture, then drifts past |
| `sakura-petals` | Side sweep | `sakura-petals-side-sweep` | Petals sweep across from one side and leave by the other, uncovering the next scene |
| `garden-bloom` | Grow & part (default) | `auto` (or absent) | Flowers and vines grow over the picture, then part like curtains on the next scene |
| `garden-bloom` | Hedge doors | `garden-bloom-hedge-doors` | Leafy panels close over the picture, then slide apart to the sides |
| `debris-shower` | Full cover (default) | `auto` (or absent) | Debris fills the whole screen, then blows past to reveal the next scene |
| `debris-shower` | Light sweep | `debris-shower-light-sweep` | A quick scatter of debris crosses the screen; the scene has changed behind it |
| `white-flash` | Flash (default) | `auto` (or absent) | A camera flash pops the picture to white, holds, then fades down on the next scene |
| `white-flash` | Overexposure | `white-flash-overexposure` | The picture blooms to white and resolves into the next scene |

A pick saved before Style existed has no `style` and reads as the row's default look. The picker catalog publishes each row's looks on its option as `params` (field `style`); `@nodaro/prompts` callers pass the choice as `composeTransitionHintFromConnections(id, startHints, endHints, timing, mode, { optionValues: { style: "debris-shower-light-sweep" } })`. On the canvas, a two-pick of two styled rows shows one Style control holding both rows' looks, its first entry named "Default look" (each row keeps its own default); the one stored value styles its own row, and the other row keeps its default. A row sent in the `direction` field of a video request has no style setting and reads as its default.

## Catalog (82 entries across 8 categories)

| Category | Examples | Theme |
|---|---|---|
| **Standard** (14) | cross-dissolve, fade-to-black, fade-to-white, snap-to-black, match-cut, smash-cut, jump-cut, whip-pan, iris, wipe, roll, seamless-match | Classical editing transitions described frame-by-frame for AI rendering |
| **Time & Temporal** (8) | fast-forward (day→night, night→day), seasonal-shift, aging, rewind, weather-shift, flashback | Compressed-time shifts; same scene at different times |
| **Element & Teleport** (14) | dissolve-to-mist, water-splash, sand-storm, fire-burnup, smoke-puff, lightning-flash, ink-splash, sakura-petals, aurora-sweep, magic-sparkles, paint-splash, powder-burst, garden-bloom | Subject dissolves into a natural element and reforms |
| **Morph & Shape-shift** (9) | liquid-morph, pixelate-reform, shatter-glass, origami-fold, vortex-swirl, dream-ripple, wireframe-morph, polygon-shatter, melt-down | Continuous deformation of subject A into subject B |
| **Portal & Inside** (12) | zoom-into-eye, zoom-into-mirror, zoom-into-screen, zoom-into-book, zoom-through, walk-through-door, mask-transition, fall-into-hole, pull-out-reveal, zoom-into-mouth, push-through-glass, soul-jump | Camera pushes into a feature of the subject and emerges in a new world |
| **Physics & Force** (10) | explosion-blast, shockwave, punch-into-camera, debris-shower, gravity-flip, building-explosion, vehicle-explosion, jump-match, action-relay, hand-swipe | Impact-driven scene changes |
| **Light & Flash** (8) | white-flash, lens-flare-swipe, light-streak, color-invert, sun-glare, lens-crack, dirty-lens-wipe, eye-light-burst | Flash and lens FX |
| **Glitch & Digital** (7) | digital-glitch, vhs-rewind, datamosh, channel-flip, hologram-flicker, display-wipe, double-exposure | Digital corruption transitions |

Two defaults round out the catalog: `auto` (let the model choose) and `none` (hard cut).

## Multi-pick

Up to 2 transitions can be selected and compounded (`action-fx` parity). Each is written as `<name> (<description>)` and the two are joined with `", and "`. Examples:
- `["smash-cut", "white-flash"]` — a jarring smash cut blended with a camera-flash bloom.
- `["fast-forward-day-night", "color-invert"]` — time accelerates with a color-flip moment.

A `+` badge in the picker UI promotes a single selection into multi-pick mode; clicking the numbered badge demotes back.

## Graph-aware composition: `startState` / `endState` handles

The node has two input handles that accept any upstream parameter picker (Tone, Framing, Lighting, Camera Motion, Color Look, etc.):

- **`startState`** — describes the start frame's look/state. The composer folds it into the prompt as `"starting from <hints>"`.
- **`endState`** — describes the end frame's look/state. Composes as `"ending at <hints>"`.

Worked example with `fast-forward-day-night`, position=`end`, duration=`medium`, intensity=`dynamic`, startState wired to `[Tone: "warm golden morning light"]`, endState wired to `[Tone: "deep blue moonlit night"]`:

> *"day-to-night time-lapse (the same view with framing locked while hours pass in seconds: light and shadows sweep across the scene, daylight warms to dusk and fades to night, lights come on, until the picture matches the end frame), the transition occurs at the end of the clip, lasting approximately 2 seconds, with dynamic energy and assertive flourish, starting from warm golden morning light, ending at deep blue moonlit night"*

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
