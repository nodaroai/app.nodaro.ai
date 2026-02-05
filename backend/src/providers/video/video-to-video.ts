import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

import type { VideoProvider, VideoResult } from "./replicate.js"

// Note: Video-to-Video always uses Replicate, NOT KIE.ai
// KIE.ai doesn't have dedicated video-to-video endpoints - their image-to-video
// models (like minimax/hailuo) only accept image URLs, not video URLs.

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
  console.log(`[videoToVideo] Output: "${resultUrl}"`)
  return { url: resultUrl, cost: null }
}
