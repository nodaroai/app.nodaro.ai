/**
 * Turn budget.
 *
 * The credit reservation is a HARD ceiling: `commit_credits` refunds a
 * surplus but never charges above what was reserved, so a turn that outspends
 * its reservation is served at our expense. The loop therefore has to stop
 * itself — this module converts the reservation into a USD budget and answers
 * "can the next model call still fit".
 */
import { creditsToUsd } from "@nodaro/shared"
import { getAppSettings } from "../../lib/app-settings.js"
import { effectiveMarkupPercent } from "../billing/service-margin.js"
import { calculateLlmCost } from "../../lib/pricing/llm-cost.js"
import { COPILOT_FEATURE, TURN_CAPS } from "./constants.js"

export interface TurnBudget {
  /** Provider USD the turn may spend before the committed credits would exceed the reservation. */
  readonly limitUsd: number
  readonly reservedCredits: number
}

/**
 * Invert the commit formula: committed = ceil(usdToCredits(usd) × (1 + rate)),
 * so the spend that still commits at or below `reservedCredits` is
 * `reservedCredits / (1 + rate)` credits' worth of USD. `budgetSafetyShare`
 * leaves room for the ceil() and for the last call overshooting its estimate.
 */
export async function resolveTurnBudget(reservedCredits: number): Promise<TurnBudget> {
  const settings = await getAppSettings()
  const ratePercent = effectiveMarkupPercent(settings, COPILOT_FEATURE)
  const creditsHeadroom = (reservedCredits * TURN_CAPS.budgetSafetyShare) / (1 + ratePercent / 100)
  return { limitUsd: Math.max(0, creditsToUsd(creditsHeadroom)), reservedCredits }
}

/**
 * What the next call is likely to cost: the prompt we are about to send, plus
 * a TYPICAL reply.
 *
 * Not `max_tokens`. Pricing every call at its 16k-token ceiling made the
 * estimate larger than a whole turn's budget, so the very first check
 * refused the very first call and the copilot answered nothing, ever
 * (caught in review; `budget.test.ts` pins it now). Real replies are a few
 * thousand tokens, the iteration cap bounds the tail, and the ceiling itself
 * is the backstop if a turn runs hot.
 *
 * `cached` prices the prompt at the cache-read rate — from the second
 * iteration on, the prefix is a cache hit, and charging it at the full input
 * rate would end turns early for money that is never spent.
 */
const TYPICAL_REPLY_TOKENS = 3_000

export function estimateNextCallUsd(modelId: string, promptChars: number, cached = false): number {
  const promptTokens = Math.ceil(promptChars / 4)
  const prompt = cached ? { inputTokens: 0, cacheReadTokens: promptTokens } : { inputTokens: promptTokens }
  return calculateLlmCost(modelId, { ...prompt, outputTokens: TYPICAL_REPLY_TOKENS }, "direct")
}

/** True when spending `nextCallUsd` on top of `spentUsd` would break the budget. */
export function wouldExceedBudget(budget: TurnBudget, spentUsd: number, nextCallUsd: number): boolean {
  return spentUsd + nextCallUsd > budget.limitUsd
}
