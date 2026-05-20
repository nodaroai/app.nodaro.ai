# Setting

> Pick a setting from a curated 63-entry catalog grouped into indoor, urban, nature, and fantastical. Emits a setting-description prompt fragment.

## Overview

The Setting parameter node lets you describe where a shot takes place by picking from a tile-grid of pre-written environment descriptions. The selected entry is converted to a natural-language clause and injected into the consumer AI image/video node's prompt via the `cinematography` handle.

## Configuration

| Field    | Type   | Default    | Description                                                                                          |
|----------|--------|------------|------------------------------------------------------------------------------------------------------|
| setting  | string | `"forest"` | Catalog entry id (e.g. `"forest"`, `"penthouse"`, `"alien-jungle"`, `"medieval-castle"`).            |
| Pre Text | text   | empty      | Free-form text prepended to the composed hint.                                                       |
| Post Text| text   | empty      | Free-form text appended to the composed hint.                                                        |

## Catalog (63 entries across 4 categories)

| Category | Theme |
|---|---|
| **Indoor** | bedroom, kitchen, office, gym, library, etc. |
| **Urban** | street, rooftop, café, alleyway, subway, etc. |
| **Nature** | forest, beach, mountain, desert, river, etc. |
| **Fantastical** | alien-jungle, floating-island, crystal-cave, underwater-city, etc. |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Establishing shot for narrative video clips.
- Quickly swapping environments across a batch of generated images.
- Pairing with Atmosphere + Lighting for full-scene composition.

## See Also

- [Atmosphere](./atmosphere.md) — weather and ambient conditions for the setting.
- [Lighting](./lighting.md) — multi-dim light setup.
- [Backdrop](./backdrop.md) — studio backdrops (different from real-world settings).
