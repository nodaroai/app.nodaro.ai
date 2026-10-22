// A trigger fire whose branch meets a metered LLM model with no price (R51): refused BEFORE the
// lane creates an execution or enqueues anything — so no fixed node upstream of the call runs and
// charges — with one deduped tombstone row carrying the stable code.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, graph, graphError, latest, inserts } = vi.hoisted(() => {
  const graph: { value: Record<string, unknown> | null } = { value: null }
  const graphError: { value: { message: string } | null } = { value: null }
  const latest: { value: Record<string, unknown> | null } = { value: null }
  const inserts: Array<Record<string, unknown>> = []
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "order", "limit"]) chain[m] = vi.fn().mockReturnValue(chain)
    chain.single = vi.fn().mockImplementation(async () =>
      table === "workflows" ? { data: graph.value, error: graphError.value } : { data: null, error: null },
    )
    chain.maybeSingle = vi.fn().mockImplementation(async () => ({ data: latest.value, error: null }))
    chain.insert = vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
      inserts.push(row)
      return { data: null, error: null }
    })
    return chain
  })
  return { mockFrom, graph, graphError, latest, inserts }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
const pricing = vi.hoisted(() => ({ credits: true, metered: true }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => pricing.credits,
  llmMeteredPricing: () => pricing.metered,
}))
// The estimator (unit-tested in workflow-estimate-metered.test.ts): a node naming "unpriced-model"
// among the nodes the run executes is the call the run would be refused at.
const asked = vi.hoisted(() => ({ runNodeIds: [] as Array<string[] | undefined> }))
vi.mock("@/ee/billing/credits.js", () => ({
  unpricedMeteredLlmOfRun: (nodes: Array<{ id: string; data?: { llmModel?: unknown } }>, _edges: unknown, runNodeIds?: ReadonlySet<string>) => {
    asked.runNodeIds.push(runNodeIds ? [...runNodeIds].sort() : undefined)
    return nodes.some((n) => (!runNodeIds || runNodeIds.has(n.id)) && n.data?.llmModel === "unpriced-model")
      ? Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "unpriced-model" })
      : null
  },
}))

import { refuseUnpricedFire } from "../llm-unpriced-fire-refusal.js"

const branch = (model: string) => ({
  nodes: [
    { id: "trig", type: "schedule-trigger", data: {} },
    { id: "gen", type: "generate-image", data: { prompt: "a cat" } },
    { id: "chat", type: "llm-chat", data: { llmModel: model } },
    { id: "elsewhere", type: "llm-chat", data: { llmModel: "unpriced-model" } },
  ],
  edges: [
    { id: "a", source: "trig", target: "gen" },
    { id: "b", source: "gen", target: "chat" },
  ],
})

const fire = { workflowId: "wf-1", userId: "u-1", triggerType: "schedule" as const, triggerId: "t-1", triggerNodeId: "trig" }
const MESSAGE = 'The model "unpriced-model" has no price yet, so it cannot be run. Choose another model.'

beforeEach(() => {
  pricing.credits = true
  pricing.metered = true
  graph.value = null
  graphError.value = null
  latest.value = null
  inserts.length = 0
  asked.runNodeIds.length = 0
  mockFrom.mockClear()
})

describe("refuseUnpricedFire", () => {
  it("refuses a fire whose branch meets an unpriced model, with the routes' body and one tombstone carrying the code", async () => {
    graph.value = branch("unpriced-model")
    expect(await refuseUnpricedFire(fire)).toEqual({ code: "validation_error", reason: "llm_model_unpriced", modelId: "unpriced-model", message: MESSAGE })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      workflow_id: "wf-1",
      user_id: "u-1",
      status: "failed",
      trigger_type: "schedule",
      error_message: "llm_model_unpriced",
      trigger_data: { triggerId: "t-1" },
    })
  })

  it("asks only of the branch the fire runs: an unpriced node off the branch does not refuse it", async () => {
    graph.value = branch("claude-opus-5.5")
    expect(await refuseUnpricedFire(fire)).toBeNull()
    expect(asked.runNodeIds[0]).toEqual(["chat", "gen", "trig"])
    expect(inserts).toHaveLength(0)
  })

  it("does not write a second tombstone when the latest run of the lane is already this refusal", async () => {
    graph.value = branch("unpriced-model")
    latest.value = { id: "x", status: "failed", error_message: "llm_model_unpriced" }
    expect(await refuseUnpricedFire(fire)).toMatchObject({ reason: "llm_model_unpriced" })
    expect(inserts).toHaveLength(0)
  })

  it("leaves an unreadable graph to the run (the orchestrator's wall still refuses)", async () => {
    graphError.value = { message: "boom" }
    expect(await refuseUnpricedFire(fire)).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  it("without credits, or under the tier-pricing rollback, never refuses and never reads the graph", async () => {
    graph.value = branch("unpriced-model")
    pricing.metered = false
    expect(await refuseUnpricedFire(fire)).toBeNull()
    pricing.metered = true
    pricing.credits = false
    expect(await refuseUnpricedFire(fire)).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
