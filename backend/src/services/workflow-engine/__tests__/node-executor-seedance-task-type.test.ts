/**
 * The Video to Video node's Seedance 2.5 edit on a workflow run: the payload
 * builder REQUESTS `referenceTaskType: "edit"`, and the executor resolves it
 * once the reference clip is measured, before input_data is written and before
 * anything is reserved. The job record and the queued job carry the resolved
 * value, or no key at all — the same rule the routes apply.
 *
 * Harness from import-via-threading.test.ts (the reservation resolves, the
 * enqueue throws a sentinel so executeNode ends before the poll) with the
 * Seedance reference-video pricing stubbed as in seedance2-ref-video-reserve.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits, mockReserveCredits, mockGetAppSettings, mockQueueAdd, mockUpdate,
  mockProbeMediaDuration, mockSeedance2FromUrls, mockSeedance2FromDurations, built,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockUpdate: vi.fn(),
  mockProbeMediaDuration: vi.fn(),
  mockSeedance2FromUrls: vi.fn(),
  mockSeedance2FromDurations: vi.fn(),
  built: { result: {} as Record<string, unknown> },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = mockUpdate.mockReturnValue({ eq: eqFn })
  const deleteEqFn = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({ insert: insertFn, update: updateFn, delete: deleteFn, select: vi.fn() }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/ee/billing/seedance2-ref-video-credits.js", () => ({
  seedance2RefVideoBaseCreditsFromUrls: mockSeedance2FromUrls,
  seedance2RefVideoBaseCreditsFromDurations: mockSeedance2FromDurations,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mockProbeMediaDuration }))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockImplementation((node: unknown) => ({ node, appliedMappings: [] })),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({ executeSubWorkflow: vi.fn() }))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const node: SimpleNode = { id: "v2v", type: "video-to-video", data: { provider: "seedance-2-5" } }

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, billingContext: { payer: "user", userId: "user-1" },
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

/** The Video to Video node's Seedance edit job, as the builder makes it for `clip`. */
function setEditPayload(clip: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = {
    jobId: "test-job-id",
    prompt: "edit @video_1 as follows:\nmake it black and white",
    provider: "seedance-2-5",
    duration: -1,
    aspectRatio: "adaptive",
    resolution: "480p",
    referenceVideoUrls: [clip],
    referenceTaskType: "edit",
    ...extra,
  }
  built.result = { jobName: "text-to-video", queueName: "video-generation", modelIdentifier: "seedance-2-5:30s:480p-ref", payload }
  return payload
}

/** The input_data the executor wrote to the jobs row. */
function writtenInputData(): Record<string, unknown> {
  const call = mockUpdate.mock.calls.find((c) => (c[0] as { input_data?: unknown })?.input_data !== undefined)
  expect(call, "input_data was written").toBeDefined()
  return (call![0] as { input_data: Record<string, unknown> }).input_data
}

/** The payload the executor queued. */
function queuedPayload(): Record<string, unknown> {
  expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  const [jobName, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
  expect(jobName).toBe("text-to-video")
  return payload
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  mockSeedance2FromUrls.mockResolvedValue(500)
  mockSeedance2FromDurations.mockReturnValue(500)
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 500, watermark: false })
  // The enqueue is the last step under test: refusing it ends executeNode
  // before the poll, and the assertions are on what the queue RECEIVED.
  mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
})

describe("node-executor — the Seedance edit's requested task type is resolved before it is recorded or queued", () => {
  it("a 6 s clip: input_data and the queued job carry the resolved edit, and the reservation is unchanged", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const edit = setEditPayload("https://cdn.example.com/six.mp4")
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    expect(writtenInputData()).toMatchObject({ ...edit, referenceTaskType: "edit", refVideoDurationsSec: [6] })
    expect(queuedPayload()).toMatchObject({ ...edit, referenceTaskType: "edit", usageLogId: "usage-1", refVideoDurationsSec: [6] })
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("seedance-2-5:30s:480p-ref")
    expect(mockSeedance2FromDurations).toHaveBeenCalledWith(expect.objectContaining({ durationsSec: [6], requestedDuration: -1 }))
  })

  it("a 3 s clip: neither input_data nor the queued job carries the key, and nothing else moves", async () => {
    mockProbeMediaDuration.mockResolvedValue(3)
    const { referenceTaskType: _requested, ...undeclared } = setEditPayload("https://cdn.example.com/three.mp4")
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    const inputData = writtenInputData()
    expect(inputData).not.toHaveProperty("referenceTaskType")
    expect(inputData).toMatchObject({ ...undeclared, refVideoDurationsSec: [3] })
    const queued = queuedPayload()
    expect(queued).not.toHaveProperty("referenceTaskType")
    expect(queued).toMatchObject({ ...undeclared, usageLogId: "usage-1", refVideoDurationsSec: [3] })
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("seedance-2-5:30s:480p-ref")
  })

  it("a draft edit of a 6 s clip carries the resolved edit, as without Draft, and the reservation is unchanged", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const edit = setEditPayload("https://cdn.example.com/draft.mp4", { draft: true })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    expect(writtenInputData()).toMatchObject({ ...edit, draft: true, referenceTaskType: "edit", refVideoDurationsSec: [6] })
    expect(queuedPayload()).toMatchObject({ ...edit, draft: true, referenceTaskType: "edit", usageLogId: "usage-1", refVideoDurationsSec: [6] })
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("seedance-2-5:30s:480p-ref")
    expect(mockSeedance2FromDurations).toHaveBeenCalledWith(expect.objectContaining({ durationsSec: [6], requestedDuration: -1, referenceTaskType: "edit" }))
  })

  it("a payload that requests nothing is recorded and queued without the key", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const { referenceTaskType: _requested, ...plain } = setEditPayload("https://cdn.example.com/plain.mp4")
    built.result = { ...built.result, payload: plain }
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    expect(writtenInputData()).not.toHaveProperty("referenceTaskType")
    expect(queuedPayload()).not.toHaveProperty("referenceTaskType")
  })
})

// ---------------------------------------------------------------------------
// A Generate Video node that carries a task type. The builder REQUESTS it and
// returns its price arguments; the executor resolves it once the clip is
// measured and, when the resolution moves the length, reserves for the length
// that runs — the id `/v1/generate-video` reserves for the same request.
// ---------------------------------------------------------------------------

const { buildPayload: realBuildPayload } = await vi.importActual<typeof import("../payload-builder.js")>("../payload-builder.js")
const { generateVideoPricing } = await import("../../../routes/generate-video.js")

const CLIP = "https://cdn.example.com/clip.mp4"
const GV_DATA = { provider: "seedance-2-5", prompt: "make it black and white", aspectRatio: "16:9", duration: 5, resolution: "720p" }
const gvNode = (extra: Record<string, unknown> = {}): SimpleNode => ({ id: "gv", type: "generate-video", data: { ...GV_DATA, ...extra } })

/** What one run of `n` recorded, reserved and queued, with the build it ran on. */
async function runGenerateVideo(n: SimpleNode) {
  vi.clearAllMocks()
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  mockSeedance2FromUrls.mockResolvedValue(500)
  mockSeedance2FromDurations.mockReturnValue(500)
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 500, watermark: false })
  mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
  const build = realBuildPayload(n, "test-job-id", { referenceVideoUrls: [CLIP] })
  built.result = build as unknown as Record<string, unknown>
  await expect(executeNode(n, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
  return {
    build,
    inputData: writtenInputData(),
    queued: queuedPayload(),
    checkedId: (mockCheckCredits.mock.calls[0] as unknown[])[1] as string,
    reservedId: (mockReserveCredits.mock.calls[0] as unknown[])[2] as string,
  }
}

/** The id `/v1/generate-video` checks and reserves for `body` with its clips measured at `measured`. */
function routeId(body: Record<string, unknown>, measured: number[]): string {
  return generateVideoPricing.modelResolver({ body: { referenceVideoUrls: [CLIP], ...body }, refVideoDurationsSec: measured } as never)
}

const withoutKey = (record: Record<string, unknown>): Record<string, unknown> => {
  const { referenceTaskType: _dropped, ...rest } = record
  return rest
}

describe("node-executor — a Generate Video node's Seedance 2.5 task type", () => {
  it("edit, 16:9 at 5 s, a 6 s clip: recorded and queued adaptive at Auto length, reserved for Auto — the route's own id", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const run = await runGenerateVideo(gvNode({ referenceTaskType: "edit" }))

    for (const sent of [run.queued, run.inputData]) {
      expect(sent).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })
    }
    const args = run.build.videoCreditIdArgs!
    const autoId = buildVideoCreditModelIdentifier(args.provider, -1, args.sound, args.mode, args.sizeOrMode, args.resolution, args.hasVideoRef)
    expect(run.reservedId).toBe(autoId)
    expect(run.checkedId).toBe(autoId)
    expect(autoId).not.toBe(run.build.modelIdentifier)
    expect(run.reservedId).toBe(routeId({ ...GV_DATA, referenceTaskType: "edit" }, [6]))
    // The reference-video amount is priced on the run as sent.
    expect(mockSeedance2FromDurations).toHaveBeenCalledWith(expect.objectContaining({ durationsSec: [6], requestedDuration: -1 }))
  })

  it.each([
    ["a 3 s clip", () => mockProbeMediaDuration.mockResolvedValue(3)],
    ["an unmeasured clip", () => mockProbeMediaDuration.mockRejectedValue(new Error("probe failed"))],
  ])("edit with %s: recorded, queued and reserved exactly as the node without the setting", async (_name, probe) => {
    probe()
    const asked = await runGenerateVideo(gvNode({ referenceTaskType: "edit" }))
    probe()
    const plain = await runGenerateVideo(gvNode())
    expect(asked.queued).toStrictEqual(plain.queued)
    expect(asked.inputData).toStrictEqual(plain.inputData)
    expect(asked.reservedId).toBe(plain.reservedId)
    expect(asked.reservedId).toBe(plain.build.modelIdentifier)
  })

  it("extend at Auto length: adaptive at 8 s, reserved for 8 s", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const run = await runGenerateVideo(gvNode({ referenceTaskType: "extend", duration: -1 }))
    expect(run.queued).toMatchObject({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: 8 })
    expect(run.inputData).toMatchObject({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: 8 })
    const args = run.build.videoCreditIdArgs!
    expect(run.reservedId).toBe(buildVideoCreditModelIdentifier(args.provider, 8, args.sound, args.mode, args.sizeOrMode, args.resolution, args.hasVideoRef))
    expect(run.reservedId).toBe(routeId({ ...GV_DATA, duration: -1, referenceTaskType: "extend" }, [6]))
  })

  it("extend at 5 s: adaptive at 5 s, the built id", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const run = await runGenerateVideo(gvNode({ referenceTaskType: "extend" }))
    expect(run.queued).toMatchObject({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: 5 })
    expect(run.reservedId).toBe(run.build.modelIdentifier)
  })

  it("reference: only the key is added — ratio, length and id as without it", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const asked = await runGenerateVideo(gvNode({ referenceTaskType: "reference" }))
    const plain = await runGenerateVideo(gvNode())
    expect(asked.queued).toStrictEqual({ ...plain.queued, referenceTaskType: "reference" })
    expect(asked.inputData).toStrictEqual({ ...plain.inputData, referenceTaskType: "reference" })
    expect(asked.reservedId).toBe(plain.reservedId)
  })

  it("a draft edit: recorded, queued and reserved as the same edit at 480p without Draft — the route's own id", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const asked = await runGenerateVideo(gvNode({ draft: true, referenceTaskType: "edit" }))
    const plain = await runGenerateVideo(gvNode({ resolution: "480p", referenceTaskType: "edit" }))
    for (const sent of [asked.queued, asked.inputData]) {
      expect(sent).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1, resolution: "480p", draft: true })
    }
    expect(asked.queued).toStrictEqual({ ...plain.queued, draft: true })
    expect(asked.inputData).toStrictEqual({ ...plain.inputData, draft: true })
    expect(asked.reservedId).toBe(plain.reservedId)
    expect(asked.checkedId).toBe(plain.checkedId)
    expect(asked.reservedId).toBe(routeId({ ...GV_DATA, draft: true, referenceTaskType: "edit" }, [6]))
    expect(asked.reservedId).not.toBe((await runGenerateVideo(gvNode({ draft: true }))).reservedId)
  })

  it("fail safe: a requested edit with no price arguments goes out as built, undeclared, at the built id, with one warning", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const n = gvNode({ referenceTaskType: "edit" })
      const build = realBuildPayload(n, "test-job-id", { referenceVideoUrls: [CLIP] })
      const { videoCreditIdArgs: _args, ...withoutArgs } = build
      vi.clearAllMocks()
      mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
      mockSeedance2FromDurations.mockReturnValue(500)
      mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
      mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 500, watermark: false })
      mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
      built.result = withoutArgs as unknown as Record<string, unknown>
      await expect(executeNode(n, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

      const queued = queuedPayload()
      expect(queued).not.toHaveProperty("referenceTaskType")
      expect(build.payload.referenceTaskType, "the build requested it").toBe("edit")
      expect(queued).toMatchObject({ ...withoutKey(build.payload), usageLogId: "usage-1", aspectRatio: "16:9", duration: 5 })
      expect(writtenInputData()).not.toHaveProperty("referenceTaskType")
      expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe(build.modelIdentifier)
      const unpricedWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("generate-video") && String(c[0]).includes("price"))
      expect(unpricedWarnings).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})

// The reservation override reads the RESOLVED type off the stamped payload: a
// declared `reference` with an automatic length is held at the worst case by the
// hold rule (tested beside it), so the override must hand that rule the type.
describe("node-executor — the reservation override reads the resolved task type", () => {
  it("a payload requesting reference at Auto with a 5 s clip prices with referenceTaskType: reference", async () => {
    mockProbeMediaDuration.mockResolvedValue(5)
    setEditPayload("https://cdn.example.com/five.mp4", { referenceTaskType: "reference", prompt: "a cat in the style of @video_1" })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    expect(mockSeedance2FromDurations).toHaveBeenCalledTimes(1)
    expect(mockSeedance2FromDurations).toHaveBeenCalledWith(expect.objectContaining({ durationsSec: [5], requestedDuration: -1, referenceTaskType: "reference" }))
    expect(queuedPayload()).toMatchObject({ referenceTaskType: "reference" })
  })

  it("the edit's resolved type, a draft's as any run's, and none for a payload that requests nothing", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    setEditPayload("https://cdn.example.com/six.mp4")
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
    expect(mockSeedance2FromDurations.mock.calls[0]![0]).toMatchObject({ referenceTaskType: "edit" })

    for (const [extra, priced] of [
      [{ draft: true, referenceTaskType: "reference" }, "reference"],
      [{ referenceTaskType: undefined }, undefined],
    ] as const) {
      vi.clearAllMocks()
      mockSeedance2FromDurations.mockReturnValue(500)
      mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 500, watermark: false })
      mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
      mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
      mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
      mockProbeMediaDuration.mockResolvedValue(6)
      setEditPayload("https://cdn.example.com/six.mp4", extra)
      await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
      const args = mockSeedance2FromDurations.mock.calls[0]![0] as Record<string, unknown>
      expect(args, JSON.stringify(extra)).toHaveProperty("referenceTaskType", priced)
    }
  })
})
