import { describe, expect, it } from "vitest"
import { countEmptyInputSkips, executionOutcome } from "../execution-outcome.js"

/**
 * How a completed run ended, derived on read from its node states — never a
 * column. The rule every surface asks (the editor, the Executions tab, apps,
 * Present, REST / SDK, MCP get_app_run / diagnose_run).
 */
describe("executionOutcome", () => {
  it("a completed run with a node skipped for want of input is nothing_new", () => {
    const states = {
      feed: { status: "completed", output: { text: "" } },
      llm: { status: "skipped", skipReason: "empty_input" },
      tts: { status: "skipped", skipReason: "empty_input" },
    }
    expect(executionOutcome("completed", states)).toBe("nothing_new")
    expect(countEmptyInputSkips(states)).toBe(2)
  })

  it("a completed run whose skips are router gates (no reason) succeeded", () => {
    const states = {
      router: { status: "completed", output: { routeOutputs: { a: "x" } } },
      b: { status: "skipped" },
      a: { status: "completed", output: { text: "x" } },
    }
    expect(executionOutcome("completed", states)).toBe("succeeded")
    expect(countEmptyInputSkips(states)).toBe(0)
  })

  it("a run that has not completed has no outcome — a failed run has a status, not an outcome", () => {
    const states = { llm: { status: "skipped", skipReason: "empty_input" } }
    expect(executionOutcome("running", states)).toBeUndefined()
    expect(executionOutcome("failed", states)).toBeUndefined()
    expect(executionOutcome("cancelled", states)).toBeUndefined()
    expect(executionOutcome(undefined, states)).toBeUndefined()
  })

  it("tolerates empty, null and malformed states", () => {
    expect(executionOutcome("completed", {})).toBe("succeeded")
    expect(executionOutcome("completed", null)).toBe("succeeded")
    expect(executionOutcome("completed", undefined)).toBe("succeeded")
    expect(countEmptyInputSkips({ odd: null as unknown as { status?: unknown }, other: { skipReason: "empty_input" } })).toBe(0)
  })
})
