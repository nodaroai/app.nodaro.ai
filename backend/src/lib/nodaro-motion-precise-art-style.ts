/**
 * Nodaro Motion's setting for a Precise run with an art style, per engine —
 * how a DIRECT Precise run that carries an art style (`direction.style`, on
 * Nodaro Motion Prism) opens its prompt. Set by an admin for the whole
 * deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_precise_art_style`:
 * `{ "motion-prism"?: Entry, "motion-pulse"?: Entry }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, `Entry = { opener?: "edit" | "restyle";
 * styleRefs?: StyleRefsSetting }`.
 *
 * - `opener`: `"restyle"` (the default; absent means it) opens the prompt
 *   with "restyle {video:1} as follows:"; `"edit"` keeps the Precise opener
 *   of before, "edit {video:1} as follows:". Every other line is the
 *   engine's: the Precise prompt with the art style's lines.
 * - `styleRefs`: "Style the role pictures" for these runs, their OWN switch
 *   (`{ mode, send?, prompt? }`, the shape of the steps' `styleRefs`). Absent
 *   or Off: no picture is styled, whatever the per-engine steps' `styleRefs`
 *   says (that one is the Flex runs' alone). Saved as picked, Off included
 *   (its send and instruction kept for a later On), as the steps' own is.
 *
 * Only a Precise run that carries an art style reads it: a Precise run
 * without one, every Flex run and every trend run are as before. Pulse takes
 * no art style, so its entry is never read (the admin route refuses one).
 *
 * Its OWN row, not a key of another Nodaro Motion setting: those entries'
 * schemas are strict, so an older app on the shared database would drop an
 * engine's whole entry on a key it does not know. That is also why the
 * Precise runs' "Style the role pictures" lives here rather than as a new key
 * of `nodaro_motion_steps`.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). What is stored: the opener only when
 * `"edit"` (`"restyle"` is the same as left out), the style-refs step as
 * picked, and no empty entry. Who reads
 * it: the Cast Swap engine, through `tk.settings.nodaroMotionPreciseArtStyle()`
 * (advertised as `tk.capabilities.nodaroMotionPreciseArtStyle`), which answers
 * each changed engine under its current AND its earlier key, or null when
 * nothing is changed or the engine does not declare `castSwap.preciseArtStyle`.
 * Written only through `nodaro-motion-precise-art-style-store.ts`. This
 * module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import { castSwapStepsSaveSchema, castSwapStepsSchema, stepsProblems, styleRefsNeedsEngine, type CastSwapStepsProblem, type StyleRefsSetting } from "./cast-swap-steps.js"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_PRECISE_ART_STYLE_KEY = "nodaro_motion_precise_art_style"

/** The openers a Precise run with an art style may take (the engine's `PRECISE_OPENERS`, mirrored). */
export const PRECISE_ART_STYLE_OPENERS = ["edit", "restyle"] as const
export type PreciseArtStyleOpener = (typeof PRECISE_ART_STYLE_OPENERS)[number]

/** The opener when the setting names none (never saved, or an engine left out). */
export const PRECISE_ART_STYLE_OPENER_DEFAULT: PreciseArtStyleOpener = "restyle"

/** One engine's setting. Absent `opener` means "restyle"; absent `styleRefs` means no style-refs step (Off). */
export interface NodaroMotionPreciseArtStyleEntry {
  opener?: PreciseArtStyleOpener
  styleRefs?: StyleRefsSetting
}

/** The saved setting: one entry per engine an admin changed. */
export type NodaroMotionPreciseArtStyle = ByEngine<NodaroMotionPreciseArtStyleEntry>

/** What `tk.settings.nodaroMotionPreciseArtStyle()` answers: each changed entry under its current and its earlier key. */
export type NodaroMotionPreciseArtStyleForPlugin = ByEngineForPlugin<NodaroMotionPreciseArtStyleEntry>

/**
 * One engine's entry: strict (an unknown key or opener is refused). `styleRefs` is checked by the stored steps rules
 * (`castSwapStepsSchema`) and kept as that parse leaves it; a key left out stays out.
 */
export const nodaroMotionPreciseArtStyleEntrySchema: z.ZodType<NodaroMotionPreciseArtStyleEntry> = z
  .strictObject({
    opener: z.enum(PRECISE_ART_STYLE_OPENERS).optional(),
    styleRefs: z.unknown().optional(),
  })
  .transform((entry, ctx): NodaroMotionPreciseArtStyleEntry => {
    const out: NodaroMotionPreciseArtStyleEntry = {}
    if (entry.opener !== undefined) out.opener = entry.opener
    if (entry.styleRefs !== undefined) {
      const parsed = castSwapStepsSchema.safeParse({ styleRefs: entry.styleRefs })
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: issue.path } as Parameters<typeof ctx.addIssue>[0])
        return z.NEVER
      }
      if (parsed.data.styleRefs) out.styleRefs = parsed.data.styleRefs
    }
    return out
  }) as unknown as z.ZodType<NodaroMotionPreciseArtStyleEntry>

/**
 * An entry's save-time refusals (`castSwapStepsSaveSchema`: the style-refs instruction's rules), each path under
 * `prefix`; `[]` when it has no style-refs step or the step passes.
 */
export function preciseArtStyleEntryProblems(prefix: string, entry: NodaroMotionPreciseArtStyleEntry): CastSwapStepsProblem[] {
  if (entry.styleRefs === undefined) return []
  const parsed = castSwapStepsSaveSchema.safeParse({ styleRefs: entry.styleRefs })
  return parsed.success ? [] : stepsProblems(parsed.error, prefix)
}

/** What an admin saves: strict over the current engine ids (an unknown engine, opener or key is refused). */
export const nodaroMotionPreciseArtStyleSchema: z.ZodType<NodaroMotionPreciseArtStyle> = z.strictObject({
  "motion-prism": nodaroMotionPreciseArtStyleEntrySchema.optional(),
  "motion-pulse": nodaroMotionPreciseArtStyleEntrySchema.optional(),
})

/**
 * The setting as stored and sent: an opener only when `"edit"` (`"restyle"` is
 * the same as left out), the style-refs step as picked (Off included), an
 * entry left empty dropped. Unset keys are omitted. New objects.
 */
export function withoutDefaultPreciseArtStyle(setting: NodaroMotionPreciseArtStyle | null | undefined): NodaroMotionPreciseArtStyle {
  const out: NodaroMotionPreciseArtStyle = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = setting?.[engine]
    if (!entry) continue
    const kept: NodaroMotionPreciseArtStyleEntry = {}
    if (entry.opener === "edit") kept.opener = "edit"
    if (entry.styleRefs !== undefined) kept.styleRefs = structuredClone(entry.styleRefs)
    if (Object.keys(kept).length > 0) out[engine] = kept
  }
  return out
}

/**
 * Whether any engine's setting changes what a run does, so that it needs an engine that reads the row: an opener
 * `"edit"`, or the style-refs step On. Off (whatever its send and instruction) is what every engine does already.
 */
export function anyPreciseArtStyleChange(setting: NodaroMotionPreciseArtStyle | null | undefined): boolean {
  return Object.values(withoutDefaultPreciseArtStyle(setting)).some((entry) => entry?.opener === "edit" || styleRefsNeedsEngine(entry?.styleRefs))
}

/** One engine's opener: `"restyle"` unless the setting says `"edit"`. */
export function preciseArtStyleOpenerOf(setting: NodaroMotionPreciseArtStyle | null | undefined, engine: (typeof NODARO_MOTION_ENGINES)[number]): PreciseArtStyleOpener {
  return setting?.[engine]?.opener === "edit" ? "edit" : PRECISE_ART_STYLE_OPENER_DEFAULT
}

/**
 * What the plugin is answered: each changed entry, also under its earlier key
 * (the TRANSITION SHIM every Nodaro Motion setting's accessor answers,
 * `withEarlierEngineKeys`), new objects; null when nothing is changed.
 */
export function preciseArtStyleForPlugin(setting: NodaroMotionPreciseArtStyle | null | undefined): NodaroMotionPreciseArtStyleForPlugin | null {
  const kept = withoutDefaultPreciseArtStyle(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own, an invalid
 * one dropped with a warning (that engine then takes the default), the
 * defaults left out. Not an object reads as never saved (null).
 */
export function parseNodaroMotionPreciseArtStyle(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionPreciseArtStyle | null {
  const parsed = parseByEngine(value, NODARO_MOTION_PRECISE_ART_STYLE_KEY, nodaroMotionPreciseArtStyleEntrySchema, warn)
  return parsed ? withoutDefaultPreciseArtStyle(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine takes an art style on a
 * Precise run (`castSwap.preciseArtStyle`). An engine without it refuses one
 * (`art_style_needs_flex`), and is never answered the setting.
 */
export function engineTakesPreciseArtStyle(cs: { readonly preciseArtStyle?: boolean } | undefined): boolean {
  return cs?.preciseArtStyle === true
}

/**
 * Whether a (loaded or recorded) Cast Swap engine takes an art style as a change
 * on its own on a Precise run (`castSwap.preciseArtStyleAlone`). An engine
 * without it refuses such a run as having nothing to change.
 */
export function engineTakesPreciseArtStyleAlone(cs: { readonly preciseArtStyleAlone?: boolean } | undefined): boolean {
  return cs?.preciseArtStyleAlone === true
}
