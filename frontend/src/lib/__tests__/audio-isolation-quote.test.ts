// @test-units-by-name prices only the audio-isolation and upload nodes it builds by name
/**
 * Audio Isolation is quoted per started 10 seconds of its audio, as the graph
 * gives it (decided 2026-11-18: the shared wire-length walk, the server estimate's
 * reading), and when the length is not known, at the 30-minute cap's 180
 * units, shown as an estimate (≈). The shared fixture
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

import { audioIsolationPricingUnits, audioIsolationQuote } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const RATE = "elevenlabs-isolation:per-10s"
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const audioWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "audio" }) as WorkflowEdge
const upload = (sec: number) => node("a", "upload-audio", { url: "https://m.test/voice.mp3", metadata: { durationSeconds: sec } })

describe("the price an Audio Isolation is quoted at", () => {
  it.each([
    [8, 1],
    [30, 3],
    [60, 6],
    [300, 30],
    [1800, 180],
  ])("a %s s upload: %s started ten seconds of the per-10-second row", (sec, units) => {
    const x = node("x", "audio-isolation", {})
    const nodes = [x, upload(sec)]
    const edges = [audioWire("a")]
    expect(getModelIdentifier(x, edges, nodes)).toBe(RATE)
    expect(audioIsolationPricingUnits(x, nodes, edges)).toBe(units)
    expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(units)
    expect(audioIsolationQuote(x, nodes, edges).lengthKnown).toBe(true)
    expect(estimateRunCreditLines([x], nodes, edges, () => undefined)[0]).not.toMatchObject({ estimate: true })
  })

  it("with no length known: the 30-minute cap's 180 units, shown as an estimate, never below the hold", () => {
    const x = node("x", "audio-isolation", {})
    expect(getModelIdentifier(x, [], [x])).toBe(RATE)
    expect(audioIsolationPricingUnits(x, [x], [])).toBe(180)
    expect(audioIsolationQuote(x, [x], []).lengthKnown).toBe(false)
    const line = estimateRunCreditLines([x], [x], [], () => undefined)[0]!
    expect(line).toMatchObject({ estimate: true })
    // The most any run can hold: 180 units of the one-unit row.
    expect(line.credits).toBeGreaterThanOrEqual(NODE_CREDIT_COSTS[RATE]! * 180)
  })

  it("on a cold price cache the one-unit row is multiplied once by the units", () => {
    const x = node("x", "audio-isolation", {})
    const nodes = [x, upload(25)]
    const line = estimateRunCreditLines([x], nodes, [audioWire("a")], () => undefined)[0]!
    expect(NODE_CREDIT_COSTS[RATE]).toBe(10)
    expect(line.credits).toBe(10 * 3)
  })
})
