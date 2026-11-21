/**
 * Video Remake's shot-list frame rate: how many frames of each second the
 * model that writes a run's shot list is shown of the clip. Set by an admin
 * for the whole deployment, never by the person running it.
 *
 * A shot list is the run's script: one line per shot of the clip, which the
 * video model then follows. A clip read at one frame a second can hide a
 * whole shot between two frames (any shot under a second may hold none), and
 * the lines written after it slip onto the wrong shots. A higher rate shows
 * the writing model every shot; it also sends more frames, so that one call
 * reads more input, and a rate above 1 is carried only by the model
 * provider's own API.
 *
 * The `app_settings` row `nodaro_motion_shot_list_fps`: `{ fps?: number }`.
 *
 * - `fps`: the admin's own choice, one of `NODARO_MOTION_SHOT_LIST_FPS_OPTIONS`,
 *   stored only once an admin made one. Absent, or no row: the engine's own
 *   default (`NODARO_MOTION_SHOT_LIST_FPS_DEFAULT`, the recommended rate).
 * - `1` is the clip as it was read before the setting existed.
 *
 * Read field by field, never by a strict schema
 * (`parseNodaroMotionShotListFps`): the row is shared by every environment,
 * so a key added here later drops nothing for the code of today. The strict
 * schema is what an admin saves.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionShotListFps()` (advertised as
 * `tk.capabilities.nodaroMotionShotListFps`), for every shot list it writes
 * from a clip (a run's, a trend's when it is made). An engine that does not
 * declare `castSwap.shotListFps` never reads the row. Written only through
 * `nodaro-motion-shot-list-fps-store.ts`. This module is pure (no database).
 */
import { z } from "zod"

export const NODARO_MOTION_SHOT_LIST_FPS_KEY = "nodaro_motion_shot_list_fps"

/** The rates an admin may choose, frames a second. 1: the clip as it was read before the setting. */
export const NODARO_MOTION_SHOT_LIST_FPS_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const
export type NodaroMotionShotListFpsValue = (typeof NODARO_MOTION_SHOT_LIST_FPS_OPTIONS)[number]

/**
 * The rate in effect while no admin chose one: the engine's own default,
 * shown here as the recommended value. The engine applies it (it reads a
 * setting with no `fps` as its default); this figure is what the admin page
 * shows for it.
 */
export const NODARO_MOTION_SHOT_LIST_FPS_DEFAULT: NodaroMotionShotListFpsValue = 6

/** The saved setting. Absent `fps`: the engine's default. */
export interface NodaroMotionShotListFps {
  fps?: NodaroMotionShotListFpsValue
}

const isOption = (value: unknown): value is NodaroMotionShotListFpsValue =>
  typeof value === "number" && (NODARO_MOTION_SHOT_LIST_FPS_OPTIONS as readonly number[]).includes(value)

/** What an admin saves: strict (an unknown key, or a rate that is not offered, is refused). */
export const nodaroMotionShotListFpsSchema: z.ZodType<NodaroMotionShotListFps> = z.strictObject({
  fps: z
    .number()
    .refine(isOption, { message: `The frame rate must be one of ${NODARO_MOTION_SHOT_LIST_FPS_OPTIONS.join(", ")}.` })
    .optional(),
}) as z.ZodType<NodaroMotionShotListFps>

/** The setting as stored and sent: `fps` only when an admin chose a rate. A new object. */
export function withoutDefaultShotListFps(setting: NodaroMotionShotListFps | null | undefined): NodaroMotionShotListFps {
  const out: NodaroMotionShotListFps = {}
  if (isOption(setting?.fps)) out.fps = setting.fps
  return out
}

/**
 * The tolerant read of the stored row, field by field: an unknown key is
 * ignored, a rate that is not offered reads as never chosen (the engine's
 * default), with a warning. Not an object reads as never saved (null).
 */
export function parseNodaroMotionShotListFps(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionShotListFps | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as { fps?: unknown }
  const out: NodaroMotionShotListFps = {}
  if (isOption(row.fps)) out.fps = row.fps
  else if (row.fps !== undefined && row.fps !== null) warn(`[${NODARO_MOTION_SHOT_LIST_FPS_KEY}] the frame rate is not one of the rates offered: the engine's default stands`)
  return out
}

/** The rate in effect: the admin's saved choice when there is one, else the recommended default. The one rule every reader here uses. */
export function shotListFpsInEffect(setting: NodaroMotionShotListFps | null | undefined): NodaroMotionShotListFpsValue {
  return isOption(setting?.fps) ? setting.fps : NODARO_MOTION_SHOT_LIST_FPS_DEFAULT
}

/** What the engine is answered: `fps` only when an admin chose a rate (without it the engine applies its own default). */
export interface NodaroMotionShotListFpsForPlugin {
  fps?: number
}

/**
 * What the engine is answered. Always an object (a new one).
 *
 * `rateCarried`: whether this deployment can serve a call that carries a
 * frame rate (it rides only on the model provider's own API, so it needs
 * that provider's key). Where it cannot, the engine is answered `fps: 1`:
 * the clip as it was read before, with no request this deployment would
 * refuse.
 */
export function shotListFpsForPlugin(setting: NodaroMotionShotListFps | null | undefined, rateCarried: boolean): NodaroMotionShotListFpsForPlugin {
  if (!rateCarried) return { fps: 1 }
  return withoutDefaultShotListFps(setting)
}

/** Whether a (loaded or recorded) Cast Swap engine reads its shot list's clip at a frame rate (`castSwap.shotListFps`). An engine without it never reads the row. */
export function engineTakesShotListFps(cs: { readonly shotListFps?: boolean } | undefined): boolean {
  return cs?.shotListFps === true
}
