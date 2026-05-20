# Era / Period

> Pick a historical era from a 32-entry catalog (1950s, 1990s-mall, ancient-rome, victorian, ...). Emits a period prompt fragment.

## Overview

The Era / Period parameter node sets the historical or chronological frame of a scene. Each entry encodes recognizable period markers (fashion, architecture, technology, color palette). The selected entry becomes a natural-language clause injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default          | Description                                                     |
|-----------|--------|------------------|-----------------------------------------------------------------|
| era       | string | `"1990s-mall"`   | Catalog entry id (e.g. `"ancient-rome"`, `"victorian"`).        |
| Pre Text  | text   | empty            | Free-form text prepended to the composed hint.                  |
| Post Text | text   | empty            | Free-form text appended to the composed hint.                   |

## Catalog (32 entries across 3 categories)

| Category | Examples |
|---|---|
| **Ancient / Pre-modern** | ancient-egypt, ancient-rome, medieval, renaissance, edo-japan |
| **Modern** | victorian, edwardian, roaring-20s, 1950s, 1970s-disco, 1980s-vhs, 1990s-mall, 2000s-y2k |
| **Future** | near-future, cyberpunk-future, solarpunk-future, post-apocalyptic |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Lock a period look for narrative or documentary-style content.
- Pair with Aesthetic for stronger trend reinforcement (e.g. 1990s-mall + y2k).
- Use in story-to-video for time-period consistency across shots.

## See Also

- [Aesthetic / Microtrend](./aesthetic.md), [Setting](./setting.md), [Camera / Film Stock](./camera-format.md).
