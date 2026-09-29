import { describe, it, expect } from "vitest"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"

describe("Motion's prompt clause", () => {
  it.each([
    ["subtle", /subtle, gentle motion/],
    ["moderate", /moderate, natural motion/],
    ["dynamic", /dynamic, energetic motion/],
  ])("%s", (motion, clause) => {
    expect(getParameterPromptHint({ id: "m", type: "motion", data: { motion } })).toMatch(clause)
  })

  it("is the bare term in compact mode", () => {
    expect(getParameterPromptHint({ id: "m", type: "motion", data: { motion: "dynamic", hintMode: "compact" } })).toBe("dynamic motion")
  })

  it("is empty for an unknown step", () => {
    expect(getParameterPromptHint({ id: "m", type: "motion", data: { motion: "wild" } })).toBe("")
  })
})
