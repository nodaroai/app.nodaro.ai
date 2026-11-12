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
| `minimax-h3-image` | `minimax-h3/text-to-image` (NOT the H3 video model `minimax-h3`) | [minimax-h3 t2i](https://docs.kie.ai/market/minimax-h3/text-to-image.md) |
| `minimax-h3-image-i2i` | `minimax-h3/image-edit` | [minimax-h3 image edit](https://docs.kie.ai/market/minimax-h3/image-edit.md) |
| `seedream-5-5` | `seedream/5-5-text-to-image` | [seedream 5.5 t2i](https://docs.kie.ai/market/seedream/5-5-text-to-image.md) |
| `seedream-5-5-i2i` | `seedream/5-5-image-to-image` | [seedream 5.5 i2i](https://docs.kie.ai/market/seedream/5-5-image-to-image.md) |
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
| `grok-imagine-video-1.5` | `grok-imagine-video-1-5-preview` (bespoke `runGrokVideo15`, body from `grok-video-15.ts`). Image required: no t2v entry (the t2v route answers "requires an input image"). | [grok imagine video 1.5](https://docs.kie.ai/market/grok-imagine/1-5-preview.md) |
| `sora2-pro` | `sora-2-pro-image-to-video` | [sora2 pro i2v](https://docs.kie.ai/market/sora2/sora-2-pro-image-to-video.md) |
| `minimax-h3` | `minimax-h3/image-to-video` (swaps to `minimax-h3/reference-to-video` when refs are wired — see `minimaxH3TaskModel`) | [minimax-h3 i2v](https://docs.kie.ai/market/minimax-h3/image-to-video.md) / [r2v](https://docs.kie.ai/market/minimax-h3/reference-to-video.md) |
| `wan-3` | `wan/3-0-video` (bespoke `runWan3`) | [wan 3.0](https://docs.kie.ai/market/wan/3-0-video.md) |
| `wan-3-prime` | `wan/3-0-video-prime` (bespoke `runWan3`) | [wan 3.0 prime](https://docs.kie.ai/market/wan/3-0-video-prime.md) |
| `vidu-q4` | `vidu-q4/image-to-video` (bespoke `runViduQ4`; swaps to `vidu-q4/reference-to-video` — `VIDU_Q4_REFERENCE_MODEL` — when a reference image or audio is wired). No t2v entry: KIE has no Q4 text-to-video. | [vidu q4 i2v](https://docs.kie.ai/market/vidu-q4/image-to-video.md) / [r2v](https://docs.kie.ai/market/vidu-q4/reference-to-video.md) |
| `kling-4` | `kling-4.0/reference-to-video` (bespoke `runKling4`, body from `kling4.ts`) | [kling 4.0 reference](https://docs.kie.ai/market/kling/v4-reference-to-video.md) |
| `kling-4-keyframes` | `kling-4.0/keyframe-to-video` (bespoke `runKling4`) | [kling 4.0 keyframe](https://docs.kie.ai/market/kling/v4-keyframe-to-video.md) |
| `kling-4-flash` | `kling-4.0/flash-reference-to-video` (bespoke `runKling4`; swaps to `kling-4.0/flash-keyframe-to-video` — `KLING_4_FLASH_KEYFRAME_MODEL` — for a start frame alone, see `kling4FlashEndpoint`) | [flash reference](https://docs.kie.ai/market/kling/v4-flash-reference-to-video.md) / [flash keyframe](https://docs.kie.ai/market/kling/v4-flash-keyframe-to-video.md) |
| `pixverse-v6-max` | `pixverse-v6-max/image-to-video` (bespoke `runPixverseV6Max`, body from `pixverse-v6-max.ts`; a run with no start frame takes the t2v config's `pixverse-v6-max/text-to-video`) | [pixverse v6 max i2v](https://docs.kie.ai/market/pixverse/v6-max-image-to-video.md) |
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
| `kling-4-flash` | `kling-4.0/flash-reference-to-video` (text-only runs; the keyframe endpoint needs a start frame) | [flash reference](https://docs.kie.ai/market/kling/v4-flash-reference-to-video.md) |
| `pixverse-v6-max` | `pixverse-v6-max/text-to-video` (bespoke `runPixverseV6Max`; the i2v config carries the image endpoint) | [pixverse v6 max t2v](https://docs.kie.ai/market/pixverse/v6-max-text-to-video.md) |
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
| `omnihuman-2-0` | `omnihuman-2-0` | [omnihuman 2.0](https://docs.kie.ai/market/omnihuman-2-0.md) — wire notes below |
| `suno` (music) | `suno/v4` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v5` (music) | `suno/v5` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v5_5` (music) | `suno/v5_5` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `suno-v6` / `suno-v6_wild` / `suno-v6_mini` (music — current family, V6 = default; the earlier versions stay offered and KIE still serves them even though its docs tag them "Discontinued") | `suno/v6` / `suno/v6_wild` / `suno/v6_mini` | [suno generate](https://docs.kie.ai/suno-api/generate-music.md) |
| `elevenlabs-turbo` | `elevenlabs/text-to-speech-turbo-2-5` | [11labs turbo](https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5.md) |
| `elevenlabs-multilingual` | `elevenlabs/text-to-speech-multilingual-v2` | [11labs multilingual](https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2.md) |
| `elevenlabs-stt` | `elevenlabs/speech-to-text` | [11labs stt](https://docs.kie.ai/market/elevenlabs/speech-to-text.md) |

### OmniHuman 2.0 wire notes (`omnihuman-2-0`, the generic `lipSync`)

A different model from OmniHuman 1.5, offered beside it in the Lip Sync node
(decided 2026-11-11); 1.5 keeps its id, rows and levers. It runs through the
generic `lipSync()` / `buildLipSyncInput`, shaped by its config:

- **Body: exactly four keys** (`inputFields`): `image_urls`, `audio_url`,
  `prompt`, `enable_watermark`. The image goes as a ONE-element array
  (`imageAsList`; 1.5 takes a string `image_url`). `enable_watermark` defaults
  to TRUE upstream, so the config always sends `false` (`extraParams`). 2.0 has
  no `mask_url`, `output_resolution`, `pe_fast_mode` or `seed`: a resolution,
  fast mode or seed a node kept from 1.5 is dropped by the allow-list, and
  before that by the route, the payload builder and the panel
  (`lipSyncLeverClearPatch` in `@nodaro/shared/models`).
- **Prompt:** optional upstream, up to 300 characters
  (`MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER`, `maxPromptChars`): cut to its first
  300 code points, never refused. A promptless run sends the platform's default
  sentence, as every lip-sync model does.
- **Image:** one, < 30 MB, each side 300–6,000 px, width ÷ height 0.4–2.5
  (jpeg, png, webp, bmp, tiff, gif, heic, heif upstream). Checked before any
  hold (`lib/lip-sync-inputs.ts`, from the header and the server's declared
  size, `lib/image-source-probe.ts`); an image sharp cannot read (HEIC, BMP)
  cannot be measured and is refused. An animated GIF is sent as it is.
- **Audio — price and send the same bytes:** 4–300 s, wav or mp3, < 15 MB as
  SENT (decided 2026-11-11: held after conversion); a source up to 100 MB
  (`LIP_SYNC_AUDIO_SOURCE_MAX_BYTES`) in one of the containers the lane takes
  (`CALLER_AUDIO_FORMATS`: MP3/MP2, WAV/RF64, Wave64, AIFF, CAF, AU,
  MP4/M4A/MOV, ADTS AAC, AC-3/E-AC-3, AMR, Ogg, FLAC, Matroska/WebM, WMA/ASF,
  MPEG-TS, AVI, MPEG-PS (MPG/VOB), FLV, raw DTS, WavPack, APE, TTA, Musepack,
  LOAS/LATM) is accepted and ALWAYS converted to MP3 (192 kb/s, decided
  2026-11-12). Every ffmpeg launch that reads the caller's bytes runs with
  `-protocol_whitelist file` and that `-format_whitelist`, so an HLS playlist,
  a DASH manifest or an ffconcat script cannot make it read another file.
  Every listed demuxer keeps its audio in the file itself EXCEPT `mov`: a MOV
  can name another file for its samples (a data-reference alias), and only the
  mov demuxer's `enable_drefs` default of 0 stops ffmpeg following it (such a
  file decodes nothing and is refused; `decoded-audio-length.test.ts` builds
  one). `-enable_drefs 0` cannot be passed — every non-mov input then fails
  with "Option enable_drefs not found". Read a demuxer's source for a second
  open before adding it to the list.
  **Gaps play as silence (decided 2026-11-12):** the one decode runs
  `gapFillFilter` — convert to the PCM shape, clamp timestamps so they never
  step back (else `aresample` async would DROP audio) nor jump more than the
  cap + 1 s, then `aresample=async=1:min_hard_comp=0.1` fills with silence
  whatever the timestamps run ahead of the samples once it passes 0.1 s —
  small gaps add up, so 40 ms a second is filled too (no `first_pts`: a late
  start is not padded). The
  price and the MP3 follow the filled length; a jump past the cap fills to it
  and is refused as too long (~140 MiB peak, under `audioPeakMemoryMiB`),
  unless ffmpeg collapses it first — its 10 s `dts_delta_threshold` for
  formats that allow timestamp breaks (TS/PS), its 30-hour
  `dts_error_threshold` elsewhere — and the audio is priced without it.
  Either way price = samples sent. At 0.1 s no gap-free file
  of the corpus changes by a sample (at 0.02 s MP3s that change rate do). Not
  filled: a gap where the format changes (the filter graph restarts there).
  **Read to its end, or refused (decided 2026-11-12):** `decodeAudioToPcm`
  checks, in this order: (1) past the cap → `overCap` (a chained Ogg whose join
  lies past 300 s is too long, not damaged); (2) the decode is more than
  `DECLARED_LENGTH_TOLERANCE_SEC` (0.5 s; honest files measured ≤ 0.075 s)
  shorter than the length the file STATES → `AudioReadStoppedError`. Stated
  lengths are read by one ffprobe through the same whitelist
  (`declared-audio-length.ts`), only for formats whose stated length is exact,
  never when ffmpeg says "Estimating duration from bitrate" (a cut-off
  WAV/W64/CAF, a WMA cut well short), and per format: Matroska's
  Duration/DURATION are end times (start taken off), a Matroska stream
  `duration` beside other streams is ffprobe's copy of the file's (audio ≥ 5 s
  after the video: nothing stated), and Matroska counts only when its muxer
  finished the file (its SeekHead names a Cues index, `matroska-index.ts` — a
  live recording with an app-patched Duration states nothing); ASF's stream
  duration is the file's play time (only for an audio-only file); Ogg Opus is
  an end time less its start and pre-skip (`initial_padding`) — FLAC-in-Ogg
  that starts mid-stream reports start 0 and stays refused. Stated lengths
  only ever refuse — a file stating LESS than it plays is priced on what it
  plays. Catches a cut-off FLAC/M4A/WebM/TTA/AIFF/AU, a cut-off WMA. (3)
  Damage the demuxer reports (`DAMAGE_REPORTED`: "CRC mismatch!" from the Ogg
  demuxer "[in#N(/ogg) @" — not a decoder's, e.g. Monkey's Audio — and a
  Matroska EBML structure error once the file is open "[in#N/matroska,webm @";
  fftools adds the format to the log name right after `avformat_open_input`,
  before `avformat_find_stream_info`) → `AudioReadStoppedError` — the jump the
  dropped audio leaves would otherwise fill and pass. The same EBML words
  while the HEADER is read ("[in#N @": a stale SeekHead entry) lose nothing
  and do not count, nor does a Matroska line followed only by 0x00 bytes to the
  end of the file (zero padding after the audio, e.g. a recording recovered
  after a crash: `onlyZeroBytesFrom`). (4)
  "Error during demuxing" on stderr (`runFfmpegCapture`; ffmpeg treats the
  demuxer's error as the end and exits 0 — a chained Ogg that changes channels
  or sample rate) → `AudioReadStoppedError`, unless nothing was lost: the
  decode reached the length the WHOLE file states (not Ogg: a chain states its
  last link only), or the file is ADTS and fewer than 10 stray bytes follow its
  last frame (`adts-frames.ts`, the demuxer's own tail error). The price check
  refuses with `audio_unreadable` ("re-export the audio as one complete,
  continuous file"), the worker with a `DeterministicJobError`. Not `-xerror`:
  it refuses files ffmpeg reads to the end past one bad packet (a damaged MP3
  frame, a dropped MPEG-TS packet, a stream-written WAV, the crafted MP3
  fixtures). NOT caught, priced and sent as what decodes (gaps filled): a
  cut-off or codec-joined file in a format with no exact length (MP3, ADTS,
  AC-3, DTS, TS/PS, AVI, FLV — e.g. MP3 then ADTS), a cut-off WAV/W64/CAF (or
  a WMA cut well short: estimated) or Ogg (its granule follows the cut),
  unreported damage that only leaves a jump (a TTA or FLAC frame: plays as
  silence), WV/TTA joined byte for byte (the first part only), Matroska with
  video and no per-track DURATION. Still refused though complete: a WavPack
  written to a pipe (it states no length) with a tag after its audio (the
  demux line, nothing to forgive it by), FLAC-in-Ogg that starts mid-stream.
  **One decode prices and sends (decided 2026-11-12):** the first audio track
  is decoded ONCE into one PCM shape — 44.1 kHz stereo s16le
  (`providers/video/decoded-audio-length.ts`, `decodeAudioToPcm`, capped just
  past 300 s) — and the length is that PCM's sample frames: never the
  container's declared duration (a crafted MP3 can understate it by minutes),
  and the MP3 the model gets is encoded from THAT PCM. Never price on one
  ffmpeg run and encode in another that resamples differently: at every
  mid-stream sample-rate or channel-layout change ffmpeg rebuilds its filter
  graph and drops what a resampler held, so two such runs keep different
  sample counts (an 8 kHz measure lost ~2 ms a change against the MP3 encode,
  and an encode could keep MORE than the decoder produced), and honest files
  measured just under a whole second were refused. The route and the workflow
  run download the audio to measure it (`downloadLipSyncAudio`: the 100 MB cap
  on the stream and on disk, `LIP_SYNC_AUDIO_DOWNLOAD_LIMITS`' minimum rate,
  under `lipSyncMeasureSlots`) and price a URL the caller controls, so the
  model is NEVER sent that URL. `providers/kie/lip-sync-audio.ts` downloads it
  again by the same rule, decodes it with the same decode (same bytes → same
  samples, by construction), and refuses (`DeterministicJobError`: failed and
  refunded now, KIE never called) one that bills more than the job's
  `lipSyncBilledSeconds` (passed as `LipSyncOptions.billedSeconds`) or runs
  past 300 s. Then it encodes that PCM to MP3 — audio under 4 s padded with
  silence to 4.1 s ON THE PCM (`apad=whole_dur` in a graph that never rebuilds,
  so it pads once; it never measures under 4 s upstream) and billed 4 s —
  measures THE ENCODE (read as MP3 only), and refuses (deterministic) one that
  plays past the held seconds (or the padded 4.1 s) by more than
  `LIP_SYNC_ENCODE_TOLERANCE_SEC`, or that is 15 MB or more. The MP3 of the PCM
  decodes back to exactly its sample count; `lip-sync-audio-parity.test.ts`
  holds the price check's count EQUAL to the samples sent, on files that change
  format mid-stream too. Only the encode, stored in the job's scratch folder
  (`lip-sync-prepared`), is sent. Never trimmed.
- **Staging check (open):** what KIE bills for a padded 4.1 s clip (4 s, or 5),
  and for an MP3 whose decoded length sits just under a whole second (a
  decoder that does not drop the encoder's ~25 ms of priming reads it a
  frame longer). `provider_cost` assumes the billed seconds; confirm on one
  staging run of each before relying on it.
- **Billing:** KIE bills 14 credits per second of output (`kieCreditsPerAudioSecond`),
  so `provider_cost` = 14 × the billed seconds × `KIE_CREDIT_USD`
  (`lipSyncKieCostUsd`), not the flat `cost` anchor. The run is charged the
  `omnihuman-2-0:per-second` row × the billed seconds (`LIP_SYNC_AUDIO_RATES`,
  `lipSyncBilledSeconds`: the decoded audio rounded up, at least 4), measured
  by the server on every path; the commit is the reservation.
- No content-filter field in the schema, so no `safetyLevers`.
- Poll budget: the long lip-sync budget above 30 s of audio, as kling-avatar.

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

### Kling 4.0 Flash wire notes (`kling-4-flash`, bespoke `runKling4`)

ONE Nodaro id over two KIE endpoints, picked by `kling4FlashEndpoint`
(`kling4.ts`, decided 2026-11-11): a start frame with no reference image, no
reference video and no character (any character with an image — a one-image
character becomes a reference image) → `kling-4.0/flash-keyframe-to-video`;
everything else → `kling-4.0/flash-reference-to-video`. NOT a member of
`KLING_4_PROVIDERS` (that set's branches carry 1080p, `voices`, the Keyframes
frame table and Kling 4.0's materials rule); it opts in through
`isKling4RunnerProvider` (dispatch, UI defaults, provider snap) and
`isKling4FlashProvider`.

- Both schemas are `additionalProperties: false`: explicit allow-list, INTEGER
  `duration` 3-20, `resolution` always `720p` (`KLING_4_FLASH_RESOLUTION`,
  whatever was asked — the only value either schema takes), no seed, no audio
  lever. `__tests__/kling4-flash.test.ts` holds every body to the schema's
  property list across a sweep of wiring shapes.
- **Keyframe body:** `{ prompt, duration, resolution, first_frame_url }` — no
  `aspect_ratio` (only reached with a frame; the clip takes its shape), no
  `keyframes`, no `last_frame` (KIE refuses both). `@image_1` is rewritten to
  `@first_frame`; every other mention loses its `@`. Reference audio has nowhere
  to go and is dropped with a server-log note.
- **Reference body:** Kling 4.0's (`buildReference` with `flash`): a start
  frame joins `image_urls` after the caller's own, subjects are characters with
  2-4 images (`tag: "character"`), `keep_original_sound` only with videos. NO
  `voices`: reference audio clip N belongs to WIRED CHARACTER N, in
  `characterReferences` order (decided 2026-11-11) — that character's
  `voice_url` when it is a subject (only a `character` subject may carry one);
  a clip whose character has one image (a plain reference image) or that has
  no character N is dropped with a server-log note. `@audio_N` is left
  undeclared so it loses its `@`.
- **No end frame** on either endpoint: one that reaches the runner is dropped
  with a note (`dropped the end frame: Kling 4.0 Flash takes none`).
- Limits: 10 images, 5 videos, 7 subjects, 15 in all — voice clips take no seat
  (`audioBindsToCharacters` on `VIDEO_REF_LIMITS_BY_PROVIDER`), refused before
  the reservation by `lib/kling4-inputs.ts` and `videoCharacterRefProblem`.
  Reference videos 2-20 s each and **2-20 s together** — KIE fails the task at
  COMPLETION otherwise, so `VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4-flash"]`
  refuses it in the routes' preHandler and the DAG gate. Reference videos are
  shrunk to `KLING_4_REF_VIDEO_LIMIT` like Kling 4.0's (unprobed for Flash; the
  limit is the family's). Images get Kling 4.0's JPEG/PNG-only treatment
  (`JPEG_PNG_ONLY_PROVIDERS`; the Flash schemas state no format).
- **Billing:** per second, one ladder for both endpoints (KIE 17 cr/s). With a
  reference video KIE bills 11.3 cr/s over output + max(output, Σ input
  seconds) — the Kling 4.0 rule through the same Seedance machinery
  (`VIDEO_REF_RATE_PROVIDERS`). The `-ref` rows are rounded up to the next 10
  per row, so the reservation's 8 s anchor (230 ÷ 8 = 28.75 credits/s) is a
  little above the bare rate — deliberate. `runKling4` reports
  `KLING_4_FLASH_RATE_USD_PER_SEC` as the provider cost (a reference-video run
  at the 2 × output floor, as for Kling 4.0). Not yet probed live.

### Grok Imagine Video 1.5 wire notes (`grok-imagine-video-1.5`, bespoke `runGrokVideo15`)

ONE KIE id, image to video only. The pure `buildGrokVideo15Request`
(`grok-video-15.ts`) builds the body from the RAW frame URLs; `runGrokVideo15`
normalizes each distinct image once afterwards (our 2048 px cap), so a loop
image or a start image riding twice stays one URL. The dispatch sits ABOVE the
generic frame normalization in `imageToVideo` for the same reason.

- The schema's `input` is `additionalProperties: false`: explicit allow-list —
  `prompt`, `image_urls`, `aspect_ratio` (catalog ratios + `auto`, anything
  else → `auto`), `resolution` (`normalizeGrokVideo15Resolution`: lowercase
  480p / 720p / 1080p, anything else → 480p, billed the same), INTEGER
  `duration` 1-15 (default 8), `first_frame_url`, `last_frame_url`, `loop_url`,
  `keyframes`, `nsfw_checker: false`. Never `seed`, `negative_prompt` (a
  negative is folded into the prompt as "Avoid: …"), `cfg_scale`, a reference
  list or `enable_audio` (KIE's default, audio on, renders).
- **Frames (decided 2026-11-11):** the start frame is `first_frame_url` (the
  exact first frame), the end frame `last_frame_url`; the SAME URL as both is
  sent as `loop_url` alone (KIE refuses a loop image beside a different first or
  last frame). The node's Image References are the in-between frames
  (`keyframes`, max 4) and never `image_urls`: spread evenly at whole seconds,
  `round(i × D / (k + 1))`, strictly inside the clip; a D-second clip has D − 1
  slots (`grokVideo15MiddleFrameSlots`), and frames past them are dropped with a
  server-log note — never refused.
- **The start frame's transport** is ONE constant,
  `GROK_VIDEO_15_START_FRAME_TRANSPORT`: `"first-frame-only"` (the default —
  `first_frame_url`, no `image_urls`) or `"first-frame-and-image-urls"` (the
  start or loop image also rides `image_urls`, one entry). The schema lists
  `image_urls` as required yet says the first frame "can be sent on its own";
  flip the constant if a staging run refuses the first body.
- **Mentions:** KIE reads `@imageN` as the Nth `image_urls` entry. Every image
  mention (`@image_N`, `@imageN`, `@image(N)`) loses its `@` except `@image1`
  under the second transport (the start image).
- **No start image, no run:** the route and the editor refuse a lone end frame
  and in-between frames without a start frame (`videoProviderTakesLoneEndFrame`,
  `videoProviderRefsReplaceStartFrame` — the catalog declares `keyframes` but no
  `reference-to-video`); the workflow run moves a lone end frame into the start
  slot. The runner throws as a backstop.
- **1080p takes a start frame ONLY** (staging, 2026-11-12: KIE fails the task
  with `[400] 1080p is only supported for text-to-video or a single image used
  as the first frame` beside an end frame, a loop or `keyframes`; 480p/720p take
  them all). Declared as the catalog's `startFrameOnlyResolutions: ["1080p"]`
  and judged by the shared `videoStartFrameOnlyProblem` (in-between frames
  counted after `videoKeyframesMiddleCap`, a loop as an end frame): the
  `/v1/generate-video` route and the payload builder refuse before the
  reservation (`start_frame_only_resolution`), the editor's Run before calling
  the route, and `runGrokVideo15` throws on the built body as a backstop.
  `grok-video-15-start-frame-only.test.ts` holds the rule to the builder's
  bodies. Do not snap 1080p to 720p silently — the decision is to refuse.
- **Billing:** per second by resolution (KIE 2.4 / 4.5 / 8 cr/s at 480p / 720p /
  1080p, read 2026-11-11), no per-image or per-frame part. Seeded
  `grok-imagine-video-1.5:<N>s:<res>` rows, the bare id = 8 s @480p. The runner
  reports `GROK_VIDEO_15_RATE_USD_PER_SEC` × seconds as the provider cost and
  writes a credit-audit row.

### PixVerse V6 Max wire notes (`pixverse-v6-max`, bespoke `runPixverseV6Max`)

ONE Nodaro id over two KIE ids, registered in BOTH model maps under that id:
`KIE_VIDEO_MODELS["pixverse-v6-max"]` is `pixverse-v6-max/image-to-video`,
`KIE_TEXT_TO_VIDEO_MODELS["pixverse-v6-max"]` is `pixverse-v6-max/text-to-video`.
The pure `buildPixverseV6MaxRequest` (`pixverse-v6-max.ts`) builds both bodies
and names the endpoint: a start frame → image-to-video, none → text-to-video.
The i2v dispatch sits AFTER the shared frame normalization (our 2048 px / 10 MB
/ JPEG-PNG-WebP step is inside KIE's 10,000 px / 20 MB / JPG-PNG-WebP limits),
and an `imageToVideo` call with no frame falls to the t2v config.

- Explicit allow-list on both bodies (`PIXVERSE_V6_MAX_*_FIELDS`): `prompt`
  (1-5000; `applyVideoNegativePrompt` already clamps it and folds a negative in
  as "Avoid: …"; an empty one is sent as the platform default),
  `image_urls` (i2v only, exactly one — the start frame), `aspect_ratio` (t2v
  only — the catalog's eight, anything else snapped to the nearest, 16:9 for no
  shape), `quality` (OUR `resolution`, through `normalizePixverseV6MaxQuality`:
  lowercase 360p / 540p / 720p / 1080p, anything else → 720p — KIE requires a
  quality and has no default), INTEGER `duration` 1-15 (default 5),
  `generate_audio_switch`, `seed` (only 0-2147483647; a route's `-1` is left
  out). Never `resolution`, `negative_prompt`, an end frame or reference lists
  — the runner logs ignored references.
- **Audio is cost-affecting.** `VIDEO_AUDIO_CAPABILITY` `field:
  "generateAudioSwitch"`, `affectsCost: true`, `defaultOn: true`,
  `readsGenerateAudio: true`. KIE's default is OFF, so the builder ALWAYS sends
  `generate_audio_switch: true` and then `applyVideoAudioToggle` overrides it
  from `videoAudioIntent` — `sound`, else `generateAudio` (the Generate Video
  Pro engine sends only `generateAudio`; decided 2026-11-12). Every pricing path
  resolves the SAME fields through the same function (the credit builder takes
  `{ sound, generateAudio }`), so the switch and the `:audio` row cannot
  disagree. An intent-less request renders and bills audio on (decided
  2026-11-11). `extraParams: { generate_audio_switch: true }` on both configs is
  declarative only (the video-audio-capability guard reads it).
- **Generate Video Pro** admits it through the catalog's `gvpWithoutReferences`
  (keyframes only): segment references and any end frame reach the runner and
  are dropped there (logged); a stored "reference" anchor choice is sent as
  Auto (`resolveGvpAnchorWire`). Its segments price through `gvpSegmentAudio` (`@nodaro/render-rules`):
  the provider fields the plugin toolkit hands a segment
  (`pluginVideoAudioRequest`, the same mapping `toProviderOptions` uses) for
  the pricing call's `generateAudio`, else on (the engine's own default), read
  by the resolver the runner renders from — so every Pro model is charged the
  audio it renders (Kling 3.0, which reads only `sound`, its sound row). The
  prompt's `@image_N` mentions lose their `@` (`image-mentions.ts`, shared
  with Grok Imagine Video 1.5): no reference image is sent for them to name.
- **Billing:** per second by quality and audio state, the same on both
  endpoints (KIE 4.8 / 7.2 / 8.8 / 17.6 cr/s silent, 7.2 / 8.8 / 12 / 22.4 with
  audio, at 360p / 540p / 720p / 1080p, read 2026-11-11). Seeded
  `pixverse-v6-max:<N>s:<quality>` and `…:<quality>:audio` rows, the bare id =
  5 s @720p with audio. The runner reports
  `PIXVERSE_V6_MAX_RATE_USD_PER_SEC` × seconds as the provider cost, names the
  `resolution` / `audio` egress dimensions itself (`quality` is not a size on
  the image lanes, so the shared reader leaves it alone) and writes a
  credit-audit row.

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

**Declared task type (`omni_reference_task_type`, `seedanceTaskTypeForBody`).**
A request can say what its reference media is for instead of leaving Seedance
to guess from the prompt: `referenceTaskType` = `reference` | `edit` | `extend`
(`auto` or absent declares nothing). The routes resolve it before pricing
(`resolveSeedanceTaskType` through `resolveVideoRequestNorm`: `edit` runs at
`adaptive` + `-1`, `extend` at `adaptive` + a fixed length) and queue only the
resolved value; the i2v, t2v and voiced-video handlers pass it on as
`ProviderOptions.referenceTaskType`. `applySeedance2Params` writes it AFTER
`resolveSeedance2Inputs`, on the body as it will be sent, only when ALL hold:
the model's catalog `referenceTaskTypes` lists the value
(`listedSeedanceTaskType` — `seedance-2-5` today; never a hand-written model
id), the body's `reference_*_urls` are the media the
type needs (`seedanceTaskTypeFitsMedia`, the resolver's own rule: `edit` and
`extend` need `reference_video_urls`, since both act on a reference video,
while `reference` takes any reference media), `first_frame_url` is not on the
body (a start frame beside reference media rides as a reference image, so that
run still takes it), and an `edit` or `extend` body is in its shape (`edit`:
`isSeedance2EditModeInput`, `adaptive` + `-1`; `extend`: `adaptive`). A route
request always is; one that skipped the routes and is not gets no key and one
warning. It is NEVER sent on a text-only body or in either frame mode (KIE:
"only supported in multimodal reference tasks"), on an
`edit`/`extend` without a reference video or out of its shape, or on another
model; no option means no key, so the body is byte-identical to the
undeclared one. A draft (`draft: true`) is no exception: it declares exactly as
the same request without Draft, and its 1080p finalize re-renders that take. **An edit-mode re-send drops the declaration:** when the
provider answers with its edit-mode words it has overridden the declared type,
so both re-send lanes — the retry above and the reconcile resend
(`lib/reconcile/seedance-edit-resubmit.ts`) — send
`seedance2EditModeResendInput(body)` (`seedance-edit-mode.ts`): the original
without `omni_reference_task_type`, with `SEEDANCE_2_EDIT_MODE_PARAMS` applied,
exactly the undeclared edit-shape request, and logs one line naming the
dropped value (the reconcile lane also names the job and the task). A declared
`edit` is already in edit shape, so neither lane re-sends it. The Nodaro cloud relay
(`providers/nodaro/video.ts`) forwards the option as the public
`referenceTaskType` field, and the far end resolves it again.

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
An unmeasurable delivery commits the reservation. An Auto (`-1`) run with every
clip measured is held as an edit (the longest clip + 1 s,
`seedance2RefVideoHeldOutputSec`) — except a run whose RESOLVED type is
`reference`: a reference runs at a length the model picks, so it is held at the
worst case (Auto = the model's longest output) and charged what it delivers,
capped at that hold. The type is a REQUIRED key on the hold, the reservation
(`…FromDurations`/`…FromUrls`), the quote and the settlement args, read from
`req.videoNorm.referenceTaskType` (routes), the stamped payload (executor) and
the job's `referenceTaskType` (worker lanes, reconcile) — never the raw body.

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
| Array of URLs | kling, grok, sora2-pro, flux, gpt-image, nano-banana-edit, seedream-edit, nano-banana-2-lite (up to 10, NOT the family's `image_input`), seedream-5-flash-i2i (up to 10, not the family's 16), minimax-h3-image-i2i (1 to 16), seedream-5-5-i2i (1 to 10, priced per image; `maxInputImages` sends at most 10) | `image_urls` or `input_urls` |
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
| MiniMax H3 Image (T2I + edit) | `output_format` | `"png"` (KIE's default: nothing is sent), `"jpeg"` (catalog `outputFormats`, `inputFieldsByFormat`) |
| Seedream 5.5 (T2I + I2I) | `output_format` | `"png"` (default, sent as nothing), `"jpeg"` — the catalog's `outputFormats`; a transparent background with JPEG is moved to `auto` before the run is priced |
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
| MiniMax H3 Image (T2I + edit) | `resolution` | `"1K"`, `"2K"` (default), `"4K"` at every ratio; 1K and 2K cost the same |
| Seedream 5.5 (T2I + I2I) | **`size`**, as Flash | `"1K"`, `"1.5K"`, `"2K"` (default, and KIE's): priced per size, 1K and 1.5K the same (see the wire notes below) |
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
- **Masked edits** (`mask_url`, Flare and Sunburst edit ids only: `I2I_MASK_SUPPORT`).
  KIE refuses a white-on-black mask ("must be a PNG with an alpha channel"), so the
  platform's mask (white = change) is sent as an RGBA PNG at the photo's size,
  transparent where it changes (`maskFormat: "alpha-transparent-edits"`,
  `applyMaskFormat` / `prepareMask` in `image.ts`). The model redraws a little
  outside the mask, so the photo is pasted back there (`maskEditRedrawsOutside`,
  `pasteSourceOutsideMask` in `services/inpaint/composite.ts`; the reconcile lane
  through `lib/reconcile/mask-paste-back.ts`). Sized and priced as the photo
  (`maskEditMatchesSource`, `maskedEditResolution`).
  - **An opaque photo gives an opaque picture.** Left to `background: "auto"`, the
    model can hand back a picture that is partly transparent inside the mask
    (production, 2026-11-11: alpha down to 37 there, seen as dark holes). So a
    masked edit of a photo with no transparent pixels sends `background: "opaque"`
    unless the caller asked for `transparent` (a direct probe the same day: `opaque`
    came back RGB with no alpha at 1K, 2K and 4K). And the paste-back keeps alpha only
    for a photo with transparent pixels or a run that asked for a transparent
    background; otherwise the picture is opaque and a pixel the model left
    transparent shows the photo (`hasTransparentPixels`, `lib/image-transparency.ts`).
- Not wired yet: `markup`, `complexity`, `output_compression`.
- `prompt` is documented up to 32,000 characters on Flare and Sunburst; the routes
  stop at `PROMPT_HARD_CEILING` (30,000). Economy documents 20,000.

### MiniMax H3 Image wire notes (`minimax-h3-image` / `minimax-h3-image-i2i`)

MiniMax's H3 image model, a different model from the H3 video model `minimax-h3`
(the ids extend that string: never match either by prefix).

- The text-to-image endpoint takes **no image**. With references the provider
  moves the run to `minimax-h3/image-edit` (`GPT_IMAGE_T2I_TO_I2I` in
  `image-edit-sibling.ts`, and `T2I_TO_I2I_VARIANT` for the routes), and the price follows
  the swap: `buildCreditModelIdentifier` prices a text-to-image id sent images
  on the edit id, so the entity routes and pipeline pins, which do not swap,
  are priced as the edit they run.
- An edit takes 1 to 16 `image_urls` (each up to 20 MB and 64 MP); the prompt
  names them `<Picture 1>`, `<Picture 2>`, … in array order. The platform's
  image prompts write references as `Image N` for every model (there is no
  per-model reference syntax for images, only for video), so nothing rewrites
  them to `<Picture N>`.
- `aspect_ratio`: auto, 1:1, 5:4, 4:3, 3:2, 16:9, 21:9, 4:5, 3:4, 2:3, 9:16, every
  ratio at every size. KIE's `auto` lets its prompt rewriter pick the ratio from
  a prompt and follows the first reference in an edit. The catalog lists `auto`
  LAST, so a fallback that takes the first ratio lands on 1:1. The configs' 16:9
  is sent only for a direct API request (`/v1/generate-image`) that names no
  ratio. A Generate Image or Modify Image node saved with no ratio sends `auto`
  (`nodeAspectRatio` in the payload builder and the editor, the platform's rule
  for every model with its own `auto`), so a prompt-only node lets KIE's
  rewriter pick the shape; an edit through `/v1/image-to-image` that names none
  runs at `auto` too (`UNSET_RATIO_IS_AUTO_EDIT_MODELS`). New nodes start at
  16:9.
- The body is an explicit list (`inputFields` / `inputFieldsByFormat`), though
  the schemas are not `additionalProperties: false`: `expand_prompt` is never
  sent (KIE's default, on, applies; with it off a seed reproduces and `auto`
  becomes 1:1), nor `width` / `height` (a custom size, billed by its pixels, not
  offered), nor a lever another model takes. PNG sends no `output_format`.
- `seed` is an integer 0 to 2147483647 (`seedRange` on both configs): our API
  and MCP take any whole number ≥ 0, so a seed outside it is dropped before the
  request is sent (`kieSeedForWire`), never refused by KIE after the reservation.
- No content-filter field in either schema, so no `safetyLevers`.
- **Billing:** per picture by the size, 1.8 KIE credits at 1K or 2K and 5.5 at 4K,
  plus 0.5 per reference image on an edit, the first included
  (`MINIMAX_H3_IMAGE_KIE_HUNDREDTHS`, `models.ts`). The credit rows sum it in
  hundredths and round once (`ee/billing/minimax-h3-image-pricing.ts`:
  `minimax-h3-image:<size>`, `minimax-h3-image-i2i:<size>:<N>ref`), and
  `kieImageCostUsd` records the size and the references sent as
  `provider_cost`. The number of references counted is what the run sends,
  a Generate Image base included (`pricedSentImages`).

### Seedream 5.5 wire notes (`seedream-5-5` / `seedream-5-5-i2i`)

Two Nodaro ids on the standard `createTask` lane; the person picks Seedream 5.5,
and references (or a base image) move a run onto the edit id: in the route
(`T2I_TO_I2I_VARIANT`) and, for the callers that do not swap (the entity routes,
a pipeline pin), in `generateImage` here (`GPT_IMAGE_T2I_TO_I2I`,
`image-edit-sibling.ts`), since the
text-to-image schema has no image field at all.

- `size` is `1K`, `1.5K` or `2K` (KIE's default). It is our `resolution`, renamed
  by `resolutionParam: "size"`; the catalog's `defaultResolution` and every place
  that fills an unset size read `SEEDREAM_5_5_DEFAULT_RESOLUTION` (2K). `1.5K` is
  a size label no other model lists: it is in the routes' vocabulary
  (`IMAGE_RESOLUTION_VALUES`), and `normalizeModelInput` moves it on any other
  model to a size that model lists.
- `aspect_ratio` is REQUIRED on text to image and has no `auto`: the catalog lists
  the eight real ratios, so `auto` (an unset Generate Image ratio) becomes the
  ratio nearest a photo, else 1:1, and the config's default is 16:9. The edit lists
  `auto` first (KIE's default there); an image-to-image request naming no ratio
  runs at `auto` (`UNSET_RATIO_IS_AUTO_EDIT_MODELS`). Whether the edit's `auto`
  keeps a portrait photo's shape is not yet measured: if it renders square, give
  the entry `autoAspectFromSourceImage`.
- `output_format` `png` (sent as nothing) or `jpeg`; `background` `auto`, `opaque`
  or `transparent`, the last only with PNG (`TRANSPARENT_OUTPUT_FORMATS` moves it
  to `auto` with JPEG, before the run is priced).
- Prompts 5 to 5000 characters. The minimum (`MIN_IMAGE_PROMPT_CHARS_BY_PROVIDER`),
  counted after trimming, is refused before a run is reserved:
  `lib/image-prompt-minimum.ts` in `/v1/generate-image`, `/v1/image-to-image`
  and the workflow payload builder (Generate Image, Image to Image, Modify
  Image, and the Character, Face, Object, Creature, Location and Scene lanes,
  which send a node's raw description or prompt when it has no name). The
  entity routes build their prompts from templates and are not checked.
- The body is an explicit list (`inputFields` / `inputFieldsByFormat`): `prompt`,
  `aspect_ratio`, `size`, `background`, `image_urls` on the edit, `output_format`
  with JPEG only. A stray `seed`, `strength`, `guidance_scale`, `mask_url`,
  `quality` or `negative_prompt` is never sent. `nsfw_checker` is not in the
  list: nothing sends it today, and an admin's Provider Safety setting adds it at
  the client, after this list.
- Both entries declare `strictAspectRatios` (the schema marks `aspect_ratio`
  required, with a closed list). The Scene node and the surround continuation
  pass every other model's ratio on as stored, and check only a strict model's
  (`aspectRatioForStrictModel`, `lib/aspect-ratio.ts`), against the model the
  request reaches (`kieImageModelSent`, `image-edit-sibling.ts`): with no image
  a stored `auto` or 4:5 reaches the text-to-image model as the nearest ratio it
  lists; with one (a Scene's references, surround's composite, always) the edit
  takes `auto` as stored. Do not widen that check to models without the flag:
  GPT Image 2 renders 21:9 and 4:5 (measured 2026-11-11) though its catalog
  list names neither.
- 1 to 10 input images (JPEG, PNG, WebP, 10 MB each: `ensureImageForProvider`'s
  defaults). The routes refuse more than 10 (`requestImageLimit`, a base image
  counted); a workflow run prices and sends the first 10 (`maxInputImages`), and
  MCP caps references without counting a base image; the price id counts no more
  than 10.
- Billing: 3.6 KIE credits per picture at 1K or 1.5K, 6.3 at 2K, plus 1.44 for
  each input image of an edit (`SEEDREAM_5_5_KIE_HUNDREDTHS`, `models.ts`). Rows
  in `ee/billing/seedream-5-5-pricing.ts`
  (`seedream-5-5:<size>`, `seedream-5-5-i2i:<size>:<N>ref`), every path that
  reserves counting the images through `pricedSentImages` /
  `pricedEstimatedImages`; `kieImageCostUsd` records the same figures as
  `jobs.provider_cost`.
- No `seed` in either schema. `nsfw_checker` (default false) is declared as
  `NSFW_CHECKER_LEVER` and not sent, as on the other Seedream models.

### seed type

KIE checks `seed` against the TYPE in each SKU's schema. Our API/MCP carry a number, and a SKU whose schema says `type: string` refuses it at createTask (`"seed must be a string"`), which fails the job. When adding an image SKU, read its doc's `seed` type; for a string, declare `seedType: "string"` on its `models.ts` entry (with doc URL + fetch date) and `image.ts` converts the seed through `kieSeedForWire` on both lanes.

| Seed type | Image SKUs (docs fetched 2026-10-04) |
|-----------|--------------------------------------|
| string (`seedType: "string"`) | `imagen4`, `imagen4-ultra` |
| integer (default — declare nothing) | `imagen4-fast`, ideogram, qwen, wan-2.7, `minimax-h3-image` and its edit (0 to 2147483647; fetched 2026-11-11) |
| no `seed` in the schema | every other image SKU |

Do not declare it per family — the Imagen 4 tiers disagree. A SKU whose schema bounds the seed declares `seedRange: { min, max }` (MiniMax H3 Image: 0 to 2147483647), and a seed outside it is dropped before the request goes out. Only the image lanes read `seedType` and `seedRange`; `__tests__/models.test.ts` fails if a video/audio SKU declares either.

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
