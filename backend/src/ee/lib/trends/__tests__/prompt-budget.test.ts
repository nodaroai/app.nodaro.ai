/**
 * A trend's pre prompt and trend prompt must leave room for the user's
 * details at their longest, under both limits a run meets: the engine's
 * post prompt field (trend prompt + details) and its whole built prompt.
 */
import { describe, expect, it } from "vitest"
import { getMaxVideoPromptChars } from "@nodaro/shared/models"
import { CAST_SWAP_POST_PROMPT_MAX } from "../compose.js"
import { trendRunRequestSchema } from "../schemas.js"
import { castSwapImagesSent, KLING_ENGINE_TEXT, klingEngineText } from "@nodaro/render-rules"
import { ENGINE_PROMPT_MAX, ENGINE_TEXT_RESERVE, KLING_ENGINE_PROMPT_MAX, TREND_DETAILS_MAX, promptBudget } from "../prompt-budget.js"

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

  it("holds a Kling 4 trend to Kling 4's cap, less the engine text of its own roles and references", () => {
    expect(KLING_ENGINE_PROMPT_MAX).toBe(getMaxVideoPromptChars("kling-4"))
    const slots = [
      { key: "lead", label: { en: "Lead" }, kind: "person" as const, required: true, roleName: "the woman on the left" },
      { key: "dog", label: { en: "Dog" }, kind: "pet" as const, required: false, roleName: "the dog" },
    ]
    const references = [{ images: ["https://x/r.png"], line: "the sign {image}" }]
    const b = promptBudget({ engine: "kling-4", slots, references })
    expect(b.promptsMax).toBe(KLING_ENGINE_PROMPT_MAX - klingEngineText({ slots, references }) - 2 - TREND_DETAILS_MAX)
    expect(b.promptsMax).toBeLessThan(promptBudget({ slots, references }).promptsMax)
    // A long pre prompt that fits Seedance does not fit Kling 4.
    expect(promptBudget({ slots, references, prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(2998) }).room).toBeGreaterThanOrEqual(0)
    const long = [{ images: ["https://x/r.png"], line: "l".repeat(500) }]
    expect(promptBudget({ engine: "kling-4", slots, references: long, prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(2998) }).room).toBeLessThan(0)
  })

  it("pins Kling 4's engine text by part, as measured from the engine's prompt builder", () => {
    expect(KLING_ENGINE_TEXT).toEqual({
      head: 425,
      role: { person: 208, pet: 190, product: 269, location: 154 },
      reference: 50,
      referenceImageMention: 1,
      prePrompt: 2,
      postPrompt: 49,
      mentions: { person: 5, pet: 4, product: 3, location: 1 },
    })
  })

  it("counts two-digit image numbers from the worst-case raw count: 10 person slots × 3 pictures", () => {
    const slots = Array.from({ length: 10 }, () => ({ kind: "person" as const, roleName: "" }))
    // The engine's builder, Kling-expanded, measured 2,554 characters for these roles (head included):
    // 425 + 10 × 208 + 49 for the image numbers 10–30 (7 first images named 5 times, 14 others once).
    expect(klingEngineText({ slots, references: [] })).toBe(2554 + 2 + 49)
    // A reference after them is numbered from 31.
    const withRef = klingEngineText({ slots, references: [{ images: [1, 2, 3], line: "the sign {image}" }] })
    expect(withRef - klingEngineText({ slots, references: [] })).toBe(50 + 16 + 1 + 1 + 2)
  })

  it("counts a prepared role as one picture, a location (never prepared) and a role with preparation off as its own", () => {
    const roles = [
      { kind: "person" as const, images: 3 },
      { kind: "pet" as const, images: 2 },
      { kind: "product" as const, images: 1 },
      { kind: "location" as const, images: 3 },
      { kind: "person" as const, images: 0 },
    ]
    expect(castSwapImagesSent(roles, 2)).toBe(1 + 1 + 1 + 3 + 2)
    expect(castSwapImagesSent(roles, 2, false)).toBe(3 + 2 + 1 + 3 + 2)
  })
})
