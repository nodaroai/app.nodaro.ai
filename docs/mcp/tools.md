# MCP Tool Reference

Complete reference for the tools exposed by the Nodaro MCP server.

## Scopes

Each tool requires one or more OAuth scopes. Grant the relevant scopes when
authorizing the connector; missing scopes cause tools to be omitted entirely
(they never appear in the tool list).

| Scope | Controls |
|-------|----------|
| `workflows:read` | `list_projects`, `get_project`, `list_workflows`, `get_workflow`, `get_workflow_json`, `export_workflow` |
| `workflows:write` | `create_workflow`, `delete_workflow`, `update_workflow_json`, `import_workflow` |
| `workflows:execute` | `run_workflow`, `generate_character_motion` |
| `jobs:read` | `list_jobs`, `get_job` |
| `assets:read` | `browse_gallery`, `list_favorites`, `get_asset`, `list_characters`, `get_character` |
| `assets:write` | `favorite_asset`, `create_character`, `update_character`, `approve_portrait`, `recaption_character` |
| `generation:write` | All generation verbs (`generate_image`, `generate_video`, etc.) |

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

**Response shape:**
```json
{
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "name": "My Workflow",
    "description": null,
    "version": 1,
    "thumbnail_url": null,
    "created_at": "2026-05-01T12:00:00.000Z",
    "updated_at": "2026-05-01T12:00:00.000Z"
  }
}
```

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

## Character tools

Character tools surface the caller's saved characters from Character Studio so
an LLM client can pick the right asset URL to pass as a reference image into
a subsequent generation call. They are **read-only**: editing characters still
flows through the web app or the REST API.

The intended workflow is:

1. Call `list_characters` to discover which characters are available, with
   their asset counts and short identity copy.
2. Call `get_character(id)` for the character(s) you want to use, which
   returns every expression / pose / motion / angle / lighting variant with
   its URL.
3. Pick the URL that matches the user's intent (e.g. an expression named
   `"smile"` or `"laughing"`) and pass it as a reference image into
   `generate_image`, `image_to_image`, or `generate_video`.

Both tools are scoped to the calling user — characters owned by other users
are invisible. Archived characters are excluded.

### `list_characters`

Lists the caller's characters with summary fields, ordered by most recently
updated.

**Scope:** `assets:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `limit` | integer | Optional. Max characters to return. Default 50, max 100. |

**Response shape:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Kira",
      "description": "freckled redhead protagonist",
      "canonicalDescription": "young woman with auburn hair and green eyes…",
      "portraitUrl": "https://example.com/kira-portrait.png",
      "seedPrompt": "kira portrait",
      "gender": "female",
      "style": "photoreal",
      "baseOutfit": "denim jacket",
      "assetCounts": {
        "expressions": 5,
        "poses": 3,
        "motions": 2,
        "angles": 1,
        "bodyAngles": 0,
        "lightingVariations": 0
      },
      "updatedAt": "2026-05-10T00:00:00.000Z"
    }
  ]
}
```

### `get_character`

Returns full asset detail for one character. Use the `id` from
`list_characters`.

**Scope:** `assets:read`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID string | The character's id, from `list_characters` |

**Response shape:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Kira",
    "description": "freckled redhead protagonist",
    "canonicalDescription": "young woman with auburn hair and green eyes…",
    "portraitUrl": "https://example.com/kira-portrait.png",
    "seedPrompt": "kira portrait",
    "gender": "female",
    "style": "photoreal",
    "baseOutfit": "denim jacket",
    "expressions": [
      { "name": "smile", "url": "https://example.com/kira-smile.png" },
      { "name": "frown", "url": "https://example.com/kira-frown.png" }
    ],
    "poses": [
      { "name": "standing", "url": "https://example.com/kira-stand.png" }
    ],
    "motions": [
      { "name": "wave", "url": "https://example.com/kira-wave.mp4" }
    ],
    "angles": [
      { "name": "profile-left", "url": "https://example.com/kira-profile.png" }
    ],
    "bodyAngles": [],
    "lightingVariations": [
      { "name": "golden-hour", "url": "https://example.com/kira-golden.png" }
    ],
    "referencePhotos": [
      { "url": "https://example.com/kira-ref-1.jpg", "kind": "frontFace" }
    ],
    "realLifeRefsByVariant": {
      "smile": ["https://example.com/laugh-ref.jpg"]
    },
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-05-10T00:00:00.000Z"
  }
}
```

Returns an error if the id doesn't resolve to a character owned by the caller.

**Example walkthrough** ("make a photo of Kira smiling and Shira laughing at
the park"):

```jsonc
// Step 1 — discover available characters
list_characters({})
// → { data: [{ id: "kira-uuid", name: "Kira", … }, { id: "shira-uuid", name: "Shira", … }] }

// Step 2 — fetch Kira's full detail
get_character({ id: "kira-uuid" })
// → { data: { expressions: [{ name: "smile", url: "https://…/kira-smile.png" }, …], … } }

// Step 3 — fetch Shira's full detail
get_character({ id: "shira-uuid" })
// → { data: { expressions: [{ name: "laughing", url: "https://…/shira-laugh.png" }, …], … } }

// Step 4 — generate the composite scene with both URLs as references
generate_image({
  prompt: "Kira smiling and Shira laughing in a sunlit park",
  reference_images: [
    "https://…/kira-smile.png",
    "https://…/shira-laugh.png"
  ]
})
```

### `create_character`

Creates a new character row with identity fields. No portrait — call
`generate_character` (kind=`"main"`) afterwards. The character is scoped to
the calling user and visible in the editor under the user's library.

**Scope:** `assets:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `name` | string (1–200) | Display name; must be unique among the user's active characters. |
| `description` | string (max 2000) | Identity notes (height, hair, vibe). |
| `gender` | string (max 50) | Optional. |
| `style` | enum | `realistic` / `anime` / `3d-pixar` / `illustration`. |
| `base_outfit` | string (max 1000) | Default wardrobe description. |
| `seed_prompt` | string (max 2000) | Scaffold prompt for portrait generation. |

**Response:** `{ id, name }` in structured content. A 409
`A character named "X" already exists.` error is returned on name conflict.

### `update_character`

Patches an existing character. Only the fields you supply are written;
omitted fields are left untouched.

**Scope:** `assets:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Required. |
| `name` | string (1–200) | Optional. 409 on name conflict. |
| `description` | string (max 2000) | Optional. |
| `gender` | string (max 50) | Optional. |
| `style` | enum | Optional. |
| `base_outfit` | string (max 1000) | Optional. |
| `seed_prompt` | string (max 2000) | Optional. |
| `expected_updated_at` | string (ISO 8601) | Optional; enables optimistic concurrency. |

**Optimistic concurrency:** pass the `updatedAt` from a prior `get_character`
call as `expected_updated_at`. The token is folded into the UPDATE itself
(`WHERE updated_at = :expected_updated_at`) so the check is atomic — if the
row changed since you read it the UPDATE matches zero rows and the call
returns a conflict error instead of overwriting.

### Destructive operations — intentionally NOT exposed via MCP

`delete_character` and `restore_character` are **not** available through
the MCP surface. Destructive (or destructive-adjacent) operations driven
by an LLM are dangerous — prompt injection or hallucination can trigger
them unexpectedly, and the LLM doesn't always have the user context to
make those calls safely.

To archive or restore a character, use the REST API, SDK, or CLI directly
— those are explicit user actions, not LLM-driven:

| Surface | How |
|---------|-----|
| REST | `DELETE /v1/characters/:id` (archive) / `POST /v1/characters/:id/restore` |
| SDK | `client.characters.delete(id)` / `client.characters.restore(id)` |
| CLI | `nodaro characters delete <id>` / `nodaro characters restore <id>` |

The same principle applies to every MCP tool family: MCP exposes
creation, modification, and generation (all reversible); deletion,
restoration, and permanent state changes stay REST/SDK/CLI only.

### `approve_portrait`

Approves a completed `generate_character` job as the character's canonical
portrait. Sets `source_image_url` and fires an LLM caption (Claude Sonnet
vision) inline to populate `canonical_description`.

**Scope:** `assets:write`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `character_id` | UUID | Required. |
| `candidate_job_id` | UUID | The job id from a completed `generate_character` call. |

**Response:** `{ characterId, portraitUrl, canonicalDescription }` — the
caption is `null` on LLM sub-failure (portrait still set; retry via
`recaption_character`).

### `recaption_character`

Re-runs the LLM caption against the character's current portrait and
persists the new `canonical_description`. Returns 400 `no_portrait` when no
portrait is set; 502 on LLM failure.

**Scope:** `assets:write`

**Input:** `{ id: <uuid> }`

**Response:** `{ id, canonicalDescription }` in structured content.

### `generate_character_motion`

Animates a character's portrait into a motion clip via image-to-video.
When `attach_to_character_id` is set, the character's anchor portrait is
used as the source frame and the resulting clip is appended to the row's
`motions[]` bucket on completion.

**Scope:** `workflows:execute`

**Input:**

| Field | Type | Notes |
|-------|------|-------|
| `motion_prompt` | string (1–2000) | Required. What moves and how. |
| `name` | string (1–200) | Required. Used in the prompt. |
| `attach_to_character_id` | UUID | Optional. Auto-attach + reuse anchor portrait. |
| `attach_name` | string (1–200) | Optional. Display name in the motions[] bucket. |
| `source_image_url` | URL | Required when `attach_to_character_id` is omitted. |
| `description` | string (max 1000) | Optional. Visual scaffolding. |
| `motion_description` | string (max 500) | Optional. Tight description of rhythm + feel. |
| `provider` | string | Defaults to `kling`. |

**Response:** `{ jobId }` in structured content. Poll via `get_job` until
status=completed.

### Studio walkthrough — create + portrait + asset

```jsonc
// Step 1 — create the character row
create_character({
  name: "Kira",
  description: "young protagonist with auburn hair",
  style: "realistic",
  seed_prompt: "kira portrait, warm natural lighting"
})
// → { id: "kira-uuid", name: "Kira" }

// Step 2 — generate 4 portrait candidates auto-attaching to the row
generate_character({
  kind: "main",
  name: "Kira",
  // count is not exposed to MCP yet — single candidate per call
})
// → { content: [text], structuredContent: { jobId: "job-1" } }

// Step 3 — after the job completes, approve the candidate
approve_portrait({
  character_id: "kira-uuid",
  candidate_job_id: "job-1"
})
// → { portraitUrl: "https://…/kira-portrait.png", canonicalDescription: "…" }

// Step 4 — layer a smile expression from the portrait
generate_character({
  kind: "asset",
  asset_type: "expressions",
  variant: "smile",
  name: "Kira"
})

// Step 5 — animate the portrait
generate_character_motion({
  motion_prompt: "slow head turn left, soft smile",
  name: "Kira",
  attach_to_character_id: "kira-uuid",
  attach_name: "head turn"
})
```
