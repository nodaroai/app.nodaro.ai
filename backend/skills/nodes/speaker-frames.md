---
node_type: speaker-frames
generated_at: 2026-10-09T11:07:29.087Z
generated_from: 2c74d4b4d
---

# Speaker Frames

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speaker-frames`
**Category:** processing
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `edl`, `video`, `transcript`
**Outputs (source handles):** `tracks`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `excludeSourceIds?: string[]`
- `trackAssignments?: Array<{ trackId: string; speaker: string | null }>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: unknown`

**Default data:**
```json
{
  "label": "Speaker Frames",
  "fieldMappings": {},
  "executionStatus": "idle"
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
  "id": "speaker-frames-1",
  "type": "speaker-frames",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Speaker Frames",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
