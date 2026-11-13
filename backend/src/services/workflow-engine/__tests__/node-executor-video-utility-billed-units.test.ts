/**
 * The workflow run measures a Trim / Loop / Combine Videos' clips and QUEUES
 * the units: `stampVideoUtilityLength` writes `billedUnits` and the measured
 * lengths (`upstreamDuration` / `upstreamDurations`, in place of the length
 * the graph forwarded) on the built payload, and the payload the worker
 * receives (`queue.add`) must carry them — the render refuses a job without
 * units. Every edition (credits off here): a run is never queued unpriced. A
 * clip that cannot be read leaves no jobs row, as the routes refuse it. With
 * credits on, the reservation is those units times the node's one-unit row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockProbe, credits, mockCheckCredits, mockReserveCredits } = vi.hoisted(() => ({
  credits: { on: false },
  mockCheckCredits: vi.fn(async () => ({ allowed: true })),
  mockReserveCredits: vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 0, watermark: false })),
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockProbe: vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 12 })),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => credits.on,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
        update: vi.fn().mockReturnValue({ eq: eqFn }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
  // Each node's one-unit row: 11 credits (a retuned row, not the static 10), so the reservation reads it.
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 11, isEnabled: true, tierRestriction: null })),
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 0 })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn(), savedOutputFor: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: (data: Record<string, unknown>) => data,
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: async () => ({ admin: false }),
  assertNodeAvailableForUser: async () => {},
}))
// The clips' probe is the seam: the real stamp (lib/video-utility-length.ts) runs.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: mockProbe,
  // The example links are public: the probe's link guard never asks DNS here.
  assertSafeProbeSource: vi.fn(async () => undefined),
}))

// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
const mockClipLength = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown> | undefined]> }))
vi.mock("@/lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string, opts?: Record<string, unknown>) => {
    mockClipLength.calls.push([src, opts])
    return (await mockProbe(src)).durationSeconds
  },
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const A = "https://cdn.example.com/a.mp4"
const B = "https://cdn.example.com/b.mp4"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

/** The payload the run hands the queue for a build of `payload` as `jobName`. */
async function queuedFor(jobName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const node: SimpleNode = { id: "u", type: jobName, data: {} }
  mockBuildPayload.mockImplementation(() => ({
    jobName,
    queueName: "video-generation",
    modelIdentifier: jobName,
    payload: { jobId: "test-job-id", ...payload },
  }))
  // The poll never resolves in this harness; the enqueue is all we need.
  void executeNode(node, {}, [], [node], {}, ctx()).catch(() => {})
  await vi.waitFor(() => expect(mockQueueAdd).toHaveBeenCalled())
  const [queuedName, queued] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
  expect(queuedName).toBe(jobName)
  return queued
}

describe("the workflow run queues a Trim / Loop / Combine Videos' measured units", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClipLength.calls.length = 0
    credits.on = false
    mockProbe.mockImplementation(async (url: string) => ({ width: 640, height: 360, durationSeconds: url === B ? 7.5 : 12 }))
  })

  it("Trim: the units its measured video costs (12 s → 3), in place of the forwarded length", async () => {
    const queued = await queuedFor("trim-video", { videoUrl: A, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0, upstreamDuration: 10 })
    expect(mockProbe).toHaveBeenCalledWith(A)
    expect(queued).toEqual(expect.objectContaining({ billedUnits: 3, upstreamDuration: 12 }))
  })

  it("no client is waiting: each header read gets 30 s and a packet scan the render's own download bound (120 s), no request deadline", async () => {
    await queuedFor("trim-video", { videoUrl: A, trimMode: "seconds" })
    const [, opts] = mockClipLength.calls[0]!
    expect(opts).toEqual(expect.objectContaining({ timeoutMs: 30_000, packetTimeoutMs: 120_000, sourceChecked: true }))
    expect(opts).not.toHaveProperty("deadlineAt")
    // Its signal is the measure's own stop (a failing sibling clip), never a client's: nothing aborted it.
    expect((opts?.signal as AbortSignal | undefined)?.aborted).toBe(false)
  })

  it("Loop: ×2 of the measured 12 s → 5 units", async () => {
    const queued = await queuedFor("loop-video", { videoUrl: A, mode: "repeat", repeatCount: 2, upstreamDuration: 8 })
    expect(queued).toEqual(expect.objectContaining({ billedUnits: 5, upstreamDuration: 12 }))
  })

  it("Combine Videos: each clip measured, in the order it joins them (12 s + 7.5 s → 4 units)", async () => {
    const queued = await queuedFor("combine-videos", { videoUrls: [A, B], transition: "cut", trimStartFrames: 1, trimEndFrames: 2, upstreamDurations: [undefined, 3] })
    expect(queued).toEqual(expect.objectContaining({ billedUnits: 4, upstreamDurations: [12, 7.5] }))
  })

  it("credits on: the reservation is the measured units times the node's one-unit row (12 s Trim → 3 × 11)", async () => {
    credits.on = true
    const queued = await queuedFor("trim-video", { videoUrl: A, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0, upstreamDuration: 2 })
    expect(queued.billedUnits).toBe(3)
    const [, , reserveId, , , opts] = mockReserveCredits.mock.calls[0] as unknown as [string, string, string, number, number, { creditOverride?: number }]
    expect(reserveId).toBe("trim-video")
    expect(opts.creditOverride).toBe(3 * 11)
  })

  it("credits on: a Combine Videos of 12 s + 7.5 s reserves its 4 measured units × the row", async () => {
    credits.on = true
    await queuedFor("combine-videos", { videoUrls: [A, B], transition: "cut", trimStartFrames: 1, trimEndFrames: 2, upstreamDurations: [1, 1] })
    const opts = (mockReserveCredits.mock.calls[0] as unknown as [string, string, string, number, number, { creditOverride?: number }])[5]
    expect(opts.creditOverride).toBe(4 * 11)
  })

  it("a billedUnits the built payload already carried (written into the node) is replaced by the measured one", async () => {
    const queued = await queuedFor("trim-video", { videoUrl: A, trimMode: "seconds", billedUnits: 1 })
    expect(queued.billedUnits).toBe(3)
  })

  it("a Combine Videos of more than 100 clips refuses the node before any clip is fetched", async () => {
    mockBuildPayload.mockImplementation(() => ({
      jobName: "combine-videos", queueName: "video-generation", modelIdentifier: "combine-videos",
      payload: { jobId: "test-job-id", videoUrls: Array.from({ length: 101 }, (_, i) => `https://cdn.example.com/c${i}.mp4`) },
    }))
    const node: SimpleNode = { id: "u", type: "combine-videos", data: {} }
    await expect(executeNode(node, {}, [], [node], {}, ctx())).rejects.toThrow("Combine Videos joins at most 100 clips; this run has 101.")
    expect(mockProbe).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("a probe that times out refuses the node with a run-it-again message, distinct from an unreadable clip", async () => {
    mockProbe.mockRejectedValue(Object.assign(new Error("ffprobe failed: killed"), { timedOut: true }))
    mockBuildPayload.mockImplementation(() => ({
      jobName: "trim-video", queueName: "video-generation", modelIdentifier: "trim-video",
      payload: { jobId: "test-job-id", videoUrl: A, trimMode: "seconds" },
    }))
    const node: SimpleNode = { id: "u", type: "trim-video", data: {} }
    const err = await executeNode(node, {}, [], [node], {}, ctx()).then(() => undefined, (e: unknown) => e as Error & { errorCode?: string })
    expect(err?.message).toBe("Timed out reading the video — run it again.")
    expect(err?.errorCode).toBe("probe_timeout")
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  // Raw workflow JSON reaches the run without the routes' Zod: each clip passes
  // the routes' url check before it is probed, or the node is refused as unreadable.
  it.each([
    ["a bare local path", "trim-video", { videoUrl: "/etc/hosts" }, "Could not read the video."],
    ["a loopback link", "loop-video", { videoUrl: "http://127.0.0.1:9000/a.mp4", mode: "repeat" }, "Could not read the video."],
    ["a private link as the second clip a clip order picked", "combine-videos", { videoUrls: [A, "http://10.0.0.5/b.mp4"] }, "Could not read clip 2 of 2."],
  ])("%s is refused before any probe", async (_label, jobName, payload, message) => {
    mockBuildPayload.mockImplementation(() => ({
      jobName, queueName: "video-generation", modelIdentifier: jobName,
      payload: { jobId: "test-job-id", ...payload },
    }))
    const node: SimpleNode = { id: "u", type: jobName, data: {} }
    await expect(executeNode(node, {}, [], [node], {}, ctx())).rejects.toThrow(`${message} The file may be corrupted or an unsupported format.`)
    expect(mockProbe).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("a self-host's own stored clip (on the app's localhost origin) passes the url check and is measured", async () => {
    const saved = process.env.R2_PUBLIC_URL
    process.env.R2_PUBLIC_URL = "http://localhost:3000/storage/nodaro-assets"
    try {
      const own = "http://localhost:3000/storage/nodaro-assets/videos/clip.mp4"
      const queued = await queuedFor("trim-video", { videoUrl: own, trimMode: "seconds" })
      expect(mockProbe).toHaveBeenCalledWith(own)
      expect(queued.billedUnits).toBe(3)
    } finally {
      if (saved === undefined) delete process.env.R2_PUBLIC_URL
      else process.env.R2_PUBLIC_URL = saved
    }
  })

  it("a clip that cannot be read refuses the node before anything is queued, as the route does", async () => {
    mockProbe.mockRejectedValue(new Error("unreadable"))
    mockBuildPayload.mockImplementation(() => ({
      jobName: "loop-video", queueName: "video-generation", modelIdentifier: "loop-video",
      payload: { jobId: "test-job-id", videoUrl: A, mode: "repeat" },
    }))
    const node: SimpleNode = { id: "u", type: "loop-video", data: {} }
    await expect(executeNode(node, {}, [], [node], {}, ctx())).rejects.toThrow("Could not read the video. The file may be corrupted or an unsupported format.")
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
