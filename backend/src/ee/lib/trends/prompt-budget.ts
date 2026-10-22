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
 * The numbers are `@nodaro/shared`'s (`CAST_SWAP_POST_PROMPT_MAX`,
 * `TREND_PROMPT_LIMITS`), which the admin screen (admin/trends/model.ts) reads
 * too, to show the room left and hold Save; publishing refuses a trend over either limit
 * (`publish-check.ts`, `prompt_budget`). A user's `{slot:…}` mentions that the
 * engine expands to long role names can still pass the cap: that run gets the
 * engine's own `prompt_too_long`.
 */
import { getMaxVideoPromptChars, TREND_PROMPT_LIMITS } from "@nodaro/shared/models"
import { CAST_SWAP_POST_PROMPT_MAX } from "./compose.js"

/** The run schema's `details` limit (`trendRunRequestSchema` reads it too). */
export const TREND_DETAILS_MAX = TREND_PROMPT_LIMITS.detailsMax

/** The Cast Swap engine's cap on the whole prompt it builds. */
export const ENGINE_PROMPT_MAX = getMaxVideoPromptChars("seedance-2-5")

/**
 * The engine's own text around the trend's prompts, at its longest: a block
 * for each of the 13 roles a run allows (6 people, 3 pets, 3 products, 1
 * place) with 200-character role names, five 500-character reference lines,
 * the keep and mask lines, the edit line and the header before the post
 * prompt. That came to about 16,100 characters on the engine's template v1;
 * rounded up to 17,000 so a small wording change does not need this moved.
 */
export const ENGINE_TEXT_RESERVE = TREND_PROMPT_LIMITS.engineTextReserve

/** The blank line ("\n\n") between two prompt parts. */
const SEP = 2

export interface PromptBudget {
  /** The longest trend prompt that leaves the details their room in the post prompt field. */
  readonly trendPromptMax: number
  /** The longest pre prompt + trend prompt that leave the engine's text and the details their room. */
  readonly promptsMax: number
  /** Characters still free under the tighter of the two; below 0 = over by that much. */
  readonly room: number
}

export function promptBudget(d: { readonly prePrompt?: string; readonly trendPrompt?: string }): PromptBudget {
  const pre = d.prePrompt?.length ?? 0
  const trend = d.trendPrompt?.length ?? 0
  const trendPromptMax = CAST_SWAP_POST_PROMPT_MAX - SEP - TREND_DETAILS_MAX
  const promptsMax = ENGINE_PROMPT_MAX - ENGINE_TEXT_RESERVE - SEP - TREND_DETAILS_MAX
  return { trendPromptMax, promptsMax, room: Math.min(trendPromptMax - trend, promptsMax - pre - trend) }
}
