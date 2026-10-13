/**
 * The canvas runs of UGC Clips and UGC Finish for a video whose clips are cut from one recorded
 * speech — the twins of the server engine's ugc-lane-runner.test.ts — with every call stubbed:
 * the prelude's three child jobs and the second call, the refusal before any spend, the finish job,
 * and English left as it was. Placeholders throughout.
 */
import { UGC_NODE_MESSAGES } from "@nodaro/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; type: string; data: Record<string, unknown> }>,
  edges: [] as Array<Record<string, unknown>>,
  polled: {} as Record<string, Record<string, unknown>>,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: h.nodes,
      edges: h.edges,
      updateNodeData: (id: string, patch: Record<string, unknown>) => {
        const n = h.nodes.find((x) => x.id === id)
        if (n) n.data = { ...n.data, ...patch }
      },
    }),
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  pollScrapeJobOutput: vi.fn(async (jobId: string) => h.polled[jobId] ?? {}),
}))
const api = vi.hoisted(() => ({ ugcClipsApi: vi.fn(), ugcQuoteApi: vi.fn(), startUgcChildJob: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }))
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }))

import { executeUgcClips, executeUgcFinishClips } from "../ugc-execute"

const ctx = { userId: "user-1", projectId: undefined } as never
const put = (id: string, type: string, data: Record<string, unknown> = {}) => { h.nodes.push({ id, type, data: { label: id, ...data } }); return h.nodes.at(-1)! as never }
const T = (i: number) => ({ v: 1, index: i, durationSec: 7, video: { tool: "generate_video", args: {} } })
const SEGMENTS = [{ index: 1, text: "a b" }, { index: 2, text: "c" }]
const PHASE1 = {
  errors: [], lane: "segmented-reference", phase: 1,
  speech: { tool: "generate_speech", args: { text: "a b c", model: "speech-model", voice_id: "voice-1", voice_type: "library", language_code: "xx" } },
  align: { tool: "forced_alignment", args: { transcript: "a b c" } },
  split: { tool: "ugc_split_speech", args: { plan: { v: 1, hook: "h" } } },
}
const PHASE2 = {
  errors: [], phase: 2, tickets: [T(0), T(1)], sizedPlan: { hook: "h", clipBreaks: [], clipDurations: [14] }, transcript: "a b c", hasCards: false,
  speechCheckCall: { tool: "transcribe", args: { language: "xx" } }, finish: { tool: "ugc_finish_clips", args: { segments: SEGMENTS } },
}
const CLIPS_IN = { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never

beforeEach(() => {
  vi.clearAllMocks()
  h.nodes = []
  h.edges = []
  h.polled = {}
  api.ugcQuoteApi.mockResolvedValue({ lines: [], expected: 0, ceiling: 0 })
})

describe("UGC Clips on the canvas, for a video cut from one recorded speech", () => {
  it("runs the speech, its word timings and its split as child jobs, then the second call with the segments", async () => {
    const node = put("clips", "ugc-clips", { executionStatus: "running" })
    put("finish", "ugc-finish-clips")
    h.edges = [{ source: "clips", target: "finish", sourceHandle: "plan-out", targetHandle: "plan" }]
    api.ugcClipsApi.mockResolvedValueOnce(PHASE1).mockResolvedValueOnce(PHASE2)
    api.startUgcChildJob.mockImplementation(async (path: string) => ({ jobId: `job:${path}` }))
    h.polled = {
      "job:/v1/text-to-speech": { audioUrl: "https://cdn.example/s.mp3" },
      "job:/v1/forced-alignment": { alignment: [{ word: "a", start: 0, end: 1 }] },
      "job:/v1/ugc/segments": { segments: SEGMENTS },
    }
    await executeUgcClips(node, CLIPS_IN, ctx, {})
    expect(api.startUgcChildJob.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["/v1/text-to-speech", { text: "a b c", voice: "voice-1", voiceType: "library", provider: "speech-model", languageCode: "xx", userId: "user-1" }],
      ["/v1/forced-alignment", { transcript: "a b c", audioUrl: "https://cdn.example/s.mp3", userId: "user-1" }],
      ["/v1/ugc/segments", { plan: { v: 1, hook: "h" }, audioUrl: "https://cdn.example/s.mp3", alignment: [{ word: "a", start: 0, end: 1 }], userId: "user-1" }],
    ])
    expect(api.ugcClipsApi.mock.calls[1]![0]).toEqual({ ...api.ugcClipsApi.mock.calls[0]![0], segments: SEGMENTS })
    const data = h.nodes[0]!.data
    expect(data.__listResults).toEqual([JSON.stringify(T(0)), JSON.stringify(T(1))])
    expect(JSON.parse((data.ugcOutputs as Record<string, string>)["plan-out"]!)).toMatchObject({ finish: { segments: SEGMENTS } })
    // The quote it shows is told the clips go through UGC Finish's job, so the finish is a line of it.
    await vi.waitFor(() => expect(api.ugcQuoteApi).toHaveBeenCalled())
    expect(api.ugcQuoteApi.mock.calls[0]![0]).toEqual({ tickets: [T(0), T(1)], hasCards: false, finishes: true })
  })
  it("is refused before anything is spent when no UGC Finish takes its Script (sized) output", async () => {
    const node = put("clips", "ugc-clips", { executionStatus: "running" })
    api.ugcClipsApi.mockResolvedValueOnce(PHASE1)
    await expect(executeUgcClips(node, CLIPS_IN, ctx, {})).rejects.toThrow(UGC_NODE_MESSAGES.needsFinish)
    expect(api.startUgcChildJob).not.toHaveBeenCalled()
    expect(api.ugcClipsApi).toHaveBeenCalledTimes(1)
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "failed", errorMessage: UGC_NODE_MESSAGES.needsFinish })
  })
  it("English: one call, no child job, as before", async () => {
    const node = put("clips", "ugc-clips", { executionStatus: "running" })
    const { phase: _p, finish: _f, ...english } = PHASE2
    api.ugcClipsApi.mockResolvedValueOnce(english)
    await executeUgcClips(node, CLIPS_IN, ctx, {})
    expect(api.ugcClipsApi).toHaveBeenCalledTimes(1)
    expect(api.startUgcChildJob).not.toHaveBeenCalled()
    expect(JSON.parse((h.nodes[0]!.data.ugcOutputs as Record<string, string>)["plan-out"]!)).not.toHaveProperty("finish")
    await vi.waitFor(() => expect(api.ugcQuoteApi).toHaveBeenCalled())
    expect(api.ugcQuoteApi.mock.calls[0]![0]).toMatchObject({ finishes: false })
  })
})

describe("UGC Finish on the canvas", () => {
  const URLS = ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"]
  const planOut = (finish?: unknown) => JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {}, ...(finish ? { finish } : {}) })

  it("English: the clips pass through in order — no call, no job", async () => {
    const node = put("finish", "ugc-finish-clips", { executionStatus: "running" })
    const out = await executeUgcFinishClips(node, { inputs: URLS, ugc: { plan: planOut() } } as never, ctx, {})
    expect(api.startUgcChildJob).not.toHaveBeenCalled()
    expect(out).toBe(URLS[0])
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "completed", __listResults: URLS, generatedVideoUrl: URLS[0], activeResultIndex: 0 })
  })
  it("one finish job over every clip; its finished clips, in order, are the node's list", async () => {
    const node = put("finish", "ugc-finish-clips", { executionStatus: "running" })
    api.startUgcChildJob.mockResolvedValue({ jobId: "job-finish" })
    h.polled["job-finish"] = { ready: true, clips: [{ clip: 1, url: "https://cdn.example/f1.mp4", sec: 6 }, { clip: 2, url: "https://cdn.example/f2.mp4", sec: 5.5 }] }
    await executeUgcFinishClips(node, { inputs: URLS, ugc: { plan: planOut({ segments: SEGMENTS }) } } as never, ctx, {})
    expect(api.startUgcChildJob.mock.calls[0]![0]).toBe("/v1/ugc/finish")
    expect(api.startUgcChildJob.mock.calls[0]![1]).toEqual({ segments: SEGMENTS, clips: [{ clip: 1, rolls: [URLS[0]] }, { clip: 2, rolls: [URLS[1]] }], userId: "user-1" })
    expect(h.nodes[0]!.data).toMatchObject({
      executionStatus: "completed",
      __listResults: ["https://cdn.example/f1.mp4", "https://cdn.example/f2.mp4"],
      __listResultMeta: [{ warnings: [], durationSec: 6 }, { warnings: [], durationSec: 5.5 }],
      generatedVideoUrl: "https://cdn.example/f1.mp4",
    })
  })
  it("a job that answers ready: false fails the node with its sentence", async () => {
    const node = put("finish", "ugc-finish-clips", { executionStatus: "running" })
    api.startUgcChildJob.mockResolvedValue({ jobId: "job-finish" })
    h.polled["job-finish"] = { ready: false, reroll: [2], failed: [] }
    await expect(executeUgcFinishClips(node, { inputs: URLS, ugc: { plan: planOut({ segments: SEGMENTS }) } } as never, ctx, {})).rejects.toThrow(UGC_NODE_MESSAGES.finishNotReady)
    expect(h.nodes[0]!.data).toMatchObject({ executionStatus: "failed" })
  })
})
