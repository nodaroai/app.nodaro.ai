/**
 * Video-to-Video Provider
 *
 * IMPORTANT: Video-to-Video ONLY works on KIE.ai!
 * Replicate models (minimax, kling, runway, pika) do NOT support video input.
 *
 * Available V2V providers:
 * - wan: Wan 2.6 - standard createTask with video_urls array
 * - kling-2.6: Kling 2.6 Motion Control - style transfer with motion
 */

import { videoToVideoKie } from "../../services/kie-ai.js"
import { routeProvider, applyMarkup, logExecutionResult } from "../../services/provider-router.js"

import type { VideoResult } from "./replicate.js"

// V2V Provider type - only KIE.ai providers work
export type V2VProvider = "wan" | "kling-2.6"

export async function videoToVideo(
  videoUrl: string,
  prompt?: string,
  provider?: string,
): Promise<VideoResult> {
  // Default to "wan" - Wan 2.6 is the most reliable V2V provider
  const resolvedProvider = provider ?? "wan"
  const finalPrompt = prompt ?? "continue this video with smooth cinematic motion"

  // Use centralized provider routing
  const routing = await routeProvider("video-to-video", resolvedProvider, "videoToVideo")

  console.log(`[videoToVideo] Provider: ${resolvedProvider}`)
  console.log(`[videoToVideo] Video URL: ${videoUrl}`)
  console.log(`[videoToVideo] Prompt: "${finalPrompt}"`)

  // Route to KIE.ai - this is the ONLY path for V2V
  // (Replicate models don't support video input)
  if (routing.useKie) {
    const result = await videoToVideoKie(videoUrl, finalPrompt, resolvedProvider)
    const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
    logExecutionResult("videoToVideo", "kie", result.cost, displayCost)
    return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
  }

  // If KIE.ai mode is not active (self-hosted with ai_provider=replicate),
  // we still need to use KIE.ai for V2V because Replicate doesn't support it.
  // Log a warning and use KIE.ai anyway.
  console.warn(`[videoToVideo] WARNING: V2V only works on KIE.ai. Using KIE.ai even though ai_provider=${routing.settings.ai_provider}`)

  const result = await videoToVideoKie(videoUrl, finalPrompt, resolvedProvider)
  const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
  logExecutionResult("videoToVideo", "kie", result.cost, displayCost)
  return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
}
