// @test-units-by-name prices the node types it names (upload-video, generate-video)
// @test-watches backend/src/lib/__tests__/fixtures/seedance-reference-auto-quote.json backend/src/lib/__tests__/fixtures/seedance-draft-edit-quote.json
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { SEEDANCE_EDIT_REF_VIDEO_SEC, VIDEO_REF_VIDEO_DURATION_LIMITS, checkRefVideoDurations, pricedOutputDurationSec } from "@nodaro/shared/models"
import { videoGenerationCreditId } from "@nodaro/shared/credits"

/**
 * A Generate Video node that declares a Seedance 2.5 reference task type is
 * priced by the server's workflow estimate (the run estimate and the
 * published-app listing) at the run that is SENT: the declaration moves the
 * length (`edit` runs at Auto, `extend` fixes an Auto length), and the run
 * reserves for the moved length. Every figure below is held to what the run
 * reserves for the same request — `/v1/generate-video`'s own pricing (its
 * pre-checks, its id, `reservedCreditsFor`), which a workflow run reserves too.
 * The estimate may over-quote; it must never under-quote.
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
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } }
})
// Route modules that reach the queue must not open a Redis connection.
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
const settings = vi.hoisted(() => ({ value: { cost_markup_percent: 40 } as Record<string, unknown> }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => settings.value }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { estimateWorkflowCreditsDetailed } from "../credits.js"
import { seedance2RefVideoChargedHoldQuote, seedance2RefVideoChargedQuote } from "../seedance2-ref-video-quote.js"
import { refVideoWorstCaseSecFor, seedance2RefVideoBaseCreditsFromDurations, seedance2RefVideoHeldOutputSec } from "../seedance2-ref-video-credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { __forgetUploadClipLengths } from "../upload-clip-lengths.js"
import { reservedCreditsFor } from "../../lib/credit-guard-impl.js"
import { registerSeedanceRefEstimate } from "../../routes/seedance-ref-estimate.js"
import { generateVideoPricing } from "../../../routes/generate-video.js"
import { generatedVideoLengthSec } from "../../../lib/generated-video-length.js"
import { stampSeedanceReferenceTaskType } from "../../../lib/seedance-task-type-stamp.js"

const CLIP = "https://cdn.example/ref.mp4"
const UNREADABLE = "https://cdn.example/unreadable.mp4"
const GV = { provider: "seedance-2-5", prompt: "make it black and white", aspectRatio: "16:9", duration: 5, resolution: "720p" }
const upload = (url = CLIP) => ({ id: "clip", type: "upload-video", data: { url } })
const gvNode = (extra: Record<string, unknown> = {}) => ({ id: "gv", type: "generate-video", data: { ...GV, ...extra } })
const wires = [{ source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }]

/** The workflow estimate of a Generate Video node fed one uploaded clip `sec` long. */
async function estimate(extra: Record<string, unknown>, sec: number) {
  probe.durations = new Map([[CLIP, sec]])
  __forgetUploadClipLengths()
  return estimateWorkflowCreditsDetailed([upload(), gvNode(extra)], wires)
}

/**
 * `/v1/generate-video`'s own pricing — its pre-checks, its id and the
 * reservation (`reservedCreditsFor`) — as one app, so a test that prices many
 * runs builds it once. `reserves` takes one clip length (sent as {@link CLIP},
 * as before) or several (one URL per clip, named by its place and length, so no
 * probe of one run is read for another).
 */
async function runPricer() {
  const app = Fastify({ logger: false })
  app.post("/price", { preHandler: [...generateVideoPricing.prechecks] }, async (req) => {
    const identifier = generateVideoPricing.modelResolver(req)
    return { credits: await reservedCreditsFor(req, identifier, generateVideoPricing.opts) }
  })
  await app.ready()
  return {
    async reserves(extra: Record<string, unknown>, secs: number | readonly number[]): Promise<number> {
      const clips = typeof secs === "number" ? [[CLIP, secs] as const] : secs.map((sec, i) => [`https://cdn.example/ref-${i}-${sec}.mp4`, sec] as const)
      probe.durations = new Map(clips)
      const res = await app.inject({ method: "POST", url: "/price", payload: { ...GV, ...extra, referenceVideoUrls: clips.map(([url]) => url) } })
      expect(res.statusCode, res.body).toBe(200)
      return (res.json() as { credits: number }).credits
    },
    close: () => app.close(),
  }
}

/** What a run of the same request reserves: `/v1/generate-video`'s pre-checks, id and reservation. */
async function runReserves(extra: Record<string, unknown>, secs: number | readonly number[]): Promise<number> {
  const pricer = await runPricer()
  try {
    return await pricer.reserves(extra, secs)
  } finally {
    await pricer.close()
  }
}

beforeEach(() => {
  settings.value = { cost_markup_percent: 40 }
})

describe("the workflow estimate prices a declared Seedance 2.5 node at the run that is sent", () => {
  it("edit, stored 5 s at 16:9, a 6 s clip: the run's Auto-length hold", async () => {
    const asked = await estimate({ referenceTaskType: "edit" }, 6)
    expect(asked.perNode.gv!.credits).toBe(await runReserves({ referenceTaskType: "edit" }, 6))
    // …which is not the stored length's price.
    expect(asked.perNode.gv!.credits).not.toBe((await estimate({}, 6)).perNode.gv!.credits)
  })

  it("edit with a 3 s clip declares nothing: exactly the node without the setting", async () => {
    const asked = await estimate({ referenceTaskType: "edit" }, 3)
    expect(asked).toStrictEqual(await estimate({}, 3))
    expect(asked.perNode.gv!.credits).toBe(await runReserves({ referenceTaskType: "edit" }, 3))
  })

  it.each([4, 2])("extend, stored Auto, a %s s clip: the 8 s run's reservation", async (sec) => {
    const extra = { referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO }
    const asked = await estimate(extra, sec)
    expect(asked.perNode.gv!.credits).toBe(await runReserves(extra, sec))
    expect(asked.perNode.gv!.credits).toBeGreaterThan((await estimate({ duration: VIDEO_DURATION_AUTO }, sec)).perNode.gv!.credits)
  })

  it.each<[string, Record<string, unknown>]>([
    ["extend at a stored 5 s", { referenceTaskType: "extend" }],
    ["reference", { referenceTaskType: "reference" }],
    ['"auto"', { referenceTaskType: "auto" }],
    ["a bogus value", { referenceTaskType: "bogus" }],
  ])("%s: unchanged", async (_name, extra) => {
    expect(await estimate(extra, 6)).toStrictEqual(await estimate({}, 6))
  })

  it("a draft edit: the run's Auto-length hold, at the draft's 480p — as the same node without Draft at 480p", async () => {
    const asked = await estimate({ draft: true, referenceTaskType: "edit" }, 6)
    expect(asked.perNode.gv!.credits).toBe(await runReserves({ draft: true, referenceTaskType: "edit" }, 6))
    expect(asked.perNode.gv!.credits).not.toBe((await estimate({ draft: true }, 6)).perNode.gv!.credits)
    expect(asked).toStrictEqual(await estimate({ referenceTaskType: "edit", resolution: "480p" }, 6))
  })

  it("a model that takes no task type: unchanged", async () => {
    const other = { provider: "seedance-2", duration: 8 }
    expect(await estimate({ ...other, referenceTaskType: "edit" }, 6)).toStrictEqual(await estimate(other, 6))
  })

  it("an unreadable uploaded clip: the run declares nothing (unmeasured), and neither does the estimate", async () => {
    __forgetUploadClipLengths()
    probe.durations = new Map()
    const asked = await estimateWorkflowCreditsDetailed([upload(UNREADABLE), gvNode({ referenceTaskType: "edit" })], wires)
    __forgetUploadClipLengths()
    expect(asked).toStrictEqual(await estimateWorkflowCreditsDetailed([upload(UNREADABLE), gvNode()], wires))
  })
})

describe("a clip whose length is not known yet is quoted as if the declaration holds, at the worst case", () => {
  it("every model that lists edit has a worst-case clip inside the edit's lengths", () => {
    const editModels = Object.entries(MODEL_CATALOG).filter(([, m]) => m.referenceTaskTypes?.includes("edit")).map(([id]) => id)
    expect(editModels.length).toBeGreaterThan(0)
    for (const id of editModels) {
      const worst = refVideoWorstCaseSecFor(id)
      expect(worst, id).toBeGreaterThanOrEqual(SEEDANCE_EDIT_REF_VIDEO_SEC.min)
      expect(worst, id).toBeLessThanOrEqual(SEEDANCE_EDIT_REF_VIDEO_SEC.max)
    }
  })

  it("edit with an unknown clip: never below the run's reservation for any clip from 4 to 30 s", async () => {
    const unknown = await seedance2RefVideoChargedQuote({
      provider: "seedance-2-5", resolution: "720p", duration: 5, referenceTaskType: "edit", durationsSec: [], unknownClips: 1,
    })
    expect(unknown.exact).toBe(false)
    for (const sec of [4, 4.5, 6, 10.04, 15, 29.5, 30]) {
      expect(unknown.credits, `${sec} s`).toBeGreaterThanOrEqual(await runReserves({ referenceTaskType: "edit" }, sec))
    }
  })
})

describe("the quote's min is the least a run can cost while a clip is not produced yet, and its credits the most", () => {
  const PROVIDER = "seedance-2-5"
  const LIMITS = VIDEO_REF_VIDEO_DURATION_LIMITS[PROVIDER]!
  /** Each case prices every accepted run through the route (about 30 requests). */
  const BRUTE_FORCE_TIMEOUT_MS = 60_000

  /** The quote of `request` with its one unknown clip at `sec` — every clip known, what that run reserves. */
  const knownQuote = (request: QuoteRequest, sec: number) =>
    seedance2RefVideoChargedQuote({ ...request, durationsSec: [...request.durationsSec, sec], unknownClips: 0 })

  /**
   * Every run that can happen, by brute force: the unknown clip at each
   * whole-second length within the provider's per-clip bounds that the run's
   * own gate (`checkRefVideoDurations`, the clips' total included) accepts —
   * a run the gate refuses never reserves. Asserts the quote's `credits` (the
   * most the run can reserve) is at least what each run RESERVES — the run's
   * own pricing (`runPricer`: the route's pre-checks, id and reservation), not
   * the quote function — and returns the true floor: the cheapest of them, by
   * the quote of that run with every clip known.
   */
  async function trueFloorHoldingCeiling(request: QuoteRequest, credits: number): Promise<number> {
    const pricer = await runPricer()
    // The run of the same request: its stored length and task type, and every clip.
    const run = { duration: request.duration, ...(request.referenceTaskType !== undefined ? { referenceTaskType: request.referenceTaskType } : {}) }
    let floor = Number.POSITIVE_INFINITY
    let runs = 0
    try {
      for (let sec = LIMITS.minSec; sec <= LIMITS.maxSec; sec++) {
        const clips = [...request.durationsSec, sec]
        if (!checkRefVideoDurations(PROVIDER, clips).ok) continue
        const reserved = await pricer.reserves(run, clips)
        expect(credits, `clips [${clips.join(", ")}], stored ${String(request.duration)}, task type ${String(request.referenceTaskType)}: the run reserves ${reserved}`).toBeGreaterThanOrEqual(reserved)
        floor = Math.min(floor, (await knownQuote(request, sec)).credits)
        runs++
      }
    } finally {
      await pricer.close()
    }
    expect(runs).toBeGreaterThan(0)
    return floor
  }

  type QuoteRequest = Parameters<typeof seedance2RefVideoChargedQuote>[0]
  const base = { provider: PROVIDER, resolution: "720p" } as const

  it.each<[string, QuoteRequest]>([
    ["edit, one unknown clip, stored 5 s", { ...base, duration: 5, referenceTaskType: "edit", durationsSec: [], unknownClips: 1 }],
    ["edit, one unknown clip, stored 15 s", { ...base, duration: 15, referenceTaskType: "edit", durationsSec: [], unknownClips: 1 }],
    ["edit, a known 6 s clip and one unknown, stored 5 s", { ...base, duration: 5, referenceTaskType: "edit", durationsSec: [6], unknownClips: 1 }],
    ["extend, one unknown clip, stored Auto", { ...base, duration: VIDEO_DURATION_AUTO, referenceTaskType: "extend", durationsSec: [], unknownClips: 1 }],
    ["extend, one unknown clip, stored 5 s", { ...base, duration: 5, referenceTaskType: "extend", durationsSec: [], unknownClips: 1 }],
  ])("%s: min is the true floor, and credits is never below a run that can happen", async (_name, request) => {
    const quote = await seedance2RefVideoChargedQuote({ ...request, durationsSec: [...request.durationsSec] })
    expect(quote.exact).toBe(false)
    expect(quote.min).toBe(await trueFloorHoldingCeiling(request, quote.credits))
    expect(quote.min).toBeLessThanOrEqual(quote.credits)
  }, BRUTE_FORCE_TIMEOUT_MS)

  it.each<[string, Record<string, unknown>]>([
    ["no task type", {}],
    ['"auto"', { referenceTaskType: "auto" }],
  ])("%s: min is every unknown clip at the shortest length, as before, and credits is never below a run", async (_name, extra) => {
    const request = { ...base, duration: 5, durationsSec: [6], unknownClips: 1, referenceTaskType: undefined, ...extra } as QuoteRequest
    const quote = await seedance2RefVideoChargedQuote(request)
    expect(quote).toStrictEqual({
      credits: quote.credits,
      min: (await knownQuote(request, LIMITS.minSec)).credits,
      exact: false,
    })
    expect(quote.min).toBe(await trueFloorHoldingCeiling(request, quote.credits))
  }, BRUTE_FORCE_TIMEOUT_MS)
})

describe("the quote route's request: a declared task type is priced at the run it sends", () => {
  it("the charged quote with a measured 6 s clip equals the run's reservation", async () => {
    const quote = await seedance2RefVideoChargedQuote({
      provider: "seedance-2-5", resolution: "720p", duration: 5, referenceTaskType: "edit", durationsSec: [6], unknownClips: 0,
    })
    expect(quote).toStrictEqual({ credits: await runReserves({ referenceTaskType: "edit" }, 6), min: quote.credits, exact: true })
  })

  it("the hold quote (measured clips) holds what the run reserves, and expects the edit's own length", async () => {
    const asked = await seedance2RefVideoChargedHoldQuote({ provider: "seedance-2-5", resolution: "720p", duration: 5, referenceTaskType: "edit", durationsSec: [6] })
    const shaped = await seedance2RefVideoChargedHoldQuote({ provider: "seedance-2-5", resolution: "720p", duration: VIDEO_DURATION_AUTO, durationsSec: [6] })
    expect(asked.hold).toBe(await runReserves({ referenceTaskType: "edit" }, 6))
    expect(asked).toStrictEqual(shaped)
  })

  it.each(["edit", "extend", "reference"])("a draft %s: both quotes are the same request's without Draft at 480p, and the charged one is the run's reservation", async (referenceTaskType) => {
    const plain = { provider: "seedance-2-5", resolution: "480p", duration: 5, referenceTaskType }
    const draft = { ...plain, resolution: "720p", draft: true }
    expect(await seedance2RefVideoChargedQuote({ ...draft, durationsSec: [6], unknownClips: 1 }))
      .toStrictEqual(await seedance2RefVideoChargedQuote({ ...plain, durationsSec: [6], unknownClips: 1 }))
    expect(await seedance2RefVideoChargedHoldQuote({ ...draft, durationsSec: [6] }))
      .toStrictEqual(await seedance2RefVideoChargedHoldQuote({ ...plain, durationsSec: [6] }))
    const exact = await seedance2RefVideoChargedQuote({ ...draft, durationsSec: [6], unknownClips: 0 })
    expect(exact).toStrictEqual({ credits: await runReserves({ draft: true, referenceTaskType }, 6), min: exact.credits, exact: true })
  })

  it.each<[string, Record<string, unknown>]>([
    ["absent", {}],
    ['"auto"', { referenceTaskType: "auto" }],
    ["bogus", { referenceTaskType: "bogus" }],
  ])("%s: both quotes are today's", async (_name, extra) => {
    const base = { provider: "seedance-2-5", resolution: "720p", duration: 5, draft: extra.draft === true }
    const req = { ...base, referenceTaskType: extra.referenceTaskType }
    expect(await seedance2RefVideoChargedQuote({ ...req, durationsSec: [6], unknownClips: 1 }))
      .toStrictEqual(await seedance2RefVideoChargedQuote({ ...base, referenceTaskType: undefined, durationsSec: [6], unknownClips: 1 }))
    expect(await seedance2RefVideoChargedHoldQuote({ ...req, durationsSec: [6] }))
      .toStrictEqual(await seedance2RefVideoChargedHoldQuote({ ...base, durationsSec: [6] }))
  })
})

describe("the length a declared generation forwards to the step after it", () => {
  /** The output seconds a run of `data` with one `sec` clip holds, by the run's own stamp and hold rule. */
  function runHeldOutputSec(data: Record<string, unknown>, sec: number): number {
    const sent = stampSeedanceReferenceTaskType({ ...data, referenceVideoUrls: [CLIP] }, [sec])
    return seedance2RefVideoHeldOutputSec({
      provider: "seedance-2-5",
      outputDurationSec: pricedOutputDurationSec("seedance-2-5", sent.duration as number),
      requestedDuration: sent.duration,
      // The run's hold reads the type it resolved (the stamp's), as every hold site does.
      referenceTaskType: sent.referenceTaskType,
      durationsSec: [sec],
    })
  }

  it.each<[string, Record<string, unknown>]>([
    ["edit at a stored 5 s", { referenceTaskType: "edit" }],
    ["extend at a stored Auto", { referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO }],
  ])("%s: never below the run's held output for any clip from 4 to 30 s", (_name, extra) => {
    const data = { ...GV, ...extra }
    const forwarded = generatedVideoLengthSec({ type: "generate-video", data })!
    for (let sec = 4; sec <= 30; sec++) {
      expect(forwarded, `${sec} s`).toBeGreaterThanOrEqual(runHeldOutputSec(data, sec))
    }
    // Nor below the run that declares nothing (no clip wired after all).
    expect(forwarded).toBeGreaterThanOrEqual(generatedVideoLengthSec({ type: "generate-video", data: { ...GV, duration: extra.duration ?? GV.duration } })!)
  })

  it.each<[string, Record<string, unknown>]>([
    ["edit at a stored 5 s", { referenceTaskType: "edit" }],
    ["extend at a stored Auto", { referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO }],
    ["reference", { referenceTaskType: "reference" }],
  ])("a draft %s forwards the length the same node without Draft forwards", (_name, extra) => {
    for (const type of ["generate-video", "image-to-video", "text-to-video"]) {
      const data = { ...GV, ...extra }
      expect(generatedVideoLengthSec({ type, data: { ...data, draft: true } }), type).toBe(generatedVideoLengthSec({ type, data }))
    }
  })

  it.each<[string, Record<string, unknown>]>([
    ["absent", {}],
    ["bogus", { referenceTaskType: "bogus" }],
    ["reference", { referenceTaskType: "reference" }],
    ["extend at a stored 5 s", { referenceTaskType: "extend" }],
    ["a model that takes none", { referenceTaskType: "edit", provider: "seedance-2", duration: 8 }],
  ])("%s: the forwarded length is today's", (_name, extra) => {
    for (const type of ["generate-video", "image-to-video", "text-to-video"]) {
      const { referenceTaskType: _t, ...plain }: Record<string, unknown> = { ...GV, ...extra }
      expect(generatedVideoLengthSec({ type, data: { ...GV, ...extra } }), type).toBe(generatedVideoLengthSec({ type, data: plain }))
    }
  })
})

/**
 * Where the node's setting meets the hold rule: a Generate Video node with
 * **A reference** chosen and Duration on Auto declares `reference` with an
 * automatic length, which the run holds at the model's longest output (a
 * reference renders a length the model picks, not its clip's) and charges what
 * it makes. The workflow estimate of that node, and the estimate route's quote
 * of the request the editor sends for it, are what the run reserves.
 *
 * The node, its clip and the editor's request are one shared fixture
 * (`seedance-reference-auto-quote.json`); the editor's half —
 * frontend/src/lib/__tests__/seedance-ref-quote.test.ts — holds the editor's
 * `seedanceRefQuoteRequest` for the same node to `editorRequest`.
 */
describe("A reference with Duration on Auto: the workflow estimate and the editor's quote are the worst case the run reserves", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/__tests__/fixtures/seedance-reference-auto-quote.json")
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    clipSec: number
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
    edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string }>
    editorRequest: Record<string, unknown>
  }
  const gv = fixture.nodes.find((n) => n.type === "generate-video")!
  const clip = fixture.nodes.find((n) => n.type === "upload-video")!
  const provider = gv.data.provider as string
  const resolution = gv.data.resolution as string
  const undeclared = (() => {
    const { referenceTaskType: _declared, ...rest } = gv.data
    return rest
  })()

  /** The server's workflow estimate of the fixture's graph, with `data` on its Generate Video node. */
  async function workflowEstimate(data: Record<string, unknown>) {
    probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
    __forgetUploadClipLengths()
    const nodes = fixture.nodes.map((n) => (n.id === gv.id ? { ...n, data } : n))
    return (await estimateWorkflowCreditsDetailed(nodes, fixture.edges)).perNode[gv.id]!.credits
  }

  /** The estimate route's answer to `body` — what the editor's node price and Run button show. */
  async function routeQuote(body: Record<string, unknown>) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => { req.userId = "user-a" })
    registerSeedanceRefEstimate(app)
    await app.ready()
    try {
      probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
      const res = await app.inject({ method: "POST", url: "/v1/credits/seedance-ref-estimate", payload: body })
      expect(res.statusCode, res.body).toBe(200)
      return (res.json() as { data: { credits: number; min: number; exact: boolean } }).data
    } finally {
      await app.close()
    }
  }

  it("the run holds the model's longest output, not the edit's clip-plus-a-second", () => {
    // The fixture's clip is the one `runReserves` sends, so the run is priced on the node's own clip.
    expect(clip.data.url).toBe(CLIP)
    const hold = (referenceTaskType: unknown) => seedance2RefVideoHeldOutputSec({
      provider,
      outputDurationSec: pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO),
      requestedDuration: VIDEO_DURATION_AUTO,
      referenceTaskType,
      durationsSec: [fixture.clipSec],
    })
    expect(hold("reference")).toBe(pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO))
    expect(hold("reference")).toBeGreaterThan(hold(undefined))
  })

  it("the workflow estimate and the editor's quote equal what the run reserves: the worst case", async () => {
    const reserved = await runReserves(gv.data, fixture.clipSec)
    // The worst case, by the hold's own arithmetic, marked up at the run's identifier.
    const worstBase = seedance2RefVideoBaseCreditsFromDurations({
      provider,
      resolution,
      outputDurationSec: pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO),
      requestedDuration: VIDEO_DURATION_AUTO,
      referenceTaskType: "reference",
      durationsSec: [fixture.clipSec],
    })
    const markupId = videoGenerationCreditId({ provider, duration: VIDEO_DURATION_AUTO, resolution, hasVideoRef: true })
    expect(reserved).toBe(applyServiceMarkup(worstBase, settings.value as never, markupId))

    expect(await workflowEstimate(gv.data)).toBe(reserved)
    expect(await routeQuote(fixture.editorRequest)).toStrictEqual({ credits: reserved, min: reserved, exact: true })
  })

  it("without the setting the same node is an Auto edit, held lower — the declaration is what moves all three", async () => {
    const reserved = await runReserves(undeclared, fixture.clipSec)
    expect(reserved).toBeLessThan(await runReserves(gv.data, fixture.clipSec))
    expect(await workflowEstimate(undeclared)).toBe(reserved)
    const { referenceTaskType: _declared, ...editorUndeclared } = fixture.editorRequest
    expect(await routeQuote(editorUndeclared)).toStrictEqual({ credits: reserved, min: reserved, exact: true })
  })
})

/**
 * A Seedance 2.5 DRAFT that declares **The video to edit**, fed one uploaded
 * 6 s clip, at the draft's 480p: the run's reservation, the estimate route's
 * quote of the request the editor sends for it (the editor's node price and
 * Run button), and the server's workflow estimate are one figure — the Auto
 * edit's hold (the clip rounded up plus a second, out, and the clip, in),
 * computed below by the hold's own functions and marked up at the run's id.
 *
 * The node, its clip and the editor's request are one shared fixture
 * (`seedance-draft-edit-quote.json`); the editor's half —
 * frontend/src/lib/__tests__/seedance-ref-quote.test.ts — holds the editor's
 * `seedanceRefQuoteRequest` for the same node to `editorRequest`.
 */
describe("a draft edit of one 6 s clip at 480p: the reservation, the quote, the workflow estimate and the editor's quote are one figure", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/__tests__/fixtures/seedance-draft-edit-quote.json")
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    clipSec: number
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
    edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string }>
    editorRequest: Record<string, unknown>
  }
  const gv = fixture.nodes.find((n) => n.type === "generate-video")!
  const clip = fixture.nodes.find((n) => n.type === "upload-video")!
  const provider = gv.data.provider as string

  async function workflowEstimate(data: Record<string, unknown>) {
    probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
    __forgetUploadClipLengths()
    const nodes = fixture.nodes.map((n) => (n.id === gv.id ? { ...n, data } : n))
    return (await estimateWorkflowCreditsDetailed(nodes, fixture.edges)).perNode[gv.id]!.credits
  }

  async function routeQuote(body: Record<string, unknown>) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => { req.userId = "user-a" })
    registerSeedanceRefEstimate(app)
    await app.ready()
    try {
      probe.durations = new Map([[clip.data.url as string, fixture.clipSec]])
      const res = await app.inject({ method: "POST", url: "/v1/credits/seedance-ref-estimate", payload: body })
      expect(res.statusCode, res.body).toBe(200)
      return (res.json() as { data: { credits: number; min: number; exact: boolean } }).data
    } finally {
      await app.close()
    }
  }

  /** The figure, by the hold's own functions: the Auto edit's hold at 480p, marked up at the draft's Auto-length id. */
  function figure(): number {
    const base = seedance2RefVideoBaseCreditsFromDurations({
      provider,
      resolution: "480p",
      outputDurationSec: pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO),
      requestedDuration: VIDEO_DURATION_AUTO,
      referenceTaskType: "edit",
      durationsSec: [fixture.clipSec],
    })
    // The hold is the clip rounded up plus a second, out, and the clip, in.
    expect(seedance2RefVideoHeldOutputSec({
      provider, outputDurationSec: pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO), requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: "edit", durationsSec: [fixture.clipSec],
    })).toBe(Math.ceil(fixture.clipSec) + 1)
    const id = videoGenerationCreditId({ provider, duration: VIDEO_DURATION_AUTO, resolution: "480p", draft: true, hasVideoRef: true })
    return applyServiceMarkup(base, settings.value as never, id)
  }

  it("all four equal the figure", async () => {
    // The fixture's clip is the one `runReserves` sends, so the run is priced on the node's own clip.
    expect(clip.data.url).toBe(CLIP)
    const expected = figure()
    expect(await runReserves(gv.data, fixture.clipSec)).toBe(expected)
    expect(await routeQuote(fixture.editorRequest)).toStrictEqual({ credits: expected, min: expected, exact: true })
    expect(await workflowEstimate(gv.data)).toBe(expected)
  })

  it("the declaration is what moves all of them: the same draft without it is priced at its stored 5 s, lower", async () => {
    const { referenceTaskType: _declared, ...undeclared } = gv.data
    const { referenceTaskType: _sent, ...editorUndeclared } = fixture.editorRequest
    const reserved = await runReserves(undeclared, fixture.clipSec)
    expect(reserved).toBeLessThan(figure())
    expect(await routeQuote(editorUndeclared)).toStrictEqual({ credits: reserved, min: reserved, exact: true })
    expect(await workflowEstimate(undeclared)).toBe(reserved)
  })

  it("Draft changes only the resolution: the figure is the same edit at 480p without Draft", async () => {
    const { draft: _draft, ...plain } = gv.data
    expect(await runReserves(plain, fixture.clipSec)).toBe(figure())
    expect(await workflowEstimate(plain)).toBe(figure())
  })
})
