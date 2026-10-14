/**
 * UGC Clips and UGC Finish on the orchestrator, for a video whose clips are cut from one recorded
 * speech, with every call stubbed: the prelude's three child jobs, the second call, the refusal
 * before any spend, the finish job, and English left exactly as it was. Placeholders throughout.
 */
import { describe, expect, it, vi } from "vitest"
import { UGC_NODE_MESSAGES } from "@nodaro/shared/ugc"
import { UGC_STEP_JOB_TYPES, runUgcClips, runUgcFinish, type UgcDeps } from "../ugc-sync-nodes.js"
import type { OrchestratorContext, SimpleNode } from "../types.js"

type Reply = { status: number; body: unknown }
function stubDeps(replies: Record<string, Reply[]>, polled: Record<string, { output: Record<string, unknown>; creditsUsed?: number }> = {}) {
  const posted: Array<{ path: string; body: Record<string, unknown>; step?: string }> = []
  const created: string[] = []
  const queue = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [...v]]))
  const next = (key: string) => {
    const r = queue[key]?.shift()
    if (!r) throw new Error(`unexpected ${key}`)
    return { status: r.status, text: JSON.stringify(r.body) }
  }
  const deps: UgcDeps = {
    post: vi.fn(async (path, body, step) => { posted.push({ path, body, ...(step ? { step } : {}) }); return next(path) }),
    get: vi.fn(async (path) => next(`GET ${path}`)),
    poll: vi.fn(async (jobId) => ({ jobId, output: polled[jobId]?.output ?? {}, creditsUsed: polled[jobId]?.creditsUsed })),
    onJobCreated: vi.fn((id: string) => { created.push(id) }),
    jobCharge: vi.fn(async () => 0),
  }
  return { deps, posted, created }
}
const RUN = { executionId: "exec-1", userId: "user-1", isAppRun: false } as unknown as OrchestratorContext
const CLIPS: SimpleNode = { id: "clips", type: "ugc-clips", data: { label: "UGC Clips" } }
const PLAN = { v: 1, hook: "h", language: "he", targetDurationSec: 15, beats: [{ line: "b", screenshot: { slot: 1 } }, { line: "c" }] }
const INPUTS = { ugc: { plan: JSON.stringify(PLAN), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never
const GRAPH = {
  nodes: [{ id: "clips", type: "ugc-clips" }, { id: "finish", type: "ugc-finish-clips" }],
  edges: [{ source: "clips", target: "finish", sourceHandle: "plan-out", targetHandle: "plan" }],
}
const T = (i: number) => ({ v: 1, index: i, durationSec: 7, video: { tool: "generate_video", args: {} } })
const SEGMENTS = [{ index: 1, text: "a b" }, { index: 2, text: "c" }]
const PHASE1 = {
  errors: [], lane: "segmented-reference", phase: 1,
  speech: { tool: "generate_speech", args: { text: "a b c", model: "speech-model", voice_id: "voice-1", voice_type: "library", language_code: "xx" } },
  align: { tool: "forced_alignment", args: { transcript: "a b c" } },
  split: { tool: "ugc_split_speech", args: { plan: { v: 1, hook: "h" } } },
}
const PRELUDE_JOBS = {
  "j-speech": { output: { audioUrl: "https://cdn.example/s.mp3" }, creditsUsed: 33 },
  "j-align": { output: { alignment: [{ word: "a", start: 0, end: 1 }] }, creditsUsed: 33 },
  "j-split": { output: { json: { segments: SEGMENTS } }, creditsUsed: 11 },
}
const PHASE2 = {
  errors: [], phase: 2, tickets: [T(0), T(1)], sizedPlan: { hook: "h", clipBreaks: [], clipDurations: [14] }, transcript: "a b c", hasCards: false,
  speechCheckCall: { tool: "transcribe", args: { language: "xx" } }, finish: { tool: "ugc_finish_clips", args: { segments: SEGMENTS } },
}

describe("UGC Clips on a video cut from one recorded speech", () => {
  it("runs the speech, its word timings and its split as child jobs keyed by step, then the second call with the segments", async () => {
    const { deps, posted, created } = stubDeps(
      {
        "/v1/ugc/clips": [{ status: 200, body: PHASE1 }, { status: 200, body: PHASE2 }],
        "/v1/text-to-speech": [{ status: 200, body: { jobId: "j-speech" } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "j-align" } }],
        "/v1/ugc/segments": [{ status: 200, body: { jobId: "j-split" } }],
        "/v1/ugc/quote": [{ status: 200, body: { lines: [], expected: 900, ceiling: 1700, runHold: 2400 } }],
      },
      PRELUDE_JOBS,
    )
    const r = await runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)
    expect(posted.map((p) => [p.path, p.step ?? null])).toEqual([
      ["/v1/ugc/clips", null],
      ["/v1/text-to-speech", "speech"],
      ["/v1/forced-alignment", "alignment"],
      ["/v1/ugc/segments", "split"],
      ["/v1/ugc/clips", "phase-2"],
      ["/v1/ugc/quote", "hold-check"],
    ])
    expect(posted[1]!.body).toEqual({ text: "a b c", voice: "voice-1", voiceType: "library", provider: "speech-model", languageCode: "xx", userId: "user-1" })
    expect(posted[2]!.body).toEqual({ transcript: "a b c", audioUrl: "https://cdn.example/s.mp3", userId: "user-1" })
    // The hold check: the clips the second call handed on, priced as they will be held, with the video's estimate input read from its plan.
    expect(posted[5]!.body).toEqual({
      tickets: [T(0), T(1)], hasCards: false, finishes: true,
      runEstimate: { targetDurationSec: 15, screenshotCount: 1, source: "sampled", language: "he" },
    })
    expect(posted[3]!.body).toEqual({ plan: { v: 1, hook: "h" }, audioUrl: "https://cdn.example/s.mp3", alignment: [{ word: "a", start: 0, end: 1 }], userId: "user-1" })
    expect(posted[4]!.body).toEqual({ ...posted[0]!.body, segments: SEGMENTS })
    expect(created).toEqual(["j-speech", "j-align", "j-split"])
    expect(r.creditsUsed).toBe(77)
    expect(r.output.listResults).toEqual([JSON.stringify(T(0)), JSON.stringify(T(1))])
    expect(JSON.parse(r.output.ugcOutputs!["plan-out"]!)).toMatchObject({ finish: { segments: SEGMENTS } })
  })
  /** Every call up to the hold check, with `quote` as its answer. */
  const throughHoldCheck = (quote: Reply) => stubDeps(
    {
      "/v1/ugc/clips": [{ status: 200, body: PHASE1 }, { status: 200, body: PHASE2 }],
      "/v1/text-to-speech": [{ status: 200, body: { jobId: "j-speech" } }],
      "/v1/forced-alignment": [{ status: 200, body: { jobId: "j-align" } }],
      "/v1/ugc/segments": [{ status: 200, body: { jobId: "j-split" } }],
      "/v1/ugc/quote": [quote],
    },
    PRELUDE_JOBS,
  )
  it("clips that would hold more than the run was checked for stop the node before any clip: the speech steps stay charged", async () => {
    const { deps, posted } = throughHoldCheck({ status: 200, body: { lines: [], expected: 1300, ceiling: 2401, runHold: 2400 } })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)).rejects.toMatchObject({ message: UGC_NODE_MESSAGES.overHold, creditsUsed: 77 })
    expect(posted.at(-1)!.path).toBe("/v1/ugc/quote")
  })
  it("clips that hold exactly what the run was checked for go on", async () => {
    const { deps } = throughHoldCheck({ status: 200, body: { lines: [], expected: 1300, ceiling: 2400, runHold: 2400 } })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)).resolves.toMatchObject({ creditsUsed: 77 })
  })
  it("a hold check that cannot be had stops the node: a clip never renders on a figure nobody checked", async () => {
    const failed = throughHoldCheck({ status: 422, body: { error: { code: "unpriceable", message: "clip 1" } } })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, failed.deps, GRAPH)).rejects.toMatchObject({ creditsUsed: 77 })
    const unread = throughHoldCheck({ status: 200, body: { lines: [], expected: 900, ceiling: 1700 } })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, unread.deps, GRAPH)).rejects.toMatchObject({ message: UGC_NODE_MESSAGES.newerApp, creditsUsed: 77 })
  })
  it("a plan the hold check cannot read refuses the run before anything is spent: no prelude step, no charge", async () => {
    const { deps, posted, created } = throughHoldCheck({ status: 200, body: {} })
    const noLength = { ugc: { ...(INPUTS as { ugc: Record<string, string> }).ugc, plan: JSON.stringify({ ...PLAN, targetDurationSec: undefined }) } } as never
    const err = await runUgcClips(CLIPS, noLength, RUN, deps, GRAPH).catch((e: unknown) => e)
    expect(err).toMatchObject({ message: UGC_NODE_MESSAGES.newerApp })
    expect((err as { creditsUsed?: unknown }).creditsUsed ?? 0).toBe(0)
    expect(posted.map((p) => p.path)).toEqual(["/v1/ugc/clips"])
    expect(created).toEqual([])
  })
  it("is refused before anything is spent when no UGC Finish takes its Script (sized) output", async () => {
    const { deps, posted } = stubDeps({ "/v1/ugc/clips": [{ status: 200, body: PHASE1 }] })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, { nodes: GRAPH.nodes, edges: [] })).rejects.toThrow(UGC_NODE_MESSAGES.needsFinish)
    expect(posted).toHaveLength(1)
  })
  it("a refused script is worded as English's, before any step", async () => {
    const { deps, posted } = stubDeps({ "/v1/ugc/clips": [{ status: 200, body: { ...PHASE1, errors: [{ message: "Too long.", fix: "Trim it." }] } }] })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)).rejects.toThrow("The script needs changes: Too long. Trim it.")
    expect(posted).toHaveLength(1)
  })
  it("a failed step fails the node and still reports what the earlier steps were charged", async () => {
    const { deps } = stubDeps(
      { "/v1/ugc/clips": [{ status: 200, body: PHASE1 }], "/v1/text-to-speech": [{ status: 200, body: { jobId: "j-speech" } }], "/v1/forced-alignment": [{ status: 500, body: {} }] },
      { "j-speech": { output: { audioUrl: "https://cdn.example/s.mp3" }, creditsUsed: 33 } },
    )
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)).rejects.toMatchObject({ creditsUsed: 33 })
  })
  it("a run cancelled mid-prelude stops there: the started child is registered with the run (its cancel and refund are the run's), nothing after it starts", async () => {
    const { deps, posted, created } = stubDeps(
      { "/v1/ugc/clips": [{ status: 200, body: PHASE1 }], "/v1/text-to-speech": [{ status: 200, body: { jobId: "j-speech" } }], "/v1/forced-alignment": [{ status: 200, body: { jobId: "j-align" } }] },
      { "j-speech": { output: { audioUrl: "https://cdn.example/s.mp3" }, creditsUsed: 33 } },
    )
    ;(deps.poll as ReturnType<typeof vi.fn>).mockImplementation(async (jobId: string) => {
      if (jobId === "j-align") throw new Error("Execution cancelled")
      return { jobId, output: { audioUrl: "https://cdn.example/s.mp3" }, creditsUsed: 33 }
    })
    await expect(runUgcClips(CLIPS, INPUTS, RUN, deps, GRAPH)).rejects.toMatchObject({ message: "Execution cancelled", creditsUsed: 33 })
    expect(created).toEqual(["j-speech", "j-align"])
    expect(posted.map((p) => p.path)).toEqual(["/v1/ugc/clips", "/v1/text-to-speech", "/v1/forced-alignment"])
  })
  it("English: one call, its answer the node's output, exactly as before — no step, no charge", async () => {
    const { phase: _p, finish: _f, ...english } = PHASE2
    const { deps, posted } = stubDeps({ "/v1/ugc/clips": [{ status: 200, body: english }] })
    const r = await runUgcClips(CLIPS, INPUTS, RUN, deps, { nodes: [], edges: [] })
    expect(posted).toEqual([{ path: "/v1/ugc/clips", body: posted[0]!.body }])
    expect(posted[0]!.body).toMatchObject({ surface: "canvas", userId: "user-1" })
    expect(r).toEqual({ output: { ugcOutputs: expect.any(Object), listResults: [JSON.stringify(T(0)), JSON.stringify(T(1))] } })
    expect(JSON.parse(r.output.ugcOutputs!["plan-out"]!)).not.toHaveProperty("finish")
  })
  it("UGC Clips and UGC Finish are step-job nodes: a crash recovery never settles them off one child", () => {
    expect(UGC_STEP_JOB_TYPES.has("ugc-clips")).toBe(true)
    expect(UGC_STEP_JOB_TYPES.has("ugc-finish-clips")).toBe(true)
  })
})

describe("UGC Finish", () => {
  const FINISH: SimpleNode = { id: "finish", type: "ugc-finish-clips", data: { label: "UGC Finish" } }
  const URLS = ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"]
  const planOut = (finish?: unknown) => JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {}, ...(finish ? { finish } : {}) })

  it("English: the clips pass through in order — no call, no job, no charge", async () => {
    const { deps, posted } = stubDeps({})
    const r = await runUgcFinish(FINISH, { inputs: URLS, ugc: { plan: planOut() } } as never, RUN, deps)
    expect(posted).toEqual([])
    expect(r).toEqual({ output: { listResults: URLS, listResultMeta: [{ warnings: [], durationSec: null }, { warnings: [], durationSec: null }], videoUrl: URLS[0] } })
  })
  it("one finish job over every clip; its finished clips, in order, are the node's list", async () => {
    const { deps, posted, created } = stubDeps(
      { "/v1/ugc/finish": [{ status: 200, body: { jobId: "j-finish" } }] },
      { "j-finish": { output: { json: { ready: true, clips: [{ clip: 1, url: "https://cdn.example/f1.mp4", sec: 6 }, { clip: 2, url: "https://cdn.example/f2.mp4", sec: 5.5 }] } }, creditsUsed: 33 } },
    )
    const r = await runUgcFinish(FINISH, { inputs: URLS, ugc: { plan: planOut({ segments: SEGMENTS }) } } as never, RUN, deps)
    expect(posted).toEqual([{ path: "/v1/ugc/finish", step: "finish", body: { segments: SEGMENTS, clips: [{ clip: 1, rolls: [URLS[0]] }, { clip: 2, rolls: [URLS[1]] }], userId: "user-1" } }])
    expect(created).toEqual(["j-finish"])
    expect(r).toEqual({
      output: {
        listResults: ["https://cdn.example/f1.mp4", "https://cdn.example/f2.mp4"],
        listResultMeta: [{ warnings: [], durationSec: 6 }, { warnings: [], durationSec: 5.5 }],
        videoUrl: "https://cdn.example/f1.mp4",
      },
      creditsUsed: 33,
    })
  })
  it("a job that answers ready: false fails the node with its sentence, still reporting its charge", async () => {
    const { deps } = stubDeps({ "/v1/ugc/finish": [{ status: 200, body: { jobId: "j-finish" } }] }, { "j-finish": { output: { json: { ready: false, reroll: [2], failed: [] } }, creditsUsed: 33 } })
    await expect(runUgcFinish(FINISH, { inputs: URLS, ugc: { plan: planOut({ segments: SEGMENTS }) } } as never, RUN, deps)).rejects.toMatchObject({ message: UGC_NODE_MESSAGES.finishNotReady, creditsUsed: 33 })
  })
  it("no clips: refused before any call", async () => {
    const { deps, posted } = stubDeps({})
    await expect(runUgcFinish(FINISH, { inputs: [], ugc: { plan: planOut() } } as never, RUN, deps)).rejects.toThrow(UGC_NODE_MESSAGES.finishNeedsClips)
    expect(posted).toEqual([])
  })
})
