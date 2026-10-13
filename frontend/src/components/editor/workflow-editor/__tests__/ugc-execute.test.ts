import { UGC_NOT_SERVED_MESSAGE, ugcClipBody, ugcScriptBody } from "@nodaro/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; type: string; data: Record<string, unknown> }>,
  writes: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  polled: {} as Record<string, Record<string, unknown> | Error>,
  /** When the server finished each job (`completed_at`); absent → the server did not say. */
  completedAt: {} as Record<string, string>,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: h.nodes,
      edges: [],
      updateNodeData: (id: string, patch: Record<string, unknown>) => {
        h.writes.push({ id, patch })
        const n = h.nodes.find((x) => x.id === id)
        if (n) n.data = { ...n.data, ...patch }
      },
    }),
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
// The real module (RUN_START_RESET, guardedToast), with the poll stubbed per job.
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  pollScrapeJobOutput: vi.fn(async (jobId: string) => {
    const r = h.polled[jobId]
    if (r instanceof Error) throw r
    return r ?? {}
  }),
  pollJobOutputWithEnd: vi.fn(async (jobId: string) => {
    const r = h.polled[jobId]
    if (r instanceof Error) throw r
    return { output: r ?? {}, completedAt: h.completedAt[jobId] }
  }),
}))
const api = vi.hoisted(() => ({
  ugcCreatorApi: vi.fn(), ugcCategoriesApi: vi.fn(), ugcScriptApi: vi.fn(), ugcClipsApi: vi.fn(),
  ugcQuoteApi: vi.fn(), ugcClipApi: vi.fn(), ugcCardsApi: vi.fn(), startUgcChildJob: vi.fn(),
}))
// The real module is kept so the 404 case below runs the REAL ugc*Api functions against a mocked fetch.
const real = vi.hoisted(() => ({}) as Record<string, (...a: unknown[]) => unknown>)
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }))
vi.mock("@/lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/api")>()
  Object.assign(real, orig)
  return { ...orig, ...api }
})

import { InsufficientCreditsError, UgcApiError, UgcInsufficientCreditsError } from "@/lib/api"
import { pollScrapeJobOutput } from "../poll-job"
import { extractNodeOutput } from "../execution-graph"
import { executeUgcCards, executeUgcClip, executeUgcClips, executeUgcCreator, executeUgcScript } from "../ugc-execute"

const ctx = { userId: "user-1", projectId: undefined } as never
const ticket = (i: number) => ({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })
const put = (id: string, type: string, data: Record<string, unknown>) => { h.nodes.push({ id, type, data: { label: id, ...data } }); return h.nodes.at(-1)! as never }
/** Fastify's default 404 body for an unregistered route — what a deployment without the plugin answers. */
const fastify404 = (path: string) => new Response(JSON.stringify({ message: `Route POST:${path} not found`, error: "Not Found", statusCode: 404 }), { status: 404, headers: { "Content-Type": "application/json" } })

beforeEach(() => { vi.clearAllMocks(); h.nodes = []; h.writes = []; h.polled = {}; h.completedAt = {} })
/** Lets a quote fetched after the run settle land. */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("canvas UGC blocks", () => {
  it("Script sends the orchestrator's body and writes the plan wire", async () => {
    const node = put("script", "ugc-script", { targetDurationSec: 20, keepResult: false })
    const inputs = { ugc: { site: "Acme", screenshot: "https://cdn.example/1.png", screenshot3: "https://cdn.example/3.png" } } as never
    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    h.polled["job-s"] = { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }
    await executeUgcScript(node, inputs, ctx, {})
    expect(api.ugcScriptApi.mock.calls[0]![0]).toEqual({
      ...(ugcScriptBody({ site: "Acme", screenshots: ["https://cdn.example/1.png", undefined, "https://cdn.example/3.png"], targetDurationSec: 20 }) as { body: Record<string, unknown> }).body,
      userId: "user-1",
    })
    expect(JSON.parse((h.nodes[0]!.data.ugcOutputs as Record<string, string>).plan!)).toEqual({ v: 1, hook: "h" })
  })
  it("Script with keepResult and a result makes no API call", async () => {
    const node = put("script", "ugc-script", { targetDurationSec: 15, keepResult: true, result: { plan: { hook: "kept" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 } })
    await executeUgcScript(node, { ugc: { site: "Acme" } } as never, ctx, {})
    expect(api.ugcScriptApi).not.toHaveBeenCalled()
  })
  it("Clips clears its list and quote at run start, writes this run's tickets, then fetches the quote", async () => {
    const node = put("clips", "ugc-clips", { __listResults: [JSON.stringify(ticket(0)), JSON.stringify(ticket(1))], quote: { lines: [], expected: 1, ceiling: 2 } })
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    api.ugcQuoteApi.mockResolvedValue({ lines: [{ label: "Clip 1 (12 s)", credits: 1203 }], expected: 1203, ceiling: 2406 })
    await executeUgcClips(node, { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never, ctx, {})
    expect(h.writes[0]!.patch).toMatchObject({ __listResults: undefined, quote: undefined })
    expect(h.nodes[0]!.data.__listResults).toEqual([JSON.stringify(ticket(0))])          // a one-ticket run replaces a saved two-ticket list
    expect(api.ugcQuoteApi.mock.calls[0]![0]).toEqual({ tickets: [ticket(0)], hasCards: false })
    await flush()
    expect(h.nodes[0]!.data.quote).toMatchObject({ expected: 1203, ceiling: 2406 })
  })
  it("Clip's nonce follows data.rerender, and a fan-out iteration writes its notes row", async () => {
    const node = put("clip", "ugc-clip", { rerender: { "2": 3 }, __listResultMeta: [] })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled["job-c"] = { videoUrl: "https://cdn.example/c2.mp4", durationSec: 13, clipWarnings: ["clip_lengthened:13"], frameCheck: { passed: true, rerendered: false } }
    await executeUgcClip(node, {} as never, ctx, { listIterationIndex: 1, overrideInput: JSON.stringify(ticket(1)) })
    const sent = api.ugcClipApi.mock.calls[0]![0] as Record<string, unknown>
    expect(sent).toMatchObject({ ...(ugcClipBody({ ticketWire: JSON.stringify(ticket(1)), rerender: { "2": 3 } }) as { body: Record<string, unknown> }).body, nonce: 3 })
    expect((h.nodes[0]!.data.__listResultMeta as unknown[])[1]).toEqual({ warnings: ["clip_lengthened:13"], durationSec: 13 })
  })
  it("Clip keeps its Re-render mark while it runs; once the take lands, the mark of the clip it rendered goes, and the others' stay", async () => {
    const node = put("clip", "ugc-clip", { rerender: { "1": 2, "3": 1 }, rerenderPending: { "1": true, "3": true } })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c1" })
    h.polled["job-c1"] = { videoUrl: "https://cdn.example/c1.mp4", durationSec: 12, clipWarnings: [] }
    await executeUgcClip(node, {} as never, ctx, { overrideInput: JSON.stringify(ticket(0)) })
    expect("rerenderPending" in h.writes[0]!.patch).toBe(false)
    expect(api.ugcClipApi.mock.calls[0]![0]).toMatchObject({ nonce: 2 })
    expect(h.nodes[0]!.data.rerender).toEqual({ "1": 2, "3": 1 })
    expect(h.nodes[0]!.data.rerenderPending).toEqual({ "3": true })
  })
  it("Clip pressed again while its run goes on keeps the mark: that press is the next run's", async () => {
    const node = put("clip", "ugc-clip", { rerender: { "1": 2 }, rerenderPending: { "1": true } })
    api.ugcClipApi.mockImplementation(async () => {
      // The person presses Re-render again while the clip renders.
      h.nodes[0]!.data = { ...h.nodes[0]!.data, rerender: { "1": 3 } }
      return { jobId: "job-c2" }
    })
    h.polled["job-c2"] = { videoUrl: "https://cdn.example/c2.mp4", durationSec: 12, clipWarnings: [] }
    await executeUgcClip(node, {} as never, ctx, { overrideInput: JSON.stringify(ticket(0)) })
    expect(api.ugcClipApi.mock.calls[0]![0]).toMatchObject({ nonce: 2 })
    expect(h.nodes[0]!.data.rerenderPending).toEqual({ "1": true })
  })
  it("Clip whose run fails keeps its mark: the next run still renders that clip", async () => {
    const node = put("clip", "ugc-clip", { rerender: { "1": 1 }, rerenderPending: { "1": true } })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c3" })
    h.polled["job-c3"] = new Error("render failed")
    await executeUgcClip(node, {} as never, ctx, { overrideInput: JSON.stringify(ticket(0)) }).catch(() => undefined)
    expect(h.nodes[0]!.data.rerenderPending).toEqual({ "1": true })
  })
  it("Creator photo: a reading that does not pass fails the node with the refusal", async () => {
    const node = put("creator", "ugc-creator", { source: "photo", gender: "man", keepResult: false })
    api.ugcCreatorApi.mockResolvedValue({ kind: "photo", gender: "man", traits: null, identityImages: ["https://cdn.example/p.png"], image: null, realismPass: null, secondFrame: null, genderCheck: null,
      photoCheck: { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "This photo can't be used: it must show exactly one adult with the face clearly visible." } })
    api.startUgcChildJob.mockResolvedValue({ jobId: "read-1", generatedText: "FAIL: two people" })
    await expect(executeUgcCreator(node, { ugc: { photo: "https://cdn.example/p.png" } } as never, ctx, {})).rejects.toThrow("This photo can't be used")
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "failed", errorMessage: "This photo can't be used: it must show exactly one adult with the face clearly visible." })
  })
  it("Creator sampled: a first miss re-renders with the next seed and the first traits", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", seed: 7, keepResult: false })
    const check = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
    const image = { tool: "generate_image", args: { prompt: "p", model: "image-model-a", aspect_ratio: "3:4" }, fallback: { tool: "generate_image", args: { prompt: "p", model: "image-model-b", aspect_ratio: "3:4" } } }
    const answer = (seed: number, traits: Record<string, unknown>) => ({ kind: "sampled", seed, gender: "woman", traits, identityImages: [], image, realismPass: null, secondFrame: null, photoCheck: null, genderCheck: check, promptsVersion: "1.0.0", productCategory: "saas" })
    api.ugcCreatorApi.mockResolvedValueOnce(answer(7, { t: 1 })).mockResolvedValueOnce(answer(8, { t: 2 }))
    api.startUgcChildJob
      .mockResolvedValueOnce({ jobId: "img-1" }).mockResolvedValueOnce({ jobId: "read-1", generatedText: "FAIL" })
      .mockResolvedValueOnce({ jobId: "img-2" }).mockResolvedValueOnce({ jobId: "read-2", generatedText: "PASS" })
    h.polled = { "img-1": { imageUrl: "https://cdn.example/i1.png" }, "img-2": { imageUrl: "https://cdn.example/i2.png" } }
    await executeUgcCreator(node, { ugc: { category: "saas" } } as never, ctx, {})
    expect(api.ugcCreatorApi.mock.calls[1]![0]).toMatchObject({ seed: 8, source: { previous: { t: 1 } } })
    expect(h.nodes[0]!.data.generatedImageUrl).toBe("https://cdn.example/i2.png")
    // The canvas keeps no credit total: each child job is billed by its own route. Both readings ran as jobs.
    expect(api.startUgcChildJob.mock.calls.map((c) => c[0])).toEqual(["/v1/generate-image", "/v1/image-to-text/describe", "/v1/generate-image", "/v1/image-to-text/describe"])
  })
  it("Cards runs both timing jobs and survives either failing", async () => {
    const node = put("cards", "ugc-cards", {})
    api.ugcCategoriesApi.mockResolvedValue({ categories: [] })
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "al-1" }).mockResolvedValueOnce({ jobId: "tr-1" })
    h.polled = { "al-1": new Error("alignment failed"), "tr-1": { words: [{ text: "a", startMs: 0, endMs: 300 }] } }
    api.ugcCardsApi.mockResolvedValue({ layerPlan: [], captionTiming: null, report: { lines: ["Captions and cards were timed from speech recognition."] } })
    await executeUgcCards(node, { ugc: { plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a" }, clipNotes: [] } as never, ctx, {})
    expect((api.ugcCardsApi.mock.calls[0]![0] as Record<string, unknown>).failed).toEqual(["alignment"])
    expect((h.nodes[0]!.data.ugcOutputs as Record<string, string>).report).toBe("Captions and cards were timed from speech recognition.")
  })
  it.each([
    ["ugc-script", "ugcScriptApi", "/v1/ugc/script", executeUgcScript, { ugc: { site: "Acme" } }],
    ["ugc-clips", "ugcClipsApi", "/v1/ugc/clips", executeUgcClips, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } }],
    ["ugc-clip", "ugcClipApi", "/v1/ugc/clip", executeUgcClip, {}],
  ] as const)("a real router 404 from %s's API (mocked fetch) → the Cloud sentence on the node", async (type, name, path, run, inputs) => {
    const fetchMock = vi.fn(async () => fastify404(path))
    vi.stubGlobal("fetch", fetchMock)
    try {
      api[name].mockImplementation(real[name]!)          // the real api function, not a hand-made error
      const node = put("n", type, { targetDurationSec: 15, keepResult: false, rerender: {} })
      await expect(run(node, inputs as never, ctx, { overrideInput: JSON.stringify(ticket(0)) })).rejects.toThrow(UGC_NOT_SERVED_MESSAGE)
      expect(h.nodes[0]!.data.errorMessage).toBe(UGC_NOT_SERVED_MESSAGE)
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(new RegExp(`${path}$`))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

const img = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const [A, B, C] = [img("image-model-a"), img("image-model-b"), img("image-model-c")]
const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
/** A builder answer with two options (primary first) and the round's one fallback. */
const TWO = {
  kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" },
  realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
}

describe("UGC Creator's options on the canvas", () => {
  it("both render and are checked; the node holds the options and no creator wire", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false, ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/old.png" } })
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" })
      .mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" }).mockResolvedValueOnce({ jobId: "read-b", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" }, "img-b": { imageUrl: "https://cdn.example/b.png" } }
    await executeUgcCreator(node, { ugc: { category: "saas" } } as never, ctx, {})
    const d = h.nodes[0]!.data
    expect((d.candidates as Array<{ imageUrl: string }>).map((c) => c.imageUrl)).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.png"])
    expect(d.ugcOutputs).toBeUndefined()
    expect(d.executionStatus).toBe("completed")
  })
  it("a blocked option is dropped silently; the other is the creator, as today", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" }).mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" }, "img-b": Object.assign(new Error("blocked"), { errorHint: { kind: "safety-block" } }) }
    await executeUgcCreator(node, { ugc: { category: "saas" } } as never, ctx, {})
    const d = h.nodes[0]!.data
    expect(d.candidates).toBeUndefined()
    expect(d.optionFailed).toBeUndefined()
    expect(d.generatedImageUrl).toBe("https://cdn.example/a.png")
  })
  it("a 402 on the second option: the checked one is kept, the dialog opens with the route's numbers, the node fails", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
    const dialog = { setInsufficientCreditsData: vi.fn(), setShowInsufficientCredits: vi.fn() }
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockRejectedValueOnce(new UgcInsufficientCreditsError("Not enough credits.", 18, 5))
      .mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" } }
    await expect(executeUgcCreator(node, { ugc: { category: "saas" } } as never, { ...(ctx as object), ...dialog } as never, {})).rejects.toBeInstanceOf(InsufficientCreditsError)
    expect((h.nodes[0]!.data.candidates as Array<{ imageUrl: string }>).map((c) => c.imageUrl)).toEqual(["https://cdn.example/a.png"])
    expect(dialog.setInsufficientCreditsData).toHaveBeenCalledWith(expect.objectContaining({ required: 18, available: 5 }))
    expect(dialog.setShowInsufficientCredits).toHaveBeenCalledWith(true)
  })
  it("a sub-workflow's hidden copy draws the primary alone", async () => {
    h.nodes.push({ id: "sw::creator", type: "ugc-creator", hidden: true, data: { label: "c", source: "sampled", gender: "woman", keepResult: false } } as never)
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" } }
    await executeUgcCreator(h.nodes.at(-1) as never, { ugc: { category: "saas" } } as never, ctx, {})
    expect(api.startUgcChildJob.mock.calls.map((c) => c[0])).toEqual(["/v1/generate-image", "/v1/image-to-text/describe"])
  })
})

describe("the canvas UGC calls: the remaining rules", () => {
  it("a refusal that means the run cannot pay, by the route's code, stops the round like a 402: no dialog without both numbers", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
    const dialog = { setInsufficientCreditsData: vi.fn(), setShowInsufficientCredits: vi.fn() }
    const budget = new UgcApiError(402, JSON.stringify({ error: { code: "budget_exceeded", message: "This workspace has spent its budget." } }))
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockRejectedValueOnce(budget).mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" } }
    await expect(executeUgcCreator(node, { ugc: { category: "saas" } } as never, { ...(ctx as object), ...dialog } as never, {})).rejects.toBe(budget)
    const d = h.nodes[0]!.data
    expect(d).toMatchObject({ executionStatus: "failed", errorMessage: "This workspace has spent its budget." })
    expect((d.candidates as unknown[]).length).toBe(1)
    expect(d.optionFailed).toBeUndefined()
    expect(dialog.setShowInsufficientCredits).not.toHaveBeenCalled()
  })
  it("Stop mid-draw beside an option that passed: never a failed option, never a creator handed on, never a failure", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
    const stop = new AbortController()
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" })
      .mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" })
    vi.mocked(pollScrapeJobOutput)
      .mockImplementationOnce(async () => ({ imageUrl: "https://cdn.example/a.png" }))
      // Option B is still rendering when Stop is pressed — after option A passed its check.
      .mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 10))
        stop.abort()
        throw new DOMException("Aborted", "AbortError")
      })
    await expect(executeUgcCreator(node, { ugc: { category: "saas" } } as never, { ...(ctx as object), signal: stop.signal } as never, {})).resolves.toBe("")
    const d = h.nodes[0]!.data
    expect(d.executionStatus).toBe("running")
    expect(d.optionFailed).toBeUndefined()
    expect(d.ugcOutputs).toBeUndefined()
    expect(d.candidates).toBeUndefined()
  })
  it("nothing new starts once the run is stopping", async () => {
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
    const stop = new AbortController()
    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" })
    vi.mocked(pollScrapeJobOutput)
      .mockImplementationOnce(async () => ({ imageUrl: "https://cdn.example/a.png" }))
      .mockImplementationOnce(async () => { stop.abort(); throw new DOMException("Aborted", "AbortError") })
    await expect(executeUgcCreator(node, { ugc: { category: "saas" } } as never, { ...(ctx as object), signal: stop.signal } as never, {})).resolves.toBe("")
    // Option A's reading never ran.
    expect(api.startUgcChildJob).toHaveBeenCalledTimes(2)
  })
  it("a kept creator hands on what it holds: no call, no charge", async () => {
    const record = { v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/k.png"], traits: { t: 1 } }
    const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: true, result: record })
    await expect(executeUgcCreator(node, {} as never, ctx, {})).resolves.toBe(JSON.stringify(record))
    expect(api.ugcCreatorApi).not.toHaveBeenCalled()
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "completed", ugcOutputs: { creator: JSON.stringify(record), image: "https://cdn.example/k.png" }, generatedImageUrl: "https://cdn.example/k.png" })
  })
  it("an input the wires refuse fails the node with the wires' sentence before any call", async () => {
    const node = put("script", "ugc-script", { targetDurationSec: 15, keepResult: false })
    await expect(executeUgcScript(node, { ugc: { site: "  " } } as never, ctx, {})).rejects.toThrow("Add the product name or website.")
    expect(api.ugcScriptApi).not.toHaveBeenCalled()
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "failed", errorMessage: "Add the product name or website." })
  })
  it("a script job that finished without a plan fails the node, as on the server", async () => {
    const node = put("script", "ugc-script", { targetDurationSec: 15, keepResult: false })
    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    h.polled["job-s"] = { productCategory: "saas" }
    await expect(executeUgcScript(node, { ugc: { site: "Acme" } } as never, ctx, {})).rejects.toThrow("completed but produced no output")
    expect(h.nodes[0]!.data.executionStatus).toBe("failed")
    expect(h.nodes[0]!.data.ugcOutputs).toBeUndefined()
  })
  it("a clip job that finished without a video fails the node, as on the server", async () => {
    const node = put("clip", "ugc-clip", { rerender: {} })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled["job-c"] = { durationSec: 12 }
    await expect(executeUgcClip(node, { ugc: { clip: JSON.stringify(ticket(0)) } } as never, ctx, {})).rejects.toThrow("completed but produced no output")
  })
  it("a single clip run hands on the take it now shows; its warnings and length ride on the node, and no older notes rows", async () => {
    const node = put("clip", "ugc-clip", { rerender: {}, __listResultMeta: [{ warnings: ["old"], durationSec: 9 }], generatedResults: [{ url: "https://cdn.example/old.mp4", timestamp: "t", jobId: "old" }], activeResultIndex: 0 })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled["job-c"] = { videoUrl: "https://cdn.example/c0.mp4", durationSec: 12, clipWarnings: [] }
    await expect(executeUgcClip(node, { ugc: { clip: JSON.stringify(ticket(0)) } } as never, ctx, {})).resolves.toBe("https://cdn.example/c0.mp4")
    const d = h.nodes[0]!.data
    expect(d).toMatchObject({ executionStatus: "completed", generatedVideoUrl: "https://cdn.example/c0.mp4", activeResultIndex: 0, ugcOutputs: { "video-out": "https://cdn.example/c0.mp4" }, clipWarnings: [], durationSec: 12 })
    expect((d.generatedResults as Array<{ url: string }>).map((r) => r.url)).toEqual(["https://cdn.example/c0.mp4", "https://cdn.example/old.mp4"])
    expect(d.__listResultMeta).toBeUndefined()
    // What the node hands downstream is the take it shows — this run's clip, on every pip reader.
    expect(extractNodeOutput({ id: "clip", type: "ugc-clip", position: { x: 0, y: 0 }, data: d } as never)).toBe("https://cdn.example/c0.mp4")
    expect(extractNodeOutput({ id: "clip", type: "ugc-clip", position: { x: 0, y: 0 }, data: d } as never, "video-out")).toBe("https://cdn.example/c0.mp4")
  })
  it("a quote the platform cannot give leaves the clips run complete, with no quote", async () => {
    const node = put("clips", "ugc-clips", {})
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: true })
    api.ugcQuoteApi.mockRejectedValue(new UgcApiError(503, "{}"))
    await executeUgcClips(node, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "man", identityImages: ["https://cdn.example/c.png"] }) } } as never, ctx, {})
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "completed", __listResults: [JSON.stringify(ticket(0))] })
    expect(h.nodes[0]!.data.quote).toBeUndefined()
  })
  it("UGC Cards reads the transcription's words where a transcribe job writes them (its json)", async () => {
    const node = put("cards", "ugc-cards", {})
    const words = [{ text: "a", startMs: 0, endMs: 300 }]
    api.ugcCategoriesApi.mockResolvedValue({ categories: [] })
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "al-1" }).mockResolvedValueOnce({ jobId: "tr-1" })
    h.polled = { "al-1": { alignment: [{ word: "a", start: 0, end: 0.3 }] }, "tr-1": { text: "a", json: { words } } }
    api.ugcCardsApi.mockResolvedValue({ layerPlan: [], captionTiming: null, report: { lines: [] } })
    await executeUgcCards(node, { ugc: { plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a" }, clipNotes: [{ clip: 1, warnings: [], durationSec: 12 }] } as never, ctx, {})
    expect(api.ugcCardsApi.mock.calls[0]![0]).toMatchObject({ alignment: [{ word: "a", start: 0, end: 0.3 }], words, failed: [], clipNotes: [{ clip: 1, warnings: [], durationSec: 12 }], userId: "user-1" })
  })
  it("UGC Cards with no plugin starts no timing job", async () => {
    const node = put("cards", "ugc-cards", {})
    api.ugcCategoriesApi.mockRejectedValue(new UgcApiError(404, "Not Found"))
    await expect(executeUgcCards(node, { ugc: {} } as never, ctx, {})).rejects.toThrow(UGC_NOT_SERVED_MESSAGE)
    expect(api.startUgcChildJob).not.toHaveBeenCalled()
  })
  it("a reading the route hands back by its key (no text) is polled as the job it is", async () => {
    const node = put("creator", "ugc-creator", { source: "photo", gender: "man", keepResult: false })
    api.ugcCreatorApi.mockResolvedValue({ kind: "photo", gender: "man", traits: null, identityImages: [], image: null, realismPass: null, secondFrame: null, genderCheck: null,
      photoCheck: { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" } })
    api.startUgcChildJob.mockResolvedValue({ jobId: "read-1", deduped: true })
    h.polled["read-1"] = { generatedText: "PASS" }
    await executeUgcCreator(node, { ugc: { photo: "https://cdn.example/p.png" } } as never, ctx, {})
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "completed", generatedImageUrl: "https://cdn.example/p.png" })
  })
  it("every child of one run carries its own key; the same run's same requests carry the same keys", async () => {
    const run = async () => {
      h.nodes = []
      const node = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
      api.ugcCreatorApi.mockResolvedValueOnce(TWO)
      // Each option's own job, as the server answers a keyed request: the options' keys are worked out
      // side by side (WebCrypto), so which one asks first is not fixed — never hand jobs out by call order.
      api.startUgcChildJob.mockImplementation(async (path: string, body: Record<string, unknown>) =>
        path === "/v1/generate-image"
          ? { jobId: JSON.stringify(body).includes("image-model-b") ? "img-b" : "img-a" }
          : { jobId: `read-${JSON.stringify(body).includes("b.png") ? "b" : "a"}`, generatedText: "PASS" })
      h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" }, "img-b": { imageUrl: "https://cdn.example/b.png" } }
      await executeUgcCreator(node, { ugc: { category: "saas" } } as never, { ...(ctx as object), idempotencyKey: "click-1" } as never, {})
    }
    await run()
    const first = api.startUgcChildJob.mock.calls.map((c) => (c[2] as { idempotencyKey?: string }).idempotencyKey)
    expect(first.every((k) => typeof k === "string" && k.startsWith("click-1:creator:"))).toBe(true)
    expect(new Set(first).size).toBe(4)
    expect(api.ugcCreatorApi.mock.calls[0]![1]).toEqual({ idempotencyKey: "click-1:creator" })
    vi.clearAllMocks()
    await run()
    expect(api.startUgcChildJob.mock.calls.map((c) => (c[2] as { idempotencyKey?: string }).idempotencyKey).sort()).toEqual([...first].sort())
    api.startUgcChildJob.mockReset()
  })
  it("two UGC nodes one click runs (a sub-workflow's copies share it) never send one key", async () => {
    const keyed = { ...(ctx as object), idempotencyKey: "click-1" } as never
    const script = put("sw::script", "ugc-script", { targetDurationSec: 15, keepResult: false })
    const clip = put("sw::clip", "ugc-clip", { rerender: {} })
    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled = { "job-s": { plan: { hook: "h" }, productCategory: "saas" }, "job-c": { videoUrl: "https://cdn.example/c.mp4" } }
    await executeUgcScript(script, { ugc: { site: "Acme" } } as never, keyed, {})
    await executeUgcClip(clip, { ugc: { clip: JSON.stringify(ticket(0)) } } as never, keyed, {})
    const scriptKey = (api.ugcScriptApi.mock.calls[0]![1] as { idempotencyKey?: string }).idempotencyKey
    const clipKey = (api.ugcClipApi.mock.calls[0]![1] as { idempotencyKey?: string }).idempotencyKey
    expect(scriptKey).toBe("click-1:sw::script")
    expect(clipKey).toBe("click-1:sw::clip")
  })
  it("a canvas script and a single canvas clip are stamped with their job; a fanned-out clip's row is not", async () => {
    const script = put("script", "ugc-script", { targetDurationSec: 15, keepResult: false })
    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    h.polled["job-s"] = { plan: { hook: "h" }, productCategory: "saas" }
    await executeUgcScript(script, { ugc: { site: "Acme" } } as never, ctx, {})
    expect(h.nodes[0]!.data.resultsRunId).toBe("job-s")
    expect(typeof h.nodes[0]!.data.resultsRunEndedAt).toBe("string")
    const single = put("clip", "ugc-clip", { rerender: {} })
    api.ugcClipApi.mockResolvedValueOnce({ jobId: "job-c" })
    h.polled["job-c"] = { videoUrl: "https://cdn.example/c.mp4" }
    await executeUgcClip(single, { ugc: { clip: JSON.stringify(ticket(0)) } } as never, ctx, {})
    expect(h.nodes[1]!.data.resultsRunId).toBe("job-c")
    const row = put("fan", "ugc-clip", { rerender: {}, __listResultMeta: [] })
    api.ugcClipApi.mockResolvedValueOnce({ jobId: "job-f" })
    h.polled["job-f"] = { videoUrl: "https://cdn.example/f.mp4" }
    await executeUgcClip(row, {} as never, ctx, { listIterationIndex: 0, overrideInput: JSON.stringify(ticket(0)) })
    expect(h.nodes[2]!.data.resultsRunId).toBeUndefined()
  })
})

describe("UGC Clips' quote is shown, never waited for", () => {
  const CLIPS_IN = { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never
  const QUOTE = { lines: [{ label: "Clip 1 (12 s)", credits: 1 }], expected: 1, ceiling: 2 }
  /** A quote the test answers by hand; the signal it was sent with. */
  function heldQuote() {
    let answer: (q: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    api.ugcQuoteApi.mockImplementation((_body: unknown, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal
      return new Promise((resolve) => { answer = resolve })
    })
    return { answer: (q: unknown) => answer(q), signal: () => signal }
  }

  it("a quote that never answers: the run still ends, completed with its tickets", async () => {
    const node = put("clips", "ugc-clips", {})
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    heldQuote()
    await executeUgcClips(node, CLIPS_IN, ctx, {})
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "completed", __listResults: [JSON.stringify(ticket(0))] })
    expect(h.nodes[0]!.data.quote).toBeUndefined()
  })

  it("a late quote lands only on the tickets it priced: never over a newer run", async () => {
    const node = put("clips", "ugc-clips", {})
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    const held = heldQuote()
    await executeUgcClips(node, CLIPS_IN, ctx, {})
    // A newer run starts: its run-start reset takes the tickets away.
    h.nodes[0]!.data = { ...h.nodes[0]!.data, executionStatus: "running", __listResults: undefined }
    held.answer(QUOTE)
    await flush()
    expect(h.nodes[0]!.data.quote).toBeUndefined()
  })

  it("a late quote still lands on the same tickets read again (a save made elsewhere replaced the node's objects)", async () => {
    const node = put("clips", "ugc-clips", {})
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    const held = heldQuote()
    await executeUgcClips(node, CLIPS_IN, ctx, {})
    h.nodes[0]!.data = JSON.parse(JSON.stringify(h.nodes[0]!.data))
    held.answer(QUOTE)
    await flush()
    expect(h.nodes[0]!.data.quote).toEqual(QUOTE)
  })

  it("Stop drops a quote still on its way", async () => {
    const node = put("clips", "ugc-clips", {})
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    const held = heldQuote()
    const stop = new AbortController()
    await executeUgcClips(node, CLIPS_IN, { ...(ctx as object), signal: stop.signal } as never, {})
    expect(held.signal()?.aborted).toBe(false)
    stop.abort()
    expect(held.signal()?.aborted).toBe(true)
    held.answer(QUOTE)
    await flush()
    expect(h.nodes[0]!.data.quote).toBeUndefined()
  })

  it("a quote that takes too long is given up", async () => {
    vi.useFakeTimers()
    try {
      const node = put("clips", "ugc-clips", {})
      api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
      const held = heldQuote()
      await executeUgcClips(node, CLIPS_IN, ctx, {})
      expect(held.signal()?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(held.signal()?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("a canvas UGC run stamps what it lands with when it ended, on the server's clock", () => {
  // A reopen lands a run newer than what the node shows, never an older one: it compares this stamp
  // with times the server wrote, so the stamp is read on the server's clock (lib/server-clock.ts).
  const CLIPS_IN = { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never

  it("Script and Clip: with the job's own end", async () => {
    const script = put("script", "ugc-script", { targetDurationSec: 15, keepResult: false })
    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    h.polled["job-s"] = { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }
    h.completedAt["job-s"] = "2026-10-05T10:00:20.000Z"
    await executeUgcScript(script, { ugc: { site: "Acme" } } as never, ctx, {})
    expect(h.nodes[0]!.data).toMatchObject({ resultsRunId: "job-s", resultsRunEndedAt: "2026-10-05T10:00:20.000Z" })

    const clip = put("clip", "ugc-clip", { rerender: {} })
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled["job-c"] = { videoUrl: "https://cdn.example/c.mp4", durationSec: 12, clipWarnings: [] }
    h.completedAt["job-c"] = "2026-10-05T10:01:00.000Z"
    await executeUgcClip(clip, {} as never, ctx, { overrideInput: JSON.stringify(ticket(0)) })
    expect(h.nodes[1]!.data).toMatchObject({ resultsRunId: "job-c", resultsRunEndedAt: "2026-10-05T10:01:00.000Z" })
  })

  it("a job whose end the server does not give, and a run that is no one job (Clips, Cards, Creator): the server's clock as last read", async () => {
    const { noteServerDate, resetServerClock } = await import("@/lib/server-clock")
    const browserNow = Date.parse("2026-10-05T10:05:00.500Z")
    const now = vi.spyOn(Date, "now").mockReturnValue(browserNow)
    try {
      // This browser runs five minutes fast.
      noteServerDate("Mon, 05 Oct 2026 10:00:00 GMT", browserNow)
      const server = "2026-10-05T10:00:00.500Z"
      const script = put("script", "ugc-script", { targetDurationSec: 15, keepResult: false })
      api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
      h.polled["job-s"] = { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }
      await executeUgcScript(script, { ugc: { site: "Acme" } } as never, ctx, {})
      expect(h.nodes[0]!.data.resultsRunEndedAt).toBe(server)

      const clips = put("clips", "ugc-clips", {})
      api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
      api.ugcQuoteApi.mockResolvedValue({ lines: [], expected: 1, ceiling: 2 })
      await executeUgcClips(clips, CLIPS_IN, ctx, {})
      expect(h.nodes[1]!.data.resultsRunEndedAt).toBe(server)
      expect(String(h.nodes[1]!.data.resultsRunId)).toMatch(/^canvas:clips:/)

      const cards = put("cards", "ugc-cards", {})
      api.ugcCategoriesApi.mockResolvedValue({ categories: [] })
      api.startUgcChildJob.mockResolvedValueOnce({ jobId: "al-1" }).mockResolvedValueOnce({ jobId: "tr-1" })
      h.polled = { ...h.polled, "al-1": { alignment: [] }, "tr-1": { json: { words: [] } } }
      api.ugcCardsApi.mockResolvedValue({ layerPlan: [], captionTiming: null, report: { lines: ["No issues."] } })
      await executeUgcCards(cards, { ugc: { plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a" }, clipNotes: [] } as never, ctx, {})
      expect(h.nodes[2]!.data.resultsRunEndedAt).toBe(server)

      const creator = put("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })
      api.ugcCreatorApi.mockResolvedValueOnce(TWO)
      api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" })
        .mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" }).mockResolvedValueOnce({ jobId: "read-b", generatedText: "PASS" })
      h.polled = { ...h.polled, "img-a": { imageUrl: "https://cdn.example/a.png" }, "img-b": { imageUrl: "https://cdn.example/b.png" } }
      await executeUgcCreator(creator, { ugc: { category: "saas" } } as never, ctx, {})
      expect(h.nodes[3]!.data.resultsRunEndedAt).toBe(server)
    } finally {
      now.mockRestore()
      resetServerClock()
    }
  })

  it("Keep on hands on what the node holds: its stamp stays the run that made it", async () => {
    const node = put("script", "ugc-script", { targetDurationSec: 15, keepResult: true, resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-01T09:00:00.000Z", result: { plan: { hook: "kept" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 } })
    await executeUgcScript(node, { ugc: { site: "Acme" } } as never, ctx, {})
    expect(h.nodes[0]!.data).toMatchObject({ resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-01T09:00:00.000Z" })
  })
})
