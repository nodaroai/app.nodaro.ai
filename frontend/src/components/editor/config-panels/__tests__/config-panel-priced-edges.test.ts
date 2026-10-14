// @test-watches frontend/src/components/editor/config-panel.tsx
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getModelIdentifier } from "../helpers"
import { carriedEdges } from "@/components/editor/workflow-editor/carried-edges"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The settings panel's Run button prices the node on the wires the run reads:
 * through a Teleport pair, the wire leaving the Receive is the wire feeding the
 * Send. A Generate Video with a reference clip wired through a pair is a
 * reference-video run, so its price is on the `-ref` ladder — as when the clip
 * is wired directly.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>): WorkflowEdge =>
  ({ id: `${source}->${target}`, source, sourceHandle, target, targetHandle, data }) as unknown as WorkflowEdge

describe("config panel price — Teleport pair", () => {
  const clip = node("clip", "upload-video", { url: "https://cdn.example/clip.mp4" })
  const gv = node("gv", "generate-video", { provider: "seedance-2-5", duration: 8, resolution: "720p" })
  const send = node("s", "teleport-send")
  const recv = node("r", "teleport-receive")
  const nodes = [clip, send, recv, gv]
  const raw = [
    edge("clip", "video", "s", "in"),
    edge("s", "out", "r", "in", { teleporter: true }),
    edge("r", "out", "gv", "videoReferences"),
  ]

  it("a reference clip wired through the pair quotes the -ref id, as a direct wire does", () => {
    const direct = getModelIdentifier(gv, [edge("clip", "video", "gv", "videoReferences")], [clip, gv])
    expect(direct).toBe("seedance-2-5:8s:720p-ref")
    expect(getModelIdentifier(gv, carriedEdges(nodes, raw), nodes)).toBe(direct)
  })

  it("config-panel.tsx prices the Run button and its units on the carried edges, never the raw store edges", () => {
    const src = readFileSync(join(__dirname, "../../config-panel.tsx"), "utf8")
    const priced = [...src.matchAll(/\b(getModelIdentifier|getExactPricingUnits)\(([^)]*)\)/g)].map((m) => m[2])
    expect(priced.length).toBeGreaterThan(0)
    for (const args of priced) expect(args).toContain("_pricedEdges")
    expect(src).toMatch(/_pricedEdges = useMemo\(\(\) => carriedEdges\(nodes, edges\)/)
  })
})
