/**
 * Nodaro Motion's Flex prompt wording, per engine — how the Flexible prompt
 * of every DIRECT run of that engine is worded: `"current"` (today's) or
 * `"new"` (the movement lock, the picture roles, the closing restatement and
 * the avoid part as a failure list). Set by an admin for the whole
 * deployment, never by the person running it. A trend run keeps its own
 * trend's wording (`TrendVersionData.promptWording`). Every Precise prompt
 * ignores it.
 *
 * The `app_settings` row `nodaro_motion_prompt_wording`:
 * `{ "motion-prism"?: Wording, "motion-pulse"?: Wording }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, `Wording = "current" | "new"`.
 *
 * - No row, an engine left out, or `"current"`: today's wording, exactly as
 *   before the setting.
 * - `"new"`: every direct Flex run of that engine is worded the new way.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). What is stored: only the engines on the new
 * wording (`"current"` is the same as left out, so it is dropped). Who reads
 * it: the Cast Swap engine, through `tk.settings.nodaroMotionPromptWording()`
 * (advertised as `tk.capabilities.nodaroMotionPromptWording`), which answers
 * each engine on the new wording under its current AND its earlier key, or
 * null when every engine is current; and
 * the admin's prompt previews and override checks. Written only by
 * `PUT /v1/admin/nodaro-motion/prompt-wording` (ee/routes), through
 * `nodaro-motion-prompt-wording-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { CAST_SWAP_PROMPT_WORDINGS, type CastSwapPromptWording } from "@nodaro/render-rules"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_PROMPT_WORDING_KEY = "nodaro_motion_prompt_wording"

/** The saved setting: one wording per engine an admin set. */
export type NodaroMotionPromptWording = ByEngine<CastSwapPromptWording>

/** What `tk.settings.nodaroMotionPromptWording()` answers: each engine on the new wording under its current and its earlier key. */
export type NodaroMotionPromptWordingForPlugin = ByEngineForPlugin<CastSwapPromptWording>

const wordingSchema = z.enum(CAST_SWAP_PROMPT_WORDINGS)

/** What an admin saves: strict (an unknown engine or value is refused). */
export const nodaroMotionPromptWordingSchema: z.ZodType<NodaroMotionPromptWording> = z.strictObject({
  "motion-prism": wordingSchema.optional(),
  "motion-pulse": wordingSchema.optional(),
})

/** The setting with every `"current"` entry left out (the same as never set): what is stored. A new object. */
export function newWordings(setting: NodaroMotionPromptWording | null | undefined): NodaroMotionPromptWording {
  const out: NodaroMotionPromptWording = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (setting?.[engine] === "new") out[engine] = "new"
  }
  return out
}

/** Whether any engine is on the new wording. */
export function anyNewWording(setting: NodaroMotionPromptWording | null | undefined): boolean {
  return Object.keys(newWordings(setting)).length > 0
}

/** One engine's wording: `"current"` unless the setting puts it on the new one. */
export function promptWordingOf(setting: NodaroMotionPromptWording | null | undefined, engine: NodaroMotionEngine): CastSwapPromptWording {
  return setting?.[engine] === "new" ? "new" : "current"
}

/**
 * What the plugin is answered: each engine on the new wording, also under its
 * earlier key (the TRANSITION SHIM every Nodaro Motion setting's accessor
 * answers, `withEarlierEngineKeys`), a new object; null when every engine is
 * current.
 */
export function promptWordingForPlugin(setting: NodaroMotionPromptWording | null | undefined): NodaroMotionPromptWordingForPlugin | null {
  const kept = newWordings(setting)
  return Object.keys(kept).length > 0 ? withEarlierEngineKeys(kept) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's wording validated on its own, an invalid
 * one dropped with a warning (that engine then stays current). Not an object
 * reads as never saved (null).
 */
export function parseNodaroMotionPromptWording(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionPromptWording | null {
  const parsed = parseByEngine(value, NODARO_MOTION_PROMPT_WORDING_KEY, wordingSchema, warn)
  return parsed ? newWordings(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine words a Flexible prompt in
 * `wording` (`castSwap.promptWordings` lists it). An engine without it is
 * never sent a wording: its Flex runs are worded as today.
 */
export function engineTakesPromptWording(
  cs: { readonly promptWordings?: readonly string[] } | undefined,
  wording: CastSwapPromptWording,
): boolean {
  return (cs?.promptWordings ?? []).includes(wording)
}
