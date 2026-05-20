# Material

> Pick a material from a 66-entry catalog (silk, leather, metal, glass, marble, ...). Emits a material-descriptor prompt fragment.

## Overview

The Material parameter node describes the dominant surface or substance featured in a generation — silk, leather, brushed metal, frosted glass, marble, velvet, etc. Each entry encodes light-interaction behavior (specular, matte, refractive, translucent). Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default | Description                                            |
|-----------|--------|---------|--------------------------------------------------------|
| material  | string | `"silk"`| Catalog entry id (e.g. `"leather"`, `"marble"`).       |
| Pre Text  | text   | empty   | Free-form text prepended to the composed hint.         |
| Post Text | text   | empty   | Free-form text appended to the composed hint.          |

## Catalog (66 entries across categories)

| Category | Examples |
|---|---|
| **Fabric** | silk, satin, velvet, linen, denim, wool, cashmere, tulle, lace, mesh |
| **Leather / Hide** | smooth-leather, patent-leather, suede, snakeskin, crocodile |
| **Metal** | polished-steel, brushed-aluminum, gold, copper, chrome, rusted-iron |
| **Glass / Stone** | clear-glass, frosted-glass, stained-glass, marble, granite, obsidian |
| **Wood / Earth** | oak, mahogany, bamboo, terracotta, clay, sand |
| **Synthetic** | plastic, latex, vinyl, rubber, foam, holographic-film |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Product photography surface treatment.
- Fashion editorial textile emphasis.
- Architectural visualization material study.

## See Also

- [Styling](./styling.md) (fabric is a sub-field), [Color / Look](./color-look.md), [Lighting](./lighting.md).
