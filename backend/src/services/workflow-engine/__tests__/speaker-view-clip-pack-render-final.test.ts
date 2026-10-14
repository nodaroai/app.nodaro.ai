/**
 * The C4 proof, server half (moved from C3.4, decided 2026-10-08): Clip Pack →
 * Speaker View → Render final, the way the orchestrator runs it.
 *
 * An Edit Plan in Clips mode feeds a Speaker View over an `each` wire. Render
 * final runs the render at `quality: final` (the run's `inputOverrides`), one
 * iteration per kept clip. Each iteration's payload is built from that clip's
 * real inputs (`getListFanOutForNode` + `planFanOut` +
 * `resolveFanOutIterationInputs`), names Speaker View's row in the clip's tier,
 * stamps the clip it cuts, and reserves `rate × minutes` through the node
 * executor's override — and the reserves of the batch sum to the run estimate
 * (`estimateWorkflowBaseCredits`), which is what the editor's Clip Pack footer
 * quotes for the same canvas (`speaker-view-review-price.test.tsx`: "Render
 * final · 3 clips · ≈30"). The finished job is then read back as the canvas
 * holds it: the video, and the EDL as drawn on `json`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ reserved: [] as Array<{ id: string; base: number }> }))
vi.mock("@/ee/billing/credits.js", async () => {
  const { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE } = await import("../../../lib/speaker-view-plan.js")
  return {
    getModelCreditBaseCost: async (id: string) => ({ creditCost: (SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE as Record<string, number>)[id], isEnabled: true, tierRestriction: null }),
  }
})
vi.mock("@/ee/billing/service-margin.js", () => ({
  applyServiceMarkup: (base: number, _settings: unknown, id: string) => {
    m.reserved.push({ id, base })
    return base
  },
}))
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-settings.js")>()),
  getAppSettings: async () => ({}),
}))

import { planFanOut } from "@nodaro/shared/workflow"
import { planClipKeyAt } from "@nodaro/shared/nodes"
import type { Edl } from "@nodaro/shared/edl"
import { buildPayload } from "../payload-builder.js"
import { getListFanOutForNode } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput } from "../output-extractor.js"
import { seededFromSavedData } from "../saved-data.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import { speakerViewCreditOverride } from "../../../lib/speaker-view-plan.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const MIC = { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" }
const CAM = { id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }
/** Clip i of a two-speaker recording: one 60 s segment, its speaker named (the editor test's clips). */
const svClip = (i: number): Edl => ({
  version: 1,
  clock: "master",
  sources: [MIC, CAM],
  segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "cam", speaker: i % 2 ? "Guest" : "Host" }],
  dropped: [],
  meta: { title: `Clip ${i + 1}`, hook: `Hook ${i + 1}` },
} as unknown as Edl)
const CLIPS = Array.from({ length: 3 }, (_, i) => svClip(i))

function canvas(view: Record<string, unknown>) {
  const plan: SimpleNode = { id: "plan", type: "edit-plan", data: { label: "Find Clips", mode: "clips", generatedJson: CLIPS } }
  // Render final's `inputOverrides: { cut: { quality: "final" } }`, as the orchestrator applies it.
  const cut: SimpleNode = { id: "cut", type: "speaker-view", data: { label: "Render Clip", ...view, quality: "final" } }
  const edges: SimpleEdge[] = [{ id: "e", source: "plan", target: "cut", sourceHandle: "edl", targetHandle: "edl", data: { outputMode: "each" } } as SimpleEdge]
  const nodes = [plan, cut]
  const nodeStates: Record<string, NodeExecutionState> = { plan: seededFromSavedData(extractSavedNodeOutput(plan)) }
  return { plan, cut, nodes, edges, nodeStates }
}

/** Render final's run of the render: one iteration per clip, each built and reserved as the executor does. */
async function renderFinal(view: Record<string, unknown>) {
  const g = canvas(view)
  const fanOut = getListFanOutForNode(g.cut, g.edges, g.nodeStates, g.nodes)
  const plan = planFanOut(fanOut, g.cut.type, g.cut.data as Record<string, unknown>)!
  const iterations = []
  for (let k = 0; k < plan.items.length; k++) {
    const inputs = resolveFanOutIterationInputs(g.cut, plan, k, g.edges, g.nodeStates, g.nodes)
    const built = buildPayload(g.cut, `job-${k}`, inputs, `ul-${k}`, { nodes: g.nodes, edges: g.edges, nodeStates: g.nodeStates, listRow: plan.rows[k] })
    const reserve = await speakerViewCreditOverride(built.jobName, built.payload)
    iterations.push({ built, reserve })
  }
  // The run estimate is the real one (the module the executor's reserve reads is mocked above).
  const { CreditsService } = await vi.importActual<typeof import("@/ee/billing/credits.js")>("@/ee/billing/credits.js")
  const estimate = CreditsService.estimateWorkflowBaseCredits(g.nodes, g.edges, { runNodeIds: new Set(["cut"]) })
  return { iterations, estimate, rows: plan.rows }
}

// The run estimate loads the real billing module: once, outside any test's time limit.
beforeAll(async () => {
  await vi.importActual("@/ee/billing/credits.js")
}, 120_000)
beforeEach(() => { m.reserved = [] })

describe("Clip Pack → Speaker View → Render final (C4 proof)", () => {
  it("one camera at a time: every clip runs at Final on the standard row, 1 minute each — 30 in all, as the footer quotes", async () => {
    const { iterations, estimate, rows } = await renderFinal({ layout: "single" })
    expect(rows).toEqual([0, 1, 2])
    expect(iterations).toHaveLength(3)
    for (const [k, { built, reserve }] of iterations.entries()) {
      expect(built.jobName).toBe("speaker-view")
      expect(built.modelIdentifier).toBe("speaker-view")
      expect(built.payload).toMatchObject({ quality: "final", reservedCreditId: "speaker-view", clipKey: planClipKeyAt(CLIPS, k), reservedCreditsPerMinute: 10 })
      expect(built.payload.edl).toEqual(CLIPS[k])
      expect(reserve).toBe(10)
    }
    expect(m.reserved.map((r) => r.id)).toEqual(["speaker-view", "speaker-view", "speaker-view"])
    expect(iterations.reduce((t, i) => t + (i.reserve ?? 0), 0)).toBe(30)
    expect(estimate).toBe(30)
  })

  it("the Zoom switch: the complex row on every clip — 36, as the footer quotes", async () => {
    const { iterations, estimate } = await renderFinal({ layout: "single", switchType: "zoom", switchDurationMs: 600 })
    expect(iterations.map((i) => i.built.modelIdentifier)).toEqual(["speaker-view:complex", "speaker-view:complex", "speaker-view:complex"])
    expect(iterations.reduce((t, i) => t + (i.reserve ?? 0), 0)).toBe(36)
    expect(estimate).toBe(36)
  })

  it("reads a finished clip back as the canvas holds it: the video, and the EDL as drawn on json", () => {
    const drawn = { ...CLIPS[0], segments: CLIPS[0]!.segments.map((s) => ({ ...s, layout: { mode: "single" } })) }
    const out = buildNodeOutputFromJobData({ videoUrl: "https://cdn.test/final-0.mp4", json: drawn, quality: "final", clipKey: planClipKeyAt(CLIPS, 0) }, "speaker-view")
    expect(out.videoUrl).toBe("https://cdn.test/final-0.mp4")
    expect(out.json).toEqual(drawn)
  })
})
