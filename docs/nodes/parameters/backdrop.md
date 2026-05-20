# Backdrop

> Pick a studio backdrop from a 40-entry catalog (white-seamless, cyc-wall, gradient, painted, ...). Emits a backdrop prompt fragment.

## Overview

The Backdrop parameter node describes the background surface behind a subject in a studio-style composition — white-seamless paper, cyc-wall, painted muslin, gradient, etc. Distinct from Setting (real-world locations), Backdrop is for studio, product, or portrait work. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default           | Description                                                  |
|-----------|--------|-------------------|--------------------------------------------------------------|
| backdrop  | string | `"white-seamless"`| Catalog entry id (e.g. `"cyc-wall"`, `"gradient"`).          |
| Pre Text  | text   | empty             | Free-form text prepended to the composed hint.               |
| Post Text | text   | empty             | Free-form text appended to the composed hint.                |

## Catalog (40 entries)

Examples: `white-seamless`, `black-seamless`, `gray-seamless`, `gradient-blue`, `gradient-warm`, `cyc-wall`, `painted-muslin`, `velvet`, `brick-wall`, `concrete-wall`, `wood-paneling`, `marble`, `holographic`, `chromatic`, `confetti`, `floral-wallpaper`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Product photography (white-seamless, black-seamless).
- Editorial portraits (painted-muslin, gradient).
- Fashion campaigns (cyc-wall, chromatic).

## See Also

- [Photo Genre](./photo-genre.md), [Lighting](./lighting.md), [Setting](./setting.md) — for real-world environments instead.
