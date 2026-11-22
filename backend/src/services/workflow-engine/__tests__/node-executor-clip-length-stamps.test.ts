/**
 * A workflow, app or template run of Face Swap or of Add Captions drawn by the
 * Remotion render (node-executor.ts, decided 2026-11-22): the video's length
 * is read by the route's own rule before anything is reserved — Face Swap
 * takes up to 60 seconds and records the length it read; a rendered caption
 * takes up to 5 minutes. A video past the limit, or one whose length cannot be
 * read, leaves no placeholder jobs row and reserves nothing. A plain subtitle
 * burned by FFmpeg is not read.
 *
 * Every external dependency is stubbed, as in the AI Avatar audio stamp's test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { built, mockProbe, mockCheckCredits, mockReserveCredits, mockQueueAdd } = vi.hoisted(() => ({
  built: { jobName: "face-swap", payload: {} as Record<string, unknown>, modelIdentifier: "roop-face-swap" },
  mockProbe: vi.fn(async (_src: string, _opts?: unknown): Promise<number> => 45),
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
vi.mock("@/lib/video-utility-probe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video-utility-probe.js")>()),
  probeClipLengthSec: mockProbe,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: built.jobName,
    queueName: "video-generation",
    modelIdentifier: built.modelIdentifier,
    payload: built.payload,
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockImplementation((node: unknown) => ({ node, appliedMappings: [] })),
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

const VIDEO = "https://cdn.example/clip.mp4"

function makeNode(type: string): SimpleNode {
  return { id: "n1", type, data: {} }
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

function faceSwap(): void {
  built.jobName = "face-swap"
  built.modelIdentifier = "roop-face-swap"
  built.payload = { jobId: "test-job-id", faceImageUrl: "https://cdn.example/face.png", videoUrl: VIDEO, provider: "roop" }
}

function captions(fields: Record<string, unknown>, id = "add-captions:kinetic"): void {
  built.jobName = "add-captions"
  built.modelIdentifier = id
  built.payload = { jobId: "test-job-id", videoUrl: VIDEO, ...fields }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProbe.mockImplementation(async () => 45)
  faceSwap()
  deletedIds.length = 0
  updatePatches.length = 0
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500_000, watermark: false })
  // The reservation throws a sentinel so the allowed path stops cleanly before polling.
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

function expectNoRowLeft(): void {
  expect(deletedIds).toEqual(["test-job-id"])
  expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
  expect(mockReserveCredits).not.toHaveBeenCalled()
  expect(mockQueueAdd).not.toHaveBeenCalled()
}

describe("node-executor: Face Swap's video is read before the run holds", () => {
  it("a video within 60 s runs on, its length recorded on the job", async () => {
    await expect(executeNode(makeNode("face-swap"), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(mockProbe).toHaveBeenCalledWith(VIDEO, expect.objectContaining({ reading: "container" }))
    expect(built.payload.faceSwapVideoSec).toBe(45)
    expect(mockReserveCredits.mock.calls[0]?.[2]).toBe("roop-face-swap")
  })

  it("a video past 60 s is refused (video_too_long), leaving no jobs row and holding nothing", async () => {
    mockProbe.mockImplementation(async () => 61)
    await expect(executeNode(makeNode("face-swap"), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "video_too_long" })
    expectNoRowLeft()
  })

  it("a video whose length cannot be read is refused (video_unreadable) the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockProbe.mockImplementation(async () => { throw new Error("moov atom not found") })
    await expect(executeNode(makeNode("face-swap"), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "video_unreadable" })
    expectNoRowLeft()
  })
})

describe("node-executor: a rendered caption's video is read before the run holds", () => {
  it("a video within 5 minutes runs on", async () => {
    captions({ style: "karaoke" })
    mockProbe.mockImplementation(async () => 120)
    await expect(executeNode(makeNode("add-captions"), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(mockReserveCredits.mock.calls[0]?.[2]).toBe("add-captions:kinetic")
  })

  it("a video past 5 minutes is refused (video_too_long), leaving no jobs row and holding nothing", async () => {
    captions({ style: "subtitle" })
    mockProbe.mockImplementation(async () => 301)
    await expect(executeNode(makeNode("add-captions"), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "video_too_long" })
    expectNoRowLeft()
  })

  it("a plain subtitle burned by FFmpeg is not read: it runs on whatever its length", async () => {
    captions({ style: "subtitle", text: "Hello there" }, "add-captions")
    mockProbe.mockImplementation(async () => 900)
    await expect(executeNode(makeNode("add-captions"), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
    expect(mockProbe).not.toHaveBeenCalled()
  })
})
