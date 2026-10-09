---
node_type: person
generated_at: 2026-10-08T22:50:03.364Z
generated_from: ae4e7e3d0
---

# Person

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `person`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `picker-json`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `type?: string`
- `age?: string`
- `customAge?: number`
- `ethnicity?: string | ReadonlyArray<string>`
- `regionalAesthetic?: string | ReadonlyArray<string>`
- `frame?: string`
- `bodyMass?: string`
- `bust?: string`
- `waist?: string`
- `hips?: string`
- `silhouette?: string`
- `faceShape?: string`
- `jawline?: string`
- `cheekbones?: string`
- `facialFullness?: string`
- `eyeShape?: string`
- `eyelidType?: string`
- `canthalTilt?: string`
- `eyeSpacing?: string`
- `eyeSetBrow?: string`
- `nose?: string`
- `noseTip?: string`
- `lipFullness?: string`
- `lipShape?: string`
- `lips?: string`
- `lipState?: string | ReadonlyArray<string>`
- `hairColor?: string | ReadonlyArray<string>`
- `hairBase?: string`
- `eyebrows?: string`
- `skinTone?: string`
- `skinTexture?: string | ReadonlyArray<string>`
- `eyeColor?: string | ReadonlyArray<string>`
- `eyeState?: string | ReadonlyArray<string>`
- `facialHair?: string`
- `distinctiveFeature?: string | ReadonlyArray<string>`
- `preText?: string`
- `postText?: string`
- `maxItemsPerRow?: number`
- `applyMode?: PickerApplyMode`
- `autoApplyInjected?: boolean`
- `lastAppliedPickerJson?: Record<string, unknown>`
- `lastAppliedPickerRunId?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("person")` (MCP) or `GET /v1/picker-catalogs/person` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Person",
  "type": "stylish-influencer",
  "age": "age-early-20s",
  "maxItemsPerRow": 2
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "person-1",
  "type": "person",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Person",
    "type": "stylish-influencer",
    "age": "age-early-20s",
    "maxItemsPerRow": 2
  }
}
```
<!-- AUTO-GEN:END examples -->
