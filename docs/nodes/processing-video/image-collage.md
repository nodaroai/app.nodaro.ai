# Image Collage

> Composite multiple images into ONE large 2K/4K image, arranged by a smart layout.

## Overview

The Image Collage node takes every image wired into its input and arranges them into a single composited image. Connect 2–30 image producers — or a **List** of image URLs — to the input handle. **No image is ever cropped** — every source is shown in full. Two layout algorithms:

- **Smart** (default) — justified rows (Google-Photos / Flickr style). Images are partitioned into aspect-balanced rows; each row is width-justified to fill the canvas width at its **natural** row height, so every cell's width∶height equals its image's exact aspect ratio — **zero crop, zero letterbox**. Because the rows keep their natural heights, the overall canvas **height floats** to whatever the rows sum to; the chosen aspect ratio acts as a *target shape* that steers how many rows are opened (wider target → fewer, taller rows). Input order is preserved. Optional per-image **size hints** (Auto / Big / Medium / Small) bias the row packing: hinted-big images land in taller, less crowded rows (hero rows) and hinted-small ones pack denser rows — still without cropping anything.
- **Grid** — a uniform `ceil(√n)`-column grid on the fixed canvas; every cell is identical and the last (partial) row is centered. Each image is **fit** (scaled down, centered) inside its cell, so mismatched aspect ratios are letterboxed with the background color rather than cropped. Size hints are ignored in grid mode — its cells are uniform by design.

Each image is fit inside its cell (centered, no distortion, no crop). It's a local FFmpeg operation — no external provider, no browser.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layout | Select | smart | `smart` (justified rows, height floats) or `grid` (uniform letterboxed cells) |
| Number images | Switch | Off | Stamp a 1-based sequence number at each image's **top-left** corner (see **Badge corner**) — storyboard mode. Numbers count `1, 2, 3…` in the collage's final reading order (drag rows to renumber). On the API this is `numbered` (boolean; absent/`false` = off). |
| Badge corner | Select | Top-left | Where the number **and** label badges sit on each image: `top-left` (storyboard convention — the shot number leads the frame in reading order) or `top-right` (keeps the badge clear of a subject composed left-of-centre). Also in the node's bottom strip as one **Numbers** pill (None / Top-left / Top-right — "None" only turns the numbers off; labels keep their corner). On the API this is `badgePosition` (`"top-left"` \| `"top-right"`, default `top-left`). |
| Connected Images | Sortable thumbnail list | *(edge order)* | The config panel lists every connected input with its thumbnail — **drag rows to set the collage's reading order** (top row lands first / top-left). Each row also carries the size selector below. A List input moves as one block (its images keep their internal order). The same ordering can be done from the input handle's connection popover; reordering there resets the panel's custom order (edge order becomes authoritative again). |
| Image Sizes | Per-input selector | Auto | One selector per connected input (on its row in the list above): **Auto** ("don't care"), **Big** (~2× the linear size of Medium), **Medium**, or **Small** (~½). *Relative* hints for the **smart** layout's row packing — all-equal hints change nothing, and **grid** ignores them. A List input applies its hint to every image it contributes. On the API this is `imageSizes`, an array index-aligned with `imageUrls`: `0` auto, `1` big, `2` medium, `3` small. |
| Labels | Per-input text | *(none)* | An optional caption per connected input (a text field on its row in the list above), shown **after the number** as `3 · Close-up` (label alone when Number images is off). A List input applies its label to every image it contributes. On the API this is `imageLabels`, an array index-aligned with `imageUrls`; `null`/`""` = no label for that image, each ≤ 80 chars, and a label too long to fit its image is ellipsized. |
| Aspect Ratio | Select | 4:3 | Choose from `1:1`, `4:3`, `3:2`, `16:9`, `21:9`, `4:5`, `3:4`, `2:3`, `9:16` — each shown as a proportional shape in the picker. In **grid** mode this is the exact output canvas ratio; in **smart** mode it's a *target shape* that steers the row count while the real output height floats. Any `W:H` is accepted via the API. |
| Resolution | Select | 4K | Long-edge resolution: `2K` (2560px) or `4K` (3840px) |
| Gap | Number | 24 | Space between cells + outer margin, in px on the output canvas (0–200) |
| Background Color | Color | #ffffff | Shown in the gaps between images **and** in the letterbox space of grid cells |

In **grid** mode the canvas is exactly `resolution` (long edge) × `aspectRatio` — e.g. 4K + 16:9 = 3840×2160, 2K + 1:1 = 2560×2560, 4K + 4:3 = 3840×2880. In **smart** mode the width comes from that same target but the **height floats** so no image is cropped (bounded to at most 2× the target long edge; extreme inputs are uniformly scaled down, never cropped).

### Auto-Attach to a Character Board (API)

Not exposed in the node's canvas config panel — these are request-body-only fields on `POST /v1/image-collage`, used by the Character Studio's **Board** page (see the [Character](../assets/character.md) node) and available to direct API callers.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `attachToCharacterId` | uuid | *(none)* | Character to attach the finished collage to. Combine with `attachToColumn` + `attachName` so the worker appends the result to that character on completion — even if the caller disconnects mid-generation. |
| `attachToColumn` | `"boards"` | *(none)* | The only valid attach target from this route. |
| `attachName` | string | *(none)* | Name the board is saved under. The Character Studio auto-suffixes on collision (e.g. "Evening gown 2"); the API does not dedupe for you. |
| `attachBoardType` | `"identity"` \| `"looks"` | *(none)* | Board kind recorded on the entry. The Character Studio's Board page always sends `"identity"`. |

All four are optional and independent of `layout`/`resolution`/`aspectRatio`/`gap`/`backgroundColor` — pricing (below) is unaffected by whether the result is attached.

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
- Mark one image **Big** to get a hero/mood-board look — it tends to claim its own tall row while the rest flow around it. Size hints are relative and best-effort: they are most visible with 5+ images, and combining **Big** on the hero with **Small** on the filler images produces the strongest contrast.
- In **grid** mode, pick an **aspect ratio** that matches where the collage will be used: `1:1` / `4:5` for social feeds, `16:9` for slides/thumbnails, `9:16` for stories/reels. In **smart** mode the aspect ratio is only a target shape — the final height adapts to the images, so expect the output ratio to be *close to*, not exactly, your selection.
- Increase **gap** for a framed, gallery look; set it to `0` for an edge-to-edge mosaic.
- Wire a **List** node (image-url column) into the input to collage a batch of generated images in one step.
- Choose **4K** when the collage will be printed or displayed large; **2K** is plenty for on-screen use and costs fewer credits.

## Common Use Cases

- Build a contact sheet / mood board from a batch of Generate Image results.
- Combine multiple product shots into one shareable social image.
- Assemble a before/after or variation grid to compare generations side by side.
- Create a portrait collage from a set of character renders.
- Lay out a numbered **storyboard** — turn Number images on and give each shot a label (`1 · Wide`, `2 · Close-up`) so the sheet reads shot-by-shot.

## Tips

- Input order is preserved — the first wired image lands top-left and the rest flow in reading order. Change the order without re-wiring by dragging the rows in the config panel's Connected Images list (or in the input handle's connection popover).
- No image is ever cropped or stretched — smart mode sizes each cell to the image's exact aspect ratio; grid mode fits (letterboxes) the image inside a uniform cell. Size hints only regroup the rows; they never crop.
- Setting every image to the same size (all Big, all Small…) is the same as all Auto — the hints are proportions between images, not absolute pixel sizes.
- Numbers follow the **final** reading order, not the wire order — drag rows in the Connected Images list to renumber, and the badges re-count `1, 2, 3…` from the top.
- A **List** source's label repeats on every image it contributes — same as its size hint.
- Badges are drawn over the finished collage — they never change the layout, the output size, or the credit cost. The number and the label are each optional and independent.
- The node reuses the shared media-node result strip, so multiple runs are browsable as versions.
