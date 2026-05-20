# Camera / Film Stock

> Pick a camera or film format from a 31-entry catalog (35mm-film, IMAX, super-8, polaroid, VHS, ...). Emits a camera-medium prompt fragment.

## Overview

The Camera / Film Stock parameter node names the recording medium — film stock, digital sensor, or specialty format. Each entry carries a distinct visual signature (grain, latitude, color, gate, scan-line behavior). Injected into the consumer's prompt via the `cinematography` handle. Pairs with Color / Look for full medium-emulation grading.

## Configuration

| Field         | Type   | Default       | Description                                          |
|---------------|--------|---------------|------------------------------------------------------|
| cameraFormat  | string | `"35mm-film"` | Catalog entry id (e.g. `"imax"`, `"vhs"`).           |
| Pre Text      | text   | empty         | Free-form text prepended to the composed hint.       |
| Post Text     | text   | empty         | Free-form text appended to the composed hint.        |

## Catalog (31 entries)

| Group | Examples |
|---|---|
| **Film** | 35mm-film, 16mm-film, super-8, super-16, 65mm, IMAX, kodak-portra-400, kodak-vision3-500t, fujifilm-fp-100c |
| **Digital cinema** | arri-alexa, red-helium, sony-venice, blackmagic-ursa |
| **Consumer / vintage** | polaroid, polaroid-sx70, disposable-camera, vhs, hi8, dv-tape |
| **Mobile / specialty** | iphone-promax, gopro, dslr-1080p, dashcam, security-cam, drone |
| **Old photographic** | daguerreotype, tintype, wet-plate-collodion |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Film-stock emulation (Portra 400 for warmth, Vision3 for cinema look).
- Period authenticity (polaroid, super-8 for 1970s home-video feel; VHS for 1990s).
- Documentary or POV looks (dashcam, gopro, drone).
- Cinema-camera signatures (Alexa for soft latitude, Red for sharpness).

## See Also

- [Lens](./lens.md), [Color / Look](./color-look.md), [Era / Period](./era.md), [Post-Process Effect](./post-process-effects.md).
