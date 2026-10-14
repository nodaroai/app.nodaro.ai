/**
 * Seedance draft finalize on a workflow run: the stamp comes back as a PATCH
 * (seedanceDraftFinalizeStamp never mutates the payload) and the executor
 * merges it, so the stamped fields still reach input_data, the reservation and
 * the worker payload exactly as when the stamp wrote into the payload — and a
 * refusal still leaves no jobs row.
 *
 * Harness cloned from node-executor-video-depth-reserve.test.ts: reserveCredits
 * throws a sentinel right after being called so the flow short-circuits before
 * pollJobToCompletion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockGetAppSettings,
  mockDeleteEq,
  mockUpdate,
  mockStamp,
  built,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockUpdate: vi.fn(),
  mockStamp: vi.fn(),
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

vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => false }))

// The draft lookup itself is covered in lib/__tests__/seedance-draft-finalize.test.ts;
// here only what the executor does with the stamp it returns.
vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  seedanceDraftFinalizeStamp: mockStamp,
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

const PATCH = {
  sourceJobId: "draft-job",
  kieTaskId: "task-draft",
  reservedCreditId: "seedance-2-5-hd:4s",
  draftOutputSec: 4,
  draftHasRefVideo: false,
  draftRefVideoDurationsSec: [],
  draftAudioMux: { kind: "voice-track", audioUrl: "https://r2/track.mp3" },
  draftVideoUrl: "https://cdn.example/draft.mp4",
}

/** The input_data the executor wrote to the jobs row. */
function writtenInputData(): Record<string, unknown> | undefined {
  const call = mockUpdate.mock.calls.find((c) => (c[0] as { input_data?: unknown })?.input_data !== undefined)
  return call ? ((call[0] as { input_data: Record<string, unknown> }).input_data) : undefined
}

describe("node-executor — the Seedance draft-finalize stamp is merged, never mutated in", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq.mockResolvedValue({ error: null })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    built.result = {
      jobName: "video-upscale",
      queueName: "video-generation",
      modelIdentifier: "seedance-2-5-hd",
      payload: { jobId: "test-job-id", provider: "seedance-2-5-hd", kieTaskId: "task-draft" },
    }
  })

  it("the patch lands in input_data and the reservation; the built payload object is left as built", async () => {
    mockStamp.mockResolvedValue({ ok: true, patch: PATCH })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)

    expect(mockStamp).toHaveBeenCalledWith("video-upscale", expect.objectContaining({ kieTaskId: "task-draft" }), "user-1")
    expect(writtenInputData()).toMatchObject({ provider: "seedance-2-5-hd", ...PATCH })
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("seedance-2-5-hd:4s")
    expect((built.result.payload as Record<string, unknown>)).toStrictEqual({ jobId: "test-job-id", provider: "seedance-2-5-hd", kieTaskId: "task-draft" })
  })

  it("a refusal deletes the jobs row and fails the node with the route's code, before anything is reserved", async () => {
    mockStamp.mockResolvedValue({ ok: false, refusal: { code: "draft_expired", message: "This draft has expired." } })
    const err = await executeNode(node, {}, [], [], {}, makeCtx()).then(
      () => { throw new Error("executeNode should have refused the draft") },
      (e: unknown) => e as Error & { errorCode?: string },
    )
    expect(err.errorCode).toBe("draft_expired")
    expect(err.message).toBe("This draft has expired.")
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(writtenInputData()).toBeUndefined()
  })
})
