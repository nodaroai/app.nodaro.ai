---
node_type: split-media
generated_at: 2026-05-18T13:23:37.554Z
generated_from: cb1e786d
---

# Split Media

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `split-media`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `video-in`, `audio-in`
**Outputs (source handles):** `video-out`, `audio-out`

**Required data fields:**
- `label: string`
- `chunkDuration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `audioFormat?: "mp3" | "wav" | "aac"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrls?: string[]`
- `generatedAudioUrls?: string[]`
- `selectedAudioChunks?: number[]`
- `selectedVideoChunks?: number[]`
- `outputChunkIndex?: number`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Split Media",
  "chunkDuration": 10,
  "audioFormat": "mp3",
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
  "id": "split-media-1",
  "type": "split-media",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Split Media",
    "chunkDuration": 10,
    "audioFormat": "mp3",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
