/**
 * Video Remake's 3D previz clips: a run whose clip is a 3D previz (simple
 * untextured models moved and filmed as the video to make will be) states it
 * (`clipKind: "previz"` on the run and the estimate), and the engine renders
 * the clip into the run's look instead of editing it. Whether this deployment
 * accepts such a run. Set by an admin for the whole deployment, never by the
 * person running it.
 *
 * The `app_settings` row `nodaro_motion_previz`: `{ enabled?: boolean }`.
 *
 * - `enabled`: the admin's own choice, stored only once an admin made one
 *   (either value). Absent, or no row: the deployment's default — offered on
 *   Nodaro's own deployment, not offered under a white-label surface profile
 *   (`previzOfferedByDefault`, nodaro-motion-previz-default.ts).
 *   `previzEnabled` resolves the two; every reader goes through it.
 *
 * Read field by field, never by a strict schema (`parseNodaroMotionPreviz`):
 * the row is shared by every environment, so a key added here later drops
 * nothing for the code of today. The strict schema is what an admin saves.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionPreviz()` (advertised as
 * `tk.capabilities.nodaroMotionPreviz`), which is always answered an object
 * whose `enabled` is ALREADY RESOLVED (the engine cannot tell the deployments
 * apart, and reads anything but `true` as not accepted); the public
 * `GET /v1/video-remake/style-choice` (`previz`); and the request gate
 * (cast-swap-previz-gate.ts). An engine that does not declare
 * `castSwap.previz` never reads the row, so no value can be wrong there.
 * Written only through `nodaro-motion-previz-store.ts`. This module is pure
 * (no database, no deployment read).
 */
import { z } from "zod"

export const NODARO_MOTION_PREVIZ_KEY = "nodaro_motion_previz"

/** The saved setting. Absent `enabled`: the deployment's default. */
export interface NodaroMotionPreviz {
  enabled?: boolean
}

/** What an admin saves: strict (an unknown key or a value of another type is refused). */
export const nodaroMotionPrevizSchema: z.ZodType<NodaroMotionPreviz> = z.strictObject({
  enabled: z.boolean().optional(),
})

/** The setting as stored and sent: `enabled` only when an admin chose a value. A new object. */
export function withoutDefaultPreviz(setting: NodaroMotionPreviz | null | undefined): NodaroMotionPreviz {
  const out: NodaroMotionPreviz = {}
  if (typeof setting?.enabled === "boolean") out.enabled = setting.enabled
  return out
}

/**
 * The tolerant read of the stored row, field by field: an unknown key is
 * ignored, a switch that is not a boolean reads as never chosen (the
 * deployment's default), with a warning. Not an object reads as never saved
 * (null).
 */
export function parseNodaroMotionPreviz(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionPreviz | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as { enabled?: unknown }
  const out: NodaroMotionPreviz = {}
  if (typeof row.enabled === "boolean") out.enabled = row.enabled
  else if (row.enabled !== undefined && row.enabled !== null) warn(`[${NODARO_MOTION_PREVIZ_KEY}] the switch is not a boolean: the deployment's default stands`)
  return out
}

/**
 * Whether this deployment accepts a 3D previz clip: the admin's saved choice
 * when there is one, else the deployment's default (`offeredByDefault`:
 * `previzOfferedByDefault()`). The one rule every reader uses.
 */
export function previzEnabled(setting: NodaroMotionPreviz | null | undefined, offeredByDefault: boolean): boolean {
  return typeof setting?.enabled === "boolean" ? setting.enabled : offeredByDefault
}

/** What the engine is answered: `enabled` resolved. Always an object (a new one). */
export interface NodaroMotionPrevizForPlugin {
  enabled: boolean
}

export function previzForPlugin(setting: NodaroMotionPreviz | null | undefined, offeredByDefault: boolean): NodaroMotionPrevizForPlugin {
  return { enabled: previzEnabled(setting, offeredByDefault) }
}

/** Whether a (loaded or recorded) Cast Swap engine takes a 3D previz clip (`castSwap.previz`). An engine without it drops `clipKind` and never reads the row. */
export function engineTakesPreviz(cs: { readonly previz?: boolean } | undefined): boolean {
  return cs?.previz === true
}
