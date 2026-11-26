/**
 * Video Remake's delivered resolution (decided 2026-11-26): a caller picks only the size it RECEIVES.
 *
 *   request (run and estimate, no `upscale` key)  resolution?: "480p" | "720p" | "1080p" | "4k", the size delivered
 *   estimate answer and completed job output      resolution: the size delivered
 *   GET /v1/video-remake/style-choice             resolutions: { [engineChoice]: sizes, smallest (the default) first }
 *
 * How the engine makes a size is its own and is never named to a caller. The engine is the authority on a
 * run (its estimate refuses a size it does not offer, 400 `resolution_not_offered`, or cannot have for that
 * request, 409 `resolution_unavailable`); the platform only reads whether the loaded engine works this way
 * (`castSwap.deliveredResolution`, read at load) and, for `style-choice`, which sizes it can deliver per engine
 * choice (`castSwap.deliveredResolutions`), less the steps this deployment's admin switched off.
 *
 * A request that still carries `upscale` is read by the engine as before (lib/video-remake-upscale-choice.ts).
 */
import {
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  CAST_SWAP_RESOLUTIONS_BY_ENGINE,
  NODARO_MOTION_ENGINES,
  VIDEO_REMAKE_FLASH_ENGINES,
  VIDEO_REMAKE_FLASH_RESOLUTIONS,
  type NodaroMotionEngine,
  type VideoRemakeFlashEngine,
} from "@nodaro/shared/models"
import type { PluginSupports } from "./private-plugins/types.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import { upscaleStepOffered } from "./video-remake-upscale-choice.js"

/** A size a run is delivered at ("4k" lower-case, as the request spells it). */
export const VIDEO_REMAKE_DELIVERED_SIZES = ["480p", "720p", "1080p", "4k"] as const
export type VideoRemakeDeliveredSize = (typeof VIDEO_REMAKE_DELIVERED_SIZES)[number]

/** A size the engine makes a run at, the one a delivered size may be stepped up from. */
export type VideoRemakeEngineSize = Exclude<VideoRemakeDeliveredSize, "4k">

/** An engine choice: an engine, or its Flash choice. */
export type VideoRemakeEngineChoice = NodaroMotionEngine | VideoRemakeFlashEngine

/** One delivered size of an engine choice as the engine declares it. */
export interface VideoRemakeDeliveredEntry {
  size: VideoRemakeDeliveredSize
  /** The engine size it is stepped up from; absent: made as the engine makes it. */
  from?: VideoRemakeEngineSize
  /** The engine also makes this size itself (always so for an entry with no `from`). */
  native?: true
}

/** `style-choice`'s `resolutions`: per engine choice, the sizes offered here, smallest (the default) first. */
export type VideoRemakeResolutions = Partial<Record<VideoRemakeEngineChoice, VideoRemakeDeliveredSize[]>>

const ENGINE_CHOICES: readonly VideoRemakeEngineChoice[] = [...NODARO_MOTION_ENGINES, ...VIDEO_REMAKE_FLASH_ENGINES]
const ENGINE_SIZES: readonly VideoRemakeEngineSize[] = ["480p", "720p", "1080p"]
const rank = (size: VideoRemakeDeliveredSize): number => VIDEO_REMAKE_DELIVERED_SIZES.indexOf(size)
const bySize = (a: VideoRemakeDeliveredSize, b: VideoRemakeDeliveredSize): number => rank(a) - rank(b)
const isDeliveredSize = (v: unknown): v is VideoRemakeDeliveredSize => typeof v === "string" && (VIDEO_REMAKE_DELIVERED_SIZES as readonly string[]).includes(v)
const isEngineSize = (v: unknown): v is VideoRemakeEngineSize => typeof v === "string" && (ENGINE_SIZES as readonly string[]).includes(v)
const isFlash = (choice: VideoRemakeEngineChoice): choice is VideoRemakeFlashEngine => (VIDEO_REMAKE_FLASH_ENGINES as readonly string[]).includes(choice)
const ownValue = (o: object, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined)
const isPlainObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether an engine's supports read `resolution` as the size delivered (`castSwap.deliveredResolution`). */
export function engineDeliversResolution(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.deliveredResolution === true
}

/** Whether this process's Cast Swap engine reads `resolution` as the size delivered. */
export function loadedEngineDeliversResolution(): boolean {
  return engineDeliversResolution(getPluginSupports().castSwap)
}

/**
 * The sizes an engine choice's own engine makes, smallest first (the shared catalog's: Nodaro Prism 480p /
 * 720p / 1080p, Nodaro Pulse 720p / 1080p, each Flash choice its own). A new array.
 */
export function engineMadeSizes(choice: VideoRemakeEngineChoice): VideoRemakeEngineSize[] {
  const made: readonly VideoRemakeEngineSize[] = isFlash(choice)
    ? VIDEO_REMAKE_FLASH_RESOLUTIONS[choice]
    : CAST_SWAP_RESOLUTIONS_BY_ENGINE[CAST_SWAP_ENGINE_OF_NODARO_MOTION[choice]]
  return [...made].sort(bySize)
}

/**
 * The engine's declared `castSwap.deliveredResolutions`, read defensively: only known engine choices, an
 * entry whose `size` (and `from`, when it has one) is a size of the contract, the first entry of a size; each
 * list smallest first; an engine choice with nothing left is dropped; anything malformed reads as nothing.
 * Never throws. A new object.
 */
export function deliveredResolutionsOf(cs: PluginSupports["castSwap"] | undefined): Partial<Record<VideoRemakeEngineChoice, VideoRemakeDeliveredEntry[]>> {
  const declared: unknown = (cs as { deliveredResolutions?: unknown } | undefined)?.deliveredResolutions
  if (!isPlainObject(declared)) return {}
  const out: Partial<Record<VideoRemakeEngineChoice, VideoRemakeDeliveredEntry[]>> = {}
  for (const choice of ENGINE_CHOICES) {
    const list = ownValue(declared, choice)
    if (!Array.isArray(list)) continue
    const kept: VideoRemakeDeliveredEntry[] = []
    for (const item of list) {
      if (!isPlainObject(item)) continue
      const size = ownValue(item, "size")
      const from = ownValue(item, "from")
      if (!isDeliveredSize(size) || (from !== undefined && !isEngineSize(from))) continue
      if (kept.some((e) => e.size === size)) continue
      // A size with no `from` is made by the engine itself whatever the entry says.
      const native = from === undefined || ownValue(item, "native") === true
      kept.push({ size, ...(from !== undefined ? { from } : {}), ...(native ? { native: true as const } : {}) })
    }
    if (kept.length > 0) out[choice] = kept.sort((a, b) => bySize(a.size, b.size))
  }
  return out
}

/**
 * The sizes an engine choice's engine makes, read from its declared entries: every engine size a step starts
 * `from` and every size marked `native` (the engine's declaration covers them all), else, for an engine choice the
 * engine declares nothing for, the shared catalog's (`engineMadeSizes`). Smallest first. A new array.
 */
function madeSizesOf(choice: VideoRemakeEngineChoice, entries: readonly VideoRemakeDeliveredEntry[]): VideoRemakeDeliveredSize[] {
  if (entries.length === 0) return engineMadeSizes(choice)
  const made = new Set<VideoRemakeDeliveredSize>()
  for (const e of entries) {
    if (e.from !== undefined) made.add(e.from)
    if (e.native) made.add(e.size)
  }
  return [...made].sort(bySize)
}

/**
 * `style-choice`'s `resolutions`: per engine choice, the sizes it offers on this deployment, smallest (the
 * default) first. `{}` where the engine does not declare `castSwap.deliveredResolution`.
 *
 * The engine's own rule, applied to its declared sizes: a size stepped up `from` an engine size stays while this
 * deployment offers that step (`upscaleStepOffered`: the admin's kill switch, read as the engine reads it; every
 * step off while Topaz video is withheld here), and otherwise only where the engine also makes it itself (`native`),
 * then made as the engine makes it; a size with no `from` is always made as the engine makes it. Where no step is
 * offered at all for an engine choice, it offers the sizes its engine makes, as before the step existed (Nodaro
 * Prism's 480p among them). Every engine choice is answered (whether a Flash choice is offered at all is `flash`'s
 * to say). `precise` is the value the engine is handed (`enginePreciseUpscale`), or null (the settings unread): no
 * Prism-family step then. A new object.
 */
export function deliveredResolutionsOffered(cs: PluginSupports["castSwap"] | undefined, precise: unknown): VideoRemakeResolutions {
  if (!engineDeliversResolution(cs)) return {}
  const declared = deliveredResolutionsOf(cs)
  const out: VideoRemakeResolutions = {}
  for (const choice of ENGINE_CHOICES) {
    const entries = declared[choice] ?? []
    const stepOn = (e: VideoRemakeDeliveredEntry) => e.from !== undefined && upscaleStepOffered(choice, e.from, precise)
    if (!entries.some(stepOn)) {
      out[choice] = madeSizesOf(choice, entries)
      continue
    }
    out[choice] = entries.filter((e) => stepOn(e) || e.native === true).map((e) => e.size)
  }
  return out
}

/** Whether `resolutions` reads the settings: only where a Prism-family engine choice declares a step. */
export function deliveredResolutionsReadSettings(cs: PluginSupports["castSwap"] | undefined): boolean {
  if (!engineDeliversResolution(cs)) return false
  const declared = deliveredResolutionsOf(cs)
  return (["nodaro-prism", "nodaro-prism-flash"] as const).some((choice) => declared[choice]?.some((e) => e.from !== undefined))
}

/** A delivered size in words: "4K" for "4k", the others as they are spelled. */
export function deliveredSizeLabel(size: VideoRemakeDeliveredSize): string {
  return size === "4k" ? "4K" : size
}

/**
 * The size an estimate's answer says the run delivers: its `resolution` from an engine that delivers
 * resolutions; from one that answers the earlier fields (a request read the earlier way), its
 * `outputResolution` where it answers one. Undefined from an engine that answers neither, or a value
 * outside the contract.
 */
export function deliveredSizeOfQuote(quote: unknown): VideoRemakeDeliveredSize | undefined {
  if (!isPlainObject(quote)) return undefined
  const earlier = ownValue(quote, "outputResolution")
  if (isDeliveredSize(earlier)) return earlier
  const size = ownValue(quote, "resolution")
  return isDeliveredSize(size) ? size : undefined
}
