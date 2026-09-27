---
node_type: face-swap
generated_at: 2026-09-22T09:36:31.641Z
generated_from: 65b4cddf2
---

# Face Swap

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `face-swap`
**Category:** ai
**Credit cost:** `130` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `face`, `video`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `provider: FaceSwapProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Face Swap",
  "provider": "roop",
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Replaces the face in a video with the face from one image. Wire the face into `face` (an image producer's output, or a Character / Face node, whose portrait is used) and the clip into `video`. The result keeps the source clip's own sound.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `face_swap`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `face_image_url`
- `face_image_asset_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- A run missing the face or the video is refused before anything is billed (`image_required` / `video_required`).
- Use a clear, front-facing face photo; the source clip needs a clearly visible face.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "face-swap-1",
  "type": "face-swap",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Face Swap",
    "provider": "roop",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
