/**
 * The length a workflow RUN hands a length-priced step (Trim, Loop, Combine
 * Videos) — what the step is CHARGED at — is the length the run estimates
 * price that wire at (decided 2026-10-13). One read, both engines:
 * `runForwardedVideoLengthSec` (@nodaro/render-rules).
 *
 * - A chain (an upload → Trim → Loop): the Loop is handed the length the Trim
 *   passes on, as the estimate prices it — not the 8 s fallback.
 * - A render's output: the length of the cut it rendered (recorded on its
 *   output), never above its estimate (the render's minutes, rounded up).
 * - A Bundle of finished UGC clips into Combine Videos: each clip at its own
 *   real length, not 8 s each.
 * - An Upload Video whose link was pasted over earlier uploads: the earlier
 *   file's length is never read for the pasted one.
 *
 * Each case drives the real input resolver, the real payload builder and the
 * charge function the run's reservation calls (`videoUtilityChargeBaseCredits`).
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

import { estimateCombineVideosCredits } from "@nodaro/shared/credits"
import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { videoUtilityChargeBaseCredits } from "../../../lib/video-utility-credits.js"
import { applyInputOverridesToNodes } from "../../../workers/apply-input-overrides.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { extractSavedNodeOutput } from "../../../services/workflow-engine/output-extractor.js"
import { seededFromSavedData } from "../../../services/workflow-engine/saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../../../services/workflow-engine/types.js"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data?: Record<string, unknown> }

/** What the run reserves for `targetId` (marked up once), and the payload it built. */
async function runCharge(nodes: N[], edges: E[], targetId: string, nodeStates: Record<string, NodeExecutionState> = {}, row?: number) {
  const all = nodes as unknown as SimpleNode[]
  const target = all.find((n) => n.id === targetId)!
  const inputs = resolveNodeInputs(target, edges as unknown as SimpleEdge[], nodeStates, all, undefined, row)
  const { payload } = buildPayload(target, "job-1", inputs, "usage-1")
  const base = await videoUtilityChargeBaseCredits(target.type, payload)
  return { charge: applyServiceMarkup(base!, settings.current as never, target.type), payload }
}

const marked = (base: number, id: string) => applyServiceMarkup(base, settings.current as never, id)
const done = (output: Record<string, unknown>): NodeExecutionState => ({ status: "completed", output } as NodeExecutionState)

beforeEach(() => {
  settings.current = { cost_markup_percent: 15, service_margin_percent: {} }
  invalidateModelPricingCache()
})

describe("a chain: upload (40 s) → Trim (keep the first 23 s) → Loop (×2)", () => {
  const nodes: N[] = [
    { id: "up", type: "upload-video", data: { url: "https://m.test/up.mp4", generatedResults: [{ url: "https://m.test/up.mp4", duration: 40 }] } },
    { id: "trim", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 23 } },
    { id: "loop", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } },
  ]
  const edges: E[] = [
    { id: "e1", source: "up", target: "trim", targetHandle: "in" },
    { id: "e2", source: "trim", target: "loop", targetHandle: "in" },
  ]

  it("the Loop is handed the 23 s the Trim passes on, and is charged its estimate (46 s → 10 units)", async () => {
    const { charge, payload } = await runCharge(nodes, edges, "loop", { trim: done({ videoUrl: "https://m.test/trimmed.mp4" }) })
    expect(payload.upstreamDuration).toBe(23)
    const estimate = await CreditsService.estimateWorkflowCredits(nodes, edges, { runNodeIds: new Set(["loop"]) })
    expect(charge).toBe(marked(100, "loop-video"))
    expect(charge).toBe(estimate)
  })

  it("the Trim itself is handed the upload's 40 s", async () => {
    const { payload } = await runCharge(nodes, edges, "trim")
    expect(payload.upstreamDuration).toBe(40)
  })

  it("a stale recorded length on the Trim never wins over its chain", async () => {
    const stale = nodes.map((n) => (n.id === "trim" ? { ...n, data: { ...n.data, generatedResults: [{ url: "https://m.test/old.mp4", duration: 3 }] } } : n))
    const { payload } = await runCharge(stale, edges, "loop", { trim: done({ videoUrl: "https://m.test/trimmed.mp4" }) })
    expect(payload.upstreamDuration).toBe(23)
  })
})

describe("a render's output: Apply EDL (3 min 10 s) → Trim (the whole clip)", () => {
  const edl = {
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "https://m.test/a.mp4", kind: "video" }],
    segments: [{ id: "s0", inMs: 0, outMs: 190000, video: "A", audio: "A" }],
  }
  const nodes: N[] = [
    { id: "render", type: "apply-edl", data: { edl } },
    { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } },
  ]
  const edges: E[] = [{ id: "e1", source: "render", target: "trim", targetHandle: "in" }]

  it("this run's render: the 190 s cut it recorded (38 units), at most its estimate (4 minutes → 48 units)", async () => {
    const { charge, payload } = await runCharge(nodes, edges, "trim", { render: done({ videoUrl: "https://m.test/cut.mp4", durationSec: 190 }) })
    expect(payload.upstreamDuration).toBe(190)
    expect(charge).toBe(marked(380, "trim-video"))
    const estimate = await CreditsService.estimateWorkflowCredits(nodes, edges, { runNodeIds: new Set(["trim"]) })
    expect(estimate).toBe(marked(480, "trim-video"))
    expect(charge).toBeLessThanOrEqual(estimate)
  })

  it("an earlier run's render: the length on its saved take", async () => {
    const saved = nodes.map((n) => (n.id === "render" ? { ...n, data: { ...n.data, generatedResults: [{ url: "https://m.test/cut.mp4", duration: 190 }] } } : n))
    const render = saved.find((n) => n.id === "render")! as unknown as SimpleNode
    const { payload } = await runCharge(saved, edges, "trim", { render: seededFromSavedData(extractSavedNodeOutput(render)) })
    expect(payload.upstreamDuration).toBe(190)
  })
})

describe("a Bundle of finished UGC clips into Combine Videos", () => {
  const clips = ["https://m.test/c1.mp4", "https://m.test/c2.mp4", "https://m.test/c3.mp4"]
  const secs = [6.2, 7.1, 13.4]
  const meta = secs.map((durationSec) => ({ warnings: [], durationSec }))
  const join = { id: "join", type: "combine-videos", data: { transition: "cut", trimStartFrames: 1, trimEndFrames: 2 } }
  const edges: E[] = [{ id: "e1", source: "finish", sourceHandle: "video-out", target: "join", targetHandle: "in", data: { outputMode: "all" } }]
  const expected = marked(estimateCombineVideosCredits({ transition: "cut", trimStartFrames: 1, trimEndFrames: 2 }, secs), "combine-videos")

  it("this run's clips: each at its own length, not 8 s each", async () => {
    const nodes: N[] = [{ id: "finish", type: "ugc-finish-clips", data: {} }, join]
    const { charge, payload } = await runCharge(nodes, edges, "join", { finish: done({ videoUrl: clips[0], listResults: clips, listResultMeta: meta }) })
    expect(payload.videoUrls).toEqual(clips)
    expect(payload.upstreamDurations).toEqual(secs)
    expect(charge).toBe(expected)
    // The fallback this replaces: 3 × 8 s.
    expect(charge).not.toBe(marked(estimateCombineVideosCredits({ transition: "cut", trimStartFrames: 1, trimEndFrames: 2 }, [8, 8, 8]), "combine-videos"))
  })

  it("an earlier run's clips, read off the node", async () => {
    const nodes: N[] = [{ id: "finish", type: "ugc-finish-clips", data: { __listResults: clips, __listResultMeta: meta } }, join]
    const { payload } = await runCharge(nodes, edges, "join")
    expect(payload.upstreamDurations).toEqual(secs)
  })

  it("a step after the join is handed all three clips' length (26.7 s), not one clip's", async () => {
    const trim = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } }
    const nodes: N[] = [{ id: "finish", type: "ugc-finish-clips", data: {} }, join, trim]
    const chain: E[] = [...edges, { id: "e2", source: "join", target: "trim", targetHandle: "in" }]
    const { payload } = await runCharge(nodes, chain, "trim", {
      finish: done({ videoUrl: clips[0], listResults: clips, listResultMeta: meta }),
      join: done({ videoUrl: "https://m.test/joined.mp4" }),
    })
    expect(payload.upstreamDuration).toBeCloseTo(6.2 + 7.1 + 13.4, 6)
  })

  it("a row with no recorded length stays at the fallback, the others at their own", async () => {
    const partial = [meta[0], { warnings: [], durationSec: null }, meta[2]]
    const nodes: N[] = [{ id: "finish", type: "ugc-finish-clips", data: {} }, join]
    const { payload } = await runCharge(nodes, edges, "join", { finish: done({ videoUrl: clips[0], listResults: clips, listResultMeta: partial }) })
    expect(payload.upstreamDurations).toEqual([6.2, undefined, 13.4])
  })
})

describe("an Upload Video whose link was pasted over earlier uploads", () => {
  const trim = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } }
  const edges: E[] = [{ id: "e1", source: "up", target: "trim", targetHandle: "in" }]
  const pasted: N = {
    id: "up",
    type: "upload-video",
    data: { url: "https://elsewhere.test/pasted.mp4", externalUrl: "https://elsewhere.test/pasted.mp4", generatedResults: [{ url: "https://m.test/old.mp4", duration: 40 }], activeResultIndex: 0 },
  }

  it("the earlier file's 40 s is not charged for the pasted link — charge and estimate both at the fallback", async () => {
    const { charge, payload } = await runCharge([pasted, trim], edges, "trim")
    expect(payload.upstreamDuration).toBeUndefined()
    expect(charge).toBe(marked(20, "trim-video"))
    expect(await CreditsService.estimateWorkflowCredits([pasted, trim], edges, { runNodeIds: new Set(["trim"]) })).toBe(charge)
  })

  it("an earlier upload chosen again is read at its own length", async () => {
    const back = { ...pasted, data: { ...pasted.data, url: "https://m.test/old.mp4", externalUrl: "" } }
    const { payload } = await runCharge([back, trim], edges, "trim")
    expect(payload.upstreamDuration).toBe(40)
  })

  it("a published app's upload replaces the template's: the template's length is not read", async () => {
    const template: N = { id: "up", type: "upload-video", data: { url: "https://m.test/old.mp4", generatedResults: [{ url: "https://m.test/old.mp4", duration: 40 }], metadata: { durationSeconds: 40 } } }
    const graph = [template, trim].map((n) => ({ ...n, data: { ...n.data } })) as unknown as SimpleNode[]
    applyInputOverridesToNodes(graph as never, { up: { url: "https://m.test/caller.mp4" } })
    const { payload } = await runCharge(graph as unknown as N[], edges, "trim")
    expect(payload.upstreamDuration).toBeUndefined()
  })
})

describe("a fan-in: List (3 clips) → Trim on Each → Combine Videos on Bundle", () => {
  const urls = ["https://m.test/a.mp4", "https://m.test/b.mp4", "https://m.test/c.mp4"]
  const nodes: N[] = [
    { id: "list", type: "list", data: { items: urls.join("\n") } },
    { id: "trim", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 4 } },
    { id: "join", type: "combine-videos", data: {} },
  ]
  const edges: E[] = [
    { id: "e1", source: "list", target: "trim", targetHandle: "in" },
    { id: "e2", source: "trim", target: "join", targetHandle: "in", data: { outputMode: "all" } },
  ]
  const trimmed = ["https://m.test/t1.mp4", "https://m.test/t2.mp4", "https://m.test/t3.mp4"]

  it("the server's estimate counts the three clips the join receives, and equals what the run charges", async () => {
    // The run: the Trim once per item (a fixed 0–4 s window: 1 unit whatever it is given), then the join
    // with every trim, each at the 4 s the Trim passes on.
    const trimRun = { charge: marked(10, "trim-video") }
    const { charge: joinCharge, payload } = await runCharge(nodes, edges, "join", { trim: done({ videoUrl: trimmed[2], listResults: trimmed }) })
    expect(payload.videoUrls).toEqual(trimmed)
    expect(payload.upstreamDurations).toEqual([4, 4, 4])
    // 3 × 4 s less the default trims (1 + 2 frames a clip) = 11.6 s → 3 units, + 1 for the third input.
    expect(joinCharge).toBe(marked(40, "combine-videos"))
    const estimate = await CreditsService.estimateWorkflowCredits(nodes, edges)
    expect(estimate).toBe(3 * trimRun.charge + joinCharge)
    // What the estimate quoted before: the join as one clip (1 unit).
    expect(estimate).toBeGreaterThan(3 * trimRun.charge + marked(10, "combine-videos"))
  })
})
