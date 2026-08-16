---
node_type: preview
generated_at: 2026-08-15T21:55:09.341Z
generated_from: 150c80ac9
---

# Preview

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `preview`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `previewItems: PreviewItem[]`
- `itemOrder: string[]`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Preview",
  "previewItems": [],
  "itemOrder": []
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
  "id": "preview-1",
  "type": "preview",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Preview",
    "previewItems": [],
    "itemOrder": []
  }
}
```
<!-- AUTO-GEN:END examples -->
