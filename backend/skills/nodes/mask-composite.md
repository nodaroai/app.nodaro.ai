---
node_type: mask-composite
generated_at: 2026-10-11T22:44:52.434Z
generated_from: 468a178c9
---

# Mask Composite

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `mask-composite`
**Category:** processing
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`, `background-video`, `mask-video`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `invertMask: boolean`
- `feather: number`
- `grow: number`
- `backgroundFit: MaskCompositeBackgroundFit`
- `audioSource: MaskCompositeAudioSource`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Mask Composite",
  "invertMask": false,
  "feather": 2,
  "grow": 0,
  "backgroundFit": "cover",
  "audioSource": "foreground",
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
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
  "id": "mask-composite-1",
  "type": "mask-composite",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Mask Composite",
    "invertMask": false,
    "feather": 2,
    "grow": 0,
    "backgroundFit": "cover",
    "audioSource": "foreground",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
