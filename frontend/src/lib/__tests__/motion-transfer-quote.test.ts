// @test-units-by-name prices only the motion-transfer and upload nodes it builds by name
/**
 * Motion Transfer is quoted from its driving video's length as the graph gives
 * it (decided 2026-11-18: the measured walk, the server estimate's reading) —
 * never the node's own `videoDuration` — and, when the length is not known, at
 * the most its orientation runs (10 s keeping the image's, 30 s following the
 * video's), shown as an estimate. Every model and size is per second: its
 * four-second row × the billed seconds ÷ 4; Wan Animate never below its flat
 * row for the size, quoted once when that is the larger. The shared fixture
 * (tools/fixtures/unit-quote-cases.json) holds the quote to the route's charge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const cache = vi.hoisted(() => ({ prices: {} as Record<string, number | undefined> }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: (id: string) => cache.prices[id],
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { motionTransferPriceIds, motionTransferPricingUnits, motionTransferQuote } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines, runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const RATE = "kling-3.0-motion:720p:per-4s"
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const videoWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "video" }) as WorkflowEdge
const upload = (sec: number) => node("v", "upload-video", { url: "https://m.test/dance.mp4", videoDurationSec: sec, duration: sec })

beforeEach(() => {
  cache.prices = {}
})

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

  it("Kling 2.6 is per second of the wired video's length, not the node's: 12 s is 3 units of its 720p row", () => {
    const x = node("x", "motion-transfer", { provider: "kling", resolution: "720p", characterOrientation: "video", videoDuration: 4 })
    expect(getModelIdentifier(x, [videoWire("v")], [x, upload(12)])).toBe("motion-transfer:720p:per-4s")
    expect(getExactPricingUnits(x, [x, upload(12)], [videoWire("v")], NO_RERUNS)).toBe(3)
  })

  it("with no length known: the most its orientation runs, shown as an estimate", () => {
    const image = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "1080p", characterOrientation: "image", videoDuration: 3 })
    expect(getModelIdentifier(image, [], [image])).toBe("kling-3.0-motion:1080p:per-4s")
    expect(motionTransferPricingUnits(image, [image], [])).toBe(2.5)
    const video = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "1080p", characterOrientation: "video" })
    expect(getModelIdentifier(video, [], [video])).toBe("kling-3.0-motion:1080p:per-4s")
    expect(motionTransferPricingUnits(video, [video], [])).toBe(7.5)
    const rate = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "720p", characterOrientation: "video" })
    expect(getModelIdentifier(rate, [], [rate])).toBe(RATE)
    expect(motionTransferPricingUnits(rate, [rate], [])).toBe(7.5)
    expect(motionTransferQuote(rate, [rate], []).lengthKnown).toBe(false)
    expect(estimateRunCreditLines([rate], [rate], [], () => undefined)[0]).toMatchObject({ estimate: true })
  })

  it("a node naming no model runs Kling 2.6 and is quoted as its run, not the node-type row", () => {
    const x = node("x", "motion-transfer", { characterOrientation: "video" })
    expect(getModelIdentifier(x, [], [x])).toBe("motion-transfer:720p:per-4s")
    expect(motionTransferPricingUnits(x, [x], [])).toBe(7.5)
  })

  it("on a cold price cache the per-second row is one unit, multiplied once (never a whole run × the units)", () => {
    const x = node("x", "motion-transfer", { provider: "kling-3.0", resolution: "720p", characterOrientation: "image" })
    const nodes = [x, upload(10)]
    const line = estimateRunCreditLines([x], nodes, [videoWire("v")], () => undefined)[0]!
    expect(NODE_CREDIT_COSTS[RATE]).toBe(228)
    // 2.5 units, quoted as 3 whole units of the one-unit row on a cold cache: an upper bound, never 570 × 3.
    expect(line.credits).toBe(228 * 3)
  })

  describe("Wan Animate: never below its flat row for the size", () => {
    const wan = (provider: string, resolution: string) => node("x", "motion-transfer", { provider, resolution })

    it("on a cold cache, by the seeded rows: Replace 720p is its 410 row up to 13 s, 125 per 4 s past it", () => {
      const x = wan("wan-animate-replace", "720p")
      expect(motionTransferQuote(x, [x, upload(13)], [videoWire("v")])).toEqual({ creditId: "wan-animate-replace:720p", lengthKnown: true })
      expect(getExactPricingUnits(x, [x, upload(13)], [videoWire("v")], NO_RERUNS)).toBe(1)
      expect(estimateRunCreditLines([x], [x, upload(13)], [videoWire("v")], () => undefined)[0]!.credits).toBe(410)
      expect(motionTransferQuote(x, [x, upload(14)], [videoWire("v")])).toEqual({ creditId: "wan-animate-replace:720p:per-4s", units: 3.5, lengthKnown: true })
      expect(getExactPricingUnits(x, [x, upload(14)], [videoWire("v")], NO_RERUNS)).toBe(3.5)
    })

    it("with the server's prices cached, by the charged figures: the larger of the whole-run quote and the floor row", () => {
      const x = wan("wan-animate-replace", "720p")
      const nodes = [x, upload(14)]
      cache.prices = { "wan-animate-replace:720p:per-4s:3.5u": 482, "wan-animate-replace:720p": 472 }
      const cached = (id: string) => cache.prices[id]
      expect(motionTransferQuote(x, nodes, [videoWire("v")], new Set(), cached).creditId).toBe("wan-animate-replace:720p:per-4s")
      expect(estimateRunCreditLines([x], nodes, [videoWire("v")], (id) => cache.prices[id])[0]!.credits).toBe(482)
      // An administrator raised the floor row: the floor is quoted, once.
      cache.prices = { "wan-animate-replace:720p:per-4s:3.5u": 482, "wan-animate-replace:720p": 900 }
      expect(motionTransferQuote(x, nodes, [videoWire("v")], new Set(), cached)).toEqual({ creditId: "wan-animate-replace:720p", lengthKnown: true })
      expect(getModelIdentifier(x, [videoWire("v")], nodes)).toBe("wan-animate-replace:720p")
      expect(estimateRunCreditLines([x], nodes, [videoWire("v")], (id) => cache.prices[id])[0]!.credits).toBe(900)
    })

    it("Move named 480p or 580p is quoted as 720p: its 720p rate, floored at its 720p row", () => {
      for (const size of ["480p", "580p"]) {
        const x = wan("wan-animate-move", size)
        expect(motionTransferQuote(x, [x, upload(5)], [videoWire("v")]).creditId, size).toBe("wan-animate-move:720p")
        expect(motionTransferQuote(x, [x, upload(30)], [videoWire("v")]), size).toEqual({ creditId: "wan-animate-move:720p:per-4s", units: 7.5, lengthKnown: true })
      }
    })

    it("a length the graph does not know is quoted at 30 s, shown as an estimate, never below what any run is held", () => {
      const x = wan("wan-animate-replace", "480p")
      expect(motionTransferQuote(x, [x], [])).toEqual({ creditId: "wan-animate-replace:480p:per-4s", units: 7.5, lengthKnown: false })
      expect(estimateRunCreditLines([x], [x], [], () => undefined)[0]).toMatchObject({ estimate: true })
    })

    it("a run's prices are fetched together: the rate row, its whole-run quote and the floor row", () => {
      const x = wan("wan-animate-replace", "720p")
      const nodes = [x, upload(14)]
      expect(motionTransferPriceIds(x, nodes, [videoWire("v")])).toEqual(["wan-animate-replace:720p:per-4s", "wan-animate-replace:720p:per-4s:3.5u", "wan-animate-replace:720p"])
      expect(runModelIds([x], nodes, [videoWire("v")])).toEqual(expect.arrayContaining(["wan-animate-replace:720p:per-4s:3.5u", "wan-animate-replace:720p"]))
    })
  })
})
