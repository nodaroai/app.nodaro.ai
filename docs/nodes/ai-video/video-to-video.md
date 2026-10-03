# Video to Video

> Transform existing video using AI with a text prompt.

## Overview

The Video to Video node applies AI-powered transformations to an existing video based on a text prompt. Use it for style transfer, content modification, or creative re-interpretation of video footage.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | wan | AI model for transformation |
| Prompt | Textarea | — | Description of the desired transformation |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

### Seedance 2.5 Edit — additional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Resolution (`v2vResolution`) | Select | 480p | 480p / 720p / 1080p output |
| Generate Audio (`generateAudio`) | Checkbox | on | Native audio on the generated clip |
| Seed (`seed`) | Number | — | Seed for reproducible results |

Seedance 2.5 deliberately exposes **no** Duration, Aspect Ratio, Audio Setting,
Multi-shot, Expand-prompt or Negative Prompt field on this node — see
*Seedance 2.5 Edit* below for why.

### Wan 2.7 VideoEdit — additional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Duration | Select | Auto | Auto / 5s / 10s — target output length |
| Resolution | Select | 1080p | 720p or 1080p output |
| Audio | Select | Auto | Auto = AI-generated audio; Origin = keep source audio |
| Expand prompt | Checkbox | off | AI enhances the prompt before sending to KIE |
| Negative Prompt | Textarea | — | What to avoid in the output |
| Seed | Number | — | Seed for reproducible results |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video to transform
- Cinematography (optional) — parameter pickers whose hints join the prompt
- Text Prompt (optional) — from upstream node
- Negative (optional) — text-only; ignored on the Seedance 2.5 Edit lane
- Image Refs (optional) — **Seedance 2.5 Edit only**; up to 30 reference images
- Audio Refs (optional) — **Seedance 2.5 Edit only**; up to 10 reference audio clips

The two reference handles are always visible but dimmed on every other model —
those endpoints take at most one reference image and no reference audio, so the
handle reports "not supported by *[Model]*" and wiring one has no effect.

**Outputs:**
- Transformed video URL

## Seedance 2.5 Edit

Seedance has **no video-to-video endpoint**. It edits a video it is given as a
*reference* when the prompt reads as an edit instruction. So this model's lane
on the node is dispatched as a **text-to-video** job in edit shape:

- The source clip is sent as **reference video 1**.
- Your prompt is prefixed with `edit @video_1 as follows:` and a newline, so the
  model reads the whole sentence as an instruction about that clip. If your
  prompt already opens with that instruction, it is not added twice.
- Aspect ratio is `adaptive` and duration is `Auto` — the result **keeps the
  source clip's own length and aspect ratio**. That is why the node offers no
  Duration and no Aspect Ratio field for this model.

**The source clip must be 4–30 seconds.** Shorter or longer clips are rejected
by the provider.

**Reference images and `{image:N}`.** Wire images into **Image Refs** and cite
them positionally in the prompt — `{image:1}`, `{image:2}`, … in the order the
edges were made. The editor resolves them to `@image_1`, `@image_2` on the wire,
the same binding Generate Video uses (see
[Generate Video → Referencing wired assets in the prompt](generate-video.md#referencing-wired-assets-in-the-prompt-imagen--videon--audion-tokens)).
Reference audio works the same way with `{audio:N}`.

```
make it black and white, heavy film grain
the woman wears {image:1} and stands in {image:2}
```

**Negative prompts are not sent on this lane** — the edit dispatch carries no
negative field, and Seedance has no native `negative_prompt`. Put what you want
avoided into the instruction itself.

## Supported Providers

| Provider | Credits | Notes |
|----------|---------|-------|
| **Seedance 2.5 Edit** (`seedance-2-5`) | dynamic — see below | Whole-clip prompt-driven edit; keeps source length + ratio; 30 image / 10 audio references; native audio |
| **Wan 2.6** (`wan`) | 175 cr | General-purpose V2V, reliable results |
| **Wan 2.6 Flash** (`wan-flash`) | 100 cr | Fast V2V with optional audio & multi-shot |
| **Wan 2.7 VideoEdit** (`wan-videoedit`) | 320 cr | Guided editing with reference image, audio control, prompt extend |
| **Luma Modify** (`luma-modify`) | 320 cr | Strong at style transfer and artistic modifications |
| **Runway Aleph** (`runway-aleph`) | 350 cr | High-quality transformations, flexible aspect ratio |
| **HappyHorse Edit** (`happyhorse-edit`) | 350 cr | Up to 60s input, 720p (default) or 1080p output |

### Seedance 2.5 Edit — credits

Because the lane *is* a Seedance reference-video run, it is billed exactly like
one on Generate Video: `ceil(perSec × (clip_seconds + delivered_seconds))` on
the `-ref` ladder for the chosen resolution.

Duration is `Auto`, so the run is **reserved at the model's longest clip (30 s)**
and **refunded down to the length actually delivered** — which, for an edit, is
the source clip's own length. Your balance must cover the reservation for the
run to start.

The formulas, the worked examples and what happens when a clip cannot be
measured are all one place — see Generate Video →
[Auto duration](generate-video.md#credit-pricing) and
[Reference videos bill input + output duration](generate-video.md#credit-pricing).

## Best Practices

- Keep source video short (5-10s) for best results
- Describe the transformation clearly: "change to anime style" rather than describing the entire scene
- For Seedance 2.5 Edit: write the prompt as an instruction about the clip ("make it black and white", "the woman wears {image:1}") — it is read as one. Start at 480p while iterating; the reservation scales with resolution
- For Wan 2.7 VideoEdit: connect a reference image to guide the visual style of the output
- Use **Expand prompt** when your prompt is very brief — the AI fills in cinematic details
- Test with the cheapest provider (Wan Flash) before upgrading to Runway or Luma

## Common Use Cases

- Apply artistic styles to recorded footage (painterly, anime, cinematic)
- Change scene characteristics (day to night, summer to winter)
- Create variations of existing video content
- Transform live-action footage into animated styles

## Tips

- V2V works best when the transformation is stylistic rather than structural — changing colors and textures works better than adding or removing objects
- For structural changes, consider using Image-to-Image on keyframes then Image-to-Video instead
- Use consistent prompts when processing multiple clips for a project
