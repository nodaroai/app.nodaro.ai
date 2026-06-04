---
node_type: list
generated_at: 2026-06-04T12:41:28.155Z
generated_from: 9bf1388db
---

# List

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `list`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Required data fields:**
- `label: string`
- `fieldMappings: Record<string, string>`

**Optional data fields:**
- `items?: string`
- `columns?: LoopColumn[]`
- `rows?: string[][]`
- `maxItems?: number`
- `showData?: boolean`
- `thumbnailSize?: "sm" | "md" | "lg"`
- `galleryCols?: number`
- `viewMode?: "list" | "gallery" | "packed"`
- `textMaxLines?: number`
- `textFontSize?: TextFontSize`

**Default data:**
```json
{
  "label": "List",
  "columns": [
    {
      "id": "default",
      "name": "Items",
      "handleId": "col_default",
      "type": "text"
    }
  ],
  "rows": [
    [
      ""
    ]
  ],
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
  "id": "list-1",
  "type": "list",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "List",
    "columns": [
      {
        "id": "default",
        "name": "Items",
        "handleId": "col_default",
        "type": "text"
      }
    ],
    "rows": [
      [
        ""
      ]
    ],
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
