---
node_type: cinematic-avatar
generated_at: 2026-10-14T00:02:36.756Z
generated_from: b83a9467d
---

# Cinematic Avatar

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `cinematic-avatar`
**Category:** ai
**Credit cost:** `330-1815` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`, `ref-video`, `ref-audio`, `ref-image`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "heygen"`
- `prompt: string`
- `avatarLooks: string[]`
- `aspectRatio: "16:9" | "9:16" | "1:1"`
- `resolution: "720p" | "1080p"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `avatarLookNames?: string[]`
- `duration?: number`
- `autoDuration?: boolean`
- `enhancePrompt?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Cinematic Avatar",
  "provider": "heygen",
  "prompt": "",
  "avatarLooks": [],
  "duration": 10,
  "autoDuration": false,
  "aspectRatio": "16:9",
  "resolution": "720p",
  "enhancePrompt": false,
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
  "id": "cinematic-avatar-1",
  "type": "cinematic-avatar",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Cinematic Avatar",
    "provider": "heygen",
    "prompt": "",
    "avatarLooks": [],
    "duration": 10,
    "autoDuration": false,
    "aspectRatio": "16:9",
    "resolution": "720p",
    "enhancePrompt": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
