---
node_type: ugc-script
generated_at: 2026-10-12T22:47:10.654Z
generated_from: b013948e0
---

# UGC Script

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-script`
**Category:** ai
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `site`, `screenshot`, `screenshot2`, `screenshot3`, `screenshot4`, `screenshot5`, `screenshot6`, `screenshot7`, `screenshot8`, `product`
**Outputs (source handles):** `plan`, `category`

**Required data fields:**
- `label: string`
- `targetDurationSec: number`
- `keepResult: boolean`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `language?: UgcScriptLanguage`
- `result?: { plan: Record<string, unknown>; productCategory: string; warnings: unknown[]; notes: string[]; rounds: number }`
- `exampleLines?: readonly string[]`
- `ugcOutputs?: Record<string, string>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Script",
  "targetDurationSec": 15,
  "keepResult": false,
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
  "id": "ugc-script-1",
  "type": "ugc-script",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Script",
    "targetDurationSec": 15,
    "keepResult": false,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
