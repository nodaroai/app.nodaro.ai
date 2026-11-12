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

  it("a draft edit of a 6 s clip goes out undeclared", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    setEditPayload("https://cdn.example.com/draft.mp4", { draft: true })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)

    expect(writtenInputData()).not.toHaveProperty("referenceTaskType")
    expect(queuedPayload()).not.toHaveProperty("referenceTaskType")
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

  it("the edit's resolved type, and none for a draft (dropped) or a payload that requests nothing", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    setEditPayload("https://cdn.example.com/six.mp4")
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
    expect(mockSeedance2FromDurations.mock.calls[0]![0]).toMatchObject({ referenceTaskType: "edit" })

    for (const extra of [{ draft: true, referenceTaskType: "reference" }, { referenceTaskType: undefined }]) {
      vi.clearAllMocks()
      mockSeedance2FromDurations.mockReturnValue(500)
      mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 500, watermark: false })
      mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
      mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
      mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
      mockProbeMediaDuration.mockResolvedValue(6)
      setEditPayload("https://cdn.example.com/six.mp4", extra)
      await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
      const priced = mockSeedance2FromDurations.mock.calls[0]![0] as Record<string, unknown>
      expect(priced, JSON.stringify(extra)).toHaveProperty("referenceTaskType", undefined)
    }
  })
})
