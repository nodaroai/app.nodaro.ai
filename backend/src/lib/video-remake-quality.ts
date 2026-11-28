/**
 * Video Remake's Quality choice (decided 2026-11-27): how a delivered size is made.
 *
 *   request (run and estimate)  quality?: "full" | "economy"   (the older "draft" stays what it was)
 *   estimate answer             quality (how this quote is made), qualityOffered (both ways exist for this
 *                               request), engineResolution (economy only: the size made before the step)
 *   completed job output        quality, and where economy's step was applied engineVideoUrl / engineWidth /
 *                               engineHeight / engineResolution (the take before the step: the engine keeps it
 *                               server-only, and its OWNER's own job reads answer it by these names for a run that
 *                               states quality "economy", lib/job-owner-output.ts — never anyone else's read; kept
 *                               with the result and counted toward the owner's storage, a companion of it,
 *                               lib/asset-companions.ts)
 *   GET /v1/video-remake/style-choice   quality: { [engineChoice]: sizes where the choice exists here }
 *
 * "economy" (and a request that names neither) is the run as it was before the choice: the engine makes one
 * size below and the result is stepped up to the size delivered. "full": the engine makes the size delivered
 * itself, no step. Every one of those fields is answered only for a request that NAMES `quality`: a request
 * without it is answered exactly as before.
 *
 * The engine is its authority. The platform only reads whether the loaded engine takes the choice
 * (`castSwap.quality`, read at load) and, for `style-choice`, where the choice exists (`castSwap.qualityFull`
 * less the steps this deployment's admin switched off). An engine that does not declare it is never sent
 * `quality: "full" | "economy"` (middleware/video-remake-quality.ts): it would refuse the value.
 */
import { NODARO_MOTION_ENGINES, VIDEO_REMAKE_FLASH_ENGINES } from "@nodaro/shared/models"
import type { PluginSupports } from "./private-plugins/types.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import { upscaleStepOffered } from "./video-remake-upscale-choice.js"
import {
  VIDEO_REMAKE_DELIVERED_SIZES,
  deliveredResolutionsOf,
  engineDeliversResolution,
  type VideoRemakeDeliveredSize,
  type VideoRemakeEngineChoice,
  type VideoRemakeEngineSize,
} from "./video-remake-delivered-resolution.js"

/** The request's choice, and the estimate's and the completed job's answer. */
export const VIDEO_REMAKE_QUALITIES = ["full", "economy"] as const
export type VideoRemakeQuality = (typeof VIDEO_REMAKE_QUALITIES)[number]

/** `style-choice`'s `quality`: per engine choice, the delivered sizes where the choice exists here, smallest first. */
export type VideoRemakeQualityOffered = Partial<Record<VideoRemakeEngineChoice, VideoRemakeDeliveredSize[]>>

const ENGINE_CHOICES: readonly VideoRemakeEngineChoice[] = [...NODARO_MOTION_ENGINES, ...VIDEO_REMAKE_FLASH_ENGINES]
const ENGINE_SIZES: readonly VideoRemakeEngineSize[] = ["480p", "720p", "1080p"]
const rank = (size: VideoRemakeDeliveredSize): number => VIDEO_REMAKE_DELIVERED_SIZES.indexOf(size)
const isDeliveredSize = (v: unknown): v is VideoRemakeDeliveredSize => typeof v === "string" && (VIDEO_REMAKE_DELIVERED_SIZES as readonly string[]).includes(v)
const ownValue = (o: object, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined)
const isPlainObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether `v` is a value of the choice ("full" or "economy"; never the older "draft"). */
export function isVideoRemakeQuality(v: unknown): v is VideoRemakeQuality {
  return v === "full" || v === "economy"
}

/** Whether an engine's supports take the Quality choice (`castSwap.quality`). */
export function engineTakesQuality(cs: PluginSupports["castSwap"] | undefined): boolean {
  return (cs as { quality?: unknown } | undefined)?.quality === true
}

/** Whether this process's Cast Swap engine takes the Quality choice. An engine without it is never sent the value. */
export function loadedEngineTakesQuality(): boolean {
  return engineTakesQuality(getPluginSupports().castSwap)
}

/**
 * The engine's declared `castSwap.qualityFull`, read defensively: only known engine choices and sizes of the
 * contract, each size once, smallest first; an engine choice with nothing left is dropped; anything malformed
 * reads as nothing. Never throws. A new object.
 */
export function qualityFullOf(cs: PluginSupports["castSwap"] | undefined): VideoRemakeQualityOffered {
  const declared: unknown = (cs as { qualityFull?: unknown } | undefined)?.qualityFull
  if (!isPlainObject(declared)) return {}
  const out: VideoRemakeQualityOffered = {}
  for (const choice of ENGINE_CHOICES) {
    const list = ownValue(declared, choice)
    if (!Array.isArray(list)) continue
    const kept: VideoRemakeDeliveredSize[] = []
    for (const size of list) {
      if (isDeliveredSize(size) && !kept.includes(size)) kept.push(size)
    }
    if (kept.length > 0) out[choice] = kept.sort((a, b) => rank(a) - rank(b))
  }
  return out
}

/**
 * `style-choice`'s `quality`: per engine choice, the delivered sizes where the Quality choice exists on this
 * deployment, smallest first. A size is one when the engine can make it itself in Full
 * (`castSwap.qualityFull[choice]`) AND it is delivered here by a step (`castSwap.deliveredResolutions`: an entry
 * with a `from` whose step this deployment offers, `upscaleStepOffered`, read as the delivered sizes read it), so
 * the two ways differ. An engine choice with no such size is left out. `{}` where the engine does not take the
 * choice (`castSwap.quality`) or does not deliver resolutions. `precise` is the value the engine is handed
 * (`enginePreciseUpscale`), or null (the settings unread): no Prism-family size then. A new object.
 */
export function qualityOffered(cs: PluginSupports["castSwap"] | undefined, precise: unknown): VideoRemakeQualityOffered {
  if (!engineTakesQuality(cs) || !engineDeliversResolution(cs)) return {}
  const full = qualityFullOf(cs)
  const delivered = deliveredResolutionsOf(cs)
  const out: VideoRemakeQualityOffered = {}
  for (const choice of ENGINE_CHOICES) {
    const sizes = (delivered[choice] ?? [])
      .filter((e) => e.from !== undefined && upscaleStepOffered(choice, e.from, precise) && full[choice]?.includes(e.size) === true)
      .map((e) => e.size)
    if (sizes.length > 0) out[choice] = sizes
  }
  return out
}

/** The Quality fields of an estimate's answer, each kept only when it is a value of the contract. */
export interface VideoRemakeQualityQuote {
  quality?: VideoRemakeQuality
  qualityOffered?: boolean
  engineResolution?: VideoRemakeEngineSize
}

/** The Quality fields of an estimate's answer (an engine without the choice, or a request that named none, answers none: an empty object). A new object. */
export function qualityQuoteOf(quote: unknown): VideoRemakeQualityQuote {
  if (!isPlainObject(quote)) return {}
  const quality = ownValue(quote, "quality")
  const offered = ownValue(quote, "qualityOffered")
  const engineSize = ownValue(quote, "engineResolution")
  return {
    ...(isVideoRemakeQuality(quality) ? { quality } : {}),
    ...(typeof offered === "boolean" ? { qualityOffered: offered } : {}),
    ...(typeof engineSize === "string" && (ENGINE_SIZES as readonly string[]).includes(engineSize) ? { engineResolution: engineSize as VideoRemakeEngineSize } : {}),
  }
}

/**
 * A run, estimate or intent body as the loaded engine may be sent it: `quality: "full" | "economy"` taken out
 * where the engine does not take the choice (it would refuse the value), so the request is the one of before the
 * choice, which is what "economy" means. The SAME object whenever there is nothing to take out: no `quality`, the
 * older `"draft"` (or any other value: the engine's own refusal), an engine that takes the choice, or a body that
 * is not a plain object. Never mutates.
 */
export function withQualityTheEngineTakes<T>(body: T, takesQuality: boolean): T {
  if (takesQuality || !isPlainObject(body)) return body
  if (!isVideoRemakeQuality(ownValue(body, "quality"))) return body
  const { quality: _dropped, ...rest } = body as Record<string, unknown>
  return rest as T
}
