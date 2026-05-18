---
node_type: loop
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# loop (UI label "Table")

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `loop`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** per-column `col_<id>` handles (dynamic — the static `NODE_DEFINITIONS.outputs` array is empty; handles are registered at runtime via `useUpdateNodeInternals` from the column definitions)

**Required data fields:**
- `label: string`
- `columns: Array<{ id: string, name: string, handleId: string, type: "text" | "image-url" | "video-url" | "audio-url" | "json" }>` (each column needs `handleId: "col_<id>"`)
- `rows: string[][]` (each inner array MUST match the column count; each row MUST be distinct content)
- `viewMode?: "list" | "gallery" | "packed"` (recommended: explicitly set `"list"` for tabular data)
- `fieldMappings: Record<string, string>` (use `{}` if no input wiring)

**Default data:**
```json
{ "label": "Table", "columns": [], "rows": [], "fieldMappings": {} }
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
  "id": "shots-1",
  "type": "loop",
  "position": { "x": 340, "y": 0 },
  "data": {
    "label": "Shot List",
    "columns": [
      { "id": "shot_id", "name": "Shot", "handleId": "col_shot_id", "type": "text" },
      { "id": "action",  "name": "Action", "handleId": "col_action", "type": "text" },
      { "id": "duration", "name": "Duration", "handleId": "col_duration", "type": "text" }
    ],
    "rows": [
      ["1", "Hero enters frame from left, suits up in cockpit", "5"],
      ["2", "Banking turn through canyon, tracers streak past", "5"],
      ["3", "Vertical climb into golden sunlight, cut to black", "5"]
    ],
    "viewMode": "list",
    "fieldMappings": {}
  }
}
```

Wiring the `action` column into a downstream generate-image node (one image per row):

```json
{ "id": "edge-action-to-scene1", "source": "shots-1", "sourceHandle": "col_action", "target": "scene-1", "targetHandle": "in" }
```
<!-- AUTO-GEN:END examples -->
