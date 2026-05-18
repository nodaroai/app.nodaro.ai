---
node_type: video-composer
generated_at: 2026-05-18T13:23:37.587Z
generated_from: cb1e786d
---

# Compose Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-composer`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `compositionPrompt: string`
- `fps: number`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `durationSeconds: number`
- `backgroundColor: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `sceneGraph?: Record<string, unknown>`
- `assetOrder?: string[]`
- `llmModel?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Compose Video",
  "compositionPrompt": "",
  "fps": 30,
  "aspectRatio": "16:9",
  "durationSeconds": 30,
  "backgroundColor": "#000000",
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
  "id": "video-composer-1",
  "type": "video-composer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Compose Video",
    "compositionPrompt": "",
    "fps": 30,
    "aspectRatio": "16:9",
    "durationSeconds": 30,
    "backgroundColor": "#000000",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
