---
node_type: loop
generated_at: 2026-05-18T13:23:37.006Z
generated_from: cb1e786d
---

# loop (UI label "Table")

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `loop`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Default data:**
```json
{
  "label": "Table",
  "columns": [],
  "rows": [],
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Multi-column tabular data: shot lists, prop tables, character casting tables, scene-by-scene metadata. The UI calls this "Table" but the type string is `loop`.

For single-column lists (e.g., a list of prompts), use `list` instead — that's the dedicated single-column type.

## Common gotchas

- Each column's source handle id is the column's `handleId` field (use `col_<column_id>` convention). To wire a column's values into a downstream node, set `sourceHandle: "col_<id>"`. Omitting it connects to the default output, which loses column structure.
- Every row must be a fresh, distinct string array. Repeating the same row 3 times causes the frontend to render all 3 visually identical.
- The number of cells per row MUST equal the number of columns. Mismatched row lengths cause silent render failures.
- `viewMode` defaults to `"gallery"` ONLY when EVERY column is `image-url` type; otherwise defaults to `"list"`. Always set explicitly for shot-list-style tables.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "loop-1",
  "type": "loop",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Table",
    "columns": [],
    "rows": [],
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
