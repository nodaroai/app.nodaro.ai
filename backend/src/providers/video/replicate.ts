import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type VideoProvider = "veo" | "kling" | "runway" | "pika" | "sora" | "minimax"

interface ModelConfig {
  model: string
  imageParam: string
  extraInput?: Record<string, unknown>
}

const VIDEO_MODEL_CONFIGS: Record<string, ModelConfig> = {
  minimax: {
    model: "minimax/video-01",
    imageParam: "first_frame_image",
    extraInput: { prompt_optimizer: true },
  },
  veo: {
    model: "google/veo-2",
    imageParam: "image",
  },
  kling: {
    model: "kwaivgi/kling-v1.6-pro",
    imageParam: "input_image",
  },
  runway: {
    model: "runway/gen3a-turbo",
    imageParam: "image",
  },
  pika: {
    model: "pika-labs/pika",
    imageParam: "image",
  },
  sora: {
    model: "openai/sora",
    imageParam: "image",
  },
}

export async function imageToVideo(
  imageUrl: string,
  prompt?: string,
  provider?: VideoProvider,
): Promise<string> {
  const resolvedProvider = provider ?? "minimax"
  const cfg = VIDEO_MODEL_CONFIGS[resolvedProvider] ?? VIDEO_MODEL_CONFIGS.minimax
  console.log(`[imageToVideo] Provider: ${resolvedProvider}, Model: ${cfg.model}`)
  console.log(`[imageToVideo] Input image param: "${cfg.imageParam}" = "${imageUrl}"`)
  console.log(`[imageToVideo] Motion prompt: "${prompt ?? "smooth cinematic motion"}"`)

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    {
      input: {
        prompt: prompt ?? "smooth cinematic motion",
        [cfg.imageParam]: imageUrl,
        ...cfg.extraInput,
      },
    },
  )

  const videoUrl = String(output)
  console.log(`[imageToVideo] Output: "${videoUrl}"`)
  return videoUrl
}
