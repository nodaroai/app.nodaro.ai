---
node_type: generate-3d-scene
generated_at: 2026-09-07T13:21:36.701Z
generated_from: faf85b35e
---

# Generate 3D Scene

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-3d-scene`
**Category:** ai
**Credit cost:** 30
**Inputs (target handles):** `references`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `scenePrompt: string`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `scenePlan?: Record<string, unknown>`
- `sceneHistory?: Scene3DRevisionEntry[]`
- `sceneJobBaseRevisionId?: string`
- `scenePendingPlan?: Record<string, unknown>`
- `changeSummary?: string`
- `selectedObjectIds?: string[]`
- `lockedObjectIds?: string[]`
- `references?: Scene3DNodeReference[]`
- `referenceRoles?: Record<string, string>`
- `referenceObjectIds?: Record<string, string>`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Generate 3D Scene",
  "scenePrompt": "",
  "aspectRatio": "16:9",
  "fps": 24,
  "durationSeconds": 4,
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Use to block a shot before generating a final video: describe subjects, layout, timing and camera motion. Optional image references guide appearance/layout; one optional video guides motion. Returns an editable scenePlan, then render-video with planType 3d-scene exports MP4.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_3d_scene`

**Input parameters:**
- `prompt`
- `duration_seconds`
- `fps`
- `aspect_ratio`
- `references`
- `llm_model`
- `reasoning_effort`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

References reconstruct an approximate scene of primitives. V1 supports at most eight references including one whole video; use trim-video first for a segment. Preserve appearance images for the final video model. The canvas stores scenePrompt, while the HTTP/MCP request uses prompt. Authoring cost depends on the LLM; video analysis and MP4 rendering are separate.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-3d-scene-1",
  "type": "generate-3d-scene",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate 3D Scene",
    "scenePrompt": "",
    "aspectRatio": "16:9",
    "fps": 24,
    "durationSeconds": 4,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
