/**
 * A run's Dubbing node given a link (node-executor.ts, before the dubbing
 * stamp probes the link): the dubbing service fetches the link, an import of
 * someone else's link, so the run asks the content rights gate first, with
 * the confirmation its own request put on the node and the run's way in
 * (lib/dubbing-source.ts). A refusal, or a gate that could not answer,
 * deletes the placeholder row, reserves nothing and probes nothing.
 *
 * Every external dependency is stubbed, as in node-executor-content-restriction-gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { gate, built, mockStampDubbing, mockCheckCredits, mockReserveCredits, mockQueueAdd } = vi.hoisted(() => ({
  gate: { requireImportAllowed: vi.fn(async (): Promise<void> => undefined) },
  built: { payload: {} as Record<string, unknown> },
  mockStampDubbing: vi.fn(async (): Promise<null> => null),
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
  return { ...actual, restrictedInputKey: vi.fn(async () => null) }
})
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: gate.requireImportAllowed,
}))
vi.mock("@/lib/dubbing-pricing.js", () => ({
  stampDubbingDuration: mockStampDubbing,
  projectDubbingCreditOverride: vi.fn(async () => null),
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "dubbing",
    queueName: "video-generation",
    modelIdentifier: "elevenlabs-dubbing",
    payload: built.payload,
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "dubbing", data: {} }, appliedMappings: [] }),
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

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { supabase } from "@/lib/supabase.js"
import { buildPayload } from "../payload-builder.js"

const SOURCE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
const BACKSLASH = String.fromCharCode(0x5c)

function makeNode(): SimpleNode {
  return { id: "n1", type: "dubbing", data: { targetLanguage: "fr", sourceUrl: SOURCE } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    importVia: "mcp",
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
  gate.requireImportAllowed.mockImplementation(async () => undefined)
  mockStampDubbing.mockImplementation(async () => null)
  built.payload = { jobId: "test-job-id", targetLanguage: "fr", sourceUrl: SOURCE, confirmationId: CONFIRMATION }
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

function expectNothingStarted(): void {
  expect(deletedIds).toEqual(["test-job-id"])
  expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
  expect(mockStampDubbing).not.toHaveBeenCalled()
  expect(mockReserveCredits).not.toHaveBeenCalled()
  expect(mockQueueAdd).not.toHaveBeenCalled()
}

describe("node-executor: a run's dub of a link asks the content rights gate before anything reads the link", () => {
  it("the gate reads the link with the run's account, the node's confirmation, the run's lane and way in, before the stamp probes it", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOURCE, { userId: "user-1", confirmationId: CONFIRMATION, lane: "run", via: "mcp" })
    expect(gate.requireImportAllowed.mock.invocationCallOrder[0]).toBeLessThan(mockStampDubbing.mock.invocationCallOrder[0]!)
    expect(mockReserveCredits).toHaveBeenCalled()
  })

  it("a refusal deletes the placeholder row, probes nothing, reserves nothing, and carries the gate's code", async () => {
    gate.requireImportAllowed.mockRejectedValueOnce(Object.assign(new Error("Confirm that you hold the rights to this content before it is imported."), { code: "rights_confirmation_required" }))
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({
      errorCode: "rights_confirmation_required",
      message: "Confirm that you hold the rights to this content before it is imported.",
    })
    expectNothingStarted()
  })

  it("a gate that could not answer leaves no placeholder row either", async () => {
    gate.requireImportAllowed.mockRejectedValueOnce(new Error("database down"))
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("database down")
    expectNothingStarted()
  })

  it("a link two URL parsers read differently is refused before the gate or the probe", async () => {
    built.payload = { ...built.payload, sourceUrl: `https://www.youtube.com${BACKSLASH}@10.0.0.1/watch?v=abc` }
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "validation_error" })
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expectNothingStarted()
  })

  it("a dub of an upload asks nothing", async () => {
    built.payload = { jobId: "test-job-id", targetLanguage: "fr", videoUrl: "https://x.example/c.mp4" }
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })
})

// A deployment's voice lock refuses every dub at build time (payload-builder's
// dubbing case, pinned in payload-builder-speech-and-deny.test.ts): the run's
// placeholder row goes with the refusal, and nothing is read or reserved.
describe("node-executor: a dub the voice lock refuses at build time", () => {
  it("deletes the placeholder row, reads no import gate, reserves nothing, and carries the lock's code", async () => {
    vi.mocked(buildPayload).mockImplementationOnce(() => {
      throw Object.assign(new Error("Dubbing is not available on this deployment."), { code: "voice_not_available" })
    })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({
      code: "voice_not_available",
      message: "Dubbing is not available on this deployment.",
    })
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expectNothingStarted()
  })
})
