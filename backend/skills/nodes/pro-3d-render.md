---
node_type: pro-3d-render
generated_at: 2026-09-08T02:03:29.214Z
generated_from: 90fdec2b4
---

# 3D Render Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `pro-3d-render`
**Category:** ai
**Credit cost:** 0
**Inputs (target handles):** `scene`, `references`
**Outputs (source handles):** `composition`, `video`

**Default data:**
```json
{
  "label": "3D Render Pro",
  "sourceMode": "prompt",
  "scenePrompt": "",
  "aspectRatio": "16:9",
  "fps": 24,
  "durationSeconds": 10,
  "engine": "blender-cloud",
  "quality": "standard",
  "style": "clay",
  "maxRepairPasses": 2,
  "fieldMappings": {},
  "executionStatus": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

ONE node, ONE durable operation. A `source` goes in; the settled job carries
BOTH `scenePlan` — the exact 3D composition — and `videoUrl`, the MP4 rendered
from it (plus `sceneRevisionId`, `posterAssetId`, `validation`, `renderer` and
`metadata`).

Reach for it when the user wants a finished 3D shot. For the cheap, editable
clay previz, use `generate-3d-scene` + `edit-3d-scene` and render with
`render-video`.

**Availability is a property of the deployment.** The node exists only where an
engine implements BOTH the run and the quote; `GET /v1/3d-scene/capabilities`
reports a `pro` block, and `GET /v1/nodes` omits the type where it is false. Do
not write this type into a workflow on an install that does not list it.

## The source (`sourceMode` on the node)

| `sourceMode` | Node data | What it does |
|---|---|---|
| `"prompt"` (default) | `scenePrompt` + wired `references` | Authors a new scene, then renders it. |
| `"scene"` | the `scene` input (or the node's own `scenePlan`) | **Render-only** export of that revision — no authoring charge. |
| `"scene"` + `editPrompt` | same, plus an instruction | Revises the scene first, then renders it. |

An empty `editPrompt` is treated as ABSENT, which is the render-only request.
Do not write `editPrompt: ""` expecting an edit.

A `scene` source needs the revision AND the job that produced it. The canvas
reads the job id from the producing node's `sceneHistory` entry, so a revision
saved before job tracking existed is refused with an actionable message rather
than guessed at — re-run the scene that produced it.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Two outputs, two handles.** `composition` carries the scene (a plan marker,
  not a URL) and `video` carries the MP4. Wire a downstream video consumer from
  `video`.
- **Quote before you run.** The API requires a `quoteId` from
  `POST /v1/pro-3d-render/quote` plus an `Idempotency-Key`. Both execution
  engines and the MCP tool do this automatically; a hand-written call must too.
- **Don't override a scene's timing by accident.** `durationSeconds` / `fps` /
  `aspectRatio` are withheld for a `scene` source unless
  `overrideSourceTiming` is set; sending them is an explicit re-time and a
  conflict is rejected.
- **No model chooser.** There is no `llmModel` / `reasoningEffort` field — the
  planner is fixed and server-owned.
- **`engine`** accepts `blender-cloud` (default) and `blender-local` where a
  paired desktop is available; an unknown or unavailable one is a 400/503,
  never a quiet downgrade.
- **The correction budget is 0-2** (`maxRepairPasses`, default 2). Each pass is
  paid work.
- **An unpriced install refuses.** This aggregates several paid stages and has
  no flat fallback cost; a deployment with no configured price answers 503
  before anything is reserved.
- **References follow the Basic rules** (up to 8, at most 1 video, no time
  window on an image) and apply to the `prompt` source only.
- **21:9 is supported** — the acceptance fixture is a 30-second 21:9 scene.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "pro-3d-render-1",
  "type": "pro-3d-render",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "3D Render Pro",
    "sourceMode": "prompt",
    "scenePrompt": "",
    "aspectRatio": "16:9",
    "fps": 24,
    "durationSeconds": 10,
    "engine": "blender-cloud",
    "quality": "standard",
    "style": "clay",
    "maxRepairPasses": 2,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
