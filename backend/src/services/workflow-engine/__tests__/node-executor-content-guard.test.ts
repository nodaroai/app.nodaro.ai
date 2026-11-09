/**
 * The content guard at the workflow engine's payload step
 * (node-executor.ts, `refuseProhibitedPayload`).
 *
 * A workflow step's row is a placeholder when it passes the insert funnel, so
 * this step is where the built payload (field mappings and prefix and suffix
 * included) is judged. A refusal deletes the row and reserves nothing.
 *
 * Words are placeholders (`MINORTERM` / `ADULTTERM`): the real lists are a
 * deployment's private content. Every external dependency is stubbed, as in
 * node-executor-content-restriction-gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { gate, mockCheckCredits, mockReserveCredits, mockQueueAdd, audit } = vi.hoisted(() => ({
  gate: { prompt: "a cat" },
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  audit: {
    recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
    hashGateSubject: vi.fn((_subject: unknown) => "hash-1"),
  },
}))

vi.mock("@/lib/job-policy-audit.js", () => audit)

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "image-to-video",
    queueName: "video-generation",
    modelIdentifier: "gemini-omni-video:4k:8",
    payload: { jobId: "test-job-id", provider: "gemini-omni-video", prompt: gate.prompt },
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "generate-video", data: {} }, appliedMappings: [] }),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
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
  containsMinorAgeHint: vi.fn(() => false), isMinorAge: vi.fn(() => false),
}))
vi.mock("@nodaro/prompts/pickers", () => ({}))
vi.mock("@nodaro/prompts/presets", () => ({}))
vi.mock("@nodaro/prompts/prompt-builder", () => ({
  buildImagePrompt: vi.fn(() => ({ prompt: "" })), buildScenePrompt: vi.fn(() => ""),
}))
vi.mock("@nodaro/prompts/prompt-fields", () => ({}))
vi.mock("@nodaro/shared/apps", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nodaro/shared/apps")>(),
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e, node) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
}))
vi.mock("@nodaro/shared/models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nodaro/shared/models")>(),
  isSeedance2Provider: (p: unknown) => typeof p === "string" && p.startsWith("seedance-2"),
  isMinimaxH3Provider: (p: unknown) => p === "minimax-h3",
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { supabase } from "@/lib/supabase.js"
import { __flushContentGuardAuditForTests, clearContentGuard, CONTENT_GUARD_MESSAGE, CONTENT_GUARD_POLICY_ID, registerContentGuard } from "@/lib/content-guard.js"

function makeNode(): SimpleNode {
  return { id: "n1", type: "generate-video", data: { provider: "gemini-omni-video", resolution: "1080p" } }
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

const deletedIds: string[] = []
const updatePatches: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.clearAllMocks()
  gate.prompt = "a cat"
  deletedIds.length = 0
  updatePatches.length = 0
  registerContentGuard({
    proveReady: () => true,
    id: "placeholder-guard",
    check(subject) {
      const text = subject.texts.join(" ")
      return text.includes("MINORTERM") && text.includes("ADULTTERM") ? { refused: true, reason: "placeholder-combination" } : { refused: false }
    },
  })
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500, watermark: false })
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  const mockUpdate = vi.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch)
    return { eq: vi.fn().mockResolvedValue({ error: null }) }
  })
  const mockDelete = vi.fn().mockReturnValue({
    eq: vi.fn((field: string, value: string) => {
      if (field === "id") deletedIds.push(value)
      return Promise.resolve({ error: null })
    }),
  })
  vi.mocked(supabase.from).mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: vi.fn(),
  } as unknown as ReturnType<typeof supabase.from>)
})

afterEach(async () => {
  await __flushContentGuardAuditForTests()
  clearContentGuard()
})

describe("node-executor: the content guard on the built payload", () => {
  it("a refused payload deletes the placeholder row, reserves nothing and queues nothing", async () => {
    gate.prompt = "MINORTERM ADULTTERM"
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({
      name: "JobBlockedError",
      message: CONTENT_GUARD_MESSAGE,
    })
    expect(deletedIds).toEqual(["test-job-id"])
    expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    const row = audit.recordJobPolicyDecision.mock.calls[0]![0]
    expect(row).toMatchObject({ policyId: CONTENT_GUARD_POLICY_ID, verdict: "block", userId: "user-1", jobType: "generate-video" })
    expect(JSON.stringify(row)).not.toMatch(/MINORTERM|ADULTTERM/)
  })

  it("a payload the guard clears goes on to its reservation as before", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(updatePatches.some((p) => "input_data" in p)).toBe(true)
    expect(mockReserveCredits).toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})
