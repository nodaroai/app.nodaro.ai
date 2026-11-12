/**
 * Nodaro Video Upscale on a workflow run: the stamp (stampNodaroVideoUpscale)
 * copies and measures the clip after the placeholder jobs row exists, so every
 * way it can end without a plan drops that row and the copy stored for it
 * (`dropRefusedStampedJob`) — a refusal (the route's code and sentence) and any
 * other failure (rethrown as it is) — before anything is reserved. The copy is
 * given the run's stop signal (`runStopSignal`), so a draining worker or a
 * cancelled run stops fetching.
 *
 * Harness cloned from node-executor-seedance-draft-finalize.test.ts:
 * reserveCredits throws a sentinel right after being called so the flow
 * short-circuits before pollJobToCompletion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockGetAppSettings,
  mockDeleteEq,
  mockUpdate,
  mockStamp,
  mockDiscardScratch,
  built,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockUpdate: vi.fn(),
  mockStamp: vi.fn(),
  mockDiscardScratch: vi.fn(async (_jobId: string) => undefined),
  built: { result: {} as Record<string, unknown> },
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
  const updateFn = mockUpdate.mockReturnValue({ eq: eqFn })
  const deleteFn = vi.fn().mockReturnValue({ eq: mockDeleteEq })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  const draftQuery: Record<string, unknown> = {}
  draftQuery.eq = () => draftQuery
  draftQuery.limit = async () => ({ data: [], error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({ insert: insertFn, update: updateFn, delete: deleteFn, select: vi.fn(() => draftQuery) }),
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

vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => false }))

// The plan itself is covered in lib/__tests__/nodaro-video-upscale-plan.test.ts;
// here only what the executor does when the stamp refuses or throws.
vi.mock("@/lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-scratch.js")>()),
  discardDeletedJobScratch: mockDiscardScratch,
}))
// The tier row's base for the stamped seconds (the real helper reads the price table).
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  unitRateBaseCredits: vi.fn(async () => 38),
}))
vi.mock("@/lib/nodaro-video-upscale-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nodaro-video-upscale-plan.js")>()),
  stampNodaroVideoUpscale: mockStamp,
}))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "up1", type: "video-upscale", data: {} }, appliedMappings: [] }),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))
// @nodaro/prompts was mocked whole here; split per entry, the entries without an override stay mocked empty (tools/package-entries/codemod.mjs).
vi.mock("@nodaro/prompts/assembly", () => ({
  appendField: vi.fn((a: string) => a), appendMusicMeta: vi.fn(), assembleImageInput: vi.fn(() => ({ prompt: "", referenceImageUrls: [] })),
  assembleSunoInput: vi.fn(() => ({})), composeSoundHintFromConnections: vi.fn(() => null), resolveVideoReferenceCore: vi.fn(() => ({})),
  truncateForField: vi.fn((s: string) => s),
}))
vi.mock("@nodaro/prompts/catalog-packs", () => ({}))
vi.mock("@nodaro/prompts/doctrine", () => ({
  buildCharacterPrompt: vi.fn(() => ""), buildCreaturePrompt: vi.fn(() => ""),
  buildFaceTemplateInputs: vi.fn(() => ({})), buildLocationPrompt: vi.fn(() => ""),
  buildObjectPrompt: vi.fn(() => ""), characterLockToRefLock: vi.fn(),
  collectIdentityLockClause: vi.fn(() => ""),
}))
vi.mock("@nodaro/prompts/person", () => ({}))
vi.mock("@nodaro/prompts/picker-art", () => ({}))
vi.mock("@nodaro/prompts/picker-catalogs", () => ({
  getParameterPromptHint: vi.fn(() => ""), pickerFanoutTargets: vi.fn(() => []),
}))
vi.mock("@nodaro/prompts/pickers", () => ({}))
vi.mock("@nodaro/prompts/presets", () => ({}))
vi.mock("@nodaro/prompts/prompt-builder", () => ({
  buildImagePrompt: vi.fn(() => ({ prompt: "" })), buildScenePrompt: vi.fn(() => ""),
}))
vi.mock("@nodaro/prompts/prompt-fields", () => ({
  computeLlmChatFields: vi.fn(), computeNodePrompt: vi.fn(), applyPromptAffixes: vi.fn((s: string) => s),
}))
vi.mock("@nodaro/shared/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/apps")>()),
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e: unknown, node: unknown) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
}))
vi.mock("@nodaro/shared/social", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/social")>()),
  SOCIAL_POST_NODE_TYPES: new Set<string>(),
}))
vi.mock("@nodaro/shared/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/workflow")>()),
  resolveNodeRefs: vi.fn(),
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const node: SimpleNode = { id: "up1", type: "video-upscale", data: {} }

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

/** The input_data the executor wrote to the jobs row. */
function writtenInputData(): Record<string, unknown> | undefined {
  const call = mockUpdate.mock.calls.find((c) => (c[0] as { input_data?: unknown })?.input_data !== undefined)
  return call ? ((call[0] as { input_data: Record<string, unknown> }).input_data) : undefined
}

async function failure(): Promise<Error & { errorCode?: string }> {
  return executeNode(node, {}, [], [], {}, makeCtx()).then(
    () => { throw new Error("executeNode should have failed") },
    (e: unknown) => e as Error & { errorCode?: string },
  )
}

describe("node-executor — the Nodaro Video Upscale stamp never leaves its placeholder row", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq.mockResolvedValue({ error: null })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    built.result = {
      jobName: "video-upscale",
      queueName: "video-generation",
      modelIdentifier: "nodaro-video-upscale:1080p:per-4s",
      payload: { jobId: "test-job-id", provider: "nodaro-video-upscale", videoUrl: "https://cdn.example/clip.mp4", tier: "1080p", targetResolution: "1080p" },
    }
  })

  it("a refusal deletes the row and fails the node with the route's code, before anything is reserved", async () => {
    mockStamp.mockResolvedValue({ ok: false, refusal: { code: "video_too_long", message: "This clip is 72.3 seconds long." } })
    const err = await failure()
    expect(err.errorCode).toBe("video_too_long")
    expect(err.message).toBe("This clip is 72.3 seconds long.")
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockDiscardScratch).toHaveBeenCalledWith("test-job-id")
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(writtenInputData()).toBeUndefined()
  })

  it("any other failure of the stamp deletes the row too, and is rethrown as it is", async () => {
    const boom = new Error("storage write failed")
    mockStamp.mockRejectedValue(boom)
    const err = await failure()
    expect(err).toBe(boom)
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockDiscardScratch).toHaveBeenCalledWith("test-job-id")
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(writtenInputData()).toBeUndefined()
  })

  it("a stamped plan goes on to its input_data and the reservation", async () => {
    mockStamp.mockResolvedValue({ ok: true, patch: { tier: "1080p", billedSec: 10, sourceDurationSec: 9.4, sourceSizeBytes: 12_000_000 } })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    // The copy was given the run's stop signal.
    expect(mockStamp.mock.calls[0]![2]).toMatchObject({ userId: "user-1", jobId: "test-job-id", signal: expect.any(AbortSignal) })
    // Held at its tier's row.
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("nodaro-video-upscale:1080p:per-4s")
    expect(writtenInputData()).toMatchObject({ provider: "nodaro-video-upscale", billedSec: 10 })
  })
})
