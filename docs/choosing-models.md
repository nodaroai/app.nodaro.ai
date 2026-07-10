# Choosing Models

> Which model should you use? Nodaro exposes 100+ generation models across image, video, audio, and text. This guide groups them by **what you're making** and **how much you want to spend**, so you don't have to read every node page to pick.

Every table on this page is **generated from Nodaro's model catalog** — it never drifts from what the editor actually offers. The same data drives the MCP `list_models` tool, so an AI assistant connected to Nodaro picks from this exact set.

## How credits and tiers work

- **1 credit = $0.02.** Per-generation cost depends on the model, resolution, duration, and quality. The number in each table is the **default variant** (the bare model with no resolution/quality upgrade); higher settings cost more.
- The **Tier** column is a quick budget signal, **relative within each modality**:
  - **Everyday** — cheap and fast; the right default for drafts, iteration, and most work.
  - **Standard** — a step up in quality for a moderate cost.
  - **Premium** — top quality, highest cost; reach for these on hero shots and final renders.
- A **Premium image still costs far less than a Premium video** — don't compare tiers across modalities. Use the credit number for that.
- **⭐ marks the best-in-tier pick** for that family — a safe default when you're unsure.

**Mode codes** in the tables: `t2i` text→image · `i2i` image→image · `edit` targeted edit · `upscale` / `remove-bg` · `t2v` text→video · `i2v` image→video · `v2v` video→video · `extend` · `motion-transfer` · `lip-sync` · `video-upscale` · `tts` text→speech · `music` · `sfx` · `stt` speech→text · `voice-clone` / `voice-design` / `voice-changer` · `isolation` · `dubbing` · `forced-alignment`.

## Quick picks by task

Don't know where to start? Find your goal here, then jump to the model in the tables below.

<!-- AUTO-GEN:START model-recommendations -->
| I want… | Models | Notes |
| --- | --- | --- |
| best for typography / logos / text-heavy | Nano Banana Pro, GPT Image 2 | Nano Banana Pro for diagrams / complex text; GPT Image 2 for logos and short copy. |
| cheapest realistic image | Z-Image, Qwen, Imagen 4 Fast | Z-Image is the cheapest at 1 credit. Qwen / Imagen4 Fast for slightly higher quality. |
| highest fidelity image | Nano Banana Pro, Imagen 4 Ultra, Flux 2 Flex | Pick by family preference; all three are premium tiers. |
| image edit / restyle | Flux Kontext Pro, Ideogram Remix, Seedream 5 Lite (I2I) | Flux Kontext preserves identity; Ideogram Remix is character-aware; Seedream 5 Lite for instruction-based edits. |
| highest-resolution image (4K / 8K) | Topaz Image Upscale, Nano Banana Pro, GPT Image 2 | Generate at native then Topaz upscale for 8K. |
| background removal / cutout | Recraft Remove BG | 1 credit, no prompt needed. |
| best cinematic video | VEO 3.1 Quality, Kling 3.0, Seedance 2 | VEO 3.1 Quality for premium narrative; Kling 3.0 for music-synced motion; Seedance 2 for reference-driven consistency. |
| cheap batch video clips | VEO 3.1 Fast, Wan 2.2 Turbo, Bytedance Lite I2V | VEO 3.1 Fast is the best price/quality balance with native audio. |
| video with start + end frame | VEO 3.1 Quality, VEO 3.1 Fast, Kling 2.5 Turbo Pro, Hailuo 02 I2V Pro, Hailuo 02 Standard, Seedance 2 | All listed support an end frame; VEO uses imageUrls[start, end]. |
| music / song generation | Suno v5, Suno v4 | Suno v5 has better vocal quality at the same price. |
| voice over / narration | ElevenLabs v3, ElevenLabs Turbo v2.5 | v3 supports [audio tags] for emotion; Turbo is cheaper for plain narration. |
| lip-sync a portrait to audio | Kling Avatar Pro, Kling Avatar Standard, InfiniTalk | Pro for best mouth shape; InfiniTalk for resolution control. |
| transcription / captions | ElevenLabs STT | Word-level timestamps available. |
| motion transfer (drive a subject by another video) | Kling 2.6 Motion Transfer, Kling 3.0 Motion Transfer | Kling 2.6 base is cheap; Kling 3.0 is premium. |
<!-- AUTO-GEN:END model-recommendations -->

## Image models

Text-to-image, image-to-image, editing, upscaling, and background removal. For everyday drafts and storyboards, the Everyday tier is plenty; switch to a Premium model for final, high-detail or text-heavy images.

<!-- AUTO-GEN:START model-table-image -->
| Model | Family | Tier | Credits | Modes | Best for |
| --- | --- | --- | --- | --- | --- |
| Flux 2 Klein (Open) | Black Forest Labs | Everyday | 1 | t2i | Open Flux 2 9B from BFL — fast, no safety filter. Runs direct on Replicate. |
| GPT Image 2 | OpenAI | Everyday | 1 | t2i | Next-gen GPT Image — broader aspect ratios, resolution-based pricing (1K/2K/4K). |
| GPT Image 2 (I2I) | OpenAI | Everyday | 1 | i2i | Image-to-image with GPT Image 2. |
| Grok Imagine | xAI | Everyday | 1 | t2i, t2v | Expressive, high-contrast output. Supports both image and video. |
| Grok Imagine (I2I) | xAI | Everyday | 1 | i2i | Image-to-image with Grok. |
| Imagen 4 Fast | Google | Everyday | 1 | t2i | Cheaper / quicker Imagen 4 tier. |
| Qwen | Alibaba | Everyday | 1 | t2i | Cheap, fast, decent quality. Native negative-prompt support. |
| Qwen (I2I) | Alibaba | Everyday | 1 | i2i | Image-to-image with Qwen. |
| Recraft Crisp Upscale | Recraft | Everyday | 1 | upscale | Light-weight image upscale (Recraft Crisp). |
| Recraft Remove BG | Recraft | Everyday | 1 | remove-bg | Remove image background. Cheap utility. |
| ⭐ Z-Image | Tongyi-MAI | Everyday | 1 | t2i | Cheapest model in catalog. Fast, stylized output. Limited aspect ratios. |
| Flux 2 Pro | Black Forest Labs | Everyday | 2 | t2i | Flux 2 Pro text-to-image. Strong realism, fast. Resolution lever to 2K. |
| Flux 2 Pro (I2I) | Black Forest Labs | Everyday | 2 | i2i | Image-to-image with Flux Pro. Cheaper than Flex variant, good general edits. |
| Flux Kontext Pro | Black Forest Labs | Everyday | 2 | t2i, edit | Context-aware editing and style transfer. Strong at preserving subject identity through edits. |
| Ideogram Reframe | Ideogram | Everyday | 2 | edit | Outpaint / reframe to a new aspect ratio while preserving subject. |
| Ideogram V3 | Ideogram | Everyday | 2 | t2i | Strong typography and stylized illustration. Speed/quality tiered (TURBO/BALANCED/QUALITY). |
| Imagen 4 | Google | Everyday | 2 | t2i | Google's Imagen 4 — strong photographic quality and prompt fidelity. |
| Nano Banana Edit | Google | Everyday | 2 | edit | Image-to-image edits via Google's Nano Banana family. Good general-purpose editor. |
| Qwen Edit | Alibaba | Everyday | 2 | edit | Qwen image edit endpoint with native negative prompt. |
| Seedream 5 Lite | Bytedance | Everyday | 2 | t2i | Newer Seedream 5 Lite — instruction-based generation, visual reasoning. |
| Seedream 5 Lite (I2I) | Bytedance | Everyday | 2 | i2i | Image-to-image with Seedream 5 Lite. |
| Wan 2.7 | Alibaba | Everyday | 2 | t2i | Wan 2.7 text-to-image — 1K/2K/4K, up to 9 optional style/character reference images. |
| Flux 2 Pro (Safety Tolerance) | Black Forest Labs | Standard | 3 | t2i, i2i | BFL Flux 2 Pro flagship via Replicate — exposes the `safety_tolerance` lever pinned to 5 (max for Pro). Accepts up to 4 reference images. |
| Grok Upscale | xAI | Standard | 3 | upscale | Upscale a previously-generated Grok image. Requires the prior task id. |
| Imagen 4 Ultra | Google | Standard | 3 | t2i | Premium Imagen 4 — highest fidelity, slower / more credits. |
| Kontext Multi (Open) | Black Forest Labs | Standard | 3 | i2i, edit | Multi-image Flux Kontext Pro via Replicate — up to 4 input images, no safety filter. |
| Topaz Image Upscale | Topaz | Standard | 3 | upscale | High-quality image upscale up to 8K. Best for production-ready output. |
| Wan 2.7 Pro | Alibaba | Standard | 3 | t2i | Wan 2.7 Pro text-to-image — higher quality, 1K/2K/4K, no image input. |
| Flux 2 Flex | Black Forest Labs | Standard | 4 | t2i | Flux 2 Flex — premium fidelity, more flexible composition. Pricier than Pro. |
| Flux 2 Flex (I2I) | Black Forest Labs | Standard | 4 | i2i | Image-to-image with Flux Flex. Honors source image structure while applying prompt. |
| Flux Kontext Max | Black Forest Labs | Standard | 4 | t2i, edit | Premium Kontext — highest fidelity context-aware edits. |
| Nano Banana 2 | Google | Standard | 4 | t2i, i2i | Newer Nano Banana with native resolution control (1K/2K/4K) and Google Search context. |
| Ideogram Edit | Ideogram | Premium | 5 | edit | Inpainting / mask-based editing with Ideogram. Pair with a mask URL. |
| Ideogram Remix | Ideogram | Premium | 5 | i2i | Ideogram remix — character-aware restyling driven by reference images. |
| ⭐ Nano Banana Pro | Google | Premium | 5 | t2i, i2i | Top-tier Nano Banana — best for text rendering, diagrams, and complex compositions. |
| Flux 2 Max (Safety Tolerance) | Black Forest Labs | Premium | 7 | t2i, i2i | BFL Flux 2 Max — even larger sibling of Pro via Replicate, safety_tolerance=5, up to 8 reference images. Variable pricing by MP and ref count. |
<!-- AUTO-GEN:END model-table-image -->

## Video models

Many video models support **both** `t2v` and `i2v` from the same id — the Generate Video node picks the mode based on whether you wired an image in. Watch the `audio` feature (native sound/dialogue), duration limits, and whether the model accepts a start **and** end frame. Everyday models are great for batch B-roll; Premium models (VEO 3.1 Quality, Kling 3.0, Seedance 2) are for cinematic, multi-subject, or audio-driven shots.

<!-- AUTO-GEN:START model-table-video -->
| Model | Family | Tier | Credits | Modes | Best for |
| --- | --- | --- | --- | --- | --- |
| VEO 1080p Upscale | Google | Everyday | 2 | video-upscale | Upscale VEO output to 1080p. |
| Runway (via KIE) | Runway | Everyday | 3 | i2v, t2v | Runway Gen-3 routed through KIE. 5/10s at 720p/1080p. |
| Video Analysis (Gemini 3 Flash) | Google | Everyday | 3 | video-analysis | Analyze a video into a structured shot list (scenes, camera, audio) — fast Gemini tier. Billed per duration bucket. |
| Grok Imagine (I2V) | xAI | Everyday | 5 | i2v | Grok image-to-video — stylized motion. Up to 15s. |
| Bytedance Lite I2V | Bytedance | Everyday | 6 | i2v, t2v | Cheapest Bytedance video tier with end-frame support. |
| Hailuo 02 Standard | MiniMax | Everyday | 8 | i2v, t2v | Hailuo 02 Standard — economical option with end-frame support. |
| Hailuo 2.3 Standard | MiniMax | Everyday | 8 | i2v | Cheaper Hailuo 2.3 tier — good baseline quality. |
| VEO 3.1 Lite | Google | Everyday | 8 | i2v, t2v | VEO 3.1 Lite — most cost-effective VEO tier for high-volume generation. 4/6/8s with audio, supports first+last frame. |
| Bytedance Pro Fast I2V | Bytedance | Everyday | 9 | i2v | Faster Bytedance Pro variant. |
| Wan 2.2 Turbo | Alibaba | Everyday | 10 | i2v, t2v | Cheap, fast Wan turbo — 5s. Serves both i2v and t2v under one id. |
| Kling 2.5 Turbo Pro | Kuaishou | Everyday | 11 | i2v, t2v | Faster Kling — good quality at lower cost. Supports end frame. |
| Video Analysis (Gemini 3.1 Pro) | Google | Everyday | 11 | video-analysis | Analyze a video into a structured shot list (scenes, camera, audio) — high-fidelity Gemini tier. Billed per duration bucket. |
| Wan Flash V2V | Alibaba | Everyday | 13 | v2v | Faster Wan V2V variant. |
| Hailuo 02 I2V Pro | MiniMax | Everyday | 15 | i2v, t2v | Hailuo 02 Pro — strong photoreal motion, fixed 5-second clips. Supports end frame. |
| Kling 2.6 Motion Transfer | Kuaishou | Everyday | 15 | motion-transfer | Transfer the motion from a driving video onto a still subject. Kling 2.6 base. |
| ⭐ VEO 3.1 Fast | Google | Everyday | 15 | i2v, t2v | VEO 3.1 Fast — cheaper VEO 3.1 tier, 4/6/8s with audio. Good balance for most uses. Flat per-generation pricing across durations. |
| Bytedance Pro I2V | Bytedance | Standard | 18 | i2v, t2v | Pro Bytedance video tier — better quality. |
| Wan 2.6 | Alibaba | Standard | 18 | v2v, t2v | Wan 2.6 — text-to-video and video-to-video under a single id. |
| Wan 2.6 I2V | Alibaba | Standard | 18 | i2v | Wan 2.6 image-to-video — 5/10/15s at 720p/1080p. |
| Seedance 2 Mini | Bytedance | Standard | 19 | i2v, t2v | Budget Seedance 2 tier — 480p/720p only, per-second pricing by resolution. |
| Topaz Video Upscale | Topaz | Standard | 19 | video-upscale | High-quality video upscale and enhancement. |
| VEO Extend | Google | Standard | 19 | extend | Extend an existing VEO 3.1 clip by another segment. |
| Wan 2.7 I2V | Alibaba | Standard | 19 | i2v | Wan 2.7 image-to-video — 2–15s at 720p/1080p, supports start+end frame. |
| Wan 2.7 T2V | Alibaba | Standard | 19 | t2v | Wan 2.7 text-to-video — 2–15s at 720p/1080p. |
| Hailuo 2.3 Pro | MiniMax | Standard | 20 | i2v | Hailuo 2.3 Pro — newer Hailuo with 768P / 1080P resolutions. |
| Gemini Omni | Google | Standard | 23 | i2v, t2v | Google multimodal video with native audio; text/image-to-video + video-edit. |
| Kling 3 Omni | Kuaishou | Standard | 25 | i2v | Kling 3 Omni via Replicate — 3-15s, 720p/1080p, end frame + reference images, native audio. |
| Kling 2.6 | Kuaishou | Standard | 28 | i2v, t2v | Kling 2.6 I2V — strong motion realism. 5s/10s, optional native audio. |
| Kling Avatar Standard | Kuaishou | Standard | 28 | lip-sync | Lip-sync a still portrait to driving audio. Standard quality. |
| HappyHorse 1.1 | HappyHorse | Standard | 29 | t2v | HappyHorse 1.1 text-to-video — 3–15s at 720p/1080p, 9 aspect ratios incl. 21:9/9:21, per-second pricing. |
| HappyHorse 1.1 I2V | HappyHorse | Standard | 29 | i2v | HappyHorse 1.1 image-to-video — 3–15s at 720p/1080p, aspect ratio inferred from input image, per-second pricing. |
| HappyHorse 1.1 Ref2V | HappyHorse | Standard | 29 | i2v | HappyHorse 1.1 reference-to-video — 1–9 reference images, 3–15s at 720p/1080p, per-second pricing. |
| Grok Imagine Video 1.5 | xAI | Standard | 30 | i2v | Grok Imagine 1.5 image-to-video — 1–15s, 480p/720p, per-second pricing. Requires an input image. |
| Kling 3.0 Motion Transfer | Kuaishou | Standard | 30 | motion-transfer | Premium motion transfer via Kling 3.0. |
| Seedance 2 Fast | Bytedance | Standard | 31 | i2v, t2v | Cheaper / quicker Seedance 2 tier. |
| Runway Extend | Runway | Standard | 32 | extend | Extend a Runway video by another clip. |
| Wan 2.7 VideoEdit | Alibaba | Standard | 32 | v2v | Guided video editing with optional reference image, audio control, and prompt expansion. |
| HappyHorse Edit | HappyHorse | Standard | 35 | v2v | HappyHorse video-edit — video-to-video transformation, up to 60s input, 720p/1080p output. |
| Runway Aleph V2V | Runway | Standard | 35 | v2v | Runway Aleph — video-to-video conversion. |
| Seedance 2 | Bytedance | Standard | 38 | i2v, t2v | Seedance 2 — premium tier with native audio. Per-second pricing by resolution. |
| VEO 4K Upscale | Google | Standard | 38 | video-upscale | Upscale VEO output to 4K. |
| Kling 2.1 Master | Kuaishou | Standard | 40 | i2v | Master tier I2V — strong cinematic quality. |
| InfiniTalk | InfiniTalk | Standard | 42 | lip-sync | Audio-driven talking-head from a still image. 480p / 720p. |
| ⭐ Kling 3.0 | Kuaishou | Premium | 50 | i2v, t2v | Premium Kling 3.0 — variable 3-15s duration, native audio, 720P/1080P. |
| Seedance 2 Extend | Bytedance | Premium | 53 | extend | Extend ANY video: generates the continuation (audio included) and trim-stitches it into one seamless clip. |
| Kling Avatar Pro | Kuaishou | Premium | 56 | lip-sync | Premium lip-sync — better mouth shape and timing. |
| ⭐ VEO 3.1 Quality | Google | Premium | 63 | i2v, t2v | Google VEO 3.1 Quality — premium cinematic video. 4/6/8s clips, optional end frame, native audio. Flat per-generation pricing across durations. |
| OmniHuman 1.5 | ByteDance | Premium | 405 | lip-sync | Premium prompt-directed talking avatar from a still image + audio. 720p / 1080p, up to 60s. People, pets, anime. |
| Volcengine Lip Sync | Volcengine | Premium | 600 | lip-sync | Video-to-video AI dubbing — re-syncs lips to a new vocal track. Multi-speaker (scene detection + speaker ID) in basic mode. Video input, billed per second. |
| Sync Lipsync v3 | Sync | Premium | 2000 | lip-sync | Dub existing footage — re-syncs lips to a new audio track. Video input, billed per second. |
<!-- AUTO-GEN:END model-table-video -->

## Audio, voice & music models

Text-to-speech, voice cloning/design/changing, dubbing, sound effects, transcription, and full music generation (Suno).

<!-- AUTO-GEN:START model-table-audio -->
| Model | Family | Tier | Credits | Modes | Best for |
| --- | --- | --- | --- | --- | --- |
| ElevenLabs Sound Effects | ElevenLabs | Everyday | 1 | sfx | Generate short sound effects from a text prompt. |
| ElevenLabs Turbo v2.5 | ElevenLabs | Everyday | 2 | tts | Fast, cheap ElevenLabs TTS via the direct ElevenLabs API. Good for narration. |
| ElevenLabs Forced Alignment | ElevenLabs | Everyday | 3 | forced-alignment | Align an existing transcript to audio with word-level timestamps. |
| ElevenLabs Multilingual v2 | ElevenLabs | Everyday | 3 | tts | Multi-language ElevenLabs TTS via the direct ElevenLabs API. |
| ElevenLabs STT | ElevenLabs | Everyday | 3 | stt | Speech-to-text — transcribe audio with timestamps. |
| ⭐ ElevenLabs v3 | ElevenLabs | Everyday | 3 | tts | Latest ElevenLabs TTS — supports [audio tags] for emotion / pacing. Direct API. |
| Suno v4 | Suno | Everyday | 3 | music | Suno v4 music generation — full songs with vocals, multiple genres. |
| Suno v5 | Suno | Everyday | 3 | music | Newer Suno v5 — better vocal quality, more genres. Same price as v4. |
| ⭐ Suno v5.5 | Suno | Everyday | 3 | music | Suno v5.5 — latest model with improved audio quality and expressiveness. |
| ElevenLabs Voice Changer | ElevenLabs | Standard | 4 | voice-changer | Speech-to-speech: convert one voice to another while preserving prosody. |
| ElevenLabs Voice Design | ElevenLabs | Standard | 5 | voice-design | Design a synthetic voice from a description (no reference clip needed). |
| Voice Clone (Instant) | ElevenLabs | Standard | 5 | voice-clone | Clone a voice from a short reference clip. Instant clone via direct ElevenLabs API. |
| ElevenLabs Dubbing | ElevenLabs | Premium | 8 | dubbing | Translate + dub a video into a new language. Async. |
| ElevenLabs Voice Isolation | ElevenLabs | Premium | 8 | isolation | Strip background noise / music from a vocal track. |
<!-- AUTO-GEN:END model-table-audio -->

## Text & LLM models

LLM-backed nodes (Generate Script, AI Writer, LLM Chat, QA Check, prompt helper, scene-graph/motion-graphics authoring) route through a **tiered model selector** rather than a single fixed model. Pick the tier on the node:

| Tier | Use it for | Relative cost |
| --- | --- | --- |
| **Economy** | High-volume, simple text — fast drafts, short prompts, QA passes. | Lowest |
| **Standard** | The default for most writing and structured-output work — balanced quality and cost. | Mid |
| **Premium** | The hardest reasoning: long scripts, intricate scene graphs, nuanced rewrites. | Highest |

Provider availability per node varies (e.g. Generate Script offers multiple providers; QA Check is narrower). The node's config panel shows the exact tier/provider options and their credit cost. Model assignments per tier live in `packages/shared/src/llm-models.ts`.

## Keeping this guide accurate

The model tables and quick-picks above are generated from `packages/shared/src/model-catalog.ts` (`MODEL_CATALOG` + `MODEL_RECOMMENDATIONS`) by `npm run gen:skills`. To change them, **edit the catalog and regenerate** — don't hand-edit the generated blocks. CI (`gen:skills:check`) fails if this page drifts from the catalog.
