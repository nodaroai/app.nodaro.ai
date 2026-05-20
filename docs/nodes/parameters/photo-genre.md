# Photo Genre

> Pick a photography genre from a 46-entry catalog (fashion-editorial, street, macro, documentary, ...). Emits a genre/composition prompt fragment.

## Overview

The Photo Genre parameter node sets the photographic discipline a generation should emulate — fashion-editorial, street, macro, documentary, sports, architectural, etc. Each entry encodes typical compositional and lighting conventions of that genre. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field      | Type   | Default                 | Description                                                              |
|------------|--------|-------------------------|--------------------------------------------------------------------------|
| photoGenre | string | `"fashion-editorial"`   | Catalog entry id (e.g. `"street"`, `"macro"`, `"documentary"`).          |
| Pre Text   | text   | empty                   | Free-form text prepended to the composed hint.                           |
| Post Text  | text   | empty                   | Free-form text appended to the composed hint.                            |

## Catalog (46 entries)

Examples: `fashion-editorial`, `fashion-campaign`, `street`, `documentary`, `photojournalism`, `wildlife`, `landscape`, `astrophotography`, `macro`, `portrait`, `boudoir`, `wedding`, `food`, `product`, `architectural`, `interior`, `sports`, `concert`, `paparazzi`, `polaroid`, `disposable-camera`, `flash-snapshot`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Lock a genre's compositional conventions (rule-of-thirds for editorial, fill-frame for macro).
- Generate brand-aligned content (fashion-campaign for lookbooks).
- Pair with Lens or Camera Format for genre-period authenticity.

## See Also

- [Lens](./lens.md), [Camera / Film Stock](./camera-format.md), [Framing](./framing.md).
