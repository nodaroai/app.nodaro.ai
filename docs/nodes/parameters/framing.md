# Framing

> Multi-dim picker for shot size + angle + coverage + composition + vantage (72 catalog options across 5 fields). Emits a framing-descriptor prompt fragment.

## Overview

The Framing parameter node composes a full framing descriptor by combining five independent dimensions. Each dimension can be set individually; when wired to an AI image/video node's `cinematography` handle, only the set sub-fields contribute to the prompt. Empty sub-fields are silently dropped.

## Configuration (5 sub-fields)

| Field         | Type   | Description                                                                                                                       |
|---------------|--------|-----------------------------------------------------------------------------------------------------------------------------------|
| shotSize      | string | Distance from camera to subject — `extreme-close-up`, `close-up`, `medium-shot`, `wide-shot`, `extreme-wide-shot`.                |
| angle         | string | Camera angle relative to subject — `eye-level`, `low-angle`, `high-angle`, `dutch-angle`, `birds-eye`, `worms-eye`.                |
| coverage      | string | What's included in frame — `singles`, `two-shot`, `group-shot`, `over-the-shoulder`, `point-of-view`.                             |
| composition   | string | Compositional treatment — `rule-of-thirds`, `centered`, `leading-lines`, `symmetry`, `negative-space`.                            |
| vantage       | string | Viewpoint character — `objective`, `subjective-pov`, `voyeuristic`, `intimate`, `surveillance`.                                   |
| Pre Text      | text   | Free-form text prepended to the composed hint.                                                                                    |
| Post Text     | text   | Free-form text appended to the composed hint.                                                                                     |

## Catalog (72 catalog options)

Total catalog spans all five fields. The picker UI groups choices by dimension. Single-dim sub-pickers (Composition Effect, Photo Genre) overlap conceptually but operate at a different granularity.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Composition

The output is a comma-joined string of the set sub-field descriptors. Example with `shotSize: "wide-shot"`, `angle: "low-angle"`, `coverage: "singles"`:

> *"wide shot, low-angle, single-subject"*

Empty sub-fields are dropped. If no sub-fields are set, the output is empty and the consumer drops it.

## Common Use Cases

- Shot-by-shot framing direction in story-to-video pipelines.
- Quick visual-language alignment across a batch of generations.
- Layering with Lens, Camera Motion, and Lighting for full cinematography control.

## See Also

- [Lens](./lens.md), [Camera Motion](./camera-motion.md), [Lighting](./lighting.md), [Composition Effect](./composition-effects.md).
