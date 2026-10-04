---
node_type: assemble-narrated-video
generated_at: 2026-10-04T11:03:01.557Z
generated_from: 7d3b3cf86
---

# Assemble Narrated Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `assemble-narrated-video`
**Category:** processing
**Credit cost:** `40-130` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `voiceVolume: number`
- `clipAudioVolume: number`
- `maxSlowdown: number`
- `trimStartFrames: number`
- `trimEndFrames: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Assemble Narrated Video",
  "voiceVolume": 100,
  "clipAudioVolume": 40,
  "maxSlowdown": 1.5,
  "trimStartFrames": 0,
  "trimEndFrames": 0,
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
  "id": "assemble-narrated-video-1",
  "type": "assemble-narrated-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Assemble Narrated Video",
    "voiceVolume": 100,
    "clipAudioVolume": 40,
    "maxSlowdown": 1.5,
    "trimStartFrames": 0,
    "trimEndFrames": 0,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
