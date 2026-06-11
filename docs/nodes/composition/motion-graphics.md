# Motion Graphics
> AI-generated 2D motion graphics including lower thirds, title cards, kinetic typography, and animated shapes.

## Overview
The Motion Graphics node uses an LLM to generate a plan for 2D motion graphics compositions. It supports lower thirds, title cards, kinetic typography, animated shapes, and SVG path animations. A live preview is available in the config panel. Maximum duration is 60 seconds.

The node ships with two **engines** (see below). The default **Classic** engine produces a compact elements DSL rendered with pure Remotion primitives and a built-in `FONT_MAP`. The **Lottie** engine instead has the LLM author a complete Lottie animation.

## Engines

The **Engine** field selects how the composition is authored. It does not change the inputs, outputs, or the rendering pipeline downstream (both engines emit a `composition` plan that connects to a Render Video node).

| Engine | Value | What it does |
|--------|-------|--------------|
| **Classic (elements)** | `elements` (default) | The original behavior. The LLM returns a compact elements DSL (text, shapes, SVG paths, transitions) that the renderer maps to Remotion primitives. Synchronous and fast. |
| **Lottie (AI-authored)** | `lottie` | The LLM authors a complete [Lottie](https://lottiefiles.com/) animation with **named, editable slots**. Choose this for richer, hand-animation-style motion. |

**Lottie engine specifics:**

- **Asynchronous generation.** Running the node enqueues a job; the authored plan arrives when the job completes (unlike the Classic engine, which returns inline). The live preview updates once the plan is ready.
- **Vector-only.** The animation may not reference image assets — image-backed plans are rejected and regenerated. Shapes, paths, gradients, and text are all supported.
- **Expressions are stripped.** Any Lottie expressions are removed server-side for security before the plan is accepted.
- **Text uses a font safelist.** Text layers are limited to a 20-font Google Fonts safelist that the renderer self-hosts; unknown font families are snapped to **Inter**.
- **Size caps.** A plan may contain at most **50 layers** and serialize to at most **128 KB**. Plans exceeding these caps are rejected.
- The authored animation contains **named slots** (e.g. a primary color, a headline string) that later enable free, no-credit edits.

> The default background is fully transparent (`#00000000`) for both engines, so motion graphics layer cleanly over other video.

### Slot editing

Once a Lottie plan is generated, its named slots appear as controls in the node's config panel (under a **Slots** section, below the preview). Colors render as a color picker, text as a text field, and numeric/point slots as number inputs. Each control shows a reset affordance once you've changed it.

These edits are **free** — they adjust the existing plan in place, so there are **no credits** and **no regeneration**. The preview updates live as you edit.

Slot names stay **stable across regenerations**: when you re-run the node, the engine is told to keep the existing slot names, so your adjustments survive a regeneration rather than being discarded.

**Exposing slots as app inputs:** when this node is added as an input in the publish dialog, each slot becomes an editable field (color / text / number) in the published app and in presentation mode. End-users adjust them per run without regenerating — the same free, no-credit edit, surfaced to your app's audience. See the [embed-app guide](../../embed-app-guide.md#lottie-slot-fields-slotsid) for the override mechanics.

## Presets

The node ships a curated **factory preset catalog** — 22 presets across six folders, **all targeting the Lottie engine**. Each preset is a complete art-direction brief that pre-fills the prompt, aspect ratio, duration, and background, and declares the **stable, editable slots** it exposes (a brand color, a name string, etc.) so your edits survive regeneration and surface as fields in published apps.

| Folder | What's inside |
|--------|---------------|
| **Titles & Text** | Lower Third, Title Card, Kinetic Typography, Quote Card, End Card (CTA) — name/role, headline/subtitle, and CTA cards with staggered entrances and clean exits. |
| **Intros & Logos** | Logo Sting, Channel Intro, Countdown — punchy brand reveals with anticipation/overshoot, plus a keyframed 5→1 ring countdown. |
| **Social & CTA** | Subscribe Reminder, Like + Follow Bug, Sale Badge, Story Highlight — transparent overlays and a vertical (9:16) story card for short-form. |
| **UI & Icons** | Loader / Spinner, Success Check, Error Cross, Progress Bar, Notification Pop — draw-on / trim-path UI states, mostly square and transparent. |
| **FX Overlays** | Confetti Burst, Sparkle Shimmer, Speed Lines — particle-style overlays (built with repeaters to stay light), all transparent for compositing. |
| **Backgrounds** | Gradient Blob Loop, Geometric Pattern Loop — 8-second seamless looping backdrops on an opaque dark fill. |

Overlay presets set a transparent background (`#00000000`); standalone presets (title cards, intro, countdown, backgrounds) set an opaque dark background. Text slots ship placeholder copy (e.g. "Jane Doe", "SUBSCRIBE") for you to retype.

Selecting a preset **overwrites** the prompt and canvas settings (engine, aspect ratio, duration, background) and **clears any previously generated plan**, so the old animation never lingers under the new prompt. After generating, tweak the named slots for free (no credits, no regeneration). The full catalog is documented in the [Presets reference](../presets.md#motion-graphics-factory-catalog).

## Pricing

Credits follow the standard LLM formula:

```
credits = [formula removed]
```

evaluated at each engine's typical token profile. The Lottie engine authors a much larger payload than the elements DSL, so it costs more at the same tier.

| Engine | Tier | Credits |
|--------|------|---------|
| Classic (elements) | Economy | 1 |
| Classic (elements) | Standard | 2 |
| Classic (elements) | Premium | 3 |
| Lottie | Economy | 1 |
| Lottie | Standard | 5 |
| Lottie | Premium | 8 |

The tier is determined by the selected LLM model (Economy / Standard / Premium).

**Worked example (Lottie, Standard).** Standard tier uses `claude-sonnet-4.6` (\$3 / 1M input tokens, \$15 / 1M output tokens). A Lottie author call runs at roughly **3K input + 4K output** tokens:

```
providerCost = (3,000 × $3 + 4,000 × $15) / 1,000,000 = $0.069
$0.069 × 1.25 = $0.086
$0.086 / $0.02 = 4.3   →   ceil   →   5 credits
```

**Elements sanity check.** The Classic engine returns a much smaller plan (~1.5K output tokens on the same Standard model), which works out to ≈1.5 → **2 credits** — the existing Classic Standard price.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Engine | enum | `"elements"` | Authoring engine. Options: `elements` (Classic — elements DSL), `lottie` (AI-authored Lottie with named slots). See [Engines](#engines). |
| Motion Graphics Prompt | string | `""` | Natural language description of the desired motion graphics. An info guide is available in the UI for prompt tips. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `5` | Duration of the output. Range: 1--60 seconds (hard maximum). |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#00000000"` | Background color. Supports alpha channel for transparency (8-digit hex). Default is fully transparent. |

## Inputs & Outputs

**Inputs:**
- `in` -- Optional input for context or reference data.

**Outputs:**
- `composition` -- Motion graphics plan (JSON). Connect to a Render Video node for final output.
- `lottie` -- *(Lottie engine only)* The authored Lottie JSON's URL. Appears when the **Engine** is set to **Lottie**, and can be connected to a **Lottie Overlay** node's `lottie` input so the authored animation is placed and timed over a video. (The Classic/elements engine does not expose this handle.)
## Best Practices
- Use the info guide in the prompt field for tips on what the AI can generate.
- Specify colors, fonts, and animation styles explicitly for consistent branding.
- Use transparent backgrounds (`#00000000`) when layering motion graphics over other video content.
- Keep duration under 15 seconds for lower thirds and title cards; use longer durations for kinetic typography sequences.

## Common Use Cases
- Creating animated lower thirds for interviews or presentations.
- Building kinetic typography sequences from quotes or lyrics.
- Designing animated title cards with branded colors and fonts.
- Producing shape and SVG path animations for explainer content.
- Generating transparent motion graphic overlays for compositing.

## Tips
- The default background is fully transparent (`#00000000`), making it ideal for overlaying on other video.
- The `FONT_MAP` provides a curated set of fonts. Describe the desired font style in your prompt (e.g., "modern sans-serif" or "elegant serif").
- Duration is capped at 60 seconds. For longer motion graphic sequences, chain multiple nodes.
- Preview is always available in the config panel (unlike After Effects, which requires a source video).
- For precise text content, include the exact text in your prompt rather than relying on the AI to generate copy.
