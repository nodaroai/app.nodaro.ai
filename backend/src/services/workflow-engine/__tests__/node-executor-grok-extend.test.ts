/**
 * Grok Extend on a workflow run: the source the upstream task names is checked
 * (stampGrokExtendSource, the route preHandler's twin) before input_data and
 * the reservation. Its patch — the matched task, the source's length and
 * resolution, the source's row — reaches input_data and the reservation, the
 * job is recorded as a grok-extend run, and a refused source leaves no jobs
 * row and nothing reserved.
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
  // Any read (the stamps of other job kinds never get this far) finds no rows.
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

// The stamp itself is covered in lib/__tests__/grok-extend-stamp.test.ts; here
// only what the executor does with what it returns.
vi.mock("@/lib/grok-extend-stamp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grok-extend-stamp.js")>()),
  stampGrokExtendSource: mockStamp,
}))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "ext1", type: "extend-video", data: { provider: "grok-extend" } }, appliedMappings: [] }),
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
import { videoQueue } from "@/lib/queue.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const node: SimpleNode = { id: "ext1", type: "extend-video", data: { provider: "grok-extend" } }

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

const BUILT_PAYLOAD = { jobId: "test-job-id", provider: "grok-extend", kieTaskId: " task-grok-src ", prompt: "she runs", duration: 10 }
const PATCH = { kieTaskId: "task-grok-src", resolution: "480p", sourceSec: 6.041667, reservedCreditId: "grok-extend:10s:480p" }

/** The input_data the executor wrote to the jobs row. */
function writtenInputData(): Record<string, unknown> | undefined {
  const call = mockUpdate.mock.calls.find((c) => (c[0] as { input_data?: unknown })?.input_data !== undefined)
  return call ? ((call[0] as { input_data: Record<string, unknown> }).input_data) : undefined
}

describe("node-executor — Grok Extend's source check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq.mockResolvedValue({ error: null })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    built.result = {
      jobName: "extend-video",
      queueName: "video-generation",
      // The build's basis before the check: the dearer row.
      modelIdentifier: "grok-extend:10s:720p",
      payload: { ...BUILT_PAYLOAD },
    }
  })

  it("holds the source's row, and records the matched task, the source and the provider grok-extend in input_data", async () => {
    mockStamp.mockResolvedValue({ ok: true, patch: PATCH })
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)

    expect(mockStamp).toHaveBeenCalledWith("extend-video", expect.objectContaining({ kieTaskId: " task-grok-src " }), "user-1")
    expect(writtenInputData()).toMatchObject({ provider: "grok-extend", resolvedModel: "grok-extend", ...PATCH })
    // The balance check and the reservation read the source's row, never the build's basis.
    expect((mockCheckCredits.mock.calls[0] as unknown[])[1]).toBe("grok-extend:10s:480p")
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("grok-extend:10s:480p")
    // A patch, never a mutation of the built payload.
    expect(built.result.payload).toStrictEqual(BUILT_PAYLOAD)
  })

  it("queues the worker the matched task, the source's length and resolution, and the reservation", async () => {
    mockStamp.mockResolvedValue({ ok: true, patch: PATCH })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 44, watermark: false })
    // The poll never resolves in this harness; the enqueue is all this needs.
    void executeNode(node, {}, [], [], {}, makeCtx()).catch(() => {})
    await vi.waitFor(() => expect(videoQueue.add).toHaveBeenCalled())
    const [jobName, queued] = vi.mocked(videoQueue.add).mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(jobName).toBe("extend-video")
    expect(queued).toMatchObject({
      jobId: "test-job-id",
      provider: "grok-extend",
      kieTaskId: "task-grok-src",
      resolution: "480p",
      sourceSec: 6.041667,
      duration: 10,
      prompt: "she runs",
      usageLogId: "usage-1",
    })
  })

  it("a refused source deletes the jobs row and fails the node with the route's code and message, before anything is reserved", async () => {
    mockStamp.mockResolvedValue({ ok: false, refusal: { code: "grok_extend_source", message: "Grok can only extend …" } })
    const err = await executeNode(node, {}, [], [], {}, makeCtx()).then(
      () => { throw new Error("executeNode should have refused the source") },
      (e: unknown) => e as Error & { errorCode?: string },
    )
    expect(err.errorCode).toBe("grok_extend_source")
    expect(err.message).toBe("Grok can only extend …")
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockCheckCredits).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(writtenInputData()).toBeUndefined()
  })
})
