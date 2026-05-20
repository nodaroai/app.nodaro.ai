# Atmosphere

> Pick an atmospheric condition from a 40-entry catalog (clear, fog, dust, rain, snow, smoke, ...). Emits an atmosphere prompt fragment.

## Overview

The Atmosphere parameter node describes the ambient state of the air around a scene — weather, particles, light scattering. The selected entry is converted to a natural-language clause and injected into the consumer AI node's prompt via the `cinematography` handle. Composable with Setting (where) and Lighting (how lit).

## Configuration

| Field      | Type   | Default   | Description                                              |
|------------|--------|-----------|----------------------------------------------------------|
| atmosphere | string | `"clear"` | Catalog entry id (e.g. `"fog"`, `"sandstorm"`, `"rain"`). |
| Pre Text   | text   | empty     | Free-form text prepended to the composed hint.           |
| Post Text  | text   | empty     | Free-form text appended to the composed hint.            |

## Catalog (40 entries)

Examples: `clear`, `light-fog`, `heavy-fog`, `mist`, `haze`, `dust`, `sandstorm`, `light-rain`, `heavy-rain`, `drizzle`, `snowfall`, `blizzard`, `smoke`, `god-rays`, `volumetric-light`, `humidity`, `dew`, `aurora`, `lightning-storm`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Add mood and depth via fog, mist, or god-rays.
- Establish weather for outdoor scenes (rain, snow, sandstorm).
- Stack with Lighting for cinematic compositions (e.g. fog + backlight = silhouette).

## See Also

- [Setting](./setting.md), [Lighting](./lighting.md), [Color / Look](./color-look.md).
