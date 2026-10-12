/**
 * D5 (decided 2026-10-11): a Reframe group has no price of its own; each of its
 * three nodes charges its own, and the group shows ONE summed estimate. The sum
 * is a fold of the run's own lines, so these tests pin that it can never be a
 * second computation: the group's figure is exactly the sum of its nodes' lines,
 * the run total still counts every line once, and the group node itself adds
 * nothing.
 */
import { describe, it, expect } from "vitest"
import { isExecutableNode } from "../types"
import { estimateRunCreditLines, estimateRunCredits, estimateWholeRun, sumRunCreditLines } from "../estimate-run-credits"
import { groupCreditSubtotals, macroGroupOf } from "../macro-credit-groups"
import { breakdownRows } from "../run-confirm-breakdown"
import { renderConfirmDetail } from "../render-confirm-detail"
import { planReframeMacro } from "@/lib/reframe-macro"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data }, ...extra }) as unknown as WorkflowNode

// A Reframe group next to an unrelated paid node, fed by an upload.
function graph() {
  const plan = planReframeMacro(
    { nodes: [node("up", "upload-video", { url: "https://x/v.mp4" }), node("img", "generate-image", { provider: "nano-banana" })], edges: [] },
    {
      position: { x: 2000, y: 0 },
      ids: { group: "g", transcribe: "t", frames: "f", view: "v" },
      defaults: {
        transcribe: { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", fieldMappings: {} },
        frames: { label: "Speaker Frames", fieldMappings: {} },
        view: { label: "Speaker View", quality: "final", fieldMappings: {} },
      },
      video: { source: "up", sourceHandle: "video" },
    },
  )
  return { nodes: plan.nodes, edges: plan.edges as WorkflowEdge[] }
}
// Distinct, known prices per node type so a mis-fold shows.
const PRICES: Record<string, number> = { transcribe: 3, "speaker-frames": 7, "speaker-view": 11, "generate-image": 5 }
const price = (modelId: string) => Object.entries(PRICES).find(([t]) => modelId.startsWith(t))?.[1]

describe("the macro group's summed estimate", () => {
  it("is exactly the sum of the lines of its three nodes — one subtotal, no second estimate", () => {
    const { nodes, edges } = graph()
    const executable = nodes.filter(isExecutableNode)
    const lines = estimateRunCreditLines(executable, nodes, edges, price)
    const [sub] = groupCreditSubtotals(lines, nodes)
    expect(sub).toMatchObject({ groupId: "g", label: "Reframe" })
    expect([...sub.nodeIds].sort()).toEqual(["f", "t", "v"])
    expect(sub.credits).toBe(lines.filter((l) => ["t", "f", "v"].includes(l.nodeId)).reduce((s, l) => s + l.credits, 0))
  })

  it("matches the price of running just the group (what the chip quotes) and sits inside the whole-run total", () => {
    const { nodes, edges } = graph()
    const kids = nodes.filter((n) => n.parentId === "g")
    const groupRun = estimateRunCredits(kids, nodes, edges, price)
    const whole = estimateWholeRun(nodes, edges, price).total
    const lines = estimateRunCreditLines(nodes.filter(isExecutableNode), nodes, edges, price)
    const [sub] = groupCreditSubtotals(lines, nodes)
    expect(sub.credits).toBe(groupRun)
    // The total counts every line once: the group's sum plus everything outside it.
    const outside = lines.filter((l) => !sub.nodeIds.includes(l.nodeId)).reduce((s, l) => s + l.credits, 0)
    expect(whole).toBe(sub.credits + outside)
    expect(whole).toBe(sumRunCreditLines(lines))
  })

  it("the group node itself adds nothing: the estimate is the same with the frame removed", () => {
    const { nodes, edges } = graph()
    const ungrouped = nodes.filter((n) => n.type !== "group").map((n) => ({ ...n, parentId: undefined }) as WorkflowNode)
    expect(estimateWholeRun(nodes, edges, price).total).toBe(estimateWholeRun(ungrouped, edges, price).total)
  })

  it("counts only macro groups: a plain group's nodes get no subtotal", () => {
    const plain = [
      node("pg", "group", { label: "Mine" }),
      node("a", "generate-image", { provider: "nano-banana" }, { parentId: "pg" }),
    ]
    const lines = estimateRunCreditLines([plain[1]], plain, [], price)
    expect(groupCreditSubtotals(lines, plain)).toEqual([])
    expect(macroGroupOf(plain[1], plain)).toBeUndefined()
  })
})

describe("the run confirm lists the group's sum above its three nodes", () => {
  it("tags the group's lines and gathers them under one header whose figure is their sum", () => {
    const { nodes, edges } = graph()
    const executable = nodes.filter(isExecutableNode)
    const lines = estimateRunCreditLines(executable, nodes, edges, price)
    const detail = renderConfirmDetail("v", "render-final", executable, lines, nodes, edges)
    expect(detail.lines.filter((l) => l.group?.id === "g").map((l) => l.nodeId).sort()).toEqual(["f", "t", "v"])

    const rows = breakdownRows(detail.lines)
    const headers = rows.filter((r) => r.kind === "group")
    expect(headers).toHaveLength(1)
    const sub = groupCreditSubtotals(lines, nodes)[0]
    expect(headers[0]).toMatchObject({ id: "g", label: "Reframe", credits: sub.credits })
    // The header leads its three nodes; the other node is a plain row.
    const order = rows.map((r) => (r.kind === "group" ? `group:${r.id}` : r.line.nodeId))
    const at = order.indexOf("group:g")
    expect(order.slice(at + 1, at + 4).sort()).toEqual(["f", "t", "v"])
  })

  it("never changes the total: the header is display, the lines still add up to the run", () => {
    const { nodes, edges } = graph()
    const executable = nodes.filter(isExecutableNode)
    const lines = estimateRunCreditLines(executable, nodes, edges, price)
    const rows = breakdownRows(renderConfirmDetail("v", "render-final", executable, lines, nodes, edges).lines)
    const fromRows = rows.flatMap((r) => (r.kind === "line" ? [r.line.credits] : [])).reduce((s, c) => s + c, 0)
    expect(fromRows).toBe(sumRunCreditLines(lines))
  })
})
