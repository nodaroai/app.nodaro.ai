---
node_type: video-overlay
generated_at: 2026-11-11T12:25:47.499Z
generated_from: 99c938475
---

# Video Overlay

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-overlay`
**Category:** processing
**Credit cost:** `11-132` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`, `overlay`, `overlay2`, `overlay3`, `overlay4`, `overlay5`, `overlay6`, `overlay7`, `overlay8`, `overlay9`, `overlay10`, `overlay11`, `overlay12`, `layerPlan`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `layers: Array<VideoOverlayLayerInput | null>`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `passThroughWarning?: PassThroughWarning`
- `layerCount?: number`
- `outputAspect?: VideoOverlayOutputAspect`
- `baseFit?: VideoOverlayFit`
- `backgroundColor?: string`
- `baseBox?: VideoOverlayBoxInput | null`
- `layout?: VideoOverlayLayoutId | "" | null`
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

Place images or videos over a video at given times, without re-generating the video: product cards and app screenshots timed to a voice-over (UGC ads), a logo or a handle for the whole video, price badges — and, with video layers, a 16:9 clip at the bottom of a 9:16 frame, two clips stacked, or a fixed picture in picture. Wire the base into `video` and each image or video into a layer handle (`overlay` … `overlay12`); layers 13 and up exist only in data, with an `imageUrl` or a `videoUrl`. Each layer has exactly one source, `start` / `end` in seconds (no `end` = to the end of the video), a placement — `preset` `card`, `corner-badge` (+ `corner`) or `full-frame`, or an explicit box in percent of the OUTPUT frame (`anchor`, `x`, `y`, `width`, `height`, `fit`) — plus `opacity`, `animate`, `zIndex` and, for a video layer, `sound: { volume }` (0–1). Node-level `layout` (`video-bottom`, `video-top`, `stack-whole`, `stack-filled`, `pip`) places the base, the first video layer or both; `baseBox` places the base yourself (needs `outputAspect`). One local FFmpeg render. Price: an image-only run is 22 credits<!-- credits: video-overlay -->; a run with any video layer is 11 credits<!-- credits-rate: video-overlay:video --> per started 5 s of the base (base at most 60 s, at most 2 video layers). The base audio is kept untouched unless a video layer's sound is on.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `overlay_images`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `layers`
- `output_aspect`
- `base_fit`
- `background_color`
- `layout`
- `base_box`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- An explicit box field overrides the preset (the layer becomes custom); a layer with neither a preset nor a box is a corner badge — bottom-right, or the `corner` it names.
- A layer is an image (`imageUrl`) or a video (`videoUrl`), never both (`layer_two_sources`); at most 2 video layers per run (`too_many_video_layers`).
- A wired layer handle wins over that layer's `imageUrl` / `videoUrl` — and a JSON write that wires the handle clears both. Whether a wired layer is an image or a video is read from the wire at run time.
- `animate` defaults ON for an image layer and OFF for a video layer. On a wired slot the default follows what is wired at run time, so a JSON write stores a wired slot's layer WITHOUT an implied `animate` — set it only to force the fade on or off.
- `sound` is for a video layer only: on a layer with its own `imageUrl` it is refused (`sound_without_video`); on a wired slot whose wire turns out to be an image at run time it is skipped. With no `sound` on any layer the base audio is untouched; a mix passes a limiter (peaks at or below −1 dBFS) and is AAC.
- A video layer plays from its first frame at `start`, stops at `end` or the base's end, and holds its last frame if it runs out first. In workflow JSON a video layer with a `preset` and no `start` starts at 0.
- Layouts: `video-bottom` / `video-top` and the stacks need `outputAspect` (`layout_needs_aspect`); the stacks and `pip` need a video layer (`layout_needs_video_layer`); a stack refuses `baseBox` (`layout_conflicts_base_box`). `pip` takes its corner from the first video layer's `corner` and replaces any box that layer had. "First video layer" = the lowest video layer in the layer order; image layers are not moved. `pip` and the stacks turn the first video layer's fade off; `video-bottom` / `video-top` touch no layer.
- `baseBox` needs `anchor`, `width` and an `outputAspect` (`base_box_needs_aspect`); whatever it leaves uncovered shows `backgroundColor`.
- A run with a video layer takes a base of at most 60 s (measured before charging: `video_overlay_too_long`) and each layer video at most 200 MB (`Layer N: video is too large (over 200 MB)`, found at render, refunded). A run estimate that cannot read the base's length quotes the 60 s cap, 132 credits<!-- credits: video-overlay:video@12 -->. The price follows video layers, not the layout: `video-bottom` over images alone is the image-only price.
- `card` sits over the middle of the frame — over the speaker's face on a 9:16 selfie. Put logos and badges that must not cover the subject in a `corner-badge` or a custom box.
- Percentages are of the OUTPUT frame: with `outputAspect` set, that is the target canvas, not the source video.
- A layer ending past the video is clipped and one starting at or after its end is skipped — both reported in the job's `warnings[]`; when every layer starts after the end, a run with a video layer is refused before charging (`video_overlay_starts_after_end`) and an image-only run fails at the render (refunded).
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
