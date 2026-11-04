/**
 * Nodaro Motion's style-only setting, per engine — what a DIRECT style-only
 * run does: a Prism Flex run with an art style and nothing to swap (no role
 * with pictures, no fixed reference). Set by an admin for the whole
 * deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_style_only`:
 * `{ "motion-prism"?: Entry, "motion-pulse"?: Entry }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, `Entry = { path?: "original" | "flex";
 * enginePrompt?: TextStepSetting }`.
 *
 * - `path`: `"original"` (the default; absent means it) sends the original
 *   clip as the reference, restyled, with no depth; `"flex"` runs it as any
 *   art-style Flex run.
 * - `enginePrompt`: the style-only run's own engine-prompt step (absent: the
 *   template). Never the depth path's `steps.enginePrompt`.
 *
 * Its OWN row, not a key of `nodaro_motion_motion`: that entry's schema is
 * strict, so an older app on the shared database would drop an engine's whole
 * Motion entry on a key it does not know.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). What is stored: only what differs from the
 * defaults (`"original"` and the template are the same as left out, so they
 * are dropped; an unset key is omitted, never written as null). Who reads it:
 * the Cast Swap engine, through `tk.settings.nodaroMotionStyleOnly()`
 * (advertised as `tk.capabilities.nodaroMotionStyleOnly`), which answers each
 * changed engine under its current AND its earlier key, or null when nothing
 * is changed or the engine does not declare `castSwap.styleOnly`. Written
 * only through `nodaro-motion-style-only-store.ts`. This module is pure (no
 * database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import {
  STYLE_ONLY_PATHS,
  castSwapStepsSaveSchema,
  castSwapStepsSchema,
  stepsProblems,
  type CastSwapStepsProblem,
  type StyleOnlyPath,
  type TextStepSetting,
} from "./cast-swap-steps.js"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_STYLE_ONLY_KEY = "nodaro_motion_style_only"

export type NodaroMotionStyleOnlyPath = StyleOnlyPath

/** One engine's setting. Absent `path` means "original"; absent `enginePrompt` means the template. */
export interface NodaroMotionStyleOnlyEntry {
  path?: NodaroMotionStyleOnlyPath
  enginePrompt?: TextStepSetting
}

/** The saved setting: one entry per engine an admin changed. */
export type NodaroMotionStyleOnly = ByEngine<NodaroMotionStyleOnlyEntry>

/** What `tk.settings.nodaroMotionStyleOnly()` answers: each changed entry under its current and its earlier key. */
export type NodaroMotionStyleOnlyForPlugin = ByEngineForPlugin<NodaroMotionStyleOnlyEntry>

/**
 * One engine's entry: strict. `enginePrompt` is checked by the stored steps
 * rules (`castSwapStepsSchema`: any model name, no input listed twice) and
 * kept as that parse leaves it; a key left out stays out.
 */
export const nodaroMotionStyleOnlyEntrySchema: z.ZodType<NodaroMotionStyleOnlyEntry> = z
  .strictObject({
    path: z.enum(STYLE_ONLY_PATHS).optional(),
    enginePrompt: z.unknown().optional(),
  })
  .transform((entry, ctx): NodaroMotionStyleOnlyEntry => {
    const out: NodaroMotionStyleOnlyEntry = {}
    if (entry.path !== undefined) out.path = entry.path
    if (entry.enginePrompt !== undefined) {
      const parsed = castSwapStepsSchema.safeParse({ enginePrompt: entry.enginePrompt })
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: issue.path } as Parameters<typeof ctx.addIssue>[0])
        return z.NEVER
      }
      if (parsed.data.enginePrompt) out.enginePrompt = parsed.data.enginePrompt
    }
    return out
  }) as unknown as z.ZodType<NodaroMotionStyleOnlyEntry>

/** What an admin saves: strict over the current engine ids (an unknown engine, path or key is refused). */
export const nodaroMotionStyleOnlySchema: z.ZodType<NodaroMotionStyleOnly> = z.strictObject({
  "motion-prism": nodaroMotionStyleOnlyEntrySchema.optional(),
  "motion-pulse": nodaroMotionStyleOnlyEntrySchema.optional(),
})

/**
 * An entry's save-time refusals (`castSwapStepsSaveSchema`: a known model
 * that can see what it is shown), each path under `engine`; `[]` when it has
 * no engine prompt or the prompt passes.
 */
export function styleOnlyEntryProblems(engine: string, entry: NodaroMotionStyleOnlyEntry): CastSwapStepsProblem[] {
  if (entry.enginePrompt === undefined) return []
  const parsed = castSwapStepsSaveSchema.safeParse({ enginePrompt: entry.enginePrompt })
  return parsed.success ? [] : stepsProblems(parsed.error, `${engine}`)
}

/**
 * The setting with every default left out (`path: "original"`, an engine
 * prompt on the template, and an entry left empty): what is stored and sent.
 * Unset keys are omitted. New objects.
 */
export function withoutDefaultStyleOnly(setting: NodaroMotionStyleOnly | null | undefined): NodaroMotionStyleOnly {
  const out: NodaroMotionStyleOnly = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = setting?.[engine]
    if (!entry) continue
    const kept: NodaroMotionStyleOnlyEntry = {}
    if (entry.path === "flex") kept.path = "flex"
    if (entry.enginePrompt !== undefined && entry.enginePrompt.mode !== "template") kept.enginePrompt = structuredClone(entry.enginePrompt)
    if (Object.keys(kept).length > 0) out[engine] = kept
  }
  return out
}

/** Whether any engine differs from the defaults. */
export function anyStyleOnlyChange(setting: NodaroMotionStyleOnly | null | undefined): boolean {
  return Object.keys(withoutDefaultStyleOnly(setting)).length > 0
}

/**
 * What the plugin is answered: each changed entry, also under its earlier key
 * (the TRANSITION SHIM every Nodaro Motion setting's accessor answers,
 * `withEarlierEngineKeys`), new objects; null when nothing is changed.
 */
export function styleOnlyForPlugin(setting: NodaroMotionStyleOnly | null | undefined): NodaroMotionStyleOnlyForPlugin | null {
  const kept = withoutDefaultStyleOnly(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own, an invalid
 * one dropped with a warning (that engine then takes the defaults), the
 * defaults left out. Not an object reads as never saved (null).
 */
export function parseNodaroMotionStyleOnly(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionStyleOnly | null {
  const parsed = parseByEngine(value, NODARO_MOTION_STYLE_ONLY_KEY, nodaroMotionStyleOnlyEntrySchema, warn)
  return parsed ? withoutDefaultStyleOnly(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine accepts a style-only run
 * (`castSwap.styleOnly`). An engine without it refuses one, and is never
 * answered the setting.
 */
export function engineTakesStyleOnly(cs: { readonly styleOnly?: boolean } | undefined): boolean {
  return cs?.styleOnly === true
}
