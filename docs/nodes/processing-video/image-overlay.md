# Image Overlay

> Place up to 12 layers — pictures, real text, QR codes and shapes — on a base image, pixel-exactly, with a live preview you can drag.

## Overview

The Image Overlay node takes a **base image** and one to twelve **overlay images** and returns the base with the overlays placed on top of it. It is the opposite of a generative edit: nothing is redrawn. A brand asset comes out as the file you gave it, not as a model's rendition of it — which is what makes it the right tool for logos, watermarks, badges and "before / after" cards. It is also the missing half of **Remove Background**: cut-out → **place on** something.

It is a local, deterministic compositing step (sharp) — no AI model, no provider, and it runs with zero API keys in the community edition.

**Live preview.** As soon as a base image is connected the node shows the composite itself, without running: drag a layer to move it, pull its corner handle to resize, its top handle to rotate, and use the ↑ ↓ buttons to change the stacking order. While you drag, the layer **snaps** to the centre lines, the edges and the safe area (hold Shift to drag freely). Every drag writes the layer's percentages back into the settings, so the preview and the run are the same numbers. Run only when you want the file.

**Platform sizes and safe areas.** Pick a **Platform size** (YouTube thumbnail or channel banner, LinkedIn company / personal cover, X header, Facebook cover, Instagram post / portrait / story, link preview, slide, A4 print) and the output canvas becomes that platform's pixel size, with its **safe area** — the part every device actually shows — drawn as a dashed box in the preview. **Export also for** renders the same composition into several platform canvases in one run; the extra files appear as chips on the result and as `variants[]` in the job's output.

Each layer has:

- an **anchor** — one of nine positions on the base image (`top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`);
- an **offset** (`x`, `y`) from that anchor, in **percent of the base image's width and height**;
- a **width**, in percent of the base width — the height follows the layer's own aspect ratio unless an explicit `height` (percent of base height) is set;
- **opacity**, **rotation** (any angle around the layer's own centre), a **blend mode** (`over`, `multiply`, `screen`), an optional **drop shadow** and **rounded corners**.

Why percentages, not pixels: the base image's size is decided upstream (a 2K render today, a 4K poster tomorrow, an uploaded 1128 × 191 LinkedIn strip). "12% wide, 4% in from the right, 6% up from the bottom" survives every one of those; "x = 1834 px" does not. Once a base image is connected, the config panel shows the pixel equivalent next to each percentage.

On a **right** or **bottom** anchor a **negative** offset moves the layer **inward** — that is the watermark case (see the worked example below).

SVG logos are rasterised at the target pixel size, never at the SVG's intrinsic size, so they come out crisp. A layer that falls partly outside the base is cropped to the base; a layer entirely outside it is skipped, not an error.

## Layer kinds

A layer slot holds one of four things:

| Kind | What it is | How it is sized |
|------|------------|-----------------|
| **Image** | A picture wired into the slot's handle (a logo, a Remove Background cut-out, a sticker). | `width` % of the base width; height follows the picture unless `height` is set. |
| **Text** | Real typography rendered from a bundled font — the same TTF file the preview uses, so what you see is what the file gets. | `fontSize` % of the base **height**; the box fits the text. |
| **QR** | A QR code generated from a URL or any text. | `width` % of the base width (square). |
| **Shape** | A flat shape — rectangle, rounded rectangle, pill, circle, ribbon, triangle, diamond, hexagon, star, starburst badge or arrow — a badge, a price tag, a lower-third bar behind text. | `width` × `height` % of the base. |

Text, QR and shape layers need no wire: add them from the editor's **Text / QR / Shape** buttons (or the config panel), and their settings live in the node. On the API they are `layers[i].kind` with a `text`, `qr` or `shape` object.

**Fonts.** Inter, Montserrat, Space Grotesk, Playfair Display, Oswald, Bebas Neue, Anton, Pacifico, Rubik and Heebo. Rubik and Heebo set Hebrew. Variable faces honour any weight 100–900. A text layer also has align, letter spacing, line height, uppercase, an **outline** (stroke width + colour) and a **background box** (colour, opacity, padding, corner radius — a huge radius makes a pill). Right-to-left text is laid out right-to-left per line.

**Image finishing.** An image layer can be cropped to a **circle**, have its edges **feathered** over N px, carry an **outline** around its silhouette, and a coloured **glow** — on top of the drop shadow and rounded corners every layer has.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Preset | Select | *(none)* | Fills **layer 1** with a starting point: Watermark (bottom-right, 10% wide, 85% opacity), Logo top-left (14% wide), Centered (40% wide), Full bleed (covers the base). A starting point, not a mode — every field stays editable. |
| Layer *n* → Anchor | 3 × 3 picker | center | Where the layer attaches on the base image. On the API this is `layers[i].anchor`. |
| Layer *n* → Width | Slider (1–100) | 25 | Layer width in % of the base width. Height follows the layer's aspect ratio unless Height is set. |
| Layer *n* → Height | Number (1–100), optional | *(auto)* | Explicit height in % of the base height. When set, **Fit** decides how the source fills width × height: `contain`, `cover` or `stretch`. |
| Layer *n* → Offset X / Y | Slider (−100..100) | 0 / 0 | Offset from the anchor in % of the base width / height. Negative on a right / bottom anchor = inward. |
| Layer *n* → Opacity | Slider (0–100%) | 100% | On the API `opacity` is 0..1. |
| Layer *n* → Rotation | Slider (−180..180°) | 0 | Around the layer's own centre; the rotated bounding box is re-centred so the layer does not drift. |
| Layer *n* → Blend | Select | Normal | `over` (normal), `multiply`, `screen`. |
| Layer *n* → Rounded corners | Number (px) | *(none)* | Corner radius applied to the layer before compositing. |
| Layer *n* → Drop shadow | Switch + blur / offset X / offset Y / color / opacity | Off | A blurred, tinted copy of the layer's silhouette placed under it (px on the base image). |
| Layer *n* → Text / QR / Shape settings | per kind | *(kind defaults)* | Text: content, font, weight, size (% of base height), colour, align, letter spacing, line height, uppercase, outline, background box. QR: content, colour, background, quiet zone. Shape: shape, fill, outline. |
| Layer *n* → Crop / Feather / Outline / Glow | image layers | Off | Circle crop; edge fade in px; silhouette outline (width + colour); coloured glow (blur, colour, opacity). |
| Layer *n* → Layer order (z) | Number, optional | *(layer number)* | Higher draws on top. Empty = the handle number (Layer 1 at the bottom). The preview's ↑ ↓ buttons set it. On the API this is `layers[i].zIndex`. |
| Layer handles | + / − buttons | 4 | How many layer handles the node shows (1–12). The count grows by itself when you wire a higher handle. |
| Platform size | Select | *(base size)* | Sets the output canvas to a platform preset and shows its safe area. Also sets Base fit to `cover` so the picture fills the canvas. On the API this is the `canvas` object; `platform` is a canvas-only hint. |
| Export also for | Checkboxes | *(none)* | Any number of extra platform renders per run — all twelve at once if you like. On the API this is `variants: ["youtube-thumbnail", …]`; the result carries `variants: [{ id, label, width, height, url }]`. 2 credits per platform on top of the base (see Credit Cost). **Every ticked platform is also a source handle on the node** (`variant:<platformId>`, e.g. `variant:x-header`), so the X render can feed an X publisher while the YouTube render feeds YouTube in the same run — the main **Image** handle stays the primary composite. |
| Mask output | Select | Ring around the layers | What the **Mask** output carries (see Outputs). Ring width in px for the ring mode. On the API this is `maskMode` (`around` / `layers` / `outside` / `none`) and `maskSpread`; the job's output carries `maskUrl`. |
| Output format | Select | PNG | `png` keeps transparency; `jpg` and `webp` flatten it. |
| Custom output size | Switch + width / height / background / base fit | Off | Off: the output keeps the base image's pixel size. On: the base is placed into a canvas of the given size (`contain` letterboxes on the background color, `cover` fills and crops), then the layers are placed relative to the base as before. |

Layers are index-aligned with the input handles: the **Layer 1** editor controls what is wired into the `overlay` handle, **Layer 2** the `overlay2` handle, and so on. A connected handle with no settings runs with the defaults (centre, 25% wide, fully opaque). Layers are composited in handle order (Layer 1 at the bottom) unless a layer's **Layer order** says otherwise.

## Inputs & Outputs

**Inputs:**
- **Base** (`image`, required) — the image everything is placed on; any image producer or an uploaded image.
- **Layer 1–12** (`overlay`, `overlay2` … `overlay12`) — at least one layer (wired image, or a text / QR / shape layer) required; any image producer (a Remove Background cut-out, an uploaded PNG / SVG logo, another node's result).

**Outputs:**
- **Image** — the composite (PNG by default; the base image's pixel size unless a platform size / custom canvas is set).
- **Mask** — a black-and-white picture the same size, white where the **Mask output** setting says "may change": a **ring around the layers** (default — what an AI finish may repaint), **the layers themselves**, **everything except the layers**, or none. Wire it into Modify Image's Mask handle.

## AI: make it look part of the picture

The compositor never redraws your elements — that is the point. When you *do* want the scene to react to them (a contact shadow under a placed product, matching light on a logo, a reflection on a floor), press **Add AI finish**. It adds a Modify Image node after this one, wired to the composite **and** to the mask ring around the layers, with a prompt that asks for exactly that. Because the mask only covers the ring, the model can paint around the elements while the elements stay pixel-exact — the server keeps every masked-out pixel from the composite. Wire a **Composition Effects** picker (or any text) into that Modify Image node's prompt to steer the look.

**Suggest placement (AI)** in a layer's settings asks a vision model where the layer should go — away from faces, the main subject and busy textures, inside the platform's safe area when one is set — and fills in the anchor and offsets. It is billed as one Describe Image call; you can drag afterwards as usual.

**Platform in the editor.** The full editor's header has the same **Platform** picker as the settings panel; the stage becomes that platform's canvas with its safe area drawn — the YouTube channel banner shows its three device viewports (TV, desktop, all devices) as nested boxes, so you can see at a glance what a phone will crop. A result rendered under other settings shows as "Result (old)" on the node, which flips back to the live preview until you run again.

**Batches.** Wire a **List** of image URLs into **Base** and the node runs once per item with the same layers — a watermark on a hundred photos in one run.

**QR link from the workflow.** A QR layer can take its link from the workflow instead of the typed text: switch **Use workflow output** in the layer's Content, and the node grows a **QR link** text handle. Wire a Text node, a List column (one code per row — fifty product pages, fifty codes, one run) or any text output into it. On the API this is `qr.fromInput: true` on the layer plus a top-level `qrText`; a run with the flag set and nothing wired is refused with a message naming the handle.

## Credit Cost

**10 credits** for the composite (and its mask), whatever the base image's resolution or the number of layers — a banner and a 4K poster cost the same to composite — **plus 2 credits per extra platform render** ticked under *Export also for* (or wired through a `variant:<platformId>` handle):

```
credits = 10 + 2 × (number of distinct platforms exported)
```

| Export also for | Credits |
|---|---|
| nothing | 10 |
| 2 platforms (e.g. Instagram post + YouTube thumbnail) | 14 |
| all 12 platforms | 34 |

The node's Run button, the workflow estimate and the API all quote the same formula (`imageOverlayCredits` in `@nodaro/shared`).

## Worked example — a watermark

Connect the photo to **Base** and the logo to **Layer 1**, then set Layer 1 to:

| Field | Value |
|-------|-------|
| Anchor | bottom-right |
| Width | 12 |
| Offset X | −4 |
| Offset Y | −6 |
| Opacity | 95% |

On a 2000 × 1000 base the logo renders 240 px wide, its right edge 80 px in from the right and its bottom edge 60 px up from the bottom. On a 4000 × 2000 base every one of those numbers doubles — the node needs no change.

The same call through the API (`POST /v1/image-overlay`):

```json
{
  "imageUrl": "https://…/photo.png",
  "layers": [
    { "imageUrl": "https://…/logo.svg", "anchor": "bottom-right", "width": 12, "x": -4, "y": -6, "opacity": 0.95 }
  ]
}
```

## Best Practices

- Feed a **transparent PNG or an SVG** as the layer. An opaque JPG logo places as a rectangle — run it through Remove Background first.
- Keep brand assets as **files**: draw the picture with Modify Image, place the real logo with this node. A model will always redraw a wordmark slightly wrong.
- Use **Multiply** for dark marks on light photos and **Screen** for light marks on dark ones when you want the logo to sit *in* the image rather than on it.
- A soft **drop shadow** (blur 24, offset 0 / 12, 50%) lifts a cut-out person or product off a busy background.
- Turn on **Custom output size** with **Cover** to make a platform-sized banner (e.g. 1500 × 500) from a wider render and place the logo relative to the *base*, not the canvas.

## Common Use Cases

- Watermark or brand-stamp every generated image before publishing.
- Build YouTube / LinkedIn / X banners and video covers with the real logo file on an AI-generated background.
- Place a Remove Background cut-out (a person, a product) onto a new backdrop with a shadow.
- Add a badge or sticker ("NEW", a price tag, a rating) to product shots.
- Compose "before / after" or comparison cards from two results.

## Tips

- The pixel readout next to each percentage appears once a base image with known dimensions is connected — generate the base first, then tune the layer.
- Rotation is around the layer's own centre; combine it with an offset if you want the rotated mark to hug a corner.
- A brand wordmark should still arrive as an SVG or PNG file (the exact logo); the text layer is for headlines, captions, prices and lower thirds.
