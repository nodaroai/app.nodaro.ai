---
node_type: face
generated_at: 2026-09-27T12:51:24.836Z
generated_from: c607aa02c
---

# Face

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `face`
**Category:** face
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `faceRef`

**Required data fields:**
- `label: string`
- `faceDbId: string`
- `faceName: string`
- `description: string`
- `sourceImageUrl: string`
- `style: EntityArtStyle`
- `projectId: string`
- `createdAt: string`
- `executionStatus: "idle" | "running" | "completed" | "failed"`
- `generatedResults: GeneratedResult[]`
- `activeResultIndex: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `provider?: string`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Face",
  "faceDbId": "",
  "faceName": "",
  "description": "",
  "sourceImageUrl": "",
  "style": "realistic",
  "projectId": "",
  "createdAt": "",
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0,
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
  "id": "face-1",
  "type": "face",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Face",
    "faceDbId": "",
    "faceName": "",
    "description": "",
    "sourceImageUrl": "",
    "style": "realistic",
    "projectId": "",
    "createdAt": "",
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
