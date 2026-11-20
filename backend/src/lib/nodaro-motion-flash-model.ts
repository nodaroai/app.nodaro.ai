/**
 * Video Remake's flash-model test, per engine: a test switch, off by default,
 * that makes a NEW run of that engine STARTED BY AN ADMIN ACCOUNT send its
 * video step on the faster, lower-cost model of the same family instead of
 * the engine's own: `"off"` (the run of before) or `"on"`. Every other
 * account's run is unchanged while it is on. Set by an admin, never by the
 * person running it. It is no engine and no option
 * of a run: nothing a caller sends names it, and no public answer mentions it.
 *
 * The `app_settings` row `nodaro_motion_flash_model`:
 * `{ "nodaro-prism"?: FlashModel, "nodaro-pulse"?: FlashModel }`, keyed by
 * Video Remake's PUBLIC engine ids, `FlashModel = "off" | "on"`.
 *
 * - No row, an engine left out, or `"off"`: the engine's own model, on every
 *   deployment (there is no deployment default).
 * - `"on"`: a new run of that engine started by an admin account (a preview
 *   and a full run, a direct run and a trend run, from the app, an API key
 *   or MCP alike: the account decides) is made on the test model; a run by
 *   any other account, or one whose account's role cannot be read, is made
 *   on the engine's own model, at its own price. The engine
 *   refuses, before anything is held, a run that model cannot take, and
 *   stores on the job that it ran so; a later step of the job reads that,
 *   never this row again.
 *
 * What is stored: only the engines that are on (`"off"` is the same as left
 * out, so it is dropped). Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionFlashModel(userId)` (advertised as
 * `tk.capabilities.nodaroMotionFlashModel`), which answers each engine that
 * is on under its current AND its earlier key only when `userId` (the
 * account the run's request was authenticated as) is an admin, the host
 * reading its role itself; null otherwise, when none is on, and to an engine
 * that does not declare `castSwap.flashModel`, which never asks.
 * Written only by `PUT /v1/admin/video-remake/flash-model` (ee/routes),
 * through `nodaro-motion-flash-model-store.ts`. It is NOT one of the Video
 * Remake settings a stored settings set holds: loading a set never turns a
 * test on. This module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { byEngineSchema, parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_FLASH_MODEL_KEY = "nodaro_motion_flash_model"

/** One engine's flash-model test. */
export const NODARO_MOTION_FLASH_MODELS = ["off", "on"] as const
export type NodaroMotionFlashModelValue = (typeof NODARO_MOTION_FLASH_MODELS)[number]

/** The saved setting: one value per engine an admin set. */
export type NodaroMotionFlashModel = ByEngine<NodaroMotionFlashModelValue>

/** What `tk.settings.nodaroMotionFlashModel()` answers: each engine that is on under its current and its earlier key. */
export type NodaroMotionFlashModelForPlugin = ByEngineForPlugin<NodaroMotionFlashModelValue>

const flashModelSchema = z.enum(NODARO_MOTION_FLASH_MODELS)

/** What an admin saves: strict (an unknown engine or value is refused). */
export const nodaroMotionFlashModelSchema: z.ZodType<NodaroMotionFlashModel> = byEngineSchema(flashModelSchema)

/** The setting with every `"off"` entry left out (the same as never set): what is stored. A new object. */
export function flashModelsOn(setting: NodaroMotionFlashModel | null | undefined): NodaroMotionFlashModel {
  const out: NodaroMotionFlashModel = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (setting?.[engine] === "on") out[engine] = "on"
  }
  return out
}

/** Whether any engine's flash-model test is on. */
export function anyFlashModelOn(setting: NodaroMotionFlashModel | null | undefined): boolean {
  return Object.keys(flashModelsOn(setting)).length > 0
}

/** One engine's flash-model test: `"off"` unless the setting turns it on. */
export function flashModelOf(setting: NodaroMotionFlashModel | null | undefined, engine: NodaroMotionEngine): NodaroMotionFlashModelValue {
  return setting?.[engine] === "on" ? "on" : "off"
}

/**
 * What the plugin is answered: each engine that is on, also under its earlier
 * keys (the TRANSITION SHIM every Video Remake setting's accessor answers,
 * `withEarlierEngineKeys`), a new object; null when none is on.
 */
export function flashModelForPlugin(setting: NodaroMotionFlashModel | null | undefined): NodaroMotionFlashModelForPlugin | null {
  const kept = flashModelsOn(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's value validated on its own, an invalid
 * one dropped with a warning (that engine then stays off). Not an object
 * reads as never saved (null).
 */
export function parseNodaroMotionFlashModel(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionFlashModel | null {
  const parsed = parseByEngine(value, NODARO_MOTION_FLASH_MODEL_KEY, flashModelSchema, warn)
  return parsed ? flashModelsOn(parsed) : null
}

/** Whether a (loaded or recorded) Cast Swap engine runs the flash-model test (`castSwap.flashModel`). An engine without it never reads the row. */
export function engineTakesFlashModel(cs: { readonly flashModel?: boolean } | undefined): boolean {
  return cs?.flashModel === true
}
