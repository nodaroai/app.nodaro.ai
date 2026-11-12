// @test-units-by-name prices the node types it names (generate-video, upload-video, trim-video, loop-video, combine-videos, video-audit)
/**
 * A video made at an automatic length (or by a Seedance Edit / Extend) records
 * the length it really is (`output_data.durationSec`, finalize). A workflow RUN
 * hands that length to the step after it — Trim, Loop, Combine Videos — and the
 * step is charged by it (`runForwardedVideoLengthSec` reads a node output's
 * `durationSec` first). A generation that records nothing (a fixed-length run,
 * an older job, a failed probe) is handed exactly what it was handed before.
 *
 * Each case drives the real output extractor (job row → node output), the real
 * input resolver, the real payload builder and the charge the run's
 * reservation calls (`videoUtilityChargeBaseCredits`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 15, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})
// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS (10 a unit).
function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return query
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { buildVideoAuditCreditId, estimateCombineVideosCredits, estimateLoopVideoCredits, estimateTrimVideoCredits, VIDEO_UTIL_PRICING } from "@nodaro/shared/credits"
import { CreditsService, estimateRunSetCredits, estimateWorkflowCreditsDetailed, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { videoUtilityChargeBaseCredits } from "../../../lib/video-utility-credits.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { buildNodeOutputFromJobData } from "../../../services/workflow-engine/output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../../../services/workflow-engine/types.js"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }

/** What the run reserves for `targetId` (marked up once), and the payload it built. */
async function runCharge(nodes: N[], edges: E[], targetId: string, nodeStates: Record<string, NodeExecutionState>) {
  const all = nodes as unknown as SimpleNode[]
  const target = all.find((n) => n.id === targetId)!
  const inputs = resolveNodeInputs(target, edges as unknown as SimpleEdge[], nodeStates, all, undefined)
  const { payload } = buildPayload(target, "job-1", inputs, "usage-1")
  const base = await videoUtilityChargeBaseCredits(target.type, payload)
  return { charge: applyServiceMarkup(base!, settings.current as never, target.type), payload }
}
const marked = (base: number, id: string) => applyServiceMarkup(base, settings.current as never, id)
/** The node output a completed job row becomes, through the real extractor. */
const ranWith = (nodeType: string, outputData: Record<string, unknown>): NodeExecutionState =>
  ({ status: "completed", output: buildNodeOutputFromJobData(outputData, nodeType) } as NodeExecutionState)

const GEN_URL = "https://m.test/gen.mp4"
const OTHER_URL = "https://m.test/other.mp4"
const TRIM = { trimMode: "seconds", trimStartSeconds: 1, trimEndSeconds: 0 }
const LOOP = { mode: "repeat", repeatCount: 2 }

beforeEach(() => {
  settings.current = { cost_markup_percent: 15, service_margin_percent: {} }
  invalidateModelPricingCache()
})

describe.each([
  ["Generate Video", "generate-video", { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }],
  ["Image to Video", "image-to-video", { provider: "seedance-2", duration: VIDEO_DURATION_AUTO }],
  ["Text to Video", "text-to-video", { provider: "seedance-2-5", duration: 8, referenceTaskType: "extend" }],
  ["Video to Video (Seedance edit)", "video-to-video", { provider: "seedance-2-5" }],
])("a length-following %s node records 23.4 s", (_name, genType, genData) => {
  const RECORDED = 23.4
  const gen = { id: "gen", type: genType, data: genData }
  const job = { videoUrl: GEN_URL, thumbnailUrl: "https://m.test/gen.jpg", durationSec: RECORDED }

  it("Trim is charged by the recorded length", async () => {
    const nodes: N[] = [gen, { id: "trim", type: "trim-video", data: TRIM }]
    const edges: E[] = [{ id: "e1", source: "gen", target: "trim", targetHandle: "in" }]
    const { charge, payload } = await runCharge(nodes, edges, "trim", { gen: ranWith(genType, job) })
    expect(payload.upstreamDuration).toBe(RECORDED)
    expect(charge).toBe(marked(estimateTrimVideoCredits(TRIM as never, RECORDED), "trim-video"))
  })

  it("Loop is charged by the recorded length", async () => {
    const nodes: N[] = [gen, { id: "loop", type: "loop-video", data: LOOP }]
    const edges: E[] = [{ id: "e1", source: "gen", target: "loop", targetHandle: "in" }]
    const { charge, payload } = await runCharge(nodes, edges, "loop", { gen: ranWith(genType, job) })
    expect(payload.upstreamDuration).toBe(RECORDED)
    expect(charge).toBe(marked(estimateLoopVideoCredits(LOOP as never, RECORDED), "loop-video"))
  })

  it("Combine Videos is charged by the recorded length for that clip", async () => {
    const nodes: N[] = [
      gen,
      { id: "up", type: "upload-video", data: { url: OTHER_URL, generatedResults: [{ url: OTHER_URL, duration: 6 }] } },
      { id: "combine", type: "combine-videos", data: {} },
    ]
    const edges: E[] = [
      { id: "e1", source: "gen", target: "combine", targetHandle: "videos" },
      { id: "e2", source: "up", target: "combine", targetHandle: "videos" },
    ]
    const { charge, payload } = await runCharge(nodes, edges, "combine", { gen: ranWith(genType, job) })
    expect(payload.upstreamDurations).toEqual([RECORDED, 6])
    expect(charge).toBe(marked(estimateCombineVideosCredits({}, [RECORDED, 6]), "combine-videos"))
  })
})

describe("a fixed-length generation is quoted by the server at the length the run hands on: its stored Duration", () => {
  // The editor always read it so; the server read the 8 s fallback (decided 2026-11-11: the stored Duration).
  it.each([
    ["Trim", { id: "step", type: "trim-video", data: TRIM }],
    ["Loop ×4", { id: "step", type: "loop-video", data: { mode: "repeat", repeatCount: 4 } }],
  ] as const)("%s after a fixed 15 s and a fixed 30 s generation: the run estimate and the run-set figure equal the run's charge", async (_name, step) => {
    for (const seconds of [15, 30]) {
      const gen = { id: "gen", type: "generate-video", data: { provider: "seedance-2-5", duration: seconds, generatedResults: [{ url: GEN_URL }], activeResultIndex: 0 } }
      const nodes: N[] = [gen, { ...step, data: { ...step.data } }]
      const edges: E[] = [{ id: "e1", source: "gen", target: "step", targetHandle: "in" }]
      const { charge, payload } = await runCharge(nodes, edges, "step", { gen: ranWith("generate-video", { videoUrl: GEN_URL }) })
      expect(payload.upstreamDuration, `${seconds} s`).toBe(seconds)
      // The step alone (the generation's take is the one it is handed), and the whole graph (the generation runs again, at its Duration).
      expect(await CreditsService.estimateWorkflowCredits(nodes, edges, { runNodeIds: new Set(["step"]) }), `${seconds} s, the step alone`).toBe(charge)
      expect(await estimateRunSetCredits(nodes, edges, new Set(["step"])), `${seconds} s, run-set figure`).toBe(charge)
      const all = await estimateWorkflowCreditsDetailed(nodes, edges, { runNodeIds: new Set(["gen", "step"]) })
      expect(all.perNode.step!.credits, `${seconds} s, execute all`).toBe(charge)
    }
  })
})

describe("AI Audit in a workflow run is priced by the length a generated video recorded", () => {
  // Its bucket comes from the length the run hands it (`inputs.videoDuration`), the same carry as Trim's (decided 2026-11-11).
  const nodes: N[] = [
    { id: "gen", type: "generate-video", data: { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO } },
    { id: "audit", type: "video-audit", data: {} },
  ]
  const edges: E[] = [{ id: "e1", source: "gen", target: "audit", targetHandle: "video" }]
  const auditId = (state: NodeExecutionState) => {
    const all = nodes as unknown as SimpleNode[]
    const target = all.find((n) => n.id === "audit")!
    const inputs = resolveNodeInputs(target, edges as unknown as SimpleEdge[], { gen: state }, all, undefined)
    return buildPayload(target, "job-1", inputs, "usage-1").modelIdentifier
  }

  it("after a length-following video: the bucket of its recorded length", () => {
    expect(auditId(ranWith("generate-video", { videoUrl: GEN_URL, durationSec: 23.4 }))).toBe(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 23.4 }))
  })

  it("after a video that recorded nothing: today's ceiling bucket", () => {
    expect(auditId(ranWith("generate-video", { videoUrl: GEN_URL }))).toBe(buildVideoAuditCreditId({ analysisProvided: false, durationSec: undefined }))
    expect(buildVideoAuditCreditId({ analysisProvided: false, durationSec: undefined })).not.toBe(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 23.4 }))
  })
})

describe("a generation that records nothing is handed what it was handed before", () => {
  it.each([
    ["a fixed-length Generate Video (its stored 10 s)", { provider: "seedance-2-5", duration: 10 }, 10],
    ["an automatic length whose job recorded nothing (an older job, a failed probe): the 8 s fallback", { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }, undefined],
  ])("%s", async (_name, genData, handed) => {
    const nodes: N[] = [{ id: "gen", type: "generate-video", data: genData }, { id: "trim", type: "trim-video", data: TRIM }]
    const edges: E[] = [{ id: "e1", source: "gen", target: "trim", targetHandle: "in" }]
    const { charge, payload } = await runCharge(nodes, edges, "trim", { gen: ranWith("generate-video", { videoUrl: GEN_URL, thumbnailUrl: "https://m.test/gen.jpg" }) })
    expect(payload.upstreamDuration).toBe(handed)
    expect(charge).toBe(marked(estimateTrimVideoCredits(TRIM as never, handed ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS), "trim-video"))
  })

  it("another video producer's `durationSec` is not carried (an avatar's, Lip Sync's): unchanged", () => {
    for (const type of ["lip-sync", "extend-video", "ai-avatar", "speech-to-video"]) {
      expect(buildNodeOutputFromJobData({ videoUrl: GEN_URL, durationSec: 23.4 }, type), type).not.toHaveProperty("durationSec")
    }
  })
})
