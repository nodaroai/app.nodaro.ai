# Mood

> Pick a mood from a 50-entry catalog (calm, tense, melancholic, joyful, ominous, ...). Emits a mood/emotion prompt fragment.

## Overview

The Mood parameter node anchors the emotional register of a generated image or video. The selected entry becomes a natural-language clause that primes the AI model toward a specific affective tone, injected via the `cinematography` handle.

## Configuration

| Field     | Type   | Default  | Description                                            |
|-----------|--------|----------|--------------------------------------------------------|
| mood      | string | `"calm"` | Catalog entry id (e.g. `"tense"`, `"melancholic"`).    |
| Pre Text  | text   | empty    | Free-form text prepended to the composed hint.         |
| Post Text | text   | empty    | Free-form text appended to the composed hint.          |

## Catalog (50 entries)

Examples: `calm`, `serene`, `joyful`, `playful`, `romantic`, `melancholic`, `nostalgic`, `tense`, `anxious`, `ominous`, `dread`, `triumphant`, `awe`, `reverent`, `whimsical`, `dreamlike`, `surreal`, `lonely`, `intimate`, `epic`, `chaotic`, `peaceful`, `cozy`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Quickly shift emotional tone across a series of generations.
- Pair with Color / Look + Lighting for full emotional staging.
- Drive scene-by-scene mood in story-to-video pipelines.

## See Also

- [Color / Look](./color-look.md), [Lighting](./lighting.md), [Atmosphere](./atmosphere.md).
