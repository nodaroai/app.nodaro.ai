/**
 * Nodaro Motion's prompt part overrides for DIRECT runs, per engine and per
 * style — set by an admin for the whole deployment, never by the person
 * running it. A trend run keeps its own trend's overrides
 * (`TrendVersionData.promptParts`).
 *
 * The `app_settings` row `nodaro_motion_prompt_parts`:
 * `{ "motion-prism"?: { precise?: Parts, motion?: Parts, styleOnly?: Parts }, "motion-pulse"?: … }`,
 * keyed by Nodaro Motion's PUBLIC engine ids, `Parts` the override text per
 * Cast Swap prompt part (1–2000 characters; `"-"` removes the part). No row
 * = never saved: every direct run uses the engine's defaults. A row keyed by
 * the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as the new ones.
 * The overrides are text only: the engine owns each default and checks every
 * override (the admin save asks it first), and there is no "default changed"
 * record for these.
 *
 * The keys of an engine's entry (`NODARO_MOTION_PROMPT_PARTS_KEYS`) are the run
 * styles (`precise`, `motion`) and `styleOnly`: a style-only run's own parts
 * (a direct Prism Flex run with an art style and nothing to swap, on the
 * "original" path). The engine reads only `styleOnly` for such a run and
 * never for any other, so the `motion` and `styleOnly` overrides never mix.
 * An app from before the key reads an entry holding it as invalid (its schema
 * is strict) and drops the engine's whole entry, so a `styleOnly` key is saved
 * only once every environment's engine runs style-only runs (the admin route).
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionPromptParts()` (advertised as
 * `tk.capabilities.nodaroMotionPromptParts`), for every direct run of the
 * engine and style it names. That read answers each entry under both its
 * current and its earlier key (`withEarlierEngineKeys`, a transition shim for
 * plugins that look up the earlier ids). Written only by
 * `PUT /v1/admin/nodaro-motion/prompt-parts` (ee/routes), through
 * `nodaro-motion-prompt-parts-store.ts`. This module is pure (no database).
 *
 * Read through `getAppSettings()` (its 60 s cache, and
 * `invalidateSettingsCache()` after a write), parsed here.
 */
import { z } from "zod"
import type { CastSwapPromptPartId } from "@nodaro/render-rules"
import { CAST_SWAP_STYLES } from "@nodaro/shared/models"
import { promptPartTextsSchema } from "./cast-swap-prompt-parts-contract.js"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_PROMPT_PARTS_KEY = "nodaro_motion_prompt_parts"

/** One style's overrides: the text per part. */
export type NodaroMotionPromptPartTexts = Partial<Record<CastSwapPromptPartId, string>>

/** The keys of one engine's entry: the run styles, then a style-only run's own set. */
export const NODARO_MOTION_PROMPT_PARTS_KEYS = [...CAST_SWAP_STYLES, "styleOnly"] as const

/** One key of an engine's entry: a run style (`precise`, `motion`) or `styleOnly`. */
export type NodaroMotionPromptPartsKey = (typeof NODARO_MOTION_PROMPT_PARTS_KEYS)[number]

/** One engine's overrides, per key (a key left out uses the defaults). */
export type NodaroMotionEnginePromptParts = Partial<Record<NodaroMotionPromptPartsKey, NodaroMotionPromptPartTexts>>

/** The saved setting: one entry per engine an admin saved. */
export type NodaroMotionPromptParts = ByEngine<NodaroMotionEnginePromptParts>

/** What `tk.settings.nodaroMotionPromptParts()` answers: each entry under its current and its earlier key. */
export type NodaroMotionPromptPartsForPlugin = ByEngineForPlugin<NodaroMotionEnginePromptParts>

/** One engine's entry: strict over the keys, each strict over the part ids. */
export const nodaroMotionEnginePromptPartsSchema = z.strictObject(
  Object.fromEntries(NODARO_MOTION_PROMPT_PARTS_KEYS.map((key) => [key, promptPartTextsSchema.optional()])),
) as unknown as z.ZodType<NodaroMotionEnginePromptParts>

/** What an admin saves: strict (an unknown engine, key or part is refused). */
export const nodaroMotionPromptPartsSchema: z.ZodType<NodaroMotionPromptParts> = z.strictObject({
  "motion-prism": nodaroMotionEnginePromptPartsSchema.optional(),
  "motion-pulse": nodaroMotionEnginePromptPartsSchema.optional(),
})

/** The setting with each entry also under its earlier key (a fresh copy): what the toolkit answers. */
export function withEarlierPromptPartKeys(parts: NodaroMotionPromptParts): NodaroMotionPromptPartsForPlugin {
  return withEarlierEngineKeys(parts)
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own, an invalid
 * one dropped with a warning (that engine then uses the defaults). Not an
 * object reads as never saved (null).
 */
export function parseNodaroMotionPromptParts(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionPromptParts | null {
  return parseByEngine(value, NODARO_MOTION_PROMPT_PARTS_KEY, nodaroMotionEnginePromptPartsSchema, warn)
}
