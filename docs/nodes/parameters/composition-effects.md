# Composition Effect

> Pick a composition effect from a 19-entry catalog (none, bursting-through-frame, pixel-disintegration, ...). Emits a composition prompt fragment.

## Overview

The Composition Effect parameter node applies a dramatic visual transform to the subject — bursting through the frame, disintegrating into pixels, sculpted from smoke, doubled in a mirror, and so on. Injected into the consumer's prompt via the `cinematography` handle.

The default is the neutral `none` entry, which injects nothing: every other entry is a strong transform, so an unconfigured node leaves the shot alone until you pick one.

## Configuration

| Field             | Type   | Default                       | Description                                                |
|-------------------|--------|-------------------------------|------------------------------------------------------------|
| compositionEffect | string | `"none"`                      | Catalog entry id. `none` is the neutral default and injects nothing. |
| Pre Text          | text   | empty                         | Free-form text prepended to the composed hint.             |
| Post Text         | text   | empty                         | Free-form text appended to the composed hint.              |
| Hint mode           | select   | `full`                          | Which fragment this picker injects downstream — `full` = the long descriptive hint, `compact` = the short professional term. See [Prompt hint mode](./README.md#prompt-hint-mode). |

## Catalog (19 entries)

`none`, `bursting-through-frame`, `breaking-out-of-frame`, `pixel-disintegration`, `smoke-sculpture`, `liquid-sculpture`, `shattering-glass`, `emerging-from-background`, `fragmented-mosaic`, `glitch-distortion`, `doubled-mirror`, `floating-fragments`, `silhouette-outline`, `exploding-particles`, `matte-painting`, `double-exposure`, `multiple-exposure`, `in-camera-effects`, `prism-flares`.

A 3x3 grid collage lives on the [Framing](./framing.md) node, not here.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Reinforce compositional discipline in batch generations.
- Vary composition across a series of similar shots.
- Pair with Framing (multi-dim) for full control.

## See Also

- [Framing](./framing.md), [Lens](./lens.md), [Photo Genre](./photo-genre.md).
