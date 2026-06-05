---
node_type: ai-avatar
generated_at: 2026-06-04T23:31:50.579Z
generated_from: 12d6438a
---

# AI Avatar

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ai-avatar`
**Category:** ai
**Credit cost:** 9
**Inputs (target handles):** `script`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "heygen"`
- `engine: "avatar-v" | "avatar-iv"`
- `avatarId: string`
- `speechMode: "text" | "audio"`
- `resolution: "720p" | "1080p" | "4k"`
- `aspectRatio: "16:9" | "9:16"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `avatarGroupId?: string`
- `avatarName?: string`
- `avatarPreviewUrl?: string`
- `script?: string`
- `voiceId?: string`
- `voiceName?: string`
- `voiceSpeed?: number`
- `audioUrl?: string`
- `caption?: boolean`
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
  "label": "AI Avatar",
  "provider": "heygen",
  "engine": "avatar-iv",
  "avatarId": "",
  "speechMode": "text",
  "resolution": "720p",
  "aspectRatio": "16:9",
  "caption": false,
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
  "id": "ai-avatar-1",
  "type": "ai-avatar",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "AI Avatar",
    "provider": "heygen",
    "engine": "avatar-iv",
    "avatarId": "",
    "speechMode": "text",
    "resolution": "720p",
    "aspectRatio": "16:9",
    "caption": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
