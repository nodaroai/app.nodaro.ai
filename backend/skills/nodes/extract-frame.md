---
node_type: extract-frame
generated_at: 2026-05-18T13:23:37.582Z
generated_from: cb1e786d
---

# Extract Frame

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extract-frame`
**Category:** processing
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `mode: "first" | "last" | "timestamp"`
- `timestamp: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Extract Frame",
  "mode": "first",
  "timestamp": 0,
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
**MCP tool:** `extract_frame`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `mode`
- `time_seconds`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "extract-frame-1",
  "type": "extract-frame",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extract Frame",
    "mode": "first",
    "timestamp": 0,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
