---
node_type: video-sfx
generated_at: 2026-10-14T00:02:31.742Z
generated_from: b83a9467d
---

# Video SFX

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-sfx`
**Category:** ai
**Credit cost:** `11-121` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`, `negative`, `video`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "replicate-mmaudio"`
- `versions: number`
- `prompt: string`
- `negativePrompt: string`
- `cfgStrength: number`
- `numSteps: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `seed?: number`
- `videoUrl?: string`
- `activeResultIndex?: number`
- `generatedResults?: GeneratedResult[]`
- `generatedVideoUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`
- `promptPrefix?: string`
- `promptSuffix?: string`

**Default data:**
```json
{
  "label": "Video SFX",
  "provider": "replicate-mmaudio",
  "versions": 1,
  "prompt": "",
  "negativePrompt": "music",
  "cfgStrength": 4.5,
  "numSteps": 25,
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
  "id": "video-sfx-1",
  "type": "video-sfx",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video SFX",
    "provider": "replicate-mmaudio",
    "versions": 1,
    "prompt": "",
    "negativePrompt": "music",
    "cfgStrength": 4.5,
    "numSteps": 25,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
