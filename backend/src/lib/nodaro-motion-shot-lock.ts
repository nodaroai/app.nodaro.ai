/**
 * Video Remake's shot lock, per engine — whether the prompt of every DIRECT
 * run of that engine on an ordinary clip carries one more line, which tells
 * the video model to keep the clip's shot order, camera positions, movement
 * and pacing, and to add no shot: `"off"` (the prompt of before) or `"on"`.
 * Set by an admin for the whole deployment, never by the person running it. A
 * trend run, a style-only run and a 3D previz run never read it.
 *
 * The `app_settings` row `nodaro_motion_shot_lock`:
 * `{ "nodaro-prism"?: ShotLock, "nodaro-pulse"?: ShotLock }`, keyed by Video
 * Remake's PUBLIC engine ids, `ShotLock = "off" | "on"`.
 *
 * - No row, an engine left out, or `"off"`: no line, on every deployment
 *   (there is no deployment default).
 * - `"on"`: every direct run of that engine on an ordinary clip carries it.
 *
 * What is stored: only the engines that are on (`"off"` is the same as left
 * out, so it is dropped). Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionShotLock()` (advertised as
 * `tk.capabilities.nodaroMotionShotLock`), which answers each engine that is
 * on under its current AND its earlier key, or null when none is (and to an
 * engine that does not declare `castSwap.shotLock`, which never asks); and
 * the admin's prompt previews and override checks. Written only by
 * `PUT /v1/admin/video-remake/shot-lock` (ee/routes), through
 * `nodaro-motion-shot-lock-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { byEngineSchema, parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_SHOT_LOCK_KEY = "nodaro_motion_shot_lock"

/** One engine's shot lock. */
export const NODARO_MOTION_SHOT_LOCKS = ["off", "on"] as const
export type NodaroMotionShotLockValue = (typeof NODARO_MOTION_SHOT_LOCKS)[number]

/** The saved setting: one value per engine an admin set. */
export type NodaroMotionShotLock = ByEngine<NodaroMotionShotLockValue>

/** What `tk.settings.nodaroMotionShotLock()` answers: each engine that is on under its current and its earlier key. */
export type NodaroMotionShotLockForPlugin = ByEngineForPlugin<NodaroMotionShotLockValue>

const shotLockSchema = z.enum(NODARO_MOTION_SHOT_LOCKS)

/** What an admin saves: strict (an unknown engine or value is refused). */
export const nodaroMotionShotLockSchema: z.ZodType<NodaroMotionShotLock> = byEngineSchema(shotLockSchema)

/** The setting with every `"off"` entry left out (the same as never set): what is stored. A new object. */
export function shotLocksOn(setting: NodaroMotionShotLock | null | undefined): NodaroMotionShotLock {
  const out: NodaroMotionShotLock = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (setting?.[engine] === "on") out[engine] = "on"
  }
  return out
}

/** Whether any engine's shot lock is on. */
export function anyShotLockOn(setting: NodaroMotionShotLock | null | undefined): boolean {
  return Object.keys(shotLocksOn(setting)).length > 0
}

/** One engine's shot lock: `"off"` unless the setting turns it on. */
export function shotLockOf(setting: NodaroMotionShotLock | null | undefined, engine: NodaroMotionEngine): NodaroMotionShotLockValue {
  return setting?.[engine] === "on" ? "on" : "off"
}

/**
 * What the plugin is answered: each engine that is on, also under its earlier
 * keys (the TRANSITION SHIM every Video Remake setting's accessor answers,
 * `withEarlierEngineKeys`), a new object; null when none is on.
 */
export function shotLockForPlugin(setting: NodaroMotionShotLock | null | undefined): NodaroMotionShotLockForPlugin | null {
  const kept = shotLocksOn(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's value validated on its own, an invalid
 * one dropped with a warning (that engine then stays off). Not an object
 * reads as never saved (null).
 */
export function parseNodaroMotionShotLock(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionShotLock | null {
  const parsed = parseByEngine(value, NODARO_MOTION_SHOT_LOCK_KEY, shotLockSchema, warn)
  return parsed ? shotLocksOn(parsed) : null
}

/** Whether a (loaded or recorded) Cast Swap engine writes the shot lock's line (`castSwap.shotLock`). An engine without it never reads the row. */
export function engineTakesShotLock(cs: { readonly shotLock?: boolean } | undefined): boolean {
  return cs?.shotLock === true
}
