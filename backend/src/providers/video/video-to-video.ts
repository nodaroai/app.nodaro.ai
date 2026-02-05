import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { routeProvider, applyMarkup, logExecutionResult } from "../../services/provider-router.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

import type { VideoProvider, VideoResult } from "./replicate.js"

// Note: Video-to-Video always uses Replicate, NOT KIE.ai
// KIE.ai doesn't have dedicated video-to-video endpoints - their image-to-video
// models (like minimax/hailuo) only accept image URLs, not video URLs.
// When in KIE.ai mode, this falls back to Replicate with 10% markup.

interface ModelConfig {
  model: string
  videoParam: string
  extraInput?: Record<string, unknown>
}

const VIDEO_MODEL_CONFIGS: Record<string, ModelConfig> = {
  minimax: {
    model: "minimax/video-01",
    videoParam: "first_frame_image",
    extraInput: { prompt_optimizer: true },
  },
  veo: {
    model: "google/veo-2",
    videoParam: "video",
  },
  veo3: {
    model: "google/veo-3",
    videoParam: "video",
    extraInput: { generate_audio: true },
  },
  kling: {
    model: "kwaivgi/kling-v1.6-pro",
    videoParam: "input_video",
  },
  runway: {
    model: "runway/gen3a-turbo",
    videoParam: "video",
  },
  pika: {
    model: "pika-labs/pika",
    videoParam: "video",
  },
  sora: {
    model: "openai/sora",
    videoParam: "video",
  },
}

export async function videoToVideo(
  videoUrl: string,
  prompt?: string,
  provider?: VideoProvider,
): Promise<VideoResult> {
  const resolvedProvider = provider ?? "minimax"
  const finalPrompt = prompt ?? "continue this video with smooth cinematic motion"

  // Use centralized provider routing
  // Note: KIE.ai doesn't support video-to-video, so this always falls back to Replicate
  // When in KIE.ai mode, the fallback applies 10% markup
  const routing = await routeProvider("video-to-video", resolvedProvider, "videoToVideo")

  // Always use Replicate API for video-to-video (KIE.ai doesn't support V2V)
  const cfg = VIDEO_MODEL_CONFIGS[resolvedProvider] ?? VIDEO_MODEL_CONFIGS.minimax
  console.log(`[videoToVideo] Provider: ${resolvedProvider}, Model: ${cfg.model}`)
  console.log(`[videoToVideo] Input video param: "${cfg.videoParam}" = "${videoUrl}"`)
  console.log(`[videoToVideo] Prompt: "${finalPrompt}"`)

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    {
      input: {
        prompt: finalPrompt,
        [cfg.videoParam]: videoUrl,
        ...cfg.extraInput,
      },
    },
  )

  const resultUrl = String(output)
  const cost: number | null = null  // Replicate doesn't provide cost info easily
  const displayCost = applyMarkup(cost, routing.costMarkupPercent)
  logExecutionResult("videoToVideo", "replicate", cost, displayCost)
  console.log(`[videoToVideo] Output: "${resultUrl}"`)
  return { url: resultUrl, cost, displayCost, providerUsed: "replicate" }
}
