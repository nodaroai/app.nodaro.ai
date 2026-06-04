---
node_type: generative-pipeline
generated_at: 2026-06-04T12:41:29.378Z
generated_from: 9bf1388db
---

# Story → Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generative-pipeline`
**Category:** scene
**Credit cost:** 30
**Inputs (target handles):** `story_prompt`
**Outputs (source handles):** `final_video`

**Optional data fields:**
- `label?: string`
- `story_prompt?: string`
- `target_duration_seconds?: number`
- `format?: PipelineFormat`
- `output_resolution?: "480p" | "720p" | "1080p" | "4K"`
- `mode?: PipelineMode`
- `video_critic_frame_count?: VideoCriticFrameMode`
- `image_model?: PipelinePinnableImageModel`
- `video_model?: PipelinePinnableVideoModel`
- `script_llm?: PipelinePinnableScriptLlm`
- `stage_models?: {
    characters_image?: PipelinePinnableImageModel
    locations_image?: PipelinePinnableImageModel
    objects_image?: PipelinePinnableImageModel
    scene_keyframes_image?: PipelinePinnableImageModel
    shots_video?: PipelinePinnableVideoModel
    script_llm?: PipelinePinnableScriptLlm
  }`
- `pipeline_id?: string`
- `status?: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled"`
- `current_stage?: string | null`

**Default data:**
```json
{
  "label": "Story → Video",
  "target_duration_seconds": 35,
  "format": "short_film",
  "output_resolution": "720p",
  "mode": "manual"
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
  "id": "generative-pipeline-1",
  "type": "generative-pipeline",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Story → Video",
    "target_duration_seconds": 35,
    "format": "short_film",
    "output_resolution": "720p",
    "mode": "manual"
  }
}
```
<!-- AUTO-GEN:END examples -->
