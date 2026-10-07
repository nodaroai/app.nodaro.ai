/**
 * The rewritten edit-plan reserve id must reach BOTH checkCredits and
 * reserveCredits (hence the usage log) — not just the payload.
 *
 * `modelIdentifier` is `const` in executeWorkerNode (buildPayload's
 * transcript/ceiling basis). For a URL/reference-audio master,
 * `computeEditPlanReserveId` ffprobes the master and the executor keys the
 * reservation off the returned bucket id via `reserveModelIdentifier`. This test
 * pins that wiring: a 59.4-min master reserves `edit-plan:tighten:standard:60m`
 * (not the `:180m` buildPayload emitted), the same id reaches checkCredits, and
 * the payload's `reservedCreditId` (what the plugin gate reads) is rewritten.
 *
 * Mirrors seedance2-ref-video-reserve.test.ts: every external dep is stubbed so
 * the test runs in pure Node; reserveCredits throws a sentinel right after being
 * called so the flow short-circuits before pollJobToCompletion hangs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockProbeMediaDuration,
  mockGetAppSettings,
  built,
  perMinute,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeMediaDuration: vi.fn(),
  mockGetAppSettings: vi.fn(),
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
  const deleteFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
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

// The edit-plan reserve probe reads probeMediaDuration through this module
// (via lib/edit-plan-pricing.ts); mocking the resolved id intercepts it.
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mockProbeMediaDuration }))

// Per started minute (decided 2026-10-07): the capability the executor asks.
vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => perMinute.value }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "ep1", type: "edit-plan", data: {} }, appliedMappings: [] }),
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
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

function makeNode(): SimpleNode {
  return { id: "ep1", type: "edit-plan", data: { mode: "tighten", planTier: "standard" } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

describe("node-executor — edit-plan reserve keys off the ffprobed bucket id", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    // A 59.4-min master → the 60m bucket (buildPayload emitted the :180m ceiling).
    mockProbeMediaDuration.mockResolvedValue(3564)
    perMinute.value = false
    built.result = {
      jobName: "edit-plan",
      queueName: "video-generation",
      modelIdentifier: "edit-plan:tighten:standard:180m",
      payload: {
        jobId: "test-job-id",
        mode: "tighten",
        planTier: "standard",
        sources: [{ id: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" }],
        reservedCreditId: "edit-plan:tighten:standard:180m",
      },
    }
  })

  it("reserves the :60m id (not the :180m buildPayload emitted), and it reaches BOTH gates + the payload", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )

    // Exactly ONE probe per run — the master. (The ref-video gate early-returns
    // for a payload with no referenceVideoUrls, so it adds no second probe.)
    expect(mockProbeMediaDuration).toHaveBeenCalledTimes(1)
    expect(mockProbeMediaDuration).toHaveBeenCalledWith("https://cdn.example/episode.m4a")

    // reserveCredits — and therefore the usage log it writes — got the rewritten id.
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const [userId, jobId, modelIdentifier] = mockReserveCredits.mock.calls[0] as [string, string, string]
    expect(userId).toBe("user-1")
    expect(jobId).toBe("test-job-id")
    expect(modelIdentifier).toBe("edit-plan:tighten:standard:60m")

    // The affordability preflight was keyed off the same id.
    expect(mockCheckCredits).toHaveBeenCalledTimes(1)
    expect((mockCheckCredits.mock.calls[0] as unknown[])[1]).toBe("edit-plan:tighten:standard:60m")

    // The payload the plugin gate reads carries the rewritten bucket + probe.
    const enqueuedPayload = (built.result.payload as { reservedCreditId?: string; probedDurationSec?: number })
    expect(enqueuedPayload.reservedCreditId).toBe("edit-plan:tighten:standard:60m")
    expect(enqueuedPayload.probedDurationSec).toBe(3564)
  })

  it("an unprobeable master keeps buildPayload's :180m basis (never lowers the hold)", async () => {
    mockProbeMediaDuration.mockRejectedValue(new Error("ffprobe exited 1"))

    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )

    const [, , modelIdentifier] = mockReserveCredits.mock.calls[0] as [string, string, string]
    expect(modelIdentifier).toBe("edit-plan:tighten:standard:180m")
    expect((built.result.payload as { reservedCreditId?: string }).reservedCreditId).toBe(
      "edit-plan:tighten:standard:180m",
    )
  })

  // Per started minute (decided 2026-10-07): with the plugin's capability the
  // reserve is the probed length's started minutes, and buildPayload is told so
  // (a length recorded on the master uses the same rule; a transcript basis
  // keeps the step, review round F4).
  it("with the per-minute capability a 44.2-min master reserves :45m, and buildPayload is told", async () => {
    perMinute.value = true
    mockProbeMediaDuration.mockResolvedValue(2652)
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    const [, , modelIdentifier] = mockReserveCredits.mock.calls[0] as [string, string, string]
    expect(modelIdentifier).toBe("edit-plan:tighten:standard:45m")
    expect((mockCheckCredits.mock.calls[0] as unknown[])[1]).toBe("edit-plan:tighten:standard:45m")
    expect((built.result.payload as { reservedCreditId?: string }).reservedCreditId).toBe("edit-plan:tighten:standard:45m")
    const ctxArg = (vi.mocked(buildPayload).mock.calls[0] as unknown[])[4] as { editPlanPerMinute?: boolean }
    expect(ctxArg.editPlanPerMinute).toBe(true)
  })

  it("without it the same master reserves the :60m step", async () => {
    mockProbeMediaDuration.mockResolvedValue(2652)
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    const [, , modelIdentifier] = mockReserveCredits.mock.calls[0] as [string, string, string]
    expect(modelIdentifier).toBe("edit-plan:tighten:standard:60m")
  })
})
