---
node_type: split-text
generated_at: 2026-10-05T21:37:07.951Z
generated_from: 066cc1460
---

# Split Text

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `split-text`
**Category:** utility
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `text`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `separator: string`
- `trimWhitespace: boolean`
- `removeEmpty: boolean`

**Optional data fields:**
- `customSeparator?: string`
- `splitResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Split Text",
  "separator": "newline",
  "customSeparator": "",
  "trimWhitespace": true,
  "removeEmpty": true
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
  "id": "split-text-1",
  "type": "split-text",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Split Text",
    "separator": "newline",
    "customSeparator": "",
    "trimWhitespace": true,
    "removeEmpty": true
  }
}
```
<!-- AUTO-GEN:END examples -->
