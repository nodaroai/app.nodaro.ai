/**
 * A Lip Sync on OmniHuman 2.0 is quoted as the WHOLE run its audio is charged
 * (decided 2026-11-11): its per-second row × the billed seconds — the audio's
 * length rounded up, at least 4 — from the length the graph gives (a wired
 * audio as the measured walk reads it), else, with no audio wired, what the
 * node measured at its last run, else 15 s shown as an estimate. Every
 * other lip-sync model keeps its own row (1 unit). The shared fixture
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

import { lipSyncPricingUnits, lipSyncQuoteIsEstimate } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS } from "@/components/editor/workflow-editor/types"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const audioWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "audio" }) as WorkflowEdge
const upload = (sec: number) => node("a", "upload-audio", { url: "https://m.test/a.mp3", metadata: { durationSeconds: sec } })

describe("the seconds a Lip Sync is quoted at", () => {
  it("OmniHuman 2.0 with its audio's length known in the graph: the billed seconds", () => {
    const x = node("x", "lip-sync", { provider: "omnihuman-2-0" })
    expect(lipSyncPricingUnits(x, [x, upload(10.04)], [audioWire("a")])).toBe(11)
    expect(lipSyncPricingUnits(x, [x, upload(3.2)], [audioWire("a")])).toBe(4)
    expect(lipSyncQuoteIsEstimate(x, [x, upload(10.04)], [audioWire("a")])).toBe(false)
    expect(getModelIdentifier(x, [audioWire("a")], [x, upload(10.04)])).toBe("omnihuman-2-0:per-second")
  })

  it("the length the node measured at its last run, when the graph does not tell", () => {
    const x = node("x", "lip-sync", { provider: "omnihuman-2-0", audioDurationSec: 59.2 })
    expect(lipSyncPricingUnits(x, [x], [])).toBe(60)
  })

  it("a wired audio of unknown length never falls back to the last run's length: 15 s, an estimate", () => {
    const x = node("x", "lip-sync", { provider: "omnihuman-2-0", audioDurationSec: 59.2 })
    const noLength = node("a", "upload-audio", { url: "https://m.test/nolen.mp3" })
    expect(lipSyncPricingUnits(x, [x, noLength], [audioWire("a")])).toBe(15)
    expect(lipSyncQuoteIsEstimate(x, [x, noLength], [audioWire("a")])).toBe(true)
  })

  it("no length known yet: 15 s, an estimate (its line is shown ≈)", () => {
    const x = node("x", "lip-sync", { provider: "omnihuman-2-0" })
    expect(lipSyncPricingUnits(x, [x], [])).toBe(15)
    expect(getExactPricingUnits(x, [x], [], NO_RERUNS)).toBe(15)
    expect(lipSyncQuoteIsEstimate(x, [x], [])).toBe(true)
    expect(estimateRunCreditLines([x], [x], [], () => undefined)[0]).toMatchObject({ estimate: true })
  })

  it("every other lip-sync model: one unit (its own row is the whole price), never an estimate here", () => {
    for (const provider of ["omnihuman-1-5", "kling-avatar", "infinitalk"]) {
      const x = node("x", "lip-sync", { provider, audioDurationSec: 40 })
      expect(lipSyncPricingUnits(x, [x], []), provider).toBe(1)
      expect(lipSyncQuoteIsEstimate(x, [x], []), provider).toBe(false)
    }
  })
})
