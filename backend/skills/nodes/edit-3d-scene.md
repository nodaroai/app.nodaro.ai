---
node_type: edit-3d-scene
generated_at: 2026-10-20T21:12:34.690Z
generated_from: 9ae3392be
---

# Edit 3D Scene

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `edit-3d-scene`
**Category:** ai
**Credit cost:** `≈6` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — a call on any model is quoted by `GET /v1/credits/model-cost?model=3d-scene:<model id>` (MCP: `list_models` with `priceIds: ["3d-scene:<model id>"]`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `scene`, `references`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `editPrompt: string`

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
- `engine?: "basic" | "blender-cloud" | "blender-local"`
- `replaceReferences?: boolean`
- `expectedRevisionId?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Edit 3D Scene",
  "editPrompt": "",
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Use to revise an existing scenePlan with a prompt or deterministic operations. Pass the current revisionId as expectedRevisionId. Keep object IDs stable, and pass lockedObjectIds for objects that must remain unchanged. The result is a new scene revision.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `edit_3d_scene`

**Input parameters:**
- `scene_plan`
- `expected_revision_id`
- `replace_references`
- `prompt`
- `operations`
- `locked_object_ids`
- `selected_object_ids`
- `engine`
- `accepted_scene_schema_versions`
- `local_connection_id`
- `max_repair_passes`
- `references`
- `llm_model`
- `reasoning_effort`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

A video alone is not editable geometry: reconstruct it with generate-3d-scene first. Operations have no LLM charge. New references merge by ID with the source references. Animated poses require keyframe changes; canvas controls edit the current frame. Late job results are retained without replacing newer manual edits.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "edit-3d-scene-1",
  "type": "edit-3d-scene",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Edit 3D Scene",
    "editPrompt": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
