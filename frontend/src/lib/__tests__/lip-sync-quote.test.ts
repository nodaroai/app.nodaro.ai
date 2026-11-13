/**
 * A Lip Sync on OmniHuman 2.0 is quoted as the WHOLE run its audio is charged
 * (decided 2026-11-11): its per-second row × the billed seconds — the audio's
 * length rounded up, at least 4 — from the length the graph gives (a wired
 * audio as the measured walk reads it), else, with no audio wired, what the
 * node measured at its last run, else 15 s shown as an estimate. Every
 * other lip-sync model keeps its own row (1 unit). The shared fixture
 * (tools/fixtures/unit-quote-cases.json) holds the quote to the route's charge.
 * Every model reads the audio the editor's Run plays (decided 2026-11-13: the
 * picked audio, else the last wired); only OmniHuman 2.0 falls back to the
 * node's own last reading.
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
import { buildLipSyncCreditId, getLipSyncMaxAudioSeconds } from "@nodaro/shared/credits"

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

/**
 * A model priced by a length bucket (decided 2026-11-13): the editor quotes
 * the bucket of the audio's length when it knows it — the bucket the run
 * measures and holds — and the model's largest bucket while it does not, the
 * most a run can hold: never below the run. The node's own pill and the Run
 * button read the same id (`getModelIdentifier`).
 */
describe("the bucket a Lip Sync priced by its audio's length is quoted at", () => {
  const BUCKETED = ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"]

  it.each(BUCKETED)("%s: with the audio's length known (the audio node the Run plays), its bucket", (provider) => {
    const x = node("x", "lip-sync", { provider })
    expect(getModelIdentifier(x, [audioWire("a")], [x, upload(42)])).toBe(buildLipSyncCreditId(provider, 42))
    expect(getModelIdentifier(x, [audioWire("a")], [x, upload(12)])).toBe(`${provider}:15s`)
  })

  it.each(BUCKETED)("%s: a length the Lip Sync node itself carries is never trusted — with no audio node, the top bucket", (provider) => {
    const top = `${provider}:${getLipSyncMaxAudioSeconds(provider)}s`
    const measured = node("x", "lip-sync", { provider, audioDurationSec: 25 })
    expect(getModelIdentifier(measured, [], [measured])).toBe(top)
    // Written by MCP or an import: a link to a 5-minute clip that claims 1 second.
    const claimed = node("x", "lip-sync", { provider, audioUrl: "https://m.test/five-minutes.mp3", audioDurationSec: 1 })
    expect(getModelIdentifier(claimed, [], [claimed])).toBe(top)
    expect(getModelIdentifier(claimed)).toBe(top)
  })

  it.each(BUCKETED)("%s: with it unknown, the model's largest bucket (never the 15 s one)", (provider) => {
    const x = node("x", "lip-sync", { provider })
    const top = `${provider}:${getLipSyncMaxAudioSeconds(provider)}s`
    expect(getModelIdentifier(x, [], [x])).toBe(top)
    expect(getModelIdentifier(x)).toBe(top)
  })

  it("a Lip Sync naming no model is quoted as the default it runs (Kling Avatar), never the node-type row", () => {
    const x = node("x", "lip-sync", {})
    expect(getModelIdentifier(x, [], [x])).toBe("kling-avatar:300s")
    expect(getModelIdentifier(x, [audioWire("a")], [x, upload(42)])).toBe("kling-avatar:60s")
  })

  it("two audios wired: the LAST one, the audio the Run plays (10 s first, 4 min second → the 5-minute tier)", () => {
    const x = node("x", "lip-sync", { provider: "kling-avatar" })
    const short = node("s", "upload-audio", { url: "https://m.test/s.mp3", metadata: { durationSeconds: 10 } })
    const long = node("l", "upload-audio", { url: "https://m.test/l.mp3", metadata: { durationSeconds: 240 } })
    const wire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "audio" }) as WorkflowEdge
    expect(getModelIdentifier(x, [wire("s"), wire("l")], [x, short, long])).toBe("kling-avatar:300s")
    expect(getModelIdentifier(x, [wire("l"), wire("s")], [x, short, long])).toBe("kling-avatar:15s")
  })

  it("an audio picked in the node's settings is the one the editor's Run plays, over any wire", () => {
    const short = node("s", "upload-audio", { url: "https://m.test/s.mp3", metadata: { durationSeconds: 10 } })
    const long = node("l", "upload-audio", { url: "https://m.test/l.mp3", metadata: { durationSeconds: 240 } })
    const wire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "audio" }) as WorkflowEdge
    const picked = node("x", "lip-sync", { provider: "kling-avatar", selectedAudioNodeId: "l" })
    expect(getModelIdentifier(picked, [wire("s")], [picked, short, long])).toBe("kling-avatar:300s")
    expect(getModelIdentifier(picked, [], [picked, short, long])).toBe("kling-avatar:300s")
    const pickedShort = node("x", "lip-sync", { provider: "kling-avatar", selectedAudioNodeId: "s" })
    expect(getModelIdentifier(pickedShort, [wire("l")], [pickedShort, short, long])).toBe("kling-avatar:15s")
  })

  it("a Text to Speech feeding Kling Avatar is quoted at its last take (12 s → 15 s tier), also when it runs again in the run", () => {
    const x = node("x", "lip-sync", { provider: "kling-avatar" })
    const tts = node("v", "text-to-speech", { text: "Hello there.", generatedResults: [{ url: "https://m.test/take.mp3", duration: 12 }], activeResultIndex: 0 })
    const wire: WorkflowEdge = { id: "v-x", source: "v", target: "x", targetHandle: "audio" } as WorkflowEdge
    expect(getModelIdentifier(x, [wire], [x, tts])).toBe("kling-avatar:15s")
    expect(getModelIdentifier(x, [wire], [x, tts], new Set(["v", "x"]))).toBe("kling-avatar:15s")
    // A voice with no take yet is unknown: the top tier.
    const fresh = node("v", "text-to-speech", { text: "Hello there." })
    expect(getModelIdentifier(x, [wire], [x, fresh], new Set(["v", "x"]))).toBe("kling-avatar:300s")
  })

  it("a model whose price reads no length is never quoted on a length bucket", () => {
    for (const provider of ["infinitalk", "latentsync"]) {
      expect(getModelIdentifier(node("x", "lip-sync", { provider, audioDurationSec: 42 })), provider).not.toMatch(/:\d+s$/)
    }
  })
})

