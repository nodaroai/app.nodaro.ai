---
node_type: manual-edit
generated_at: 2026-05-18T13:23:37.654Z
generated_from: cb1e786d
---

# Manual Edit

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `manual-edit`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mode?: "bypass" | "wait"`
- `editorLoad?: "first" | "all"`
- `executionStatus?: "idle" | "running" | "awaiting-user" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `inputVideoUrl?: string`
- `inputAssets?: Array<{ nodeId: string; url: string; type: "video" | "image" | "audio"; label?: string }>`
- `isEditorOpen?: boolean`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Manual Edit",
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
  "id": "manual-edit-1",
  "type": "manual-edit",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Manual Edit",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
