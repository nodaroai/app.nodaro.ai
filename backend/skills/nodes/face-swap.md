---
node_type: face-swap
generated_at: 2026-05-18T20:51:28.965Z
generated_from: af4193bd
---

# Face Swap

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `face-swap`
**Category:** ai
**Credit cost:** 16
**Inputs (target handles):** `face`, `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `provider: FaceSwapProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Face Swap",
  "provider": "roop",
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
**MCP tool:** `face_swap`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `face_image_url`
- `face_image_asset_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "face-swap-1",
  "type": "face-swap",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Face Swap",
    "provider": "roop",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
