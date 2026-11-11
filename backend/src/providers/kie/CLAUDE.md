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
| `nano-banana-2-1` | `nano-banana-2-1` | [nanobanana-2-1](https://docs.kie.ai/market/google/nanobanana-2-1.md) |
| `nano-banana-2-lite` | `nano-banana-2-lite` | [nano-banana-2-lite](https://docs.kie.ai/market/google/nano-banana-2-lite.md) |
| `nano-banana-edit` | `google/nano-banana-edit` | [nano-banana-edit](https://docs.kie.ai/market/google/nano-banana-edit.md) |
| `flux` | `flux-2/pro-text-to-image` | [flux-2 pro t2i](https://docs.kie.ai/market/flux2/pro-text-to-image.md) |
| `flux-flex` | `flux-2/flex-text-to-image` | [flux-2 flex t2i](https://docs.kie.ai/market/flux2/flex-text-to-image.md) |
| `flux-i2i` | `flux-2/flex-image-to-image` | [flux-2 flex i2i](https://docs.kie.ai/market/flux2/flex-image-to-image.md) |
| `flux-pro-i2i` | `flux-2/pro-image-to-image` | [flux-2 pro i2i](https://docs.kie.ai/market/flux2/pro-image-to-image.md) |
| `grok` | `grok-imagine/text-to-image` | [grok t2i](https://docs.kie.ai/market/grok-imagine/text-to-image.md) |
| `grok-i2i` | `grok-imagine/image-to-image` | [grok i2i](https://docs.kie.ai/market/grok-imagine/image-to-image.md) |
| ~~`grok-upscale`~~ | ~~`grok-imagine/upscale`~~ | **RETIRED 2026-10-29** — that endpoint upscales a Grok VIDEO task ("task_id must be a successful grok-imagine/text-to-video or image-to-video task"); KIE has no Grok image upscale. A Grok video upscale would be a video-upscale provider. |
| `gpt-image` | `gpt-image/1.5-text-to-image` | [gpt-image 1.5 t2i](https://docs.kie.ai/market/gpt-image/1-5-text-to-image.md) |
| `gpt-image-i2i` | `gpt-image/1.5-image-to-image` | [gpt-image 1.5 i2i](https://docs.kie.ai/market/gpt-image/1-5-image-to-image.md) |
| `gpt-image-2` | `gpt-image-2-text-to-image` | [gpt-image 2 t2i](https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image.md) |
| `gpt-image-2-i2i` | `gpt-image-2-image-to-image` | [gpt-image 2 i2i](https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image.md) |
| `gpt-image-2-6-flare` | `gpt-image-2-6/flare-text-to-image` | [gpt-image 2.6 flare t2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-text-to-image.md) |
| `gpt-image-2-6-flare-i2i` | `gpt-image-2-6/flare-image-to-image` | [gpt-image 2.6 flare i2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-image-to-image.md) |
| `gpt-image-2-6-sunburst` | `gpt-image-2-6/sunburst-text-to-image` | [gpt-image 2.6 sunburst t2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-sunburst-text-to-image.md) |
| `gpt-image-2-6-sunburst-i2i` | `gpt-image-2-6/sunburst-image-to-image` | [gpt-image 2.6 sunburst i2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-sunburst-image-to-image.md) |
| `gpt-image-2-6-economy` | `gpt-image-2-6/economy-text-to-image` | [gpt-image 2.6 economy t2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-economy-text-to-image.md) |
| `gpt-image-2-6-economy-i2i` | `gpt-image-2-6/economy-image-to-image` | [gpt-image 2.6 economy i2i](https://docs.kie.ai/market/gpt/gpt-image-2-6-economy-image-to-image.md) |
| `imagen4` | `google/imagen4` | [imagen4](https://docs.kie.ai/market/google/imagen4.md) |
| `imagen4-fast` | `google/imagen4-fast` | [imagen4-fast](https://docs.kie.ai/market/google/imagen4-fast.md) |
| `imagen4-ultra` | `google/imagen4-ultra` | [imagen4-ultra](https://docs.kie.ai/market/google/imagen4-ultra.md) |
| ~~`ideogram`~~ | ~~`ideogram/character`~~ | **REMOVED** — v2 model, unreliable, requires reference_image_urls |
| `ideogram-edit` | `ideogram/character-edit` | [ideogram edit](https://docs.kie.ai/market/ideogram/character-edit.md) |
| `ideogram-remix` | `ideogram/character-remix` | [ideogram remix](https://docs.kie.ai/market/ideogram/character-remix.md) |
| `qwen` | `qwen/text-to-image` | [qwen t2i](https://docs.kie.ai/market/qwen/text-to-image.md) |
| `qwen-i2i` | `qwen/image-to-image` | [qwen i2i](https://docs.kie.ai/market/qwen/image-to-image.md) |
| `qwen-edit` | `qwen/image-edit` | [qwen edit](https://docs.kie.ai/market/qwen/image-edit.md) |
| `seedream` | `seedream/4.5-text-to-image` | [seedream 4.5 t2i](https://docs.kie.ai/market/seedream/4.5-text-to-image.md) |
| `seedream-edit` | `seedream/4.5-edit` | [seedream 4.5 edit](https://docs.kie.ai/market/seedream/4.5-edit.md) |
| `seedream-5-lite` | `seedream/5-lite-text-to-image` | [seedream 5 lite t2i](https://docs.kie.ai/market/seedream/5-lite-text-to-image.md) |
| `seedream-5-lite-i2i` | `seedream/5-lite-image-to-image` | [seedream 5 lite i2i](https://docs.kie.ai/market/seedream-5-lite-image-to-image.md) |
| `seedream-5-pro` | `seedream/5-pro-text-to-image` | [seedream 5 pro t2i](https://docs.kie.ai/market/seedream/5-pro-text-to-image.md) |
| `seedream-5-pro-i2i` | `seedream/5-pro-image-to-image` | [seedream 5 pro i2i](https://docs.kie.ai/market/seedream/5-pro-image-to-image.md) |
| `seedream-5-flash` | `seedream/5-flash-text-to-image` | [seedream 5 flash t2i](https://docs.kie.ai/market/seedream/5-flash-text-to-image.md) |
| `seedream-5-flash-i2i` | `seedream/5-flash-image-to-image` | [seedream 5 flash i2i](https://docs.kie.ai/market/seedream/5-flash-image-to-image.md) |
| `z-image` | `z-image` | [z-image](https://docs.kie.ai/market/z-image/z-image.md) |
| ~~`topaz-image-upscale`~~ | ~~`topaz/image-upscale`~~ | **RETIRED 2026-10-25** — runs on Replicate (`providers/replicate/topaz.ts`); config kept for the credit audit, `KIE_RETIRED_MODEL_KEYS` keeps it out of routing |
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
| `minimax-h3` | `minimax-h3/image-to-video` (swaps to `minimax-h3/reference-to-video` when refs are wired — see `minimaxH3TaskModel`) | [minimax-h3 i2v](https://docs.kie.ai/market/minimax-h3/image-to-video.md) / [r2v](https://docs.kie.ai/market/minimax-h3/reference-to-video.md) |
| `wan-3` | `wan/3-0-video` (bespoke `runWan3`) | [wan 3.0](https://docs.kie.ai/market/wan/3-0-video.md) |
| `wan-3-prime` | `wan/3-0-video-prime` (bespoke `runWan3`) | [wan 3.0 prime](https://docs.kie.ai/market/wan/3-0-video-prime.md) |
| `vidu-q4` | `vidu-q4/image-to-video` (bespoke `runViduQ4`; swaps to `vidu-q4/reference-to-video` — `VIDU_Q4_REFERENCE_MODEL` — when a reference image or audio is wired). No t2v entry: KIE has no Q4 text-to-video. | [vidu q4 i2v](https://docs.kie.ai/market/vidu-q4/image-to-video.md) / [r2v](https://docs.kie.ai/market/vidu-q4/reference-to-video.md) |
| `kling-4` | `kling-4.0/reference-to-video` (bespoke `runKling4`, body from `kling4.ts`) | [kling 4.0 reference](https://docs.kie.ai/market/kling/v4-reference-to-video.md) |
| `kling-4-keyframes` | `kling-4.0/keyframe-to-video` (bespoke `runKling4`) | [kling 4.0 keyframe](https://docs.kie.ai/market/kling/v4-keyframe-to-video.md) |
| `gemini-omni-flash` | `google/gemini-omni-flash-1-1` (via `runGeminiOmni`; the pro sibling's id is the bare `gemini-omni-video`) | [gemini omni flash](https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md) |
| `gemini-omni-flash-1-2` | `google/gemini-omni-flash-1-2` (bespoke `runGeminiOmni12`, body from `gemini-omni-12.ts`) | [gemini omni flash 1.2](https://docs.kie.ai/market/google/gemini-omni-flash-1-2.md) |
| `gemini-omni-video` | `gemini-omni-video` (via `runGeminiOmni`; the pro sibling of flash) | [gemini omni video](https://docs.kie.ai/market/gemini-omni-video.md) |
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
| `minimax-h3` | `minimax-h3/text-to-video` (swaps to `minimax-h3/reference-to-video` when refs are wired) | [minimax-h3 t2v](https://docs.kie.ai/market/minimax-h3/text-to-video.md) |
| `wan-3` | `wan/3-0-video` (ONE KIE id serves both modes) | [wan 3.0](https://docs.kie.ai/market/wan/3-0-video.md) |
| `wan-3-prime` | `wan/3-0-video-prime` (ONE KIE id serves both modes) | [wan 3.0 prime](https://docs.kie.ai/market/wan/3-0-video-prime.md) |
| `kling-4` | `kling-4.0/reference-to-video` (ONE KIE id serves both modes) | [kling 4.0 reference](https://docs.kie.ai/market/kling/v4-reference-to-video.md) |
| `kling-4-keyframes` | `kling-4.0/keyframe-to-video` (ONE KIE id serves both modes) | [kling 4.0 keyframe](https://docs.kie.ai/market/kling/v4-keyframe-to-video.md) |
| `gemini-omni-flash` | `google/gemini-omni-flash-1-1` (ONE KIE id serves both modes) | [gemini omni flash](https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md) |
| `gemini-omni-flash-1-2` | `google/gemini-omni-flash-1-2` (ONE KIE id serves every mode) | [gemini omni flash 1.2](https://docs.kie.ai/market/google/gemini-omni-flash-1-2.md) |
| `gemini-omni-video` | `gemini-omni-video` (ONE KIE id serves both modes) | [gemini omni video](https://docs.kie.ai/market/gemini-omni-video.md) |
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
| ~~`topaz` (upscale)~~ | ~~`topaz/video-upscale`~~ | **RETIRED 2026-10-25** — runs on Replicate (`providers/replicate/topaz.ts`); config kept for the credit audit |
| `kling-avatar` | `kling/ai-avatar-standard` | [kling avatar std](https://docs.kie.ai/market/kling/ai-avatar-standard.md) |
| `kling-avatar-pro` | `kling/ai-avatar-pro` | [kling avatar pro](https://docs.kie.ai/market/kling/ai-avatar-pro.md) |
| `infinitalk` | `infinitalk/from-audio` | [infinitalk](https://docs.kie.ai/market/infinitalk/from-audio.md) |
| `omnihuman-1-5` | `omnihuman-1-5` | [omnihuman 1.5](https://kie.ai/model/omnihuman-1-5.md) |
| `suno` (music) | `suno/v4` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v5` (music) | `suno/v5` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v5_5` (music) | `suno/v5_5` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v6` / `suno-v6_wild` / `suno-v6_mini` (music — current family, V6 = default; the earlier versions stay offered and KIE still serves them even though its docs tag them "Discontinued") | `suno/v6` / `suno/v6_wild` / `suno/v6_mini` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `elevenlabs-turbo` | `elevenlabs/text-to-speech-turbo-2-5` | [11labs turbo](https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5.md) |
| `elevenlabs-multilingual` | `elevenlabs/text-to-speech-multilingual-v2` | [11labs multilingual](https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2.md) |
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
  `nsfw_checker` are deliberately never emitted **on the Wan wire**. `-1` IS
  emitted platform-wide only by the Seedance 2.5 edit-mode resubmit below, and
  its recovery-lane twin (`lib/reconcile/seedance-edit-resubmit.ts`).

### Vidu Q4 wire notes (`vidu-q4`, bespoke `runViduQ4`)

ONE Nodaro id over two KIE endpoints, picked by what is wired. KIE has NO Q4
text-to-video and NO start/end-frame mode (both 404), so the catalog's `modes`
is `["i2v"]` (the derived `VIDEO_PROVIDERS_REQUIRING_IMAGE` gates prompt-only
runs) and it declares no `end-frame`.

- **Start frame, no references** → `vidu-q4/image-to-video`:
  `{ image_url, prompt?, duration, resolution, audio }`. NO `aspect_ratio` —
  the output inherits the frame's shape. The prompt is optional and is OMITTED
  when empty (no platform default text).
- **Any reference image or reference audio** → `vidu-q4/reference-to-video`:
  `{ prompt, reference_image_urls (1-15), reference_audio_urls? (≤3),
  aspect_ratio (16:9 default / 9:16 / 1:1 / 4:3 / 3:4), duration, resolution,
  audio }`. A wired start frame is demoted into `reference_image_urls` by
  `resolveSeedance2Inputs` (after the caller's own images, bound in prose).
  `videos: 0` overrides the Seedance base limits, so `reference_video_urls` is
  never emitted.
- Both schemas are `additionalProperties: false`: the body is an explicit
  allow-list — no `extraParams` spread, no `seed` (`omitSeed`), no end frame
  (an end frame reaching the provider is logged and dropped).
- `duration` is an **integer** 3-16 (default 5). `resolution` is the
  **lowercase** enum `540p` / `720p` / `1080p` / `2k` / `4k`;
  `normalizeViduQ4Resolution` (`@nodaro/shared`) folds case and collapses
  anything else to **720p**, and `buildVideoCreditModelIdentifier` bills
  through the same function, so render == billed for every spelling.
- `audio` (boolean, KIE default true) is the native-audio lever — the
  `field: "audio"` branch of `applyVideoAudioToggle`.
- A reference-mode run needs a non-empty prompt and at least one image:
  `lib/vidu-q4-inputs.ts :: viduQ4InputProblem` refuses it in the route and
  the payload builder BEFORE the reservation; the runner throw is a backstop.
- Reference audio is **MP3 only, 3-12 s each** (`VIDEO_REF_AUDIO_RULES`):
  `lib/ref-audio-probe.ts` ffprobes format + length and refuses anything else
  in the route preHandler and the DAG's `executeWorkerNode` gate. Nothing
  converts a WAV/M4A clip for it — a converter is a follow-up.
- Pricing is ONE per-second `vidu-q4:<N>s:<res>` ladder for both endpoints and
  for audio on/off (no `-ref`, no `:audio`). The 4k rows are closed to the free
  tier (`blockedModels`, derived from the duration tiers).

### Kling 4.0 wire notes (`kling-4` / `kling-4-keyframes`, bespoke `runKling4`)

Two Nodaro ids, one per KIE endpoint; both run with no image (text-to-video),
so each is in BOTH model maps. The bodies are built by the pure
`buildKling4Request` (`kling4.ts`) and `runKling4` normalizes every image
afterwards (300-65536 px per side, aspect 0.4-2.5, our 2048 px cap).

- Both schemas are `additionalProperties: false`: explicit allow-list, INTEGER
  `duration` 3-30, lowercase `resolution` via `normalizeKling4Resolution`
  (`720p` / `1080p`, anything else → 720p, billed the same), no seed, no audio
  lever (native audio always on). `aspect_ratio` (`auto` / `16:9` / `9:16` /
  `1:1` / `21:9`) is sent on reference runs, and on keyframe runs only when no
  frame is attached (the output follows the start frame otherwise).
- **Names are the whole risk.** KIE refuses a prompt that mentions a material
  the request does not carry ("prompt references undeclared material @image_1",
  a 422, live 2026-10-23). The builder maps the platform's numbering onto
  Kling's — reference: a character's seat `@image_N` → its subject `@Name`
  (`elements`, 2-4 images, `tag: "character"`; one-image characters stay images),
  `@audio_N` → `@VoiceN` (`voices`); keyframes: `@image_N` → `@keyframe_N` —
  then strips the `@` from every mention left undeclared. The sweep test in
  `__tests__/kling4.test.ts` holds "every mention is declared".
- Reference: a start/end frame joins `image_urls` after the caller's own
  (`placeFramesAfterReferences`). `keep_original_sound` is sent only with
  `video_urls`. 15 materials in all (images + videos + subjects + voices) —
  `lib/kling4-inputs.ts` refuses more before the reservation.
- **Reference videos are shrunk to fit `KLING_4_REF_VIDEO_LIMIT`** — a long
  side of 2048 px AND no more pixels than 1920×1080, shape kept
  (`reference-video-size.ts`, called from `runKling4`). KIE ACCEPTS an
  over-size clip and fails the task ~40 s later with a bare `[400] Generation
  failed. Please try again later.` — measured 2026-10-26 on one body, only the
  clip changed: 2568×1080 failed, 2048×862 and 1920×1080 rendered. Those runs
  cannot tell a long-side limit from a pixel-count one, so the clip is kept
  inside both sizes that rendered (4K 16:9 → 1920×1080); widen only with a
  probe. The docs state no pixel limit. Length is untouched, so the
  reference-video billing is unchanged.
- Keyframes: `first_frame_url` / `keyframe_urls` (Image References, in order,
  max 8) / `last_frame_url`; total frames capped by duration
  (`kling4KeyframeFrameCap`: 3s → 4 … 9s or longer → 10 — live 422 "duration 3s
  allows at most 4 frames (first + keyframes + last), got 5"). The route and
  the DAG refuse an over-cap run; the builder trims as a backstop.
- **Billing:** per second (KIE 28.5 cr/s @720p, 42.5 @1080p — live-billed 85.5
  for 3s). With a reference video KIE bills 17 / 25.5 cr/s over output +
  max(output, Σ input seconds) — live: 5s out + a 4.04s clip = 170. The
  reservation and settlement reuse the Seedance machinery
  (`billsReferenceVideoSeconds`, `billedRefVideoSeconds` in
  `ee/billing/seedance2-ref-video-credits.ts`); subjects and voices are free.

### Gemini Omni Flash 1.2 wire notes (`gemini-omni-flash-1-2`, bespoke `runGeminiOmni12`)

One KIE id, four modes picked by the inputs. It is in `GEMINI_OMNI_PROVIDERS` for
the family's routing, and `GEMINI_OMNI_PER_SECOND_PROVIDERS` is what separates its
price and billing from 1.1's. `buildGeminiOmni12Request` (`gemini-omni-12.ts`)
builds an allow-listed body:

- **Text or references:** `image_urls` (up to 6; `images + 2 for a video ≤ 7`),
  integer `duration` 3-15.
- **Frames:** only a start frame (and an end frame) wired → `first_frame_url` /
  `last_frame_url`. KIE takes no other image beside them, no lone last frame, and
  first + last holds only up to 10 s. Anything else wired, or a lone end frame, or
  first + last past 10 s: the frames join `image_urls` after the caller's own
  images (`placeFramesAfterReferences`), named in the prompt in plain words
  (`referenceSyntax: "image N"`: "image 3 is the opening (first) frame of the
  video. image 1 and image 2 are references for the subject; they are not
  frames."). There the frame only GUIDES the clip: staging runs (2026-11-10)
  never opened on it, in this wording or the `@image_N` one, and KIE's schema
  says `image_urls` is not a first frame. Only the real-frame mode is exact; the
  editor's `FramesAndReferencesTip` and the docs say so.
- **Video edit:** `video_list` is one plain URL, up to 15 s, and `duration` must
  not be sent; the output follows the clip. KIE has no trim fields, so
  `prepareGeminiOmni12Source` cuts the clip (the node's trim, else its first 15 s)
  into the job's scratch folder.
- **`auto`:** KIE reads it as 16:9 when no reference image is sent, so beside real
  frames the runner sends the ratio nearest the start frame
  (`geminiOmni12FrameAspect`, the rule the frame fit already uses).
- `seeds`, not `seed`, 10000-99999: an out-of-range value is omitted. No
  `character_ids` or `audio_ids`, so characters and pinned voices are refused.
- **Billing:** a `:<N>s:<res>` ladder, one row per second and resolution. An edit
  bills the same rows over the clip's length: it joins `billsReferenceVideoSeconds`
  (`billedRefVideoSeconds`: output alone, which follows the clip), so the routes,
  the DAG and the quotes all read the probed clip, cut by the node's trim
  (`videoRefBilledDurations`, `lib/gemini-omni-12-source.ts`). The hold is the
  clip's price, so nothing settles down after the run, except a clip the hold
  could not read, which settles on the clip delivered. A clip under 3 s bills
  the 3 s row.

### Seedance 2.5 edit mode (`runVideoTaskWithSeedanceEditRetry`, video.ts)

A THIRD Seedance shape rule, on top of the frame-mode 422
(`FRAME_MODE_ADAPTIVE_ONLY_ASPECT`) and the catalog aspect snap — and the only
one that cannot be applied before the call.

With a reference video wired, Seedance classifies the run from the **prompt**:
ordinary generation-with-a-reference, or an **edit** of that clip. In edit mode
the output inherits the clip's shape, and KIE rejects any explicit ratio or
duration — "`ratio` must be `adaptive`. [1] `duration` must be -1", prefaced by
"Seedance identified your task as video editing based on your prompt".

The verdict is not derivable from the payload: the same node, same video, a
reworded sentence, and it is a style run where a concrete ratio and duration are
legal. So coercing on "a video is attached" would silently discard the user's
chosen shape on every style run. We believe the provider instead —
`isSeedance2EditModeRejection` recognises that message and the run is resubmitted
ONCE with `SEEDANCE_2_EDIT_MODE_PARAMS`. Gated on the provider AND the provider's
own words; every other model keeps plain `runKieTask` behaviour. The retry
returns `sentInput` so the credit audit reports the body that actually billed.

**Billing:** commit can only refund, so the reservation is the WORST CASE and the
commit is measured. `seedance2RefVideoBaseCreditsFromDurations` (ee/billing)
bills the output at the longer of the requested duration and the longest
reference clip (an unusable probe = the provider's per-clip cap, 30s on 2.5; the
summed input capped at `maxTotalSec`). Both reservation lanes carry their probe
on the job as `refVideoDurationsSec` (`input_data` + the queue payload). After
delivery the i2v/t2v handlers — and the reconcile cron's generic recovery — call
`measureSeedance2RefVideoBaseCredits` (`lib/seedance2-ref-video-settle.ts`, a
core shim over the ee helper), which ffprobes ONLY the RAW provider output,
prices the input side from the stored probe (re-probing only a job that carries
none), and hands the exact `unit × (input + delivered)` base to
`finalizeJobWithMedia` as `meteredBaseCredits` — committed count-based, marked
up ONCE at the usage log's identifier through `applyServiceMarkup` (the same
per-service-margin helper the reservation used, so reserve and commit share a
basis), clamped at the reservation, no anomaly filed for settling below it, and
parked in `held_completion_fields` so a review approve replays it
(`heldCommitArgs` is the one mapping both use). A style run is refunded to its
requested duration; an edit of a 30s clip from a node set to 12s pays for 30s.
An unmeasurable delivery commits the reservation.

**Reference videos are re-encoded (`reference-video-reencode.ts`).** Both
Seedance branches of `KieVideoProvider` (i2v + t2v) swap the prepared body's
`reference_video_urls` for re-encoded copies AFTER `applySeedance2Params` and
BEFORE `runVideoTaskWithSeedanceEditRetry` (one encode; the resubmit reuses
it). A clip Seedance produced, sent byte for byte as an edit's source, comes
back as a near-copy of its input; any re-encode of the same footage is edited.
The copy keeps every frame (`-fps_mode passthrough`, no trim/scale/filter),
the source's picture bitrate (two-pass; CRF 14 when unknown), 8-bit pixel
format and colour tags, MOV for a QuickTime source, the sound copied when the
container plays it (else AAC), and the model's size cap (`referenceVideoMaxBytes`:
200 MB on `seedance-2-5`, 50 MB on the 2.0 family) only bites on a source
already over it (or a two-pass overshoot past it). Clips are encoded in
parallel, and a failure waits for every sibling to finish before it fails
the run. A failure fails the run
(sanitized error → refund) — never a fallback to the original URL. Every
clip goes through it, plugin-prepared ones included (format-preserving, so a
4:4:4 PCM MOV stays one). A test that drives the provider with
`referenceVideoUrls` must mock the module (pass-through), or it downloads.

`gemini-omni-flash` shares the pro sibling's request shape through
`runGeminiOmni`, with one difference: its schema marks `duration` **required**,
so the emitted body always carries it (`requiresDuration` on the model config).

**Gemini Omni character references (`characterReferences` → `character_ids`).**
`image_urls` is, per KIE, loose "reference images for characters, scenes, styles,
or storyboard guidance" and does NOT hold a face; the dedicated identity input is
`character_ids` (max 3, drawn from the SAME 7-unit quota: images + videos×2 +
character_ids ≤ 7). Ids come from a **non-task, synchronous** endpoint,
`POST /api/v1/omni/character/create` (`omni-character.ts`, own module so the
mocked `client.ts` can never hide a character failure): body `{ descriptions,
image_urls: [portrait, body?], character_name? }` → `data.characterId`. No price
and no validity period are documented, so: no credit charge is added; ids are
cached 24h in Redis (`kie:omni-character:<sha256 of imageUrl|bodyImageUrl|
description|name>`, in-process LRU if Redis is down), and a CACHED id that KIE
rejects (`isInvalidOmniCharacterError`, matched on `internalDetails` — the
sanitized message never carries KIE's words) is forgotten, recreated ONCE and the
task resubmitted. A create failure fails the job — never a fallback to
`image_urls`. The create call goes through `providerFetch` (egress seam,
`operation: "omni.character.create"`, OUR model key threaded); the video task
reports the count as the `characterRefs` egress dimension. Public API:
`characterReferences` (provider-neutral; KIE ids never leave this module), gated
by the data-driven `characters` cap in `VIDEO_REF_LIMITS_BY_PROVIDER`.
**Unverified against the live API** (no probe has been run): KIE's schema says
`descriptions` while its JSON example says `description` (flip the single
`DESCRIPTION_FIELD` constant if a live create disagrees), its note says
`image_urls` takes "only 1 image" while the schema allows 2 (a `bodyImageUrl`
request may fail if the note is the real rule), and the stale-id wording is a
guess. Nodaro does not send `first_frame_url` for Gemini (the start frame rides
`image_urls[0]`), so the route's start-frame 400 is OUR limit, not a KIE
exclusivity. `gemini-omni-audio` (`audio_ids`) takes preset voice names only —
it cannot carry a real speaker's recording; a real voice goes through
`video_list` (a black video carrying it).

**Pinned voice persona (`characterReferences[].voice`).** To keep ONE voice across
clips, a reference may carry `voice: { preset, description?, exampleLine? }`.
`omni-character.ts` mints a persona via the synchronous
`POST /api/v1/omni/audio/create` (`{ audio_id: <one of 30 presets>, name,
voice_description?, example_dialogue? }` → `data.audioId` (live; the doc example
shows `kieAudioId`, accepted second; no id at all = deterministic, non-retryable
failure). The doc example shows envelope `code: 0` while the character endpoint shows `200` — BOTH are
accepted, any other code fails; `operation: "omni.audio.create"` through
`providerFetch`, OUR model key). The id rides TWICE: the character create's
`audio_ids` and the video task's `audio_ids` (de-duplicated, max 3 =
`voices` cap in `VIDEO_REF_LIMITS_BY_PROVIDER`; NOT part of the 7-unit quota).
Cache: `kie:omni-audio:<sha256 of preset|description|exampleLine|name>` 24h, same
Redis + in-process fallback as characters; the CHARACTER key gains the voice
dimension only when a voice is present (an unvoiced reference keeps its old key,
and a voiced and an unvoiced character never share an id). The audio persona is
resolved for every voiced reference even on a character cache hit — the video
request needs the id. A stale-id retry forgets both entries
(`isInvalidOmniAudioError`, narrow, on `internalDetails`). The voice
`description` goes through the character-reference policy funnel
(`character-reference-policy.ts`); the `exampleLine` and `name` do not. A voice
create failure fails the job — never a silent unvoiced fallback. **Unverified
live:** whether a pinned persona actually holds one voice across clips, and the
envelope code on the audio endpoint (0 per its doc).


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
| Single URL string | minimax, kling-turbo, kling-avatar, topaz, ideogram-edit, ideogram-remix, qwen-i2i, qwen-edit, topaz-image-upscale | `image_url` |
| Array of URLs | kling, grok, sora2-pro, flux, gpt-image, nano-banana-edit, seedream-edit, nano-banana-2-lite (up to 10, NOT the family's `image_input`), seedream-5-flash-i2i (up to 10, not the family's 16) | `image_urls` or `input_urls` |
| VEO array | veo3, veo3.1 | `imageUrls` (camelCase!) |
| Video URL | wan v2v | `video_urls` (array) |
| Video URL | topaz upscale | `video_url` (string) |
| Task ID | grok-2-edit, grok-2-segment | `task_id` (NOT an image URL — requires a prior grok-2 generation) |
| Reference images (T2I) | nano-banana-pro, others | `image_input` |

Check `imageParam` in `models.ts` for the authoritative mapping.

### Aspect Ratio / Size Parameter Names

Not all models use `aspect_ratio` — getting this wrong causes silent failures (default aspect used):

| Param Name | Models | Values | Notes |
|------------|--------|--------|-------|
| `image_size` (ratio) | nano-banana, nano-banana-edit | `"1:1"`, `"16:9"`, etc. | Nano Banana base uses ratio strings as `image_size` |
| `aspect_ratio` (ratio) | nano-banana-pro, flux, grok, gpt-image, imagen4, seedream, z-image, nano-banana-2-lite and nano-banana-2-1 (both also `auto` + banner ratios 8:1/1:8/4:1/1:4) | `"1:1"`, `"16:9"`, etc. — **per model, NOT a shared set** | Standard param name |

**The allowed ratios differ sharply per model — read `MODEL_CATALOG[...].aspectRatios`, never assume 16:9 exists.** `gpt-image` (GPT Image 1.5) accepts only `1:1 / 3:2 / 2:3` and has NO `resolution` lever at all, while its `gpt-image-2` sibling accepts `auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4` plus 1K–4K. Sending a ratio the model doesn't list returns a KIE error that `client.ts` surfaces as "Invalid aspect ratio setting" — and inside a workflow run that aborts every sibling node's results too. `normalizeModelInput` (`@nodaro/shared`) coerces a stale pair at the write and run boundaries; it derives entirely from the catalog, so a new model is covered by declaring `aspectRatios` honestly and nothing else.
| `image_size` (named) | ideogram, qwen | `"square"`, `"landscape_16_9"`, etc. | Named values, NOT ratios! `image.ts` converts at runtime |
| *(none)* | grok-i2i, recraft-*, grok-2-edit, grok-2-segment | — | No aspect ratio control |

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
| Nano Banana 2.1 | `resolution` | `"1K"`, `"2K"`, `"4K"` |
| Nano Banana 2 Lite | Not supported — 1K ONLY (no resolution param; `image.ts` strips stale values) | — |
| GPT Image 2 (T2I + I2I) | `resolution` | `"1K"`, `"2K"`, `"4K"` at every ratio it offers, `auto` and 1:1 included (checked 2026-11-10; older docs limited `auto` to 1K and 1:1 to 2K) |
| Flux (all variants) | `resolution` | `"1K"`, `"2K"` |
| Seedream 5 Flash (T2I + I2I) | **`size`** — our `resolution`, renamed on the wire by `resolutionParam: "size"` in `models.ts` (`image.ts` `applyResolutionParam`, both lanes) | `"1K"`, `"2K"` offered (schema also has `"1.5K"`, not offered); flat price at every size |
| Other image models | Not supported | — |

### quality Support

| Models | Param | Values |
|--------|-------|--------|
| GPT Image 1.5 (T2I + I2I) | `quality` | `"medium"`, `"high"` |
| GPT Image 2 (T2I + I2I) | Not supported (uses `resolution` instead) | — |
| GPT Image 2.6 Flare, Sunburst (T2I + I2I) | `quality` | `"auto"`, `"low"`, `"medium"` (default), `"high"`, `"xhigh"`, `"max"`. Billed by tokens, with `resolution` beside it (a GIF: its band of frames instead) |
| Seedream 4.5 (T2I + Edit) | `quality` | `"basic"` (2K), `"high"` (4K) |
| Seedream 5 Lite (T2I + I2I) | `quality` | `"basic"` (2K), `"high"` (4K) |
| Seedream 5 Pro (T2I + I2I) | `quality` | `"basic"` (1K), `"high"` (2K) — note: one tier LOWER than Lite/4.5 |
| Seedream 5 Flash (T2I + I2I) | Not supported — NO `quality` input (the lever is `size`, see above). A `"quality":"basic"` appears only in the doc's callback `param` echo | — |
| Other image models | Not supported | — |

### negative_prompt Support

`image.ts` uses `NATIVE_NEGATIVE_PROMPT_MODELS` set to decide: models in the set get `negative_prompt` as a native API param; all others have it stripped from the request (frontend appends "Avoid: ..." to the prompt text instead).

| Models | Param | Max Length | Implementation |
|--------|-------|-----------|----------------|
| Imagen4 family | `negative_prompt` | 5000 chars | Native (sent as API param) |
| Ideogram (character, remix) | `negative_prompt` | 500 chars | Native (sent as API param) |
| Qwen (T2I, edit) | `negative_prompt` | 500 chars | Native (sent as API param) |
| Other models | Not natively supported | — | Frontend appends "Avoid: ..." to prompt text |

### GPT Image 2.6 wire notes

Six SKUs on the standard `createTask` lane. Flare and Sunburst are billed by
**tokens**, Economy flat per image (5 KIE credits, 1K only).

- Prices are the 1:1 estimate on the product page in
  `ee/billing/gpt-image-2-6-pricing.ts`: one row per quality and size, and on an
  edit per input image too (`:<N>ref`). **Measured 2026-11-09 on real runs:** 1:1
  is the dearest shape (2:1 and 16:9 at medium 1K cost well under it, whatever
  their pixels); bills came within 1% of the table by size, shape and quality;
  each input image cost 1.8 to 2.2 KIE credits (the rows use 2.2).
  `costFromTaskRecord` makes the job record the task's own `creditsConsumed` as
  `provider_cost`, and the figure is present on 2.6 task records.
- **Economy is withheld (2026-11-09).** Every task fails within a millisecond with
  `[500] Internal Error`, in text-to-image and edit, at several shapes, and on
  KIE's own playground too. Migration 611 turned off the two ids'
  `model_pricing.is_enabled`, which hides them from `/v1/models`, MCP `list_models`
  and every menu, and refuses a run with `model_disabled`. When KIE fixes it, turn
  the two rows on at /admin/models; then drop `docsHidden` from the two catalog
  entries and restore their rows in the docs.
- **Quality `auto`** (KIE picks the level): the only metered quality. Reserved at
  the Max row (`:auto:` ids hold the Max value), then settled on the task's own
  `creditsConsumed`: `autoQualityKieCredits` on the result, `gptImage26AutoSettledBase`
  (`lib/gpt-image-2-6-settle.ts`), handed to `meteredBaseCredits` in
  `finalizeJobWithMedia` (held runs replay it) and to the entity tail; the KIE
  reconcile lane does the same. A task record with no figure commits the
  reservation, the Max price, with an `[ALERT]` line. In the one live run tried
  (2026-11-09) KIE picked low and the run was charged that, not the Max it held.
- 27:16, 16:27, 9:8 and 8:9, 2.5's extra ratios, are refused on 2.6 ("Invalid aspect
  ratio", no charge, tried 2026-11-09). KIE's docs don't list them either. On 2.5
  they render **1K only** (the `aspect_ratio` field of all four 2.5 pages: "The
  27:16, 16:27, 9:8 and 8:9 aspect ratios support 1K only. 2K and 4K are available
  for other aspect ratios."). `resolutionsByAspectRatio` on the four 2.5 catalog
  entries says so; `normalizeModelInput` moves 2K/4K there to 1K before pricing,
  and the Reference Board (which prices without it) reads `resolutionAtAspectRatio`.
- **2.6's own `aspect_ratio: "auto"` renders square** whatever the photo (2026-11-10:
  a 768x1024 source came back 1024x1024 on Flare; 2.5 Flare kept it at 880x1184).
  The six 2.6 catalog entries keep `auto` on offer but carry
  `autoAspectFromSourceImage`, so "auto" with a photo is sent as the 2.6 ratio
  nearest it (`autoAspectNeedsSourceImage` → the routes' and the workflow's photo
  probe). Only a request with no photo, or one whose size cannot be read, still
  sends `auto`.
- Up to 16 input images on Flare and Sunburst; the routes hold every other model to
  14 (`requestImageLimit`, separate from `REF_IMAGE_MAX_LIMITS`).
- All six 2.6 models send an explicit field list (`inputFields` in `models.ts`):
  their schemas are `additionalProperties: false`, and a worker passes along
  whatever a node carries. A new setting joins the list with the feature.
- The KIE record is `{ code, message, data }`: `creditsConsumed` sits in `data`
  (`kieTaskCreditsConsumed`).
- `background` (`auto`, `opaque`, `transparent`) also exists on GPT Image 2.5, where
  KIE takes it only at 1K, whatever its value
  (`backgroundOnlyAtTransparentResolution`): nothing is sent above it. KIE limits transparent to 1K (`transparentResolution` on the catalog entry,
  coerced in `normalizeModelInput`). Economy is 1K anyway. **GPT Image 2 has no
  background setting here**, though KIE's docs list one: transparent failed twice
  with `[500] Internal Error` on 2026-11-09, while opaque and no value rendered, and
  opaque or auto alone is no reason to offer it. A value sent to it is dropped.
- `moderation` (`auto`, `low`; Flare and Sunburst only) is not sent, so KIE's
  default `low` applies. It is declared as a `choice` lever so the Admin → Provider
  Safety page can tighten it to `auto`.
- **`output_format`** (`png`, `jpeg`, `webp`, `gif`, `svg`; Economy `png`/`gif` from a
  prompt, `png` from an edit). The field list is per format (`inputFieldsByFormat`,
  read off the FINAL config after the t2i → i2i swap), and `applyOutputFormat`
  (`image.ts`) shapes the levers:
  - PNG sends no `output_format` at all, so a PNG request is what it was before.
  - JPEG and WebP add `output_format` only; `output_compression` is never sent.
  - GIF: `frame_count` (2–16, KIE's default 9) and `frame_duration_ms` (20–2000,
    step 10, default 200); no `aspect_ratio`, `resolution` or `mask_url`. The
    text-to-image schema has `size` (per-frame size): always `512x512`. **The
    image-to-image schema has no `size` field** (`additionalProperties: false`),
    so an edit's GIF sends none and its frame size is read from the stored file.
    KIE's docs say transparent works with GIF too; the platform moves it to `auto`
    (a decision, `TRANSPARENT_OUTPUT_FORMATS` = png, webp).
  - SVG: `svg: { model }`, the writer per level: Standard `gpt-5.6-luna`, Detailed
    `gpt-5.6-terra`, Max `gpt-6-sol` (`GPT_IMAGE_2_6_SVG_AUTHOR_MODELS`); no GIF
    fields, no `background`, no `mask_url`. `aspect_ratio` + `resolution` size it as
    for PNG.
  - Economy's GIF takes `frame_count` as a STRING enum (`auto`, `4`, `9`, `16`,
    `25`, `36`, `64`; `gifFrameCountAsString`), the catalog offers 4, 9 and 16, and
    takes no ratio, size or quality. Economy's GIF is UNMEASURED and priced at its
    flat row: measure it before Economy is switched back on.
  - Prices: a GIF by quality and band of frames (2–8, 9–12, 13–16; measured
    2026-11-10, independent of content), an SVG as the PNG row plus a per-level
    amount (the busiest drawing measured); `gpt-image-2-6-pricing.ts`. PNG, JPEG
    and WebP share the PNG rows.
  - The result is stored as its bytes are (`lib/image-output-store.ts`): `.jpg`,
    `.webp`, `.gif`, `.svg`, an SVG sanitized first (`lib/svg-sanitize.ts`; a
    refused one fails the job, refunded), a PNG still of a GIF or SVG as
    `thumbnailUrl`. A mask with GIF or SVG is a 400 at the routes.
- Not wired yet: `mask_url`, `markup`, `complexity`, `output_compression`.
- `prompt` is documented up to 32,000 characters on Flare and Sunburst; the routes
  stop at `PROMPT_HARD_CEILING` (30,000). Economy documents 20,000.

### seed type

KIE checks `seed` against the TYPE in each SKU's schema. Our API/MCP carry a number, and a SKU whose schema says `type: string` refuses it at createTask (`"seed must be a string"`), which fails the job. When adding an image SKU, read its doc's `seed` type; for a string, declare `seedType: "string"` on its `models.ts` entry (with doc URL + fetch date) and `image.ts` converts the seed through `kieSeedForWire` on both lanes.

| Seed type | Image SKUs (docs fetched 2026-10-04) |
|-----------|--------------------------------------|
| string (`seedType: "string"`) | `imagen4`, `imagen4-ultra` |
| integer (default — declare nothing) | `imagen4-fast`, ideogram, qwen, wan-2.7 |
| no `seed` in the schema | every other image SKU |

Do not declare it per family — the Imagen 4 tiers disagree. Only the image lanes read `seedType`; `__tests__/models.test.ts` fails if a video/audio SKU declares it.

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
