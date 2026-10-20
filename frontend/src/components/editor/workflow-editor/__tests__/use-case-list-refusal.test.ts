/**
 * A review-on Tighten Episode fed by a list is refused where the canvas fans
 * it out (list-execution.ts), before any item runs: no route call, no fee, no
 * wrapper. The node fails with the reason, in the reader's language; a run on
 * the server fails it with the same code, shown the same way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdateNodeData = vi.fn()
const mockExecuteNode = vi.fn()
const toastError = vi.hoisted(() => vi.fn())
let mockNodes: Array<Record<string, unknown>> = []

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: mockUpdateNodeData, nodes: mockNodes, edges: [] }),
    setState: vi.fn(),
  },
}))
vi.mock("../execute-node", () => ({ executeNode: (...args: unknown[]) => mockExecuteNode(...args) }))

import { USE_CASE_LIST_DRIVEN, usecaseListDrivenMessage, usecaseListDrivenMessageOf, USE_CASE_REVIEW_LIST_DRIVEN, USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE } from "@nodaro/render-rules"
import { tx } from "@/lib/i18n"
import { executionErrorText, nodeStateErrorText } from "@/lib/execution-error-text"
import { executeNodeForList } from "../list-execution"
import { getListFanOutForNode } from "../node-input-resolver"
import { planFanOut } from "@nodaro/shared/workflow"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

const ctx = { userId: "u1", projectId: "p1", isWorkflowStale: () => false } as unknown as ExecutionContext
const tighten = (data: Record<string, unknown>) => {
  const node = { id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", ...data } }
  mockNodes = [node]
  return node as unknown as WorkflowNode
}

describe("a review-on Tighten Episode is never fanned out over a list", () => {
  beforeEach(() => vi.clearAllMocks())

  it("review on: refused before any item runs; the node fails with the reason", async () => {
    await expect(executeNodeForList(tighten({ reviewBeforeRender: true }), ["https://r2/a.mp4", "https://r2/b.mp4"], ctx)).rejects.toThrow(
      tx("nodeRun.tightenReviewListDriven"),
    )
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(String(toastError.mock.calls[0]![0])).toContain(tx("nodeRun.tightenReviewListDriven"))
    expect(mockUpdateNodeData).toHaveBeenCalledTimes(1)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("t1", expect.objectContaining({ executionStatus: "failed", errorMessage: expect.stringContaining(tx("nodeRun.tightenReviewListDriven")) }))
  })

  it("review off: each item runs", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    await expect(executeNodeForList(tighten({ reviewBeforeRender: false }), ["https://r2/a.mp4", "https://r2/b.mp4"], ctx)).resolves.toBeUndefined()
    expect(mockExecuteNode).toHaveBeenCalledTimes(2)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("review on, a one-item list: the canvas does not fan it out, so it is never refused", () => {
    // The dispatch decision (run-handlers / sub-workflow-executor): no plan, a single run.
    const list = { id: "L", type: "list", position: { x: 0, y: 0 }, data: { label: "Episodes", columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }], rows: [["https://r2/a.mp4"]] } }
    const node = tighten({ reviewBeforeRender: true }) as unknown as Record<string, unknown>
    const nodes = [list, node] as unknown as WorkflowNode[]
    const edges = [{ id: "e", source: "L", target: "t1", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } }] as never
    expect(planFanOut(getListFanOutForNode(nodes[1]!, nodes, edges), "tighten-episode", (node.data ?? {}) as Record<string, unknown>)).toBeNull()
    // Two items: it would fan out — and is refused there.
    const two = { ...list, data: { ...list.data, rows: [["https://r2/a.mp4"], ["https://r2/b.mp4"]] } }
    const nodes2 = [two, node] as unknown as WorkflowNode[]
    expect(planFanOut(getListFanOutForNode(nodes2[1]!, nodes2, edges), "tighten-episode", (node.data ?? {}) as Record<string, unknown>)?.items).toHaveLength(2)
  })

  it("the English text is the server's word for word", () => {
    expect(tx("nodeRun.tightenReviewListDriven")).toBe(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE)
  })

  it("a server run's failed node shows the refusal by its code, in the reader's language; any other error as sent", () => {
    expect(nodeStateErrorText({ error: "anything", errorCode: USE_CASE_REVIEW_LIST_DRIVEN })).toBe(tx("nodeRun.tightenReviewListDriven"))
    expect(nodeStateErrorText({ error: "boom", errorCode: "insufficient_credits" })).toBe("boom")
    expect(nodeStateErrorText({ error: "boom" })).toBe("boom")
    expect(nodeStateErrorText({})).toBe("Node failed")
  })
})

describe("a Trailer (its own result is a list) is never fanned out over a list", () => {
  beforeEach(() => vi.clearAllMocks())
  const trailer = (data: Record<string, unknown>) => {
    const node = { id: "tr", type: "episode-trailer", position: { x: 0, y: 0 }, data: { label: "Trailer", ...data } }
    mockNodes = [node]
    return node as unknown as WorkflowNode
  }
  // The label the generic message names is the node TYPE's, localized (here: English).
  const text = () => tx("nodeRun.usecaseListDrivenEpisode", { label: "Trailer" })

  it("review off: refused before any item runs, with its own reason", async () => {
    await expect(executeNodeForList(trailer({ reviewBeforeRender: false }), ["https://r2/a.mp4", "https://r2/b.mp4"], ctx)).rejects.toThrow(text())
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("tr", expect.objectContaining({ executionStatus: "failed", errorMessage: expect.stringContaining(text()) }))
  })

  it("the English text is the server's word for word (decided 2026-10-18), and names no other node", () => {
    expect(text()).toBe("Trailer takes the recordings of one conversation. Use a separate workflow run for each episode.")
    expect(text()).toBe(usecaseListDrivenMessageOf("episode-trailer"))
    expect(text()).not.toMatch(/Tighten/)
  })

  it("a server run's refusal reads by its code (with the node's type) or its sentence, in the reader's language", () => {
    expect(nodeStateErrorText({ error: "anything", errorCode: USE_CASE_LIST_DRIVEN }, "episode-trailer")).toBe(text())
    expect(executionErrorText(usecaseListDrivenMessageOf("episode-trailer"))).toBe(text())
    expect(executionErrorText(`Node execution failed: tr: ${usecaseListDrivenMessageOf("episode-trailer")}`)).toBe(`Node execution failed: tr: ${text()}`)
  })

  it("a refusal stored before Trailer took several recordings (its words then) reads in today's words", () => {
    expect(executionErrorText(usecaseListDrivenMessage("Trailer"))).toBe(text())
  })
})
