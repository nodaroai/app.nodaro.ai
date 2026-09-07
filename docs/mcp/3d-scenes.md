# Editable 3D scenes through MCP

Three tools expose the same scene authoring and rendering operations as the canvas. They require `workflows:execute` scope.

| Tool | Purpose |
|---|---|
| `generate_3d_scene` | Prompt and optional image/video references → editable scene job |
| `edit_3d_scene` | Scene plan, expected revision and instruction/operations → new revision job |
| `render_3d_scene` | Exact scene revision → MP4 through the existing Render Video engine |

Each returns a job ID. Use `get_job` or `wait_for_job` to retrieve the completed result. Generation/edit jobs return `output_data.scenePlan`; rendering returns a video URL.

1. Call `generate_3d_scene` with a shot description, `duration_seconds`, `fps` and `aspect_ratio`.
2. Retrieve `scenePlan` from the completed job. Optional references use `{ id, url, kind, role }`, with image/video kind and appearance/layout/motion role.
3. Call `edit_3d_scene` with that object as `scene_plan`, its `revisionId` as `expected_revision_id`, and either an edit `prompt` or `operations`. Supply `locked_object_ids` to preserve objects.
4. Call `render_3d_scene` with the resulting `scene_plan`.
5. Use the MP4 as a video reference in an existing video-generation tool. Continue passing the original appearance image references as appropriate.

`render_3d_scene` is an MCP convenience tool for the existing `render-video` node, not a separate canvas node. It does not call an LLM. Editing operations avoid an LLM call as well. The initial version supports primitive geometry and deterministic keyframed animation; reference reconstruction is approximate.

For the exact schema and current defaults, use `get_node_skill` with `generate-3d-scene` or `edit-3d-scene`. See [Generate 3D Scene](../nodes/composition/generate-3d-scene.md) and [Edit 3D Scene](../nodes/composition/edit-3d-scene.md).

V1 uses the whole video reference. For a segment, trim the clip first and supply the trimmed video URL. Partial reference time windows are rejected before authoring is charged.
