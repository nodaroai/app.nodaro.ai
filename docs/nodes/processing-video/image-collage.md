# Image Collage

> Composite multiple images into ONE large 2K/4K image, arranged by a smart layout.

## Overview

The Image Collage node takes every image wired into its input and arranges them into a single composited image. Connect 2–30 image producers — or a **List** of image URLs — to the input handle, and the node tiles them to fill the whole output canvas with no wasted space. Two layout algorithms:

- **Smart** (default) — justified rows (Google-Photos / Flickr style). Images are partitioned into aspect-balanced rows; each row is width-justified to fill the canvas and row heights are scaled so they sum to the canvas height. Preserves input order and respects each image's aspect ratio, so cropping is minimal.
- **Grid** — a uniform `ceil(√n)`-column grid; every cell is identical and the last (partial) row is centered.

Each image is cover-cropped (centered, no distortion) into its computed cell. It's a local FFmpeg operation — no external provider, no browser.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layout | Select | smart | `smart` (justified rows) or `grid` (uniform cells) |
| Aspect Ratio | Select | 1:1 | Output canvas ratio: `1:1`, `16:9`, `9:16`, or `4:5` |
| Resolution | Select | 2K | Long-edge resolution: `2K` (2560px) or `4K` (3840px) |
| Gap | Number | 24 | Space between cells + outer margin, in px on the output canvas (0–200) |
| Background Color | Color | #ffffff | Shown in the gaps around/between images |

The canvas dimensions are derived from `resolution` (long edge) × `aspectRatio` — e.g. 4K + 16:9 = 3840×2160, 2K + 1:1 = 2560×2560, 4K + 9:16 = 2160×3840.

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

- Use **smart** layout when the inputs have mixed aspect ratios (portrait + landscape) — it balances them into rows with minimal cropping. Use **grid** when you want a clean, uniform tile look.
- Pick an **aspect ratio** that matches where the collage will be used: `1:1` / `4:5` for social feeds, `16:9` for slides/thumbnails, `9:16` for stories/reels.
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
- Each image is cover-cropped to its cell, so very different aspect ratios stay proportioned rather than stretched.
- The node reuses the shared media-node result strip, so multiple runs are browsable as versions.
