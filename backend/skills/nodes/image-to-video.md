---
node_type: image-to-video
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# image-to-video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-to-video`
**Category:** ai
**Credit cost:** 10-125 (varies by provider + duration; see `animate_image` MCP tool)
**Inputs (target handles):** `startFrame`, `endFrame`, `audio`
**Outputs (source handles):** `video`

**Required data fields (config):**
- `label: string`
- `provider: string` — e.g., `"seedance-2-fast"`, `"veo3.1"`, `"kling-turbo"` (the provider IS the model identifier for this node type — there is no separate `model` field on `ImageToVideoData` defaults)
- `duration: number` — seconds (e.g., 5)
- `fieldMappings: Record<string, string>` (`{}` if no input wiring)

**Required result fields (when attaching a completed generation):**
- `executionStatus: "completed"`
- `generatedVideoUrl: string` — exact field name (NOT `generatedImageUrl`, NOT `videoUrl`)

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`
- `currentJobId: string`

**Default data:**
```json
{ "label": "Image to Video", "provider": "seedance-2-fast", "duration": 5, "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `animate_image`

Wire the upstream scene image to the `startFrame` input handle via an edge. Capture the response URL and write it to `data.generatedVideoUrl` when attaching the node.
<!-- AUTO-GEN:END mcp-call -->

## When to use

Animate a still image into a short video clip (5-15s typical). For multi-shot films, animate sequentially — each shot's end frame anchors the next shot's start frame.

## Common gotchas

- Field name is `generatedVideoUrl`, NOT `generatedImageUrl`. Using the image field name on a video node renders a blank placeholder.
- Seedance 2 (`seedance-2-fast`, `seedance-2`) always runs in multishot mode: pass `multishot: true`, `disable_internal_music: true`, `allow_sfx: true` to the MCP call.
- Veo / Veo 3.1 use fixed 8-second duration — the `duration` config field is ignored; the response is always 8s.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "anim-1",
  "type": "image-to-video",
  "position": { "x": 1020, "y": 0 },
  "data": {
    "label": "Shot 1 — Animate",
    "provider": "seedance-2-fast",
    "duration": 5,
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedVideoUrl": "https://r2.nodaro.ai/jobs/def456/output.mp4",
    "generatedResults": [
      { "url": "https://r2.nodaro.ai/jobs/def456/output.mp4", "jobId": "def456", "timestamp": "2026-05-18T12:05:00Z" }
    ],
    "activeResultIndex": 0,
    "currentJobId": "def456"
  }
}
```
<!-- AUTO-GEN:END examples -->
