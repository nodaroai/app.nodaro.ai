/**
 * The restriction gate at the workflow run's payload write
 * (node-executor.ts, before `update({ input_data })`).
 *
 * A DAG child's real payload is written past the insert funnel's gate
 * (lib/insert-job.ts), so the executor asks the gate again: a file an
 * administrator restricted after a complaint (migration 581) is not an input
 * to any job. The refusal deletes the placeholder row, reserves nothing and
 * carries `errorCode: "content_restricted"` with the proxies' sentence.
 *
 * Every external dependency is stubbed, as in node-executor-free-tier-gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { gate, mockCheckCredits, mockReserveCredits, mockQueueAdd } = vi.hoisted(() => ({
  gate: { restrictedKey: null as string | null, asked: [] as unknown[] },
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("@/lib/content-restriction-gate.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/content-restriction-gate.js")>("@/lib/content-restriction-gate.js")
  return {
    ...actual,
    // The placeholder row's insert passes the funnel's gate first (its
    // input holds no resolved address yet); the payload write is the second
    // ask, and the one the restricted key answers.
    restrictedInputKey: vi.fn(async (input: unknown) => {
      gate.asked.push(input)
      return gate.asked.length >= 2 ? gate.restrictedKey : null
    }),
  }
})

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
    payload: { jobId: "test-job-id", provider: "gemini-omni-video" },
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
  gate.restrictedKey = null
  gate.asked.length = 0
  deletedIds.length = 0
  updatePatches.length = 0
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500, watermark: false })
  // The reservation throws a sentinel so the allowed path stops cleanly
  // before polling the job (the full happy path waits on a status flip).
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

describe("node-executor: the restriction gate at the payload write", () => {
  it("a restricted input deletes the placeholder row, writes no payload, reserves nothing, and says why", async () => {
    gate.restrictedKey = "videos/evidence.mp4"
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({
      errorCode: "content_restricted",
      message: "This content is not available.",
    })
    // Refused at the second ask: the one BEFORE the soundtrack render and
    // the duration probes read any clip (the funnel's placeholder was clean).
    expect(gate.asked).toHaveLength(2)
    expect(deletedIds).toEqual(["test-job-id"])
    expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("an input the gate clears is written as before, and the run goes on to its reservation", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    // Asked three times on the way through: the funnel, the step before the
    // soundtrack and the probes, and the payload write.
    expect(gate.asked).toHaveLength(3)
    // The payload is written and the reservation attempted (the sentinel's
    // own clean-up of the row is the executor's, not the gate's).
    expect(updatePatches.some((p) => "input_data" in p)).toBe(true)
    expect(mockReserveCredits).toHaveBeenCalled()
  })
})
