# Exposure Settings

> Multi-dim picker for aperture + shutter-speed + ISO (20 catalog options across 3 fields). Emits a camera-exposure prompt fragment.

## Overview

The Exposure Settings parameter node specifies the photographic exposure triangle — aperture (depth of field), shutter speed (motion treatment), and ISO (sensor sensitivity / grain). Each dimension nudges the AI model toward a recognizable photographic signature. Wired to an AI image/video node's `cinematography` handle.

## Configuration (3 sub-fields)

| Field         | Type   | Description                                                                                                                              |
|---------------|--------|------------------------------------------------------------------------------------------------------------------------------------------|
| aperture      | string | `wide-f1.4` (very shallow DoF), `f2.8` (shallow), `f5.6` (moderate), `f8` (standard), `narrow-f16` (deep DoF).                            |
| shutterSpeed  | string | `slow-1s` (long-exposure trails), `slow-1-15` (light motion blur), `standard-1-60`, `fast-1-250` (action-frozen), `fast-1-2000` (frozen). |
| isoValue      | string | `iso-100` (clean), `iso-400` (slight grain), `iso-1600` (noticeable grain), `iso-6400` (heavy grain).                                    |
| Pre Text      | text   | Free-form text prepended to the composed hint.                                                                                           |
| Post Text     | text   | Free-form text appended to the composed hint.                                                                                            |

## Catalog (20 catalog options across 3 fields)

The picker UI groups choices by dimension. Each dimension is optional.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Composition

Example with `aperture: "wide-f1.4"`, `shutterSpeed: "fast-1-2000"`, `isoValue: "iso-100"`:

> *"f/1.4 wide aperture, 1/2000 shutter, ISO 100"*

## Common Use Cases

- Shallow DoF portraiture (f/1.4 + ISO 100).
- Long-exposure light-trail compositions (1s + ISO 100).
- High-ISO low-light grain aesthetic (ISO 6400 + slow shutter).
- Action-frozen sports look (1/2000 + ISO 400).

## See Also

- [Lens](./lens.md), [Camera / Film Stock](./camera-format.md), [Lighting](./lighting.md), [Photo Genre](./photo-genre.md).
