# Render Quality

> Pick a render-pipeline preset from a 24-entry catalog (raytracing, octane, unreal, blender, ...). Emits a render-quality prompt fragment.

## Overview

The Render Quality parameter node nudges the AI model toward a specific rendering pipeline aesthetic — physically-based raytracing, Octane, Unreal Engine, Blender Cycles, hand-drawn, low-poly, etc. Useful for nudging the model toward CG/3D output looks rather than photographic ones. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field          | Type   | Default        | Description                                                |
|----------------|--------|----------------|------------------------------------------------------------|
| renderQuality  | string | `"raytracing"` | Catalog entry id (e.g. `"octane"`, `"unreal"`).            |
| Pre Text       | text   | empty          | Free-form text prepended to the composed hint.             |
| Post Text      | text   | empty          | Free-form text appended to the composed hint.              |

## Catalog (24 entries)

Examples: `raytracing`, `path-tracing`, `octane`, `vray`, `arnold`, `redshift`, `unreal-engine`, `unity`, `blender-cycles`, `blender-eevee`, `keyshot`, `houdini`, `low-poly`, `voxel`, `nurbs`, `hand-drawn`, `painterly`, `procedural`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Product visualization (raytracing, octane, vray).
- Game-engine looks (unreal, unity).
- Artistic CG (low-poly, voxel, painterly).

## See Also

- [Style](./style.md), [Composition Effect](./composition-effects.md), [Post-Process Effect](./post-process-effects.md).
