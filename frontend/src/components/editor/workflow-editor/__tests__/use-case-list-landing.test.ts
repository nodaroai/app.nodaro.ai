/**
 * A Trailer run from the canvas (use-case-executor.ts, decided 2026-10-14):
 * its deliveries land as the rows of ONE run — each naming the run's wrapper
 * and its quality, each named by its format and keeping the run's plan —
 * ahead of the node's earlier results, the first on show; the node's own list
 * (what an Each wire reads) and the formats it could not render beside them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

/* eslint-disable @typescript-eslint/no-explicit-any */
const api = vi.hoisted(() => ({ runUseCase: vi.fn(), continueUseCase: vi.fn(), getJobStatus: vi.fn() }))
const store = vi.hoisted(() => ({ nodes: [] as any[], updateNodeData: vi.fn() }))
const poll = vi.hoisted(() => ({ landed: undefined as Record<string, unknown> | undefined, keys: undefined as unknown, outputOf: undefined as ((jobId: string) => Record<string, unknown>) | undefined }))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/api", () => api)
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))
const OUTPUT = {
  videoUrl: "https://r2/t-916.mp4",
  formats: [{ format: "9:16", url: "https://r2/t-916.mp4" }, { format: "1:1", url: "https://r2/t-11.mp4" }],
  failedFormats: ["4:5"],
  json: { version: 1, segments: [] },
  transcript: { version: 1, words: [] },
  quality: "final",
  planBasis: "0123456789abcdef",
  renderBasis: "fedcba9876543210",
  useCaseSettings: { formats: ["9:16", "1:1", "4:5"] },
  _executionId: "exec-in",
}
// The poll lane: start the job, then hand the completed job's output to the
// landing's node fields (what handleJobCompleted spreads after its own take).
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: async (_nodeId: string, apiCall: () => Promise<{ jobId: string }>, keys: unknown, _label: string, _ctx: unknown, extra: any) => {
    poll.keys = keys
    const { jobId } = await apiCall()
    const output = poll.outputOf ? poll.outputOf(jobId) : OUTPUT
    poll.landed = extra(output)
    return output.videoUrl as string
  },
}))

import { executeUseCase } from "../use-case-executor"

const ctx: any = { userId: "00000000-0000-4000-8000-000000000001", isWorkflowStale: () => false, trackInterval: (i: unknown) => i, untrackInterval: () => {} }
const EARLIER = { url: "https://r2/old.mp4", jobId: "job-0", quality: "final", format: "9:16", timestamp: "t0" }

beforeEach(() => {
  api.runUseCase.mockReset().mockResolvedValue({ jobId: "job-w" })
  api.continueUseCase.mockReset()
  poll.landed = undefined
  poll.outputOf = undefined
  store.nodes = [{ id: "tr", type: "episode-trailer", position: { x: 0, y: 0 }, data: { label: "Trailer", fieldMappings: {}, formats: ["9:16", "1:1", "4:5"], generatedResults: [EARLIER] } }]
  store.updateNodeData.mockReset().mockImplementation((id: string, patch: Record<string, unknown>) => {
    store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  })
})

describe("a Trailer run lands its formats as one run's rows", () => {
  it("sends the formats and the intro card, and lands every delivery as a row of the run", async () => {
    await executeUseCase(store.nodes[0], { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }], useCaseIntroCard: "https://r2/card.mp4" } as never, ctx)
    expect(api.runUseCase.mock.calls[0]![1]).toEqual(expect.objectContaining({ mediaUrl: "https://r2/ep.mp4", introCardUrl: "https://r2/card.mp4", settings: expect.objectContaining({ formats: ["9:16", "1:1", "4:5"] }) }))
    const landed = poll.landed!
    const rows = landed.generatedResults as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.url, r.format, r.jobId, r.quality])).toEqual([
      ["https://r2/t-916.mp4", "9:16", "job-w", "final"],
      ["https://r2/t-11.mp4", "1:1", "job-w", "final"],
      [EARLIER.url, EARLIER.format, EARLIER.jobId, EARLIER.quality],
    ])
    // Every delivery keeps the run's plan, transcript and settings (a pick of any restores them).
    expect(rows[1]).toMatchObject({ generatedJson: OUTPUT.json, generatedTranscript: OUTPUT.transcript, useCaseSettings: OUTPUT.useCaseSettings })
    const stamp = { quality: "final", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210", jobId: "job-w" }
    expect(landed.__listResultStamps).toEqual([stamp, stamp])
    expect(rows[0]).toMatchObject({ failedFormats: ["4:5"] })
    expect(landed).toMatchObject({
      __listResults: ["https://r2/t-916.mp4", "https://r2/t-11.mp4"],
      generatedVideoUrl: "https://r2/t-916.mp4",
      activeResultIndex: 0,
      failedFormats: ["4:5"],
      generatedJson: OUTPUT.json,
      useCaseExecutionId: "exec-in",
    })
  })
})

describe("a second Render final, after a further edit, is a run of its own", () => {
  it("each continues the Preview's run with its own edit and lands as a NEW job's rows, each format once", async () => {
    const EDIT_1 = { v: 1, kind: "edl", basis: "b1", edl: { segments: [], dropped: [] } }
    const EDIT_2 = { v: 1, kind: "edl", basis: "b2", edl: { segments: [], dropped: [] } }
    api.continueUseCase.mockResolvedValueOnce({ kind: "started", jobId: "job-f1" }).mockResolvedValueOnce({ kind: "started", jobId: "job-f2" })
    // Each final renders files of its own.
    poll.outputOf = (jobId) => ({ ...OUTPUT, videoUrl: `https://r2/${jobId}-916.mp4`, formats: [{ format: "9:16", url: `https://r2/${jobId}-916.mp4` }, { format: "1:1", url: `https://r2/${jobId}-11.mp4` }], failedFormats: [] })
    const final = async (editedEdl: unknown) => {
      await executeUseCase(store.nodes[0], {} as never, ctx, { usecaseContinue: { mode: "render-final", jobId: "job-p", editedEdl } as never })
      store.updateNodeData("tr", poll.landed!)
    }
    await final(EDIT_1)
    await final(EDIT_2)
    expect(api.continueUseCase.mock.calls.map((c) => [c[0].jobId, c[0].mode, c[0].editedEdl])).toEqual([
      ["job-p", "render-final", EDIT_1],
      ["job-p", "render-final", EDIT_2],
    ])
    const rows = store.nodes[0].data.generatedResults as Array<Record<string, unknown>>
    // The second final's rows first, naming its own job — never the first final's.
    expect(rows.slice(0, 2).map((r) => [r.jobId, r.format])).toEqual([["job-f2", "9:16"], ["job-f2", "1:1"]])
    expect(rows.slice(2, 4).map((r) => [r.jobId, r.format])).toEqual([["job-f1", "9:16"], ["job-f1", "1:1"]])
    expect(store.nodes[0].data.useCaseJobId).toBe("job-f2")
    // The run on show holds each format once.
    const onShow = rows.filter((r) => r.jobId === rows[0]!.jobId).map((r) => r.format)
    expect(new Set(onShow).size).toBe(onShow.length)
  })
})

describe("a Clip Pack run lands its clips as one run's rows", () => {
  const CLIPS = {
    videoUrl: "https://r2/c0.mp4",
    clips: [
      { url: "https://r2/c0.mp4", quality: "final", clipKey: "k0", title: "The pivot", planBasis: "p0", renderBasis: "r0", thumbnailUrl: "https://r2/c0.png" },
      { url: "https://r2/c1.mp4", quality: "final", clipKey: "k1", title: "The money", planBasis: "p1", renderBasis: "r1", thumbnailUrl: "https://r2/c1.png", captionsFailed: true },
    ],
    failedClips: 1,
    failedCaptions: 1,
    json: [{ version: 1 }, { version: 1 }],
    transcript: { version: 1, words: [] },
    quality: "final",
    useCaseSettings: { count: 3 },
    _executionId: "exec-cp",
  }

  it("one row per clip, each with its own stamps and the run's wrapper; one clip not rendered and one uncaptioned, named on every row", async () => {
    poll.outputOf = () => CLIPS
    store.nodes = [{ id: "cp", type: "clip-pack", position: { x: 0, y: 0 }, data: { label: "Clip Pack", fieldMappings: {}, count: 3, generatedResults: [EARLIER] } }]
    await executeUseCase(store.nodes[0], { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as never, ctx)
    expect(api.runUseCase.mock.calls[0]![1]).toEqual(expect.objectContaining({ mediaUrl: "https://r2/ep.mp4", settings: expect.objectContaining({ count: 3 }) }))
    const landed = poll.landed!
    const rows = landed.generatedResults as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.url, r.clipKey, r.title, r.jobId, r.quality, r.planBasis, r.renderBasis, r.thumbnailUrl, r.captionsFailed, r.failedClips])).toEqual([
      ["https://r2/c0.mp4", "k0", "The pivot", "job-w", "final", "p0", "r0", "https://r2/c0.png", undefined, 1],
      ["https://r2/c1.mp4", "k1", "The money", "job-w", "final", "p1", "r1", "https://r2/c1.png", true, 1],
      [EARLIER.url, undefined, undefined, EARLIER.jobId, EARLIER.quality, undefined, undefined, undefined, undefined, undefined],
    ])
    expect(rows[1]).toMatchObject({ generatedJson: CLIPS.json, useCaseSettings: CLIPS.useCaseSettings })
    expect(landed.__listResultStamps).toEqual([
      { quality: "final", clipKey: "k0", planBasis: "p0", renderBasis: "r0", thumbnailUrl: "https://r2/c0.png", jobId: "job-w" },
      { quality: "final", clipKey: "k1", planBasis: "p1", renderBasis: "r1", thumbnailUrl: "https://r2/c1.png", jobId: "job-w" },
    ])
    expect(landed).toMatchObject({ __listResults: ["https://r2/c0.mp4", "https://r2/c1.mp4"], generatedVideoUrl: "https://r2/c0.mp4", activeResultIndex: 0, failedClips: 1 })
  })
})
