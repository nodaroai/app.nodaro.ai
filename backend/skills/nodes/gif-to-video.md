---
node_type: gif-to-video
generated_at: 2026-08-27T21:15:58.235Z
generated_from: 2266777f4
---

# Gif to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `gif-to-video`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `image`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `loopToMinimum: boolean`
- `targetDuration: number`
- `interpolate: boolean`
- `alphaBackground: "white" | "black"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `gifUrl?: string`
- `assetId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Gif to Video",
  "loopToMinimum": true,
  "targetDuration": 3,
  "interpolate": true,
  "alphaBackground": "white",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Convert an animated GIF into a widely-compatible H.264 MP4. The main use is
feeding a GIF as a **motion reference** to video models that reject GIF in the
video-reference slot (e.g. Seedance): drop this node between the GIF and the
video node — GIF in, MP4 out, connected by an ordinary edge. Rendered locally
with FFmpeg, no provider, **zero credits**.

The GIF arrives either from an upstream image producer (an uploaded `.gif`) on
the `image` input, or from the node's own upload dropzone.

Levers:
- **`loopToMinimum`** (default true) + **`targetDuration`** (2–8s, default 3):
  most GIFs are shorter than the ~2s a reference clip needs, so the node loops
  the GIF up to the target. Looping is seam-aware — a seamless GIF repeats
  end-to-end; a non-seamless one ping-pongs (forward + reversed) so a hard
  repeat's jump-cut isn't reproduced by the model as a motion event. A GIF
  already below the floor is looped regardless of the toggle.
- **`interpolate`** (default true): synthesizes in-between frames for smooth
  24fps motion. Turn off to preserve the GIF's original stepped, choppy timing
  (better for high-contrast graphic animation, where interpolation can smear).
- **`alphaBackground`** (white / black): MP4 can't carry transparency, so a GIF
  with an alpha channel is flattened onto this colour.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `gif_to_video`

**Input parameters:**
- `gif_url`
- `gif_asset_id`
- `loop_to_minimum`
- `target_duration`
- `interpolate`
- `alpha_background`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **A single-frame GIF** (a still saved with a `.gif` extension) has no motion
  to transfer; the node emits a short static clip and reports a warning rather
  than failing.
- **Very short / very few frames** (< ~0.5s or < 6 frames): there isn't enough
  motion for a useful reference no matter how it's looped — the node still
  produces a clip but warns.
- **Heavy stylistic effects** in the source (double exposure, ghosting, trails)
  tend to be read by the model as camera motion, not subject motion. Conversion
  can't fix that — describe the effect in the downstream prompt as well.
- The output is capped at 720p on the long side (extra resolution costs the
  downstream model money without improving motion fidelity) and clamped into a
  3–8s window (longer reference clips make the model pick motion inconsistently
  between runs).

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "gif-to-video-1",
  "type": "gif-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Gif to Video",
    "loopToMinimum": true,
    "targetDuration": 3,
    "interpolate": true,
    "alphaBackground": "white",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
