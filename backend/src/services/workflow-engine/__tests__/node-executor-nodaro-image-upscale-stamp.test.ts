/**
 * A run's Nodaro Image Upscale node (node-executor.ts): its input is copied
 * and measured by the lane's stamp before anything is reserved. A stamp that
 * THROWS instead of refusing — the upload policy's own refusal, a stop, the
 * served ids not known yet — leaves no placeholder jobs row and is rethrown as
 * the very same error (a drain still hands the run back). The copy is given
 * the run's stop signal, so a draining worker (or a cancelled run) stops
 * fetching.
 *
 * Every external dependency is stubbed, as in node-executor-dubbing-source-gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { built, mockStamp, mockCheckCredits, mockReserveCredits, mockQueueAdd, mockDiscardScratch, deleteThrows } = vi.hoisted(() => ({
  mockDiscardScratch: vi.fn(async (_jobId: string) => undefined),
  deleteThrows: { value: false },
  built: { payload: {} as Record<string, unknown> },
  mockStamp: vi.fn(async (_jobName: string, _payload: unknown, _ctx: { signal?: AbortSignal }): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; code: string; message: string }> => ({ ok: true, patch: {} })),
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
vi.mock("@/lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-scratch.js")>()),
  discardDeletedJobScratch: mockDiscardScratch,
}))
vi.mock("@/lib/nodaro-image-upscale-lane.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nodaro-image-upscale-lane.js")>()),
  stampNodaroImageUpscaleInput: mockStamp,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "edit-image",
    queueName: "video-generation",
    modelIdentifier: "nodaro-image-upscale",
    payload: built.payload,
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "upscale-image", data: {} }, appliedMappings: [] }),
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
import { DrainAbortError, _resetWorkerDrainForTests, beginWorkerDrain } from "@/lib/worker-drain.js"
import { HouseModelsServedUnknownError } from "@/lib/house-models-served.js"

const IMAGE = "https://cdn.example/photo.png"

function makeNode(): SimpleNode {
  return { id: "n1", type: "upscale-image", data: { provider: "nodaro-image-upscale", upscaleFactor: "4" } }
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
  _resetWorkerDrainForTests()
  mockStamp.mockImplementation(async () => ({ ok: true, patch: {} }))
  built.payload = { jobId: "test-job-id", provider: "nodaro-image-upscale", imageUrl: IMAGE, upscaleFactor: "4" }
  deletedIds.length = 0
  updatePatches.length = 0
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500, watermark: false })
  // The reservation throws a sentinel so the allowed path stops cleanly before polling.
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  const mockUpdate = vi.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch)
    return { eq: vi.fn().mockResolvedValue({ error: null }) }
  })
  deleteThrows.value = false
  const mockDelete = vi.fn().mockReturnValue({
    eq: vi.fn((field: string, value: string) => {
      if (deleteThrows.value) throw new Error("database down")
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

afterEach(() => {
  _resetWorkerDrainForTests()
})

function expectNoRowLeft(): void {
  expect(deletedIds).toEqual(["test-job-id"])
  // The copy the stamp may already have stored goes with the row.
  expect(mockDiscardScratch).toHaveBeenCalledWith("test-job-id")
  expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
  expect(mockReserveCredits).not.toHaveBeenCalled()
  expect(mockQueueAdd).not.toHaveBeenCalled()
}

describe("node-executor: Nodaro Image Upscale's input stamp", () => {
  it.each([
    ["the upload policy's own refusal", () => Object.assign(new Error("This file cannot be used."), { code: "upload_blocked" })],
    ["a drain", () => new DrainAbortError()],
    ["the served ids not known yet", () => new HouseModelsServedUnknownError()],
    ["any other throw", () => new Error("storage down")],
  ])("%s: no placeholder row is left, and the same error is rethrown", async (_name, make) => {
    const thrown = make()
    mockStamp.mockRejectedValueOnce(thrown)
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e)
    expect(err).toBe(thrown)
    expectNoRowLeft()
  })

  it("a returned refusal still leaves no row, with its code", async () => {
    mockStamp.mockResolvedValueOnce({ ok: false, code: "input_too_large", message: "The file is larger than the 20 MB this step takes." })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "input_too_large" })
    expectNoRowLeft()
  })

  it("the copy is given the run's stop signal: a drain aborts it mid-fetch", async () => {
    let seen: AbortSignal | undefined
    mockStamp.mockImplementationOnce(async (_jobName, _payload, ctx) => {
      seen = ctx.signal
      return await new Promise((_resolve, reject) => {
        if (!ctx.signal) return reject(new Error("no signal"))
        ctx.signal.addEventListener("abort", () => reject(ctx.signal!.reason), { once: true })
        beginWorkerDrain()
      })
    })
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e)
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen!.aborted).toBe(true)
    expect(err).toBeInstanceOf(DrainAbortError)
    expectNoRowLeft()
  })

  it("an output past the limits, refused after the copy was stored: the row and the copy both go", async () => {
    mockStamp.mockResolvedValueOnce({ ok: false, code: "image_too_large", message: "This upscale would make an 8,800 × 8,800 picture." })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "image_too_large" })
    expectNoRowLeft()
  })

  it("a cleanup that fails never replaces the error: a drain stays a DrainAbortError, so the run is handed back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    deleteThrows.value = true
    const drain = new DrainAbortError()
    mockStamp.mockRejectedValueOnce(drain)
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e)
    expect(err).toBe(drain)
    expect(mockDiscardScratch).toHaveBeenCalledWith("test-job-id")
    // And a returned refusal keeps its own code too.
    mockStamp.mockResolvedValueOnce({ ok: false, code: "input_too_large", message: "too large" })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "input_too_large" })
  })

  it("an allowed stamp goes on to the reservation, and the signal is given only to this lane", async () => {
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(mockStamp.mock.calls[0]![2]).toMatchObject({ userId: "user-1", jobId: "test-job-id", signal: expect.any(AbortSignal) })
    expect(mockReserveCredits).toHaveBeenCalled()
  })
})
