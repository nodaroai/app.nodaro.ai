# Composition Effect

> Pick a composition effect from a 19-entry catalog (bursting-through-frame, depth-of-field, rule-of-thirds, ...). Emits a composition prompt fragment.

## Overview

The Composition Effect parameter node nudges the AI model toward a specific compositional treatment — subject bursting through frame, shallow depth-of-field, rule-of-thirds, leading lines, etc. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field             | Type   | Default                       | Description                                                |
|-------------------|--------|-------------------------------|------------------------------------------------------------|
| compositionEffect | string | `"bursting-through-frame"`    | Catalog entry id.                                          |
| Pre Text          | text   | empty                         | Free-form text prepended to the composed hint.             |
| Post Text         | text   | empty                         | Free-form text appended to the composed hint.              |

## Catalog (19 entries)

Examples: `bursting-through-frame`, `depth-of-field-shallow`, `depth-of-field-deep`, `rule-of-thirds`, `leading-lines`, `symmetry`, `framing-within-frame`, `negative-space`, `golden-ratio`, `diagonal-composition`, `triangular-composition`, `bird-eye-pattern`, `extreme-close-cropping`, `silhouette`, `reflection`, `tilted-horizon`, `centered-subject`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Reinforce compositional discipline in batch generations.
- Vary composition across a series of similar shots.
- Pair with Framing (multi-dim) for full control.

## See Also

- [Framing](./framing.md), [Lens](./lens.md), [Photo Genre](./photo-genre.md).
