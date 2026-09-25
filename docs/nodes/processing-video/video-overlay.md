# Video Overlay

> Place up to 20 timed image layers — logos, product shots, screenshots, cards — over a video in one local render, with a live preview on the node.

## Overview

The Video Overlay node takes a **base video** and one or more **layer images** and returns the video with each image shown over it during its own time window. Nothing is regenerated: the frames are composited with the exact files you gave, and the **base audio is kept untouched** — copied as-is when it is AAC, MP3, AC-3 or Opus, re-encoded to AAC otherwise (the run says so in its warnings).

It is a local, deterministic FFmpeg step — no AI model, no provider — and it runs with zero API keys in the community edition.

**Live preview.** Once a base video is connected the node shows its frame with the layers drawn where the render will put them. Selecting a layer (click its bar in the settings' timeline) jumps the preview to the layer's start time; the preview shows only the layers visible at that moment. Drag a layer to move it and pull its corner handle to resize it — every drag writes the layer's percentages back into the settings, so the preview and the run use the same numbers. A result from any run of the current settings — the node's own Run (also one that finishes while the page is closed or reloading), Execute All, Run from here, a schedule, a webhook or an app run — reads as the fresh "Result". Each result of a list run is stamped with the composition of its own list item, so it reads fresh when that item is what the node previews now. A result rendered under other settings (another base video, another layer image, a moved layer, another aspect, fit or pad colour) shows as "Result (old)" on the node until you run again.

## Timing

- **Start** and **End** are seconds from the start of the video (0–3600); End must be after Start. **No End = until the video ends.**
- Times keep the precision you type (word-aligned milliseconds survive); the render places them on the video's frame grid, so a layer can appear up to one frame early or late.
- A layer whose End is past the end of the video is **clipped** to it; a layer that starts at or after the end is **skipped** (its image is never downloaded). Both are reported in the run's warnings. When every layer starts after the end, the run fails with `Every layer starts after the video ends (… s)`.
- **Animate** (on by default): the layer fades in while growing from 96 % to 100 % of its size over 0.15 s, and does the reverse at its end. A layer shorter than 0.3 s uses half its length for each ramp.

The panel warns about clipped and skipped layers as you type, from the length the browser reads. That length can differ from the video stream's by a few hundredths of a second, so the run's warnings are the final word.

## Placement

Every position and size is a **percentage of the output frame**:

| Preset | Where it lands |
|---|---|
| **Card** | Centred, 4 % above the middle, fitted inside 78 % × 60 % of the frame (the image keeps its aspect) |
| **Corner badge** | 18 % of the frame width, 4 % in from the chosen corner (top-left, top-right, bottom-left, bottom-right — default bottom-right) |
| **Full frame** | Covers the whole frame (cropped to fill) |
| **Custom** | Your own box: anchor, offsets, width, height, fit |

A custom box has an **anchor** (one of nine positions), an **offset** `x` / `y` from it (−100 to 100 % of the frame width / height — negative on a right or bottom anchor moves the layer inward), a **width** (1–100 % of the frame width) and an optional **height** (1–100 % of the frame height; without it the height follows the image's aspect). **Fit** decides how the image fills an explicit box: `contain` (the whole image, centred) or `cover` (fills the box, cropped).

- **An explicit box field overrides the preset** — the layer becomes Custom. Dragging or resizing a preset layer on the preview does the same.
- **A layer with neither a preset nor a box is a corner badge** — bottom-right, or the corner it names. A connected layer you have not touched runs as the bottom-right corner badge from the start to the end of the video.
- A tall image whose height follows its aspect is **fitted inside the frame**: a 1 : 10 image at width 60 % on a 1080 × 1920 video is drawn 192 × 1920, never taller than the frame.
- **Card sits over the middle of the frame — over the speaker's face on a 9 : 16 selfie video, on purpose** (product cards pop over the talking head). A logo or a badge that must not cover the subject belongs in a corner badge or a custom box.
- Drawn sizes are rounded down to even pixels (at least 2 × 2).
- **Opacity** 0–1; **Layer order** 0–100, higher on top — empty = its position (Layer 1 lowest).

## Output frame

- By default the output has the video's **own display size and frame rate**: a phone clip stored sideways and tagged as rotated renders upright, non-square pixels are resolved, and odd dimensions are rounded down to even (a 1079 × 1919 source renders 1078 × 1918).
- **Output aspect** renders onto a fixed canvas instead — 16:9 (1920 × 1080), 9:16 (1080 × 1920), 1:1 (1080 × 1080) or 4:5 (1080 × 1350). **Base fit** `cover` (default) fills the canvas and crops the video; `contain` shows the whole video and pads with the **Background colour** (default black). Layer percentages are then of that canvas. Base fit and Background colour need an output aspect: a request that sets them without one is refused.
- Encoding: H.264, `yuv420p`, MP4 with fast start.
- Audio: **only the first audio stream is kept** (a second audio track is dropped) — copied when it is AAC, MP3, AC-3 or Opus, re-encoded to AAC otherwise; a video with no audio renders silent.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layer *n* → Start (s) | Number | 0 | When the layer appears, seconds from the start of the video. On the API `layers[i].start`. |
| Layer *n* → End (s) | Number, optional | *(to end)* | When it disappears; after Start. On the API `layers[i].end`. |
| Layer *n* → Placement | Card · Corner badge · Full frame · Custom | Corner badge | The preset (with a corner picker for Corner badge), or Custom for your own box. On the API `layers[i].preset` / `corner`. |
| Layer *n* → Anchor / Offset X / Offset Y / Width / Height / Fit | Custom only | *(the preset's box)* | See Placement. On the API `anchor`, `x`, `y`, `width`, `height`, `fit`. |
| Layer *n* → Layer order (z) | Number, optional | *(layer number)* | Higher draws on top. On the API `layers[i].zIndex`. |
| Layer *n* → Opacity | Slider (0–100 %) | 100 % | On the API `opacity` is 0..1. |
| Layer *n* → Animate in/out | Switch | On | Fade and slight scale over 0.15 s at each end. On the API `animate`. |
| Layer handles | + / − buttons | 4 | How many layer handles the node shows (1–12). The count grows by itself when you wire a higher handle. |
| Output aspect | Select | Same as video | See Output frame. On the API `outputAspect`. |
| Base fit | Select | Cover | With an output aspect: `cover` or `contain`. On the API `baseFit`. |
| Background colour | Colour | #000000 | With Base fit `contain`: the padding colour. On the API `backgroundColor`. |

Layers are index-aligned with the handles: **Layer 1** is what is wired into `overlay`, **Layer 2** into `overlay2`, and so on. A layer can also carry an image URL instead of a wire (the API, MCP and templates use this, and it is how layers 13 and up exist); wiring an image into the layer's handle replaces that URL.

## Inputs & Outputs

**Inputs:**
- **Video** (`video`, required) — the base video; any video producer or an uploaded video.
- **Layer 1–12** (`overlay`, `overlay2` … `overlay12`) — images; any image producer (an Image Overlay composite, a screenshot, an uploaded PNG / JPEG / WebP).

**Outputs:**
- **Video** — the composited MP4.

## Limits

- 1–20 layers per run: 12 handles on the canvas; layers 13 and up come from the API, MCP or a template via an image URL. A node written with more than 20 layers that have an image is refused before the run starts (`At most 20 layers (got 24)`; on the canvas the Run button says so, and the settings list every stored layer). Removing any layers brings it back to 20; the layers that remain keep their numbers (remove Layers 1–4 of 24 and Layers 5–24 run). No layer is dropped silently and nothing is charged.
- Layer images: **PNG, JPEG or WebP**, at most **25 MB each** and **100 MB together**, at most **8192 px** on the longest edge and **400 megapixels together**. EXIF orientation (JPEG and WebP) is applied. **SVG is refused** — rasterise it with Image Overlay first. An **animated image** (WebP, APNG) renders its **first frame**; an animated WebP is reported in the warnings.
- The base must be a video: an audio file (even one with cover art), an image or a web page saved as `.mp4` fails with `The base input is not a video`.
- A layer image that cannot be fetched fails the run (`Layer 3: image could not be fetched`) — nothing is charged for a failed run.
- The render stops after **10 minutes** (`Render exceeded the 10-minute limit`).
- The API accepts up to 30 requests a minute per user.

## Warnings

A successful run's output carries `warnings[]` — `{ layer?, slot?, code, detail }`, where `layer` is the 0-based index in the request's `layers` and `slot` the canvas handle number. The node's settings show them as one "Last run" line.

| `code` | Meaning |
|---|---|
| `clipped` | The layer's End was past the video's end; it was shown until the end |
| `skipped` | The layer started at or after the video's end; it was not drawn |
| `animated_first_frame` | The image was an animated WebP; its first frame was used |
| `audio_reencoded` | The base's audio codec cannot be copied into MP4 as-is; it was re-encoded to AAC |

## Credit Cost

**20 credits** per run, whatever the number of layers or the video's length. Self-hosted community installs have no credits — the node runs there with zero keys.

## Worked example — product cards over a talking head

A 9:16 selfie video, three screenshots, each shown while the speaker mentions it:

| Layer | Image | Start | End | Placement |
|---|---|---|---|---|
| 1 | pricing-page.png | 1.2 | 2.6 | Card |
| 2 | dashboard.png | 3.0 | 4.4 | Card |
| 3 | logo.png | 0 | *(to end)* | Corner badge · top-right |

The same call through the API (`POST /v1/video-overlay`):

```json
{
  "videoUrl": "https://…/selfie.mp4",
  "layers": [
    { "imageUrl": "https://…/pricing-page.png", "start": 1.2, "end": 2.6, "preset": "card" },
    { "imageUrl": "https://…/dashboard.png", "start": 3.0, "end": 4.4, "preset": "card" },
    { "imageUrl": "https://…/logo.png", "start": 0, "preset": "corner-badge", "corner": "top-right" }
  ]
}
```

On a 1080 × 1920 video each card's box is 842 × 1152 px at (119, 307); a 1 : 2 screenshot is drawn 576 × 1152 px inside it, centred.

Through MCP the verb is `overlay_images` (layers take `url` or `asset_id`); from the CLI, `nodaro media video-overlay`.

## Best Practices

- Use **Card** for screenshots and product shots that should read for a second or two; keep cards **non-overlapping in time** so one is on screen at a time.
- Use a **Corner badge** (or a custom box) for anything that stays up for long — a logo, a handle, a price — so it never covers the speaker.
- Feed **transparent PNGs** for logos; an opaque JPEG places as a rectangle.
- Set **Output aspect** only when you need a different frame than the video's own — the default keeps the size and frame rate of the source.

## Common Use Cases

- Product cards, app screenshots and web pages timed to a voice-over (UGC ads).
- A logo or channel handle over the whole video.
- Picture-in-picture stills, before / after images, reaction images.
- Price tags and "NEW" badges over product clips.

## Tips

- Times are in seconds from the start of the video; use Trim Video first if you want to cut the base.
- To caption the result, wire it into **Add Captions** — the overlays stay under the captions.
- Wire an **Image Overlay** result into a layer handle to put text, a QR code or a styled badge on the video.
