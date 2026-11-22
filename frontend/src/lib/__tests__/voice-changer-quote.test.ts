// @test-units-by-name prices only the voice-changer and upload nodes it builds by name
/**
 * Voice Changer is quoted per started 10 seconds of the audio it revoices, as
 * the graph gives it (decided 2026-11-22: the shared wire-length walk, the
 * server estimate's reading) — its video wire's when one is wired (a video
 * wins, as the run does), else its audio wire's — and when the length is not
 * known, at the 5-minute cap's 30 units, shown as an estimate (≈). The shared
 * fixture (tools/fixtures/unit-quote-cases.json) holds the quote to the
 * route's charge.
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

import { voiceChangerPricingUnits, voiceChangerQuote } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const RATE = "elevenlabs-voice-changer:per-10s"
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const wire = (source: string, targetHandle: string): WorkflowEdge => ({ id: `${source}-x-${targetHandle}`, source, target: "x", targetHandle }) as WorkflowEdge
const audioUpload = (sec: number) => node("a", "upload-audio", { url: "https://m.test/voice.mp3", metadata: { durationSeconds: sec } })
const videoUpload = (sec: number) => node("v", "upload-video", { url: "https://m.test/talk.mp4", videoDurationSec: sec, duration: sec })
const changer = () => node("x", "voice-changer", { voiceId: "Rachel" })

describe("the price a Voice Changer is quoted at", () => {
  it.each([
    [8, 1],
    [30, 3],
    [61, 7],
    [300, 30],
  ])("a %s s audio upload: %s started ten seconds of the per-10-second row", (sec, units) => {
    const x = changer()
    const nodes = [x, audioUpload(sec)]
    const edges = [wire("a", "audio")]
    expect(getModelIdentifier(x, edges, nodes)).toBe(RATE)
    expect(voiceChangerPricingUnits(x, nodes, edges)).toBe(units)
    expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(units)
    expect(voiceChangerQuote(x, nodes, edges).lengthKnown).toBe(true)
    expect(estimateRunCreditLines([x], nodes, edges, () => undefined)[0]).not.toMatchObject({ estimate: true })
  })

  it("a wired video wins over a wired audio: the video's sound is what the run revoices", () => {
    const x = changer()
    const nodes = [x, videoUpload(61.2), audioUpload(8)]
    const edges = [wire("v", "video"), wire("a", "audio")]
    expect(voiceChangerQuote(x, nodes, edges)).toEqual({ creditId: RATE, units: 7, lengthKnown: true })
    expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(7)
  })

  it("with no length known: the 5-minute cap's 30 units, shown as an estimate, never below the hold", () => {
    const x = changer()
    expect(getModelIdentifier(x, [], [x])).toBe(RATE)
    expect(voiceChangerPricingUnits(x, [x], [])).toBe(30)
    expect(voiceChangerQuote(x, [x], []).lengthKnown).toBe(false)
    const line = estimateRunCreditLines([x], [x], [], () => undefined)[0]!
    expect(line).toMatchObject({ estimate: true })
    // The most any run can hold: 30 units of the one-unit row.
    expect(line.credits).toBeGreaterThanOrEqual(NODE_CREDIT_COSTS[RATE]! * 30)
  })

  it("on a cold price cache the one-unit row is multiplied once by the units", () => {
    const x = changer()
    const nodes = [x, audioUpload(25)]
    const line = estimateRunCreditLines([x], nodes, [wire("a", "audio")], () => undefined)[0]!
    expect(NODE_CREDIT_COSTS[RATE]).toBe(10)
    expect(line.credits).toBe(10 * 3)
  })
})
