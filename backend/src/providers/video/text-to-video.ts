import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { textToVideoKie } from "../../services/kie-ai.js"
import { routeProvider, applyMarkup, logExecutionResult } from "../../services/provider-router.js"

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

  // Use centralized provider routing
  const routing = await routeProvider("text-to-video", resolvedProvider, "textToVideo")

  // Route to KIE.ai if supported
  if (routing.useKie) {
    const result = await textToVideoKie(prompt, resolvedProvider, duration)
    const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
    logExecutionResult("textToVideo", "kie", result.cost, displayCost)
    return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
  }

  // Use Replicate API (either default or fallback from KIE.ai mode)
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
  const cost: number | null = null  // Replicate doesn't provide cost info easily
  const displayCost = applyMarkup(cost, routing.costMarkupPercent)
  logExecutionResult("textToVideo", "replicate", cost, displayCost)
  console.log(`[textToVideo] Output: "${resultUrl}"`)
  return { url: resultUrl, cost, displayCost, providerUsed: "replicate" }
}
