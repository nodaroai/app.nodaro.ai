import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

import type { VideoProvider } from "./replicate.js"

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
): Promise<string> {
  const resolvedProvider = provider ?? "minimax"
  const cfg = VIDEO_MODEL_CONFIGS[resolvedProvider] ?? VIDEO_MODEL_CONFIGS.minimax
  console.log(`[videoToVideo] Provider: ${resolvedProvider}, Model: ${cfg.model}`)
  console.log(`[videoToVideo] Input video param: "${cfg.videoParam}" = "${videoUrl}"`)
  console.log(`[videoToVideo] Prompt: "${prompt ?? "continue this video with smooth cinematic motion"}"`)

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    {
      input: {
        prompt: prompt ?? "continue this video with smooth cinematic motion",
        [cfg.videoParam]: videoUrl,
        ...cfg.extraInput,
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[videoToVideo] Output: "${resultUrl}"`)
  return resultUrl
}
