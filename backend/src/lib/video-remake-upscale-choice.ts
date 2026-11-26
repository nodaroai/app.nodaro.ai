/**
 * Video Remake's upscale choice (decided 2026-11-24): whether the finished
 * video is upscaled straight to the next size and delivered at it
 * (480p → 720p, 720p → 1080p, 1080p → 4K; the 4K size is spelled "4k").
 *
 *   request (run and estimate)  upscale?: "off" | "next"
 *   estimate answer             resolution (the engine's size), outputResolution
 *                               (the size delivered), upscale (the choice made),
 *                               upscaleOffered, breakdown.upscale ("next" only)
 *   completed job output        outputResolution, and on a "next" run
 *                               upscale: "applied" | "skipped"
 *
 * The engine is its authority: it decides where the choice is offered (never
 * on a draft or a trend run, nor where the deployment has not turned it on; a
 * 1080p run is offered it too, delivered at 4K) and answers a "next" asked
 * where it is not offered as "off". The platform only says whether the loaded engine takes the field at all
 * (`castSwap.upscaleChoice`, read at load), and reads the estimate's answer
 * field by field.
 */
import {
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_OF_FLASH,
  VIDEO_REMAKE_FLASH_ENGINES,
  type NodaroMotionEngine,
  type VideoRemakeFlashEngine,
} from "@nodaro/shared/models"
import type { PluginSupports } from "./private-plugins/types.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import {
  PRECISE_UPSCALE_ALL_OFF,
  effectivePreciseUpscale,
  engineTakesPreciseUpscale,
  type NodaroMotionPreciseUpscale,
  type NodaroMotionPreciseUpscaleEffective,
} from "./cast-swap-prism-precise-upscale.js"
import { topazVideoDisabledHere } from "./topaz-video-availability.js"

/** The request's choice, and the estimate's effective one. */
export const VIDEO_REMAKE_UPSCALE_CHOICES = ["off", "next"] as const
export type VideoRemakeUpscaleChoice = (typeof VIDEO_REMAKE_UPSCALE_CHOICES)[number]

/** A completed "next" run's outcome: the upscale was delivered, or it failed and the engine's size was. */
export type VideoRemakeUpscaleOutcome = "applied" | "skipped"

/** The sizes the engine makes a run at (`resolution`). */
export type VideoRemakeResolution = "480p" | "720p" | "1080p"

/** The sizes a run is delivered at (`outputResolution`): the engine's sizes, and 4K for an upscaled 1080p run. */
export const VIDEO_REMAKE_OUTPUT_RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const
export type VideoRemakeOutputResolution = (typeof VIDEO_REMAKE_OUTPUT_RESOLUTIONS)[number]

/** A delivered size in words: "4K" for "4k", the others as they are spelled. */
export function outputResolutionLabel(size: VideoRemakeOutputResolution): string {
  return size === "4k" ? "4K" : size
}

/** Whether an engine's supports take the upscale choice (`castSwap.upscaleChoice`). */
export function engineTakesUpscaleChoice(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.upscaleChoice === true
}

/** Whether this process's Cast Swap engine takes the upscale choice. An engine without it is never sent the field. */
export function loadedEngineTakesUpscaleChoice(): boolean {
  return engineTakesUpscaleChoice(getPluginSupports().castSwap)
}

/**
 * The estimate's upscale fields, each kept only when it is a value of the contract. `resolution` is the
 * engine's size on a request read the earlier way, the size delivered on one read the new way
 * (lib/video-remake-delivered-resolution.ts), so it may be "4k".
 */
export interface VideoRemakeUpscaleQuote {
  resolution?: VideoRemakeOutputResolution
  outputResolution?: VideoRemakeOutputResolution
  upscale?: VideoRemakeUpscaleChoice
  upscaleOffered?: boolean
}

const isOutputResolution = (v: unknown): v is VideoRemakeOutputResolution =>
  typeof v === "string" && (VIDEO_REMAKE_OUTPUT_RESOLUTIONS as readonly string[]).includes(v)
const isChoice = (v: unknown): v is VideoRemakeUpscaleChoice => v === "off" || v === "next"

/** The upscale fields of an estimate's answer (an older engine answers none: an empty object). A new object. */
export function upscaleQuoteOf(quote: unknown): VideoRemakeUpscaleQuote {
  if (typeof quote !== "object" || quote === null) return {}
  const q = quote as Record<string, unknown>
  return {
    ...(isOutputResolution(q.resolution) ? { resolution: q.resolution } : {}),
    ...(isOutputResolution(q.outputResolution) ? { outputResolution: q.outputResolution } : {}),
    ...(isChoice(q.upscale) ? { upscale: q.upscale } : {}),
    ...(typeof q.upscaleOffered === "boolean" ? { upscaleOffered: q.upscaleOffered } : {}),
  }
}

/**
 * What "next" delivers, per engine and size, as clients read it before a clip is added
 * (`upscaleTo` on `GET /v1/video-remake/style-choice`, decided 2026-11-24).
 *
 * The engine declares what it CAN do (`castSwap.upscaleNext`, only while its switch is on); the
 * platform removes what this deployment's admin switched off, reading the admin's Precise upscale
 * (`nodaro_motion_precise_upscale`) exactly as the engine reads it: the value it is handed
 * (`enginePreciseUpscale`, the same one `tk.settings.nodaroMotionPreciseUpscale()` answers), taken as a
 * kill switch per engine size. Nodaro Prism: the size's row, "off" or missing = not offered, a target =
 * offered. Nodaro Prism Flash: its own `flash` row for the size, else the size's row. Nodaro Pulse and
 * Nodaro Pulse Flash have no row: offered wherever the engine declares it. The estimate's
 * `upscaleOffered` stays the authority for an actual run (never on a draft or a trend run).
 */
export type VideoRemakeUpscaleSize = VideoRemakeResolution
export type VideoRemakeUpscaleTarget = Exclude<VideoRemakeOutputResolution, "480p">
export type VideoRemakeUpscaleEngine = NodaroMotionEngine | VideoRemakeFlashEngine
export type VideoRemakeUpscaleTo = Partial<Record<VideoRemakeUpscaleEngine, Partial<Record<VideoRemakeUpscaleSize, VideoRemakeUpscaleTarget>>>>

const UPSCALE_ENGINES: readonly VideoRemakeUpscaleEngine[] = [...NODARO_MOTION_ENGINES, ...VIDEO_REMAKE_FLASH_ENGINES]
const UPSCALE_SIZES: readonly VideoRemakeUpscaleSize[] = ["480p", "720p", "1080p"]
const UPSCALE_TARGETS: readonly VideoRemakeUpscaleTarget[] = ["720p", "1080p", "4k"]
/** The admin's row values that turn a size on (any Topaz target). */
const PRECISE_UPSCALE_ON: readonly unknown[] = ["720p", "1080p", "4k"]

const ownValue = (o: object, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined)
const isPlainObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * The engine's declared `castSwap.upscaleNext`, read defensively: only known engine ids, sizes and
 * targets; an engine with no size left is dropped; anything malformed reads as nothing. Never throws.
 * A new object.
 */
export function upscaleNextOf(cs: PluginSupports["castSwap"] | undefined): VideoRemakeUpscaleTo {
  const declared: unknown = (cs as { upscaleNext?: unknown } | undefined)?.upscaleNext
  if (!isPlainObject(declared)) return {}
  const out: VideoRemakeUpscaleTo = {}
  for (const engine of UPSCALE_ENGINES) {
    const sizes = ownValue(declared, engine)
    if (!isPlainObject(sizes)) continue
    const kept: Partial<Record<VideoRemakeUpscaleSize, VideoRemakeUpscaleTarget>> = {}
    for (const size of UPSCALE_SIZES) {
      const target = ownValue(sizes, size)
      if (UPSCALE_TARGETS.includes(target as VideoRemakeUpscaleTarget)) kept[size] = target as VideoRemakeUpscaleTarget
    }
    if (Object.keys(kept).length > 0) out[engine] = kept
  }
  return out
}

/**
 * The admin's Precise upscale as the engine is handed it (`tk.settings.nodaroMotionPreciseUpscale()`):
 * null where this engine does not declare `castSwap.preciseUpscale` (it reads no row), every size "off"
 * while this deployment withholds Topaz, else the effective setting (a size never saved at its default).
 * The ONE resolver the toolkit and `upscaleTo` share. A fresh object.
 */
export function enginePreciseUpscale(
  stored: NodaroMotionPreciseUpscale | null | undefined,
  cs: PluginSupports["castSwap"] | undefined,
): NodaroMotionPreciseUpscaleEffective | typeof PRECISE_UPSCALE_ALL_OFF | null {
  if (!engineTakesPreciseUpscale(cs)) return null
  if (topazVideoDisabledHere()) return structuredClone(PRECISE_UPSCALE_ALL_OFF) as typeof PRECISE_UPSCALE_ALL_OFF
  return effectivePreciseUpscale(stored)
}

/** Whether the admin's row (as the engine reads it) offers the choice at `size` on a Prism-family engine. */
function prismRowOffers(precise: unknown, size: VideoRemakeUpscaleSize, flash: boolean): boolean {
  if (!isPlainObject(precise)) return false
  const flashRows = flash ? ownValue(precise, "flash") : undefined
  const entry = isPlainObject(flashRows) && Object.prototype.hasOwnProperty.call(flashRows, size) ? ownValue(flashRows, size) : ownValue(precise, size)
  return PRECISE_UPSCALE_ON.includes(entry)
}

/**
 * The deployment's kill switch for one step up from the engine's `size` on `engine` (an engine or a Flash
 * choice), read exactly as the engine reads it: off everywhere while this deployment withholds Topaz; Nodaro
 * Pulse and Nodaro Pulse Flash have no row (on); Nodaro Prism reads the size's row, Nodaro Prism Flash its own
 * `flash` row, else the size's. `precise` is the value the engine is handed (`enginePreciseUpscale`), or null
 * (no Prism-family step). The one rule `upscaleToOffered` and the delivered sizes
 * (lib/video-remake-delivered-resolution.ts) share.
 */
export function upscaleStepOffered(engine: VideoRemakeUpscaleEngine, size: VideoRemakeUpscaleSize, precise: unknown): boolean {
  if (topazVideoDisabledHere()) return false
  const base = isFlashEngine(engine) ? NODARO_MOTION_ENGINE_OF_FLASH[engine] : engine
  return base === "nodaro-pulse" || prismRowOffers(precise, size, engine === "nodaro-prism-flash")
}

/**
 * `upscaleTo`: the engine's declared map with every size the admin switched off removed (the module
 * doc above). `precise` is the value the engine is handed (`enginePreciseUpscale`), or null when it is
 * null or the settings could not be read: Prism and Prism Flash are then offered nowhere, Pulse and
 * Pulse Flash as declared. `{}` when the engine does not take the choice (`castSwap.upscaleChoice`),
 * declares no map, or this deployment withholds the upscale step (every engine's "next" runs it). An engine with no size left is left out. A new object.
 */
export function upscaleToOffered(cs: PluginSupports["castSwap"] | undefined, precise: unknown): VideoRemakeUpscaleTo {
  if (!engineTakesUpscaleChoice(cs)) return {}
  // Every engine's "next" (Pulse's too) runs the same upscale step: while this deployment withholds it,
  // no run is offered the choice, so nothing is.
  if (topazVideoDisabledHere()) return {}
  const declared = upscaleNextOf(cs)
  const out: VideoRemakeUpscaleTo = {}
  for (const engine of UPSCALE_ENGINES) {
    const sizes = declared[engine]
    if (!sizes) continue
    const kept: Partial<Record<VideoRemakeUpscaleSize, VideoRemakeUpscaleTarget>> = {}
    for (const size of UPSCALE_SIZES) {
      const target = sizes[size]
      if (target === undefined) continue
      if (upscaleStepOffered(engine, size, precise)) kept[size] = target
    }
    if (Object.keys(kept).length > 0) out[engine] = kept
  }
  return out
}

/** Whether the engine's declared map names a Prism-family engine: only then does `upscaleTo` read the settings. */
export function upscaleToReadsSettings(cs: PluginSupports["castSwap"] | undefined): boolean {
  if (!engineTakesUpscaleChoice(cs)) return false
  const declared = upscaleNextOf(cs)
  return declared["nodaro-prism"] !== undefined || declared["nodaro-prism-flash"] !== undefined
}

const isFlashEngine = (e: VideoRemakeUpscaleEngine): e is VideoRemakeFlashEngine => (VIDEO_REMAKE_FLASH_ENGINES as readonly string[]).includes(e)
