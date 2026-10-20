---
node_type: speaker-layout
generated_at: 2026-10-20T04:36:08.276Z
generated_from: d06754359
---

# Speaker Layout

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speaker-layout`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `media`, `masterAudio`
**Outputs (source handles):** `media`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mediaOrder?: string[]`
- `cameras?: UseCaseCamerasInput`
- `targetAspect?: "9:16" | "1:1" | "4:5" | "16:9"`
- `layout?: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"`
- `switchType?: string`
- `emphasisStyle?: string`
- `framingSource?: UseCaseFramingSource`
- `reviewBeforeRender?: boolean`
- `useCaseJobId?: string`
- `useCaseExecutionId?: string`
- `useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }`
- `generatedJson?: unknown`
- `generatedTranscript?: unknown`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `useCaseCameras?: UseCaseCamerasReport`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Speaker Layout",
  "targetAspect": "9:16",
  "layout": "stacked",
  "switchType": "cut",
  "emphasisStyle": "scale",
  "framingSource": "auto",
  "reviewBeforeRender": false,
  "fieldMappings": {},
  "executionStatus": "idle"
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
  "id": "speaker-layout-1",
  "type": "speaker-layout",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Speaker Layout",
    "targetAspect": "9:16",
    "layout": "stacked",
    "switchType": "cut",
    "emphasisStyle": "scale",
    "framingSource": "auto",
    "reviewBeforeRender": false,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
