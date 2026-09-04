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
  LipSyncOptions,
  VideoLipSyncOptions,
  SpeechToVideoProvider,
  SpeechToVideoOptions,
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
import {
  unregisterNodaroCloudProvider,
  registerNodaroCloudProviderIfConnected,
  NODARO_PROVIDER_ID,
} from "./nodaro/index.js"
import { getNodaroCredential } from "../lib/nodaro-connect.js"
import { describeEmptyCapability } from "./provider-keys.js"
import { config } from "../lib/config.js"
import { refreshProviderCredentialsNow } from "../lib/provider-credentials.js"

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
  kieTaskId?: string  // Provider task ID for chained operations (VEO/Runway extend-upscale; Grok task-chained edit/segment)
  /** Grok 2 segment-map only: named region metadata, order-aligned with
   *  [url, ...extraUrls]. See ProviderResult.segments. */
  segments?: readonly { index: number; name: string }[]
  /** Provider-reported seed (VEO only). */
  seed?: number
  /** Whether the provider silently used a fallback model (VEO only). */
  fallbackFlag?: boolean
  /** Provider-side generation duration in milliseconds. */
  providerMs?: number
  /** Relay provenance — see ProviderResult.relayJobId/relayCredits. Only a
   *  NodaroCloud* provider sets these; the router carries them across so the
   *  handlers can persist them onto their own job row (`relayFieldsFrom`).
   *  Absent on every vendor-direct route, which is what keeps the completion
   *  UPDATE byte-identical off a relay — `relayFieldsFrom` keys on PRESENCE,
   *  so the copy below is conditional rather than an `undefined` value. */
  relayJobId?: string
  relayCredits?: number | null
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
/** Self-healing late registration (community).
 *
 *  The boot-time gates miss real cases: a provider key pasted on /setup
 *  after this process loaded its snapshot (the worker learns of it on a
 *  30 s poll — too slow for "paste, then Run"), connect-AFTER-boot (the
 *  operator connects and generates immediately — no restart), and a
 *  transient DB/proxy race at worker boot that silently resolved "not
 *  connected" (both cloud cases hit live, 2026-08-15). When routing finds no
 *  provider, re-read the pasted keys once and (re)register the connection,
 *  then re-route. Cheap: bounded reads, rate-limited to one probe per few
 *  seconds per process — short enough that "Run, paste the key, Run again"
 *  is not refused by the limiter. */
const SELF_HEAL_MIN_INTERVAL_MS = 3_000
let lastSelfHealAt = 0

async function selfHealLateRegistrations(): Promise<boolean> {
  const now = Date.now()
  if (now - lastSelfHealAt < SELF_HEAL_MIN_INTERVAL_MS) return false
  lastSelfHealAt = now
  let keysChanged = false
  try {
    // Resolves after the registry reflects the re-read keys (bounded inside).
    keysChanged = await refreshProviderCredentialsNow()
    if (keysChanged) {
      console.log("[router] provider keys re-read late (self-heal)")
    }
  } catch (err) {
    console.error("[router] provider-key self-heal re-read failed:", err)
  }
  let nodaroRegistered = false
  if (!providerRegistry.getProvider(NODARO_PROVIDER_ID)) {
    try {
      // Bounded probe: a hung DB read must not stall a failing route.
      nodaroRegistered = await Promise.race([
        registerNodaroCloudProviderIfConnected(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
      ])
      if (nodaroRegistered) {
        console.log("[router] nodaro.ai connection registered late (self-heal)")
      }
    } catch (err) {
      console.error("[router] nodaro.ai self-heal registration failed:", err)
    }
  }
  return keysChanged || nodaroRegistered
}

/**
 * The REMOVE direction of the self-heal (#771). Registration was one-way:
 * boot and selfHealLateRegistrations can ADD the nodaro provider, but a
 * disconnect only cleared the token — the registration outlived it in every
 * process, and the walk below selected it and threw the raw
 * "nodaro.ai is not connected" from inside the provider call (no per-provider
 * catch on the walk, deliberately). The disconnect route unregisters in the
 * API process, but routing runs in the WORKER and orchestrator processes too
 * — they can only fix themselves. So: before walking a chain that contains
 * the cloud provider, verify the credential; gone -> drop the registration
 * and let the caller rebuild the chain, which then either finds another
 * provider or takes the honest empty-chain path. A transient read failure is
 * UNKNOWN, not stale — never unregister on it.
 */
async function dropStaleNodaroRegistration(decision: RoutingDecision): Promise<boolean> {
  if (!decision.providerChain.includes(NODARO_PROVIDER_ID as ProviderUsed)) return false
  if (!providerRegistry.getProvider(NODARO_PROVIDER_ID)) return false
  try {
    if ((await getNodaroCredential()) !== null) return false
  } catch {
    return false
  }
  unregisterNodaroCloudProvider()
  console.log("[router] nodaro.ai registration dropped (connection cleared) — rebuilding chain")
  return true
}

async function routeAndExecute(
  capability: ProviderCapability,
  model: string,
  operation: string,
  executor: (provider: unknown) => Promise<ProviderResult>
): Promise<RouteResult> {
  let decision = await buildRoutingDecision(capability, model)
  if (await dropStaleNodaroRegistration(decision)) {
    decision = await buildRoutingDecision(capability, model)
  }

  // A keyless community install has NO registered providers, so an empty
  // chain is its resting state — and exactly the state where a cloud
  // connection registered late (or missed at boot) is the only thing that
  // could serve the job. Try the heal here too, not only after a walked chain
  // came back null; otherwise the throw below fires first.
  if (decision.providerChain.length === 0 && (await selfHealLateRegistrations())) {
    decision = await buildRoutingDecision(capability, model)
  }
  if (decision.providerChain.length === 0) {
    throw new Error(
      `No provider available for ${capability} (model: ${model}) ` +
        `in current mode (ai_provider=${decision.activeProvider})`
    )
  }

  let result = await walkChainAndExecute(capability, model, operation, executor, decision)
  if (result === null && (await selfHealLateRegistrations())) {
    // The chain may now include a late-registered key or the cloud
    // connection — rebuild and re-walk.
    decision = await buildRoutingDecision(capability, model)
    result = await walkChainAndExecute(capability, model, operation, executor, decision)
  }
  if (result === null) {
    // Say WHY nothing served it — a missing key reads very differently from an
    // unknown model, and a self-hoster can only act on the first.
    throw new Error(
      describeEmptyCapability(
        capability,
        model,
        {
          REPLICATE_API_TOKEN: config.REPLICATE_API_TOKEN,
          KIE_API_KEY: config.KIE_API_KEY,
          ELEVENLABS_API_KEY: config.ELEVENLABS_API_KEY,
          ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
          GEMINI_API_KEY: config.GEMINI_API_KEY,
          FAL_KEY: config.FAL_KEY,
          HEYGEN_API_KEY: config.HEYGEN_API_KEY,
          BEEBLE_API_KEY: config.BEEBLE_API_KEY,
          APIFY_API_TOKEN: config.APIFY_API_TOKEN,
        },
        providerRegistry.getProvider(NODARO_PROVIDER_ID) !== null,
      ),
    )
  }
  return result
}

async function walkChainAndExecute(
  capability: ProviderCapability,
  model: string,
  operation: string,
  executor: (provider: unknown) => Promise<ProviderResult>,
  decision: RoutingDecision
): Promise<RouteResult | null> {


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
      ...(result.segments?.length ? { segments: result.segments } : {}),
      seed: result.seed,
      fallbackFlag: result.fallbackFlag,
      providerMs: result.providerMs,
      // Relay provenance (spec §8.2 lane 1). Conditional: a vendor result must
      // yield an object with NO such key, because `relayFieldsFrom` decides
      // whether to write the two columns by asking whether relayJobId is set.
      ...(result.relayJobId
        ? { relayJobId: result.relayJobId, relayCredits: result.relayCredits ?? null }
        : {}),
    }
  }

  // No provider in the chain supports this model
  return null
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
    negativePrompt?: string
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
  options?: LipSyncOptions,
): Promise<RouteResult> {
  return routeAndExecute(
    "lip-sync",
    model,
    "lipSync",
    async (instance) => {
      const p = resolveModule<LipSyncProvider>(instance, "video")
      return p.lipSync(imageUrl, audioUrl, prompt, model, resolution, audioDurationSec, reconcileOpts, options)
    }
  )
}

/**
 * Speech-to-video (Wan S2V): image + speech audio -> speaking-performance
 * video. Single-model capability — the routing id is the node's own name and
 * each provider resolves its real model internally. Walking the chain (rather
 * than constructing KieVideoProvider directly, the pre-#644 shape) is what
 * lets a keyless connected install reach the cloud, and what gives a keyless
 * UNconnected install the router's actionable missing-key message.
 */
export async function speechToVideo(
  imageUrl: string,
  audioUrl: string,
  prompt: string,
  resolution?: string,
  options?: SpeechToVideoOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "speech-to-video",
    "speech-to-video",
    "speechToVideo",
    async (instance) => {
      const p = resolveModule<SpeechToVideoProvider>(instance, "video")
      return p.speechToVideo(imageUrl, audioUrl, prompt, resolution, options, reconcileOpts)
    }
  )
}

/**
 * Video-to-video lip-sync (AI dubbing) for video-input models (volcengine).
 * Same "lip-sync" capability/routing as lipSync(), but dispatches the provider's
 * optional `lipSyncVideo` (video_url + audio_url + dubbing toggles, no prompt).
 */
export async function lipSyncVideo(
  videoUrl: string,
  audioUrl: string,
  model: string,
  opts: VideoLipSyncOptions,
  audioDurationSec?: number,
  reconcileOpts?: ReconcileOpts,
): Promise<RouteResult> {
  return routeAndExecute(
    "lip-sync",
    model,
    "lipSync",
    async (instance) => {
      const p = resolveModule<LipSyncProvider>(instance, "video")
      if (!p.lipSyncVideo) {
        throw new Error(`Provider for ${model} does not implement video lip-sync`)
      }
      return p.lipSyncVideo(videoUrl, audioUrl, opts, model, audioDurationSec, reconcileOpts)
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
