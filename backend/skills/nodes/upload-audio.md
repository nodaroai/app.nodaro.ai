---
node_type: upload-audio
generated_at: 2026-05-18T13:23:37.030Z
generated_from: cb1e786d
---

# Upload Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `upload-audio`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `assetId: string`
- `url: string`
- `r2Url: string`
- `filename: string`
- `fileSize: number`
- `mimeType: string`
- `externalUrl: string`
- `isUploading: boolean`
- `uploadError: string`
- `metadata: {
    durationSeconds?: number
    codec?: string
    sampleRate?: number
  }`

**Default data:**
```json
{
  "label": "Upload Audio",
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
  "id": "upload-audio-1",
  "type": "upload-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Upload Audio",
    "assetId": "",
    "url": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
