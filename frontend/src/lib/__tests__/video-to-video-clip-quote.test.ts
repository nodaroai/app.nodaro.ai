// @test-units-by-name prices only the video-to-video and upload nodes it builds by name
/**
 * Video to Video on HappyHorse Edit / Wan 2.7 VideoEdit is quoted from its
 * clip's length as the graph gives it (decided 2026-11-18: the wire-length walk,
 * the server estimate's reading) and, when the length is not known, at the
 * model's longest clip, shown as an estimate. Every other model keeps its flat
 * row. The shared fixture (tools/fixtures/unit-quote-cases.json) holds the
 * quote to the route's charge.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { videoToVideoQuote } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS, NODE_CREDIT_COSTS, videoToVideoClipRowOf } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const HH = "happyhorse-edit:720p:per-4s"
const WAN = "wan-videoedit:1080p:per-4s"
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const videoWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "video" }) as WorkflowEdge
const upload = (sec: number) => node("v", "upload-video", { url: "https://m.test/clip.mp4", videoDurationSec: sec, duration: sec })

describe("the price a clip-priced Video to Video is quoted at", () => {
  it("HappyHorse Edit with the clip's length known: its rate × the half-seconds ÷ 8, not an estimate", () => {
    const x = node("x", "video-to-video", { provider: "happyhorse-edit" })
    const nodes = [x, upload(10.04)]
    const edges = [videoWire("v")]
    expect(getModelIdentifier(x, edges, nodes)).toBe(HH)
    expect(videoToVideoQuote(x, nodes, edges, videoToVideoClipRowOf)).toEqual({ creditId: HH, units: 2.625, lengthKnown: true })
    expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(2.625)
    expect(estimateRunCreditLines([x], nodes, edges, () => undefined)[0]).not.toMatchObject({ estimate: true })
  })

  it("HappyHorse Edit prices the size it sends: 1080p only when named; a stale 480p is 720p", () => {
    const hd = node("x", "video-to-video", { provider: "happyhorse-edit", v2vResolution: "1080p" })
    expect(getModelIdentifier(hd, [videoWire("v")], [hd, upload(3)])).toBe("happyhorse-edit:1080p:per-4s")
    const stale = node("x", "video-to-video", { provider: "happyhorse-edit", v2vResolution: "480p" })
    expect(getModelIdentifier(stale, [videoWire("v")], [stale, upload(3)])).toBe(HH)
  })

  it("Wan 2.7 VideoEdit: its flat row up to break-even, its rate past it", () => {
    const x = node("x", "video-to-video", { provider: "wan-videoedit", videoEditDuration: "0" })
    expect(getModelIdentifier(x, [videoWire("v")], [x, upload(5)])).toBe("wan-videoedit")
    expect(getExactPricingUnits(x, [x, upload(5)], [videoWire("v")], NO_RERUNS)).toBe(1)
    expect(getModelIdentifier(x, [videoWire("v")], [x, upload(6)])).toBe(WAN)
    expect(getExactPricingUnits(x, [x, upload(6)], [videoWire("v")], NO_RERUNS)).toBe(1.5)
  })

  it("with no length known: the model's longest clip, shown as an estimate, never below the hold", () => {
    const hh = node("x", "video-to-video", { provider: "happyhorse-edit" })
    expect(videoToVideoQuote(hh, [hh], [], videoToVideoClipRowOf)).toEqual({ creditId: HH, units: 15, lengthKnown: false })
    expect(estimateRunCreditLines([hh], [hh], [], () => undefined)[0]).toMatchObject({ estimate: true })
    const wan = node("x", "video-to-video", { provider: "wan-videoedit" })
    expect(videoToVideoQuote(wan, [wan], [], videoToVideoClipRowOf)).toEqual({ creditId: WAN, units: 2.5, lengthKnown: false })
    expect(estimateRunCreditLines([wan], [wan], [], () => undefined)[0]).toMatchObject({ estimate: true })
    // The estimate (10 s: 600 base) is at least any clip's hold (at most 600 base).
    expect(Math.ceil(NODE_CREDIT_COSTS[WAN]! * 2.5)).toBeGreaterThanOrEqual(NODE_CREDIT_COSTS["wan-videoedit"]!)
  })

  it("every other model keeps its flat row and is never an estimate", () => {
    const x = node("x", "video-to-video", { provider: "wan" })
    expect(videoToVideoQuote(x, [x, upload(10)], [videoWire("v")], videoToVideoClipRowOf)).toBeUndefined()
    expect(getModelIdentifier(x, [videoWire("v")], [x, upload(10)])).toBe("wan")
    expect(getExactPricingUnits(x, [x, upload(10)], [videoWire("v")], NO_RERUNS)).toBe(1)
  })
})
