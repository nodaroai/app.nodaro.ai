---
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# Nodaro Workflow Editor — General Patterns

Call this skill BEFORE building or editing any Nodaro workflow via `update_workflow_json` or `create_workflow`. It teaches the JSON shape, edge wiring, and the catalog of available node types you can request per-node skills for.

## Workflow JSON shape

A workflow is a React Flow graph stored on a `workflows` row. The full shape:

```json
{
  "nodes": [
    { "id": "n1", "type": "<node-type>", "position": { "x": 0, "y": 0 }, "data": { "label": "...", "...": "..." } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "sourceHandle": "<output-handle>", "target": "n2", "targetHandle": "<input-handle>" }
  ]
}
```

- **`id`** — unique within the workflow. Kebab-case or any string you control. Don't reuse.
- **`type`** — kebab-case node type (e.g., `generate-image`, NOT `generateImage` or `GenerateImage`). See the catalog below.
- **`position.x`, `position.y`** — canvas pixel coordinates. Lay nodes out left-to-right with `x` increasing by ~340 per stage and `y` separating sibling rows by ~280.
- **`data`** — node-type-specific payload. Call `get_node_skill(<type>)` for the exact required + optional fields per type.

## Edge wiring conventions

Every edge connects a SOURCE node's output handle to a TARGET node's input handle:

```json
{ "id": "e1", "source": "n1", "sourceHandle": "image", "target": "n2", "targetHandle": "in" }
```

- **`sourceHandle`** — must match one of the source node's published output handles. Per-node skill content lists the canonical handles. Common shorthand: `generate-image` → `"image"`, `image-to-video` → `"video"`, `generate-music` → `"audio"`.
- **`targetHandle`** — must match one of the target node's input handles. Most generation nodes accept `"in"` as the default input. Specialized handles: `image-to-video` exposes `"startFrame"`, `"endFrame"`, `"audio"`.
- **Loop (Table) node columns** — each column on a `loop` node exposes its own source handle named `col_<column_id>`. Wire `sourceHandle: "col_<id>"` to fan out a column's values into a downstream node. Omitting `sourceHandle` connects to the default output, which usually isn't what you want.

## update_workflow_json contract

`update_workflow_json(workflow_id, workflow, expected_updated_at?)` overwrites the workflow's full graph (nodes + edges). Use it after each approved stage to attach new content to the user's canvas — the user watches it assemble during conversation.

- **`workflow_id`** — UUID from `create_workflow`.
- **`workflow`** — the full `{ nodes, edges }` object. You must include ALL existing nodes + the new ones (no partial diff support).
- **`expected_updated_at`** — optional optimistic concurrency token. Pass the `updated_at` you got from the previous `get_workflow` call to detect races.

Read the current workflow with `get_workflow_json(workflow_id)` before each update so you're appending to the latest state, not overwriting concurrent edits.

## Result-field contract (the single most-important rule)

Every node that produced a generated asset (`generate-image`, `image-to-video`, `generate-music`, `trim-video`, `combine-videos`, `merge-video-audio`) MUST set TWO fields on `data` for the asset to render on the canvas:

1. **`executionStatus: "completed"`** — string literal. Without it the node renders as pending.
2. **`generated<Type>Url: "<asset URL>"`** — exact field name per node type. See `get_node_skill(<type>)` for the canonical name (it's `generatedImageUrl` for image nodes, `generatedVideoUrl` for video nodes, `generatedAudioUrl` for music — NEVER `imageUrl`, `result.url`, etc.).

Optional but recommended: `generatedResults: [{ url, jobId, timestamp }]`, `activeResultIndex: 0`, `currentJobId`. Always include `fieldMappings: {}` on every node that has it in its data type (most do).

<!-- AUTO-GEN:START node-catalog -->
## Available node types

The catalog below lists every node type with a skill file in `backend/skills/nodes/`. Call `get_node_skill(<type>)` for the full schema.

- `combine-videos` — Stitch multiple videos with transitions
- `generate-image` — Text-to-image generation
- `generate-music` — Music generation (Suno)
- `image-to-video` — Image-to-video animation
- `loop` — Multi-column table (UI label "Table")
- `merge-video-audio` — Merge final video with audio track
- `text-prompt` — Text display / script node
- `trim-video` — Cut a video to a time range
<!-- AUTO-GEN:END node-catalog -->

## Common gotchas

- Node types are kebab-case in JSON (`generate-image`), not camelCase or PascalCase. The frontend silently drops unknown types.
- The `loop` type's UI label is "Table" — don't confuse it with `list` (single-column).
- An edge with no `sourceHandle` connects to the default node output. For column-aware fan-out from a `loop` node, you MUST set `sourceHandle: "col_<id>"`.
- `update_workflow_json` overwrites — always merge new nodes into the existing graph, never replace it.
- The catalog above auto-generates. If a node type you expect to find isn't here, run `npm run gen:skills` from `backend/`.
