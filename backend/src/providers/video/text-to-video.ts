import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { textToVideoKie, type KieResult } from "../../services/kie-ai.js"
import { isKieSupported } from "../../services/model-mapping.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

import type { VideoProvider, VideoResult } from "./replicate.js"

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
  duration?: number,
): Promise<VideoResult> {
  const resolvedProvider = provider ?? "minimax"

  // Check if we should use KIE.ai
  const settings = await getAppSettings()
  if (settings.ai_provider === "kie" && isKieSupported("text-to-video", resolvedProvider)) {
    console.log(`[textToVideo] Using KIE.ai API for provider: ${resolvedProvider}`)
    const result = await textToVideoKie(prompt, resolvedProvider, duration)
    return { url: result.url, cost: result.cost }
  }

  // Default: Use Replicate API
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
  return { url: resultUrl, cost: null }
}
