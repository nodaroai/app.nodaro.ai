---
node_type: ugc-clip
generated_at: 2026-10-10T19:46:44.543Z
generated_from: e2b3544e2
---

# UGC Clip

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-clip`
**Category:** ai
**Credit cost:** `per-clip` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `clip`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `rerender: Record<string, number>`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `rerenderPending?: Record<string, true>`
- `warnings?: string[]`
- `clipWarnings?: string[]`
- `durationSec?: number`
- `ugcOutputs?: Record<string, string>`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `__listResults?: string[]`
- `__listResultMeta?: FanOutItemMeta[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Clip",
  "rerender": {},
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
  "id": "ugc-clip-1",
  "type": "ugc-clip",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Clip",
    "rerender": {},
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
