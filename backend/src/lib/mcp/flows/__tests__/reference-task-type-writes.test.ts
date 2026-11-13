/**
 * A stored Seedance reference task type on the MCP conversation flows' writes
 * (decided 2026-11-13): the delta that records an assistant's step
 * (`applyFlowDelta`) and the insert that files earlier generations as a
 * conversation (`applyHistory`) store the graph with a `referenceTaskType` no
 * model the node runs lists removed — that one key, nothing else
 * (`withListedReferenceTaskTypes`). The whole stored node list is asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({ rpcArgs: [] as Array<Record<string, unknown>>, inserts: [] as Array<Record<string, unknown>> }))
vi.mock("../../../supabase.js", () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "range"]) c[m] = () => c
    c.maybeSingle = async () => ({ data: { id: "wf-1", version: 3, nodes: [], edges: [], settings: {} }, error: null })
    c.single = async () => ({ data: { id: "wf-1" }, error: null })
    c.insert = (row: Record<string, unknown>) => {
      db.inserts.push(row)
      return { ...c, then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) }
    }
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return c
  }
  return {
    supabase: {
      from: () => chain(),
      rpc: async (_name: string, args: Record<string, unknown>) => {
        db.rpcArgs.push(args)
        return { data: [{ ok: true, version: 4 }], error: null }
      },
    },
  }
})
vi.mock("../../tools/_mcp-project.js", () => ({ ensureMcpProject: async () => "project-1" }))
vi.mock("../conversation-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../conversation-store.js")>()),
  ensureMonthHub: async () => "hub-1",
}))

import { applyFlowDelta } from "../workflow-delta.js"
import { applyHistory, planHistory, type HistoryJob } from "../history.js"

const at = { x: 0, y: 0 }
const KLING = { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", referenceTaskType: "edit" } }
const SD25 = { id: "sd25", type: "generate-video", position: at, data: { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } }
const IMG = { id: "img", type: "generate-image", position: at, data: { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" } }
const KLING_STORED = { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9" } }

beforeEach(() => {
  db.rpcArgs.length = 0
  db.inserts.length = 0
})

describe("applyFlowDelta (an assistant's step on its conversation's canvas)", () => {
  it("the Kling node loses only that key; the Seedance 2.5 node and the rest go as sent", async () => {
    expect(await applyFlowDelta("wf-1", "u1", () => ({ upsertNodes: [KLING, SD25, IMG] }))).toBe(true)
    expect(db.rpcArgs[0]!.p_upsert_nodes).toStrictEqual([KLING_STORED, SD25, IMG])
  })

  it("upserts without the field go byte for byte", async () => {
    const clean = [SD25, IMG]
    await applyFlowDelta("wf-1", "u1", () => ({ upsertNodes: clean }))
    expect(db.rpcArgs[0]!.p_upsert_nodes).toBe(clean)
  })
})

describe("applyHistory (earlier generations filed as a conversation)", () => {
  const VIDEO = "https://cdn.nodaro.ai/videos/bbbbbbbb-0000-0000-0000-000000000002.mp4"
  const job = (id: string, inputData: Record<string, unknown>): HistoryJob => ({
    id,
    created_at: "2026-11-13T10:00:00Z",
    completed_at: "2026-11-13T10:00:00Z",
    source_detail: "Claude Code (nodaro)",
    input_data: inputData,
    output_data: { videoUrl: VIDEO },
  })
  const stored = () => db.inserts.find((r) => Array.isArray(r.nodes))!.nodes as Array<{ type: string; data: Record<string, unknown> }>

  it("a generation filed with a task type its model does not list is stored without that key, and nothing else of the node changes", async () => {
    const asked = { type: "text-to-video", prompt: "a cat", provider: "kling-3.0", duration: 5, referenceTaskType: "edit", userPrompt: "a cat" }
    const plan = planHistory([job("j1", asked)])
    expect(plan.conversations).toHaveLength(1)
    await applyHistory("u1", plan)
    const [node] = stored()
    expect(node!.data).not.toHaveProperty("referenceTaskType")
    // Filed the same way without the field: the node is otherwise identical.
    db.inserts.length = 0
    const { referenceTaskType: _t, ...plain } = asked
    await applyHistory("u1", planHistory([job("j1", plain)]))
    const [without] = stored()
    // (Each conversation mints its own id, which its node ids carry.)
    const { id: _a, ...withRule } = node as Record<string, unknown>
    const { id: _b, ...plainNode } = without as Record<string, unknown>
    expect(withRule).toStrictEqual(plainNode)
  })
})
