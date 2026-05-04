import { describe, it, expect } from "vitest"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { ACTION_FX } from "../action-fx.js"

describe("getParameterPromptHint — action-fx", () => {
  it("returns the catalog hint for a single id", () => {
    const first = ACTION_FX[0]
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: { actionFx: first.id } })
    expect(result).toBe(first.promptHint)
  })

  it("returns comma-joined hints for two ids", () => {
    const a = ACTION_FX[0]
    const b = ACTION_FX[1]
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: { actionFx: [a.id, b.id] } })
    expect(result).toBe(`${a.promptHint}, ${b.promptHint}`)
  })

  it("returns empty string when no actionFx is set", () => {
    const result = getParameterPromptHint({ id: "n1", type: "action-fx", data: {} })
    expect(result).toBe("")
  })
})
