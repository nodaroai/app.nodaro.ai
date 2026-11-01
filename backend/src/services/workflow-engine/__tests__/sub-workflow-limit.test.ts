/**
 * The limiter of an inline sub-workflow's levels follows the run's dispatch
 * width: `MAX_CONCURRENT_NODES_PER_EXECUTION` while concurrency lanes are not
 * enforced (today's value, whatever the tier), and the run's
 * `ORCHESTRATOR_DISPATCH_WIDTH` once they are. The run decides once, at its
 * start (`OrchestratorContext.runDispatch`); a context without that decision
 * (a caller outside the orchestrator) keeps today's value.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const refs = vi.hoisted(() => ({
  subNodes: [] as SimpleNode[],
  seen: { now: 0, peak: 0, calls: 0 },
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          single: async () => ({ data: { nodes: refs.subNodes, edges: [] }, error: null }),
        }
        return chain
      },
    }),
  },
}))
vi.mock("../../../lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("../node-executor.js", () => ({
  executeNode: vi.fn(async () => {
    refs.seen.calls++
    refs.seen.now++
    refs.seen.peak = Math.max(refs.seen.peak, refs.seen.now)
    try {
      await new Promise((r) => setTimeout(r, 20))
      return { output: { text: "x" } }
    } finally {
      refs.seen.now--
    }
  }),
}))

import { executeSubWorkflow } from "../sub-workflow-handler.js"
import { config } from "../../../lib/config.js"

function ctx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    billingContext: { payer: "user", userId: "user-1" },
    cancelled: false,
    ...overrides,
  }
}

const SUB = { id: "sw", type: "sub-workflow", data: { workflowId: "ref-wf" } }

beforeEach(() => {
  // Twelve independent nodes, more than either width below.
  refs.subNodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, type: "llm-chat", data: { prompt: `p${i}` } }))
  refs.seen = { now: 0, peak: 0, calls: 0 }
})

describe("sub-workflow limiter", () => {
  it("the sub-workflow limiter follows dispatchWidth", async () => {
    await executeSubWorkflow(SUB, {}, ctx({ runDispatch: { lanesEnforced: true, width: 3 } }))
    expect(refs.seen.calls).toBe(12)
    expect(refs.seen.peak).toBe(3)
  })

  it("with enforcement off changes nothing: MAX_CONCURRENT_NODES_PER_EXECUTION, not the tier's width", async () => {
    // A free run's own levels dispatch 2; its sub-workflows have always run at the env value.
    await executeSubWorkflow(SUB, {}, ctx({ runDispatch: { lanesEnforced: false, width: 2 } }))
    expect(refs.seen.calls).toBe(12)
    expect(refs.seen.peak).toBe(config.MAX_CONCURRENT_NODES_PER_EXECUTION)
  })

  it("a context with no run decision keeps today's limiter", async () => {
    await executeSubWorkflow(SUB, {}, ctx())
    expect(refs.seen.peak).toBe(config.MAX_CONCURRENT_NODES_PER_EXECUTION)
  })
})
