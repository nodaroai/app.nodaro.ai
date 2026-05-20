# Temporal

> Multi-dim picker for temporal-speed + freeze + direction + shutter (18 catalog options across 4 fields). Emits a temporal-effect prompt fragment.

## Overview

The Temporal parameter node controls time-based effects in generated video — slow-motion, time-freeze, time-lapse, reverse, shutter-blur signature. Video-only: automatically suppressed for still-image consumers (Generate Image, Edit Image, Image-to-Image, Location). Wired to an AI video node's `cinematography` handle.

## Configuration (4 sub-fields)

| Field             | Type   | Description                                                                                            |
|-------------------|--------|--------------------------------------------------------------------------------------------------------|
| temporalSpeed     | string | Playback speed — `normal`, `slow-motion`, `super-slow-motion`, `fast-motion`, `time-lapse`, `hyperlapse`. |
| temporalFreeze    | string | Freeze treatment — `none`, `freeze-frame`, `bullet-time`, `time-stop`.                                 |
| temporalDirection | string | Direction of time — `forward`, `reverse`, `oscillating`, `loop`.                                       |
| temporalShutter   | string | Shutter signature — `natural`, `high-shutter-crisp`, `low-shutter-blur`, `strobe`, `rolling-shutter`.  |
| Pre Text          | text   | Free-form text prepended to the composed hint.                                                         |
| Post Text         | text   | Free-form text appended to the composed hint.                                                          |

## Catalog (18 catalog options across 4 fields)

The picker UI groups choices by dimension. Each dimension is optional.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI video nodes via their `cinematography` handle.

## Composition

Output joins the set sub-field descriptors. Example with `temporalSpeed: "slow-motion"`, `temporalDirection: "reverse"`:

> *"slow motion, reverse playback"*

## Common Use Cases

- Sports / action cinematography (slow-motion at peak action).
- Time-lapse city/nature scenes.
- Music-video stylistic beats (bullet-time at the drop).
- Reverse-direction storytelling moments.

## See Also

- [Camera Motion](./camera-motion.md), [Composition Effect](./composition-effects.md), [Action FX](./action-fx.md).
