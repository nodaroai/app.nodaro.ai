---
node_type: camera-switch
generated_at: 2026-10-03T19:13:49.896Z
generated_from: 17d734b63
---

# Camera Switch

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `camera-switch`
**Category:** processing
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `edl`, `transcript`
**Outputs (source handles):** `edl`, `transcript`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `speakerMap?: Record<string, string>`
- `speakerNames?: Record<string, string>`
- `minShotMs?: number`
- `leadMs?: number`
- `maxShotMs?: number`
- `wideEvery?: number`
- `layoutHints?: boolean`
- `edl?: unknown`
- `transcript?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: { edl?: unknown; transcript?: unknown }`

**Default data:**
```json
{
  "label": "Camera Switch",
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
  "id": "camera-switch-1",
  "type": "camera-switch",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Camera Switch",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
