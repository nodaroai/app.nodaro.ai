// A trigger fire whose branch stops at a Preview render has nobody to review
// it: refused BEFORE the lane creates an execution or enqueues anything, with
// one deduped tombstone row carrying the stable code.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared"

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

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))

import { refusePreviewFire } from "../preview-fire-refusal.js"

const branch = (quality: "proxy" | "final") => ({
  nodes: [
    { id: "trig", type: "schedule-trigger", data: {} },
    { id: "plan", type: "edit-plan", data: {} },
    { id: "cut", type: "apply-edl", data: { quality } },
    { id: "out", type: "webhook-output", data: {} },
  ],
  edges: [
    { id: "a", source: "trig", target: "plan" },
    { id: "b", source: "plan", target: "cut" },
    { id: "c", source: "cut", target: "out" },
  ],
})

const fire = { workflowId: "wf-1", userId: "u-1", triggerType: "schedule" as const, triggerId: "t-1", triggerNodeId: "trig" }

beforeEach(() => {
  flag.on = true
  graph.value = null
  graphError.value = null
  latest.value = null
  inserts.length = 0
})

describe("refusePreviewFire", () => {
  it("refuses a fire whose branch runs a Preview render, leaving one tombstone with the code", async () => {
    graph.value = branch("proxy")
    expect(await refusePreviewFire(fire)).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      workflow_id: "wf-1",
      user_id: "u-1",
      status: "failed",
      trigger_type: "schedule",
      error_message: PREVIEW_REVIEW_REQUIRED,
      trigger_data: { triggerId: "t-1" },
    })
  })

  it("does not write a second tombstone when the latest run of the lane is already this refusal", async () => {
    graph.value = branch("proxy")
    latest.value = { id: "x", status: "failed", error_message: PREVIEW_REVIEW_REQUIRED }
    expect(await refusePreviewFire(fire)).toBe(true)
    expect(inserts).toHaveLength(0)
  })

  it("lets a Final workflow fire", async () => {
    graph.value = branch("final")
    expect(await refusePreviewFire(fire)).toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it("leaves an unreadable graph to the run (the orchestrator's wall still refuses)", async () => {
    graphError.value = { message: "boom" }
    expect(await refusePreviewFire(fire)).toBe(false)
    expect(inserts).toHaveLength(0)
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): dev before the rule", () => {
  it("never refuses a fire, and never reads the graph or writes a row", async () => {
    flag.on = false
    graph.value = branch("proxy")
    mockFrom.mockClear()
    expect(await refusePreviewFire(fire)).toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(inserts).toEqual([])
  })
})
