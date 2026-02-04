import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type VideoProvider = "veo" | "veo3" | "veo3.1" | "kling" | "runway" | "pika" | "sora" | "minimax"

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
    imageParam: "first_frame",
    endFrameParam: "last_frame", // veo3.1 supports first+last frame interpolation
    durationParam: "duration",   // veo3.1 uses "duration" not "length"
    validDurations: [4, 6, 8],   // veo3.1 only supports 4, 6, or 8 seconds
    extraInput: { generate_audio: true, resolution: "1080p" },
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

export async function imageToVideo(
  imageUrl: string,
  prompt?: string,
  provider?: VideoProvider,
  generateAudio?: boolean,
  duration?: number,
  endFrameUrl?: string,
): Promise<string> {
  const resolvedProvider = provider ?? "minimax"
  const cfg = VIDEO_MODEL_CONFIGS[resolvedProvider] ?? VIDEO_MODEL_CONFIGS.minimax
  const finalPrompt = prompt ?? "smooth cinematic motion"
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

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    {
      input: {
        prompt: finalPrompt,
        [cfg.imageParam]: imageUrl,
        ...extraInput,
      },
    },
  )

  const videoUrl = String(output)
  console.log(`[imageToVideo] Output: "${videoUrl}"`)
  return videoUrl
}
