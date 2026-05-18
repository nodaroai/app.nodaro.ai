---
node_type: generate-music
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# generate-music

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-music`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields (config):**
- `label: string`
- `prompt: string`
- `provider: string` — `"suno"`
- `duration: number` — seconds
- `genre: string`
- `mood: string`
- `instrumental: boolean`
- `lyrics: string` (empty string OK when `instrumental: true`)
- `referenceAudioUrl: string` (empty string OK)
- `referenceYouTubeUrl: string` (empty string OK)
- `referenceSource: "none" | "upload" | "youtube"`
- `modelVersion: string`
- `fieldMappings: Record<string, string>`

**Required result fields (when attaching a completed generation):**
- `executionStatus: "completed"`
- `generatedAudioUrl: string` — exact field name (NOT `audioUrl`, NOT `musicUrl`)

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`

**Default data:**
```json
{ "label": "Generate Music", "prompt": "", "provider": "suno", "duration": 8, "genre": "", "mood": "", "instrumental": true, "lyrics": "", "referenceAudioUrl": "", "referenceYouTubeUrl": "", "referenceSource": "none", "modelVersion": "stereo-large", "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_music` (Suno backend)

Call the tool with prompt + duration + mood. Capture the response URL and write it to `data.generatedAudioUrl`.
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
  "id": "music-1",
  "type": "generate-music",
  "position": { "x": 1360, "y": 280 },
  "data": {
    "label": "Soundtrack",
    "prompt": "Tense orchestral build, 90 BPM, builds to climactic finale",
    "provider": "suno",
    "duration": 30,
    "genre": "orchestral",
    "mood": "tense",
    "instrumental": true,
    "lyrics": "",
    "referenceAudioUrl": "",
    "referenceYouTubeUrl": "",
    "referenceSource": "none",
    "modelVersion": "stereo-large",
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedAudioUrl": "https://r2.nodaro.ai/jobs/ghi789/output.mp3",
    "generatedResults": [
      { "url": "https://r2.nodaro.ai/jobs/ghi789/output.mp3", "jobId": "ghi789", "timestamp": "2026-05-18T12:10:00Z" }
    ],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
