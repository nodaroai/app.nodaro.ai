# MCP Tool Reference

Complete reference for the 122 tools exposed by the Nodaro MCP server.

## Scopes

Each tool requires one or more OAuth scopes. Grant the relevant scopes when
authorizing the connector; missing scopes cause tools to be omitted entirely
(they never appear in the tool list).

| Scope | Controls |
|-------|----------|
| `workflows:read` | `list_projects`, `get_project`, `list_workflows`, `get_workflow`, `get_workflow_json`, `export_workflow`, `list_components`, `get_component_inputs` |
| `workflows:write` | `create_workflow`, `delete_workflow`, `update_workflow_json`, `import_workflow` |
| `workflows:execute` | `run_workflow`, all generation verbs (image/video/audio/Suno/character/location/object), `run_component`, `run_app`, `delete_app_run`, `analyze_prompt`, `generate_prompt`, `enhance_prompt`, `reduce` |
| `jobs:read` | `list_jobs`, `get_job` |
| `assets:read` | `browse_gallery`, `browse_uploads`, `list_favorites`, `get_asset`, `display_asset`, `get_app_run`, `list_characters`, `get_character`, `list_locations`, `get_location` |
| `assets:write` | `favorite_asset`, `create_character`, `update_character`, `approve_portrait`, `recaption_character`, `create_location`, `update_location`, `approve_main_image`, `recaption_location`, `approve_object_main_image`, `recaption_object`, `upload_image_widget`, `upload_audio_widget`, `upload_video_widget`, `request_image_upload`, `request_audio_upload`, `request_video_upload`, `prepare_image_upload`, `prepare_audio_upload`, `prepare_video_upload` |
| `credits:read` | `check_balance`, `credit_transactions` |
| `apps:read` | `list_apps`, `get_app_inputs` |
| `pipelines:read` | `get_pipeline_stage_chat`, `get_pipeline_status`, `pipeline_pending_approvals` |
| `pipelines:execute` | `branch_pipeline`, `start_pipeline` |
| `pipelines:approve` | `chat_pipeline_stage`, `apply_chat_proposal` |

**Ungated (always visible):** `ping`, `list_models`, `start_film_director`, `start_workflow_editor`, `get_node_skill`

---

## The "mcp" project

All workflow tools that create or modify workflows operate inside a single
project named **"mcp"**. This project is created automatically on first use —
agents do not need to set it up.

**Scope of the boundary:**

| Tool | Scope |
|------|-------|
| `list_projects`, `get_project` | Sees **all** of your projects (read-only discovery) |
| `list_workflows`, `get_workflow`, `get_workflow_json` | Only sees workflows in the mcp project |
| `create_workflow`, `delete_workflow`, `update_workflow_json`, `import_workflow` | Only touches the mcp project |
| `export_workflow` | Can read **any** of your workflows (use it to pull work from a personal project into the mcp project via export → import) |
| `run_workflow` | Only runs workflows in the mcp project |

This isolation keeps agent-managed workflows out of your personal projects.

---

## Project tools

### `list_projects`

Returns all projects in your account, ordered by name.

**Scope:** `workflows:read`  
**Input:** none

**Response shape:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "mcp",
      "description": "Workflows managed via MCP",
      "workflowCount": 3,
      "createdAt": "2026-01-15T10:00:00.000Z"
    }
  ]
}
```

---

### `get_project`

Returns a single project by UUID or by name (case-sensitive exact match).

**Scope:** `workflows:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `project_id` | string | A project UUID **or** a project name |

**Example:** `{ "project_id": "My Feature Film" }` resolves by name.  
**Example:** `{ "project_id": "550e8400-e29b-41d4-a716-446655440000" }` resolves by UUID.

**Response shape:**
```json
{
  "data": {
    "id": "uuid",
    "name": "My Feature Film",
    "description": null,
    "workflowCount": 12,
    "createdAt": "2026-03-01T09:00:00.000Z"
  }
}
```

---

## Workflow tools

### `list_workflows`

Lists workflows in the mcp project, newest first.

**Scope:** `workflows:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `limit` | integer (1–100) | Default 20 |
| `cursor` | string | ISO `created_at` from a prior response's `next_cursor`; use for pagination |
| `include_sub_workflows` | boolean | Default `false`. When `false`, hides workflows with `parent_workflow_id` (child sub-workflows owned by another container). Pass `true` to surface them. |

By default, `list_workflows` returns only top-level workflows — child sub-workflows
(those owned by a parent container via `parent_workflow_id`) are hidden so the list
reflects what you would see in the editor's project view. Set
`include_sub_workflows: true` if you need to enumerate every workflow in the mcp
project regardless of nesting.

**Response shape:**
```json
{
  "data": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "name": "My Workflow",
      "description": null,
      "version": 1,
      "thumbnail_url": null,
      "created_at": "2026-05-01T12:00:00.000Z",
      "updated_at": "2026-05-01T12:00:00.000Z"
    }
  ],
  "next_cursor": "2026-04-30T08:00:00.000Z"
}
```

Pass `next_cursor` as `cursor` in the next call to get the next page. When
`next_cursor` is `null`, you've reached the last page.

---

### `get_workflow`

Returns metadata for a single workflow in the mcp project.

**Scope:** `workflows:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Must be in the mcp project |

---

### `create_workflow`

Creates a new workflow in the mcp project. You can seed it with an initial node
graph or leave it empty.

**Scope:** `workflows:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `name` | string (1–200) | Required |
| `description` | string (max 2000) | Optional |
| `nodes` | array of objects | Optional; React Flow node objects |
| `edges` | array of objects | Optional; React Flow edge objects |
| `settings` | object | Optional; workflow-level settings |

**Response:** Returns the new workflow's `id` and `name` in structured content.

---

### `delete_workflow`

Deletes a workflow from the mcp project. This is permanent.

**Scope:** `workflows:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Must be in the mcp project |

Returns an error if the workflow doesn't exist in the mcp project.

---

### `get_workflow_json`

Returns the full React Flow graph for a workflow in the mcp project: nodes,
edges, settings, name, and `updated_at`.

**Scope:** `workflows:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Must be in the mcp project |

**Response shape:**
```json
{
  "name": "My Workflow",
  "nodes": [ ... ],
  "edges": [ ... ],
  "settings": {},
  "updated_at": "2026-05-10T15:30:00.000Z"
}
```

Save `updated_at` and pass it as `expected_updated_at` to `update_workflow_json`
to enable optimistic concurrency control.

---

### `update_workflow_json`

Replaces the full node graph of a workflow in the mcp project.

**Scope:** `workflows:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Must be in the mcp project |
| `nodes` | array of objects | Required; replaces the current nodes |
| `edges` | array of objects | Required; replaces the current edges |
| `settings` | object | Optional; if provided, replaces current settings |
| `expected_updated_at` | string (ISO 8601) | Optional; enables optimistic concurrency |

**Optimistic concurrency:** Pass the `updated_at` value from a prior
`get_workflow_json` call as `expected_updated_at`. If the workflow has been
modified since you read it, the call returns a conflict error:

> "Workflow was modified since you last read it. Fetch the latest JSON with
> get_workflow_json and retry."

This prevents accidental overwrites when two agents or sessions edit the same
workflow concurrently. Omit `expected_updated_at` to skip the check and
overwrite unconditionally.

---

### `export_workflow`

Exports a workflow as a portable JSON bundle. Unlike other workflow tools,
`export_workflow` is not restricted to the mcp project — it can read any of
your workflows. Use it to pull an existing personal workflow into the mcp
project via export → import.

**Scope:** `workflows:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Any of your workflows |
| `with_assets` | boolean | Default false. When true, bundles character, object, and location entity data alongside the node graph |

**Two export modes:**

- **Template mode** (`with_assets: false`, default) — exports the node graph
  with asset-specific content stripped. Useful for sharing workflow structures
  as reusable templates.
- **Full mode** (`with_assets: true`) — exports the node graph plus all
  referenced character, object, and location records. Useful for moving a
  complete production workflow between accounts or instances.

**Response:** A JSON string in the `WorkflowExport` format (version 1). Pass
the full string directly to `import_workflow`.

---

### `import_workflow`

Imports a workflow from a JSON bundle produced by `export_workflow`. Always
imports into the mcp project. If the bundle includes asset data
(`with_assets: true`), new character, object, and location records are created
under your account with fresh IDs; node references are remapped automatically.

**Scope:** `workflows:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_json` | string | The full JSON string from `export_workflow` |

**Response:** Returns the new workflow's `id` and `name` in structured content.

---

### `run_workflow`

Runs a saved workflow from the mcp project. Returns an `execution_id` and
registers an async task for progress tracking.

**Scope:** `workflows:execute`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `workflow_id` | UUID string | Must be in the mcp project |
| `inputs` | object | Optional; per-node input overrides keyed by node id |

**Response:** `{ executionId: "...", name: "..." }` — use `executionId` with
the jobs/executions tools or the SDK to poll for completion. MCP clients that
support the `tasks/*` API and widget rendering will show live progress inline.

---

## Prompt tools

AI assistance for writing prompts for generation nodes. All three delegate to
`POST /v1/prompt-helper/wizard` (the same endpoint as the SDK
`client.promptHelper` and the CLI `nodaro prompt` commands) and reserve credits
per call.

**Scope (all three):** `workflows:execute`

### `analyze_prompt`

Turns a rough idea into guided questions with options for a target node type
(e.g. `generate-image`, `image-to-video`, `generate-music`). Pair with
`generate_prompt`.

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `nodeType` | string | Required. Target node type. |
| `prompt` | string (max 5000) | Optional. The rough idea. Omit to build from scratch. |
| `provider` / `style` / `aspectRatio` / `duration` / `llmModel` | — | Optional. |

**Response:** `{ jobId, questions }` — each question is
`{ category, label, options[], selected, allowCustom, multi? }`.

### `generate_prompt`

Builds a single optimized prompt from `analyze_prompt` selections.

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `nodeType` | string | Required. |
| `selections` | array | Required. One `{ category, value, isCustom }` per answered question. |
| `originalPrompt` | string (max 5000) | Optional. Woven into the result. |
| `provider` / `style` / `aspectRatio` / `duration` / `llmModel` | — | Optional. |

**Response:** `{ jobId, prompt, recommendedModel? }`.

### `enhance_prompt`

One-shot "improve this prompt" — rewrites a rough idea into one optimized
prompt with no questions round-trip.

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `nodeType` | string | Required. |
| `prompt` | string (max 5000) | Optional. The rough idea to improve. |
| `provider` / `style` / `aspectRatio` / `duration` / `llmModel` | — | Optional. |

**Response:** `{ jobId, prompt, recommendedModel? }`.

---

## Image generation tools

**Scope (all):** `workflows:execute`

| Tool | Description |
|------|-------------|
| `generate_image` | Text-to-image or reference-guided image generation. Accepts `prompt`, `model`, `aspect_ratio`, `quality`, `reference_images[]`, etc. |
| `modify_image` | Image-to-image transformation — apply a style, change colors, swap backgrounds. Accepts `image_url`, `prompt`, and strength controls. |
| `image_to_image` | Structural image-to-image (i2i) using a dedicated i2i model. Distinct from `modify_image` in that it uses models optimized for structural transfer. |
| `edit_image` | Targeted edits: remove background, upscale, inpaint, or use Nodaro's nano-banana-edit model. |
| `generate_mask` | Generate or refine a segmentation mask for inpainting workflows. |
| `image_to_text` | Extract a text description (caption/transcription) from an image using a vision model. |
| `generate_script` | Generate a short video script from a prompt (LLM-backed; outputs scene-by-scene copy). |
| `save_image_defaults` | Persist preferred `model`, `aspect_ratio`, and `quality` values so they become the defaults for subsequent `generate_image` calls in the same session. |

---

## Video generation tools

**Scope (all):** `workflows:execute`

| Tool | Description |
|------|-------------|
| `generate_video` | Text-to-video generation. Accepts `prompt`, `model`, `aspect_ratio`, `duration`, and optional `start_image_url` / `end_image_url`. |
| `animate_image` | Image-to-video animation — bring a still image to life. Accepts `image_url`, `motion_prompt`, `model`, `duration`. |
| `extend_video` | Extend an existing video clip forward in time. Accepts `video_url`, `prompt`, `model`, `duration`. |
| `loop_video` | Create a seamless looping clip from a short video segment. Accepts `video_url` and optional loop-trim parameters. |
| `modify_video` | Video-to-video transformation — apply a style or prompt transformation to an existing clip. |
| `trim_video` | Trim a video to a start/end timestamp. Accepts `video_url`, `start`, `end`. |
| `combine_videos` | Concatenate multiple video clips with optional transitions. Accepts `video_urls[]`, `transition`, `transition_duration`. |
| `merge_video_audio` | Merge a video track and an audio track into a single output file. |
| `add_captions` | Burn subtitles/captions onto a video. Accepts `video_url` and caption style options. |
| `extract_frame` | Extract a single frame from a video at a given timestamp. Returns an image URL. |
| `lip_sync` | Drive lip-sync on a video or portrait image from an audio track. Accepts `video_url` / `image_url` + `audio_url`. |
| `speech_to_video` | Generate a talking-head video from a portrait + speech audio. |
| `motion_transfer` | Transfer the motion pattern from one video onto a target image or video. |
| `face_swap` | Swap a face in a source image/video with a reference face. |
| `video_upscale` | AI upscale a video to a higher resolution (powered by Topaz via KIE). |

---

## Audio generation tools

**Scope (all):** `workflows:execute`

| Tool | Description |
|------|-------------|
| `generate_music` | Text-to-music generation (Suno v4/v5 via KIE). Accepts `prompt`, `style`, `duration`, `model`. |
| `generate_speech` | Text-to-speech. Accepts `text`, `voice_id`, `model`. Supports ElevenLabs v3 (default) and KIE v2 models. |
| `text_to_audio` | Text-to-sound-effect (ElevenLabs SFX). Accepts `prompt` and optional `duration`. |
| `voice_clone` | Instant voice clone from a reference audio clip (ElevenLabs). Returns a `voice_id` for use with `generate_speech`. |
| `voice_design` | Design a new synthetic voice from text descriptors (ElevenLabs `/v1/text-to-voice/design`). Returns a `voice_id`. |
| `voice_changer` | Transform the speaker identity in an audio clip to a target voice. |
| `voice_remix` | Re-stylize or re-arrange an existing audio clip. |
| `dubbing` | Dub a video or audio clip into a target language with voice preservation. |
| `transcribe` | Speech-to-text transcription. Returns a transcript + optional timestamps. |
| `audio_isolation` | Separate vocals from background music / noise (stem isolation). |
| `trim_audio` | Trim an audio file to a start/end timestamp. |
| `download_youtube_audio` | Download the audio track from a YouTube URL. Returns an audio asset URL. |

---

## Suno music tools

All Suno tools require `workflows:execute`.

| Tool | Description |
|------|-------------|
| `suno_generate` | Generate a new song from a prompt or lyrics using Suno v4/v5. |
| `suno_lyrics` | Generate song lyrics from a prompt. |
| `suno_extend` | Extend an existing Suno song clip. |
| `suno_cover` | Generate a cover version of a song. |
| `suno_upload_extend` | Upload an audio clip and extend it with Suno. |
| `suno_music_video` | Generate a music video from a Suno song clip. |
| `suno_mashup` | Blend two audio clips into a mashup. |
| `suno_replace_section` | Replace a section of a Suno song with new generated audio. |
| `suno_style_boost` | Apply a style transfer / boost to a Suno song. |
| `suno_add_instrumental` | Add an instrumental track to a Suno song. |
| `suno_add_vocals` | Add a vocal layer to an instrumental track. |
| `suno_separate_stems` | Separate a song into vocal + instrumental stems. |
| `suno_convert_wav` | Convert a Suno output to WAV format. |

---

## Character tools

Character tools surface the caller's saved characters from Character Studio so
an LLM client can pick the right asset URL to pass as a reference image into
a subsequent generation call.

### `list_characters`

**Scope:** `assets:read`

Lists the caller's characters with summary fields, ordered by most recently
updated.

**Input:** `{ limit?: integer }` — default 50, max 100.

---

### `get_character`

**Scope:** `assets:read`

Returns full asset detail for one character including every expression / pose /
motion / angle / lighting variant with its URL.

**Input:** `{ id: uuid }`

---

### `create_character`

**Scope:** `assets:write`

Creates a new character row with identity fields. No portrait — call
`generate_character` (kind=`"main"`) afterwards.

**Input:** `name`, `description`, `gender`, `style` (`realistic`/`anime`/`3d-pixar`/`illustration`), `base_outfit`, `seed_prompt`

---

### `update_character`

**Scope:** `assets:write`

Patches an existing character. Only the fields you supply are written.
Supports optimistic concurrency via `expected_updated_at`.

---

### `approve_portrait`

**Scope:** `assets:write`

Approves a completed `generate_character` job as the character's canonical
portrait. Fires an LLM caption inline to populate `canonical_description`.

**Input:** `{ character_id: uuid, candidate_job_id: uuid }`

---

### `recaption_character`

**Scope:** `assets:write`

Re-runs the LLM caption against the character's current portrait and
persists the new `canonical_description`.

**Input:** `{ id: uuid }`

---

### `generate_character`

**Scope:** `workflows:execute`

Generates either a fresh portrait (`kind: "main"`) or an asset variant
(`kind: "asset"`) for a named character. The single tool covers two routes:
`POST /v1/generate-character` (main portrait) and
`POST /v1/generate-character-asset` (variants — expressions, poses, head
angles, body angles, lighting, custom).

**Input (main):** `kind`, `name`, `description`, `gender`, `style`, `base_outfit`, `model`

**Input (asset):** `kind`, `name`, `asset_type`, `variant`, `attach_to_character_id`, `attach_to_column`, `attach_name`, `source_image_url`

---

### `generate_character_motion`

**Scope:** `workflows:execute`

Animates a character into a motion clip via image-to-video. When
`attach_to_character_id` is set, the source frame is auto-resolved from
the character row and the resulting clip is appended to the `motions[]` bucket.

**Input:** `motion_prompt`, `name`, `attach_to_character_id`, `source_image_url`, `description`, `motion_description`, `provider`

---

## Location tools

Eight tools for the location lifecycle — identity edits, establishing-shot
generation, atmospheric motion clips, and LLM-captioned approval. Mirrored on
the SDK at [`client.locations`](../sdk-reference.md#clientlocations).

### `list_locations`

**Scope:** `assets:read`

Summary list (name, main image URL, asset counts, identity copy).

**Input:** `{ archived?: boolean }`

---

### `get_location`

**Scope:** `assets:read`

Full detail including all asset arrays + reference photos + `pendingJobs`.

**Input:** `{ id: uuid }`

---

### `create_location`

**Scope:** `assets:write`

Create a new row with name + optional description / category / style.

**Input:** `name`, `description`, `category`, `style`

---

### `update_location`

**Scope:** `assets:write`

Update identity fields (`name`, `description`, `category`, `style`,
`styleLock`, `canonicalDescription`). Supports optimistic concurrency via
`expected_updated_at`.

---

### `approve_main_image`

**Scope:** `assets:write`

Approve a completed `generate_location` candidate as the location's main
image. Fires the LLM caption inline.

**Input:** `{ location_id: uuid, candidate_job_id: uuid }`

---

### `recaption_location`

**Scope:** `assets:write`

Re-run the LLM caption against the current main image.

**Input:** `{ id: uuid }`

---

### `generate_location`

**Scope:** `workflows:execute`

Generate a main image (`kind: "main"`) or a variant asset (`kind: "asset"` + `asset_type` + `variant`).

---

### `generate_location_motion`

**Scope:** `workflows:execute`

Animate the location's establishing shot into an atmospheric motion clip
(image-to-video). Pass `refine_from_video_url` to route through video-to-video
for iterating on an existing clip.

---

## Object tools

Four tools for the object (prop / product / vehicle / etc.) lifecycle —
main-image approval, LLM recaption, motion clips, and verb-style generation.
Mirrored on the SDK at [`client.objects`](../sdk-reference.md#clientobjects).

### `generate_object`

**Scope:** `workflows:execute`

Generate a main image or variant asset for an object. Parallel to `generate_character` / `generate_location`.

---

### `approve_object_main_image`

**Scope:** `assets:write`

Approve a completed `generate_object` candidate as the object's main
image. Fires the LLM caption inline.

**Input:** `{ object_id: uuid, candidate_job_id: uuid }` + optional `expected_updated_at`

---

### `recaption_object`

**Scope:** `assets:write`

Re-run the LLM caption against the current main image.

**Input:** `{ id: uuid }`

---

### `generate_object_motion`

**Scope:** `workflows:execute`

Animate the object's main image into a motion clip (image-to-video).
Provider defaults to `"kling-turbo"`, aspect ratio defaults to `"1:1"`.
Pass `refine_from_video_url` to use video-to-video refinement.

**Input:** `motion_prompt`, `source_image_url` (required), `name`, `attach_to_object_id`, `provider`, `aspect_ratio`, `refine_from_video_url`

---

## Gallery and asset tools

### `browse_gallery`

**Scope:** `assets:read`

Browse your gallery or the public gallery. Renders an interactive grid
widget in compatible clients.

**Input:** `scope` (`"mine"` default / `"public"`), `limit`, `cursor`, `kinds[]`, `query`

---

### `browse_uploads`

**Scope:** `assets:read`

Browse assets you've uploaded (source files — distinct from generated
outputs). Use to retrieve existing upload URLs to feed into generation
tools.

**Input:** `kind`, `limit`, `cursor`

---

### `list_favorites`

**Scope:** `assets:read`

List your favorited gallery items, most recent first.

**Input:** `limit`, `cursor`

---

### `get_asset`

**Scope:** `assets:read`

Fetch metadata for a single asset (job) by id, including output URL, prompt,
provider. Visible for your own jobs (any status) and any user's public
completed jobs.

**Input:** `{ job_id: string }`

---

### `display_asset`

**Scope:** `assets:read`

Render an asset visually in chat (the user sees the image, not JSON). Best
for image assets — the bound widget renders inline with Edit / Animate /
Use-as-reference buttons. For video/audio assets returns a direct link.

**Input:** `{ job_id: string }`

---

### `get_app_run`

**Scope:** `assets:read`

Fetch status of a workflow / published-app execution by id. Returns
per-node states and output URLs produced so far. Used by widgets to poll
progress.

**Input:** `{ execution_id: string }`

---

### `favorite_asset`

**Scope:** `assets:write`

Mark or unmark a gallery asset as a favorite.

**Input:** `{ job_id: string, favorited: boolean }`

---

## Jobs tools

### `list_jobs`

**Scope:** `jobs:read`

List your recent jobs with status, job type, and output URL. Supports
cursor pagination.

**Input:** `limit`, `cursor`, `status`, `job_type`

---

### `get_job`

**Scope:** `jobs:read`

Fetch full metadata for a single job by id, including `output_url`,
`status`, `progress`, `provider`, and `output_data`.

**Input:** `{ job_id: uuid }`

---

## Apps tools

### `list_apps`

**Scope:** `apps:read`

List published apps. Supports `scope: "public" | "mine"` and ordering by
recency.

**Input:** `scope`, `limit`, `cursor`

---

### `get_app_inputs`

**Scope:** `apps:read`

Returns the typed input schema for a published app (the same schema the
published-app page renders). Use this before `run_app` to learn the
available input keys and their types.

**Input:** `{ slug: string }`

---

### `run_app`

**Scope:** `workflows:execute`

Run a published app by slug. `inputs` is a FLAT object keyed by the schema
input keys (from `get_app_inputs`). Returns an `execution_id`.

**Input:** `slug`, `inputs?`

---

### `delete_app_run`

**Scope:** `workflows:execute`

Soft-delete (archive) a published-app run. The run can be restored or
permanently deleted from the Nodaro web UI at `/archived-runs`.

**Input:** `{ slug: string, runId: uuid }`

---

## Component tools

### `list_components`

**Scope:** `workflows:read`

List your saved workflow components (reusable sub-graphs). Ordered by most
recently updated.

**Input:** `limit`, `cursor`

---

### `get_component_inputs`

**Scope:** `workflows:read`

Returns the typed input schema for a saved component. Use before
`run_component` to learn available input keys.

**Input:** `{ component_id: uuid }`

---

### `run_component`

**Scope:** `workflows:execute`

Execute a saved component by id. `inputs` is a FLAT object keyed by the
component's input schema keys. Returns an `execution_id`.

**Input:** `component_id`, `inputs?`

---

## Models and credits tools

### `list_models`

**Scope:** none (always visible)

Browse AI models available on this Nodaro instance. Returns grouped JSON
with per-model capability sheets (aspect ratios, resolutions, qualities,
durations, features, per-variant credit pricing) and a `recommendations`
array.

**Input:** `kind` (`image`/`video`/`audio`), `mode`, `family`, `featuredOnly`

---

### `check_balance`

**Scope:** `credits:read` (cloud edition only)

Returns your current credit balance split by pool (`subscription_credits`
vs `topup_credits`).

**Input:** none

---

### `credit_transactions`

**Scope:** `credits:read` (cloud edition only)

Lists recent credit transactions (deductions and top-ups) with amounts,
model identifiers, and timestamps.

**Input:** `limit`, `cursor`

---

## Upload tools

All upload tools require `assets:write`. Three upload strategies are provided
— prefer the one suited to your client environment.

### Widget uploads (preferred for Claude.ai web)

| Tool | Description |
|------|-------------|
| `upload_image_widget` | Opens an in-chat file picker for images. Supports `max_files` (1–10). Auto-announces the resulting URL(s) back to the chat. |
| `upload_audio_widget` | Opens an in-chat file picker for audio. |
| `upload_video_widget` | Opens an in-chat file picker for video. |

### Browser-handoff uploads (works everywhere)

| Tool | Description |
|------|-------------|
| `request_image_upload` | Returns an `upload_page_url` the user opens in their browser to drop the file, plus the deterministic `public_url`. Works in all MCP clients including Claude.ai web/Android. |
| `request_audio_upload` | Browser-handoff for audio. |
| `request_video_upload` | Browser-handoff for video. |

### Presigned-URL uploads (CLI clients with unrestricted bash)

| Tool | Description |
|------|-------------|
| `prepare_image_upload` | Returns a presigned R2 PUT URL. Stream the file via `curl -X PUT --data-binary @file -H 'Content-Type: <mime>'`. Use in Cursor / Cline / Claude Desktop / Claude Code only — fails on Claude.ai web/Android. |
| `prepare_audio_upload` | Presigned upload for audio. |
| `prepare_video_upload` | Presigned upload for video. |

---

## Pipeline tools

The pipeline tools drive the Nodaro Story-to-Video pipeline engine. Only
available when the pipeline feature is enabled on your instance.

| Tool | Scope | Description |
|------|-------|-------------|
| `branch_pipeline` | `pipelines:execute` | Create a branch of an existing pipeline from a given stage. |
| `start_pipeline` | `pipelines:execute` | Start a new Story→Video pipeline from a prompt. Mode `"auto"` runs end-to-end unattended; `"manual"`/`"guided"` pause at approval gates. |
| `chat_pipeline_stage` | `pipelines:approve` | Send a chat message to the Showrunner Refinement Director for a stage awaiting approval (guided mode). Returns the assistant reply and an optional `proposed_change` JSON Patch. |
| `apply_chat_proposal` | `pipelines:approve` | Accept a proposed edit from a prior `chat_pipeline_stage` reply and advance the stage to approved. |
| `get_pipeline_stage_chat` | `pipelines:read` | List all chat turns for a pipeline stage ordered by turn number. |
| `get_pipeline_status` | `pipelines:read` | Get current pipeline state: status, current_stage, credit counters, mode, failure_reason. Poll after `start_pipeline` to track an Auto run. |
| `pipeline_pending_approvals` | `pipelines:read` | List stages currently awaiting approval with their output snapshots. |

---

## Utility tools

### `reduce`

**Scope:** `workflows:execute`

Summarize or reduce a list of text items using an LLM. Useful for
post-processing arrays of generated captions or descriptions into a single
coherent output.

---

### `ping`

**Scope:** none (always visible)

Returns `"pong"` plus the authenticated Nodaro user id and the calling MCP
client name. Use to verify the connector is wired up correctly.

**Input:** none

---

### `start_film_director`

**Scope:** none (always visible)

Returns the Film Director skill — a multi-step prompt that instructs the
LLM to drive a 10-stage director workflow (script → characters →
storyboard → animation → audio → final cut) and assemble an editable
Nodaro workflow on your canvas in real-time.

**Input:** none

---

### `start_workflow_editor`

**Scope:** none (always visible)

Returns the Workflow Editor skill — a step-by-step guide instructing the
LLM how to create, edit, and run Nodaro workflows via MCP tools.

**Input:** none

---

### `get_node_skill`

**Scope:** none (always visible)

Returns documentation for a specific node type — accepted inputs, outputs,
and configuration options — so the LLM can correctly populate that node
when building or editing a workflow.

**Input:** `{ node_type: string }`
