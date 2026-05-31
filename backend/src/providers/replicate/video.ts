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
  ReconcileOpts,
} from "../provider.interface.js"
import { extractUrl, runReplicatePrediction } from "./client.js"

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
    "kling-3-omni": {
      model: "kwaivgi/kling-v3-omni-video",
      imageParam: "start_image",
      endFrameParam: "end_image",
      durationParam: "duration",
      validDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      extraInput: { generate_audio: true, aspect_ratio: "16:9", mode: "standard" },
    },
  }

const TEXT_TO_VIDEO_MODELS: Record<string, string> = {
  minimax: "minimax/video-01",
  veo3: "google/veo-3",
  kling: "kwaivgi/kling-v1.6-pro",
  runway: "runwayml/gen4-turbo",
  pika: "pika-labs/pika",
}

export class ReplicateVideoProvider
  implements ImageToVideoProvider, TextToVideoProvider
{
  async imageToVideo(
    imageUrl: string | undefined,
    prompt?: string,
    model?: string,
    duration?: number,
    endFrameUrl?: string,
    options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
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

    // VEO 3/3.1 generate_audio: default true (veo3_lite is KIE-only —
    // Replicate doesn't host the Lite tier, so it's not branched here)
    if (resolvedModel === "veo3" || resolvedModel === "veo3.1") {
      extraInput.generate_audio = true
    }

    // Kling 3 Omni: mode derives from resolution; plus audio, aspect_ratio,
    // negative_prompt, and reference_images from ProviderOptions.
    if (resolvedModel === "kling-3-omni") {
      extraInput.mode = options?.resolution === "1080p" ? "pro" : "standard"
      if (options?.aspectRatio && ["16:9", "9:16", "1:1"].includes(options.aspectRatio)) {
        extraInput.aspect_ratio = options.aspectRatio
      }
      extraInput.generate_audio = options?.generateAudio !== false
      if (options?.negativePrompt) {
        extraInput.negative_prompt = options.negativePrompt
      }
      if (options?.referenceImageUrls && options.referenceImageUrls.length > 0) {
        extraInput.reference_images = options.referenceImageUrls.slice(0, 7)
      }
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

    const { output, cost } = await runReplicatePrediction({
      model: cfg.model,
      input: replicateInput,
      label: "[replicate:imageToVideo]",
      reconcileOpts,
    })

    const videoUrl = extractUrl(typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output)
    console.log(`[Replicate:imageToVideo] Output: "${videoUrl}"`)
    console.log(`[Replicate:imageToVideo] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`)

    return { url: videoUrl, cost }
  }

  async textToVideo(
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    _options?: ProviderOptions,
    reconcileOpts?: ReconcileOpts,
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

    const { output, cost } = await runReplicatePrediction({
      model: replicateModel,
      input: {
        prompt,
        prompt_optimizer: true,
      },
      label: "[replicate:textToVideo]",
      reconcileOpts,
    })

    const resultUrl = extractUrl(typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output)
    console.log(`[Replicate:textToVideo] Output: "${resultUrl}"`)
    console.log(`[Replicate:textToVideo] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`)

    return { url: resultUrl, cost }
  }
}

// =====================================================================
// Phase 1C.3 — Method 8: Frame Interpolation (provider wrappers)
// =====================================================================

/**
 * Method 8 inputs (v4.1 spec §5.13.10). Sparse keyframe → interpolated video.
 * `keyframeUrls[i]` should appear at `timeline[i]` seconds in the output.
 */
export interface ReplicateInterpolateFramesArgs {
  /** Ordered keyframe image URLs (≥2). */
  keyframeUrls: ReadonlyArray<string>
  /** Per-keyframe timestamps in seconds (same length as keyframeUrls). */
  timeline: ReadonlyArray<number>
  /** Provider id: "rife" or "topaz-apollo". */
  model: "rife" | "topaz-apollo"
  /** Output FPS (default 24). */
  fps?: number
}

export interface ReplicateInterpolateFramesResult {
  url: string
  cost?: number
}

/**
 * Frame interpolation across sparse keyframes — UNSUPPORTED on current hosted
 * providers as of 2026-05.
 *
 * - RIFE on Replicate (pollinations/rife-video-interpolation) is deprecated:
 *   "built with a version of Cog or Python that is no longer supported"
 *   (verified at https://replicate.com/pollinations/rife-video-interpolation).
 *   The closest working alternative — zsxkib/film-frame-interpolation-for-large-motion —
 *   takes an EXISTING video + interpolation steps, not a list of sparse
 *   keyframes with timestamps. Different API contract; cannot satisfy Method 8.
 *
 * - Topaz Apollo is a cloud product on topaz.ai with no public REST/Replicate
 *   surface; would require a direct integration on a separate provider track.
 *
 * Throws `provider_not_available:<model>` so Shot List Critic (Section H) can
 * gate `shot_input_mode='frame_interpolation'` at planning time. Update this
 * wrapper when a hosted sparse-keyframe interpolation API ships.
 *
 * TODO(1C.3 Section H): Add Shot List Critic eligibility rule rejecting
 *   `shot_input_mode='frame_interpolation'`.
 * TODO(post-1C.3): Re-evaluate when a Replicate model exposes the
 *   keyframes[]+timeline[] interface. Practical-RIFE (hzwer/Practical-RIFE)
 *   has the right semantics but isn't hosted; would need a Cog-based deploy.
 */
export async function replicateInterpolateFrames(
  args: ReplicateInterpolateFramesArgs,
): Promise<ReplicateInterpolateFramesResult> {
  throw new Error(
    `provider_not_available:${args.model} — no hosted provider exposes a sparse-keyframe video interpolation API as of 2026-05. RIFE on Replicate is deprecated (unsupported Cog version); Topaz Apollo has no public API. See Method 8 TODO in providers/replicate/video.ts.`,
  )
}

// =====================================================================
// Phase 1C.3 — Method 10: Parametric 3D Camera Path (provider wrapper)
// =====================================================================

/**
 * Method 10 inputs (v4.1 spec §5.13.11). Single image + parametric camera path
 * → 3D-orbit video. Stable Video 3D (SV3D) is the reference provider.
 */
export interface ReplicateSV3DArgs {
  /** The conditioning still frame (3D scene seed). */
  imageUrl: string
  /** Camera path descriptor — emitted by the Scene Director. */
  cameraPath: {
    path_kind: "orbit" | "dolly" | "crane" | "arc" | "reveal"
    parameters?: Record<string, unknown>
  }
  /** Optional shot duration (SV3D produces ~5s by default). */
  durationSeconds?: number
}

export interface ReplicateSV3DResult {
  url: string
  cost?: number
}

/**
 * Stable Video 3D camera-path generation — UNSUPPORTED as of 2026-05.
 *
 * SV3D (Stability AI) is available via:
 *   - HuggingFace weights (stabilityai/sv3d) — non-commercial only
 *   - Stability AI's own API + paid Membership ($20/mo, commercial)
 *   - GitHub Stability-AI/generative-models — local Python inference
 *
 * No Replicate-hosted SV3D model was found at the standard owner namespaces
 * (stability-ai/*, lucataco/*, etc.) as of the 2026-05 search. SV3D's
 * camera-path conditioning is exactly what Method 10 needs, but it isn't
 * exposed via a public REST endpoint we can call without standing up a
 * dedicated Stability API integration on a fresh provider track.
 *
 * Throws `provider_not_available:stable-video-3d` so Shot List Critic
 * (Section H) gates `shot_input_mode='camera_path'` at planning time.
 *
 * TODO(1C.3 Section H): Add Shot List Critic eligibility rule rejecting
 *   `shot_input_mode='camera_path'`.
 * TODO(post-1C.3): Either (a) add Stability AI as a new provider with their
 *   /v2beta/3d/stable-video-3d endpoint + Membership credentials, or (b)
 *   wait for a Replicate-hosted SV3D / Stable Virtual Camera deployment.
 *   When wired, populate STATIC_CREDIT_COSTS["stable-video-3d"] + seed
 *   model_pricing accordingly.
 */
export async function replicateSV3D(
  _args: ReplicateSV3DArgs,
): Promise<ReplicateSV3DResult> {
  throw new Error(
    `provider_not_available:stable-video-3d — Stable Video 3D is not hosted on Replicate as of 2026-05. SV3D's camera-path conditioning matches Method 10's contract, but the only public surface is Stability AI's own API (paid Membership). See Method 10 TODO in providers/replicate/video.ts.`,
  )
}
