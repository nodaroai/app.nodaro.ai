// @test-units-by-name prices only the motion-transfer and upload nodes it builds by name
/**
 * Motion Transfer is quoted from its driving video's length as the graph gives
 * it (decided 2026-11-18: the measured walk, the server estimate's reading) —
 * never the node's own `videoDuration` — and, when the length is not known, at
 * the most its orientation runs (10 s keeping the image's, 30 s following the
 * video's), shown as an estimate. Kling 3.0 at 720p is per second: its
 * four-second row × the billed seconds ÷ 4. The shared fixture
 * (tools/fixtures/unit-quote-cases.json) holds the quote to the route's charge.
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

import { motionTransferPricingUnits, motionTransferQuote } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const RATE = "kling-3.0-motion:720p:per-4s"
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const videoWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "video" }) as WorkflowEdge
const upload = (sec: number) => node("v", "upload-video", { url: "https://m.test/dance.mp4", videoDurationSec: sec, duration: sec })

describe("the price a Motion Transfer is quoted at", () => {
  it("Kling 3.0 at 720p with the driving video's length known: its rate × the billed seconds ÷ 4, a false videoDuration ignored", () => {
    const x = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "720p", characterOrientation: "image", videoDuration: 3 })
    const nodes = [x, upload(9.4)]
    const edges = [videoWire("v")]
    expect(getModelIdentifier(x, edges, nodes)).toBe(RATE)
    expect(motionTransferPricingUnits(x, nodes, edges)).toBe(2.5)
    expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(2.5)
    expect(motionTransferQuote(x, nodes, edges).lengthKnown).toBe(true)
    expect(estimateRunCreditLines([x], nodes, edges, () => undefined)[0]).not.toMatchObject({ estimate: true })
  })

  it("a tiered model reads its tier from the wired video's length, not the node's", () => {
    const x = node("x", "motion-transfer", { provider: "kling", resolution: "720p", characterOrientation: "video", videoDuration: 4 })
    expect(getModelIdentifier(x, [videoWire("v")], [x, upload(12)])).toBe("motion-transfer:15s")
    expect(getExactPricingUnits(x, [x, upload(12)], [videoWire("v")], NO_RERUNS)).toBe(1)
  })

  it("with no length known: the most its orientation runs, shown as an estimate", () => {
    const image = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "1080p", characterOrientation: "image", videoDuration: 3 })
    expect(getModelIdentifier(image, [], [image])).toBe("kling-3.0-motion:1080p:10s")
    const video = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "1080p", characterOrientation: "video" })
    expect(getModelIdentifier(video, [], [video])).toBe("kling-3.0-motion:1080p:30s")
    const rate = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "720p", characterOrientation: "video" })
    expect(getModelIdentifier(rate, [], [rate])).toBe(RATE)
    expect(motionTransferPricingUnits(rate, [rate], [])).toBe(7.5)
    expect(motionTransferQuote(rate, [rate], []).lengthKnown).toBe(false)
    expect(estimateRunCreditLines([rate], [rate], [], () => undefined)[0]).toMatchObject({ estimate: true })
  })

  it("a node naming no model runs Kling 2.6 and is quoted as its run, not the node-type row", () => {
    const x = node("x", "motion-transfer", { characterOrientation: "video" })
    expect(getModelIdentifier(x, [], [x])).toBe("motion-transfer:30s")
  })

  it("on a cold price cache the per-second row is one unit, multiplied once (never a whole run × the units)", () => {
    const x = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "720p", characterOrientation: "image" })
    const nodes = [x, upload(10)]
    const line = estimateRunCreditLines([x], nodes, [videoWire("v")], () => undefined)[0]!
    expect(NODE_CREDIT_COSTS[RATE]).toBe(228)
    // 2.5 units, quoted as 3 whole units of the one-unit row on a cold cache: an upper bound, never 570 × 3.
    expect(line.credits).toBe(228 * 3)
  })
})
