# Generate Mask
> Produce a binary segmentation mask for any subject described in plain text. Powered by Grounded SAM (Grounding DINO + SAM) on Replicate.

> **Note:** The Grounded SAM integration is currently experimental. The specific Replicate model version used may change without notice as we verify the best available version. If you encounter errors, please check the [status page](https://status.nodaro.ai) or contact support.

## Overview

Generate Mask takes an input image plus a short text description and returns a black-and-white PNG mask isolating the described subject. White pixels mark the selected area; black pixels mark the background. The node also passes the original image through unchanged on a second output handle, so you can wire image + mask into a downstream inpainting node (Edit Image, Image to Image) without re-routing the source image.

There is no provider selection -- the node uses Grounded SAM on Replicate. The mask returned by this node can also be refined by hand in any consumer that accepts a `mask` input: click "Edit Mask" in the downstream config panel to open the Mask Painter pre-seeded with this output.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | text | `""` | Text description of what to mask. Examples: `"the blonde woman"`, `"the red car"`, `"the background"`. Required. Max 500 characters. |
| Threshold | slider | `0.3` | Detection confidence in `0.05`-`0.95` (step 0.05). Lower = more permissive (broader mask, includes uncertain pixels); higher = stricter (tighter mask, only high-confidence pixels). |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, Edit Image, etc.). Required.

**Outputs:**
- `image` -- the original input image, unchanged (passthrough). Use this to feed the same image into the downstream inpainting node alongside the mask.
- `mask` -- the generated PNG mask. White areas are the selected subject; black areas are background.

## Credits

**2 credits per generation** (flat, no variable pricing).

## Typical Workflow

The most common use is targeted inpainting -- mask a subject, then re-render only that region:

```
Upload Image ──> Generate Mask ──┬─> Edit Image (nano-banana-edit)
                                 │     prompt: "wearing a red hat"
                                 │
                                 └─> (mask handle on Edit Image)
                                       └─> mask = white(face) / black(rest)
```

1. **Upload Image** provides the source.
2. **Generate Mask** with `prompt = "the person's head"` produces a head-shaped white region on a black canvas.
3. **Edit Image** (or **Image to Image**) consumes both outputs: the `image` passthrough goes to the image handle, the `mask` goes to the mask handle.
4. The downstream node only re-renders pixels inside the white area; the rest of the image is preserved.

You can also use the mask output as a regular image (preview, save to storage, send to a webhook), since it is just a PNG.

## Notes

- The provider is **Grounded SAM on Replicate** (Grounding DINO for text-conditioned detection + Segment Anything for the mask). The integration is experimental and the specific Replicate model version may be updated during this period; the backend selects the active version and may change it without affecting your workflow inputs.
- If the prompt is too generic or the subject is absent from the image, the model may return an empty (fully black) mask. Lower the threshold or rewrite the prompt to be more specific.
- The mask returned here can be edited by hand. Downstream nodes that accept a `mask` input (Edit Image, Image to Image with mask-supporting providers) expose an **Edit Mask** button that opens the Mask Painter pre-seeded with this output -- useful when the auto-segmentation is *almost* right but needs a touch-up.
- This node does not modify the image. If you want the original image to flow through, wire the `image` output (not just the `mask`) into the downstream node.
