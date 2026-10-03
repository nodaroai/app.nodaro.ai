---
node_type: upload-image
generated_at: 2026-09-27T12:51:22.178Z
generated_from: c607aa02c
---

# Upload Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `upload-image`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

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
    format?: string
  }`

**Optional data fields:**
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `moderationStatus?: "checking" | "ok" | "blocked"`
- `moderationReason?: string`

**Default data:**
```json
{
  "label": "Upload Image",
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
  "id": "upload-image-1",
  "type": "upload-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Upload Image",
    "assetId": "",
    "url": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
