# Post-Process Effect

> Pick a post-processing effect from an 18-entry catalog (vignette-soft, film-grain, light-leak, chromatic-aberration, ...). Emits a post-process prompt fragment.

## Overview

The Post-Process Effect parameter node adds finishing-pass aesthetics to a generation — vignette, grain, halation, light leak, chromatic aberration, bloom, lens flares, etc. These read as analog imperfections that ground a CG-looking generation. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field        | Type   | Default          | Description                                                |
|--------------|--------|------------------|------------------------------------------------------------|
| postProcess  | string | `"vignette-soft"`| Catalog entry id (e.g. `"film-grain"`, `"light-leak"`).    |
| Pre Text     | text   | empty            | Free-form text prepended to the composed hint.             |
| Post Text    | text   | empty            | Free-form text appended to the composed hint.              |

## Catalog (18 entries)

Examples: `vignette-soft`, `vignette-heavy`, `film-grain`, `film-grain-heavy`, `light-leak`, `lens-flare`, `chromatic-aberration`, `halation`, `bloom`, `glow`, `motion-blur`, `radial-blur`, `crt-scanlines`, `vhs-tracking`, `pixel-bleed`, `dust-scratches`, `tape-noise`, `desaturation`.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Add filmic grain to fight the "AI plastic" look.
- VHS-era treatment (scanlines, tape noise, tracking) for retro aesthetics.
- Stack with Color / Look for a complete grade.

## See Also

- [Color / Look](./color-look.md), [Camera / Film Stock](./camera-format.md), [Composition Effect](./composition-effects.md).
