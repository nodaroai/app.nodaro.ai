# Image Collage

> Composite multiple images into ONE large 2K/4K image, arranged by a smart layout.

## Overview

The Image Collage node takes every image wired into its input and arranges them into a single composited image. Connect 2–30 image producers — or a **List** of image URLs — to the input handle. **No image is ever cropped** — every source is shown in full. Two layout algorithms:

- **Smart** (default) — justified rows (Google-Photos / Flickr style). Images are partitioned into aspect-balanced rows; each row is width-justified to fill the canvas width at its **natural** row height, so every cell's width∶height equals its image's exact aspect ratio — **zero crop, zero letterbox**. Because the rows keep their natural heights, the overall canvas **height floats** to whatever the rows sum to; the chosen aspect ratio acts as a *target shape* that steers how many rows are opened (wider target → fewer, taller rows). Input order is preserved.
- **Grid** — a uniform `ceil(√n)`-column grid on the fixed canvas; every cell is identical and the last (partial) row is centered. Each image is **fit** (scaled down, centered) inside its cell, so mismatched aspect ratios are letterboxed with the background color rather than cropped.

Each image is fit inside its cell (centered, no distortion, no crop). It's a local FFmpeg operation — no external provider, no browser.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layout | Select | smart | `smart` (justified rows, height floats) or `grid` (uniform letterboxed cells) |
| Aspect Ratio | Select | 4:3 | Choose from `1:1`, `4:3`, `3:2`, `16:9`, `21:9`, `4:5`, `3:4`, `2:3`, `9:16` — each shown as a proportional shape in the picker. In **grid** mode this is the exact output canvas ratio; in **smart** mode it's a *target shape* that steers the row count while the real output height floats. Any `W:H` is accepted via the API. |
| Resolution | Select | 4K | Long-edge resolution: `2K` (2560px) or `4K` (3840px) |
| Gap | Number | 24 | Space between cells + outer margin, in px on the output canvas (0–200) |
| Background Color | Color | #ffffff | Shown in the gaps between images **and** in the letterbox space of grid cells |

In **grid** mode the canvas is exactly `resolution` (long edge) × `aspectRatio` — e.g. 4K + 16:9 = 3840×2160, 2K + 1:1 = 2560×2560, 4K + 4:3 = 3840×2880. In **smart** mode the width comes from that same target but the **height floats** so no image is cropped (bounded to at most 2× the target long edge; extreme inputs are uniformly scaled down, never cropped).

## Inputs & Outputs

**Inputs:** Image (2–30, required) — accepts any image producer or a List of image URLs on a single multi-input handle.
**Outputs:** Image (PNG)

## Credit Cost

Priced by output resolution:

| Resolution | Credits |
|------------|---------|
| 2K | 2 |
| 4K | 4 |

Independent of the number of input images (all compositing is a single local FFmpeg pass).

## Best Practices

- Use **smart** layout when the inputs have mixed aspect ratios (portrait + landscape) — it packs them into justified rows at their exact aspect ratios with no cropping and no wasted space. Use **grid** when you want a clean, uniform tile look and don't mind background letterboxing around off-ratio images.
- In **grid** mode, pick an **aspect ratio** that matches where the collage will be used: `1:1` / `4:5` for social feeds, `16:9` for slides/thumbnails, `9:16` for stories/reels. In **smart** mode the aspect ratio is only a target shape — the final height adapts to the images, so expect the output ratio to be *close to*, not exactly, your selection.
- Increase **gap** for a framed, gallery look; set it to `0` for an edge-to-edge mosaic.
- Wire a **List** node (image-url column) into the input to collage a batch of generated images in one step.
- Choose **4K** when the collage will be printed or displayed large; **2K** is plenty for on-screen use and costs fewer credits.

## Common Use Cases

- Build a contact sheet / mood board from a batch of Generate Image results.
- Combine multiple product shots into one shareable social image.
- Assemble a before/after or variation grid to compare generations side by side.
- Create a portrait collage from a set of character renders.

## Tips

- Input order is preserved — the first wired image lands top-left and the rest flow in reading order.
- No image is ever cropped or stretched — smart mode sizes each cell to the image's exact aspect ratio; grid mode fits (letterboxes) the image inside a uniform cell.
- The node reuses the shared media-node result strip, so multiple runs are browsable as versions.
