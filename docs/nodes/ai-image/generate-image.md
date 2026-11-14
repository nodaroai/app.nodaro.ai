# Generate Image
> Create AI-generated images from text prompts using 28 provider models with configurable style, aspect ratio, resolution, and quality.

## Overview

Generate Image is the primary text-to-image node. It accepts a text prompt (with optional style presets, negative prompts, and reference images) and produces an image via one of 23 AI providers. The default provider is Nano Banana Pro at 16:9 aspect ratio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | select | `gpt-image-2` | AI model to use for generation (29 options). With no model set, a ratio GPT Image 2 can't draw (21:9, 3:2, 2:3, 4:5, 5:4, …) uses `gpt-image-2-6-sunburst`, at Medium quality. |
| Prompt | text | `""` | Text description of the image to generate. Each model has its own prompt-length limit -- 20 000 characters on the Nano Banana / GPT Image families, 5 000 by default, and as little as **1 000 on Z-Image and Seedream 5 Lite**. The editor counts down to your model's limit as you type, and a prompt still over it at run time is **shortened to fit** rather than refused. Seedream 5.5 also needs **at least 5 characters**: a shorter prompt is refused before the run starts, and nothing is charged |
| Style | select | `""` | One of 16 presets (Photorealistic, Cinematic, Anime, Digital Art, Oil Painting, Watercolor, Children's Book, Comic Book, Pixel Art, 3D Render, Pencil Sketch, Pop Art, Minimalist, Retro/Vintage, Fantasy, Noir) or "Custom..." free text. Style text is appended to the prompt at execution time. |
| Negative Prompt | text | `""` | Elements to exclude. Sent natively for imagen4, ideogram, qwen; appended as "Avoid:..." for other providers. |
| Aspect Ratio | select | `"16:9"` | Provider-specific ratio sets (see table below), plus **Auto (match the photo)** on every model. With a photo wired in (the inpaint / refine base when set, else the first reference image), Auto keeps that photo's shape — on models without a native auto, and on GPT Image 2.6 (whose own auto renders a portrait square), the supported shape closest to it. With no photo wired, Auto gives the model's default shape: its own auto where it has one, else its first listed ratio. A node with no ratio set (one written by an agent, an import or a template) is Auto, on the panel and in the run. |
| Resolution | select | varies | Available for nano-banana-pro, nano-banana-2, nano-banana-2-1, flux, flux-flex, gpt-image-2 and the GPT Image 2.5 and 2.6 models: 1K, 2K, 4K; minimax-h3-image: 1K, 2K (its default) or 4K, the same price at 1K and 2K; seedream-5-flash: 1K, 2K (same price at either); seedream-5-5: 1K, 1.5K, 2K (2K by default; 1K and 1.5K cost the same); flux-3-klein: 1K, 2K or 4K, 1K by default, priced by size. GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only: at those ratios the panel offers 1K, and a 2K or 4K request runs, and is charged, at 1K and says so. GPT Image 2 renders every ratio it offers, `auto` and 1:1 included, at 1K, 2K and 4K, and is charged at the size asked. |
| Quality | select | varies | Available for gpt-image (medium/high), GPT Image 2.6 Flare and Sunburst (auto, low, medium, high, extra high, max; medium by default; at auto the model picks the level and the run costs what it really used, at most the max price), seedream/seedream-5-lite (basic 2K / high 4K), and seedream-5-pro (basic 1K / high 2K) |
| Background | select | Auto | Available for GPT Image 2.5 and 2.6 and Seedream 5.5: auto, opaque or transparent. On GPT Image a transparent background renders at 1K: at a larger size the node moves to 1K and says so. Seedream 5.5 renders one at every size, in PNG. On GPT Image 2.5 the setting only applies at 1K; at a larger size the image uses the model's own background. A transparent background is kept only in PNG and WebP: with GIF or JPEG it becomes auto, and an SVG takes no background setting (see [Formats](#formats-png-jpeg-webp-gif-and-svg)). |
| Format | select | PNG | GPT Image 2.6 Flare and Sunburst: PNG, JPEG, WebP, GIF (animated) or SVG (vector). See [Formats](#formats-png-jpeg-webp-gif-and-svg). MiniMax H3 Image: PNG or JPEG, the same price. Seedream 5.5: PNG or JPEG, the same price; a transparent background is kept in PNG and becomes auto in JPEG. FLUX 3 Klein: PNG or JPEG, the same price. |
| GIF frames | number | 9 | With Format GIF: 2 to 16 frames. The price is set by the band the count falls in (2–8, 9–12, 13–16). |
| GIF speed | number | 200 | With Format GIF: how long each frame shows, 20 to 2000 ms in steps of 10. Does not change the price. |
| SVG detail | select | SVG Standard | With Format SVG: SVG Standard, SVG Detailed or SVG Max, how much detail the drawing is written with. |
| Rendering Speed | select | -- | Available for ideogram-v3: turbo, balanced, quality |
| Seed | number | -- | Reproducibility seed (supported by select providers) |
| Style Type | select | -- | Ideogram-specific style parameter |
| Expand Prompt | boolean | -- | Ideogram-specific prompt expansion toggle |
| Reference Images | image list | -- | Supported by nano-banana, nano-banana-pro, nano-banana-2, nano-banana-2-1, nano-banana-2-lite only. Upload or select from library. |
| Character/Asset References | references | -- | Connect Character, Object, or Location nodes for visual consistency |
| Strength | slider | varies | i2i denoising strength. Shown only for providers that support it (`ideogram-remix`, `qwen-i2i`). Lower = stays closer to the base image. |
| Guidance Scale | slider | varies | Prompt-adherence guidance. Shown only for providers that support it (`qwen-i2i`, `qwen-edit`). |
| `baseImageUrl` | image url | -- | Inpaint / refine base image. Set automatically from the node's own current result at run time (or a connected image). See [Inpainting & Refine](#inpainting--refine). |
| `maskUrl` | mask url | -- | Inpaint mask (white = edit, black = keep). Produced by the in-panel Mask Painter or a [Generate Mask](./generate-mask.md) node. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

**Inputs (Handles v2.1):**

The Generate Image node has 7 typed input handles on its left edge (color-coded pips), stacked from the bottom up: Prompt (closest to the corner) → Negative → References → Assets → Elements → Look → Settings. Click any handle pip to manage connections (jump to, disconnect, add new). Drag from a handle as usual to wire upstream nodes.

| Handle | Color | Accepts | Description |
|--------|-------|---------|-------------|
| `prompt` | blue | Text producers (Text Prompt, AI Writer, Generate Script, Combine Text, Image-to-Text, Generate Text) + all parameter pickers (as `{Label}` variable sources) | Main prompt text. Picker values are also available as `{Picker Label}` in the prompt regardless of wiring — variable substitution is workflow-wide. |
| `negative` | red | Text producers | "Avoid" string — what the model should not generate. Useful for sharing one negative across many Generate Image nodes. |
| `references` | pink | Image producers (Upload Image, Generate Image, Edit Image, Image-to-Image, Modify Image, Upscale, Remove Background) | Reference images for the provider. **Order matters** — provider semantics depend on the order of refs. |
| `assets` | light pink | Identity nodes (Character, Location, Object, Face) | Identity-locked refs with `@mention` expansion and canonical descriptions. (Renamed from `subjects` in v2.1.) |
| `elements` | indigo | "Subject / Object" family pickers (Person, Pose, Animal, Vehicle, Weapon, Furniture, Material, Held-Prop, Styling, Instrumentation) | Pickers wired here tail-append their value to the prompt at execution time. |
| `look` | indigo | "Look" + "Camera" family pickers (Style, Lens, Lighting, Color Look, Framing, Camera Format, Photographer, Aesthetic, Era, Photo Genre, Mood, Atmosphere, Backdrop, Exposure Settings, Render Quality, Composition Effects, Post-Process Effects, Tone, Camera Motion, Temporal, Transition, Character FX) | Pickers wired here tail-append their value to the prompt — same runtime path as the legacy `cinematography` handle. |
| `settings` | indigo | Aspect Ratio / Provider | Sets the node's aspect ratio and model from a wired node (see below). |

**Settings input:** one `settings` input takes the Generation Settings nodes a still image uses — [Aspect Ratio](../parameters/aspect-ratio.md) and [Provider](../parameters/provider.md) — and each wired value replaces the node's own field at run time. The node lists what is wired as chips (e.g. `9:16 · Nano Banana`), and the settings panel shows those fields as connected.

- **Aspect Ratio** replaces `aspectRatio`. A ratio the model doesn't render runs as the nearest one it does.
- **Provider** replaces the model. It must name an image model; a Provider set to a video model stops the run before anything is charged, and the error names the Provider node. A node set to several models (one image each) runs only the wired model, once.
- When two nodes of one kind are wired, the last connection wins. The Run price is the price of the wired model, and a note under the Run button says so while a setting is wired.

**Variable defaults:** any `{Label}` reference can carry a fallback with `||` — `{Label || default}`. If nothing provides `Label`, the trimmed default is used; e.g. `generate a {person || man} running` becomes "generate a man running" when no `person` is wired, or uses the wired/picked value when it is. `{person || }` (empty after `||`) resolves to nothing when unset.

**Unresolved variables:** Generate Image composes its prompt through the shared prompt composer, so a plain `{person}` (no `||`) naming a node that exists but produced nothing also resolves to empty text; a `{person}` naming no node anywhere in the workflow refuses the run with an `unresolved_reference` error before anything is dispatched or credited. Text that arrives through a wired input (rather than a `{Label}` reference) is never rewritten.

**Variable highlighting:** in the prompt editor (config panel and the ⌘E prompt modal), `{Label}` variables are highlighted — cyan when a matching upstream node is wired (or for built-in template variables like `{userPrompt}`), amber when nothing upstream provides that label yet. Amber means "nothing wired", not "will fail": a `{Label || default}` variable still resolves to its default at run time. Inside `{Label || default}`, the default text renders bright when it will actually be injected (nothing wired, or the wired node's text is empty) and greyed-out with a strikethrough when a wired node's value overrides it.

**Outputs:**
- `image` (pink) — generated image URL. Shares the References color since both are "image" type.

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
| nano-banana-2 | Nano Banana 2 | Updated Nano Banana with web grounding. Superseded by Nano Banana 2.1 (`nano-banana-2-1`); still available. | Same as Nano Banana |
| nano-banana-2-1 | Nano Banana 2.1 | Google's high-efficiency image model — improved visual quality, prompt adherence, character consistency and text rendering; up to 10 reference images. 1K / 2K / 4K at **11<!-- credits: nano-banana-2-1 --> / 22<!-- credits: nano-banana-2-1:2K --> / 33 credits**<!-- credits: nano-banana-2-1:4K -->. | auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 21:9, 4:1, 1:4, 8:1, 1:8 |
| nano-banana-2-lite | Nano Banana 2 Lite | Fast, low-cost 1K drafts and iteration (Gemini 3.1 Flash-Lite). Flat **11 credits**<!-- credits: nano-banana-2-lite --> per image — no resolution tiers. | auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 21:9, 4:1, 1:4, 8:1, 1:8 |
| grok | Grok | Creative and stylized imagery | 1:1, 16:9, 9:16, 3:2, 2:3 |
| grok-2 | Grok Imagine 2 | Latest Grok (Imagine Image 2.0) — expressive, high-contrast imagery, priced the same as Grok v1. Generations can chain into the **free** Grok segment map and region-targeted edits (see [Edit Image](./edit-image.md#grok-imagine-2-task-chained-editing)). Attach ONE reference image and it auto-routes through Grok's segment-map → image-edit chain (`grok-2-i2i`, same 11-credit<!-- credits: grok-2-i2i --> price) — the result preserves the reference's composition while applying your prompt. Extra references beyond the first are ignored. | 1:1, 16:9, 9:16, 3:2, 2:3 |
| flux | Flux | Photorealistic, highest quality output | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 |
| flux-flex | Flux Flex | Flexible Flux, fast generation | Same as Flux |
| flux-kontext | Flux Kontext | Context-aware generation and editing | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9 |
| flux-kontext-max | Flux Kontext Max | Highest quality Kontext generation | Same as Flux Kontext |
| gpt-image | GPT Image | Text rendering, complex compositions | 1:1, 3:2, 2:3 |
| gpt-image-2 | GPT Image 2 | Higher resolution GPT Image; supports 1K/2K/4K | 1:1, 16:9, 9:16, 4:3, 3:4 |
| gpt-image-2-5-flare | GPT Image 2.5 Flare | **The fast one — start here.** Higher quality than GPT Image 2 at roughly half the latency. Best for iteration, social/creator content, campaign variants, thumbnails and high-volume work. Resolution-tiered pricing: **17 credits**<!-- credits: gpt-image-2-5-flare --> at 1K / **28 credits**<!-- credits: gpt-image-2-5-flare:2K --> at 2K / **44 credits**<!-- credits: gpt-image-2-5-flare:4K --> at 4K. | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9, 27:16, 16:27, 9:8, 8:9 |
| gpt-image-2-5-sunburst | GPT Image 2.5 Sunburst | **The precise one.** Trades generation time for tighter control and detail fidelity — brand-sensitive and production work: packaging, diagrams, ecommerce retouching, polished campaign creative. Same price as Flare; expect a longer run. | Same as GPT Image 2.5 Flare |
| gpt-image-2-6-flare | GPT Image 2.6 Flare | **Pick it for speed.** Posters, product shots and quick iteration, with strong layouts. At medium quality: **22 credits**<!-- credits: gpt-image-2-6-flare:medium:1K --> at 1K / **44 credits**<!-- credits: gpt-image-2-6-flare:medium:2K --> at 2K / **74 credits**<!-- credits: gpt-image-2-6-flare:medium:4K --> at 4K. Low from **14 credits**<!-- credits: gpt-image-2-6-flare:low:1K -->, high up to **90 credits**<!-- credits: gpt-image-2-6-flare:high:4K -->. With reference images, each one adds to the price. | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 21:9, 9:21, 3:1, 1:3 |
| gpt-image-2-6-sunburst | GPT Image 2.6 Sunburst | **Pick it when every detail counts.** The finest detail and the strongest consistency across edits. Same price as Flare. | Same as GPT Image 2.6 Flare |
| imagen4 | Imagen 4 | Google's latest, strong prompt adherence | 1:1, 16:9, 9:16, 4:3, 3:4 |
| imagen4-fast | Imagen 4 Fast | Fast Imagen, lower latency | Same as Imagen 4 |
| imagen4-ultra | Imagen 4 Ultra | Highest quality Google image gen | Same as Imagen 4 |
| ideogram-v3 | Ideogram V3 | Fast text-to-image | 1:1, 16:9, 9:16, 4:3, 3:4 |
| qwen | Qwen | Versatile, good at diverse styles | 1:1, 16:9, 9:16, 4:3, 3:4 |
| seedream | Seedream | Photorealistic, high detail | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 |
| seedream-5-lite | Seedream 5 Lite | Latest Seedream, fast and sharp | Same as Seedream |
| seedream-5-pro | Seedream 5 Pro | Flagship Seedream, best instruction following. Quality-tiered pricing: **20 credits**<!-- credits: seedream-5-pro --> at basic (1K output) / **66 credits**<!-- credits: seedream-5-pro:high --> at high (2K output). | Same as Seedream |
| seedream-5-flash | Seedream 5 Flash | Fast, low-cost Seedream 5 for quick drafts and iteration. Resolution 1K or 2K at a flat **11 credits**<!-- credits: seedream-5-flash --> per image (no quality setting). Attach reference images and it routes to `seedream-5-flash-i2i` (up to 10 input images, same price). Prompts up to 5,000 characters. | Same as Seedream |
| minimax-h3-image | MiniMax H3 Image | **Readable text inside the picture, up to about 16 MP at 4K.** The same price at 1K and 2K (2K by default): **6 credits**<!-- credits: minimax-h3-image:2K --> at 1K or 2K / **16 credits**<!-- credits: minimax-h3-image:4K --> at 4K. Attach reference images, up to 16 in one edit, and it routes to `minimax-h3-image-i2i`, priced by size and by each image: at 2K, **7 credits**<!-- credits: minimax-h3-image-i2i:2K:1ref --> with one image, **11 credits**<!-- credits: minimax-h3-image-i2i:2K:4ref --> with four, **28 credits**<!-- credits: minimax-h3-image-i2i:2K:16ref --> with sixteen; at 4K, **17 credits**<!-- credits: minimax-h3-image-i2i:4K:1ref --> with one. With no photo, Auto lets the model pick the shape from the prompt; with reference images it follows the first one. Takes a seed, writes PNG or JPEG, prompts up to 5,000 characters. | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9, auto |
| seedream-5-5 | Seedream 5.5 | More natural light, materials and skin, and dense small text that stays readable; a transparent background in one step. Priced by size: **10 credits**<!-- credits: seedream-5-5:1K --> at 1K or 1.5K, **18 credits**<!-- credits: seedream-5-5:2K --> at 2K (the default). PNG or JPEG. Attach reference images (or edit a base image) and it runs as `seedream-5-5-i2i`: up to 10 input images, each adding to the price (for example **22 credits**<!-- credits: seedream-5-5-i2i:2K:1ref --> at 2K with one image). Prompts 5 to 5,000 characters. | Same as Seedream |
| z-image | Z-Image | Fast, lightweight generation. **Shortest prompt limit in the catalog: 1 000 characters** | 1:1, 16:9, 9:16, 4:3, 3:4 |
| wan-2.7 | Wan 2.7 | Text-to-image, 1K/2K/4K resolution, up to 9 optional reference images | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 8:1, 1:8 |
| wan-2.7-pro | Wan 2.7 Pro | Higher quality text-to-image, 1K/2K/4K resolution | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 8:1, 1:8 |
| flux-2-klein | Flux 2 Klein (Open) | BFL Flux 2 9B Klein via Replicate — fast. Resolution 0.5 / 1 / 2 / 4 MP (default 1 MP). **4 credits**<!-- credits: flux-2-klein:1MP:0ref --> **at 1 MP** (0 refs), scaling with resolution and reference count. | Same as Flux |
| flux-3-klein | FLUX 3 Klein | **The light model of FLUX 3: fast and low cost.** A different model from Flux 2 Klein. Priced by size alone: **5 credits**<!-- credits: flux-3-klein:1K --> at 1K, the default, **8 credits**<!-- credits: flux-3-klein:2K --> at 2K, **19 credits**<!-- credits: flux-3-klein:4K --> at 4K. Attach reference images (or edit a base image), up to 10 with the base counted, and it runs as `flux-3-klein-i2i` at the same price: the images cost nothing extra. PNG or JPEG. Takes a seed, prompts up to 5,000 characters. See [FLUX 3 Klein](#flux-3-klein). | 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9, 9:21 |
| flux-2-pro | Flux 2 Pro (Safety Tolerance) | BFL Flux 2 Pro flagship via Replicate. Resolution 0.5 / 1 / 2 / 4 MP (**default 2 MP**). Per-megapixel pricing: **26 credits**<!-- credits: flux-2-pro:2MP:0ref --> **at 2 MP** (0 refs). | Same as Flux |
| flux-2-max | Flux 2 Max (Safety Tolerance) | BFL Flux 2 Max via Replicate, up to 8 reference images. Resolution 0.5 / 1 / 2 / 4 MP (**default 2 MP**). **Per-megapixel pricing**: **77 credits**<!-- credits: flux-2-max:2MP:0ref --> **at 2 MP** (0 refs), **154 credits**<!-- credits: flux-2-max:4MP:0ref --> **at 4 MP** (0 refs), scaling with resolution and refs. | Same as Flux |

### Choosing between GPT Image 2.5 Flare and Sunburst

They are siblings split by workload, not by generation — same price, same
thirteen aspect ratios, same 1K/2K/4K tiers, same 16-image edit cap.

- **Flare** is the default. Higher quality than GPT Image 2 at about half the
  latency. Reach for it when you are iterating or generating at volume.
- **Sunburst** spends longer per image to buy extra precision and detail
  fidelity on edits. Reach for it for the final, brand-sensitive render.

If you are unsure, draft on Flare and finish on Sunburst.

### Choosing between GPT Image 2.6 Flare and Sunburst

- **Flare** is for speed: iteration, posters and product shots.
- **Sunburst** is for when every detail counts: finished work and edits that
  must stay consistent. It costs the same as Flare.

Both offer six qualities at each of 1K, 2K and 4K: auto, low, medium (the
default), high, extra high and max. Draft at low and finish at medium or above.
At auto the model picks the level, so the price it quotes is the most the run can
cost (the max price), and you are charged what it really used. Up to 16 input
images; each one adds to the price, so an edit with fewer images costs less.

### Seedream 5.5

A model of its own, not a newer Seedream 5 Lite, Pro or Flash: pick it for
pictures that should look photographed, with natural light, materials and skin,
and for posters and packaging with dense small text. It draws a transparent
background in one step, at any size, as a PNG (with JPEG the background becomes
auto, and the node says so).

- Sizes **1K**, **1.5K** and **2K**. 2K is the default; 1K and 1.5K cost the
  same, so 1.5K is the sharper choice at that price.
- With reference images or a base image it edits instead, round after round,
  changing what you ask and leaving the rest of the picture as it was. It takes
  up to 10 input images, and each one adds to the price: a 2K edit costs
  **22 credits**<!-- credits: seedream-5-5-i2i:2K:1ref --> with one image and
  **58 credits**<!-- credits: seedream-5-5-i2i:2K:10ref --> with ten.
- With no photo wired in, Auto is sent as 1:1 (the text-to-image model takes no
  auto). With a photo, the run moves to the edit model, which is sent its own
  auto; whether that keeps the photo's shape has not been measured yet, so pick
  a ratio when the shape matters.

### FLUX 3 Klein

The light model of Black Forest Labs' FLUX 3, and a model of its own, not a
newer Flux 2 Klein (both stay on offer). Pick it for fast, low-cost pictures
and edits, from a first draft up to 4K.

- Sizes **1K** (the default), **2K** and **4K**, in nine shapes, from 21:9 to
  9:21. The price follows the size alone: **5 credits**<!-- credits: flux-3-klein:1K -->,
  **8 credits**<!-- credits: flux-3-klein:2K --> or **19 credits**<!-- credits: flux-3-klein:4K -->.
- With reference images or a base image it edits instead, from 1 to 10 images,
  at the same price: the images cost nothing extra. A base image counts as one
  of the 10. A run that would send more is refused before anything is charged,
  with a message saying how many to remove ("FLUX 3 Klein takes at most 10
  input images, the source or base image included, and this run would send 11:
  remove 1."), on the API, in the editor and in a workflow run. Every image the
  run would send counts: references, images mentioned in the prompt
  (`connectedReferences`), images attached to the node, a Scene's references
  and the base. None is left out to make the run fit, so a mention never stays
  in the prompt as plain text for an image that was not sent. A wired
  character's looks that the prompt does not mention are not sent, so they do
  not count. On the API, a request past the lists' own limits (14
  `connectedReferences`, 16 `referenceImageUrls`) that would send more than 10
  images gets the same message, rather than a bare limit on the list. A
  moodboard's images fill only the seats left after your references and the
  base, and never make a run refused.
- Other models still leave out wired and mentioned references past their
  reference limit, as before.
- PNG (the default) or JPEG, the same price.
- With no photo wired in, Auto is sent as 1:1 (the text-to-image model takes no
  auto). With a photo, the run moves to the edit model, which is sent its own
  auto, the first image's shape; that has not been measured on a real run yet,
  so pick a ratio when the shape matters.
- The model rewrites the prompt into a fuller description before drawing; that
  is not a setting here yet. Neither is an exact width and height, WebP, nor
  several pictures from one request.

### Formats: PNG, JPEG, WebP, GIF and SVG

GPT Image 2.6 Flare and Sunburst write five kinds of file. Pick one with
**Format** (`outputFormat` on the API and the SDK, `output_format` in MCP):

- **PNG** (the default), **JPEG** and **WebP** cost the same: the prices above.
  A transparent background is kept in PNG and WebP; with JPEG it becomes auto.
- **GIF**: a short animation of 2 to 16 frames, each 512×512, so a GIF is
  always square: the aspect ratio and resolution do not apply, and a request
  that names them says it ignored them. It follows the quality you choose. Its
  price is set by its quality and how many frames it has, not by what is drawn:

  | Quality | 2–8 frames | 9–12 frames | 13–16 frames |
  |---------|-----------|-------------|--------------|
  | Low | **9 credits**<!-- credits: gpt-image-2-6-flare:low:gif-2-8 --> | **19 credits**<!-- credits: gpt-image-2-6-flare:low:gif-9-12 --> | **26 credits**<!-- credits: gpt-image-2-6-flare:low:gif-13-16 --> |
  | Medium | **16 credits**<!-- credits: gpt-image-2-6-flare:medium:gif-2-8 --> | **32 credits**<!-- credits: gpt-image-2-6-flare:medium:gif-9-12 --> | **46 credits**<!-- credits: gpt-image-2-6-flare:medium:gif-13-16 --> |
  | High | **19 credits**<!-- credits: gpt-image-2-6-flare:high:gif-2-8 --> | **39 credits**<!-- credits: gpt-image-2-6-flare:high:gif-9-12 --> | **54 credits**<!-- credits: gpt-image-2-6-flare:high:gif-13-16 --> |
  | Extra High | **32 credits**<!-- credits: gpt-image-2-6-flare:xhigh:gif-2-8 --> | **68 credits**<!-- credits: gpt-image-2-6-flare:xhigh:gif-9-12 --> | **95 credits**<!-- credits: gpt-image-2-6-flare:xhigh:gif-13-16 --> |
  | Max | **72 credits**<!-- credits: gpt-image-2-6-flare:max:gif-2-8 --> | **150 credits**<!-- credits: gpt-image-2-6-flare:max:gif-9-12 --> | **214 credits**<!-- credits: gpt-image-2-6-flare:max:gif-13-16 --> |

  **GIF speed** (20–2000 ms a frame, 200 by default) does not change the price.
  A transparent background becomes auto; opaque is kept.
- **SVG**: a vector drawing, at the aspect ratio, resolution and quality you
  choose, written at one of three levels of detail. It costs the same image in
  PNG plus a fixed amount per level. At medium:

  | Level | 1K | 2K | 4K |
  |-------|----|----|----|
  | SVG Standard | **28 credits**<!-- credits: gpt-image-2-6-flare:medium:1K:svg-standard --> | **50 credits**<!-- credits: gpt-image-2-6-flare:medium:2K:svg-standard --> | **80 credits**<!-- credits: gpt-image-2-6-flare:medium:4K:svg-standard --> |
  | SVG Detailed | **71 credits**<!-- credits: gpt-image-2-6-flare:medium:1K:svg-detailed --> | **93 credits**<!-- credits: gpt-image-2-6-flare:medium:2K:svg-detailed --> | **123 credits**<!-- credits: gpt-image-2-6-flare:medium:4K:svg-detailed --> |
  | SVG Max | **90 credits**<!-- credits: gpt-image-2-6-flare:medium:1K:svg-max --> | **112 credits**<!-- credits: gpt-image-2-6-flare:medium:2K:svg-max --> | **141 credits**<!-- credits: gpt-image-2-6-flare:medium:4K:svg-max --> |

  An SVG takes no background setting. Every SVG is checked and cleaned before
  it is saved: scripts, event handlers, embedded pages and any link to another
  file are removed. A drawing written without its SVG namespace declaration is
  given it first; any other file that cannot be read safely is not saved (the
  run fails and you are not charged). On a free plan the drawing carries a
  small white mark with a dark outline, which reads on light and dark drawings.

With reference images (or a base image), a GIF or an SVG adds the same amount
per image as a PNG does. At quality **auto** the price shown is the most the run
can cost (the max price of that format), and you are charged what it really used.
Sunburst costs the same as Flare in every format.

**Masks.** A GIF or an SVG cannot be inpainted: a request with a mask and either
format is refused before anything is charged. Choose PNG, JPEG or WebP to edit a
masked region.

**The result.** It is saved with its own extension (`.jpg`, `.webp`, `.gif`,
`.svg`), shown animated or drawn on the canvas and in the Library, and its size
is recorded (512×512 for a GIF). A GIF or an SVG also gets a PNG still beside it
(`thumbnailUrl` on the job: a GIF's first frame, an SVG drawn). Wired into
another image node, a GIF reaches that model as its first frame and an SVG as a
drawn PNG, since image models take still pictures.

## Inpainting & Refine

Once a Generate Image node has a result, you can edit it **in place** — re-render a painted region (inpaint) or refine the whole image (image-to-image) — without adding a separate Edit Image / Modify Image node.

### Inpaint (masked edit)

When the node has a current result, open its config panel and scroll to the **Inpainting Mask** painter. Paint over the area you want to change:

- **White = edit, black = keep.** Only the masked area is regenerated; everything outside the mask stays **pixel-identical** to the original.
- Run the node again with a new prompt describing the change. The provider re-renders, and the masked region of the new image is composited back over the original.

This works on **every image provider**, not just one model. A server-side **composite floor** restricts the change to the masked region (`out = base·(1−mask) + result·mask`), so even providers that have no native mask parameter produce a clean, localized edit.

**Strong instruction-following editors** (`gpt-image`, `gpt-image-2`, `gpt-image-2-5-flare`, `gpt-image-2-5-sunburst`, `nano-banana`, `nano-banana-pro`, `nano-banana-2`, `nano-banana-2-1`, `nano-banana-2-lite`, `seedream`, `seedream-5-lite`, `seedream-5-pro`, `seedream-5-flash`, `minimax-h3-image`, `seedream-5-5`, `flux-3-klein`, `qwen`, `flux-kontext`, `flux-kontext-max`) additionally get a natural-language **region hint** injected into the prompt (e.g. "Apply the following change only to the upper-left region…") for better in-region results. This is automatic — no user action required. Other providers rely on the composite floor alone, which still keeps the edit localized.

The mask comes from either:

- The in-panel **Mask Painter** (click **Edit Mask** to paint or touch up), or
- A wired [Generate Mask](./generate-mask.md) node, which auto-segments a subject from a text description (white = subject) and can seed the painter.

### Refine from this result

The node also exposes a **↻ Refine from this result** affordance. It takes the current result as the base for a **full-image image-to-image refine** (no mask) and re-runs the provider over the entire frame. Use it for whole-image iteration — "make the whole thing more cinematic", "warmer grade", "more detail" — where you want to evolve the image rather than surgically patch one spot.

For providers that expose them, the **Strength** (i2i denoising) and **Guidance Scale** sliders appear in the panel and let you control how far the refine moves from the base image.

### Refine regions (Grok Imagine 2)

With the **grok-2** provider, the panel adds a **Refine Regions** section powered by Grok's task-chained editing (see [Edit Image](./edit-image.md#grok-imagine-2-task-chained-editing)):

1. **Detect regions** (free) — runs a segment map over the active result and returns named regions (e.g. *sky*, *person*, *tree*) as chips. Hovering or selecting a chip **outlines that region in place on the result preview** (the region's exact shape, tinted in the chip's color).
2. Tick the regions to change, write an edit prompt, and **Apply**. Leave nothing ticked for a whole-image edit.
3. The edit lands as a **new version** in the node's result strip — and carries its own task reference, so it can be segmented and refined again, iteratively.

Region editing is grok-2-only: the underlying endpoint references the prior grok-2 generation on the provider side rather than accepting an image, so it can't serve other providers or uploaded images (results from before this feature shipped lack the task reference and show a re-run hint). A region edit is priced the same as a grok-2 generation; the segment map costs nothing.

### Credits

An inpaint or refine edit is **one generation at the provider's normal cost** — there is **no extra surcharge** for the mask or the composite step. The price is exactly the per-provider Generate Image cost listed in [Supported Providers](#supported-providers) above (e.g. nano-banana-pro inpaint costs the same as a fresh nano-banana-pro generation). The same holds for a grok-2 region edit, and its region detection is free.

## When the provider's safety filter blocks a request

A provider's safety filter can occasionally block a benign prompt. For models the catalog flags as having a non-deterministic filter (currently **gpt-image-2** and the **GPT Image 2.5** and **2.6** models), Nodaro automatically retries the identical request once, at no extra cost, before giving up. A model without that flag — and every model on a second block — fails after a single attempt.

- **Fallback offer.** When the catalog declares a fallback for the model that failed, the node shows the block in amber with a one-click **"Try on Nano Banana Pro"** button — it switches the node's provider and re-runs the request. Nodaro never switches models on its own; you always click through.
- **Copyright and likeness blocks are never retried.** A match against protected IP or a real person's likeness doesn't change on a second try, so the job fails after one attempt with the provider's own rejection reason.
- **Credits are always refunded** for a blocked generation. The reservation is released and the job's `credit_status` reads `"refunded"` — see [API integration §12](../../api-integration.md#12-credits-cloud-edition).

The failed job carries a structured `error_hint` that an API/SDK/MCP caller can read instead of parsing `error_message`:

```json
{ "kind": "safety-block", "class": "safety", "retried": true, "suggestedProvider": "nano-banana-pro" }
```

`class` is `"copyright"`, `"likeness"`, or `"safety"`; `retried` is `true` only when the automatic retry already ran; `suggestedProvider` is present only when a fallback model is available for the one that failed. Full shape: [API integration §8](../../api-integration.md#8-error-envelope).

## Cinematic direction by id (`direction`, API / SDK)

On the canvas you set a look by **wiring parameter-picker nodes** into the
`look` handle. A direct API / SDK / MCP caller does the same thing with the
optional `direction` object on `POST /v1/generate-image`: a flat map of catalog
ids, one key per dimension, which the platform folds into the prompt as its own
hint clauses. You send ids; the platform owns the wording, so a saved run picks
up improved phrasing instead of freezing the text your client wrote.

```json
"direction": {
  "shotSize": "wide-shot",
  "lens": "wide-24mm",
  "timeOfDay": "golden-hour",
  "style": "anime",
  "mood": ["happy", "joyful"]
}
```

- **Keys are the picker field names** this node's `look` pickers already use —
  framing (`shotSize`, `angle`, `coverage`, `composition`, `vantage`), camera
  (`cameraFormat`, `lens`), exposure (`aperture`, `shutterSpeed`, `isoValue`),
  lighting (`timeOfDay`, `lightingStyle`, `lightingDirection`, `lightingRatio`,
  `colorTemperature`), look (`colorLook`, `atmosphere`, `postProcess`, `style`,
  `mood`, `aesthetic`, `photoGenre`, `photographer`, `renderQuality`), scene
  (`setting`, `era`, `backdrop`), plus `pose` and `compositionEffect`. Valid ids
  come from `GET /v1/picker-catalogs` — the same catalogs the pickers read; on a
  deployment with registered catalog **packs** that endpoint also lists
  pack-added ids, which are accepted but render no clause.
- **A value is one id or an array.** Multi-pick dimensions honor their own cap;
  a single-pick key handed an array takes the first entry. Exceeding a
  dimension's cap truncates rather than 400ing, and unknown keys / unknown ids
  are skipped silently — but the wire bounds (8 entries per key, 100 characters
  per id) do reject.
- **Absent ≠ empty.** A missing key means "no hint", never a default; a
  `direction` that renders nothing leaves your prompt byte-for-byte untouched.
- **Your own palettes and moodboards.** `colorLook: "palette:<id>"` names a
  saved palette's colours in the prompt; `style: "moodboard:<id>"` adds a saved
  moodboard's description and sends its images as style references after your
  own, up to the model's reference limit. Unlike a catalog id, one that is
  malformed answers 400 and one that is not yours 404 — see
  [Palettes and moodboards](../../palettes-and-moodboards.md). A whole-workflow
  run resolves them on a stored node too; the single-node Run does not yet.
- The clauses land in a trailing `[style]:` section — a blank line after your
  prompt, then a film line (`cameraFormat`, `colorLook`, `style`, `era`) and a
  scene line for everything else, each in the platform's canonical order (not
  your object's key order). Nothing selected means no section at all. The
  assembled prompt is still truncated to the provider's verified prompt cap.

Full semantics: [API integration guide](../../api-integration.md#cinematic-direction-direction-on-generate-image).

### The same ids stored on the node

A Generate Image **node** can carry that same `direction` object (and the
structured prompt fields `structured`) in its own data, written by an API / MCP
author or by an app that emits Nodaro graphs. The canvas honors them: a
single-node run, a whole-workflow run and the config panel's final-prompt
preview all fold them the same way, once, at the model call — so the graph
stores ids and the wording is produced fresh each run instead of being frozen
into the prompt text.

Stored ids are **additive** to any wired Framing / Lighting / Style picker node:
the wired hint lands first, the stored ids after, exactly as two wired pickers
of one family behave. A node that carries neither key is untouched — its prompt
reaches the model byte-for-byte as before. Node presets and workflow
export/import capture the ids along with the rest of the node, which is
deliberate: a preset should carry its look.

## Several images in one call (`count`, `models` — API / SDK)

A direct API / SDK / MCP caller can ask `POST /v1/generate-image` for several
images at once: `count` (1–4 images of one model, each its own job) and
`models` (the same request on 2–4 image models, instead of `provider`; with
`count`, per model — at most 8 images). Each model's settings are fitted to it
as on a single call, the batch is charged as a whole or not at all (each image
costs what a single call for it costs), and with a `seed` image *i* gets
`seed + i`. A preset (`presetId`) combines with both — with `models` it is
applied once per model, as the editor would for that model. The answer lists
every job id grouped by model; on the canvas, one node is one image. Full rules, the answer's shape and per-image idempotency:
[API integration § 4g](../../api-integration.md#4g-several-images-in-one-call-count-models).

## Best Practices

- Use Nano Banana 2.1 or Z-Image for rapid, low-cost iteration and storyboarding.
- Use GPT Image for scenes requiring accurate text rendering (signs, labels, UI mockups).
- Append style presets rather than writing style instructions in the prompt -- the system handles appending automatically.
- For models that support reference images (nano-banana, nano-banana-pro, nano-banana-2, nano-banana-2-1, nano-banana-2-lite), connect Character nodes upstream for consistent character appearance across shots.
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
- Reference images in a format the model does not take (HEIC/HEIF and AVIF photos, TIFF, and others) are converted before the run, losslessly wherever the model accepts a lossless format. A reference over 10 MB is compressed under that limit; any other reference is sent as it is.
- **Name your upload nodes to mention them.** Give a wired Upload Image node a Label and you can address it in the prompt by the slug of that label — `@town:1` puts that picture's binding exactly where you typed it, and `@town:1:background` says what to take from it. Roles are the usual media set (`object`, `person`, `face`, `clothes`, `background`, `style`, `pose`, `texture`) or any custom single word, and `~lock` / `~nolock` work as they do on character mentions. Unnamed uploads still attach as before — mentioning is optional, not required (an unlabelled node falls back to its node type, so it is still addressable as `@upload-image:1` if you want it). A label starting with a digit (`3D Render`) can't form a mention; rename it if you want to address it inline. Full grammar: [Reference Roles guide](../../reference-roles-guide.md#naming-a-plain-image-so-you-can-mention-it).
- **An `{image:N}` token with no image wired at its position becomes its label.** `{image:1:person}` reads as `person` and a bare `{image:1}` is left out, so a preset written for a wired photo still runs as plain prose without one — wire the photo into References to bind the token. An image label is any text up to the closing brace, wider than a video token's: `{image:1:man's jacket}` reads as `man's jacket`.

## Trained character routing (Cloud edition)

When you `@mention` a [trained character](../../features/character-training.md) — a character with a successful LoRA — in the prompt, this node automatically routes through the trained Flux LoRA on Replicate instead of the selected provider. The dropdown provider's price is **replaced** by 22 credits<!-- credits: flux-lora-character -->/image.

Two or more trained `@-mentions` in one prompt fall back to the selected provider + reference-image injection (multi-character LoRA composition is Phase 2).
