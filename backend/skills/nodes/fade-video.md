---
node_type: fade-video
generated_at: 2026-05-18T13:23:37.640Z
generated_from: cb1e786d
---

# Fade In/Out

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `fade-video`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `fadeIn: boolean`
- `fadeInDuration: number`
- `fadeOut: boolean`
- `fadeOutDuration: number`
- `color: "black" | "white"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Fade In/Out",
  "fadeIn": true,
  "fadeInDuration": 0.5,
  "fadeOut": true,
  "fadeOutDuration": 0.5,
  "color": "black",
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
  "id": "fade-video-1",
  "type": "fade-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Fade In/Out",
    "fadeIn": true,
    "fadeInDuration": 0.5,
    "fadeOut": true,
    "fadeOutDuration": 0.5,
    "color": "black",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
