/**
 * Video-to-Video Provider
 *
 * IMPORTANT: Video-to-Video ONLY works on KIE.ai!
 * Uses Wan 2.6 exclusively (only KIE.ai model that supports video input)
 */

import { videoToVideoKie } from "../../services/kie-ai.js"
import { routeProvider, applyMarkup, logExecutionResult } from "../../services/provider-router.js"

import type { VideoResult } from "./replicate.js"

export async function videoToVideo(
  videoUrl: string,
  prompt?: string,
): Promise<VideoResult> {
  const finalPrompt = prompt ?? "continue this video with smooth cinematic motion"

  // Use centralized provider routing (always routes to KIE.ai for V2V)
  const routing = await routeProvider("video-to-video", "wan", "videoToVideo")

  console.log(`[videoToVideo] Using Wan 2.6 via KIE.ai`)
  console.log(`[videoToVideo] Video URL: ${videoUrl}`)
  console.log(`[videoToVideo] Prompt: "${finalPrompt}"`)

  // Route to KIE.ai - this is the ONLY path for V2V
  // (Replicate models don't support video input)
  if (routing.useKie) {
    const result = await videoToVideoKie(videoUrl, finalPrompt, "wan")
    const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
    logExecutionResult("videoToVideo", "kie", result.cost, displayCost)
    return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
  }

  // If KIE.ai mode is not active (self-hosted with ai_provider=replicate),
  // we still need to use KIE.ai for V2V because Replicate doesn't support it.
  // Log a warning and use KIE.ai anyway.
  console.warn(`[videoToVideo] WARNING: V2V only works on KIE.ai. Using KIE.ai even though ai_provider=${routing.settings.ai_provider}`)

  const result = await videoToVideoKie(videoUrl, finalPrompt, "wan")
  const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
  logExecutionResult("videoToVideo", "kie", result.cost, displayCost)
  return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
}
