# Editable 3D scenes through MCP

These tools expose the same scene authoring and rendering operations as the canvas. They require `workflows:execute` scope.

| Tool | Purpose |
|---|---|
| `generate_3d_scene` | Prompt and optional image/video references → editable scene job |
| `edit_3d_scene` | Scene plan, expected revision and instruction/operations → new revision job |
| `render_3d_scene` | Exact scene revision → MP4 through the existing Render Video engine |
| `pro_3d_render` | A `source` (new brief, existing revision, or desktop export) → ONE job returning both the composition and the MP4 (listed only where the deployment can serve it) |

Each returns a job ID. Use `get_job` or `wait_for_job` to retrieve the completed result. Generation/edit jobs return `output_data.scenePlan`; rendering returns a video URL.

Generate and edit accept `engine` (`basic`, `blender-cloud`, or `blender-local`),
`accepted_scene_schema_versions`, `local_connection_id`, and
`max_repair_passes`. Optional engines must be available on the deployment;
an unavailable selection never falls back to Basic. Advanced uses its fixed
planner, so omit `llm_model` and `reasoning_effort` on that lane.

Generate also accepts `input_assets`: up to eight existing GLB selectors with
the shared shape `{id, revisionId, assetId, label?}`. Keep image/video inputs in
`references`. Imported assets require an advanced engine with import support;
unavailable imports are refused before charging. The server resolves byte
receipts, so do not send URLs or hashes. Edit retains its existing construction
inputs and accepts `replace_references` to replace its image/video list.

1. Call `generate_3d_scene` with a shot description, `duration_seconds`, `fps` and `aspect_ratio`.
2. Retrieve `scenePlan` from the completed job. Optional references use `{ id, url, kind, role }`, with image/video kind and appearance/layout/motion role.
3. Call `edit_3d_scene` with that object as `scene_plan`, its `revisionId` as `expected_revision_id`, and either an edit `prompt` or `operations`. Supply `locked_object_ids` to preserve objects.
4. Call `render_3d_scene` with the resulting `scene_plan`.
5. Use the MP4 as a video reference in an existing video-generation tool. Continue passing the original appearance image references as appropriate.

`render_3d_scene` is an MCP convenience tool for the existing `render-video` node, not a separate canvas node. It does not call an LLM. Editing operations avoid an LLM call as well. The initial version supports primitive geometry and deterministic keyframed animation; reference reconstruction is approximate.

## 3D Render Pro

`pro_3d_render` is a different operation, not a flag on `generate_3d_scene`: one
job produces a finished shot, and its completed `output_data` carries BOTH
`scenePlan` and `videoUrl` (plus the revision, poster, validation and renderer
metadata).

Its `source` argument is exactly one of:

- `{kind:"prompt", prompt, references?, input_assets?}` — author a new scene, then render it. Selectors use the same shape and restrictions as generate.
- `{kind:"scene", revision_id, source_job_id}` — **render-only** export of that
  revision. Adding `edit_prompt` revises it first, which costs authoring; OMIT
  the field for a plain export. `source_job_id` is required for Basic scenes
  retained only in job history; it is optional for retained revisions, which
  are authorized through current scene permissions.
- `{kind:"local-export", export_id, connection_id}` — a paired desktop export,
  where that is available.

Omit `duration_seconds` / `fps` / `aspect_ratio` for a scene source unless you
are deliberately re-timing it; a conflicting override is rejected. The
`max_repair_passes` argument (0–2) is the correction budget, and each pass is
paid work.

The tool quotes and submits with the same parameters, so one call is still one
paid job. Pass `client_request_id` and reuse it if you retry after a timeout.

The tool is registered **only where the deployment has an engine that implements
it**, so its presence in your tool list is the availability check. There is no
model, reasoning-effort or repair-pass argument: the planner is fixed and
server-owned. Use `generate_3d_scene` + `edit_3d_scene` + `render_3d_scene` for
the cheaper, editable clay previz instead. See
[3D Render Pro](../nodes/composition/pro-3d-render.md).

For the exact schema and current defaults, use `get_node_skill` with `generate-3d-scene` or `edit-3d-scene`. See [Generate 3D Scene](../nodes/composition/generate-3d-scene.md) and [Edit 3D Scene](../nodes/composition/edit-3d-scene.md).

V1 uses the whole video reference. For a segment, trim the clip first and supply the trimmed video URL. Partial reference time windows are rejected before authoring is charged.
