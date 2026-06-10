# Generate Image
> Create AI-generated images from text prompts using 23 provider models with configurable style, aspect ratio, resolution, and quality.

## Overview

Generate Image is the primary text-to-image node. It accepts a text prompt (with optional style presets, negative prompts, and reference images) and produces an image via one of 23 AI providers. The default provider is Nano Banana Pro at 16:9 aspect ratio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | select | `nano-banana-pro` | AI model to use for generation (23 options) |
| Prompt | text | `""` | Text description of the image to generate |
| Style | select | `""` | One of 16 presets (Photorealistic, Cinematic, Anime, Digital Art, Oil Painting, Watercolor, Children's Book, Comic Book, Pixel Art, 3D Render, Pencil Sketch, Pop Art, Minimalist, Retro/Vintage, Fantasy, Noir) or "Custom..." free text. Style text is appended to the prompt at execution time. |
| Negative Prompt | text | `""` | Elements to exclude. Sent natively for imagen4, ideogram, qwen; appended as "Avoid:..." for other providers. |
| Aspect Ratio | select | `"16:9"` | Provider-specific ratio sets (see table below) |
| Resolution | select | varies | Available for nano-banana-pro, nano-banana-2, flux, flux-flex only: 1K, 2K, 4K |
| Quality | select | varies | Available for gpt-image (medium/high) and seedream/seedream-5-lite (basic 2K / high 4K) |
| Rendering Speed | select | -- | Available for ideogram-v3: turbo, balanced, quality |
| Seed | number | -- | Reproducibility seed (supported by select providers) |
| Style Type | select | -- | Ideogram-specific style parameter |
| Expand Prompt | boolean | -- | Ideogram-specific prompt expansion toggle |
| Reference Images | image list | -- | Supported by nano-banana, nano-banana-pro, nano-banana-2 only. Upload or select from library. |
| Character/Asset References | references | -- | Connect Character, Object, or Location nodes for visual consistency |
| Strength | slider | varies | i2i denoising strength. Shown only for providers that support it (`ideogram-remix`, `qwen-i2i`). Lower = stays closer to the base image. |
| Guidance Scale | slider | varies | Prompt-adherence guidance. Shown only for providers that support it (`qwen-i2i`, `qwen-edit`). |
| `baseImageUrl` | image url | -- | Inpaint / refine base image. Set automatically from the node's own current result at run time (or a connected image). See [Inpainting & Refine](#inpainting--refine). |
| `maskUrl` | mask url | -- | Inpaint mask (white = edit, black = keep). Produced by the in-panel Mask Painter or a [Generate Mask](./generate-mask.md) node. |

## Inputs & Outputs

**Inputs (Handles v2.1):**

The Generate Image node has 6 typed input handles on its left edge (color-coded pips), stacked from the bottom up: Prompt (closest to the corner) → Negative → References → Assets → Elements → Look. Click any handle pip to manage connections (jump to, disconnect, add new). Drag from a handle as usual to wire upstream nodes.

| Handle | Color | Accepts | Description |
|--------|-------|---------|-------------|
| `prompt` | pink | Text producers (Text Prompt, AI Writer, Generate Script, Combine Text, Image-to-Text, Generate Text) + all parameter pickers (as `{Label}` variable sources) | Main prompt text. Picker values are also available as `{Picker Label}` in the prompt regardless of wiring — variable substitution is workflow-wide. |
| `negative` | red | Text producers | "Avoid" string — what the model should not generate. Useful for sharing one negative across many Generate Image nodes. |
| `references` | cyan | Image producers (Upload Image, Generate Image, Edit Image, Image-to-Image, Modify Image, Upscale, Remove Background) | Reference images for the provider. **Order matters** — provider semantics depend on the order of refs. |
| `assets` | rose | Identity nodes (Character, Location, Object, Face) | Identity-locked refs with `@mention` expansion and canonical descriptions. (Renamed from `subjects` in v2.1.) |
| `elements` | indigo | "Subject / Object" family pickers (Person, Pose, Animal, Vehicle, Weapon, Furniture, Material, Held-Prop, Styling, Instrumentation) | Pickers wired here tail-append their value to the prompt at execution time. |
| `look` | indigo | "Look" + "Camera" family pickers (Style, Lens, Lighting, Color Look, Framing, Camera Format, Photographer, Aesthetic, Era, Photo Genre, Mood, Atmosphere, Backdrop, Exposure Settings, Render Quality, Composition Effects, Post-Process Effects, Tone, Camera Motion, Temporal, Transition, Character FX) | Pickers wired here tail-append their value to the prompt — same runtime path as the legacy `cinematography` handle. |

**Variable defaults:** any `{Label}` reference can carry a fallback with `||` — `{Label || default}`. If nothing provides `Label`, the trimmed default is used; e.g. `generate a {person || man} running` becomes "generate a man running" when no `person` is wired, or uses the wired/picked value when it is. `{person || }` (empty after `||`) resolves to nothing when unset; plain `{person}` (no `||`) stays literal when unset.

**Variable highlighting:** in the prompt editor (config panel and the ⌘E prompt modal), `{Label}` variables are highlighted — cyan when a matching upstream node is wired (or for built-in template variables like `{userPrompt}`), amber when nothing upstream provides that label yet. Amber means "nothing wired", not "will fail": a `{Label || default}` variable still resolves to its default at run time.

**Outputs:**
- `image` (cyan) — generated image URL. Shares the References color since both are "image" type.

**Managing connections:** Click any handle pip to open a popover that lists currently connected nodes. Each row has a "jump to" button (centers the canvas on the upstream node) and a "disconnect" button. The popover also has an "Add new" button that opens a filtered node picker showing only types compatible with that handle.

**Connection validation:** Dropping an incompatible connection (e.g., a Character node onto the Prompt handle) is rejected — the line flashes and the connection is not created. Type-aware drop targets help guide users to the right port.

**Visual states:** Pips have three modes — idle (hollow ring in border color, dim brand-color icon), connecting (drag in progress; this pip is the source OR a valid compatible target → hollow ring in brand color, full-opacity icon), and connected (solid brand-color fill, white icon, count badge revealed on hover/select when ≥2 connections).

**Legacy handles** are migrated automatically when workflows load:
- `in` → classified by upstream type: text → `prompt`, image → `references`, identity → `assets`, picker → `look` or `elements` (by family).
- `cinematography` / `style` → `look` or `elements` based on the source picker's family.
- `subjects` → `assets`.

The migration runs on the frontend (`loadWorkflow`) plus three defensive backend sites (POST/PATCH, MCP import/update, orchestrator pre-execution) so the rewrite reaches the DB even for workflows touched by external clients.
## Supported Providers

| Provider | Label | Description | Aspect Ratios |
|----------|-------|-------------|---------------|
| nano-banana | Nano Banana | Fast drafts, iteration, storyboards | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9 |
| nano-banana-pro | Nano Banana Pro | Higher detail, production-ready images | Same as Nano Banana |
| nano-banana-2 | Nano Banana 2 | Updated Nano Banana with web grounding | Same as Nano Banana |
| grok | Grok | Creative and stylized imagery | 1:1, 16:9, 9:16, 3:2, 2:3 |
| flux | Flux | Photorealistic, highest quality output | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 |
| flux-flex | Flux Flex | Flexible Flux, fast generation | Same as Flux |
| flux-kontext | Flux Kontext | Context-aware generation and editing | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9 |
| flux-kontext-max | Flux Kontext Max | Highest quality Kontext generation | Same as Flux Kontext |
| gpt-image | GPT Image | Text rendering, complex compositions | 1:1, 3:2, 2:3 |
| gpt-image-2 | GPT Image 2 | Higher resolution GPT Image; supports 1K/2K/4K | 1:1, 16:9, 9:16, 4:3, 3:4 |
| imagen4 | Imagen 4 | Google's latest, strong prompt adherence | 1:1, 16:9, 9:16, 4:3, 3:4 |
| imagen4-fast | Imagen 4 Fast | Fast Imagen, lower latency | Same as Imagen 4 |
| imagen4-ultra | Imagen 4 Ultra | Highest quality Google image gen | Same as Imagen 4 |
| ideogram-v3 | Ideogram V3 | Fast text-to-image | 1:1, 16:9, 9:16, 4:3, 3:4 |
| qwen | Qwen | Versatile, good at diverse styles | 1:1, 16:9, 9:16, 4:3, 3:4 |
| seedream | Seedream | Photorealistic, high detail | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 |
| seedream-5-lite | Seedream 5 Lite | Latest Seedream, fast and sharp | Same as Seedream |
| z-image | Z-Image | Fast, lightweight generation | 1:1, 16:9, 9:16, 4:3, 3:4 |
| wan-2.7 | Wan 2.7 | Text-to-image, 1K/2K/4K resolution, up to 9 optional reference images | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 8:1, 1:8 |
| wan-2.7-pro | Wan 2.7 Pro | Higher quality text-to-image, 1K/2K/4K resolution | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 8:1, 1:8 |
| flux-2-klein | Flux 2 Klein (Open) | BFL Flux 2 9B Klein via Replicate — fast, no safety filter. Resolution 0.5 / 1 / 2 / 4 MP (default 1 MP). **1 credit at 1 MP** (`ceil([figures removed])`). | Same as Flux |
| flux-2-pro | Flux 2 Pro (Safety Tolerance) | BFL Flux 2 Pro flagship via Replicate — `safety_tolerance` pinned to 5 (max for Pro). Resolution 0.5 / 1 / 2 / 4 MP (**default 2 MP**). Per-megapixel pricing ($0.015 base + $0.015/output-MP): **3 credits at 2 MP**. | Same as Flux |
| flux-2-max | Flux 2 Max (Safety Tolerance) | BFL Flux 2 Max via Replicate — `safety_tolerance=5`, up to 8 reference images. Resolution 0.5 / 1 / 2 / 4 MP (**default 2 MP**). **Per-megapixel pricing** ($0.07/output-MP + $0.03/ref-MP): **7 credits at 2 MP** (0 refs), **14 credits at 4 MP** (0 refs), scaling with resolution and refs. | Same as Flux |

## Inpainting & Refine

Once a Generate Image node has a result, you can edit it **in place** — re-render a painted region (inpaint) or refine the whole image (image-to-image) — without adding a separate Edit Image / Modify Image node.

### Inpaint (masked edit)

When the node has a current result, open its config panel and scroll to the **Inpainting Mask** painter. Paint over the area you want to change:

- **White = edit, black = keep.** Only the masked area is regenerated; everything outside the mask stays **pixel-identical** to the original.
- Run the node again with a new prompt describing the change. The provider re-renders, and the masked region of the new image is composited back over the original.

This works on **every image provider**, not just one model. A server-side **composite floor** restricts the change to the masked region (`out = base·(1−mask) + result·mask`), so even providers that have no native mask parameter produce a clean, localized edit.

**Strong instruction-following editors** (`gpt-image`, `gpt-image-2`, `nano-banana`, `nano-banana-pro`, `nano-banana-2`, `seedream`, `seedream-5-lite`, `qwen`, `flux-kontext`, `flux-kontext-max`) additionally get a natural-language **region hint** injected into the prompt (e.g. "Apply the following change only to the upper-left region…") for better in-region results. This is automatic — no user action required. Other providers rely on the composite floor alone, which still keeps the edit localized.

The mask comes from either:

- The in-panel **Mask Painter** (click **Edit Mask** to paint or touch up), or
- A wired [Generate Mask](./generate-mask.md) node, which auto-segments a subject from a text description (white = subject) and can seed the painter.

### Refine from this result

The node also exposes a **↻ Refine from this result** affordance. It takes the current result as the base for a **full-image image-to-image refine** (no mask) and re-runs the provider over the entire frame. Use it for whole-image iteration — "make the whole thing more cinematic", "warmer grade", "more detail" — where you want to evolve the image rather than surgically patch one spot.

For providers that expose them, the **Strength** (i2i denoising) and **Guidance Scale** sliders appear in the panel and let you control how far the refine moves from the base image.

### Credits

An inpaint or refine edit is **one generation at the provider's normal cost** — there is **no extra surcharge** for the mask or the composite step. The price is exactly the per-provider Generate Image cost listed in [Supported Providers](#supported-providers) above (e.g. nano-banana-pro inpaint costs the same as a fresh nano-banana-pro generation).

## Best Practices

- Use Nano Banana or Z-Image for rapid iteration and storyboarding due to fast generation speed.
- Use GPT Image for scenes requiring accurate text rendering (signs, labels, UI mockups).
- Append style presets rather than writing style instructions in the prompt -- the system handles appending automatically.
- For models that support reference images (nano-banana, nano-banana-pro, nano-banana-2), connect Character nodes upstream for consistent character appearance across shots.
- Set negative prompts for all providers to reduce unwanted artifacts. For imagen4/ideogram/qwen, the negative prompt is sent natively; for others it is appended as "Avoid:...".

## Common Use Cases

- Generating hero images for social media posts or ads.
- Creating storyboard frames from script scene descriptions.
- Producing product visualization shots with style consistency.
- Building character sheets by generating multiple angles with reference images.
- Creating background art or environment concepts for video compositions.

## Tips

- Use 1K resolution and medium quality during iteration, then switch to higher settings for final output.
- The style dropdown supports a "Custom..." option for free-text style descriptions when presets are insufficient.
- When connecting a Provider parameter node upstream, it overrides the provider selection on this node, which is useful for batch-switching models across multiple Generate Image nodes.

## Trained character routing (Cloud edition)

When you `@mention` a [trained character](../../features/character-training.md) — a character with a successful LoRA — in the prompt, this node automatically routes through the trained Flux LoRA on Replicate instead of the selected provider. The dropdown provider's price is **replaced** by 2 credits/image.

Two or more trained `@-mentions` in one prompt fall back to the selected provider + reference-image injection (multi-character LoRA composition is Phase 2).
