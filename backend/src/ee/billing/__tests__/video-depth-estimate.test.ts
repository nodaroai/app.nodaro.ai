import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS, CreditsService } from "../credits.js"

// The pre-run estimate quotes Video Depth the way a run is charged: the row for
// the input clip's length. Before a run the length is known only when the graph
// tells it (a render's output, a chain of length-priced steps); any other clip
// is quoted at the provider's highest reachable row (fal 300 s, Replicate 120 s:
// it refuses clips over 80 s) — the most a run can be charged, so the estimate
// never quotes under the reservation, nor at a row no run can reach.

type N = { id?: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; targetHandle?: string }

const est = (nodes: N[], edges?: E[]) => CreditsService.estimateWorkflowBaseCredits(nodes, edges)

describe("video-depth workflow estimate", () => {
  it("an unmeasured clip on the default provider quotes fal's 300-second ceiling row", () => {
    expect(est([{ type: "video-depth", data: {} }])).toBe(STATIC_CREDIT_COSTS["video-depth-anything:300s"])
  })

  it("the Replicate provider quotes its highest reachable row (120 s — it refuses clips over 80 s)", () => {
    expect(est([{ type: "video-depth", data: { provider: "depth-anything-frames" } }])).toBe(
      STATIC_CREDIT_COSTS["depth-anything-frames:120s"],
    )
  })

  it("an unknown provider (raw workflow JSON) quotes the default provider's row, as the run resolves it — never the cheaper node fallback", () => {
    expect(est([{ type: "video-depth", data: { provider: "nope" } }])).toBe(STATIC_CREDIT_COSTS["video-depth-anything:300s"])
  })

  describe("a clip whose length the graph tells", () => {
    const upload: N = { id: "rec", type: "upload-video", data: {} }
    const trim = (endTime: number): N => ({ id: "trim", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime } })
    const depth = (data: Record<string, unknown> = {}): N => ({ id: "vd", type: "video-depth", data })
    const wires: E[] = [
      { source: "rec", target: "trim", targetHandle: "in" },
      { source: "trim", target: "vd", targetHandle: "video" },
    ]
    const depthPart = (endTime: number, data?: Record<string, unknown>) =>
      est([upload, trim(endTime), depth(data)], wires) - est([upload, trim(endTime)], wires.slice(0, 1))

    it.each([
      [20, "video-depth-anything:30s"],
      [100, "video-depth-anything:120s"],
      [400, "video-depth-anything:300s"],
    ])("a fixed %i-second Trim window quotes %s", (endTime, id) => {
      expect(depthPart(endTime)).toBe(STATIC_CREDIT_COSTS[id])
    })

    it("on the Replicate provider, its own bucket", () => {
      expect(depthPart(20, { provider: "depth-anything-frames" })).toBe(STATIC_CREDIT_COSTS["depth-anything-frames:30s"])
    })

    it("a window longer than Replicate accepts quotes its highest reachable row, not the 300 s row", () => {
      expect(depthPart(200, { provider: "depth-anything-frames" })).toBe(STATIC_CREDIT_COSTS["depth-anything-frames:120s"])
    })
  })
})
