/**
 * `@nodaro/render-rules`' trend-prompts.ts: the ONE rule for which prompt
 * texts a trend run sends (a 4 s preview's own, else the full run's) and the
 * room they must leave. The server (lib/trends/prompt-parts.ts,
 * prompt-budget.ts) and the trend builder (admin trends/model.ts) both run it
 * and keep no copy; render-rules has no test runner of its own, so its rules
 * are pinned from here, on the package's built entry as both callers import it.
 */
import { describe, expect, it } from "vitest"
import { CAST_SWAP_POST_PROMPT_MAX, getMaxVideoPromptChars, TREND_PROMPT_LIMITS } from "@nodaro/shared/models"
import {
  ENGINE_PROMPT_MAX,
  KLING_ENGINE_PROMPT_MAX,
  TREND_DETAILS_MAX,
  TREND_PROMPT_MODES,
  hasOwnPreviewPrompts,
  hasPreviewText,
  klingEngineText,
  previewTextOr,
  promptModesOf,
  trendPromptBudget,
  withPromptsFor,
} from "@nodaro/render-rules"
import * as serverBudget from "../prompt-budget.js"
import * as serverParts from "../prompt-parts.js"

/** As the builder's form holds them: every text a string, "" = none. */
const form = {
  previewStart: 2 as number | null,
  prePrompt: "FULL PRE",
  trendPrompt: "FULL TREND",
  previewPrePrompt: "",
  previewTrendPrompt: "PREVIEW TREND",
  slots: [
    { uid: "u1", kind: "person" as const, roleName: "the woman on the left", previewRoleName: "the woman" },
    { uid: "u2", kind: "location" as const, roleName: "the floor", previewRoleName: " " },
  ],
  references: [{ uid: "u3", images: ["https://cdn.test/r.png"], line: "the neon sign", previewLine: "" }],
}

describe("the preview fallback", () => {
  it("blank is no text", () => {
    expect([undefined, "", "  \n", "x"].map(hasPreviewText)).toEqual([false, false, false, true])
    expect(previewTextOr(" ", "full")).toBe("full")
    expect(previewTextOr("own", "full")).toBe("own")
    expect(previewTextOr(undefined, undefined)).toBeUndefined()
  })

  it("a preview sends each part's own text, else the full run's; a full run is the input itself", () => {
    expect(TREND_PROMPT_MODES).toEqual(["full", "preview"])
    expect(withPromptsFor(form, "full")).toBe(form)
    const p = withPromptsFor(form, "preview")
    expect(p.slots.map((s) => s.roleName)).toEqual(["the woman", "the floor"])
    expect(p.references.map((r) => r.line)).toEqual(["the neon sign"])
    expect([p.prePrompt, p.trendPrompt]).toEqual(["FULL PRE", "PREVIEW TREND"])
    // What the caller carries rides along untouched (the builder's list ids, a version's images).
    expect(p.slots.map((s) => s.uid)).toEqual(["u1", "u2"])
    expect(p.references[0]!.images).toEqual(["https://cdn.test/r.png"])
    expect(form.slots[0]!.roleName).toBe("the woman on the left")
  })

  it("the preview is held to the budget only while offered and worded its own way", () => {
    expect(hasOwnPreviewPrompts(form)).toBe(true)
    expect(promptModesOf(form)).toEqual(["full", "preview"])
    expect(promptModesOf({ ...form, previewStart: null })).toEqual(["full"])
    const none = { ...form, previewTrendPrompt: "", slots: form.slots.map((s) => ({ ...s, previewRoleName: "" })) }
    expect(hasOwnPreviewPrompts(none)).toBe(false)
    expect(promptModesOf(none)).toEqual(["full"])
  })
})

describe("trendPromptBudget", () => {
  it("is the platform's limits: the post prompt field and the engine's whole-prompt cap", () => {
    expect(TREND_DETAILS_MAX).toBe(TREND_PROMPT_LIMITS.detailsMax)
    expect(ENGINE_PROMPT_MAX).toBe(getMaxVideoPromptChars("seedance-2-5"))
    expect(KLING_ENGINE_PROMPT_MAX).toBe(getMaxVideoPromptChars("kling-4"))
    const b = trendPromptBudget({})
    expect(b.trendPromptMax).toBe(CAST_SWAP_POST_PROMPT_MAX - 2 - TREND_DETAILS_MAX)
    expect(b.promptsMax).toBe(ENGINE_PROMPT_MAX - TREND_PROMPT_LIMITS.engineTextReserve - 2 - TREND_DETAILS_MAX)
    expect(trendPromptBudget({ prePrompt: "p".repeat(100), trendPrompt: "t".repeat(50) }).room).toBe(
      Math.min(b.trendPromptMax - 50, b.promptsMax - 150),
    )
  })

  it("on Kling 4, less the engine text of the texts it is given (a preview's own role names and lines)", () => {
    const k = { ...form, engine: "kling-4" }
    const full = trendPromptBudget(k)
    const preview = trendPromptBudget(withPromptsFor(k, "preview"))
    expect(full.promptsMax).toBe(KLING_ENGINE_PROMPT_MAX - klingEngineText(k) - 2 - TREND_DETAILS_MAX)
    // "the woman" is shorter than "the woman on the left": the preview has more room.
    expect(preview.promptsMax - full.promptsMax).toBe("the woman on the left".length - "the woman".length)
  })
})

describe("the server keeps no copy", () => {
  it("re-exports the rule and budgets through it", () => {
    expect(serverParts.withPromptsFor).toBe(withPromptsFor)
    expect(serverParts.hasOwnPreviewPrompts).toBe(hasOwnPreviewPrompts)
    expect(serverParts.hasPreviewText).toBe(hasPreviewText)
    expect(serverBudget.promptModesOf).toBe(promptModesOf)
    expect(serverBudget.TREND_DETAILS_MAX).toBe(TREND_DETAILS_MAX)
    expect(serverBudget.promptBudget({ trendPrompt: "abc", prePrompt: "d" })).toEqual(trendPromptBudget({ trendPrompt: "abc", prePrompt: "d" }))
  })
})
