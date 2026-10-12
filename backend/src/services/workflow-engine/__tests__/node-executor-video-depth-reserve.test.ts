/**
 * Video Depth on a workflow run: the clip is measured BEFORE anything is
 * reserved (`stampVideoDepthInput`, the route preHandler's twin), so
 *   - a clip the route would refuse (over fal's 2,400-frame cap) leaves NO jobs
 *     row, no usage log and no reservation, and the node fails with the route's
 *     own code (`video_too_long`);
 *   - a measurable clip reserves its length's own row — the SAME id at the
 *     affordability preflight and at the reservation (hence the usage log) —
 *     not buildPayload's provider placeholder.
 *
 * Harness cloned from node-executor-edit-plan-reserve.test.ts: every external
 * dep is stubbed; reserveCredits throws a sentinel right after being called so
 * the flow short-circuits before pollJobToCompletion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockProbeVideoSource,
  mockGetAppSettings,
  mockDeleteEq,
  built,
  perMinute,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockDeleteEq: vi.fn(),
  built: { result: {} as Record<string, unknown> },
  perMinute: { value: false },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const deleteFn = vi.fn().mockReturnValue({ eq: mockDeleteEq })
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

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The video-depth stamp (lib/video-depth-input.ts) probes through this module;
// mocking the resolved id intercepts it.
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: mockProbeVideoSource, probeMediaDuration: vi.fn() }))

// Per started minute (decided 2026-10-07): the capability the executor asks.
vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => perMinute.value }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "vd1", type: "video-depth", data: {} }, appliedMappings: [] }),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))
vi.mock("@nodaro/prompts", () => ({
  appendField: vi.fn((a: string) => a), appendMusicMeta: vi.fn(), assembleImageInput: vi.fn(() => ({ prompt: "", referenceImageUrls: [] })),
  assembleSunoInput: vi.fn(() => ({})), buildCharacterPrompt: vi.fn(() => ""), buildCreaturePrompt: vi.fn(() => ""),
  buildFaceTemplateInputs: vi.fn(() => ({})), buildImagePrompt: vi.fn(() => ({ prompt: "" })), buildLocationPrompt: vi.fn(() => ""),
  buildObjectPrompt: vi.fn(() => ""), buildScenePrompt: vi.fn(() => ""), characterLockToRefLock: vi.fn(),
  collectIdentityLockClause: vi.fn(() => ""), composeSoundHintFromConnections: vi.fn(() => null),
  getParameterPromptHint: vi.fn(() => ""), pickerFanoutTargets: vi.fn(() => []), resolveVideoReferenceCore: vi.fn(() => ({})),
  truncateForField: vi.fn((s: string) => s), computeLlmChatFields: vi.fn(), computeNodePrompt: vi.fn(), applyPromptAffixes: vi.fn((s: string) => s),
}))
vi.mock("@nodaro/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared")>()),
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e: unknown, node: unknown) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
  SOCIAL_POST_NODE_TYPES: new Set<string>(),
  pickerFanoutTargets: vi.fn().mockReturnValue([]),
  computeLlmChatFields: vi.fn(),
  computeNodePrompt: vi.fn(),
  resolveNodeRefs: vi.fn(),
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

function makeNode(): SimpleNode {
  return { id: "vd1", type: "video-depth", data: {} }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

describe("node-executor — video-depth measures the clip before reserving", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq.mockResolvedValue({ error: null })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    perMinute.value = false
    built.result = {
      jobName: "video-depth",
      queueName: "video-generation",
      modelIdentifier: "video-depth-anything",
      payload: {
        jobId: "test-job-id",
        videoUrl: "https://cdn.example/clip.mp4",
        provider: "video-depth-anything",
        modelSize: "large",
        colormap: "grayscale",
      },
    }
  })

  it("a 200 s clip (6,000 frames at 30 fps) is refused as video_too_long: the jobs row is deleted and nothing is reserved", async () => {
    mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 200, fps: 30 })
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).then(
      () => { throw new Error("executeNode should have refused the clip") },
      (e: unknown) => e as Error & { errorCode?: string },
    )
    expect(err.errorCode).toBe("video_too_long")
    expect(err.message).toMatch(/2,400/)
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockCheckCredits).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("an unreadable clip is refused as video_unreadable, before anything is reserved", async () => {
    mockProbeVideoSource.mockRejectedValue(new Error("ffprobe exited 1"))
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).then(
      () => { throw new Error("executeNode should have refused the clip") },
      (e: unknown) => e as Error & { errorCode?: string },
    )
    expect(err.errorCode).toBe("video_unreadable")
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("a 40 s clip reserves video-depth-anything:60s at BOTH gates, and the payload carries the stamp", async () => {
    mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 40, fps: 30 })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )
    expect(mockProbeVideoSource).toHaveBeenCalledTimes(1)
    expect(mockProbeVideoSource).toHaveBeenCalledWith("https://cdn.example/clip.mp4")

    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const [userId, jobId, modelIdentifier] = mockReserveCredits.mock.calls[0] as [string, string, string]
    expect(userId).toBe("user-1")
    expect(jobId).toBe("test-job-id")
    expect(modelIdentifier).toBe("video-depth-anything:60s")
    expect(mockCheckCredits).toHaveBeenCalledTimes(1)
    expect((mockCheckCredits.mock.calls[0] as unknown[])[1]).toBe("video-depth-anything:60s")

    expect(built.result.payload).toMatchObject({ duration_seconds: 40, bucketKey: "video-depth-anything:60s" })
    // The stamp did not refuse: any row cleanup here is the reservation
    // sentinel's own failure path, AFTER the reservation was attempted.
    for (const order of mockDeleteEq.mock.invocationCallOrder) {
      expect(order).toBeGreaterThan(mockReserveCredits.mock.invocationCallOrder[0]!)
    }
  })
})
