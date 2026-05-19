/**
 * New Provider Router
 *
 * Uses the ProviderRegistry + config to route operations to the
 * correct provider, with automatic fallback for unsupported models.
 *
 * Key design: `routeAndExecute` is a generic helper that:
 *  1. Builds a routing decision (provider chain + markup)
 *  2. Walks the chain until a provider supports the requested model
 *  3. Calls the user-supplied executor function
 *  4. Wraps the result with cost / displayCost / providerUsed
 *
 * IMPORTANT: Fallback is for UNSUPPORTED models only.
 * If KIE supports a model but returns an error, that error propagates.
 */

import { providerRegistry } from "./registry.js"
import type {
  ProviderCapability,
  ProviderResult,
  ProviderOptions,
  ReconcileOpts,
  ImageGenerationProvider,
  ImageToVideoProvider,
  TextToVideoProvider,
  VideoToVideoProvider,
  MotionTransferProvider,
  VideoUpscaleProvider,
  LipSyncProvider,
  MusicGenerationProvider,
  TextToSpeechProvider,
  TextToSpeechOptions,
} from "./provider.interface.js"
import {
  buildRoutingDecision,
  applyMarkup,
  resolveMarkup,
  type ProviderUsed,
  type RoutingDecision,
} from "./config.js"

// ─── Result type ──────────────────────────────────────────────────

export interface RouteResult {
  url: string
  /** Additional result URLs the provider returned alongside the primary. See
   *  ProviderResult.extraUrls — workers upload these to R2 and frontends list
   *  them as alternates. */
  extraUrls?: readonly string[]
  cost: number | null
  displayCost: number | null
  providerUsed: ProviderUsed
  kieTaskId?: string  // Provider task ID for extend/upscale operations (VEO, Runway)
  /** Provider-reported seed (VEO only). */
  seed?: number
  /** Whether the provider silently used a fallback model (VEO only). */
  fallbackFlag?: boolean
  /** Provider-side generation duration in milliseconds. */
  providerMs?: number
}

// ─── Core routing engine ──────────────────────────────────────────

/**
 * Generic route-and-execute: walks the provider chain, finds the first
 * provider that supports the model, and invokes `executor`.
 *
 * @param capability   e.g. "image-generation"
 * @param model        e.g. "nano-banana"
 * @param operation    human-readable label for logs
 * @param executor     callback that receives the provider instance and
 *                     returns a ProviderResult
 */
async function routeAndExecute(
  capability: ProviderCapability,
  model: string,
  operation: string,
  executor: (provider: unknown) => Promise<ProviderResult>
): Promise<RouteResult> {
  const decision = await buildRoutingDecision(capability, model)

  if (decision.providerChain.length === 0) {
    throw new Error(
      `No provider available for ${capability} (model: ${model}) ` +
        `in current mode (ai_provider=${decision.activeProvider})`
    )
  }

  // Walk chain: first provider that supports this model wins
  for (const providerId of decision.providerChain) {
    const supported = providerRegistry.supportsModel(
      providerId,
      capability,
      model
    )

    if (!supported) {
      console.log(
        `[router] ${operation}: ${providerId} does not support model "${model}" for ${capability} - trying next`
      )
      continue
    }

    // Found a provider that supports the model → execute
    const providerUsed = providerId as ProviderUsed
    console.log(
      `[router] ${operation}: using ${providerId} (model: ${model})`
    )

    const result = await executor(
      providerRegistry.getProvider(providerId)
    )

    const markup = resolveMarkup(decision, providerUsed)
    const displayCost = applyMarkup(result.cost, markup)

    logResult(operation, providerUsed, result.cost, displayCost)

    return {
      url: result.url,
      ...(result.extraUrls?.length ? { extraUrls: result.extraUrls } : {}),
      cost: result.cost,
      displayCost,
      providerUsed,
      kieTaskId: result.kieTaskId,
      seed: result.seed,
      fallbackFlag: result.fallbackFlag,
      providerMs: result.providerMs,
    }
  }

  // No provider in the chain supports this model
  throw new Error(
    `Model "${model}" is not supported for ${capability} by any registered provider`
  )
}

// ─── Convenience wrappers (typed) ─────────────────────────────────
// Each wrapper narrows the provider instance to the correct interface
// so callers get full type safety without casting.

export async function generateImage(
  prompt: string,
  model: string,
  referenceImageUrls?: string[],
  extraParams?: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "image-generation",
    model,
    "generateImage",
    async (instance) => {
      const p = resolveModule<ImageGenerationProvider>(instance, "image")
      return p.generateImage(prompt, referenceImageUrls, model, extraParams, reconcileOpts)
    }
  )
}

export async function editImage(
  imageUrl: string,
  model: string,
  prompt?: string,
  extraParams?: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "image-editing",
    model,
    "editImage",
    async (instance) => {
      const p = resolveModule<ImageGenerationProvider & { editImage: ImageGenerationProvider["generateImage"] }>(instance, "image") as unknown as import("./provider.interface.js").ImageEditingProvider
      return p.editImage(imageUrl, prompt, model, extraParams, reconcileOpts)
    }
  )
}

export async function imageToVideo(
  imageUrl: string | undefined,
  model: string,
  prompt?: string,
  duration?: number,
  endFrameUrl?: string,
  options?: ProviderOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "image-to-video",
    model,
    "imageToVideo",
    async (instance) => {
      const p = resolveModule<ImageToVideoProvider>(instance, "video")
      return p.imageToVideo(imageUrl, prompt, model, duration, endFrameUrl, options, reconcileOpts)
    }
  )
}

export async function textToVideo(
  prompt: string,
  model: string,
  duration?: number,
  aspectRatio?: string,
  options?: ProviderOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "text-to-video",
    model,
    "textToVideo",
    async (instance) => {
      const p = resolveModule<TextToVideoProvider>(instance, "video")
      return p.textToVideo(prompt, model, duration, aspectRatio, options, reconcileOpts)
    }
  )
}

export async function videoToVideo(
  videoUrl: string,
  model: string,
  prompt?: string,
  options?: ProviderOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "video-to-video",
    model,
    "videoToVideo",
    async (instance) => {
      const p = resolveModule<VideoToVideoProvider>(instance, "video")
      return p.videoToVideo(videoUrl, prompt, model, options, reconcileOpts)
    }
  )
}

export async function motionTransfer(
  imageUrl: string,
  videoUrl: string,
  model: string,
  prompt?: string,
  options?: ProviderOptions & {
    characterOrientation?: "image" | "video"
    resolution?: "480p" | "580p" | "720p" | "1080p"
    provider?: string
    backgroundSource?: "input_video" | "input_image"
  },
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "motion-transfer",
    model,
    "motionTransfer",
    async (instance) => {
      const p = resolveModule<MotionTransferProvider>(instance, "video")
      return p.motionTransfer(imageUrl, videoUrl, prompt, options, reconcileOpts)
    }
  )
}

export async function videoUpscale(
  videoUrl: string,
  model: string,
  upscaleFactor?: "1" | "2" | "4",
  options?: ProviderOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "video-upscale",
    model,
    "videoUpscale",
    async (instance) => {
      const p = resolveModule<VideoUpscaleProvider>(instance, "video")
      return p.videoUpscale(videoUrl, upscaleFactor, options, reconcileOpts)
    }
  )
}

export async function lipSync(
  imageUrl: string,
  audioUrl: string,
  model: string,
  prompt?: string,
  resolution?: string,
  audioDurationSec?: number,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "lip-sync",
    model,
    "lipSync",
    async (instance) => {
      const p = resolveModule<LipSyncProvider>(instance, "video")
      return p.lipSync(imageUrl, audioUrl, prompt, model, resolution, audioDurationSec, reconcileOpts)
    }
  )
}

export async function generateMusic(
  prompt: string,
  model: string,
  duration?: number,
  lyrics?: string,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "music-generation",
    model,
    "generateMusic",
    async (instance) => {
      const p = resolveModule<MusicGenerationProvider>(instance, "audio")
      return p.generateMusic(prompt, model, duration, lyrics, reconcileOpts)
    }
  )
}

export async function textToSpeech(
  text: string,
  model: string,
  voice?: string,
  options?: TextToSpeechOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "text-to-speech",
    model,
    "textToSpeech",
    async (instance) => {
      const p = resolveModule<TextToSpeechProvider>(instance, "audio")
      return p.textToSpeech(text, voice, model, options, reconcileOpts)
    }
  )
}

// ─── Internals ────────────────────────────────────────────────────

/**
 * The registry stores the provider instance as `{ image, video, audio }`.
 * This helper extracts the correct module from that object.
 */
function resolveModule<T>(instance: unknown, module: "image" | "video" | "audio"): T {
  const obj = instance as Record<string, unknown>
  const mod = obj[module]
  if (!mod) {
    throw new Error(`Provider instance does not have a "${module}" module`)
  }
  return mod as T
}

function logResult(
  operation: string,
  providerUsed: ProviderUsed,
  cost: number | null,
  displayCost: number | null
): void {
  const costStr = cost !== null ? `$${cost.toFixed(6)}` : "N/A"
  const displayStr = displayCost !== null ? `$${displayCost.toFixed(6)}` : "N/A"
  const markupInfo =
    displayCost !== null && cost !== null && displayCost !== cost
      ? ` (with markup: ${displayStr})`
      : ""

  console.log(
    `[router] ${operation}: completed via ${providerUsed.toUpperCase()}: cost=${costStr}${markupInfo}`
  )
}
