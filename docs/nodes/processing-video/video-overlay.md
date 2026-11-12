# Video Overlay

> Place up to 20 timed layers — images (logos, product shots, screenshots, cards) or up to 2 videos — over a video in one local render: a video at the bottom of a vertical frame, two videos stacked, a picture in picture. A live preview on the node.

## Overview

The Video Overlay node takes a **base video** and one or more **layers** and returns the video with each layer shown over it during its own time window. A layer is an **image** or a **video**. Nothing is regenerated: the frames are composited with the exact files you gave.

The **base audio is kept untouched** — copied as-is when it is AAC, MP3, AC-3 or Opus, re-encoded to AAC otherwise (the run says so in its warnings) — unless you turn a video layer's sound on (see [Sound](#sound)).

It is a local, deterministic FFmpeg step — no AI model, no provider — and it runs with zero API keys in the community edition.

**Live preview.** Once a base video is connected the node shows its frame with the layers drawn where the render will put them; a video layer shows its first frame. Selecting a layer (click its bar in the settings' timeline) jumps the preview to the layer's start time; the preview shows only the layers visible at that moment. Drag a layer to move it and pull its corner handle to resize it — every drag writes the layer's percentages back into the settings, so the preview and the run use the same numbers. The base video moves the same way once you select it with **Move on preview** on its card (see [The base video](#the-base-video)). A result from any run of the current settings — the node's own Run (also one that finishes while the page is closed or reloading), Execute All, Run from here, a schedule, a webhook or an app run — reads as the fresh "Result". Each result of a list run is stamped with the composition of its own list item, so it reads fresh when that item is what the node previews now. A result rendered under other settings (another base video, another layer image or video, a moved layer or base, another layout, aspect, fit, pad colour or sound) shows as "Result (old)" on the node until you run again.

## Timing

- **Start** and **End** are seconds from the start of the video (0–3600); End must be after Start. **No End = until the video ends.**
- Times keep the precision you type (word-aligned milliseconds survive); the render places them on the video's frame grid, so a layer can appear up to one frame early or late.
- A layer whose End is past the end of the video is **clipped** to it; a layer that starts at or after the end is **skipped** (its file is never downloaded). Both are reported in the run's warnings. When every layer starts after the end, the run is refused with `Every layer starts after the video ends (10.00 s)`: a run with a video layer before anything is charged (`video_overlay_starts_after_end` — a 400 on the API; in a workflow run the node fails before anything is reserved), an image-only run at the render, and nothing is charged.
- **Animate**: the layer fades in while growing from 96 % to 100 % of its size over 0.15 s, and does the reverse at its end. A layer shorter than 0.3 s uses half its length for each ramp. **On by default for an image layer, off for a video layer** — a fade would show at the start and end of a stacked or inset video. On a layer handle the default follows what is wired into it: connect a video and its fade is off unless you turn it on.

The panel warns about clipped and skipped layers as you type, from the length the browser reads. That length can differ from the video stream's by a few hundredths of a second, so the run's warnings are the final word.

## Video layers

A layer carries **an image or a video, never both** — on the API `imageUrl` or `videoUrl`; a layer with both is refused (`layers[0]: has both an image and a video — keep one (imageUrl or videoUrl)`). A run takes **at most 2 video layers** (`At most 2 video layers (got 3)`). Everything else about a layer works as for an image: its box, Start, End, opacity and layer order. Images can sit above videos; the base is always at the bottom.

- A video layer **plays from its own first frame**, beginning at the layer's Start.
- It **stops at the layer's End**, or at the end of the base video when it has none.
- If its file **runs out first, it holds its last frame** until its window ends.
- **Fit** means the same as for an image: `contain` shows the whole video in the box, `cover` fills the box and crops. Without a height the box follows the video's own shape.
- The output keeps the base video's frame rate; a layer video at another rate is drawn at the base's.
- A video layer's picture is placed on even pixels (left, top, width and height rounded down to even), exactly as the render draws it, so the preview and the result agree to the pixel.
- On a layer handle the wire decides whether the layer is an image or a video. In workflow JSON or a template, a video layer that names a preset but no `start` starts at 0, as a connected layer you have not touched does; on the API and MCP `start` is required.

## Sound

- **By default only the base video's sound plays**, handled exactly as it is without video layers.
- A video layer is **silent unless its sound is on**. On the canvas: the layer's **Sound** section, **Play this video's sound**, then **Volume** (0–100 %). On the API: `sound: { volume }`, 0 to 1 (1 = as recorded).
- A sounding layer is **mixed with the base's sound during its window**, at its volume. The mix passes a limiter that holds its peaks at or below −1 dBFS (two loud sources at full volume would otherwise clip); normal levels are not raised or lowered. A mixed soundtrack is **AAC**, as long as the video. With a silent base, the soundtrack is the layer's sound alone, padded with silence.
- A sounding layer whose video has no audio track is drawn silent and reported in the warnings (`layer_no_audio`).
- **Sound is for a video layer only.** A layer that carries its own image and a `sound` is refused (`layers[0]: sound is only for a video layer — remove it or set videoUrl`). On a layer handle whose wire turns out to carry an image at run time, a stored sound is skipped instead and the run goes ahead.

## Placement

Every position and size is a **percentage of the output frame**:

| Preset | Where it lands |
|---|---|
| **Card** | Centred, 4 % above the middle, fitted inside 78 % × 60 % of the frame (the image or video keeps its aspect) |
| **Corner badge** | 18 % of the frame width, 4 % in from the chosen corner (top-left, top-right, bottom-left, bottom-right — default bottom-right) |
| **Full frame** | Covers the whole frame (cropped to fill) |
| **Custom** | Your own box: anchor, offsets, width, height, fit |

A custom box has an **anchor** (one of nine positions), an **offset** `x` / `y` from it (−100 to 100 % of the frame width / height — negative on a right or bottom anchor moves the layer inward), a **width** (1–100 % of the frame width) and an optional **height** (1–100 % of the frame height; without it the height follows the image's or video's aspect). **Fit** decides how the layer fills an explicit box: `contain` (the whole image or video, centred) or `cover` (fills the box, cropped).

- **An explicit box field overrides the preset** — the layer becomes Custom. Dragging or resizing a preset layer on the preview does the same.
- **A layer with neither a preset nor a box is a corner badge** — bottom-right, or the corner it names. A connected layer you have not touched runs as the bottom-right corner badge from the start to the end of the video.
- A tall image whose height follows its aspect is **fitted inside the frame**: a 1 : 10 image at width 60 % on a 1080 × 1920 video is drawn 192 × 1920, never taller than the frame.
- **Card sits over the middle of the frame — over the speaker's face on a 9 : 16 selfie video, on purpose** (product cards pop over the talking head). A logo or a badge that must not cover the subject belongs in a corner badge or a custom box.
- Drawn sizes are rounded down to even pixels (at least 2 × 2).
- **Opacity** 0–1; **Layer order** 0–100, higher on top — empty = its position (Layer 1 lowest).

## Layouts

A **layout** is a named shortcut that places the base video, the **first video layer** (the lowest video layer in the layer order) or both — the table says which. Image layers stay where you put them. On the canvas it is the **Layout** select at the top of the settings (**Custom** = no layout); on the API, MCP, SDK and CLI it is the request-level `layout`.

| Layout | `layout` | Base video | First video layer | Needs |
|---|---|---|---|---|
| **Video at bottom** | `video-bottom` | Whole, full width, against the bottom edge | Not placed | an output aspect |
| **Video at top** | `video-top` | Whole, full width, against the top edge | Not placed | an output aspect |
| **Stack whole** | `stack-whole` | Whole, directly above the first video layer | Whole, directly below the base | an output aspect and a video layer |
| **Stack filled** | `stack-filled` | The top half, cropped to fill | The bottom half, cropped to fill | an output aspect and a video layer |
| **Picture in picture** | `pip` | As without a layout (Video fit, or its base box) | 30 % of the frame wide, 4 % in from its `corner` (default bottom-right) | a video layer |

- **Stack whole** shows both videos whole, at the same width, touching, the pair centred with equal room above and below (the drawn sizes round down to even pixels, so the two gaps can differ by a pixel or two). They shrink together only when the two are taller than the frame. Two 16:9 videos on 1080 × 1920 draw at 1080 × 606 each, with 354 px above and below. A 16:9 base above a 1:1 video draws at y 116–722 and 722–1802 — 116 px above, 118 px below — and the join sits off the middle.
- **Stack filled** on 1080 × 1920: the base fills y 0–960, the video layer y 960–1920, both cropped.
- **Video at bottom** with a 16:9 base on 1080 × 1920 draws the base at y 1314–1920, flush with the bottom edge; images above it go where you place them. Video at top and Video at bottom need no video layer: an image-only run with one keeps its flat price.
- **Picture in picture** takes its corner from the first video layer's `corner`, and replaces any box that layer had.
- **Picture in picture** and the two stacks turn the first video layer's fade off. Video at bottom and Video at top leave every layer as it is.
- A layout that needs an output aspect is refused without one (`layout video-bottom needs an outputAspect`); one that needs a video layer is refused without one (`layout pip needs a video layer — set videoUrl on a layer or connect a video to a layer's handle`). The two stacks place the base themselves, so a stack with a `baseBox` is refused (`A stack layout places the base itself — remove baseBox or choose Custom`). An explicit `baseBox` wins over Video at bottom and Video at top.
- On the canvas: choosing a layout that needs an output aspect when none is set picks 9:16; choosing any layout removes a base box you placed yourself. Moving or resizing any layer (or changing its placement) or moving the base turns the layout into **Custom** and keeps everything where it is. Under Picture in picture or a stack, so does changing the fade of its first video layer.

## The base video

By default the base fills the output as described under [Output frame](#output-frame). With an output aspect you can also place it yourself, with a **base box** in a layer's vocabulary — `anchor`, `x`, `y`, `width`, optional `height`, `fit` (on the API `baseBox`; `anchor` and `width` are required, `x` and `y` default to 0 and `fit` to `contain`). A base box overrides Video fit; whatever it leaves uncovered shows the **Padding colour**. A base box needs an output aspect (`baseBox needs an outputAspect`).

On the canvas the **Base video** card shows where the base is:

- without an output aspect it says one is needed to move the base;
- under a stack layout it says the layout places the base, and offers **Move on preview** once the two videos' shapes are read;
- placed by Video fit, it offers **Move on preview**;
- under Video at bottom or Video at top with no box of its own, it shows the layout's box as fields, under a Placement summary that names the layout, with **Move on preview** and no **Reset**; editing a field turns the layout into Custom;
- with a box of its own, it shows the box's fields (anchor, offsets, width, height, fit) and **Reset**, which removes the box so Video fit places the base again.

Press **Move on preview** to select the base: it can then be dragged and resized on the preview, like a layer, and the first move gives it a box of its own. Under any layout the first move turns the layout into Custom and keeps everything where it is. Unselected, the base takes no clicks on the preview — dragging the node body moves the node as before.

## Output frame

- By default the output has the video's **own display size and frame rate**: a phone clip stored sideways and tagged as rotated renders upright, non-square pixels are resolved, and odd dimensions are rounded down to even (a 1079 × 1919 source renders 1078 × 1918).
- **Output aspect** renders onto a fixed canvas instead — 16:9 (1920 × 1080), 9:16 (1080 × 1920), 1:1 (1080 × 1080) or 4:5 (1080 × 1350). **Video fit** `cover` (default) fills the canvas and crops the video; `contain` shows the whole video and pads with the **Padding colour** (default black). Layer percentages are then of that canvas. Video fit and Padding colour need an output aspect: a request that sets them without one is refused (`baseFit and backgroundColor need an outputAspect`).
- A base box or a layout places the base instead of Video fit (see [Layouts](#layouts) and [The base video](#the-base-video)).
- Encoding: H.264, `yuv420p`, MP4 with fast start.
- Audio: **only the first audio stream is kept** (a second audio track is dropped) — copied when it is AAC, MP3, AC-3 or Opus, re-encoded to AAC otherwise; a video with no audio renders silent. A video layer with its sound on changes this (see [Sound](#sound)).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layout | Select | Custom | Video at bottom · Video at top · Stack whole · Stack filled · Picture in picture · Custom. See Layouts. On the API `layout`. |
| Base video card | Box fields, Move on preview, Reset | *(placed by Video fit)* | With an output aspect: the base's own box. See The base video. On the API `baseBox`. |
| Layer *n* → Start (s) | Number | 0 | When the layer appears, seconds from the start of the video. On the API `layers[i].start`. |
| Layer *n* → End (s) | Number, optional | *(to end)* | When it disappears; after Start. On the API `layers[i].end`. |
| Layer *n* → Placement | Card · Corner badge · Full frame · Custom | Corner badge | The preset (with a corner picker for Corner badge), or Custom for your own box. On the API `layers[i].preset` / `corner`. |
| Layer *n* → Anchor / Offset X / Offset Y / Width / Height / Fit | Custom only | *(the preset's box)* | See Placement. On the API `anchor`, `x`, `y`, `width`, `height`, `fit`. |
| Layer *n* → Layer order (z) | Number, optional | *(layer number)* | Higher draws on top. On the API `layers[i].zIndex`. |
| Layer *n* → Opacity | Slider (0–100 %) | 100 % | On the API `opacity` is 0..1. |
| Layer *n* → Animate in/out | Switch | On for an image, off for a video | Fade and slight scale over 0.15 s at each end. On the API `animate`. |
| Layer *n* → Sound → Play this video's sound / Volume | Switch, slider (0–100 %) | Off | A video layer only: mixes its sound with the base's during its window. On the API `layers[i].sound.volume` (0..1); no `sound` = silent. |
| Layer handles | + / − buttons | 4 | How many layer handles the node shows (1–12). The count grows by itself when you wire a higher handle. |
| Output aspect | Select | Same as video | See Output frame. On the API `outputAspect`. Same as video also removes a base box and a layout that needs an aspect. |
| Video fit | Select | Cover | With an output aspect: `cover` or `contain`. On the API `baseFit`. |
| Padding colour | Colour | #000000 | With Video fit `contain`, or around a base box: the padding colour. On the API `backgroundColor`. |

Layers are index-aligned with the handles: **Layer 1** is what is wired into `overlay`, **Layer 2** into `overlay2`, and so on. A layer can also carry an image or video URL instead of a wire (the API, MCP and templates use this, and it is how layers 13 and up exist); wiring into the layer's handle replaces that URL.

## Inputs & Outputs

**Inputs:**
- **Video** (`video`, required) — the base video; any video producer or an uploaded video.
- **Layer 1–12** (`overlay`, `overlay2` … `overlay12`) — an image or a video each; any image or video producer (an Image Overlay composite, a screenshot, an uploaded PNG / JPEG / WebP, a generated or uploaded video).

**Outputs:**
- **Video** — the composited MP4.

## Layer plan input

Besides its twelve layer handles, Video Overlay has a **Layer plan** input. Wire into it a JSON list of layers in the node's own layer shape (`imageUrl` or `videoUrl`, `start`, `end`, `sound`, and the box fields `anchor`, `x`, `y`, `width`, `height`, `fit`), for example from a node that times screenshot cards to a voice-over.

- Plan layers are drawn **under** the handle layers, so a logo badge on a handle stays on top.
- Each plan layer must carry its own `imageUrl` or `videoUrl`. It is never filled from a handle; a plan layer without one fails with "Plan layer <n>: no image or video — set imageUrl or videoUrl on this layer in the plan."
- Plan layers and handle layers count together toward the 20-layer limit, and their video layers toward the 2-video limit.
- The preview shows plan layers read-only ("From the layer plan").
- **An empty plan passes the video through**: with a layer plan wired and no layer to draw, the node outputs its video unchanged, at no cost.

## Limits

- 1–20 layers per run: 12 handles on the canvas; layers 13 and up come from the API, MCP or a template via an image or video URL. A node written with more than 20 layers that have a source is refused before the run starts (`At most 20 layers (got 24)`; on the canvas the Run button says so, and the settings list every stored layer). Removing any layers brings it back to 20; the layers that remain keep their numbers (remove Layers 1–4 of 24 and Layers 5–24 run). No layer is dropped silently and nothing is charged.
- **Video layers: at most 2 per run**, and a run with a video layer takes a **base video of up to 60 seconds**. The base is measured before anything is charged, on the API and in a workflow run: a longer one is refused — `The base video is 61 seconds. A Video Overlay with a video layer takes a base of up to 60 seconds — trim it first.` (`video_overlay_too_long`) — and one that cannot be read is refused too (`Could not read the base video. The file may be corrupted or an unsupported format.`, `invalid_media_duration`). On the canvas the settings warn of a base past 60 s; the Run button stays enabled, and the server's measurement decides. An image-only run is not measured and has no such cap.
- **Each layer video: at most 200 MB.** A larger one fails the run (`Layer 2: video is too large (over 200 MB)`); one that cannot be fetched fails with `Layer 2: video could not be fetched`, and a file that is not a video (an image, audio, a web page) with `Layer 2: not a video`.
- Layer images: **PNG, JPEG or WebP**, at most **25 MB each** and **100 MB together**, at most **8192 px** on the longest edge and **400 megapixels together**. EXIF orientation (JPEG and WebP) is applied. **SVG is refused** — rasterise it with Image Overlay first. An **animated image** (WebP, APNG) renders its **first frame**; an animated WebP is reported in the warnings.
- The base must be a video: an audio file (even one with cover art), an image or a web page saved as `.mp4` fails with `The base input is not a video`.
- A layer image that cannot be fetched fails the run (`Layer 3: image could not be fetched`) — nothing is charged for a failed run.
- With a stack layout, a first video layer that starts at or after the end of the base is refused before anything is charged (`Layer 2: the stacked video starts at 12 s, after the video ends (10.00 s)`, `video_overlay_starts_after_end`).
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
| `layer_no_audio` | A video layer had its sound on but its video has no sound, so none was mixed in |

## Credit Cost

- **Image-only run: 22 credits**<!-- credits: video-overlay --> per run, whatever the number of layers or the video's length. The base is not measured for the price.
- **A run with any video layer: 11 credits<!-- credits-rate: video-overlay:video --> per started 5 seconds of the output** — the base video's length, which is the output's. Up to 0.05 s past a whole second is ignored first, so a 10.01 s base is 2 units, not 3.

| Base video | Units | Credits |
|---|---|---|
| 3 s | 1 | 11<!-- credits: video-overlay:video --> |
| 10 s | 2 | 22<!-- credits: video-overlay:video@2 --> |
| 30 s | 6 | 66<!-- credits: video-overlay:video@6 --> |
| 60 s | 12 | 132<!-- credits: video-overlay:video@12 --> |
| 61 s | — | refused before anything is charged |

**Formula:** credits = 11<!-- credits-rate: video-overlay:video --> × ceil(priced seconds ÷ 5), where the priced seconds are the base's, rounded up to a whole second after ignoring up to 0.05 s past one, at least 1 (a base the price counts as 60 s, such as 60.04 s, is accepted at 12 units). What decides the price is whether any layer is a video, not the layout: Video at bottom over image layers alone is still the image-only price.

- **Measured before the charge.** The API and a workflow run read the base's length before anything is reserved, and refuse a base they cannot read, one past 60 s, and one that every layer — or a stack's first video layer — starts after (`video_overlay_starts_after_end`; see Timing and Limits).
- **Before a run**, the Run button and a workflow estimate quote a run with a video layer from its base's length when the workflow already knows it, and at the 60 s cap — 132 credits<!-- credits: video-overlay:video@12 --> — when it does not, so a quote is never below the charge. A layer handle wired from a node that may hand over a video, and a layer plan whose layers are only known at run time, are quoted as a run with a video layer; UGC Cards' layer plan is its card images, so it keeps the image-only price.
- **Re-measured at the render.** The render measures the base again: a base up to 0.5 s longer than the length it was charged for is the same file; a longer one (a link that now serves a longer video) is refused before anything is drawn — `The base video is 30 seconds, longer than the 10 seconds this run was priced for — run it again` — and the charge is refunded.
- `GET /v1/credits/model-cost?model=video-overlay` answers the image-only price, `model=video-overlay:video` one 5-second unit (11 credits<!-- credits: video-overlay:video -->), and `model=video-overlay:video:<N>u` the price of N units.

Self-hosted community installs have no credits — the node runs there with zero keys.

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

## Worked examples — videos together

**A 16:9 video at the bottom of a 9:16 frame, with a card above it.** The base is drawn 1080 × 606 at y 1314–1920; the card sits in the black space above. An image-only run: 22 credits<!-- credits: video-overlay -->.

```json
{
  "videoUrl": "https://…/talk-16x9.mp4",
  "outputAspect": "9:16",
  "layout": "video-bottom",
  "layers": [
    { "imageUrl": "https://…/card.png", "start": 0, "anchor": "top", "x": 0, "y": 8, "width": 80 }
  ]
}
```

**Two 16:9 videos stacked, whole.** Each is drawn 1080 × 606, with 354 px above and below; the second video holds its last frame if it is shorter than the base. For a 30 s base: 66 credits<!-- credits: video-overlay:video@6 -->.

```json
{
  "videoUrl": "https://…/a.mp4",
  "outputAspect": "9:16",
  "layout": "stack-whole",
  "layers": [ { "videoUrl": "https://…/b.mp4", "start": 0 } ]
}
```

**A fixed picture in picture with the inset's sound on.** The inset is 30 % of the frame wide, 4 % in from the top-right corner, and its sound is mixed with the base's at 80 %. For a 10 s base: 22 credits<!-- credits: video-overlay:video@2 -->.

```json
{
  "videoUrl": "https://…/main.mp4",
  "layout": "pip",
  "layers": [ { "videoUrl": "https://…/guest.mp4", "start": 0, "corner": "top-right", "sound": { "volume": 0.8 } } ]
}
```

Through MCP the verb is `overlay_images` (layers take `url` or `asset_id` for an image, `video_url` or `video_asset_id` for a video; the tool takes `layout` and `base_box`); from the CLI, `nodaro media video-overlay` (video layers through `--layers-file`, with `--layout` and `--base-box`).

## Best Practices

- Use **Card** for screenshots and product shots that should read for a second or two; keep cards **non-overlapping in time** so one is on screen at a time.
- Use a **Corner badge** (or a custom box) for anything that stays up for long — a logo, a handle, a price — so it never covers the speaker.
- Feed **transparent PNGs** for logos; an opaque JPEG places as a rectangle.
- Set **Output aspect** only when you need a different frame than the video's own — the default keeps the size and frame rate of the source.
- For two videos together, pick a **layout** first and adjust from there; trim the base to 60 s or less first, since a run with a video layer takes no longer base.
- Turn a video layer's **sound** on only when it should be heard; at full volume over a loud base, lower one of them.

## Common Use Cases

- Product cards, app screenshots and web pages timed to a voice-over (UGC ads).
- A logo or channel handle over the whole video.
- A landscape clip at the bottom of a vertical frame, with a title card above it.
- Two clips stacked for a reaction or a before / after.
- A fixed picture in picture — a guest, a screen recording, a camera inset.
- Price tags and "NEW" badges over product clips.

## Tips

- Times are in seconds from the start of the video; use Trim Video first if you want to cut the base.
- To caption the result, wire it into **Add Captions** — the overlays stay under the captions.
- Wire an **Image Overlay** result into a layer handle to put text, a QR code or a styled badge on the video.
