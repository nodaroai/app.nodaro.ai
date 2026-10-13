# Editable 3D scenes through MCP

These tools expose the same scene authoring and rendering operations as the canvas. They require `workflows:execute` scope.

| Tool | Purpose |
|---|---|
| `generate_3d_scene` | Prompt and optional image/video references → editable scene job |
| `edit_3d_scene` | Scene plan, expected revision and instruction/operations → new revision job |
| `render_3d_scene` | Exact scene revision → MP4 through the existing Render Video engine |
| `pro_3d_render` | A `source` (new brief, existing revision, or desktop export) → ONE job returning the composition, the MP4 and one still per shot (listed only where the deployment can serve it) |

Each returns a job ID. Use `get_job` or `wait_for_job` to retrieve the completed result. Generation/edit jobs return `output_data.scenePlan`; rendering returns a video URL.

A scene authored by an advanced engine also reports what the run assumed and
did: `validation.warnings[]` entries coded `SCENE_AUTHORING_ASSUMPTION` (the
planner's assumptions), `metadata.summary` (its own description of what it
authored), `repairPasses` (repairs actually run — `0` when the scene was
accepted first time), `admissionRetries` (pre-build planner retries, which
spend no repair pass), `mechanicalPasses` (repairs the engine applied from
the compiler's own remedy with no planner call, each with a
`REMEDY_AUTO_APPLIED` warning) and `restoredAssertions` (mandatory assertions
put back after an answer re-shaped one the feedback did not name, each an
`ASSERTION_RESTORED` warning). All are optional; the Basic lane carries none of
them, and a render-only export reports no summary and omits the counts rather
than claiming `0` about a run that never authored.

`mechanicalPasses` is counted **apart** from `repairPasses`, not inside it:
those passes buy their own quoted allowance (a `mechanical` line, released when
unspent) instead of spending one of the caller's repairs, so a run can report
more mechanical passes than repairs. The exception is a run quoted before that
line existed, where the pass charged a repair and the count is a subset — and
the quote, not the result, is what says which.

A completed scene job may also have been delivered **without the visual review's
approval**, and `metadata.review` says which of two ways. `{ verdict: "refused",
objections[], observed? }` — the repair budget was spent, every mandatory check
passed, and the review still objected, so the scene was delivered with the
refusal attached and one `SCENE_REVIEW_REFUSED` warning per objection.
`{ verdict: "unavailable", reason, attempts, objections[], observed? }` — the
review produced no usable verdict in `attempts` asks (`reason` is `"provider"`
when it never reached its provider, `"unusable"` when the provider answered with
nothing usable), so **nobody judged the scene**; `validation.warnings[]` leads
with a `SCENE_REVIEW_UNAVAILABLE` entry, and any objections under it are batches
that answered usably first rather than a verdict.

`validation.status` is still `passed` on both and the objection list may be
empty, so the presence of `metadata.review` is the test — not the status, and
not the warning count — and `verdict` is what to branch on before telling a user
anything: reporting a refusal for a scene nobody reviewed invents an opinion.
See
[3D Render Pro](../nodes/composition/pro-3d-render.md#when-a-scene-that-passed-is-delivered-unapproved).

**A FAILED advanced job can still carry `output_data` — read it before re-running.**
`SCENE_QUALITY_FAILED` means the run spent its budget without a scene it could
stand behind, and it comes in two shapes. When some pass BUILT a scene, the
failed row points at that draft: `scenePlan`, `sceneRevisionId`, `deliveryId`,
`posterAssetId`, and `validation` with `status: "failed"`. The draft is an
ordinary revision — pass it to `edit_3d_scene` or `render_3d_scene` like any
other. When the compiler refused the recipe on *every* pass there is no draft and
no `scenePlan`, but the row still has a `deliveryId`, and
`validation.sourceRetained` says whether the recipe it was refused for was kept.
Fetch it at
`GET /v1/3d-scene/deliveries/{deliveryId}` → the `source-json` descriptor →
`/assets/{assetId}`, with your own credentials and edit access to the job's
workflow; reading it costs no credits. There is no MCP verb for delivery bytes —
these are REST reads. Re-running the identical prompt instead pays for the same
authoring twice.

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
5. Use the MP4 as a video reference in an existing video-generation tool, and say what it is for: pass `reference_video_captions[N]` on `generate_video` alongside `reference_video_urls[N]`. A clay render is a layout anchor, not a look — uncaptioned, it also anchors the grey clay look. Continue passing the original appearance image references as appropriate.

`render_3d_scene` is an MCP convenience tool for the existing `render-video` node, not a separate canvas node. It does not call an LLM. Editing operations avoid an LLM call as well. The initial version supports primitive geometry and deterministic keyframed animation; reference reconstruction is approximate.

A render is priced by the frame size in the plan you pass: **55 credits**<!-- credits: render-video --> for a
scene up to 1920 px on its longest side, **83**<!-- credits: render-video:3d-large --> above that up to 5.12
megapixels, and **138**<!-- credits: render-video:3d-xlarge --> for a larger frame. Set `width` and `height` on the
scene plan deliberately — a 2560x2560 scene costs about 2.5x a 1920x1080 one, and a
1920x1920 scene costs the same as 1920x1080. Full table and worked examples:
[what a 3D scene render costs](../nodes/composition/render-video.md#what-a-3d-scene-render-costs).

## 3D Render Pro

`pro_3d_render` is a different operation, not a flag on `generate_3d_scene`: one
job produces a finished shot, and its completed `output_data` carries BOTH
`scenePlan` and `videoUrl` (plus the revision, poster, validation and renderer
metadata).

It also carries `shotStills`: one still image per shot of the composition,
ordered by `shotIndex`, as `{shotIndex, frame, assetId, url}`. `shotIndex` is
0-based in the composition's shot order and `frame` is that shot's own first
frame, so a still lines up against the MP4 without re-deriving shot boundaries.
A v1 single-shot scene yields exactly one, at frame 0. They come out of the same
run at no extra credit cost — read them from `get_job` / `wait_for_job` and use
a shot's still as the image reference when generating that shot with a video
model. The field is absent on a result that rendered none.

Each `url` is an authenticated endpoint on the install
(`GET /v1/3d-scene/deliveries/{jobId}/assets/{assetId}`), because delivery
artifacts stay in the private scene bucket. Fetch it with the caller's own
credentials; it is not a public link to paste somewhere else.

Passing one as a reference works anyway: hand the URL to `generate_image` /
`generate_video` (or wire the node's `stills` handle) and the platform grants
that run a short-lived read of that one artifact in the owner's name, so the
model can fetch it. The grant lasts minutes and is not stored — keep the
authenticated URL in anything you save.

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
