---
node_type: generate-3d-scene
generated_at: 2026-11-25T18:01:29.677Z
generated_from: 1d6aa96028
---

# Generate 3D Scene

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-3d-scene`
**Category:** ai
**Credit cost:** `≈48` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — a call on any model is quoted by `GET /v1/credits/model-cost?model=3d-scene:<model id>` (MCP: `list_models` with `priceIds: ["3d-scene:<model id>"]`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`, `references`
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
- `inputAssets?: import("@nodaro/shared/scene3d").Scene3DInputAsset[]`
- `engine?: "basic" | "blender-cloud" | "blender-local"`
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

To previs an existing clip, wire a video-analysis node's `json` or `text` output into the `prompt` input: it is appended after scenePrompt (your directions), or placed where scenePrompt writes the source node's label in braces, e.g. `{Video Analysis}`. When the analysis would push the brief past 8,000 characters (a clip longer than a few seconds), wire the video itself into `references` instead: the node runs its own analysis and the planner reads it in full, outside the brief.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_3d_scene`

**Input parameters:**
- `prompt`
- `duration_seconds`
- `fps`
- `aspect_ratio`
- `input_assets`
- `engine`
- `accepted_scene_schema_versions`
- `local_connection_id`
- `max_repair_passes`
- `references`
- `llm_model`
- `reasoning_effort`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

References reconstruct an approximate scene of primitives. V1 supports at most eight references including one whole video; use trim-video first for a segment. Preserve appearance images for the final video model. The canvas stores scenePrompt, while the HTTP/MCP request uses prompt.

The brief (scenePrompt, any wired prompt and the pre/post text) holds at most 8,000 characters. A longer one is refused before anything is charged: the canvas and a workflow run say so, the route answers 400 `validation_error`. A Video Analysis pasted into scenePrompt counts against it too.

Every part of an assembly must set `parentId` to the group that moves it, with LOCAL coordinates. The Basic engine checks each new scene and sends it back for a repair pass (up to 2) when a group carries motion with nothing attached, or a camera shot shows no subject (scenery over 100 m that never moves does not count). Parts still unattached after the repairs fail the run. A shot that still misses its subject is delivered, with a `SCENE_SHOT_WITHOUT_SUBJECT` entry in `output_data.validation.warnings[]`: read it before paying for a render. `max_repair_passes` applies to advanced engines only; Basic ignores it and always allows up to 2.

Authoring is charged per token at the model's rate, and each repair pass is another full call: ≈48 credits<!-- credits: 3d-scene:claude-sonnet-5.5 --> for a typical scene on the default model, ≈233<!-- credits: 3d-scene:claude-opus-5.5:direct --> on Claude Opus 5.5 with a reasoning effort (any effort runs a Claude model on Anthropic's own API). Quote a model through the model-cost lookup named in the Credit cost line, adding `:direct` to the model id for a Claude model with an effort. A video reference's analysis and the MP4 export (render-video, **55 credits**<!-- credits: render-video --> up to 1920 px) are charged separately.

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
