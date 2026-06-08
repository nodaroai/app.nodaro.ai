# Reference Sheet

> Composite a turnaround, expression board, detail, or full reference sheet from a Character, Object, or Location — then export it or feed the clean panels into generators as a multi-image reference.

## Overview

Reference Sheet assembles a single, presentation-ready model sheet for an entity (a Character, Object, or Location). A sheet can include a turnaround (multiple angles), an expression or variation board, detail close-ups, a wardrobe row, a color palette extracted from the main image, and a notes block — laid out on one canvas in one of four visual **skins**.

On Run, the node first **generates any panels the chosen type needs but the entity is missing** (extra angles, expressions, details, …) off the entity's main image, reuses the ones it already has, extracts a palette from the main image, and composites everything into one image plus a clean panel set. Because generating panels costs credits, the node tells you how many it will generate and asks you to **confirm** before it starts. To control cost (or pre-build exactly the panels you want), you can also generate them ahead of time in the entity's **Studio** — the sheet then reuses them for free.

You can also generate sheets directly from the **Sheet** tab inside an entity's Studio — the node is the canvas-wired equivalent so a sheet can be produced as part of a workflow.

## How to use

1. Connect a **Character**, **Object**, or **Location** node (one that has an approved main image) to the **Subject** input.
2. Pick a **Type**:
   - **Turnaround** — angle coverage (front / side / back, etc.).
   - **Variation Board** — an expression / pose / material / variation grid.
   - **Detail** — close-up detail panels.
   - **Full Reference** — the complete stack (header + turnaround + board + detail + palette + notes).
3. Pick a **Skin** — **Studio** (clean neutral), **Cinematic** (dark, accent rules under each heading), **Blueprint** (drafting grid + corner ticks, monospace), or **Illustrated** (warm storybook plate, serif).
4. Adjust the **flavour** knobs as needed: show/hide text, show/hide panel labels, aspect (landscape / square / story), and background.
5. **Run.** If the entity is missing any panels the type needs, the node tells you how many it will generate (each is charged) and asks you to confirm; it then generates them, reuses any that already exist, and composites the sheet.

> Tip: the node generates whatever panels the chosen type needs that the entity is missing. To keep a Run cheap, generate (or trim) the panels you want in the entity's **Studio** first — the sheet reuses existing panels for free and only generates what's absent.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Type | select | `turnaround` | `turnaround` / `variation-board` / `detail` / `full-reference`. The available types adapt to the connected entity kind. |
| Skin | select | `studio` | Visual treatment: `studio` / `cinematic` / `blueprint` / `illustrated`. Chrome (grid, accent rule, header band), colors, and font differ per skin. |
| Show text | boolean | `true` | When off, the entity name / metadata / notes text is suppressed (structural section headings are still drawn). |
| Show labels | boolean | `true` | When off, per-panel caption labels are suppressed. |
| Aspect | select | `landscape` | Canvas shape: `landscape` (1600w) / `square` (1200w) / `story` (900w). Height grows with the band stack. |
| Background | select | `grey` | Panel/canvas backdrop treatment: `grey` / `white` / `transparent` / `in-context`. |
| Output format | select | `still` | `still` → a PNG sheet; `motion` → the chrome rendered as a background with the entity's motion clips overlaid into the slots → MP4. See [Motion / video sheets](#motion--video-sheets). |

## Inputs & Outputs

**Inputs:**

| Handle | Side | Accepts | Description |
|--------|------|---------|-------------|
| `in` (Subject) | left | Character, Object, or Location node | The entity to build the sheet from. The sheet reads this entity's saved panels and its main image (for the palette). |

**Outputs:**

| Handle | Color | Type | Description |
|--------|-------|------|-------------|
| `sheet` | cyan | image | The composited reference sheet as a single image. Download it, display it, or wire it anywhere an image is accepted — but note it is a **poster** (it carries text/labels), so it is not meant to be used as a generation reference. |
| `panels` | rose | reference | The clean panel set (the individual panel images, no poster chrome). Wire this into an image or video generator's reference input for multi-image consistency. |

**Use the right output:** for a deliverable you show a human, use `sheet`. To drive consistency in downstream generation, use `panels` — the text poster is never used as a generation reference.

## Types × Flavours × Skins

| Axis | Options | Effect |
|------|---------|--------|
| **Type** | Turnaround · Variation Board · Detail · Full Reference | Chooses which bands (sections) appear and which of the entity's panels are pulled in. |
| **Flavour** | With/without text · with/without panel labels · panel count · aspect (landscape / square / story) · background (grey / white / transparent / in-context) | Tunes density and presentation without changing the type. |
| **Skin** | Studio · Cinematic · Blueprint · Illustrated | Changes the chrome, palette, and typography only — same content. Blueprint adds a faint drafting grid + corner registration ticks; Cinematic adds an accent rule under each heading; Illustrated adds a warm header band; Studio is clean and neutral. |

## Pricing

Cost = **(newly-generated panels at the entity provider's rate)** + a flat **4-credit** assembly fee. Panels that already exist in the entity's Studio are **reused for free** — you only pay to generate the panels that don't exist yet, plus the one-time assembly fee.

| Scenario | Math | Credits |
|----------|------|---------|
| Turnaround reusing 4 angles the entity already has | `0 + 4` | **4** |
| 4 new angles generated with Nano Banana (1 cr each) | `4×1 + 4` | **8** |
| Full reference with 4 new angles generated with Flux 2 Pro (3 cr each) | `4×3 + 4` | **16** |

The flat assembly fee covers layout, palette extraction, and compositing. The node's Run button shows the assembly fee; when panels need generating, the node first asks you to confirm how many it will generate (each charged at the entity provider's rate) before it starts.

## Motion / video sheets

The sheet has two output formats, set by the **flavour's `outputFormat`**:

- **`still`** (default) — the composited sheet is a single PNG image (everything above).
- **`motion`** — the chrome (text, palette, panel labels, header) is rendered once as a **background image with empty panel slots**, then the entity's **motion clips** are overlaid into those slot rectangles via FFmpeg and the result is exported as an **MP4**. The `sheet` output then carries the video URL, so a downstream video consumer receives a video.

Motion sheets are **compose-only**: they use the motion clips the entity **already has** in its motion bucket (a Character's `motions`, an Object's `motion_clips`, a Location's `atmosphere_motions`), matched to each panel by name. A panel whose matching motion clip doesn't exist simply keeps the static background in its slot — the motion is **absent**, not generated. Generate the motion clips you want in the entity's **Studio** first, then run the sheet in motion mode to overlay them. The clip with the shortest duration sets the sheet's playback length (clamped to a small minimum).

**Motion pricing:** each motion clip is priced separately by the per-asset motion routes that generate it (in the entity's Studio); the sheet itself adds a flat **6-credit** `reference-sheet:assembly-motion` FFmpeg-assembly fee (vs the 4-credit still assembly fee). As with still sheets, clips already present are reused for free — the motion-assembly fee is the only cost the sheet node itself charges.

| Scenario | Math | Credits |
|----------|------|---------|
| Motion sheet overlaying 4 motion clips the entity already has | `0 + 6` | **6** |

## Requirements & errors

- The connected entity **must have a saved main image**. Without one, the node returns `main_image_required` — approve a main image in the entity's Studio first.
- An entity with only a main image is fine — the node generates the panels the chosen type needs on Run. The more panels the entity already has, the fewer the node generates (and the cheaper the Run).

## Best Practices

- To control cost, build (or trim) the entity's panels in its Studio **before** running the sheet — the node reuses existing panels for free and only generates the ones that are missing.
- Use `panels` (not `sheet`) when feeding a sheet into a generator for character/object consistency. `sheet` is the human-facing poster.
- Pick **Blueprint** for technical/asset documentation, **Cinematic** for pitch decks, **Illustrated** for storybook/character bibles, and **Studio** when you just want a clean grid.

## Common Use Cases

- Producing a character model sheet (turnaround + expressions + palette) for animation or game-art consistency.
- Building an object or prop reference card to keep a product looking identical across shots.
- Exporting a location reference plate for set/background continuity.
- Wiring the clean `panels` output into a Generate Image or Generate Video node as a multi-image reference.
