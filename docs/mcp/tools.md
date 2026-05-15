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
| `workflows:execute` | `run_workflow` |
| `jobs:read` | `list_jobs`, `get_job` |
| `assets:read` | `browse_gallery`, `list_favorites`, `get_asset`, `list_characters`, `get_character` |
| `assets:write` | `favorite_asset` |
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
