# KIE.ai Provider — Claude Code Reference

API docs: https://docs.kie.ai/
Full LLM reference: https://docs.kie.ai/llms.txt

**IMPORTANT**: Always check `https://docs.kie.ai/llms.txt` when auditing model coverage. It lists every model KIE.ai offers. Last checked: 2026-02-22.

## API Patterns

**Standard models** — `POST /api/v1/jobs/createTask` + poll `GET /api/v1/jobs/recordInfo?taskId=`
**VEO models** — `POST /api/v1/veo/generate` + poll `GET /api/v1/veo/record-info?taskId=`
**Kling 3.0** — `POST /api/v1/jobs/createTask` + poll `GET /api/v1/jobs/recordInfo?taskId=` (separate client: `kling3-client.ts`)
**Suno music** — `POST /api/v1/generate`, `/api/v1/lyrics`, `/api/v1/vocal-removal/*`, `/api/v1/mp4/*` (separate client: `suno-client.ts`)
**Flux Kontext** — `POST /api/v1/flux/kontext/generate` + poll (special endpoint, NOT createTask)
**4o Image** — `POST /api/v1/gpt4o-image/generate` + poll (special endpoint, NOT createTask)

Base URL: `https://api.kie.ai`, Auth: `Bearer KIE_API_KEY`

### Task States
- Standard: `waiting` | `queuing` | `generating` | `success` | `fail` (NOTE: "fail" not "failed")
- VEO: `successFlag` — 0=generating, 1=success, 2=failed, 3=generation failed

### Polling
- Exponential backoff via `pollDelay()`: 2s for first 5 attempts, ramps to 10s cap
- Standard models: 60 attempts (~5 min). Video: 90 attempts (~10 min)
- 10s timeout per poll request; 30s timeout for task creation

---

## Model Key → KIE API Doc Map

### Image Generation (`models.ts: KIE_IMAGE_MODELS`)

| Model Key | KIE Model ID | API Doc |
|-----------|-------------|---------|
| `nano-banana` | `nano-banana-pro` | [nano-banana](https://docs.kie.ai/market/google/nano-banana.md) |
| `nano-banana-pro` | `nano-banana-pro` | [nano-banana-pro](https://docs.kie.ai/market/google/pro-image-to-image.md) |
| `nano-banana-2-lite` | `nano-banana-2-lite` | [nano-banana-2-lite](https://docs.kie.ai/market/google/nano-banana-2-lite.md) |
| `nano-banana-edit` | `google/nano-banana-edit` | [nano-banana-edit](https://docs.kie.ai/market/google/nano-banana-edit.md) |
| `flux` | `flux-2/pro-text-to-image` | [flux-2 pro t2i](https://docs.kie.ai/market/flux2/pro-text-to-image.md) |
| `flux-flex` | `flux-2/flex-text-to-image` | [flux-2 flex t2i](https://docs.kie.ai/market/flux2/flex-text-to-image.md) |
| `flux-i2i` | `flux-2/flex-image-to-image` | [flux-2 flex i2i](https://docs.kie.ai/market/flux2/flex-image-to-image.md) |
| `flux-pro-i2i` | `flux-2/pro-image-to-image` | [flux-2 pro i2i](https://docs.kie.ai/market/flux2/pro-image-to-image.md) |
| `grok` | `grok-imagine/text-to-image` | [grok t2i](https://docs.kie.ai/market/grok-imagine/text-to-image.md) |
| `grok-i2i` | `grok-imagine/image-to-image` | [grok i2i](https://docs.kie.ai/market/grok-imagine/image-to-image.md) |
| `grok-upscale` | `grok-imagine/upscale` | [grok upscale](https://docs.kie.ai/market/grok-imagine/upscale.md) |
| `gpt-image` | `gpt-image/1.5-text-to-image` | [gpt-image 1.5 t2i](https://docs.kie.ai/market/gpt-image/1-5-text-to-image.md) |
| `gpt-image-i2i` | `gpt-image/1.5-image-to-image` | [gpt-image 1.5 i2i](https://docs.kie.ai/market/gpt-image/1-5-image-to-image.md) |
| `gpt-image-2` | `gpt-image-2-text-to-image` | [gpt-image 2 t2i](https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image.md) |
| `gpt-image-2-i2i` | `gpt-image-2-image-to-image` | [gpt-image 2 i2i](https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image.md) |
| `imagen4` | `google/imagen4` | [imagen4](https://docs.kie.ai/market/google/imagen4.md) |
| `imagen4-fast` | `google/imagen4-fast` | [imagen4-fast](https://docs.kie.ai/market/google/imagen4-fast.md) |
| `imagen4-ultra` | `google/imagen4-ultra` | [imagen4-ultra](https://docs.kie.ai/market/google/imagen4-ultra.md) |
| ~~`ideogram`~~ | ~~`ideogram/character`~~ | **REMOVED** — v2 model, unreliable, requires reference_image_urls |
| `ideogram-edit` | `ideogram/character-edit` | [ideogram edit](https://docs.kie.ai/market/ideogram/character-edit.md) |
| `ideogram-remix` | `ideogram/character-remix` | [ideogram remix](https://docs.kie.ai/market/ideogram/character-remix.md) |
| `ideogram-reframe` | `ideogram/v3-reframe` | [ideogram reframe](https://docs.kie.ai/market/ideogram/v3-reframe.md) |
| `qwen` | `qwen/text-to-image` | [qwen t2i](https://docs.kie.ai/market/qwen/text-to-image.md) |
| `qwen-i2i` | `qwen/image-to-image` | [qwen i2i](https://docs.kie.ai/market/qwen/image-to-image.md) |
| `qwen-edit` | `qwen/image-edit` | [qwen edit](https://docs.kie.ai/market/qwen/image-edit.md) |
| `seedream` | `seedream/4.5-text-to-image` | [seedream 4.5 t2i](https://docs.kie.ai/market/seedream/4.5-text-to-image.md) |
| `seedream-edit` | `seedream/4.5-edit` | [seedream 4.5 edit](https://docs.kie.ai/market/seedream/4.5-edit.md) |
| `seedream-5-lite` | `seedream/5-lite-text-to-image` | [seedream 5 lite t2i](https://docs.kie.ai/market/seedream/5-lite-text-to-image.md) |
| `seedream-5-lite-i2i` | `seedream/5-lite-image-to-image` | [seedream 5 lite i2i](https://docs.kie.ai/market/seedream-5-lite-image-to-image.md) |
| `seedream-5-pro` | `seedream/5-pro-text-to-image` | [seedream 5 pro t2i](https://docs.kie.ai/market/seedream/5-pro-text-to-image.md) |
| `seedream-5-pro-i2i` | `seedream/5-pro-image-to-image` | [seedream 5 pro i2i](https://docs.kie.ai/market/seedream/5-pro-image-to-image.md) |
| `z-image` | `z-image` | [z-image](https://docs.kie.ai/market/z-image/z-image.md) |
| `topaz-image-upscale` | `topaz/image-upscale` | [topaz img upscale](https://docs.kie.ai/market/topaz/image-upscale.md) |
| `recraft-remove-bg` | `recraft/remove-background` | [recraft bg remove](https://docs.kie.ai/market/recraft/remove-background.md) |
| `recraft-upscale` | `recraft/crisp-upscale` | [recraft upscale](https://docs.kie.ai/market/recraft/crisp-upscale.md) |

### Image-to-Video (`models.ts: KIE_VIDEO_MODELS`)

| Model Key | KIE Model ID | API Doc |
|-----------|-------------|---------|
| `minimax` | `hailuo/02-image-to-video-pro` | [hailuo i2v pro](https://docs.kie.ai/market/hailuo/02-image-to-video-pro.md) |
| `veo3` | `veo3` (special VEO endpoint) | [veo3 generate](https://docs.kie.ai/veo3-api/generate-veo-3-video.md) |
| `veo3.1` | `veo3_fast` (special VEO endpoint) | [veo3 generate](https://docs.kie.ai/veo3-api/generate-veo-3-video.md) |
| `kling` | `kling-2.6/image-to-video` | [kling i2v](https://docs.kie.ai/market/kling/image-to-video.md) |
| `kling-turbo` | `kling/v2-5-turbo-image-to-video-pro` | [kling turbo i2v](https://docs.kie.ai/market/kling/v2-5-turbo-image-to-video-pro.md) |
| `kling-3.0` | `kling-3.0/video` | [kling 3.0](https://docs.kie.ai/market/kling/kling-3.0.md) |
| `grok-i2v` | `grok-imagine/image-to-video` | [grok i2v](https://docs.kie.ai/market/grok-imagine/image-to-video.md) |
| `sora2-pro` | `sora-2-pro-image-to-video` | [sora2 pro i2v](https://docs.kie.ai/market/sora2/sora-2-pro-image-to-video.md) |
| `seedance` | `bytedance/seedance-1.5-pro` | [seedance 1.5 pro](https://docs.kie.ai/market/bytedance/seedance-1.5-pro.md) |
| `minimax-h3` | `minimax-h3/image-to-video` (swaps to `minimax-h3/reference-to-video` when refs are wired — see `minimaxH3TaskModel`) | [minimax-h3 i2v](https://docs.kie.ai/market/minimax-h3/image-to-video.md) / [r2v](https://docs.kie.ai/market/minimax-h3/reference-to-video.md) |
| `wan-3` | `wan/3-0-video` (bespoke `runWan3`) | [wan 3.0](https://docs.kie.ai/market/wan/3-0-video.md) |
| `wan-3-prime` | `wan/3-0-video-prime` (bespoke `runWan3`) | [wan 3.0 prime](https://docs.kie.ai/market/wan/3-0-video-prime.md) |
| `gemini-omni-flash` | `google/gemini-omni-flash-1-1` (via `runGeminiOmni`; the pro sibling's id is the bare `gemini-omni-video`) | [gemini omni flash](https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md) |
| `wan-i2v` | `wan/2-6-image-to-video` | [wan 2.6 i2v](https://docs.kie.ai/market/wan/2-6-image-to-video.md) |
| `wan-turbo` | `wan/2-2-a14b-image-to-video-turbo` | [wan turbo i2v](https://docs.kie.ai/market/wan/2-2-a14b-image-to-video-turbo.md) |
| `hailuo-2.3-pro` | `hailuo/2-3-image-to-video-pro` | [hailuo 2.3 pro](https://docs.kie.ai/market/hailuo/2-3-image-to-video-pro.md) |
| `hailuo-2.3` | `hailuo/2-3-image-to-video-standard` | [hailuo 2.3 std](https://docs.kie.ai/market/hailuo/2-3-image-to-video-standard.md) |
| `hailuo-standard` | `hailuo/02-image-to-video-standard` | [hailuo std](https://docs.kie.ai/market/hailuo/02-image-to-video-standard.md) |
| `sora2` | `sora-2-image-to-video` | [sora2 i2v](https://docs.kie.ai/market/sora2/sora-2-image-to-video.md) |
| `bytedance-lite` | `bytedance/v1-lite-image-to-video` | [bytedance lite i2v](https://docs.kie.ai/market/bytedance/v1-lite-image-to-video.md) |
| `bytedance-pro` | `bytedance/v1-pro-image-to-video` | [bytedance pro i2v](https://docs.kie.ai/market/bytedance/v1-pro-image-to-video.md) |
| `bytedance-pro-fast` | `bytedance/v1-pro-fast-image-to-video` | [bytedance pro fast](https://docs.kie.ai/market/bytedance/v1-pro-fast-image-to-video.md) |
| `kling-master` | `kling/v2-1-master-image-to-video` | [kling master](https://docs.kie.ai/market/kling/v2-1-master-image-to-video.md) |

### Text-to-Video (`models.ts: KIE_TEXT_TO_VIDEO_MODELS`)

| Model Key | KIE Model ID | API Doc |
|-----------|-------------|---------|
| `minimax` | `hailuo/02-text-to-video-pro` | [hailuo t2v pro](https://docs.kie.ai/market/hailuo/02-text-to-video-pro.md) |
| `veo3` | `veo3` (special VEO endpoint) | [veo3 generate](https://docs.kie.ai/veo3-api/generate-veo-3-video.md) |
| `kling` | `kling-2.6/text-to-video` | [kling t2v](https://docs.kie.ai/market/kling/text-to-video.md) |
| `kling-turbo` | `kling/v2-5-turbo-text-to-video-pro` | [kling turbo t2v](https://docs.kie.ai/market/kling/v2-5-turbo-text-to-video-pro.md) |
| `grok` | `grok-imagine/text-to-video` | [grok t2v](https://docs.kie.ai/market/grok-imagine/text-to-video.md) |
| `sora2-pro` | `sora-2-pro-text-to-video` | [sora2 pro t2v](https://docs.kie.ai/market/sora2/sora-2-pro-text-to-video.md) |
| `kling-3.0` | `kling-3.0/video` | [kling 3.0](https://docs.kie.ai/market/kling/kling-3.0.md) |
| `seedance` | `bytedance/seedance-1.5-pro` | [seedance t2v](https://docs.kie.ai/market/bytedance/seedance-1.5-pro.md) |
| `minimax-h3` | `minimax-h3/text-to-video` (swaps to `minimax-h3/reference-to-video` when refs are wired) | [minimax-h3 t2v](https://docs.kie.ai/market/minimax-h3/text-to-video.md) |
| `wan-3` | `wan/3-0-video` (ONE KIE id serves both modes) | [wan 3.0](https://docs.kie.ai/market/wan/3-0-video.md) |
| `wan-3-prime` | `wan/3-0-video-prime` (ONE KIE id serves both modes) | [wan 3.0 prime](https://docs.kie.ai/market/wan/3-0-video-prime.md) |
| `gemini-omni-flash` | `google/gemini-omni-flash-1-1` (ONE KIE id serves both modes) | [gemini omni flash](https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md) |
| `wan` | `wan/2-6-text-to-video` | [wan 2.6 t2v](https://docs.kie.ai/market/wan/2-6-text-to-video.md) |
| `sora2` | `sora-2-text-to-video` | [sora2 t2v](https://docs.kie.ai/market/sora2/sora-2-text-to-video.md) |
| `hailuo-standard` | `hailuo/02-text-to-video-standard` | [hailuo std t2v](https://docs.kie.ai/market/hailuo/02-text-to-video-standard.md) |
| `bytedance-lite` | `bytedance/v1-lite-text-to-video` | [bytedance lite t2v](https://docs.kie.ai/market/bytedance/v1-lite-text-to-video.md) |
| `bytedance-pro` | `bytedance/v1-pro-text-to-video` | [bytedance pro t2v](https://docs.kie.ai/market/bytedance/v1-pro-text-to-video.md) |
| `wan-turbo` | `wan/2-2-a14b-text-to-video-turbo` | [wan turbo t2v](https://docs.kie.ai/market/wan/2-2-a14b-text-to-video-turbo.md) |

### Other Models

| Model Key | KIE Model ID | API Doc |
|-----------|-------------|---------|
| `wan` (v2v) | `wan/2-6-video-to-video` | [wan 2.6 v2v](https://docs.kie.ai/market/wan/2-6-video-to-video.md) |
| `kling` (motion) | `kling-2.6/motion-control` | [kling motion](https://docs.kie.ai/market/kling/motion-control.md) |
| `topaz` (upscale) | `topaz/video-upscale` | [topaz upscale](https://docs.kie.ai/market/topaz/video-upscale.md) |
| `kling-avatar` | `kling/ai-avatar-standard` | [kling avatar std](https://docs.kie.ai/market/kling/ai-avatar-standard.md) |
| `kling-avatar-pro` | `kling/ai-avatar-pro` | [kling avatar pro](https://docs.kie.ai/market/kling/ai-avatar-pro.md) |
| `infinitalk` | `infinitalk/from-audio` | [infinitalk](https://docs.kie.ai/market/infinitalk/from-audio.md) |
| `omnihuman-1-5` | `omnihuman-1-5` | [omnihuman 1.5](https://kie.ai/model/omnihuman-1-5.md) |
| `suno` (music) | `suno/v4` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v5` (music) | `suno/v5` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `elevenlabs-turbo` | `elevenlabs/text-to-speech-turbo-2-5` | [11labs turbo](https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5.md) |
| `elevenlabs-multilingual` | `elevenlabs/text-to-speech-multilingual-v2` | [11labs multilingual](https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2.md) |
| `elevenlabs-sfx` | `elevenlabs/sound-effect-v2` | [11labs sfx](https://docs.kie.ai/market/elevenlabs/sound-effect-v2.md) |
| `elevenlabs-stt` | `elevenlabs/speech-to-text` | [11labs stt](https://docs.kie.ai/market/elevenlabs/speech-to-text.md) |

### Wan 3.0 wire notes (`wan-3` / `wan-3-prime`, bespoke `runWan3`)

Wan 3.0 is the first KIE video model whose wire vocabulary diverges from ours,
which is why it has a bespoke runner instead of the generic `createTask` builder:

- `duration` is an **integer** (2–30), not the string the generic path emits.
- `resolution` is the **UPPERCASE** enum `480P` / `720P` / `1080P`. Everything on
  our side (catalog, credit composites, config panels) is lowercase, so
  `normalizeWan3Resolution` (`@nodaro/shared`) is the single case-conversion
  point. An absent or unknown value pins **720P** — deliberately NOT KIE's own
  1080P default, which would render (and under-bill) the top tier.
  **`buildVideoCreditModelIdentifier` collapses through the SAME normalizer**
  for the wan family — the tier list is lowercase and `Array.includes` is
  case-sensitive, so an integrator sending KIE's own `"1080P"` used to render
  1080P and bill the 720p row.
- `aspect_ratio` defaults to `adaptive`, which is special-cased before any ratio
  snapping.
- `audio` (boolean) is the native-audio lever — not `sound` / `generate_audio`.
  It is the `field: "audio"` branch of `applyVideoAudioToggle`.
- `first_frame_url` / `last_frame_url` are **mutually exclusive** with the
  `reference_*_urls` arrays; `resolveSeedance2Inputs` demotes a frame into
  `reference_image_urls` (bound in prose) rather than rejecting the run.
- Reference caps are 10 images / 5 videos / 5 audio
  (`VIDEO_REF_LIMITS_BY_PROVIDER`). Reference videos are each 1–15s, ≤15s
  combined, and input seconds + output duration ≤ 30s — documented, not
  pre-flighted (same as `seedance-2` / `minimax-h3`). Reference **audio** is the
  exception: the ≤15s per-clip cap runs in `validateSeedance2AudioPreHandler`
  (`SEEDANCE_2_R2V_MAX_AUDIO_SEC_BY_PROVIDER`), so an over-long clip 400s with
  `audio_too_long` before credits are reserved.
- `duration: -1`, `reference_file_urls`, `reference_link_urls` and
  `nsfw_checker` are deliberately never emitted.

`gemini-omni-flash` shares the pro sibling's request shape through
`runGeminiOmni`, with one difference: its schema marks `duration` **required**,
so the emitted body always carries it (`requiresDuration` on the model config).


---

## Not Yet Implemented (from llms.txt)

Models available on KIE.ai that we have NOT implemented. Check this list when adding new features.

### Image Models — Not Implemented

| KIE Model | Type | Reason Not Implemented | API Endpoint |
|-----------|------|----------------------|--------------|
| `flux-kontext-pro` / `flux-kontext-max` | T2I + I2I | **Special API** (`/api/v1/flux/kontext/generate`), needs custom client | [docs](https://docs.kie.ai/flux-kontext-api/generate-or-edit-image.md) |
| 4o Image (GPT Image 1) | T2I + I2I | **Special API** (`/api/v1/gpt4o-image/generate`), needs custom client; superseded by GPT Image 1.5 | [docs](https://docs.kie.ai/4o-image-api/generate-4-o-image.md) |
| `bytedance/seedream` (3.0) | T2I | Superseded by Seedream 4.5 (which we implement) | [docs](https://docs.kie.ai/market/seedream/seedream.md) |
| `bytedance/seedream-v4-text-to-image` | T2I | Superseded by Seedream 4.5 | [docs](https://docs.kie.ai/market/seedream/seedream-v4-text-to-image.md) |
| `bytedance/seedream-v4-edit` | I2I | Superseded by Seedream 4.5 Edit | [docs](https://docs.kie.ai/market/seedream/seedream-v4-edit.md) |

### Video Models — Not Implemented

| KIE Model | Type | Reason | API Doc |
|-----------|------|--------|---------|
| Kling V2.1 Standard/Pro | T2V + I2V | Superseded by Kling 2.6/3.0; Master I2V added | [docs](https://docs.kie.ai/market/kling/v2-1-standard.md) |
| Luma Modify | V2V | New model, not yet evaluated | [docs](https://docs.kie.ai/luma-api/generate-luma-modify-video.md) |
| Runway (KIE version) | T2V + I2V + V2V | We use Replicate for Runway; KIE version has separate API | [docs](https://docs.kie.ai/runway-api/generate-ai-video.md) |
| Sora 2 Characters | Character animation | Niche feature, not yet evaluated | [docs](https://docs.kie.ai/market/sora2/sora-2-characters.md) |
| Sora 2 Pro Storyboard | Multi-shot | Interesting for Director Mode (future) | [docs](https://docs.kie.ai/market/sora-2-pro-storyboard/index.md) |
| Wan 2.2 Animate Move/Replace | Motion | Niche features | [docs](https://docs.kie.ai/market/wan/2-2-animate-move.md) |
| Wan 2.2 Speech2Video | S2V | Speech-to-video not yet evaluated | [docs](https://docs.kie.ai/market/wan/2-2-a14b-text-to-video-turbo.md) |
| VEO 3.1 Extend | Video extend | New feature, not yet evaluated | [docs](https://docs.kie.ai/veo3-api/extend-video.md) |
| VEO 3.1 1080P/4K | Upscale | Resolution upgrades for VEO output | [docs](https://docs.kie.ai/veo3-api/get-veo-3-1080-p-video.md) |

### Audio Models — Not Implemented

| KIE Model | Type | Reason | API Doc |
|-----------|------|--------|---------|
| Suno extended features | Lyrics, stems, mashup, cover, music video, MIDI, WAV | Partial implementation only (generate + extend) | [docs](https://docs.kie.ai/suno-api/quickstart.md) |

### Chat/LLM Models — Not Applicable

KIE.ai also offers Claude, Gemini, and GPT-5-2 as chat models. We use those providers directly, not via KIE.

---

## Image Parameter Gotchas

Different models use different param names for input images — getting this wrong causes silent failures:

| Pattern | Models | Param |
|---------|--------|-------|
| Single URL string | minimax, kling-turbo, kling-avatar, topaz, ideogram-edit, ideogram-remix, ideogram-reframe, qwen-i2i, qwen-edit, topaz-image-upscale | `image_url` |
| Array of URLs | kling, grok, sora2-pro, flux, gpt-image, nano-banana-edit, seedream-edit, nano-banana-2-lite (up to 10, NOT the family's `image_input`) | `image_urls` or `input_urls` |
| VEO array | veo3, veo3.1 | `imageUrls` (camelCase!) |
| Video URL | wan v2v | `video_urls` (array) |
| Video URL | topaz upscale | `video_url` (string) |
| Task ID | grok-upscale | `task_id` (NOT an image URL — requires prior grok generation) |
| Reference images (T2I) | nano-banana-pro, others | `image_input` |

Check `imageParam` in `models.ts` for the authoritative mapping.

### Aspect Ratio / Size Parameter Names

Not all models use `aspect_ratio` — getting this wrong causes silent failures (default aspect used):

| Param Name | Models | Values | Notes |
|------------|--------|--------|-------|
| `image_size` (ratio) | nano-banana, nano-banana-edit | `"1:1"`, `"16:9"`, etc. | Nano Banana base uses ratio strings as `image_size` |
| `aspect_ratio` (ratio) | nano-banana-pro, flux, grok, gpt-image, imagen4, seedream, z-image, nano-banana-2-lite (also `auto` + banner ratios 8:1/1:8/4:1/1:4) | `"1:1"`, `"16:9"`, etc. — **per model, NOT a shared set** | Standard param name |

**The allowed ratios differ sharply per model — read `MODEL_CATALOG[...].aspectRatios`, never assume 16:9 exists.** `gpt-image` (GPT Image 1.5) accepts only `1:1 / 3:2 / 2:3` and has NO `resolution` lever at all, while its `gpt-image-2` sibling accepts `auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4` plus 1K–4K. Sending a ratio the model doesn't list returns a KIE error that `client.ts` surfaces as "Invalid aspect ratio setting" — and inside a workflow run that aborts every sibling node's results too. `normalizeModelInput` (`@nodaro/shared`) coerces a stale pair at the write and run boundaries; it derives entirely from the catalog, so a new model is covered by declaring `aspectRatios` honestly and nothing else.
| `image_size` (named) | ideogram, qwen | `"square"`, `"landscape_16_9"`, etc. | Named values, NOT ratios! `image.ts` converts at runtime |
| *(none)* | grok-i2i, recraft-*, grok-upscale | — | No aspect ratio control |

`image.ts` handles conversions:
- Base `nano-banana`: remaps `aspect_ratio` → `image_size` (ratio format)
- `ideogram`, `qwen`: remaps `aspect_ratio` → `image_size` (named format via `RATIO_TO_NAMED_SIZE`)

### output_format Support

| Models | Param | Values |
|--------|-------|--------|
| Nano Banana family | `output_format` | `"png"`, `"jpeg"` (hardcoded `"png"`) |
| Qwen | `output_format` | `"png"`, `"jpeg"` |
| Other image models | Not supported | — |

### resolution Support

| Models | Param | Values |
|--------|-------|--------|
| Nano Banana Pro | `resolution` | `"1K"`, `"2K"`, `"4K"` |
| Nano Banana 2 | `resolution` | `"1K"`, `"2K"`, `"4K"` |
| Nano Banana 2 Lite | Not supported — 1K ONLY (no resolution param; `image.ts` strips stale values) | — |
| GPT Image 2 (T2I + I2I) | `resolution` | `"1K"`, `"2K"`, `"4K"` (1:1 cannot use 4K; `auto` aspect_ratio limited to 1K) |
| Flux (all variants) | `resolution` | `"1K"`, `"2K"` |
| Other image models | Not supported | — |

### quality Support

| Models | Param | Values |
|--------|-------|--------|
| GPT Image 1.5 (T2I + I2I) | `quality` | `"medium"`, `"high"` |
| GPT Image 2 (T2I + I2I) | Not supported (uses `resolution` instead) | — |
| Seedream 4.5 (T2I + Edit) | `quality` | `"basic"` (2K), `"high"` (4K) |
| Seedream 5 Lite (T2I + I2I) | `quality` | `"basic"` (2K), `"high"` (4K) |
| Seedream 5 Pro (T2I + I2I) | `quality` | `"basic"` (1K), `"high"` (2K) — note: one tier LOWER than Lite/4.5 |
| Other image models | Not supported | — |

### negative_prompt Support

`image.ts` uses `NATIVE_NEGATIVE_PROMPT_MODELS` set to decide: models in the set get `negative_prompt` as a native API param; all others have it stripped from the request (frontend appends "Avoid: ..." to the prompt text instead).

| Models | Param | Max Length | Implementation |
|--------|-------|-----------|----------------|
| Imagen4 family | `negative_prompt` | 5000 chars | Native (sent as API param) |
| Ideogram (character, remix) | `negative_prompt` | 500 chars | Native (sent as API param) |
| Qwen (T2I, edit) | `negative_prompt` | 500 chars | Native (sent as API param) |
| Other models | Not natively supported | — | Frontend appends "Avoid: ..." to prompt text |

---

## Files in this directory

| File | Purpose |
|------|---------|
| `client.ts` | Core HTTP client: `runKieTask()` (standard), `runVeoTask()` (VEO). Polling, backoff, error sanitization. |
| `models.ts` | All model configs: costs, durations, image params, end frame support. Source of truth for KIE model mapping. |
| `image.ts` | `ImageGenerationProvider` + `ImageEditingProvider` implementations. Handles param name conversion per model, native `negative_prompt` for supported models (`NATIVE_NEGATIVE_PROMPT_MODELS`), Ideogram `reference_image_urls` for character refs. |
| `video.ts` | `ImageToVideoProvider` + `TextToVideoProvider` + `VideoToVideoProvider` + `MotionTransferProvider` + `VideoUpscaleProvider` + `LipSyncProvider` |
| `audio.ts` | `MusicGenerationProvider` + `TextToSpeechProvider` + `speechToText()` + `generateDialogue()` |
| `index.ts` | `registerKieProviders()` function + `kieInfo` object. Auto-derives `supportedModels` from model config keys. |
| `kling3-client.ts` | Kling 3.0 specific client (different polling endpoint: `getTaskDetail`) |
| `suno-client.ts` | Suno music API client (multiple endpoints for generate, extend, stems, cover) |

---

*Last updated: 2026-02-23*
*Last llms.txt audit: 2026-02-22*

---

## Architecture Rules (non-obvious) — migrated from root CLAUDE.md

| Area | Rule |
|------|------|
| KIE i2v image input | Every KIE image-to-video provider runs its start + end frames through `ensureImageForProvider` (`backend/src/providers/kie/video.ts`) before the API call: longest side capped at 2048px (no i2v model uses a larger input), and the Hailuo/MiniMax family (`modelConfig.model.startsWith("hailuo/")` → `minimax`, `hailuo-2.3`, `hailuo-2.3-pro`, `hailuo-standard`) is also re-encoded to JPEG (`forceJpeg`) because the MiniMax backend returns "internal error" on large RGBA PNGs despite the docs only listing a 10MB cap. VEO (`isVeoProvider`) and `runway-kie` are excepted — own endpoints, and they reference the raw URLs directly. `isVeoProvider`/`VEO_PROVIDERS` live in `packages/shared/src/model-constants.ts` alongside `isSeedance2Provider`. |
