# Aesthetic / Microtrend

> Pick a microtrend aesthetic from a 46-entry catalog (y2k, cottagecore, vaporwave, dark-academia, ...). Emits an aesthetic-descriptor prompt fragment.

## Overview

The Aesthetic / Microtrend parameter node taps into named visual subcultures and microtrends — y2k, cottagecore, vaporwave, dark-academia, balletcore, weirdcore, cyberpunk, etc. Each entry encodes a recognizable cluster of visual signifiers (palette, props, settings, fashion vocabulary). The selected entry becomes a natural-language clause injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default | Description                                              |
|-----------|--------|---------|----------------------------------------------------------|
| aesthetic | string | `"y2k"` | Catalog entry id (e.g. `"cottagecore"`, `"vaporwave"`).  |
| Pre Text  | text   | empty   | Free-form text prepended to the composed hint.           |
| Post Text | text   | empty   | Free-form text appended to the composed hint.            |

## Catalog (46 entries across 4 categories)

Examples: `y2k`, `cottagecore`, `dark-academia`, `light-academia`, `balletcore`, `vaporwave`, `weirdcore`, `dreamcore`, `liminal-space`, `cyberpunk`, `solarpunk`, `goblincore`, `mermaidcore`, `coquette`, `clean-girl`, `mob-wife`, `coastal-grandma`, `corporate-core`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Generate content tuned to a specific online aesthetic trend.
- Quickly translate a brief like "y2k mall photoshoot" into a coherent visual.
- Pair with Era for time-period authenticity (y2k + 2000s = doubled emphasis).

## See Also

- [Era / Period](./era.md), [Style](./style.md), [Color / Look](./color-look.md).
