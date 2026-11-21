/**
 * Video Remake's shot lock, per engine — whether the prompt of a DIRECT run
 * of that engine carries one more line, which tells the video model to keep
 * the clip's shot order, camera positions, movement and pacing, and to add no
 * shot. Set by an admin for the whole deployment, never by the person running
 * it. A trend run and a 3D previz run never read it.
 *
 * BY RUN TYPE (`NODARO_MOTION_SHOT_LOCK_RUN_TYPES`), each its own switch:
 * - `ordinary`: a run with no art style;
 * - `styleWithRoles`: a run with an art style (a catalog style, or the
 *   person's own words) that is not made style-only: with roles or
 *   references, and also an art style with nothing to swap that the other
 *   settings make another way;
 * - `styleAlone`: a style-only run (an art style and nothing to swap, the
 *   clip sent as it is and restyled).
 * And, in `styles`, the EXCEPTIONS: an art style's catalog id (or
 * `NODARO_MOTION_SHOT_LOCK_CUSTOM_STYLE` for every custom style) → `"on"` /
 * `"off"`, which wins over the run type's switch for a run with that style.
 * Only an engine that takes an art style has `styleWithRoles`, `styleAlone`
 * and `styles` (`NODARO_MOTION_SHOT_LOCK_STYLE_ENGINES`); any other engine
 * has `ordinary` alone.
 *
 * The `app_settings` row `nodaro_motion_shot_lock`, keyed by Video Remake's
 * PUBLIC engine ids, one ENTRY per engine, in one of two shapes:
 * - `"on"` (the shape of before run types): `ordinary` and `styleWithRoles`
 *   on, `styleAlone` off, no exception — exactly what it always meant;
 * - `{ ordinary?, styleWithRoles?, styleAlone?: "on", styles?: { [style]: "off" | "on" } }`.
 * No row, an engine left out, or `"off"`: no line, on every deployment (there
 * is no deployment default).
 *
 * What is stored (`shotLocksOn`): only what turns something on. An entry that
 * turns nothing on is left out; a switch that is off is left out; an entry
 * that says exactly what `"on"` says is stored as `"on"`, so a deployment
 * that never uses the run types keeps the row it had, and every build and
 * engine from before them reads it as it always did.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionShotLock()` (advertised as
 * `tk.capabilities.nodaroMotionShotLock`): null to an engine that does not
 * declare `castSwap.shotLock` (it never asks); to one that does, each engine
 * that is on under its current AND its earlier key — the object shape only
 * to an engine that declares `castSwap.shotLockRunTypes` (an engine without
 * it reads only `"on"`, so an object entry is left out for it: off there,
 * never on by accident). And the admin's prompt previews and override checks.
 * Written only by `PUT /v1/admin/video-remake/shot-lock` (ee/routes), through
 * `nodaro-motion-shot-lock-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_SHOT_LOCK_KEY = "nodaro_motion_shot_lock"

/** One switch. */
export const NODARO_MOTION_SHOT_LOCKS = ["off", "on"] as const
export type NodaroMotionShotLockValue = (typeof NODARO_MOTION_SHOT_LOCKS)[number]

/** The run types, each with a switch of its own (the module doc). */
export const NODARO_MOTION_SHOT_LOCK_RUN_TYPES = ["ordinary", "styleWithRoles", "styleAlone"] as const
export type NodaroMotionShotLockRunType = (typeof NODARO_MOTION_SHOT_LOCK_RUN_TYPES)[number]

/** The exceptions' key for a custom style (the person's own words): one entry for every custom style. No catalog style has this id. */
export const NODARO_MOTION_SHOT_LOCK_CUSTOM_STYLE = "custom"

/** The engines that take an art style: only they have the two art-style run types and the exceptions. */
export const NODARO_MOTION_SHOT_LOCK_STYLE_ENGINES: readonly NodaroMotionEngine[] = ["nodaro-prism"]

/** Whether `engine` takes an art style (so its entry may say more than `ordinary`). */
export function shotLockEngineTakesStyle(engine: NodaroMotionEngine): boolean {
  return NODARO_MOTION_SHOT_LOCK_STYLE_ENGINES.includes(engine)
}

/** The most exceptions one engine's entry holds. */
export const NODARO_MOTION_SHOT_LOCK_MAX_STYLES = 200

/** One engine's entry by run type. */
export interface NodaroMotionShotLockByRunType {
  ordinary?: NodaroMotionShotLockValue
  styleWithRoles?: NodaroMotionShotLockValue
  styleAlone?: NodaroMotionShotLockValue
  /** The exceptions: an art style's id (or `"custom"`) → its own value. */
  styles?: Record<string, NodaroMotionShotLockValue>
}

/** One engine's entry: the shape of before (`"off"` / `"on"`) or by run type. */
export type NodaroMotionShotLockEntry = NodaroMotionShotLockValue | NodaroMotionShotLockByRunType

/** The saved setting: one entry per engine an admin set. */
export type NodaroMotionShotLock = ByEngine<NodaroMotionShotLockEntry>

/** What `tk.settings.nodaroMotionShotLock()` answers: each engine that is on under its current and its earlier key. */
export type NodaroMotionShotLockForPlugin = ByEngineForPlugin<NodaroMotionShotLockEntry>

/** One engine's entry, read whole: every switch said, the exceptions as listed. */
export interface NodaroMotionShotLockResolved {
  ordinary: boolean
  styleWithRoles: boolean
  styleAlone: boolean
  styles: Record<string, NodaroMotionShotLockValue>
}

const valueSchema = z.enum(NODARO_MOTION_SHOT_LOCKS)
/** An exception's key: a style catalog id's shape (or `"custom"`). */
const styleKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
const stylesSchema = z
  .record(styleKeySchema, valueSchema)
  .refine((s) => Object.keys(s).length <= NODARO_MOTION_SHOT_LOCK_MAX_STYLES, { message: `At most ${NODARO_MOTION_SHOT_LOCK_MAX_STYLES} styles.` })

const byRunTypeSchema = z.strictObject({
  ordinary: valueSchema.optional(),
  styleWithRoles: valueSchema.optional(),
  styleAlone: valueSchema.optional(),
  styles: stylesSchema.optional(),
})
/** An engine that takes no art style: `ordinary` alone. */
const ordinaryOnlySchema = z.strictObject({ ordinary: valueSchema.optional() })

const entrySchema: z.ZodType<NodaroMotionShotLockEntry> = z.union([valueSchema, byRunTypeSchema])

/**
 * What an admin saves: strict (an unknown engine, key or value is refused; an
 * art-style switch or an exception on an engine that takes no art style is
 * refused too).
 */
export const nodaroMotionShotLockSchema: z.ZodType<NodaroMotionShotLock> = z.strictObject(
  Object.fromEntries(
    NODARO_MOTION_ENGINES.map((engine) => [engine, (shotLockEngineTakesStyle(engine) ? entrySchema : z.union([valueSchema, ordinaryOnlySchema])).optional()]),
  ),
) as unknown as z.ZodType<NodaroMotionShotLock>

/**
 * One engine's entry read whole. `"on"` is `ordinary` and `styleWithRoles`
 * (what it always meant); an engine that takes no art style has `ordinary`
 * alone, whatever its entry says of the rest.
 */
export function shotLockRunTypesOf(setting: NodaroMotionShotLock | null | undefined, engine: NodaroMotionEngine): NodaroMotionShotLockResolved {
  const entry = setting?.[engine]
  const style = shotLockEngineTakesStyle(engine)
  if (entry === "on") return { ordinary: true, styleWithRoles: style, styleAlone: false, styles: {} }
  if (!entry || typeof entry !== "object") return { ordinary: false, styleWithRoles: false, styleAlone: false, styles: {} }
  return {
    ordinary: entry.ordinary === "on",
    styleWithRoles: style && entry.styleWithRoles === "on",
    styleAlone: style && entry.styleAlone === "on",
    styles: style ? { ...(entry.styles ?? {}) } : {},
  }
}

/** One engine's entry as it is stored (the module doc); undefined when it turns nothing on. */
function storedEntryOf(setting: NodaroMotionShotLock | null | undefined, engine: NodaroMotionEngine): NodaroMotionShotLockEntry | undefined {
  const r = shotLockRunTypesOf(setting, engine)
  const exceptions = Object.keys(r.styles).length > 0
  if (!r.ordinary && !r.styleWithRoles && !r.styleAlone && !Object.values(r.styles).includes("on")) return undefined
  if (!shotLockEngineTakesStyle(engine)) return "on"
  if (r.ordinary && r.styleWithRoles && !r.styleAlone && !exceptions) return "on"
  return {
    ...(r.ordinary ? { ordinary: "on" as const } : {}),
    ...(r.styleWithRoles ? { styleWithRoles: "on" as const } : {}),
    ...(r.styleAlone ? { styleAlone: "on" as const } : {}),
    ...(exceptions ? { styles: r.styles } : {}),
  }
}

/** The setting as it is stored: only the engines that turn something on, each entry in its stored shape. A new object. */
export function shotLocksOn(setting: NodaroMotionShotLock | null | undefined): NodaroMotionShotLock {
  const out: NodaroMotionShotLock = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = storedEntryOf(setting, engine)
    if (entry !== undefined) out[engine] = entry
  }
  return out
}

/** Whether any engine's shot lock turns anything on. */
export function anyShotLockOn(setting: NodaroMotionShotLock | null | undefined): boolean {
  return Object.keys(shotLocksOn(setting)).length > 0
}

/** Whether the setting, as stored, holds an entry by run type: one only an engine that declares `castSwap.shotLockRunTypes` reads. */
export function shotLockNeedsRunTypes(setting: NodaroMotionShotLock | null | undefined): boolean {
  return Object.values(shotLocksOn(setting)).some((entry) => typeof entry === "object")
}

/**
 * The setting as an engine reads it: as stored for one that declares
 * `castSwap.shotLockRunTypes`; for one that does not, only the entries
 * stored as `"on"` (it reads no other shape, so an entry by run type is off
 * there).
 */
export function shotLockAsEngineReads(setting: NodaroMotionShotLock | null | undefined, cs: { readonly shotLockRunTypes?: boolean } | undefined): NodaroMotionShotLock {
  const stored = shotLocksOn(setting)
  if (engineTakesShotLockRunTypes(cs)) return stored
  return Object.fromEntries(Object.entries(stored).filter(([, entry]) => entry === "on")) as NodaroMotionShotLock
}

/** The keys of the admin's prompt parts a preview or a check is asked for (`NodaroMotionPromptPartsKey`). */
type PromptKey = "precise" | "motion" | "styleOnly" | "previz"

/**
 * The shot lock a PREVIEW of `key` shows for `engine`: a Precise or a Motion
 * preview is an ordinary run (it carries no art style), the style-only
 * preview a style-only run; a previz run never carries the line.
 */
export function shotLockShownOn(setting: NodaroMotionShotLock | null | undefined, engine: NodaroMotionEngine, key: PromptKey): NodaroMotionShotLockValue {
  const r = shotLockRunTypesOf(setting, engine)
  if (key === "previz") return "off"
  return (key === "styleOnly" ? r.styleAlone : r.ordinary) ? "on" : "off"
}

/**
 * Whether SOME run made with `key`'s prompt parts may carry the line, for a
 * check of the prompt at its longest: a Precise or a Motion run when
 * `ordinary`, `styleWithRoles` or any exception is on; a style-only run when
 * `styleAlone` or any exception is on; a previz run never.
 */
export function shotLockMayBeOn(setting: NodaroMotionShotLock | null | undefined, engine: NodaroMotionEngine, key: PromptKey): NodaroMotionShotLockValue {
  const r = shotLockRunTypesOf(setting, engine)
  if (key === "previz") return "off"
  const exception = Object.values(r.styles).includes("on")
  return (key === "styleOnly" ? r.styleAlone || exception : r.ordinary || r.styleWithRoles || exception) ? "on" : "off"
}

/**
 * What the plugin is answered: the setting as its engine reads it
 * (`shotLockAsEngineReads`), each entry also under its earlier keys (the
 * TRANSITION SHIM every Video Remake setting's accessor answers,
 * `withEarlierEngineKeys`), a new object; null when nothing is on for it.
 */
export function shotLockForPlugin(
  setting: NodaroMotionShotLock | null | undefined,
  cs?: { readonly shotLockRunTypes?: boolean },
): NodaroMotionShotLockForPlugin | null {
  const kept = shotLockAsEngineReads(setting, cs)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own (either
 * shape), an invalid one dropped with a warning (that engine then stays off).
 * Not an object reads as never saved (null). Answered as it is stored
 * (`shotLocksOn`).
 */
export function parseNodaroMotionShotLock(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionShotLock | null {
  const parsed = parseByEngine(value, NODARO_MOTION_SHOT_LOCK_KEY, entrySchema, warn)
  return parsed ? shotLocksOn(parsed) : null
}

/** Whether a (loaded or recorded) Cast Swap engine writes the shot lock's line (`castSwap.shotLock`). An engine without it never reads the row. */
export function engineTakesShotLock(cs: { readonly shotLock?: boolean } | undefined): boolean {
  return cs?.shotLock === true
}

/**
 * Whether a (loaded or recorded) Cast Swap engine reads an entry by run type
 * (`castSwap.shotLockRunTypes`): the three switches and the exceptions, and
 * the line on a style-only run. An engine without it reads only `"on"`.
 */
export function engineTakesShotLockRunTypes(cs: { readonly shotLockRunTypes?: boolean } | undefined): boolean {
  return cs?.shotLockRunTypes === true
}
