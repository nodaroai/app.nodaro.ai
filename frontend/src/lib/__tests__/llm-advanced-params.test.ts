// @vitest-environment node
/**
 * The canvas path must send what the orchestrated path sends.
 *
 * This exists because it once didn't. `node-executor` forwarded `advancedMode`
 * while every canvas API wrapper dropped it, so on single-node Run the node
 * badge showed the bumped price, the credit guard reserved the lower tier, and
 * the request quietly stayed on the aggregator with the user's temperature and
 * effort discarded. The backend has `llmNodeParams` + its own guard test; this
 * is the other half.
 */
import { describe, it, expect } from "vitest"
import { llmAdvancedParams } from "../llm-advanced-params"

describe("llmAdvancedParams", () => {
  it("forwards the trio when set", () => {
    expect(llmAdvancedParams({ advancedMode: true, temperature: 1.4, maxTokens: 4096 }))
      .toEqual({ advancedMode: true, temperature: 1.4, maxTokens: 4096 })
  })

  it("returns undefined for everything on a bare node", () => {
    expect(llmAdvancedParams({})).toEqual({
      advancedMode: undefined,
      temperature: undefined,
      maxTokens: undefined,
    })
  })

  it("tolerates undefined data", () => {
    expect(llmAdvancedParams(undefined).advancedMode).toBeUndefined()
  })

  it("only a real boolean true enables advanced", () => {
    // A truthy string reaching the wire would bump the tier server-side on a
    // node the user never opted in on.
    expect(llmAdvancedParams({ advancedMode: "yes" }).advancedMode).toBeUndefined()
    expect(llmAdvancedParams({ advancedMode: 1 }).advancedMode).toBeUndefined()
    expect(llmAdvancedParams({ advancedMode: false }).advancedMode).toBeUndefined()
  })

  it("never sends false — undefined keeps stored node data byte-identical", () => {
    expect(llmAdvancedParams({ advancedMode: false })).toEqual({
      advancedMode: undefined,
      temperature: undefined,
      maxTokens: undefined,
    })
  })

  it("ignores non-numeric sampling values rather than forwarding them", () => {
    // The route's Zod would 400 on these; dropping them keeps a corrupt stored
    // value from breaking every run of that node.
    expect(llmAdvancedParams({ temperature: "hot", maxTokens: "lots" }))
      .toEqual({ advancedMode: undefined, temperature: undefined, maxTokens: undefined })
  })

  it("passes temperature 0 through — it is a value, not a missing one", () => {
    expect(llmAdvancedParams({ temperature: 0 }).temperature).toBe(0)
  })
})
