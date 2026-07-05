import { describe, it, expect } from "vitest"
import { bakeShotSequence } from "../baker.js"
import { BRAND_PRESETS } from "@nodaro/prompts"
import { ALIGN, brief } from "./baker-fixtures.js"

describe("bakeShotSequence brand passthrough", () => {
  it("carries brandTokens from brief to plan when present", () => {
    const b = brief({ brandTokens: BRAND_PRESETS["cobalt-corporate"] })
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    expect(plan.brandTokens).toEqual(BRAND_PRESETS["cobalt-corporate"])
  })

  it("omits brandTokens on the plan when the brief has none", () => {
    const { plan } = bakeShotSequence(brief(), ALIGN, "https://r2/vo.mp3")
    expect(plan.brandTokens).toBeUndefined()
  })
})
