/**
 * Apply EDL's price on the canvas follows the render's QUALITY — a proxy
 * (preview) quotes `apply-edl:proxy`, a final `apply-edl`, for a video and an
 * audio output alike — and every surface that quotes it names the SAME row:
 *
 *   1. the run-level estimate  (getModelIdentifier → the live model-cost row)
 *   2. the cold-cache fallback (estimateNodeCredits / estimateRunCredits →
 *                               NODE_CREDIT_COSTS)
 *
 * Both are per-minute RATES; every estimate multiplies them by the render's
 * minutes. The node pill is pinned in `nodes/__tests__/apply-edl-node-credit-id`.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
  getCachedVideoProCredits: vi.fn(),
}))

import { estimateNodeCredits, NODE_CREDIT_COSTS } from "../types"
import { estimateRunCredits } from "../estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode } from "@/types/nodes"

/** 3 min 10 s of output → 4 billed minutes. */
const EDL = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://m.test/a.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 190_000, video: "A", audio: "A" }],
}

function applyEdl(data: Record<string, unknown>): WorkflowNode {
  return { id: "ae", type: "apply-edl", position: { x: 0, y: 0 }, data: { label: "Apply EDL", edl: EDL, ...data } } as WorkflowNode
}

describe("apply-edl's credit id and cold-cache price follow its quality", () => {
  it.each([
    { name: "a video proxy", data: { output: "video", quality: "proxy" }, id: "apply-edl:proxy" },
    { name: "an audio proxy (one id per quality, both outputs)", data: { output: "audio", quality: "proxy" }, id: "apply-edl:proxy" },
    { name: "a video final", data: { output: "video", quality: "final" }, id: "apply-edl" },
    { name: "an audio final", data: { output: "audio", quality: "final" }, id: "apply-edl" },
    { name: "no quality (the final, by default)", data: {}, id: "apply-edl" },
  ])("$name → $id on every surface", ({ data, id }) => {
    const node = applyEdl(data)
    const rate = NODE_CREDIT_COSTS[id]!
    expect(getModelIdentifier(node, [], [node])).toBe(id)
    expect(estimateNodeCredits(node, [], [node])).toBe(rate)
    // Cold cache: the run estimate falls back to the same row, × 4 minutes.
    expect(estimateRunCredits([node], [node], [], () => undefined)).toBe(rate * 4)
    // Warm cache: it reads the live row the id names.
    expect(estimateRunCredits([node], [node], [], (m) => (m === id ? 777 : undefined))).toBe(777 * 4)
  })

  it("the cold-cache table quotes a preview below the final", () => {
    expect(NODE_CREDIT_COSTS["apply-edl:proxy"]).toBeGreaterThan(0)
    expect(NODE_CREDIT_COSTS["apply-edl:proxy"]!).toBeLessThan(NODE_CREDIT_COSTS["apply-edl"]!)
  })
})
