# Reference Board

> Generate a dense, premium reference board — hero portrait + metadata block + panels + a color palette — in **one AI pass** from reference image(s), then refine it (global edit, masked edit, or re-roll). Lock a subject's look in a single artifact you feed everywhere for consistency.

## Overview

Reference Board produces a single, editorial-style reference sheet for a **Character**, **Location**, or **Object** — a hero image, a metadata block, several panels (views, expressions / time-of-day, details, variations, lighting), and a 6-swatch color palette — all composed by the image model in **one generation**, from one or more reference images.

It is the **single-pass, generative** counterpart to the [Reference Sheet](./reference-sheet.md) node:

| | **Reference Sheet** | **Reference Board** |
|---|---|---|
| How it's built | composites individual panels the entity already has (or generates them and lays them out) | the image model draws the whole board in one pass |
| Output | a sheet **plus a clean set of individual panels** | **one cohesive board image** |
| Feed downstream | wire individual panels | feed the whole board as a single reference |
| Refine | regenerate a panel | global / masked / re-roll on the board itself |

Use Reference Board when you want a cohesive, premium-looking board fast and intend to feed the **whole board** to downstream generators as a consistency reference. Use Reference Sheet when you need the individual panels as separate, reusable images.

## How to use

1. Provide the subject, either:
   - **From entity** — connect a **Character / Location / Object** node; its image and description flow in as the reference, or
   - **From image(s)** — attach one or more reference images directly.
2. Pick a **Board template** (e.g. *Full Board*). The template seeds the prompt with the right panel structure for the entity kind; you can edit the prompt afterwards.
3. Choose a **Provider** (Nano Banana Pro or GPT Image 2 — both render in-image text well).
4. Adjust aspect ratio, resolution/quality, and (optionally) a negative prompt and seed.
5. **Run.** The model returns one board image.
6. **Refine** on the result (see below). Each refine creates a new **version** — step back and forth with the version strip; the active version is what feeds downstream.

## Refine

Every refine acts on the **realized board** (the image you actually got back) and appends a new version:

- **Re-roll** — regenerate a fresh board with a new seed, keeping your settings.
- **Global edit** (no mask) — type an instruction ("make the jacket red") and the change is applied across the whole board, identity and layout preserved. Good for cross-panel changes.
- **Masked edit** — brush a region on the board and describe the change; only the masked area is re-rendered, the rest stays pixel-identical. Good for fixing one panel (e.g. a single expression).
- Refine passes can take additional **reference images** for accuracy.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Source | select | `image` | `entity` (use a connected Character / Location / Object) or `image` (use attached reference images). |
| Board template | select | `character/full-board` | The board structure to generate; seeds the prompt. Templates are grouped by entity kind (character / location / object). |
| Provider | select | `nano-banana-pro` | Image model. `nano-banana-pro` or `gpt-image-2` — both handle the board's in-image labels and palette text. |
| Prompt | text | seeded | Prefilled from the board template; fully editable. |
| Negative prompt | text | — | Things to avoid. |
| Reference images | image[] | — | Subject and/or style references (used at generation and in refine passes). |
| Aspect ratio | select | `2:3` | The board adapts to the chosen ratio. |
| Resolution / Quality | select | `4K` | Up to 4K, provider-dependent. |
| Seed | number | — | Fix for reproducibility; Re-roll uses a fresh seed. |

## Output

A single board **image**. Downstream nodes (video and image generators, etc.) consume it as one reference image — the board carries the subject's full look in one artifact.

> Generating individual standalone panels *from* the board (for nodes that want a specific angle as its own image) is a planned addition; today the board is fed whole.

## Credits

Reference Board is priced the same way as [Generate Image](./generate-image.md) for the provider you choose — you pay that provider's per-image rate, with no separate board fee. Refine passes are priced like an image edit ([Modify Image](./modify-image.md) / image-to-image) for the edit provider used. The node shows the cost on its Run button before you run it.
