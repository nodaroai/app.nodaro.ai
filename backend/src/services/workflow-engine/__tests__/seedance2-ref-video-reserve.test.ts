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
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeMediaDuration: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockSeedance2FromUrls: vi.fn(),
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
  const deleteEqFn = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
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
}))

// ffmpeg probe (also referenced by the shared helper; mocked for safety).
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mockProbeMediaDuration }))

// payload-builder stub: a Seedance 2 i2v node with a connected reference video.
// The orchestrator reads provider/resolution/duration/referenceVideoUrls from
// the built payload to compute the override.
vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn().mockReturnValue({
    jobName: "image-to-video",
    queueName: "video-generation",
    modelIdentifier: "seedance-2:8s:720p-ref",
    payload: {
      jobId: "test-job-id",
      provider: "seedance-2",
      resolution: "720p",
      duration: 8,
      imageUrl: "https://in.png",
      referenceVideoUrls: ["https://ref.mp4"],
    },
  }),
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
vi.mock("@nodaro/shared", () => ({
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e: unknown, node: unknown) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
  SOCIAL_POST_NODE_TYPES: new Set<string>(),
  pickerFanoutTargets: vi.fn().mockReturnValue([]),
  computeLlmChatFields: vi.fn(),
  computeNodePrompt: vi.fn(),
  resolveNodeRefs: vi.fn(),
  isSeedance2Provider: (p: unknown) => typeof p === "string" && p.startsWith("seedance-2"),
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

describe("node-executor — Seedance 2 ref-video reservation (Task A3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 0% markup → post-markup override == base, so we assert the pure base.
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    // 6s reference video; output 8s, 720p → ceil(6.25 × 14) = 88.
    mockProbeMediaDuration.mockResolvedValue(6)
    mockSeedance2FromUrls.mockResolvedValue(88)
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    // Short-circuit before pollJobToCompletion hangs.
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
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
