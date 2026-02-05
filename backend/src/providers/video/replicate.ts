import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { imageToVideoKie } from "../../services/kie-ai.js"
import { routeProvider, applyMarkup, logExecutionResult, type ProviderUsed } from "../../services/provider-router.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

// Replicate providers
export type ReplicateVideoProvider = "veo" | "veo3" | "veo3.1" | "kling" | "runway" | "pika" | "sora" | "minimax"

// KIE.ai only providers
export type KieVideoProvider = "kling-turbo" | "grok-i2v" | "sora2-pro"

// All video providers
export type VideoProvider = ReplicateVideoProvider | KieVideoProvider

interface ModelConfig {
  model: string
  imageParam: string
  endFrameParam?: string     // Parameter name for end frame (if supported)
  durationParam?: string     // Parameter name for duration (default: "length")
  validDurations?: number[]  // Valid duration values (if restricted)
  extraInput?: Record<string, unknown>
}

const VIDEO_MODEL_CONFIGS: Record<string, ModelConfig> = {
  minimax: {
    model: "minimax/video-01",
    imageParam: "first_frame_image",
    // minimax doesn't support end frame
    extraInput: { prompt_optimizer: true },
  },
  veo: {
    model: "google/veo-2",
    imageParam: "image",
    // veo2 doesn't support end frame
  },
  veo3: {
    model: "google/veo-3",
    imageParam: "image",
    // veo3 doesn't support end frame (only veo3.1 does)
    extraInput: { generate_audio: true },
  },
  "veo3.1": {
    model: "google/veo-3.1",
    imageParam: "image",         // veo3.1 uses "image" for start frame (not "first_frame")
    endFrameParam: "last_frame", // veo3.1 supports first+last frame interpolation
    durationParam: "duration",   // veo3.1 uses "duration" not "length"
    validDurations: [4, 6, 8],   // veo3.1 only supports 4, 6, or 8 seconds
    extraInput: { generate_audio: true, resolution: "1080p", aspect_ratio: "16:9" },
  },
  kling: {
    model: "kwaivgi/kling-v1.6-pro",
    imageParam: "start_image",
    endFrameParam: "end_image", // kling supports end frame
  },
  runway: {
    model: "runway/gen3a-turbo",
    imageParam: "image",
    endFrameParam: "end_image", // runway supports end frame
  },
  pika: {
    model: "pika-labs/pika",
    imageParam: "image",
    endFrameParam: "end_image", // pika supports end frame
  },
  sora: {
    model: "openai/sora",
    imageParam: "image",
    // sora support unknown
  },
}

export interface VideoResult {
  url: string
  cost: number | null  // Raw cost from provider
  displayCost?: number | null  // Cost with any markup applied
  providerUsed?: ProviderUsed  // Which provider was actually used
}

export async function imageToVideo(
  imageUrl: string,
  prompt?: string,
  provider?: VideoProvider,
  generateAudio?: boolean,
  duration?: number,
  endFrameUrl?: string,
): Promise<VideoResult> {
  const resolvedProvider = provider ?? "minimax"
  const finalPrompt = prompt ?? "smooth cinematic motion"

  // Use centralized provider routing
  const routing = await routeProvider("video", resolvedProvider, "imageToVideo")

  // Route to KIE.ai if supported
  if (routing.useKie) {
    const result = await imageToVideoKie(imageUrl, finalPrompt, resolvedProvider, duration, endFrameUrl)
    const displayCost = applyMarkup(result.cost, routing.costMarkupPercent)
    logExecutionResult("imageToVideo", "kie", result.cost, displayCost)
    return { url: result.url, cost: result.cost, displayCost, providerUsed: "kie" }
  }

  // Use Replicate API (either default or fallback from KIE.ai mode)
  const cfg = VIDEO_MODEL_CONFIGS[resolvedProvider] ?? VIDEO_MODEL_CONFIGS.minimax
  console.log(`[imageToVideo] Provider: ${resolvedProvider}, Model: ${cfg.model}`)
  console.log(`[imageToVideo] Input image param: "${cfg.imageParam}" = "${imageUrl}"`)
  if (endFrameUrl && cfg.endFrameParam) {
    console.log(`[imageToVideo] End frame param: "${cfg.endFrameParam}" = "${endFrameUrl}"`)
  } else if (endFrameUrl && !cfg.endFrameParam) {
    console.log(`[imageToVideo] Warning: End frame provided but ${resolvedProvider} doesn't support it - ignoring`)
  }
  console.log(`[imageToVideo] Motion prompt: "${finalPrompt}"`)

  const extraInput = { ...cfg.extraInput }
  if (resolvedProvider === "veo3" || resolvedProvider === "veo3.1") {
    extraInput.generate_audio = generateAudio !== false
  }

  // Handle duration parameter
  if (duration && duration > 0) {
    const durationParam = cfg.durationParam ?? "length"
    let finalDuration = duration

    // If provider has restricted valid durations, clamp to nearest valid value
    if (cfg.validDurations && cfg.validDurations.length > 0) {
      // Find the closest valid duration
      finalDuration = cfg.validDurations.reduce((prev, curr) =>
        Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
      )
      if (finalDuration !== duration) {
        console.log(`[imageToVideo] Duration ${duration}s clamped to ${finalDuration}s (valid: ${cfg.validDurations.join(", ")})`)
      }
    }

    extraInput[durationParam] = finalDuration
  }

  // Add end frame if provider supports it
  if (endFrameUrl && cfg.endFrameParam) {
    extraInput[cfg.endFrameParam] = endFrameUrl
  }

  // Build the final input object
  const replicateInput = {
    prompt: finalPrompt,
    [cfg.imageParam]: imageUrl,
    ...extraInput,
  }

  // Log the exact request for debugging
  console.log(`[imageToVideo] Replicate request:`, JSON.stringify({
    model: cfg.model,
    input: replicateInput,
  }, null, 2))

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    { input: replicateInput },
  )

  const videoUrl = String(output)
  const cost: number | null = null  // Replicate doesn't provide cost info easily
  const displayCost = applyMarkup(cost, routing.costMarkupPercent)
  logExecutionResult("imageToVideo", "replicate", cost, displayCost)
  console.log(`[imageToVideo] Output: "${videoUrl}"`)
  return { url: videoUrl, cost, displayCost, providerUsed: "replicate" }
}
