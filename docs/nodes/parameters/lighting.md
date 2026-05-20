# Lighting

> Multi-dim picker for time-of-day + lighting-style + lighting-direction (72 catalog options across 3 fields). Emits a lighting-descriptor prompt fragment.

## Overview

The Lighting parameter node composes a full lighting setup by combining three independent dimensions — when the scene happens, what the light quality is, and where it's coming from. Wired to an AI image/video node's `cinematography` handle. Empty sub-fields are dropped silently.

## Configuration (3 sub-fields)

| Field             | Type   | Description                                                                                                                            |
|-------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------|
| timeOfDay         | string | When in the day — `dawn`, `morning`, `noon`, `golden-hour`, `dusk`, `blue-hour`, `night`, `midnight`.                                  |
| lightingStyle     | string | Quality of light — `natural`, `soft`, `hard`, `rembrandt`, `split`, `loop`, `butterfly`, `clamshell`, `rim-light`, `practical-only`.   |
| lightingDirection | string | Where light comes from — `front`, `45-degree`, `side`, `back`, `top`, `bottom`, `silhouette`.                                          |
| Pre Text          | text   | Free-form text prepended to the composed hint.                                                                                         |
| Post Text         | text   | Free-form text appended to the composed hint.                                                                                          |

## Catalog (72 catalog options across 3 fields)

The picker UI groups choices by dimension. Some entries are paired stylistic conventions (e.g. `rembrandt` lighting style with a specific direction implied).

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Composition

The output joins the set sub-field descriptors comma-separated. Example with `timeOfDay: "golden-hour"`, `lightingStyle: "rim-light"`, `lightingDirection: "back"`:

> *"golden hour, rim-light, back-lit"*

If no sub-fields are set, the output is empty.

## Common Use Cases

- Cinematic lighting direction (golden-hour + rim-light = classic hero look).
- Studio portrait styles (rembrandt, split, clamshell, butterfly).
- Mood-driven lighting (low-light + practical-only = noir feel).
- Pairs naturally with Time / Atmosphere to set scene tone.

## See Also

- [Atmosphere](./atmosphere.md), [Color / Look](./color-look.md), [Setting](./setting.md), [Exposure Settings](./exposure-settings.md).
