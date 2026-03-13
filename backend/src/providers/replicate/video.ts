/**
 * Replicate Video Provider
 *
 * Implements ImageToVideoProvider and TextToVideoProvider interfaces.
 * Extracted from providers/video/replicate.ts and providers/video/text-to-video.ts.
 */

import type {
  ImageToVideoProvider,
  TextToVideoProvider,
  ProviderResult,
  ProviderOptions,
} from "../provider.interface.js"
import { replicate, extractUrl, extractCost } from "./client.js"

interface ReplicateVideoModelConfig {
  model: string
  imageParam: string
  endFrameParam?: string // Parameter name for end frame (if supported)
  durationParam?: string // Parameter name for duration (default: "length")
  validDurations?: number[] // Valid duration values (if restricted)
  extraInput?: Record<string, unknown>
}

const VIDEO_MODEL_CONFIGS: Record<string, ReplicateVideoModelConfig> =
  {
    minimax: {
      model: "minimax/video-01",
      imageParam: "first_frame_image",
      // minimax doesn't support end frame
      extraInput: { prompt_optimizer: true },
    },
    veo3: {
      model: "google/veo-3",
      imageParam: "image",
      // veo3 doesn't support end frame (only veo3.1 does)
      extraInput: { generate_audio: true },
    },
    "veo3.1": {
      model: "google/veo-3.1",
      imageParam: "image", // veo3.1 uses "image" for start frame (not "first_frame")
      endFrameParam: "last_frame", // veo3.1 supports first+last frame interpolation
      durationParam: "duration", // veo3.1 uses "duration" not "length"
      validDurations: [4, 6, 8], // veo3.1 only supports 4, 6, or 8 seconds
      extraInput: {
        generate_audio: true,
        resolution: "1080p",
        aspect_ratio: "16:9",
      },
    },
    kling: {
      model: "kwaivgi/kling-v1.6-pro",
      imageParam: "start_image",
      endFrameParam: "end_image", // kling supports end frame
    },
    runway: {
      model: "runwayml/gen4-turbo",
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

const TEXT_TO_VIDEO_MODELS: Record<string, string> = {
  minimax: "minimax/video-01",
  veo3: "google/veo-3",
  kling: "kwaivgi/kling-v1.6-pro",
  runway: "runwayml/gen4-turbo",
  pika: "pika-labs/pika",
  sora: "openai/sora",
}

export class ReplicateVideoProvider
  implements ImageToVideoProvider, TextToVideoProvider
{
  async imageToVideo(
    imageUrl: string,
    prompt?: string,
    model?: string,
    duration?: number,
    endFrameUrl?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult> {
    const resolvedModel = model ?? "minimax"
    const cfg =
      VIDEO_MODEL_CONFIGS[resolvedModel] ??
      VIDEO_MODEL_CONFIGS.minimax
    const finalPrompt = prompt ?? "smooth cinematic motion"

    console.log(
      `[Replicate:imageToVideo] Provider: ${resolvedModel}, Model: ${cfg.model}`
    )
    console.log(
      `[Replicate:imageToVideo] Input image param: "${cfg.imageParam}" = "${imageUrl}"`
    )
    if (endFrameUrl && cfg.endFrameParam) {
      console.log(
        `[Replicate:imageToVideo] End frame param: "${cfg.endFrameParam}" = "${endFrameUrl}"`
      )
    } else if (endFrameUrl && !cfg.endFrameParam) {
      console.log(
        `[Replicate:imageToVideo] Warning: End frame provided but ${resolvedModel} doesn't support it - ignoring`
      )
    }
    console.log(
      `[Replicate:imageToVideo] Motion prompt: "${finalPrompt}"`
    )

    const extraInput = { ...cfg.extraInput }

    // VEO 3/3.1 generate_audio: default true
    if (resolvedModel === "veo3" || resolvedModel === "veo3.1") {
      extraInput.generate_audio = true
    }

    // Handle duration parameter
    if (duration && duration > 0) {
      const durationParam = cfg.durationParam ?? "length"
      let finalDuration = duration

      // If provider has restricted valid durations, clamp to nearest valid value
      if (cfg.validDurations && cfg.validDurations.length > 0) {
        finalDuration = cfg.validDurations.reduce((prev, curr) =>
          Math.abs(curr - duration) < Math.abs(prev - duration)
            ? curr
            : prev
        )
        if (finalDuration !== duration) {
          console.log(
            `[Replicate:imageToVideo] Duration ${duration}s clamped to ${finalDuration}s (valid: ${cfg.validDurations.join(", ")})`
          )
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
    console.log(
      `[Replicate:imageToVideo] Replicate request:`,
      JSON.stringify(
        {
          model: cfg.model,
          input: replicateInput,
        },
        null,
        2
      )
    )

    const prediction = await replicate.predictions.create({
      model: cfg.model as `${string}/${string}`,
      input: replicateInput,
    })
    const completed = await replicate.wait(prediction)
    const output = completed.output

    const videoUrl = extractUrl(typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output)
    console.log(`[Replicate:imageToVideo] Output: "${videoUrl}"`)

    const cost = extractCost(completed.metrics as Record<string, unknown> | undefined)
    console.log(`[Replicate:imageToVideo] Prediction metrics:`, JSON.stringify(completed.metrics))
    console.log(`[Replicate:imageToVideo] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`)

    return { url: videoUrl, cost }
  }

  async textToVideo(
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    _options?: ProviderOptions
  ): Promise<ProviderResult> {
    const resolvedModel = model ?? "minimax"
    const replicateModel =
      TEXT_TO_VIDEO_MODELS[resolvedModel] ??
      TEXT_TO_VIDEO_MODELS.minimax

    console.log(
      `[Replicate:textToVideo] Provider: ${resolvedModel}, Model: ${replicateModel}`
    )
    console.log(
      `[Replicate:textToVideo] Prompt: "${prompt}"`
    )

    const prediction = await replicate.predictions.create({
      model: replicateModel as `${string}/${string}`,
      input: {
        prompt,
        prompt_optimizer: true,
      },
    })
    const completed = await replicate.wait(prediction)
    const output = completed.output

    const resultUrl = extractUrl(typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output)
    console.log(`[Replicate:textToVideo] Output: "${resultUrl}"`)

    const cost = extractCost(completed.metrics as Record<string, unknown> | undefined)
    console.log(`[Replicate:textToVideo] Prediction metrics:`, JSON.stringify(completed.metrics))
    console.log(`[Replicate:textToVideo] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`)

    return { url: resultUrl, cost }
  }
}
