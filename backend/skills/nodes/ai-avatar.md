---
node_type: ai-avatar
generated_at: 2026-06-05T12:17:21.812Z
generated_from: e5d0c6a2
---

# AI Avatar

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ai-avatar`
**Category:** ai
**Credit cost:** 9
**Inputs (target handles):** `script`, `audio`, `image`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "heygen"`
- `avatarSource: "avatar" | "image"`
- `engine: "avatar-v" | "avatar-iv"`
- `avatarId: string`
- `speechMode: "text" | "audio"`
- `resolution: "720p" | "1080p" | "4k"`
- `aspectRatio: "16:9" | "9:16"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `imageUrl?: string`
- `avatarGroupId?: string`
- `avatarName?: string`
- `avatarPreviewUrl?: string`
- `avatarSupportsV?: boolean`
- `script?: string`
- `voiceId?: string`
- `voiceName?: string`
- `voiceSpeed?: number`
- `pitch?: number`
- `volume?: number`
- `locale?: string`
- `ttsEngine?: | {
        engine_type: "elevenlabs"
        model?: "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_flash_v2_5" | "eleven_v3"
        stability?: number
        similarityBoost?: number
        style?: number
        useSpeakerBoost?: boolean
      }
    | {
        engine_type: "fish"
        model?: "s1" | "s2-pro"
        stability?: number
        similarity?: number
      }
    | { engine_type: "starfish" }`
- `audioUrl?: string`
- `background?: {
    type: "color" | "image"
    value?: string                 // hex colour when type="color"
    url?: string                   // image URL when type="image"
  }`
- `removeBackground?: boolean`
- `motionPrompt?: string`
- `expressiveness?: "high" | "medium" | "low"`
- `fit?: "cover" | "contain"`
- `outputFormat?: "mp4" | "webm"`
- `caption?: boolean`
- `captionStyle?: "default"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `warningMessage?: string`
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
  "avatarSource": "avatar",
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
    "avatarSource": "avatar",
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
