/**
 * A trend's pre prompt and trend prompt must leave room for the user's
 * details at their longest, under both limits a run meets: the engine's
 * post prompt field (trend prompt + details) and its whole built prompt.
 */
import { describe, expect, it } from "vitest"
import { getMaxVideoPromptChars } from "@nodaro/shared/models"
import { CAST_SWAP_POST_PROMPT_MAX } from "../compose.js"
import { trendRunRequestSchema } from "../schemas.js"
import { ENGINE_PROMPT_MAX, ENGINE_TEXT_RESERVE, TREND_DETAILS_MAX, promptBudget } from "../prompt-budget.js"

describe("promptBudget", () => {
  it("reads the engine's cap from the platform's Seedance 2.5 limit, and the details limit from the run schema", () => {
    expect(ENGINE_PROMPT_MAX).toBe(getMaxVideoPromptChars("seedance-2-5"))
    expect(trendRunRequestSchema.safeParse({ slots: {}, details: "d".repeat(TREND_DETAILS_MAX) }).success).toBe(true)
    expect(trendRunRequestSchema.safeParse({ slots: {}, details: "d".repeat(TREND_DETAILS_MAX + 1) }).success).toBe(false)
  })

  it("the trend prompt keeps room in the post prompt field for the details and the blank line before them", () => {
    const b = promptBudget({})
    expect(b.trendPromptMax).toBe(CAST_SWAP_POST_PROMPT_MAX - 2 - TREND_DETAILS_MAX)
    expect(b.promptsMax).toBe(ENGINE_PROMPT_MAX - ENGINE_TEXT_RESERVE - 2 - TREND_DETAILS_MAX)
    expect(b.room).toBe(b.trendPromptMax)
  })

  it("room is what is left under the tighter of the two limits; below 0 = over", () => {
    expect(promptBudget({ trendPrompt: "t".repeat(1000) }).room).toBe(promptBudget({}).trendPromptMax - 1000)
    expect(promptBudget({ trendPrompt: "t".repeat(promptBudget({}).trendPromptMax + 1) }).room).toBe(-1)
    // The pre prompt counts only toward the whole prompt.
    expect(promptBudget({ prePrompt: "p".repeat(3000) }).room).toBe(
      Math.min(promptBudget({}).trendPromptMax, promptBudget({}).promptsMax - 3000),
    )
  })
})
