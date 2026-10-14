---
node_type: suno-style-boost
generated_at: 2026-10-14T00:02:32.829Z
generated_from: b83a9467d
---

# Suno Style Boost

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-style-boost`
**Category:** ai
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `content: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Suno Style Boost",
  "content": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_style_boost`

**Input parameters:**
- `content`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-style-boost-1",
  "type": "suno-style-boost",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Style Boost",
    "content": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
