/**
 * Nodaro Motion's no-person setting, per engine: whether a DIRECT Precise run
 * with no pictured person sends its source clip as it is (masking only when
 * the provider refuses that clip). Set by an admin for the whole deployment,
 * never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_no_person`:
 * `{ "motion-prism"?: Entry, "motion-pulse"?: Entry }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, `Entry = { sourceClip?: false }`.
 *
 * - `sourceClip`: on is the default, and absent means it; `false` turns it off
 *   for that engine, whose runs then prepare their clip as any Precise run
 *   does. `true` is never stored and is refused.
 *
 * Its OWN row, not a key of `nodaro_motion_motion`: that entry's schema is
 * strict, so an older app on the shared database would drop an engine's whole
 * Motion entry on a key it does not know.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). What is stored: only an engine switched off.
 * Who reads it: the Cast Swap engine, through `tk.settings.nodaroMotionNoPerson()`
 * (advertised as `tk.capabilities.nodaroMotionNoPerson`), which answers each
 * changed engine under its current AND its earlier key, or null when nothing
 * is changed or the engine does not declare `castSwap.noPersonSourceClip`.
 * Written only through `nodaro-motion-no-person-store.ts`. This module is pure
 * (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_NO_PERSON_KEY = "nodaro_motion_no_person"

/** One engine's setting. Absent `sourceClip` means on. */
export interface NodaroMotionNoPersonEntry {
  sourceClip?: false
}

/** The saved setting: one entry per engine an admin switched off. */
export type NodaroMotionNoPerson = ByEngine<NodaroMotionNoPersonEntry>

/** What `tk.settings.nodaroMotionNoPerson()` answers: each changed entry under its current and its earlier key. */
export type NodaroMotionNoPersonForPlugin = ByEngineForPlugin<NodaroMotionNoPersonEntry>

/** One engine's entry: strict, with off the only value `sourceClip` takes. */
export const nodaroMotionNoPersonEntrySchema: z.ZodType<NodaroMotionNoPersonEntry> = z.strictObject({
  sourceClip: z.literal(false).optional(),
})

/** What an admin saves: strict over the current engine ids (an unknown engine, value or key is refused). */
export const nodaroMotionNoPersonSchema: z.ZodType<NodaroMotionNoPerson> = z.strictObject({
  "motion-prism": nodaroMotionNoPersonEntrySchema.optional(),
  "motion-pulse": nodaroMotionNoPersonEntrySchema.optional(),
})

/**
 * The setting with every empty entry left out: what is stored and sent. Unset
 * keys are omitted. New objects.
 */
export function withoutDefaultNoPerson(setting: NodaroMotionNoPerson | null | undefined): NodaroMotionNoPerson {
  const out: NodaroMotionNoPerson = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (setting?.[engine]?.sourceClip === false) out[engine] = { sourceClip: false }
  }
  return out
}

/** Whether any engine differs from the default. */
export function anyNoPersonChange(setting: NodaroMotionNoPerson | null | undefined): boolean {
  return Object.keys(withoutDefaultNoPerson(setting)).length > 0
}

/**
 * What the plugin is answered: each changed entry, also under its earlier key
 * (the TRANSITION SHIM every Nodaro Motion setting's accessor answers,
 * `withEarlierEngineKeys`), new objects; null when nothing is changed.
 */
export function noPersonForPlugin(setting: NodaroMotionNoPerson | null | undefined): NodaroMotionNoPersonForPlugin | null {
  const kept = withoutDefaultNoPerson(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own, an invalid
 * one dropped with a warning (that engine then takes the default), the
 * defaults left out. Not an object reads as never saved (null).
 */
export function parseNodaroMotionNoPerson(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionNoPerson | null {
  const parsed = parseByEngine(value, NODARO_MOTION_NO_PERSON_KEY, nodaroMotionNoPersonEntrySchema, warn)
  return parsed ? withoutDefaultNoPerson(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine reads this setting
 * (`castSwap.noPersonSourceClip`). An engine without it never sends the source
 * clip on these runs, and is never answered the setting.
 */
export function engineTakesNoPersonSourceClip(cs: { readonly noPersonSourceClip?: boolean } | undefined): boolean {
  return cs?.noPersonSourceClip === true
}
