---
node_type: generate-video-pro
generated_at: 2026-09-27T12:51:23.252Z
generated_from: c607aa02c
---

# Generate Video Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-video-pro`
**Category:** ai
**Credit cost:** `100` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`, `negative`, `startFrame`, `endFrame`, `imageReferences`, `videoReferences`, `audio`, `audioReferences`, `assets`, `elements`, `look`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: VideoGenProvider`
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
- `renderMethod?: "extend" | "keyframes"`
- `anchorMode?: "auto" | "start-end" | "start-only" | "reference"`
- `autoCastFromAnalysis?: boolean`
- `plannerMode?: "auto" | "fidelity" | "condense" | "anchored" | "hybrid" | "hybrid-plus" | "hybrid-max"`
- `rollingRefs?: boolean`
- `wordCut?: boolean`
- `shotTimestamps?: boolean`
- `segmentMode?: "short" | "long" | "max"`
- `sourceSegmentDurations?: number[]`
- `preferredSegmentSec?: number`
- `segmentDurations?: number[]`
- `audioTail?: boolean`
- `overlapAnchor?: boolean`
- `overlapAnchorMode?: "keyframe" | "last-frame"`
- `smartCutMode?: "legacy-8x8" | "preroll-keep-prev" | "preroll-keep-next"`
- `smartCutAudio?: boolean`
- `smartCutFramesPrev?: number`
- `smartCutFramesNext?: number`
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
- `contentPolicyRewrites?: ContentPolicyRewriteEntry[]`
- `gvpContinueFromJobId?: string`
- `gvpContinueFromSegment?: number`
- `promptPrefix?: string`
- `promptSuffix?: string`

**Default data:**
```json
{
  "label": "Generate Video Pro",
  "provider": "seedance-2",
  "prompt": "",
  "duration": 8,
  "segmentMode": "max",
  "renderMethod": "keyframes",
  "anchorMode": "start-only",
  "plannerModel": "claude-fable-5",
  "plannerMode": "auto",
  "rollingRefs": true,
  "audioTail": true,
  "overlapAnchor": true,
  "overlapAnchorMode": "last-frame",
  "smartCutMode": "legacy-8x8",
  "smartCutFramesPrev": 8,
  "smartCutFramesNext": 8,
  "injectLook": true,
  "injectElements": true,
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
    "segmentMode": "max",
    "renderMethod": "keyframes",
    "anchorMode": "start-only",
    "plannerModel": "claude-fable-5",
    "plannerMode": "auto",
    "rollingRefs": true,
    "audioTail": true,
    "overlapAnchor": true,
    "overlapAnchorMode": "last-frame",
    "smartCutMode": "legacy-8x8",
    "smartCutFramesPrev": 8,
    "smartCutFramesNext": 8,
    "injectLook": true,
    "injectElements": true,
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
