---
node_type: video-overlay
generated_at: 2026-09-24T15:05:52.283Z
generated_from: 586dd7fb7
---

# Video Overlay

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-overlay`
**Category:** processing
**Credit cost:** `20` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `video`, `overlay`, `overlay2`, `overlay3`, `overlay4`, `overlay5`, `overlay6`, `overlay7`, `overlay8`, `overlay9`, `overlay10`, `overlay11`, `overlay12`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `layers: Array<VideoOverlayLayerInput | null>`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `layerCount?: number`
- `outputAspect?: VideoOverlayOutputAspect`
- `baseFit?: VideoOverlayFit`
- `backgroundColor?: string`
- `probedVideo?: ProbedVideoInfo`
- `resultCompositionKey?: string`
- `warnings?: VideoOverlayWarning[]`
- `width?: number`
- `height?: number`
- `durationSec?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Video Overlay",
  "layers": [],
  "layerCount": 4,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Place images over a video at given times, without re-generating the video: product cards and app screenshots timed to a voice-over (UGC ads), a logo or a handle for the whole video, picture-in-picture stills, price badges. Wire the base into `video` and each image into a layer handle (`overlay` … `overlay12`); layers 13 and up exist only in data, with an `imageUrl`. Each layer has `start` / `end` in seconds (no `end` = to the end of the video), a placement — `preset` `card`, `corner-badge` (+ `corner`) or `full-frame`, or an explicit box in percent of the OUTPUT frame (`anchor`, `x`, `y`, `width`, `height`, `fit`) — plus `opacity`, `animate` and `zIndex`. One local FFmpeg render, 20 credits; the base audio is kept untouched.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `overlay_images`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `layers`
- `output_aspect`
- `base_fit`
- `background_color`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- An explicit box field overrides the preset (the layer becomes custom); a layer with neither a preset nor a box is a corner badge — bottom-right, or the `corner` it names.
- A wired layer handle wins over that layer's `imageUrl` — and a JSON write that wires the handle clears the stored `imageUrl`.
- `card` sits over the middle of the frame — over the speaker's face on a 9:16 selfie. Put logos and badges that must not cover the subject in a `corner-badge` or a custom box.
- Percentages are of the OUTPUT frame: with `outputAspect` set, that is the target canvas, not the source video.
- A layer ending past the video is clipped and one starting at or after its end is skipped — both reported in the job's `warnings[]`; when every layer starts after the end, the run fails.
- Layer images must be PNG, JPEG or WebP: SVG is refused (rasterise it with Image Overlay first); an animated WebP renders its first frame.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "video-overlay-1",
  "type": "video-overlay",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video Overlay",
    "layers": [],
    "layerCount": 4,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
