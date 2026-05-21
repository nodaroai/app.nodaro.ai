import { describe, expect, it } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"

describe("NODE_REGISTRY: collect", () => {
  it("has a 'collect' entry with label, category=control, outputType=text", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "collect")
    expect(entry).toBeDefined()
    expect(entry!.label).toMatch(/collect/i)
    // Fan-in collapses N values into one — closest existing NodeCategory is
    // "control" (alongside list/loop/combine-text/split-text). The plan
    // suggested category "workflow" but no such category exists in the
    // NodeCategory union; "control" is the correct adapted value.
    expect(entry!.category).toBe("control")
    expect(entry!.outputType).toBe("text")
  })

  it("exposes strategyId as a required enum-style input with all 6 strategies", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "collect")
    expect(entry).toBeDefined()
    const strategyField = entry!.inputSchema?.fields.find((f) => f.key === "strategyId")
    expect(strategyField).toBeDefined()
    expect(strategyField!.required).toBe(true)
    expect(strategyField!.options).toEqual([
      "pick-best-llm",
      "concat",
      "first-non-empty",
      "count",
      "vote",
      "merge-json",
    ])
  })

  it("declares a dynamic per-strategy credit cost", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "collect")
    // Range string "0-3" reflects the spread across strategies — concat /
    // first-non-empty / count / vote / merge-json are 0cr; pick-best-llm is
    // 3cr. The composite key `collect:<strategyId>` does the real lookup at
    // runtime (see backend/src/ee/billing/credits.ts).
    expect(entry!.creditCost).toBe("0-3")
  })
})
