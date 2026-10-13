/**
 * The editor's estimate of a Combine Videos after a fan-out (List → Trim on
 * Each → Combine on Bundle) counts every clip the join receives, as the
 * server's estimate does (`fanInClipCount`, backend
 * run-forwarded-length.test.ts holds the server and the run's charge to the
 * same graph): three 4 s trims are 3 units + 1 for the third input, not one
 * clip's single unit.
 */
import { describe, expect, it } from "vitest"
import { estimateVideoUtilityBaseCredits } from "../video-utility-estimate"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (id: string, source: string, target: string, data?: Record<string, unknown>) =>
  ({ id, source, target, targetHandle: "in", ...(data ? { data } : {}) }) as unknown as WorkflowEdge

describe("Combine Videos after a fan-out", () => {
  const list = node("list", "list", { items: ["https://m.test/a.mp4", "https://m.test/b.mp4", "https://m.test/c.mp4"].join("\n") })
  const trim = node("trim", "trim-video", { trimMode: "time", startTime: 0, endTime: 4 })
  const join = node("join", "combine-videos", {})

  it("a Bundle from a Trim run once per List item: every trim, at its 4 s", () => {
    const edges = [edge("e1", "list", "trim"), edge("e2", "trim", "join", { outputMode: "all" })]
    expect(estimateVideoUtilityBaseCredits(join, [list, trim, join], edges, new Set(["list", "trim", "join"]))).toBe(40)
  })

  it("a Selected wire from the same Trim hands one clip", () => {
    const edges = [edge("e1", "list", "trim"), edge("e2", "trim", "join")]
    expect(estimateVideoUtilityBaseCredits(join, [list, trim, join], edges, new Set(["list", "trim", "join"]))).toBe(10)
  })
})
