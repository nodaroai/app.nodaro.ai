// @test-units-by-name prices the node types it names (upload-video, generate-video, video-to-video, video-upscale)
// @test-watches backend/src/lib/__tests__/fixtures/seedance-hd-draft-quote.json
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MODEL_CATALOG, SEEDANCE_DRAFT_FINALIZE_PROVIDER, VIDEO_DURATION_AUTO, seedanceDraftFinalizeBillableSec } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_VIDEO_DURATION_LIMITS, checkRefVideoDurations, pricedOutputDurationSec } from "@nodaro/shared/models"
import { seedanceFinalizeDraftQuote } from "@nodaro/render-rules"

/**
 * A Seedance 2.5 HD finalize (Video Upscale, `seedance-2-5-hd`) whose draft the
 * estimated run MAKES is quoted at the length the draft's run reserves for
 * (decided 2026-11-12): the draft's own hold as output seconds, its reference
 * clips as input seconds, priced by the finalize's own functions and marked up
 * once at the finalize's id. The server's workflow estimate (the run estimate,
 * the published-app listing, the pre-run balance check) and the estimate route's
 * `plannedDraft` quote (what the editor's Run total shows) are that one figure,
 * and it is never below what the finalize of any draft that run can deliver is
 * charged — the charge read through the finalize's own gate and pricing
 * (`resolveSeedanceDraftFinalize` on the draft's job row, then
 * `seedanceDraftFinalizeChargedCredits`), never through the quote.
 */

const probe = vi.hoisted(() => ({ durations: new Map<string, number>() }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))
/** The draft job the finalize's gate reads (`resolveSeedanceDraftFinalize`); every other table has no rows. */
const db = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null }))
vi.mock("../../../lib/supabase.js", () => {
  const empty = () => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
    chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }
  const jobs = () => {
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (col: string, val: unknown) => { filters.push([col, val]); return q }
    q.limit = async () => ({ data: db.draft && filters.every(([c, v]) => db.draft![c] === v) ? [db.draft] : [], error: null })
    return q
  }
  // The run-set check reads the payer's balance (a Render final's verdict): a funded account.
  const profiles = () => {
    const q = empty()
    q.single = async () => ({ data: { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0, subscription_credits: 1_000_000, topup_credits: 0 }, error: null })
    return q
  }
  return { supabase: { from: (table: string) => (table === "jobs" ? jobs() : table === "profiles" ? profiles() : empty()), rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
const settings = vi.hoisted(() => ({ value: { cost_markup_percent: 40 } as Record<string, unknown> }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => settings.value }))
/** Credits on (the cloud edition); one case turns them off to read the take uncapped. */
const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => edition.credits,
}))

import { estimateRunSetFigures, estimateWorkflowCreditsDetailed, estimateWorkflowListingCredits, STATIC_CREDIT_COSTS } from "../credits.js"
import { existingDraftFinalizePricer, seedanceDraftFinalizeChargedCredits } from "../seedance-draft-finalize-credits.js"
import { seedance2RefVideoHeldOutputSec, seedanceDraftFinalizeRefBaseCredits } from "../seedance2-ref-video-credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { __forgetUploadClipLengths } from "../upload-clip-lengths.js"
import {
  resolveSeedanceDraftFinalize,
  seedanceDraftFinalizeQueuedBilledSec,
  seedanceDraftFinalizeStamp,
  seedanceDraftFinalizeStampedBaseCredits,
} from "../../../lib/seedance-draft-finalize.js"
import { appRunResumeCredits } from "../../lib/app-run-resume-price.js"
import { renderFinalCredits } from "../../../lib/render-final-run.js"
import { resetRefVideoProbeCache } from "../../../lib/ref-video-probe.js"
import { stampSeedanceReferenceTaskType } from "../../../lib/seedance-task-type-stamp.js"
import { registerSeedanceHdEstimate } from "../../routes/seedance-hd-estimate.js"

const P = "seedance-2-5"
const LIMITS = VIDEO_REF_VIDEO_DURATION_LIMITS[P]!
const USER = "user-a"
const DRAFT_JOB = "11111111-2222-4333-8444-555555555555"
const GV = { provider: P, prompt: "make it black and white", aspectRatio: "16:9", resolution: "480p", draft: true }
const FINALIZE = { id: "hd", type: "video-upscale", data: { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER } }

/** One reference clip of a draft: a length an upload is probed at, or one not produced yet (a generation's output). */
type Clip = number | "unknown"

const clipUrl = (i: number, sec: number) => `https://cdn.example/clip-${i}-${sec}.mp4`

/** A workflow graph to estimate, and the lengths its uploaded clips probe at. */
interface Graph {
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
  edges: Array<{ source: string; target: string; sourceHandle: string; targetHandle: string }>
  probed: Map<string, number>
}

/** A draft node (`data` on a Generate Video, or Video to Video's edit lane) fed `clips`, wired into a finalize. */
function graph(draft: { type: "generate-video" | "video-to-video"; data: Record<string, unknown> }, clips: readonly Clip[]): Graph {
  const sources = clips.map((clip, i) => clip === "unknown"
    // A generation's clip: its length is not known before the run.
    ? { id: `src-${i}`, type: "generate-video", data: { provider: "kling", prompt: "a clip", duration: 5 } }
    : { id: `src-${i}`, type: "upload-video", data: { url: clipUrl(i, clip) } })
  const handle = draft.type === "video-to-video" ? "video" : "videoReferences"
  return {
    nodes: [...sources, { id: "draft", type: draft.type, data: draft.data }, FINALIZE],
    edges: [
      ...sources.map((s) => ({ source: s.id, target: "draft", sourceHandle: "video", targetHandle: handle })),
      { source: "draft", target: "hd", sourceHandle: "video", targetHandle: "video" },
    ],
    probed: new Map(clips.flatMap((clip, i) => (clip === "unknown" ? [] : [[clipUrl(i, clip), clip] as const]))),
  }
}

/** The server's run estimate of the finalize in that graph. */
async function finalizeQuote(g: Graph): Promise<number> {
  probe.durations = g.probed
  __forgetUploadClipLengths()
  return (await estimateWorkflowCreditsDetailed(g.nodes, g.edges)).perNode.hd!.credits
}

/** The draft's own run as the executor sends it: the request, with its reference task type resolved on the measured clips. */
function draftRun(type: "generate-video" | "video-to-video", data: Record<string, unknown>, clips: readonly number[]) {
  const request = type === "video-to-video"
    // The edit lane's request: the edit's shape, requesting `edit` (payload-builder).
    ? { provider: P, aspectRatio: "adaptive", duration: VIDEO_DURATION_AUTO, draft: true, referenceTaskType: "edit" }
    : { ...data }
  return clips.length === 0 ? request : stampSeedanceReferenceTaskType({ ...request, referenceVideoUrls: clips.map((sec, i) => clipUrl(i, sec)) }, clips)
}

/** The output seconds the draft's run holds — what it can deliver, at most. */
function draftHoldSec(type: "generate-video" | "video-to-video", data: Record<string, unknown>, clips: readonly number[]): number {
  const sent = draftRun(type, data, clips)
  const outputDurationSec = pricedOutputDurationSec(P, sent.duration as number | string | undefined)
  if (clips.length === 0) return outputDurationSec
  return seedance2RefVideoHeldOutputSec({ provider: P, outputDurationSec, requestedDuration: sent.duration, referenceTaskType: sent.referenceTaskType, durationsSec: clips })
}

/** The draft's job row as its run records it: what it sent (its length and resolved task type), its probe of its clips, its raw take. */
function draftRow(type: "generate-video" | "video-to-video", data: Record<string, unknown>, clips: readonly number[], deliveredSec: number) {
  const sent: Record<string, unknown> = draftRun(type, data, clips)
  return {
    id: DRAFT_JOB, user_id: USER, status: "completed", provider_task_id: "task-draft", provider_kind: "kie-standard", parent_job_id: null,
    input_data: {
      ...sent, provider: P, draft: true, resolution: "480p",
      ...(clips.length > 0 ? { referenceVideoUrls: clips.map((sec, i) => clipUrl(i, sec)), refVideoDurationsSec: clips } : {}),
    } as Record<string, unknown>,
    output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: deliveredSec },
  }
}

/** The finalize's own gate (`resolveSeedanceDraftFinalize`) on a draft job row. */
async function resolveDraft(row: Record<string, unknown>) {
  db.draft = row
  const plan = await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_JOB })
  if (!plan.ok) throw new Error(`the gate refused the draft: ${plan.code}`)
  return plan
}

/**
 * What the finalize of a draft that delivered `deliveredSec` is charged: the
 * finalize's own gate on the draft's job row (its raw take, the probe its run
 * reserved with), priced as the finalize reserves it.
 */
async function finalizeCharge(type: "generate-video" | "video-to-video", data: Record<string, unknown>, clips: readonly number[], deliveredSec: number): Promise<number> {
  return seedanceDraftFinalizeChargedCredits(await resolveDraft(draftRow(type, data, clips, deliveredSec)))
}

/**
 * The most the finalize of ANY take the draft can deliver is charged: every
 * whole length up to the model's longest take (30 s), the hold itself and a
 * hair past it — a take past the hold is billed at the hold.
 */
async function mostCharged(type: "generate-video" | "video-to-video", data: Record<string, unknown>, clips: readonly number[]): Promise<number> {
  const hold = draftHoldSec(type, data, clips)
  const takes = [...Array.from({ length: 30 }, (_, i) => i + 1), hold, hold + 0.24, hold + 0.3]
  let most = 0
  for (const take of takes) most = Math.max(most, await finalizeCharge(type, data, clips, take))
  return most
}

/** Every concrete clip set `clips` can turn out to be that the draft's run accepts (an unknown clip at each whole length). */
function concreteClips(clips: readonly Clip[]): number[][] {
  const at = clips.indexOf("unknown")
  if (at < 0) return checkRefVideoDurations(P, clips as number[]).ok ? [clips as number[]] : []
  const out: number[][] = []
  for (let sec = LIMITS.minSec; sec <= LIMITS.maxSec; sec++) out.push(...concreteClips(clips.map((c, i) => (i === at ? sec : c))))
  return out
}

beforeEach(() => {
  settings.value = { cost_markup_percent: 40 }
  db.draft = null
  edition.credits = true
  resetRefVideoProbeCache()
})

describe("the four requests: the finalize is quoted at the draft's own reserved length", () => {
  it.each<[string, Record<string, unknown>, Clip[], number]>([
    // [request, the draft's settings, its clips, the finalize's BASE credits (no markup)]
    ["a draft edit of one 6 s clip (stored 16:9, 5 s): 6 s in + the edit's 7 s hold out", { duration: 5, referenceTaskType: "edit" }, [6], 3088],
    ["a draft edit of one 20 s clip: 20 s in + 21 s out", { duration: 5, referenceTaskType: "edit" }, [20], 9738],
    ["an undeclared draft at a fixed 4 s with one 6 s clip: 6 s in + 6 s out (the model may edit)", { duration: 4 }, [6], 2850],
    ["an Auto draft with no reference video: the 30 s row", { duration: VIDEO_DURATION_AUTO }, [], 11850],
    ["a 5 s draft with no reference video: the 5 s row", { duration: 5 }, [], 1980],
  ])("%s", async (_name, extra, clips, base) => {
    settings.value = { cost_markup_percent: 0 }
    const data = { ...GV, ...extra }
    expect(await finalizeQuote(graph({ type: "generate-video", data }, clips))).toBe(base)
    // …which is what the finalize of the draft's longest take is charged.
    expect(await mostCharged("generate-video", data, clips as number[])).toBe(base)
  })

  it("marked up once at the finalize's id", async () => {
    const data = { ...GV, duration: 5, referenceTaskType: "edit" }
    // 6 s in + 7 s out at the `-ref` rate, priced as one charge.
    const base = seedanceDraftFinalizeRefBaseCredits({ outputSec: 7, refVideoDurationsSec: [6] })
    expect(base).toBe(3088)
    expect(await finalizeQuote(graph({ type: "generate-video", data }, [6]))).toBe(applyServiceMarkup(base, settings.value as never, "seedance-2-5-hd:7s-ref"))
  })

  it("the balance check quotes the run estimate's figure", async () => {
    for (const [extra, clips] of [[{ duration: 5, referenceTaskType: "edit" }, [6]], [{ duration: VIDEO_DURATION_AUTO }, []]] as const) {
      const g = graph({ type: "generate-video", data: { ...GV, ...extra } }, clips)
      probe.durations = g.probed
      __forgetUploadClipLengths()
      const run = await estimateWorkflowCreditsDetailed(g.nodes, g.edges)
      __forgetUploadClipLengths()
      const balance = await estimateRunSetFigures(g.nodes, g.edges, new Set(g.nodes.map((n) => n.id)))
      expect(balance.hold).toBe(run.credits)
      expect(balance.credits).toBe(run.credits)
    }
  })

  it("the listing quotes the finalize as the draft's own listing reads its clips: an uploaded clip the app's user sends is not known yet", async () => {
    /** The listing's figure for the finalize: the graph's, less the graph's without it. */
    async function listedFinalize(g: Graph): Promise<number> {
      probe.durations = g.probed
      __forgetUploadClipLengths()
      const whole = (await estimateWorkflowListingCredits(g.nodes, g.edges, { publishType: "app" })).preview
      __forgetUploadClipLengths()
      const without = (await estimateWorkflowListingCredits(g.nodes.filter((n) => n.id !== "hd"), g.edges.filter((e) => e.target !== "hd"), { publishType: "app" })).preview
      return whole - without
    }
    const edit = { ...GV, duration: 5, referenceTaskType: "edit" }
    expect(await listedFinalize(graph({ type: "generate-video", data: edit }, [6]))).toBe(await finalizeQuote(graph({ type: "generate-video", data: edit }, ["unknown"])))
    const auto = { ...GV, duration: VIDEO_DURATION_AUTO }
    expect(await listedFinalize(graph({ type: "generate-video", data: auto }, []))).toBe(await finalizeQuote(graph({ type: "generate-video", data: auto }, [])))
  })
})

/**
 * A finalize never bills more output than its draft's run reserved (decided
 * 2026-11-12): billed output = min(the draft's take, the draft's hold), the
 * hold read off the draft's job by the one rule its quote reads
 * (`seedanceDraftHeldOutputSec`). The review's three inputs, which a take past
 * the hold used to charge above the quote.
 */
describe("a take past its draft's hold is billed at the hold, and the quote covers it", () => {
  it.each<[string, Record<string, unknown>, number[], number, { outputSec: number; base: number; creditId: string }]>([
    ["an edit draft of one 6 s clip with an 8 s take", { duration: 5, referenceTaskType: "edit" }, [6], 8, { outputSec: 7, base: 3088, creditId: "seedance-2-5-hd:7s-ref" }],
    ["a 5 s draft with no reference video and a 5.3 s take", { duration: 5 }, [], 5.3, { outputSec: 5, base: 1980, creditId: "seedance-2-5-hd:5s" }],
    ["a fixed 4 s reference draft (a 6 s clip) with a 9 s take, past max(duration, longest clip)", { duration: 4 }, [6], 9, { outputSec: 6, base: 2850, creditId: "seedance-2-5-hd:6s-ref" }],
  ])("%s", async (_name, extra, clips, take, held) => {
    settings.value = { cost_markup_percent: 0 }
    const data = { ...GV, ...extra }
    const row = draftRow("generate-video", data, clips, take)
    // Charged (and reserved, and estimated by a named draft: the same plan) at the hold…
    const plan = await resolveDraft(row)
    expect(plan).toMatchObject({ outputSec: held.outputSec, takeSec: seedanceDraftFinalizeBillableSec(take), creditId: held.creditId })
    expect(await seedanceDraftFinalizeChargedCredits(plan)).toBe(held.base)
    // …the workflow run's stamp reserves the same, and records the whole take for the provider's bill…
    const stamp = await seedanceDraftFinalizeStamp("video-upscale", { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER, sourceJobId: DRAFT_JOB }, USER)
    if (!stamp.ok) throw new Error(stamp.refusal.code)
    expect(stamp.patch).toMatchObject({ reservedCreditId: held.creditId, draftOutputSec: held.outputSec, draftTakeSec: seedanceDraftFinalizeBillableSec(take) })
    const stampedBase = await seedanceDraftFinalizeStampedBaseCredits("video-upscale", { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER, ...stamp.patch })
    expect(stampedBase ?? STATIC_CREDIT_COSTS[held.creditId]).toBe(held.base)
    const billed = await seedanceDraftFinalizeQueuedBilledSec(stamp.patch)
    expect(billed).toBe(seedanceDraftFinalizeBillableSec(take) + (clips.length > 0 ? clips.reduce((a, b) => a + b, 0) : 0))
    // …and the quote before the draft existed is at or above it.
    expect(await finalizeQuote(graph({ type: "generate-video", data }, clips))).toBeGreaterThanOrEqual(held.base)
  })

  it("a take within its hold is billed exactly as before the cap: the whole plan, as an edition without credits reads it", async () => {
    const cases: Array<[Record<string, unknown>, number[], number]> = [
      [{ duration: 5, referenceTaskType: "edit" }, [6], 6.04],
      [{ duration: 5, referenceTaskType: "edit" }, [6], 7.2],
      [{ duration: 5 }, [], 5.04],
      [{ duration: VIDEO_DURATION_AUTO }, [], 12.1],
      [{ duration: 4 }, [6], 4.04],
      [{ duration: 4 }, [6, 20], 20.2],
      [{ duration: 8, referenceTaskType: "extend" }, [3], 8],
    ]
    for (const [extra, clips, take] of cases) {
      const row = draftRow("generate-video", { ...GV, ...extra }, clips, take)
      const capped = await resolveDraft(row)
      edition.credits = false
      const uncapped = await resolveDraft(row)
      edition.credits = true
      expect(capped, `${JSON.stringify(extra)} [${clips.join(", ")}] take ${take}`).toStrictEqual(uncapped)
    }
  })

  it("a draft recorded before drafts could declare a task type reads as undeclared, as its run did", async () => {
    // An Auto-length draft with a 6 s clip and no recorded type: held as an undeclared Auto edit, 6 + 1 s.
    const auto = draftRow("generate-video", { ...GV, duration: VIDEO_DURATION_AUTO }, [6], 9)
    expect((await resolveDraft(auto)).outputSec).toBe(7)
    // A fixed 5 s one: the longer of 5 s and the clip.
    const fixed = draftRow("generate-video", { ...GV, duration: 5 }, [6], 9)
    expect((await resolveDraft(fixed)).outputSec).toBe(6)
  })

  it("a draft sent with no length was held at the model's default length: a 9 s take is billed at it, and the quote covers it", async () => {
    settings.value = { cost_markup_percent: 0 }
    const data = { ...GV, duration: undefined }
    expect(pricedOutputDurationSec(P, undefined)).toBe(8)
    const plan = await resolveDraft(draftRow("generate-video", data, [], 9))
    expect(plan).toMatchObject({ outputSec: 8, takeSec: 9, creditId: "seedance-2-5-hd:8s" })
    const charged = await seedanceDraftFinalizeChargedCredits(plan)
    expect(charged).toBe(STATIC_CREDIT_COSTS["seedance-2-5-hd:8s"])
    expect(await finalizeQuote(graph({ type: "generate-video", data }, []))).toBeGreaterThanOrEqual(charged)
  })

  it("a draft with reference clips whose job records no probe of them bills the take as before, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const base = draftRow("generate-video", { ...GV, duration: 5 }, [6], 9)
      const { refVideoDurationsSec: _p, ...noProbe } = base.input_data
      const plan = await resolveDraft({ ...base, input_data: noProbe })
      expect(plan.outputSec).toBe(9)
      expect(plan).not.toHaveProperty("takeSec")
      expect(warn.mock.calls.some((c) => String(c[0]).includes(DRAFT_JOB))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})

describe("never below the charge: every draft the run can make, by brute force", () => {
  // Every length the model accepts, Auto, and none set (the model's default).
  const DURATIONS: Array<number | undefined> = [...(MODEL_CATALOG[P]!.durations as readonly number[]), VIDEO_DURATION_AUTO, undefined]
  const CLIP_SHAPES: Clip[][] = [[], [2], [3], [4], [6], [20], [30], [6, 20], [10, 20], ["unknown"], [6, "unknown"]]
  /** Each type prices every accepted length × clip shape through the workflow estimate. */
  const BRUTE_FORCE_TIMEOUT_MS = 300_000

  it.each<[string, string | undefined]>([
    ["no task type", undefined],
    ["reference", "reference"],
    ["edit", "edit"],
    ["extend", "extend"],
  ])("Generate Video, %s: each length, fixed and Auto, each clip shape", async (_name, referenceTaskType) => {
    const charged = new Map<string, number>()
    let cases = 0
    for (const duration of DURATIONS) {
      const data = { ...GV, duration, ...(referenceTaskType ? { referenceTaskType } : {}) }
      for (const clips of CLIP_SHAPES) {
        const runs = concreteClips(clips)
        if (runs.length === 0) continue
        const quote = await finalizeQuote(graph({ type: "generate-video", data }, clips))
        for (const run of runs) {
          const key = `${duration}|${run.join(",")}`
          const charge = charged.get(key) ?? (await mostCharged("generate-video", data, run))
          charged.set(key, charge)
          expect(quote, `${referenceTaskType ?? "none"}, ${duration}, clips [${clips.join(", ")}] delivered as [${run.join(", ")}]`).toBeGreaterThanOrEqual(charge)
        }
        cases++
      }
    }
    expect(cases).toBe(DURATIONS.length * CLIP_SHAPES.length)
  }, BRUTE_FORCE_TIMEOUT_MS)

  it("Video to Video's Seedance 2.5 Edit lane as a draft: each clip, an unknown one too", async () => {
    const data = { provider: P, prompt: "make it a watercolour", v2vResolution: "480p", draft: true }
    for (const clips of [[2], [3], [4], [6], [20], [30], ["unknown"]] as Clip[][]) {
      const quote = await finalizeQuote(graph({ type: "video-to-video", data }, clips))
      for (const run of concreteClips(clips)) {
        expect(quote, `clip [${clips.join(", ")}] delivered as [${run.join(", ")}]`).toBeGreaterThanOrEqual(await mostCharged("video-to-video", data, run))
      }
      // A known clip: exactly the finalize of the draft's longest take.
      if (clips[0] !== "unknown") expect(quote).toBe(await mostCharged("video-to-video", data, clips as number[]))
    }
  }, BRUTE_FORCE_TIMEOUT_MS)
})

describe("anything else is priced as before", () => {
  /** What the finalize was quoted at before: the bare `seedance-2-5-hd` row, marked up. */
  const bareRow = () => applyServiceMarkup(STATIC_CREDIT_COSTS[SEEDANCE_DRAFT_FINALIZE_PROVIDER]!, settings.value as never, SEEDANCE_DRAFT_FINALIZE_PROVIDER)

  it("a finalize with no draft wired: its row, as before", async () => {
    expect((await estimateWorkflowCreditsDetailed([FINALIZE], [])).perNode.hd!.credits).toBe(bareRow())
  })

  it("a finalize wired to a video that is no draft (Draft off, another model, an upload): its row", async () => {
    for (const draft of [
      { type: "generate-video" as const, data: { ...GV, draft: false, duration: 5 } },
      { type: "generate-video" as const, data: { ...GV, provider: "kling", duration: 5 } },
    ]) {
      expect(await finalizeQuote(graph(draft, [6]))).toBe(bareRow())
    }
    const upload = { nodes: [{ id: "up", type: "upload-video", data: { url: clipUrl(0, 6) } }, FINALIZE], edges: [{ source: "up", target: "hd", sourceHandle: "video", targetHandle: "video" }] }
    expect((await estimateWorkflowCreditsDetailed(upload.nodes, upload.edges)).perNode.hd!.credits).toBe(bareRow())
  })

  it("a draft that already exists and does not run again: the finalize re-renders it, priced as before (the node asks its exact price)", async () => {
    const data = { ...GV, duration: VIDEO_DURATION_AUTO, generatedResults: [{ url: "https://cdn.example/draft.mp4" }], kieTaskId: "task-draft" }
    const g = graph({ type: "generate-video", data }, [])
    const lone = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]))
    expect(lone.credits).toBe(bareRow())
    // A whole run makes a new draft: the reserved length.
    expect(await finalizeQuote(g)).toBe(applyServiceMarkup(11850, settings.value as never, "seedance-2-5-hd:30s"))
  })

  it("a finalize that names its own draft (kieTaskId): its row", async () => {
    const g = graph({ type: "generate-video", data: { ...GV, duration: VIDEO_DURATION_AUTO } }, [])
    const named = { ...g, nodes: g.nodes.map((n) => (n.id === "hd" ? { ...n, data: { ...n.data, kieTaskId: "task-elsewhere" } } : n)) }
    expect(await finalizeQuote(named)).toBe(bareRow())
  })

  it("every other node is priced exactly as without the finalize", async () => {
    const data = { ...GV, duration: 5, referenceTaskType: "edit" }
    const g = graph({ type: "generate-video", data }, [6])
    const others = [
      { id: "topaz", type: "video-upscale", data: {} },
      { id: "nodaro", type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: "1080p" } },
      { id: "veo", type: "video-upscale", data: { provider: "veo-1080p" } },
    ]
    const otherEdges = others.map((o) => ({ source: "draft", target: o.id, sourceHandle: "video", targetHandle: "video" }))
    probe.durations = g.probed
    __forgetUploadClipLengths()
    const withFinalize = await estimateWorkflowCreditsDetailed([...g.nodes, ...others], [...g.edges, ...otherEdges])
    __forgetUploadClipLengths()
    const without = await estimateWorkflowCreditsDetailed([...g.nodes.filter((n) => n.id !== "hd"), ...others], [...g.edges.filter((e) => e.target !== "hd"), ...otherEdges])
    const { hd: _hd, ...rest } = withFinalize.perNode
    expect(rest).toStrictEqual(without.perNode)
    for (const node of [...g.nodes.filter((n) => n.id !== "hd"), ...others]) {
      expect(seedanceFinalizeDraftQuote(node, g.nodes, g.edges, new Set(g.nodes.map((n) => n.id))), node.id).toBeUndefined()
    }
  })
})

/**
 * A run that only finalizes a draft that already exists (decided 2026-11-12):
 * the run-set estimates (a Render final, an app's Retry and its fallback)
 * price that finalize exactly, as its own gate prices the draft — the figure
 * `POST /v1/credits/seedance-hd-estimate` answers for its task id — never at
 * the provider's bare row.
 */
describe("a run that only finalizes a draft that already exists: its exact price", () => {
  const TASK = "task-existing"
  /** An Auto draft (Generate Video, no reference video) that has run: its result and its task are on the node. */
  const madeDraft = { type: "generate-video" as const, data: { ...GV, duration: VIDEO_DURATION_AUTO, generatedResults: [{ url: "https://cdn.example/draft.mp4" }], kieTaskId: TASK } }
  /** Its job: a 12.1 s take, so the exact price is the 12 s row — far from both the 8 s and the 30 s ones. */
  const madeRow = () => ({ ...draftRow("generate-video", { ...GV, duration: VIDEO_DURATION_AUTO }, [], 12.1), provider_task_id: TASK })

  it("estimateRunSetFigures with only the finalize: the exact price, the hold included", async () => {
    db.draft = madeRow()
    const g = graph(madeDraft, [])
    const exact = await seedanceDraftFinalizeChargedCredits(await resolveDraft(madeRow()))
    expect(exact).toBe(applyServiceMarkup(STATIC_CREDIT_COSTS["seedance-2-5-hd:12s"]!, settings.value as never, "seedance-2-5-hd:12s"))
    const lone = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
    expect(lone).toStrictEqual({ credits: exact, hold: exact })
  })

  it("an app's Retry of only the finalize: the task its state in the failed run recorded, priced exactly", async () => {
    db.draft = madeRow()
    // The app's snapshot: the draft node holds neither a result nor a task; the failed run's state does.
    const g = graph({ type: "generate-video", data: { ...GV, duration: VIDEO_DURATION_AUTO } }, [])
    const retry = await appRunResumeCredits({
      caller: { userId: USER },
      nodes: g.nodes,
      edges: g.edges,
      runNodeIds: new Set(["hd"]),
      sourceStates: { draft: { status: "completed", output: { kieTaskId: TASK } } },
      runKey: "run-1",
    })
    expect(retry.credits).toBe(await seedanceDraftFinalizeChargedCredits(await resolveDraft(madeRow())))
  })

  it("the estimate route's answer for the same task id is the same figure", async () => {
    db.draft = madeRow()
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    registerSeedanceHdEstimate(app)
    await app.ready()
    try {
      const res = await app.inject({ method: "POST", url: "/v1/credits/seedance-hd-estimate", payload: { taskId: TASK } })
      const g = graph(madeDraft, [])
      const lone = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
      expect(res.json()).toStrictEqual({ data: { credits: lone.credits, minimum: false } })
    } finally {
      await app.close()
    }
  })

  it("a node that made a draft and then had Draft turned off still hands on that take: priced exactly, as the run finalizes it", async () => {
    db.draft = madeRow()
    const turnedOff = { type: "generate-video" as const, data: { ...madeDraft.data, draft: false } }
    const g = graph(turnedOff, [])
    const lone = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
    expect(lone.credits).toBe(await seedanceDraftFinalizeChargedCredits(await resolveDraft(madeRow())))
    // …and a take that is no draft is refused by the finalize's gate, as the run refuses it: priced as before.
    db.draft = { ...madeRow(), input_data: { ...madeRow().input_data, draft: false } }
    const refused = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
    expect(refused.credits).toBe(applyServiceMarkup(STATIC_CREDIT_COSTS[SEEDANCE_DRAFT_FINALIZE_PROVIDER]!, settings.value as never, SEEDANCE_DRAFT_FINALIZE_PROVIDER))
  })

  it("a Render final / continue-from-failed prices the task the continued run finalizes: its seeded state's, not the saved node's", async () => {
    db.draft = madeRow()
    // The saved graph's draft node still holds an older take, from an earlier editor run.
    const saved = graph({ type: "generate-video", data: { ...madeDraft.data, kieTaskId: "task-older" } }, [])
    const price = (continuation?: Parameters<typeof renderFinalCredits>[0]["continuation"]) => renderFinalCredits({
      userId: USER, nodes: saved.nodes, edges: saved.edges, runNodeIds: ["hd"], overrides: undefined, surface: {},
      ...(continuation ? { continuation } : {}),
    })
    let reads = 0
    const continued = await price({
      sentOverrides: undefined,
      source: async () => {
        reads++
        return { id: "exec-1", userId: USER, workflowId: "wf-1", status: "failed", appVersionId: null, nodeStates: { draft: { status: "completed", output: { kieTaskId: TASK } } } } as never
      },
    })
    expect(continued!.estimatedCredits).toBe(await seedanceDraftFinalizeChargedCredits(await resolveDraft(madeRow())))
    expect(reads).toBe(1)
    // Without the continuation's states, the saved node's older task is named — not this user's draft here, so priced as before.
    const bare = applyServiceMarkup(STATIC_CREDIT_COSTS[SEEDANCE_DRAFT_FINALIZE_PROVIDER]!, settings.value as never, SEEDANCE_DRAFT_FINALIZE_PROVIDER)
    expect((await price())!.estimatedCredits).toBe(bare)
  })

  it("a draft the gate refuses (not found, another user's) is priced as before: the run refuses it, nothing is charged", async () => {
    const g = graph(madeDraft, [])
    const bare = applyServiceMarkup(STATIC_CREDIT_COSTS[SEEDANCE_DRAFT_FINALIZE_PROVIDER]!, settings.value as never, SEEDANCE_DRAFT_FINALIZE_PROVIDER)
    for (const row of [null, { ...madeRow(), user_id: "someone-else" }]) {
      db.draft = row
      const lone = await estimateRunSetFigures(g.nodes, g.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
      expect(lone.credits).toBe(bare)
    }
  })
})

/**
 * The editor's Run total for a finalize of a draft with reference videos is
 * the server's quote of the request the editor sends for it
 * (`POST /v1/credits/seedance-hd-estimate`, `plannedDraft`). The graph and
 * that request are one shared fixture (`seedance-hd-draft-quote.json`); the
 * editor's half — frontend/src/lib/__tests__/seedance-hd-quote.test.ts —
 * holds the editor's request for the same graph to `editorPlannedDrafts`.
 */
describe("the editor's request for a draft with a reference video: the route quotes the workflow estimate's figure", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/__tests__/fixtures/seedance-hd-draft-quote.json")
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    clipSec: number
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
    edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string }>
    editorPlannedDrafts: Record<string, Record<string, unknown>>
    existingDraftTaskId: string
  }
  const clip = fixture.nodes.find((n) => n.type === "upload-video")!

  async function routeQuote(body: Record<string, unknown>) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    registerSeedanceHdEstimate(app)
    await app.ready()
    try {
      probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
      const res = await app.inject({ method: "POST", url: "/v1/credits/seedance-hd-estimate", payload: body })
      expect(res.statusCode, res.body).toBe(200)
      return res.json() as { data: { credits: number; minimum: boolean } }
    } finally {
      await app.close()
    }
  }

  it.each(["hd", "hd-v2v"])("%s: the route's quote of the editor's request = the workflow estimate = the finalize of the draft's longest take", async (finalizeId) => {
    probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
    __forgetUploadClipLengths()
    const estimate = (await estimateWorkflowCreditsDetailed(fixture.nodes, fixture.edges)).perNode[finalizeId]!.credits
    const draftId = fixture.edges.find((e) => e.target === finalizeId)!.source
    const draft = fixture.nodes.find((n) => n.id === draftId)!
    const type = draft.type as "generate-video" | "video-to-video"
    expect(estimate).toBe(await mostCharged(type, draft.data, [fixture.clipSec]))
    expect(await routeQuote({ plannedDraft: fixture.editorPlannedDrafts[finalizeId] })).toStrictEqual({ data: { credits: estimate, minimum: false } })
  })

  it("a clip the draft's run would refuse is refused with the run's own 400 video_too_long, and nothing is priced", async () => {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    registerSeedanceHdEstimate(app)
    await app.ready()
    try {
      const url = "https://cdn.example/too-long.mp4"
      probe.durations = new Map([[url, LIMITS.maxSec + 1]])
      const res = await app.inject({ method: "POST", url: "/v1/credits/seedance-hd-estimate", payload: { plannedDraft: { provider: P, referenceVideoUrls: [url] } } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("video_too_long")
    } finally {
      await app.close()
    }
  })

  it("hd run alone: its draft exists, and the route's answer for the task the editor names equals the server's run-set estimate", async () => {
    const gv = fixture.nodes.find((n) => n.id === "gv")!
    expect(gv.data.kieTaskId).toBe(fixture.existingDraftTaskId)
    db.draft = { ...draftRow("generate-video", gv.data, [fixture.clipSec], 6.04), provider_task_id: fixture.existingDraftTaskId }
    probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
    __forgetUploadClipLengths()
    const lone = await estimateRunSetFigures(fixture.nodes, fixture.edges, new Set(["hd"]), undefined, undefined, undefined, { priceOf: existingDraftFinalizePricer(USER) })
    expect(await routeQuote({ taskId: fixture.existingDraftTaskId })).toStrictEqual({ data: { credits: lone.credits, minimum: false } })
    expect(lone.credits).toBe(await seedanceDraftFinalizeChargedCredits(await resolveDraft(db.draft)))
  })

  it("a draft with no reference video: the route's quote is the finalize row the editor reads by id", async () => {
    for (const duration of [5, VIDEO_DURATION_AUTO, undefined]) {
      const g = graph({ type: "generate-video", data: { ...GV, duration } }, [])
      const estimate = await finalizeQuote(g)
      const { data } = await routeQuote({ plannedDraft: { provider: P, resolution: "480p", ...(duration !== undefined ? { duration } : {}), draft: true } })
      expect(data, String(duration)).toStrictEqual({ credits: estimate, minimum: false })
    }
  })
})
