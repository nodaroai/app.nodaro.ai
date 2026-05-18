---
node_type: image-to-text
generated_at: 2026-05-18T13:23:37.471Z
generated_from: cb1e786d
---

# Describe Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-to-text`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `image`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `detailLevel: "brief" | "detailed" | "structured"`
- `customPrompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `llmModel?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; jobId: string; timestamp: string }>`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Describe Image",
  "detailLevel": "detailed",
  "customPrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `image_to_text`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `detail_level`
- `custom_prompt`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "image-to-text-1",
  "type": "image-to-text",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Describe Image",
    "detailLevel": "detailed",
    "customPrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
