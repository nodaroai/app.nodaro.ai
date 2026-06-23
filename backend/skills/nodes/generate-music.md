---
node_type: generate-music
generated_at: 2026-06-23T20:58:11.976Z
generated_from: c4e4998f5
---

# generate-music

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-music`
**Category:** ai
**Credit cost:** 5
**Inputs (target handles):** `prompt`, `ref-audio`, `audio-style`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: MusicProvider`
- `duration: number`
- `genre: string`
- `mood: string`
- `instrumental: boolean`
- `lyrics: string`
- `referenceAudioUrl: string`
- `referenceYouTubeUrl: string`
- `referenceSource: "none" | "upload" | "youtube"`
- `modelVersion: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Generate Music",
  "prompt": "",
  "provider": "suno",
  "duration": 8,
  "genre": "",
  "mood": "",
  "instrumental": true,
  "lyrics": "",
  "referenceAudioUrl": "",
  "referenceYouTubeUrl": "",
  "referenceSource": "none",
  "modelVersion": "stereo-large",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_music`

**Input parameters:**
- `prompt`
- `presetId`
- `model`
- `duration`
- `instrumental`
- `lyrics`
- `genre`
- `mood`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Single soundtrack for the assembled video — after all video shots are approved. For the cinematic-flow default, this is the only audio node; voiceover / dialogue / SFX require additional node types outside the 8-node whitelist.

## Common gotchas

- Field name is `generatedAudioUrl`, NOT `audioUrl` or `musicUrl`.
- Determine mood + BPM from the script's emotional arc before calling — Suno responds to mood descriptors much more reliably than abstract style words.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-music-1",
  "type": "generate-music",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Music",
    "prompt": "",
    "provider": "suno",
    "duration": 8,
    "genre": "",
    "mood": "",
    "instrumental": true,
    "lyrics": "",
    "referenceAudioUrl": "",
    "referenceYouTubeUrl": "",
    "referenceSource": "none",
    "modelVersion": "stereo-large",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
