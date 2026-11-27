/**
 * Video Remake's step one size up, as the platform reads the admin's kill switches for it.
 *
 * A caller picks only the size it RECEIVES (lib/video-remake-delivered-resolution.ts, decided 2026-11-26); how the
 * engine makes it, a size below stepped up once, is its own and never named in a public answer. The request read the
 * earlier way (its `upscale` key, decided 2026-11-24) is removed (stage 5): no answer of the platform carries its
 * fields any more (`style-choice`'s `upscaleChoice` and `upscaleTo`; a quote's `outputResolution`, `upscale`,
 * `upscaleOffered` and step line: ee/lib/video-remake-estimate-answer.ts).
 *
 * What stays is shared by every reader of the step:
 *
 *   enginePreciseUpscale  the admin's Precise upscale (`nodaro_motion_precise_upscale`) as the engine is handed it
 *                         (`tk.settings.nodaroMotionPreciseUpscale()`)
 *   upscaleStepOffered    whether this deployment offers the step from one engine size, read as the engine reads it
 *                         (the delivered sizes are built from it)
 *   engineTakesUpscaleChoice  whether the engine reads the admin's rows as kill switches (`castSwap.upscaleChoice`,
 *                         still declared by the engine): the admin's Precise upscale page words its rows that way
 */
import {
  NODARO_MOTION_ENGINE_OF_FLASH,
  VIDEO_REMAKE_FLASH_ENGINES,
  type NodaroMotionEngine,
  type VideoRemakeFlashEngine,
} from "@nodaro/shared/models"
import type { PluginSupports } from "./private-plugins/types.js"
import {
  PRECISE_UPSCALE_ALL_OFF,
  effectivePreciseUpscale,
  engineTakesPreciseUpscale,
  type NodaroMotionPreciseUpscale,
  type NodaroMotionPreciseUpscaleEffective,
} from "./cast-swap-prism-precise-upscale.js"
import { topazVideoDisabledHere } from "./topaz-video-availability.js"

/** An engine size a step starts from. */
export type VideoRemakeUpscaleSize = "480p" | "720p" | "1080p"

/** An engine, or its Flash choice. */
export type VideoRemakeUpscaleEngine = NodaroMotionEngine | VideoRemakeFlashEngine

/** The admin's row values that turn a size on (any Topaz target). */
const PRECISE_UPSCALE_ON: readonly unknown[] = ["720p", "1080p", "4k"]

const ownValue = (o: object, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined)
const isPlainObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v)
const isFlashEngine = (e: VideoRemakeUpscaleEngine): e is VideoRemakeFlashEngine => (VIDEO_REMAKE_FLASH_ENGINES as readonly string[]).includes(e)

/**
 * Whether an engine's supports read the admin's Precise upscale rows as the step's kill switches
 * (`castSwap.upscaleChoice`): the admin page then words each row as the size it turns on or off.
 */
export function engineTakesUpscaleChoice(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.upscaleChoice === true
}

/**
 * The admin's Precise upscale as the engine is handed it (`tk.settings.nodaroMotionPreciseUpscale()`):
 * null where this engine does not declare `castSwap.preciseUpscale` (it reads no row), every size "off"
 * while this deployment withholds Topaz, else the effective setting (a size never saved at its default).
 * The ONE resolver the toolkit and the delivered sizes share. A fresh object.
 */
export function enginePreciseUpscale(
  stored: NodaroMotionPreciseUpscale | null | undefined,
  cs: PluginSupports["castSwap"] | undefined,
): NodaroMotionPreciseUpscaleEffective | typeof PRECISE_UPSCALE_ALL_OFF | null {
  if (!engineTakesPreciseUpscale(cs)) return null
  if (topazVideoDisabledHere()) return structuredClone(PRECISE_UPSCALE_ALL_OFF) as typeof PRECISE_UPSCALE_ALL_OFF
  return effectivePreciseUpscale(stored)
}

/** Whether the admin's row (as the engine reads it) offers the step at `size` on a Prism-family engine. */
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
 * (no Prism-family step). The rule the delivered sizes (lib/video-remake-delivered-resolution.ts) are built from.
 */
export function upscaleStepOffered(engine: VideoRemakeUpscaleEngine, size: VideoRemakeUpscaleSize, precise: unknown): boolean {
  if (topazVideoDisabledHere()) return false
  const base = isFlashEngine(engine) ? NODARO_MOTION_ENGINE_OF_FLASH[engine] : engine
  return base === "nodaro-pulse" || prismRowOffers(precise, size, engine === "nodaro-prism-flash")
}
