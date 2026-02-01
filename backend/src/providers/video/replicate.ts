import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type VideoProvider = "veo" | "kling" | "runway" | "pika" | "sora" | "minimax"

const VIDEO_MODELS: Record<string, string> = {
  minimax: "minimax/video-01",
  veo: "google/veo-2",
  kling: "kwaivgi/kling-v1.6-pro",
  runway: "runway/gen3a-turbo",
  pika: "pika-labs/pika",
  sora: "openai/sora",
}

export async function imageToVideo(
  imageUrl: string,
  prompt?: string,
  provider?: VideoProvider,
): Promise<string> {
  const resolvedProvider = provider ?? "minimax"
  const model = VIDEO_MODELS[resolvedProvider] ?? VIDEO_MODELS.minimax
  console.log(`[imageToVideo] Provider: ${resolvedProvider}, Model: ${model}`)
  console.log(`[imageToVideo] Input image: "${imageUrl}"`)
  console.log(`[imageToVideo] Motion prompt: "${prompt ?? "smooth cinematic motion"}"`)

  const output = await replicate.run(
    model as `${string}/${string}`,
    {
      input: {
        prompt: prompt ?? "smooth cinematic motion",
        first_frame_image: imageUrl,
        prompt_optimizer: true,
      },
    },
  )

  const videoUrl = String(output)
  console.log(`[imageToVideo] Output: "${videoUrl}"`)
  return videoUrl
}
