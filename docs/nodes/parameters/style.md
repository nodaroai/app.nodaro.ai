# Style

> Pick a visual style preset from a 48-entry catalog (cinematic, anime, oil-painting, photoreal, ...). Emits a style-descriptor prompt fragment.

## Overview

The Style parameter node sets the overarching visual treatment of a generated image or video — the aesthetic register the AI model should adopt. The selected entry is converted to a natural-language clause and injected into the consumer's prompt via the `cinematography` handle. Image-generation config panels also expose an inline Style dropdown, but a connected Style node always takes precedence (the inline field is disabled to prevent double application).

## Configuration

| Field     | Type   | Default       | Description                                                |
|-----------|--------|---------------|------------------------------------------------------------|
| style     | string | `"cinematic"` | Catalog entry id (e.g. `"anime"`, `"oil-painting"`).       |
| Pre Text  | text   | empty         | Free-form text prepended to the composed hint.             |
| Post Text | text   | empty         | Free-form text appended to the composed hint.              |

## Catalog (48 entries)

Examples: `cinematic`, `photoreal`, `anime`, `oil-painting`, `watercolor`, `pencil-sketch`, `charcoal`, `comic-book`, `manga`, `3d-render`, `pixel-art`, `vector`, `cel-shaded`, `claymation`, `stop-motion`, `studio-ghibli`, `pixar`, `noir`, `cyberpunk`, `steampunk`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Lock a consistent visual language across a batch of generations.
- Quickly try different stylistic registers for the same prompt.
- Stack with Photographer or Aesthetic for fine-grained style direction.

## See Also

- [Photographer / Artist](./photographer.md), [Aesthetic / Microtrend](./aesthetic.md), [Render Quality](./render-quality.md).
