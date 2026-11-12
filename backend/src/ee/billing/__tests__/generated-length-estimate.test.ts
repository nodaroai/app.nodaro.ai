// @test-units-by-name prices the node types it names (upload-video, generate-video, trim-video, loop-video, combine-videos)
/**
 * A generated video made at an automatic length (or by a Seedance Edit /
 * Extend) records the length it really is, at most its run's upper bound, and
 * the step after it — Trim, Loop, Combine Videos — is charged by that. Every
 * quote the server makes before the video exists (the run estimate, which the
 * run-set credit check is handed; the published listing) must be at least that
 * charge. The run estimate reads a generation source through the shared rule
 * (`generationSourceEstimateSec`, the editor's estimate reads it too); the
 * listing through each producer's length rule (`generatedVideoLengthSec`).
 *
 * The run side is computed through the run's own functions: the executor's
 * reference task type stamp (the clip measured), the shared bound, and the
 * estimators the run charges with. No credit figure is typed here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 15, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS.
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
const probe = vi.hoisted(() => ({ durations: new Map<string, number>() }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))

import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec, SEEDANCE_VIDEO_EDIT_PROVIDERS, SEEDANCE_VIDEO_EDIT_SHAPE, SEEDANCE_VIDEO_EDIT_TASK_TYPE, VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { estimateCombineVideosCredits, estimateLoopVideoCredits, estimateTrimVideoCredits, VIDEO_SFX_PRICING, videoSfxCreditId } from "@nodaro/shared/credits"
import { knownLength, lengthFollowingBoundSec, utilityOutputLength } from "@nodaro/render-rules"
import { CreditsService, estimateWorkflowCreditsDetailed, invalidateModelPricingCache, STATIC_CREDIT_COSTS } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { __forgetUploadClipLengths } from "../upload-clip-lengths.js"
import { stampSeedanceReferenceTaskType } from "../../../lib/seedance-task-type-stamp.js"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { id: string; source: string; target: string; targetHandle: string }

const TRIM = { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 }
const LOOP = { mode: "repeat", repeatCount: 2 }
const CLIP_URL = "https://m.test/clip.mp4"
const OTHER_URL = "https://m.test/other.mp4"
const OTHER_SEC = 6
const STEPS = ["trim", "loop", "combine"] as const
type Step = (typeof STEPS)[number]
const STEP_TYPE: Record<Step, string> = { trim: "trim-video", loop: "loop-video", combine: "combine-videos" }

/** A clip `clipSec` long (an upload; none when undefined) into a generation node (Generate Video's reference video by default), and that node into Trim, Loop and Combine Videos (beside a 6 s upload). */
function graph(gen: Record<string, unknown>, clipSec: number | undefined, results?: Array<Record<string, unknown>>, source: { type: string; clipHandle: string } = { type: "generate-video", clipHandle: "videoReferences" }): { nodes: N[]; edges: E[] } {
  probe.durations = new Map([...(clipSec === undefined ? [] : [[CLIP_URL, clipSec] as const]), [OTHER_URL, OTHER_SEC]])
  __forgetUploadClipLengths()
  const nodes: N[] = [
    ...(clipSec === undefined ? [] : [{ id: "clip", type: "upload-video", data: { url: CLIP_URL, generatedResults: [{ url: CLIP_URL, duration: clipSec }], metadata: { durationSeconds: clipSec } } }]),
    { id: "gen", type: source.type, data: { prompt: "p", aspectRatio: "16:9", resolution: "720p", ...gen, ...(results ? { generatedResults: results, activeResultIndex: 0 } : {}) } },
    { id: "trim", type: "trim-video", data: TRIM },
    { id: "loop", type: "loop-video", data: LOOP },
    { id: "other", type: "upload-video", data: { url: OTHER_URL, generatedResults: [{ url: OTHER_URL, duration: OTHER_SEC }], metadata: { durationSeconds: OTHER_SEC } } },
    { id: "combine", type: "combine-videos", data: {} },
  ]
  const edges: E[] = [
    ...(clipSec === undefined ? [] : [{ id: "e0", source: "clip", target: "gen", targetHandle: source.clipHandle }]),
    { id: "e1", source: "gen", target: "trim", targetHandle: "in" },
    { id: "e2", source: "gen", target: "loop", targetHandle: "in" },
    { id: "e3", source: "gen", target: "combine", targetHandle: "videos" },
    { id: "e4", source: "other", target: "combine", targetHandle: "videos" },
  ]
  return { nodes, edges }
}

/** Each step's base charge when the generation hands it `sec` seconds (the fallback when none), by the estimators the run charges with. */
const baseChargesAt = (sec: number | undefined): Record<Step, number> => ({
  trim: estimateTrimVideoCredits(TRIM as never, sec),
  loop: estimateLoopVideoCredits(LOOP as never, sec),
  combine: estimateCombineVideosCredits({}, [sec, OTHER_SEC]),
})
const marked = (base: number, step: Step) => applyServiceMarkup(base, settings.current as never, STEP_TYPE[step])

/**
 * The most the run can hand the step after the generation: the request as the
 * executor sends it (its reference task type stamped with the clip measured)
 * records at most its bound when it follows its own length; otherwise the
 * stored length, as before (none: the fallback).
 */
function mostHanded(gen: { provider: string; duration: number; referenceTaskType?: string }, clipSec: number | undefined): number | undefined {
  const payload = { ...gen, aspectRatio: "16:9", resolution: "720p", ...(clipSec === undefined ? {} : { referenceVideoUrls: [CLIP_URL] }) }
  const sent = stampSeedanceReferenceTaskType(payload, clipSec === undefined ? [] : [clipSec])
  return lengthFollowingBoundSec({ provider: sent.provider, duration: sent.duration, referenceTaskType: sent.referenceTaskType }) ?? (gen.duration > 0 ? gen.duration : undefined)
}

/** The server's run estimate of each step (marked up, as charged), for a run of `runNodeIds`. */
async function runEstimate(g: { nodes: N[]; edges: E[] }, runNodeIds: ReadonlySet<string>): Promise<Record<Step, number>> {
  const { perNode } = await estimateWorkflowCreditsDetailed(g.nodes, g.edges, { runNodeIds: new Set(runNodeIds) })
  return { trim: perNode.trim!.credits, loop: perNode.loop!.credits, combine: perNode.combine!.credits }
}

/** The listing's figure for one step (base credits): the graph with it, less the graph without it. The uploads are files the app's user does not replace, so nothing follows an episode. */
async function listed(g: { nodes: N[]; edges: E[] }, step: Step): Promise<number> {
  const without = { nodes: g.nodes.filter((n) => n.id !== step), edges: g.edges.filter((e) => e.target !== step) }
  const kept = { replaceableMediaNodeIds: new Set<string>() }
  const a = await CreditsService.estimateWorkflowBaseListing(g.nodes, g.edges, "app", kept)
  const b = await CreditsService.estimateWorkflowBaseListing(without.nodes, without.edges, "app", kept)
  expect(a.previewPerMinute - b.previewPerMinute, `: nothing follows an episode`).toBe(0)
  return a.preview - b.preview
}

function acceptedClips(provider: string): number[] {
  const limits = VIDEO_REF_VIDEO_DURATION_LIMITS[provider] ?? { minSec: 1, maxSec: Math.max(...Object.values(VIDEO_REF_VIDEO_DURATION_LIMITS).map((l) => l?.maxSec ?? 0)) }
  return Array.from({ length: limits.maxSec - Math.ceil(limits.minSec) + 1 }, (_, i) => Math.ceil(limits.minSec) + i)
}

const MODELS = ["seedance-2-5", "seedance-2"] as const
const ALL = new Set(["clip", "gen", "trim", "loop", "other", "combine"])

beforeEach(() => {
  settings.current = { cost_markup_percent: 15, service_margin_percent: {} }
  invalidateModelPricingCache()
})

describe("never under-quote: a length-following generation into Trim, Loop and Combine Videos (brute force)", () => {
  it("the models offer an automatic length", () => {
    for (const p of MODELS) expect(MODEL_CATALOG[p]?.autoDuration, p).toBe(true)
  })

  const cases: Array<[string, { duration: number; referenceTaskType?: string }, boolean]> = [
    ["Auto, no reference video", { duration: VIDEO_DURATION_AUTO }, false],
    ["Auto, a reference clip", { duration: VIDEO_DURATION_AUTO }, true],
    ["a declared Edit at a stored 5 s", { duration: 5, referenceTaskType: "edit" }, true],
    ["a declared Extend at a stored Auto", { duration: VIDEO_DURATION_AUTO, referenceTaskType: "extend" }, true],
  ]
  for (const provider of MODELS) {
    it.each(cases)(`${provider} — %s: the run estimate and the listing of each step are at least the most the run can charge it`, async (_name, settingsOf, withClip) => {
      const gen = { provider, ...settingsOf }
      for (const clipSec of withClip ? acceptedClips(provider) : [undefined]) {
        const g = graph(gen, clipSec)
        const most = baseChargesAt(mostHanded(gen, clipSec))
        // Execute all, and a run of the step alone (the generation has no result yet, so it runs).
        for (const runNodeIds of [ALL, new Set(["trim", "loop", "combine"])]) {
          const quoted = await runEstimate(g, runNodeIds)
          for (const step of STEPS) {
            expect(quoted[step], `${step}, clip ${String(clipSec)} s, run of ${[...runNodeIds].join("+")}`).toBeGreaterThanOrEqual(marked(most[step], step))
          }
        }
        for (const step of STEPS) expect(await listed(g, step), `${step} listed, clip ${String(clipSec)} s`).toBeGreaterThanOrEqual(most[step])
      }
    }, 120_000)
  }

  /** Each step's run estimate (execute all, and a run of the steps alone) and listing, at least the most the run can charge it. */
  async function holdsAtLeast(g: { nodes: N[]; edges: E[] }, most: Record<Step, number>, at: string) {
    for (const runNodeIds of [ALL, new Set(["trim", "loop", "combine"])]) {
      const quoted = await runEstimate(g, runNodeIds)
      for (const step of STEPS) expect(quoted[step], `${step}, ${at}, run of ${[...runNodeIds].join("+")}`).toBeGreaterThanOrEqual(marked(most[step], step))
    }
    for (const step of STEPS) expect(await listed(g, step), `${step} listed, ${at}`).toBeGreaterThanOrEqual(most[step])
  }

  it.each([
    ["the older Image to Video node on Auto", "image-to-video"],
    ["the older Text to Video node on Auto", "text-to-video"],
  ])("%s: the run estimate and the listing of each step are at least the most the run can charge it", async (_name, type) => {
    for (const provider of MODELS) {
      const gen = { provider, duration: VIDEO_DURATION_AUTO }
      await holdsAtLeast(graph(gen, undefined, undefined, { type, clipHandle: "" }), baseChargesAt(mostHanded(gen, undefined)), provider)
    }
  }, 120_000)

  it("the Video to Video node's Seedance edit, every accepted source clip: the run estimate and the listing of each step are at least the most the run can charge it", async () => {
    for (const provider of SEEDANCE_VIDEO_EDIT_PROVIDERS) {
      // The lane edits its source clip at an automatic length, requesting the edit (the executor sends it so).
      const run = { provider, duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration, referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE }
      for (const clipSec of acceptedClips(provider)) {
        await holdsAtLeast(graph({ provider }, clipSec, undefined, { type: "video-to-video", clipHandle: "video" }), baseChargesAt(mostHanded(run, clipSec)), `${provider}, clip ${clipSec} s`)
      }
    }
  }, 120_000)

  it("the editor's and the server's quote agree: Seedance 2.5, a declared Edit at a stored 5 s, a 25 s clip, into Combine Videos", async () => {
    const g = graph({ provider: "seedance-2-5", duration: 5, referenceTaskType: "edit" }, 25)
    const quoted = await runEstimate(g, ALL)
    // The editor's quote is this base (`generated-length-estimate.test.ts` in the editor holds it to the same rule).
    expect(quoted.combine).toBe(marked(baseChargesAt(pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO)).combine, "combine"))
  })
})

describe("the listing reads a Video to Video Seedance edit at its bound only for the steps charged by the length handed to them", () => {
  /** A Video to Video Seedance edit whose source clip is not known to the listing (nothing wired), into `step`. */
  function editInto(step: { id: string; type: string; data: Record<string, unknown> }, handle: string) {
    const nodes: N[] = [{ id: "gen", type: "video-to-video", data: { provider: "seedance-2-5", prompt: "p" } }, step]
    return { nodes, edges: [{ id: "e1", source: "gen", target: step.id, targetHandle: handle }] }
  }
  const kept = { replaceableMediaNodeIds: new Set<string>() }
  const listedStep = async (g: { nodes: N[]; edges: E[] }, stepId: string) => {
    const a = await CreditsService.estimateWorkflowBaseListing(g.nodes, g.edges, "app", kept)
    const b = await CreditsService.estimateWorkflowBaseListing(g.nodes.filter((n) => n.id !== stepId), [], "app", kept)
    return { fixed: a.preview - b.preview, perMinute: a.previewPerMinute - b.previewPerMinute }
  }

  it("into Video SFX (it measures its clip): listed exactly as before this rule, at its longest row", async () => {
    const listedSfx = await listedStep(editInto({ id: "sfx", type: "video-sfx", data: {} }, "video"), "sfx")
    expect(listedSfx).toStrictEqual({ fixed: STATIC_CREDIT_COSTS[videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)], perMinute: 0 })
  })

  it("into Trim, Loop and Combine Videos (charged by the length handed to them): at least the most the run can charge", async () => {
    const bound = lengthFollowingBoundSec({ provider: "seedance-2-5", duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration })!
    const steps: Record<Step, { data: Record<string, unknown>; handle: string; base: number }> = {
      trim: { data: TRIM, handle: "in", base: estimateTrimVideoCredits(TRIM as never, bound) },
      loop: { data: LOOP, handle: "in", base: estimateLoopVideoCredits(LOOP as never, bound) },
      combine: { data: {}, handle: "videos", base: estimateCombineVideosCredits({}, [bound]) },
    }
    for (const step of STEPS) {
      const listedFor = await listedStep(editInto({ id: step, type: STEP_TYPE[step], data: steps[step].data }, steps[step].handle), step)
      expect(listedFor.fixed, step).toBeGreaterThanOrEqual(steps[step].base)
    }
  })
})

describe("a generation that does not run is quoted at the length its result recorded; one that re-runs never is", () => {
  const gen = { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }
  const results = [{ url: "https://m.test/g.mp4", duration: 5 }]

  it("re-run with an earlier 5 s take: the bound, not 5 s", async () => {
    const quoted = await runEstimate(graph(gen, undefined, results), ALL)
    const bound = pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO)
    for (const step of STEPS) expect(quoted[step], step).toBe(marked(baseChargesAt(bound)[step], step))
  })

  it("not re-run: the 5 s its take recorded", async () => {
    const quoted = await runEstimate(graph(gen, undefined, results), new Set(["trim", "loop", "combine"]))
    for (const step of STEPS) expect(quoted[step], step).toBe(marked(baseChargesAt(5)[step], step))
  })
})

describe("a fixed-length generation is quoted at its stored Duration, the length the run hands on", () => {
  // Before, the server read the estimators' fallback here (decided 2026-11-11: the stored Duration, as the editor and the run read it).
  it.each<[string, { duration: number } & Record<string, unknown>]>([
    ["Seedance 2.5 at 10 s", { provider: "seedance-2-5", duration: 10 }],
    ["Seedance 2.5 at 5 s, declared Reference", { provider: "seedance-2-5", duration: 5, referenceTaskType: "reference" }],
    ["a model with no automatic length", { provider: "kling-3.0", duration: 10 }],
  ])("%s", async (_name, gen) => {
    const g = graph(gen, undefined)
    for (const runNodeIds of [ALL, new Set(["trim", "loop", "combine"])]) {
      const quoted = await runEstimate(g, runNodeIds)
      for (const step of STEPS) expect(quoted[step], step).toBe(marked(baseChargesAt(gen.duration)[step], step))
    }
  })

  it("a generation that stores no length is read at the estimators' fallback, as the run hands it on", async () => {
    const quoted = await runEstimate(graph({ provider: "kling-3.0" }, undefined), ALL)
    for (const step of STEPS) expect(quoted[step], step).toBe(marked(baseChargesAt(undefined)[step], step))
  })
})

describe("never under-quote through a chain and through a Teleport", () => {
  type Source = { type: string; data: Record<string, unknown>; run: { provider: string; duration: number; referenceTaskType?: string }; clipSec?: number; clipHandle?: string }
  const SOURCES: Array<[string, Source]> = [
    ["Seedance 2.5 on Auto", { type: "generate-video", data: { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }, run: { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO } }],
    ["Seedance 2.0 on Auto", { type: "generate-video", data: { provider: "seedance-2", duration: VIDEO_DURATION_AUTO }, run: { provider: "seedance-2", duration: VIDEO_DURATION_AUTO } }],
    ["Seedance 2.5, a declared Edit at a stored 5 s, a 25 s clip", { type: "generate-video", data: { provider: "seedance-2-5", duration: 5, referenceTaskType: "edit" }, run: { provider: "seedance-2-5", duration: 5, referenceTaskType: "edit" }, clipSec: 25, clipHandle: "videoReferences" }],
    ["a Video to Video Seedance edit of a 12 s clip", { type: "video-to-video", data: { provider: "seedance-2-5" }, run: { provider: "seedance-2-5", duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration, referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE }, clipSec: 12, clipHandle: "video" }],
  ]
  const kept = { replaceableMediaNodeIds: new Set<string>() }
  /** The listing's figure for `stepId` (base, fixed): the graph with it less the graph without it. */
  async function listedStep(nodes: N[], edges: E[], stepId: string): Promise<number> {
    const a = await CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", kept)
    const b = await CreditsService.estimateWorkflowBaseListing(nodes.filter((n) => n.id !== stepId), edges.filter((e) => e.target !== stepId), "app", kept)
    expect(a.previewPerMinute - b.previewPerMinute).toBe(0)
    return a.preview - b.preview
  }
  function withSource(s: Source): { nodes: N[]; edges: E[] } {
    probe.durations = new Map(s.clipSec === undefined ? [] : [[CLIP_URL, s.clipSec]])
    __forgetUploadClipLengths()
    return {
      nodes: [
        ...(s.clipSec === undefined ? [] : [{ id: "clip", type: "upload-video", data: { url: CLIP_URL, generatedResults: [{ url: CLIP_URL, duration: s.clipSec }], metadata: { durationSeconds: s.clipSec } } }]),
        { id: "gen", type: s.type, data: { prompt: "p", aspectRatio: "16:9", resolution: "720p", ...s.data } },
      ],
      edges: s.clipSec === undefined ? [] : [{ id: "e0", source: "clip", target: "gen", targetHandle: s.clipHandle! }],
    }
  }

  it.each(SOURCES)("%s → Loop ×2 → Trim: the run estimate and the listing of each step are at least the most the run can charge", async (_name, s) => {
    const base = withSource(s)
    const loopNode = { id: "loop", type: "loop-video", data: LOOP }
    const nodes: N[] = [...base.nodes, loopNode, { id: "trim", type: "trim-video", data: TRIM }]
    const edges: E[] = [...base.edges, { id: "e1", source: "gen", target: "loop", targetHandle: "in" }, { id: "e2", source: "loop", target: "trim", targetHandle: "in" }]
    const most = mostHanded(s.run, s.clipSec)
    const loopHands = knownLength(utilityOutputLength(loopNode, [{ targetHandle: "in" }], [most === undefined ? undefined : { fixedSec: most, perEpisodeSec: 0 }]))?.fixedSec
    const loopCharge = estimateLoopVideoCredits(LOOP as never, most)
    const trimCharge = estimateTrimVideoCredits(TRIM as never, loopHands)
    for (const runNodeIds of [new Set(nodes.map((n) => n.id)), new Set(["loop", "trim"])]) {
      const { perNode } = await estimateWorkflowCreditsDetailed(nodes, edges, { runNodeIds })
      expect(perNode.loop!.credits, "Loop").toBeGreaterThanOrEqual(marked(loopCharge, "loop"))
      expect(perNode.trim!.credits, "Trim").toBeGreaterThanOrEqual(marked(trimCharge, "trim"))
    }
    expect(await listedStep(nodes, edges, "trim"), "Trim listed").toBeGreaterThanOrEqual(trimCharge)
  }, 120_000)

  it.each(SOURCES)("%s → Teleport → Trim: the run estimate and the listing are at least the most the run can charge", async (_name, s) => {
    const base = withSource(s)
    const nodes: N[] = [...base.nodes, { id: "send", type: "teleport-send", data: {} }, { id: "recv", type: "teleport-receive", data: {} }, { id: "trim", type: "trim-video", data: TRIM }]
    const edges = [
      ...base.edges,
      { id: "e1", source: "gen", target: "send", targetHandle: "in" },
      { id: "tp", source: "send", sourceHandle: "out", target: "recv", targetHandle: "in", data: { teleporter: true } },
      { id: "e2", source: "recv", target: "trim", targetHandle: "in" },
    ] as E[]
    const charge = estimateTrimVideoCredits(TRIM as never, mostHanded(s.run, s.clipSec))
    for (const runNodeIds of [new Set(nodes.map((n) => n.id)), new Set(["trim"])]) {
      const { perNode } = await estimateWorkflowCreditsDetailed(nodes, edges, { runNodeIds })
      expect(perNode.trim!.credits).toBeGreaterThanOrEqual(marked(charge, "trim"))
    }
    expect(await listedStep(nodes, edges, "trim"), "Trim listed").toBeGreaterThanOrEqual(charge)
  }, 120_000)
})
