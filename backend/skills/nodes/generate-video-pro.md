---
node_type: generate-video-pro
generated_at: 2026-07-22T11:03:06.109Z
generated_from: f35e9f9e6
---

# Generate Video Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-video-pro`
**Category:** ai
**Credit cost:** 82
**Inputs (target handles):** `prompt`, `negative`, `startFrame`, `endFrame`, `imageReferences`, `videoReferences`, `audio`, `audioReferences`, `assets`, `elements`, `look`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "seedance-2" | "seedance-2-fast"`
- `duration: number`

**Optional data fields:**
- `prompt?: string`
- `aspectRatio?: string`
- `resolution?: string`
- `generateAudio?: boolean`
- `noBackgroundMusic?: boolean`
- `negativePrompt?: string`
- `selectedStartFrameNodeId?: string | null`
- `referenceImageOrder?: string[]`
- `fieldMappings?: FieldMappings`
- `plannerModel?: string`
- `planOnly?: boolean`
- `contextTailSec?: number`
- `autoCastFromAnalysis?: boolean`
- `plannerMode?: "auto" | "fidelity" | "condense" | "anchored" | "hybrid" | "hybrid-plus" | "hybrid-max"`
- `rollingRefs?: boolean`
- `wordCut?: boolean`
- `shotTimestamps?: boolean`
- `preferredSegmentSec?: number`
- `audioTail?: boolean`
- `overlapAnchor?: boolean`
- `overlapAnchorMode?: "keyframe" | "last-frame"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedPlan?: Record<string, unknown>`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `gvpStopped?: boolean`
- `gvpStoppedAtSegment?: number`
- `gvpDeliveredSegments?: number`
- `gvpSegmentCount?: number`
- `gvpContinueFromJobId?: string`
- `gvpContinueFromSegment?: number`

**Default data:**
```json
{
  "label": "Generate Video Pro",
  "provider": "seedance-2",
  "prompt": "",
  "duration": 8,
  "aspectRatio": "adaptive",
  "resolution": "720p",
  "generateAudio": true,
  "noBackgroundMusic": false,
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
    "aspectRatio": "adaptive",
    "resolution": "720p",
    "generateAudio": true,
    "noBackgroundMusic": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
