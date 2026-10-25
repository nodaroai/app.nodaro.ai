// @test-units-by-name looks up only llm-chat and generate-image, by type, in literal graphs
import { describe, expect, it } from "vitest"
import { runHoldsMeteredLlmEstimate } from "../credits.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../lib/llm-metered-schema-gate.js"

const llm = { id: "l", type: "llm-chat", data: { prompt: "hi" } }
const image = { id: "i", type: "generate-image", data: { provider: "z-image" } }

describe("runHoldsMeteredLlmEstimate (a Render final quote's `≈`)", () => {
  it("true exactly when a node the run executes makes a metered LLM call", () => {
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      expect(runHoldsMeteredLlmEstimate([llm, image], [], new Set(["l", "i"]))).toBe(true)
      // The LLM node is not in the run set: the run's figure is fixed.
      expect(runHoldsMeteredLlmEstimate([llm, image], [], new Set(["i"]))).toBe(false)
      // A frozen node makes no call.
      expect(runHoldsMeteredLlmEstimate([{ ...llm, data: { ...llm.data, skipped: true } }], [], new Set(["l"]))).toBe(false)
    } finally {
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })

  it("never under the rollback (no metered key priced)", () => {
    setLlmMeteredSchemaReadyForTesting(false)
    try {
      expect(runHoldsMeteredLlmEstimate([llm], [], new Set(["l"]))).toBe(false)
    } finally {
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })
})
