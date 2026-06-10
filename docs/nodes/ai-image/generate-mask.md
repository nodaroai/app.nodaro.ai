# Generate Mask
> Produce a binary segmentation mask for any subject described in plain text. Powered by Grounded SAM (Grounding DINO + SAM) on Replicate, pinned to a fixed model version for reproducibility.

## Overview

Generate Mask takes an input image plus a short text description and returns a black-and-white PNG mask isolating the described subject. White pixels mark the selected subject -- the region to edit; black pixels mark the background. This **white = edit** polarity matches the [Generate Image](./generate-image.md#inpainting--refine) inpaint convention, so this node's `mask` output can feed a Generate Image mask handle (or seed its Mask Painter) directly. The node also passes the original image through unchanged on a second output handle, so you can wire image + mask into a downstream inpainting node (Generate Image, Edit Image, Image to Image) without re-routing the source image.

There is no provider selection -- the node uses Grounded SAM (`schananas/grounded_sam`) on Replicate, pinned to a specific model version so results are reproducible. The mask returned by this node can also be refined by hand in any consumer that accepts a `mask` input: click "Edit Mask" in the downstream config panel to open the Mask Painter pre-seeded with this output.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | text | `""` | Text description of the subject to segment. Examples: `"the left girl's hair"`, `"the red car"`, `"the background"`. Required. Max 500 characters. |
| Threshold | slider | `0.3` | Detection confidence in `0.05`-`0.95` (step 0.05). **Note:** the current pinned model has no box-threshold input -- its only mask lever is erosion/dilation -- so moving this slider may not visibly change the result. |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.). Required.

**Outputs:**
- `image` -- the original input image, unchanged (passthrough). Use this to feed the same image into the downstream inpainting node alongside the mask.
- `mask` -- the generated PNG mask. White areas are the selected subject; black areas are background.

## Credits

**5 credits per generation** (flat, no variable pricing).

## Typical Workflow

The most common use is targeted inpainting -- mask a subject, then re-render only that region:

```
Upload Image ──> Generate Mask ──┬─> Generate Image (any provider)
                                 │     prompt: "wearing a red hat"
                                 │
                                 └─> (mask handle on Generate Image)
                                       └─> mask = white(head) / black(rest)
```

1. **Upload Image** provides the source.
2. **Generate Mask** with `prompt = "the person's head"` produces a head-shaped white region on a black canvas.
3. **Generate Image** (or **Edit Image** / **Image to Image**) consumes both outputs: the `image` passthrough seeds the inpaint base, and the `mask` goes to the mask handle. See [Generate Image → Inpainting & Refine](./generate-image.md#inpainting--refine).
4. The downstream node only re-renders pixels inside the white area; the rest of the image is preserved.

You can also use the mask output as a regular image (preview, save to storage, send to a webhook), since it is just a PNG.

## Notes

- The provider is **Grounded SAM on Replicate** -- `schananas/grounded_sam` (Grounding DINO for text-conditioned detection + Segment Anything for the mask) -- pinned to a fixed model version so the same inputs reproduce the same mask.
- Segmentation quality depends on the prompt naming the subject precisely (e.g. `"the left girl's hair"` rather than just `"hair"`). It works well for distinct, clearly-described subjects, but is not perfect: an over-generic prompt or an absent subject can return an empty (fully black) mask -- in that case, rewrite the prompt to be more specific.
- The mask returned here can be edited by hand. Downstream nodes that accept a `mask` input (Generate Image, Edit Image, Image to Image with mask-supporting providers) expose an **Edit Mask** button that opens the Mask Painter pre-seeded with this output -- useful when the auto-segmentation is *almost* right but needs a touch-up.
- This node does not modify the image. If you want the original image to flow through, wire the `image` output (not just the `mask`) into the downstream node.
