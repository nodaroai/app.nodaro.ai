---
node_type: upload-video
generated_at: 2026-05-18T13:23:37.025Z
generated_from: cb1e786d
---

# Upload Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `upload-video`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `assetId: string`
- `url: string`
- `r2Url: string`
- `thumbnailUrl: string`
- `filename: string`
- `fileSize: number`
- `mimeType: string`
- `externalUrl: string`
- `isUploading: boolean`
- `uploadError: string`
- `metadata: {
    width?: number
    height?: number
    durationSeconds?: number
    codec?: string
  }`

**Optional data fields:**
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Upload Video",
  "assetId": "",
  "url": ""
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
  "id": "upload-video-1",
  "type": "upload-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Upload Video",
    "assetId": "",
    "url": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
