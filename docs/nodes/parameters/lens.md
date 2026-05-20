# Lens

> Pick a lens from a 16-entry catalog (wide-angle, normal-50mm, telephoto, fisheye, anamorphic, ...). Emits a lens-characteristic prompt fragment.

## Overview

The Lens parameter node specifies the optical character of the camera in a generation — focal length, perspective, distortion behavior. Each entry encodes the visual signature of a focal length or specialty optic. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default        | Description                                            |
|-----------|--------|----------------|--------------------------------------------------------|
| lens      | string | `"normal-50mm"`| Catalog entry id (e.g. `"wide-angle"`, `"fisheye"`).   |
| Pre Text  | text   | empty          | Free-form text prepended to the composed hint.         |
| Post Text | text   | empty          | Free-form text appended to the composed hint.          |

## Catalog (16 entries)

| Lens | Character |
|---|---|
| `ultra-wide-14mm` | dramatic perspective, edge distortion |
| `wide-angle-24mm` | broad scene, environmental context |
| `wide-35mm` | photojournalistic, conversational |
| `normal-50mm` | natural perspective, eye-equivalent |
| `portrait-85mm` | compressed background, flattering for faces |
| `telephoto-135mm` | strong compression, isolated subject |
| `super-tele-200mm`, `500mm` | extreme compression, distant subject |
| `macro-100mm` | extreme close-up, life-size detail |
| `fisheye` | full 180°, heavy curvilinear distortion |
| `anamorphic` | widescreen, oval bokeh, horizontal lens flares |
| `tilt-shift` | miniature effect, plane-of-focus control |
| `lensbaby` | selective sweet spot, painterly blur |
| `vintage-cinema` | character flaws (flares, glow, softness) |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Wide-angle environmental establishing shots.
- Telephoto for isolated-subject portraits.
- Anamorphic for cinematic widescreen feel.
- Tilt-shift for miniature/diorama aesthetic.

## See Also

- [Camera / Film Stock](./camera-format.md), [Framing](./framing.md), [Exposure Settings](./exposure-settings.md).
