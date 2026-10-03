---
node_type: save-to-storage
generated_at: 2026-09-27T12:51:24.765Z
generated_from: c607aa02c
---

# Save to Storage

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `save-to-storage`
**Category:** output
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `asset`

**Required data fields:**
- `label: string`
- `filename: string`
- `format: "mp4" | "webm" | "mov"`
- `quality: "draft" | "standard" | "high" | "4k"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `savedUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`

**Default data:**
```json
{
  "label": "Save to Storage",
  "filename": "",
  "format": "mp4",
  "quality": "standard",
  "fieldMappings": {}
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
  "id": "save-to-storage-1",
  "type": "save-to-storage",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Save to Storage",
    "filename": "",
    "format": "mp4",
    "quality": "standard",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
