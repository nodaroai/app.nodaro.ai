import { describe, it, expect } from "vitest"
import { ANIMATE_SUB_GATES, MATCH_CUT_BREAK_GATE, SubGateNameSchema } from "../pipeline-state-types.js"

/**
 * Every sub-gate a stage can pause at must have a way to clear it. Stage 7's
 * resolve through `POST /v1/pipelines/:id/sub-gates/:gate/{approve,reject}`
 * (`ANIMATE_SUB_GATES`); Stage 6's match-cut gate clears one break at a time
 * through its scene helper. The SDK once documented approveSubGate for the
 * match-cut gate, a call that could never succeed. A new gate fails here until
 * someone decides which of the two it is.
 */
describe("sub-gates", () => {
  it("each is resolved by the sub-gate routes or is the per-break match-cut gate", () => {
    const handled = [...ANIMATE_SUB_GATES, MATCH_CUT_BREAK_GATE].sort()
    expect([...SubGateNameSchema.options].sort()).toEqual(handled)
  })

  it("the sub-gate routes never take the match-cut gate", () => {
    expect(ANIMATE_SUB_GATES).not.toContain(MATCH_CUT_BREAK_GATE)
  })
})
