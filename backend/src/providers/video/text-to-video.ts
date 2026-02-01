import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

import type { VideoProvider } from "./replicate.js"

const VIDEO_MODELS: Record<string, string> = {
  minimax: "minimax/video-01",
  veo: "google/veo-2",
  veo3: "google/veo-3",
  kling: "kwaivgi/kling-v1.6-pro",
  runway: "runway/gen3a-turbo",
  pika: "pika-labs/pika",
  sora: "openai/sora",
}

export async function textToVideo(
  prompt: string,
  provider?: VideoProvider,
): Promise<string> {
  const resolvedProvider = provider ?? "minimax"
  const model = VIDEO_MODELS[resolvedProvider] ?? VIDEO_MODELS.minimax
  console.log(`[textToVideo] Provider: ${resolvedProvider}, Model: ${model}`)
  console.log(`[textToVideo] Prompt: "${prompt}"`)

  const output = await replicate.run(
    model as `${string}/${string}`,
    {
      input: {
        prompt,
        prompt_optimizer: true,
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[textToVideo] Output: "${resultUrl}"`)
  return resultUrl
}
