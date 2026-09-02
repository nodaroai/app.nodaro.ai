/**
 * Task A3 — Orchestrator reservation ffprobes Seedance 2 reference videos.
 *
 * Workflow (orchestrator) runs reserve credits in `node-executor.ts` via
 * `CreditsService.reserveCredits(userId, jobId, modelIdentifier, …)` — NOT via
 * the route's `creditGuard`. For a Seedance 2 node WITH connected reference
 * videos, KIE bills `unit × (input_video_duration + output_duration)`, but the
 * seeded `-ref` credit composite only encodes the per-8s OUTPUT rate (50cr for
 * 720p/8s). `commit_credits` can only refund — never up-charge — so the
 * orchestrator must reserve the FULL scaled BASE up front, exactly like the
 * route's `computeCredits` hook (A2).
 *
 * This test asserts the orchestrator passes a `creditOverride` of the SCALED
 * base (`ceil(6.25 × (6 + 8)) = 88`), not the plain `-ref` composite (50).
 *
 * Mirrors `node-executor-free-tier-gate.test.ts`: every external dep is stubbed
 * so the test runs in pure Node. `reserveCredits` throws a sentinel right after
 * being called so the flow short-circuits before `pollJobToCompletion` hangs;
 * we assert on the captured `creditOverride` option.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — declared before vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockCheckCredits,
  mockReserveCredits,
  mockProbeMediaDuration,
  mockGetAppSettings,
  mockSeedance2FromUrls,
  mockSeedance2FromDurations,
  mockH3FromUrls,
  mockH3FromDurations,
  mockH3RefImageCount,
  mockJobDelete,
  mockJobInsert,
  built,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeMediaDuration: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockSeedance2FromUrls: vi.fn(),
  mockSeedance2FromDurations: vi.fn(),
  mockH3FromUrls: vi.fn(),
  mockH3FromDurations: vi.fn(),
  mockH3RefImageCount: vi.fn(),
  mockJobDelete: vi.fn(),
  mockJobInsert: vi.fn(),
  // Mutable so a test can dispatch a different provider / reference set.
  built: {
    result: {} as Record<string, unknown>,
  },
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  // `mockJobDelete` records the deleted id so a test can assert the placeholder
  // jobs row is GONE when the duration gate rejects.
  const deleteFn = vi.fn().mockReturnValue({ eq: mockJobDelete.mockResolvedValue({ error: null }) })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = mockJobInsert.mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCredits: mockCheckCredits,
    reserveCredits: mockReserveCredits,
  },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

// Markup source — node-executor mirrors the route guard (base → ceil(base × (1+markup%))).
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The shared ee billing helper is loaded via DYNAMIC import in node-executor;
// mocking the module id intercepts that dynamic import too.
vi.mock("@/ee/billing/seedance2-ref-video-credits.js", () => ({
  seedance2RefVideoBaseCreditsFromUrls: mockSeedance2FromUrls,
  seedance2RefVideoBaseCreditsFromDurations: mockSeedance2FromDurations,
}))

vi.mock("@/ee/billing/minimax-h3-credits.js", () => ({
  minimaxH3BaseCreditsFromUrls: mockH3FromUrls,
  minimaxH3BaseCreditsFromDurations: mockH3FromDurations,
  minimaxH3BillableRefImageCount: mockH3RefImageCount,
  MINIMAX_H3_FREE_INPUT_IMAGES: 5,
}))

// ffmpeg probe (also referenced by the shared helper; mocked for safety).
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mockProbeMediaDuration }))

// payload-builder stub: a Seedance 2 i2v node with a connected reference video.
// The orchestrator reads provider/resolution/duration/referenceVideoUrls from
// the built payload to compute the override.
vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "image-to-video", data: {} }, appliedMappings: [] }),
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
  truncateForField: vi.fn((s: string) => s),
}))
// Partial mock: the engine-shaped helpers stay stubbed, but everything the
// reference-video duration gate reads (VIDEO_REF_VIDEO_DURATION_LIMITS,
// checkRefVideoDurations, VIDEO_REF_LIMITS_BY_PROVIDER, isMinimaxH3Provider)
// comes from the REAL package — the whole point is to exercise the shipped
// bounds, not a re-typed copy of them.
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

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

function makeNode(): SimpleNode {
  return {
    id: "n1",
    type: "image-to-video",
    data: { provider: "seedance-2", resolution: "720p", duration: 8 },
  }
}

/** The payload `buildPayload` hands back for this dispatch. */
function setBuiltPayload(payload: Record<string, unknown>, modelIdentifier: string): void {
  built.result = {
    jobName: "image-to-video",
    queueName: "video-generation",
    modelIdentifier,
    payload: { jobId: "test-job-id", ...payload },
  }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Common mock state for every dispatch in this file. */
function resetHarness(): void {
  vi.clearAllMocks()
  // 0% markup → post-markup override == base, so we assert the pure base.
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  // 6s reference video; output 8s, 720p → ceil(6.25 × 14) = 88.
  mockProbeMediaDuration.mockResolvedValue(6)
  mockSeedance2FromUrls.mockResolvedValue(88)
  mockSeedance2FromDurations.mockReturnValue(88)
  mockH3FromUrls.mockResolvedValue(1187)
  mockH3FromDurations.mockReturnValue(1187)
  mockH3RefImageCount.mockReturnValue(0)
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
  // Short-circuit before pollJobToCompletion hangs.
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
}

describe("node-executor — Seedance 2 ref-video reservation (Task A3)", () => {
  beforeEach(() => {
    resetHarness()
    setBuiltPayload(
      {
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        imageUrl: "https://in.png",
        referenceVideoUrls: ["https://ref.mp4"],
      },
      "seedance-2:8s:720p-ref",
    )
  })

  it("reserves the scaled base (88), not the plain -ref composite (50)", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)

    // The shared helper was consulted with the resolved ref video + output spec.
    expect(mockSeedance2FromUrls).toHaveBeenCalledTimes(1)
    expect(mockSeedance2FromUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "seedance-2",
        resolution: "720p",
        outputDurationSec: 8,
        referenceVideoUrls: ["https://ref.mp4"],
      }),
    )

    // reserveCredits got the scaled BASE override (88), keyed by the -ref id.
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const [userId, jobId, modelIdentifier, , , options] = mockReserveCredits.mock.calls[0] as [
      string, string, string, number, number, { creditOverride?: number } | undefined,
    ]
    expect(userId).toBe("user-1")
    expect(jobId).toBe("test-job-id")
    expect(modelIdentifier).toBe("seedance-2:8s:720p-ref")
    expect(options?.creditOverride).toBe(88)
  })
})

// ---------------------------------------------------------------------------
// Task 14 (B) — the DAG duration gate
//
// The routes reject an out-of-bounds reference clip in a preHandler, but a
// workflow / published-app run never touches a route: `executeWorkerNode`
// reserved credits and dispatched, and the run only learned about the 52.8s
// clip from KIE's reject ("video duration 52838 ms, expected [2000, 15000] ms")
// — after paying, and taking every sibling node down with it.
//
// Pinned here: the gate throws BEFORE the reservation, leaves NO jobs row, and
// carries the user-facing sentence as the error message (which the orchestrator
// stores verbatim in `nodeStates[nodeId].error`) plus the stable
// `video_too_long` code.
// ---------------------------------------------------------------------------

describe("node-executor — reference-video duration gate (Task 14)", () => {
  beforeEach(() => {
    resetHarness()
  })

  it("minimax-h3: a 52.8s clip throws before the reservation and leaves no jobs row", async () => {
    mockProbeMediaDuration.mockResolvedValue(52.838)
    setBuiltPayload(
      { provider: "minimax-h3", duration: 8, referenceVideoUrls: ["https://ref.mp4"] },
      "minimax-h3:8s",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /Each reference video must be between 2 and 15 seconds — one is 52\.8s/,
    )

    // Nothing was reserved, and nothing was even checked for affordability.
    expect(mockCheckCredits).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockH3FromUrls).not.toHaveBeenCalled()
    expect(mockH3FromDurations).not.toHaveBeenCalled()
    // The placeholder row created for the payload build is deleted again.
    expect(mockJobInsert).toHaveBeenCalledTimes(1)
    expect(mockJobDelete).toHaveBeenCalledWith("id", "test-job-id")
  })

  it("carries the stable `video_too_long` code the node state branches on", async () => {
    mockProbeMediaDuration.mockResolvedValue(52.838)
    setBuiltPayload(
      { provider: "minimax-h3", duration: 8, referenceVideoUrls: ["https://ref.mp4"] },
      "minimax-h3:8s",
    )

    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e)
    expect((err as { errorCode?: string }).errorCode).toBe("video_too_long")
    // The message is a finished sentence — the orchestrator surfaces it as-is.
    expect((err as Error).message).toContain("Trim it (a Trim Video node upstream works)")
  })

  it("minimax-h3: three legal clips over the 15s COMBINED cap are rejected too", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    setBuiltPayload(
      {
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: ["https://a.mp4", "https://b.mp4", "https://c.mp4"],
      },
      "minimax-h3:8s",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /must not exceed 15 seconds in total — these add up to 18\.0s/,
    )
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("minimax-h3: a legal clip reserves from the gate's probe — ONE ffprobe per clip (R15)", async () => {
    mockProbeMediaDuration.mockResolvedValue(5)
    setBuiltPayload(
      { provider: "minimax-h3", duration: 8, referenceVideoUrls: ["https://ref.mp4"] },
      "minimax-h3:8s",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )

    // The gate probed once; the pricer read THAT array instead of re-probing.
    expect(mockProbeMediaDuration).toHaveBeenCalledTimes(1)
    expect(mockH3FromUrls).not.toHaveBeenCalled()
    expect(mockH3FromDurations).toHaveBeenCalledWith(
      expect.objectContaining({ outputDurationSec: 8, durationsSec: [5] }),
    )
    expect(mockReserveCredits).toHaveBeenCalledWith(
      "user-1", "test-job-id", "minimax-h3:8s", 0, 0,
      expect.objectContaining({ creditOverride: 1187 }),
    )
  })

  it("seedance-2-5: the same gate rejects a 52.8s clip on the seedance lane", async () => {
    mockProbeMediaDuration.mockResolvedValue(52.838)
    setBuiltPayload(
      {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://ref.mp4"],
      },
      "seedance-2-5:8s:720p-ref",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /between 2 and 30 seconds/,
    )
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockSeedance2FromUrls).not.toHaveBeenCalled()
    expect(mockSeedance2FromDurations).not.toHaveBeenCalled()
    expect(mockJobDelete).toHaveBeenCalledWith("id", "test-job-id")
  })

  it("seedance-2-5: a legal clip prices from the gate's probe (R15)", async () => {
    mockProbeMediaDuration.mockResolvedValue(6)
    setBuiltPayload(
      {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://ref.mp4"],
      },
      "seedance-2-5:8s:720p-ref",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )
    expect(mockProbeMediaDuration).toHaveBeenCalledTimes(1)
    expect(mockSeedance2FromUrls).not.toHaveBeenCalled()
    expect(mockSeedance2FromDurations).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "seedance-2-5", durationsSec: [6] }),
    )
  })

  it("a FAILED probe neither blocks the run nor lowers the reservation", async () => {
    mockProbeMediaDuration.mockRejectedValue(new Error("ffprobe exited 1"))
    setBuiltPayload(
      { provider: "minimax-h3", duration: 8, referenceVideoUrls: ["https://ref.mp4"] },
      "minimax-h3:8s",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )
    // NaN reaches the pricer verbatim, where it still costs the 15s worst case.
    const args = mockH3FromDurations.mock.calls[0]?.[0] as { durationsSec: number[] }
    expect(args.durationsSec).toHaveLength(1)
    expect(Number.isNaN(args.durationsSec[0])).toBe(true)
    expect(mockReserveCredits).toHaveBeenCalled()
  })

  it("a provider with no declared bound is never pre-probed by the gate", async () => {
    // seedance-2 has no VIDEO_REF_VIDEO_DURATION_LIMITS row: the gate returns
    // immediately and the pricer does its own probing, exactly as before.
    setBuiltPayload(
      {
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://ref.mp4"],
      },
      "seedance-2:8s:720p-ref",
    )

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )
    // The gate did NOT probe (the ee pricer is mocked, so nothing probes at all).
    expect(mockProbeMediaDuration).not.toHaveBeenCalled()
    expect(mockSeedance2FromDurations).not.toHaveBeenCalled()
    expect(mockSeedance2FromUrls).toHaveBeenCalledTimes(1)
  })
})
