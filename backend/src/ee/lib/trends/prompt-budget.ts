/**
 * How much of the Cast Swap prompt a trend's own prompts may take, so a user's
 * run never fails on length because of what the trend already put there.
 *
 * A run meets two limits:
 *
 * - The engine's `postPrompt` field (`CAST_SWAP_POST_PROMPT_MAX`): the trend
 *   prompt, a blank line, then the user's details. The trend prompt keeps room
 *   for the details at their longest (`TREND_DETAILS_MAX`, the run schema's
 *   `details` limit).
 * - The engine's whole built prompt, checked against Seedance 2.5's prompt cap
 *   (`ENGINE_PROMPT_MAX`, the same `getMaxVideoPromptChars("seedance-2-5")` the
 *   engine reads). Around the pre and trend prompts it adds its own text, kept
 *   as `ENGINE_TEXT_RESERVE`, and the details.
 *
 * A Kling 4 trend is held to Kling 4's far shorter cap
 * (`getMaxVideoPromptChars("kling-4")`), less the engine text of ITS OWN roles
 * and references (`klingEngineText`, measured from the engine's builder, at
 * the worst case it checks: every slot's 3 pictures numbered unprepared)
 * rather than the fixed worst case kept for Seedance.
 *
 * The numbers are `@nodaro/shared`'s (`CAST_SWAP_POST_PROMPT_MAX`,
 * `TREND_PROMPT_LIMITS`) and the formula is `@nodaro/render-rules`'
 * `trendPromptBudget`, which the admin screen (admin/trends/model.ts) runs
 * too, to show the room left and hold Save; publishing refuses a trend over either limit
 * (`publish-check.ts`, `prompt_budget`). A user's `{slot:…}` mentions that the
 * engine expands to long role names can still pass the cap: that run gets the
 * engine's own `prompt_too_long`.
 *
 * A trend that offers a 4 s preview is held to the budget twice: with the
 * full run's prompt parts, and with the preview's (its own role names,
 * reference lines, pre and trend prompts, each falling back to the full
 * run's: `withPromptsFor`). `promptModesOf` says when.
 */
import { TREND_PROMPT_LIMITS } from "@nodaro/shared/models"
import { trendPromptBudget, type TrendPromptBudget } from "@nodaro/render-rules"
import type { TrendVersionData } from "./types.js"

// The budget and when the preview is held to it are @nodaro/render-rules' (trend-prompts.ts),
// which the trend builder runs too: one formula, never a copy here.
export { ENGINE_PROMPT_MAX, KLING_ENGINE_PROMPT_MAX, TREND_DETAILS_MAX, promptModesOf } from "@nodaro/render-rules"

/**
 * The engine's own text around the trend's prompts, at its longest: a block
 * for each of the 13 roles a run allows (6 people, 3 pets, 3 products, 1
 * place) with 200-character role names, five 500-character reference lines,
 * the keep and mask lines, the edit line and the header before the post
 * prompt. That came to about 16,100 characters on the engine's template v1;
 * rounded up to 17,000 so a small wording change does not need this moved.
 */
export const ENGINE_TEXT_RESERVE = TREND_PROMPT_LIMITS.engineTextReserve

export type PromptBudget = TrendPromptBudget

/** The budget of these texts (pass a version, or `withPromptsFor` of one for a preview run). */
export function promptBudget(
  d: { readonly prePrompt?: string; readonly trendPrompt?: string } & Partial<Pick<TrendVersionData, "engine" | "slots" | "references">>,
): PromptBudget {
  return trendPromptBudget(d)
}
