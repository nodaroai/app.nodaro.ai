---
node_type: generate-video-pro
generated_at: 2026-07-13T22:36:16.472Z
generated_from: dbf9c8d98
---

# Generate Video Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-video-pro`
**Category:** ai
**Credit cost:** 82
**Inputs (target handles):** `prompt`, `negative`, `startFrame`, `endFrame`, `imageReferences`, `videoReferences`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "seedance-2" | "seedance-2-fast" | "seedance-2-mini"`
- `duration: number`

**Optional data fields:**
- `prompt?: string`
- `aspectRatio?: string`
- `resolution?: string`
- `generateAudio?: boolean`
- `selectedStartFrameNodeId?: string | null`
- `referenceImageOrder?: string[]`
- `fieldMappings?: FieldMappings`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Generate Video Pro",
  "provider": "seedance-2",
  "prompt": "",
  "duration": 8,
  "resolution": "720p",
  "generateAudio": true,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
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
  "id": "generate-video-pro-1",
  "type": "generate-video-pro",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Video Pro",
    "provider": "seedance-2",
    "prompt": "",
    "duration": 8,
    "resolution": "720p",
    "generateAudio": true,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
