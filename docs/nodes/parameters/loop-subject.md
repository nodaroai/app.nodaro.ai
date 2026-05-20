# Loop Subject

> Pick a loop subject from a 35-entry catalog across 2 categories. Emits a subject descriptor for seamlessly looped video content.

## Overview

The Loop Subject parameter node names the focal element of a looped video clip — tunnel, kaleidoscope, fractal, vortex, flowing-river, etc. Optimized for content that needs to loop seamlessly (background loops, screen-savers, ambient visuals). Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field        | Type   | Default    | Description                                              |
|--------------|--------|------------|----------------------------------------------------------|
| loopSubject  | string | `"tunnel"` | Catalog entry id (e.g. `"kaleidoscope"`, `"vortex"`).    |
| Pre Text     | text   | empty      | Free-form text prepended to the composed hint.           |
| Post Text    | text   | empty      | Free-form text appended to the composed hint.            |

## Catalog (35 entries across 2 categories)

| Category | Examples |
|---|---|
| **Abstract / Geometric** | tunnel, kaleidoscope, fractal, vortex, mandala, mosaic, spiral, prism, fractured-glass |
| **Natural / Organic** | flowing-river, ocean-waves, drifting-clouds, falling-leaves, snowfall, fire-flicker, lava-flow, smoke-plume |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI video nodes via their `cinematography` handle.

## Common Use Cases

- Background loops for live streams, podcasts, or installations.
- Ambient screen-savers and digital-signage assets.
- Music-video b-roll where the visual loops seamlessly.

## See Also

- [Camera Motion](./camera-motion.md), [Composition Effect](./composition-effects.md), [Atmosphere](./atmosphere.md).
