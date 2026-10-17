// @test-units-by-name reads only the speaker-view rows it names
// Speaker View in the editor's estimate (C4, decided 2026-10-10): the credit id
// is the render-node registry's, in the tier the graph tells (`getModelIdentifier`),
// the cold-cache rate is that row (`estimateNodeCredits` / `NODE_CREDIT_COSTS`),
// and the estimate multiplies it by the render's OUTPUT MINUTES
// (`PRICING_UNIT_ESTIMATORS`) — the confirm says "minute" (`unitKind`).
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { estimateNodeCredits, getCostFactors, getPricingUnits, NODE_CREDIT_COSTS, NO_RERUNS } from "../types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const wire = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge

const MIC = { id: "mic", url: "https://cdn/mic.wav", kind: "audio", role: "master-audio" }
const cam = (id: string) => ({ id, url: `https://cdn/${id}.mp4`, kind: "video" })
/** `k` speakers on `k` cameras, taking turns, `minutes` long. */
const edl = (k: number, minutes: number) => {
  const ids = ["a", "b", "c", "d", "e", "f"].slice(0, k)
  const count = minutes * 3
  return {
    version: 1, clock: "master", sources: [MIC, ...ids.map(cam)],
    segments: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, inMs: i * 20_000, outMs: (i + 1) * 20_000, video: ids[i % k], speaker: `S${i % k}` })),
  }
}

describe("getModelIdentifier — the registry's id in the graph's tier", () => {
  it("reads the edit Camera Switch holds", () => {
    const sw2 = n("sw", "camera-switch", { generatedJson: { edl: edl(2, 3) } })
    const sw3 = n("sw", "camera-switch", { generatedJson: { edl: edl(3, 3) } })
    const view = (data: Record<string, unknown>) => n("v", "speaker-view", data)
    const edges = [wire("sw", "v", "edl")]
    expect(getModelIdentifier(view({ layout: "grid" }), edges, [sw2, view({ layout: "grid" })])).toBe("speaker-view")
    expect(getModelIdentifier(view({ layout: "grid", quality: "proxy" }), edges, [sw3, view({ layout: "grid", quality: "proxy" })])).toBe("speaker-view:complex:proxy")
  })

  it("an upstream about to re-run leaves the edit unknown: the settings decide", () => {
    const sw = n("sw", "camera-switch", { generatedJson: { edl: edl(2, 3) } })
    const v = n("v", "speaker-view", { layout: "auto" })
    expect(getModelIdentifier(v, [wire("sw", "v", "edl")], [sw, v], new Set(["sw", "v"]))).toBe("speaker-view:complex")
    const single = n("v", "speaker-view", { layout: "single" })
    expect(getModelIdentifier(single, [wire("sw", "v", "edl")], [sw, single], new Set(["sw", "v"]))).toBe("speaker-view")
  })

  it("no graph: its own data; Apply EDL is untouched", () => {
    expect(getModelIdentifier(n("v", "speaker-view", { layout: "single", quality: "proxy" }))).toBe("speaker-view:proxy")
    expect(getModelIdentifier(n("v", "speaker-view", {}))).toBe("speaker-view:complex")
    expect(getModelIdentifier(n("r", "apply-edl", { quality: "proxy" }))).toBe("apply-edl:proxy")
    expect(getModelIdentifier(n("r", "apply-edl", {}))).toBe("apply-edl")
  })
})

describe("the cold-cache rows and the minutes", () => {
  it("holds the four rows (pinned to the server's by frontend-credit-fallback-parity)", () => {
    expect(NODE_CREDIT_COSTS["speaker-view"]).toBe(10)
    expect(NODE_CREDIT_COSTS["speaker-view:proxy"]).toBe(2)
    expect(NODE_CREDIT_COSTS["speaker-view:complex"]).toBe(12)
    expect(NODE_CREDIT_COSTS["speaker-view:complex:proxy"]).toBe(3)
  })

  it("estimateNodeCredits is the rate of the row in its tier", () => {
    expect(estimateNodeCredits({ id: "v", type: "speaker-view", data: { layout: "single" } })).toBe(10)
    expect(estimateNodeCredits({ id: "v", type: "speaker-view", data: { layout: "grid", quality: "proxy", edl: edl(3, 2) } })).toBe(3)
    expect(estimateNodeCredits({ id: "v", type: "speaker-view", data: { layout: "single", switchType: "zoom", quality: "proxy" } })).toBe(3)
  })

  it("prices the render's minutes and says 'minute' in the confirm, as for Apply EDL", () => {
    const v = n("v", "speaker-view", { layout: "grid", edl: edl(3, 46) })
    expect(getPricingUnits(v, [v], [], NO_RERUNS)).toBe(46)
    expect(getCostFactors(v, [v], [], NO_RERUNS)).toEqual({ fanOut: 1, units: 46, unitKind: "minute" })
    // 46 minutes × 12 — the worked example on the node's docs page.
    expect(estimateNodeCredits({ id: "v", type: "speaker-view", data: v.data as Record<string, unknown> }, [], [v]) * getPricingUnits(v, [v], [], NO_RERUNS)).toBe(552)
  })
})

// Video mode (decided 2026-10-11): a plain video on `video`, cut whole. The
// pill and the confirm price the clip's length, never the one-minute floor the
// estimate fell to with no `edl` wire (the run reserves the measured clip).
describe("a Speaker View fed a plain video", () => {
  const graph = (rec: Record<string, unknown>, view: Record<string, unknown> = { layout: "single" }) => {
    const nodes = [n("rec", "upload-video", { url: "https://cdn/pod.mp4", ...rec }), n("tx", "transcribe"), n("v", "speaker-view", view)]
    const edges = [wire("rec", "tx", "media"), wire("tx", "v", "transcript"), wire("rec", "v", "video")]
    return { nodes, edges, v: nodes[2]! }
  }

  it("prices the clip's minutes, in the pill and in a whole run", () => {
    const g = graph({ metadata: { durationSeconds: 46 * 60 } })
    expect(getPricingUnits(g.v, g.nodes, g.edges, NO_RERUNS)).toBe(46)
    expect(getPricingUnits(g.v, g.nodes, g.edges, new Set(["tx", "v"]))).toBe(46)
    expect(getCostFactors(g.v, g.nodes, g.edges, NO_RERUNS)).toEqual({ fanOut: 1, units: 46, unitKind: "minute" })
    expect(getModelIdentifier(g.v, g.edges, g.nodes)).toBe("speaker-view")
  })

  it("an unknown length prices the 180-minute ceiling, not one minute", () => {
    const g = graph({})
    expect(getPricingUnits(g.v, g.nodes, g.edges, NO_RERUNS)).toBe(180)
  })

  it("the settings decide the tier: Auto can seat three, so it quotes the complex row", () => {
    const g = graph({ metadata: { durationSeconds: 60 } }, { layout: "auto", quality: "proxy" })
    expect(getModelIdentifier(g.v, g.edges, g.nodes)).toBe("speaker-view:complex:proxy")
  })
})
