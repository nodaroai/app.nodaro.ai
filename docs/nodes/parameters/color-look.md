# Color / Look

> Pick a color-grading look from a 41-entry catalog (warm, teal-orange, bleached, vintage, ...). Emits a color-grading prompt fragment.

## Overview

The Color / Look parameter node defines the color palette and grading characteristics of a generated image or video — the chromatic register that gives a frame its emotional signature (warm sunset, cold blue, faded vintage, etc.). The selected entry becomes a natural-language clause injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default  | Description                                              |
|-----------|--------|----------|----------------------------------------------------------|
| colorLook | string | `"warm"` | Catalog entry id (e.g. `"teal-orange"`, `"bleached"`).   |
| Pre Text  | text   | empty    | Free-form text prepended to the composed hint.           |
| Post Text | text   | empty    | Free-form text appended to the composed hint.            |

## Catalog (41 entries)

Examples: `warm`, `cool`, `teal-orange`, `bleached`, `vintage`, `kodak-portra`, `kodachrome`, `cross-processed`, `bleach-bypass`, `desaturated`, `monochrome`, `sepia`, `noir-bw`, `cyberpunk-neon`, `golden-hour`, `blue-hour`, `pastel`, `high-contrast`, `low-contrast`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Apply a film-emulation grade (Kodak Portra, Kodachrome) for vintage feel.
- Reinforce mood via warm/cool palette pairing with Atmosphere.
- Match the look across a sequence of shots in a story-to-video pipeline.

## See Also

- [Style](./style.md), [Lighting](./lighting.md), [Photographer / Artist](./photographer.md).
