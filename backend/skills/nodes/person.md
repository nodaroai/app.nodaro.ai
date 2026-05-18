---
node_type: person
generated_at: 2026-05-18T13:23:37.209Z
generated_from: cb1e786d
---

# Person

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `person`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `type?: string`
- `age?: string`
- `customAge?: number`
- `ethnicity?: string | ReadonlyArray<string>`
- `regionalAesthetic?: string | ReadonlyArray<string>`
- `build?: string`
- `bodyProportions?: string`
- `faceShape?: string`
- `jawline?: string`
- `eyeShape?: string`
- `nose?: string`
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
