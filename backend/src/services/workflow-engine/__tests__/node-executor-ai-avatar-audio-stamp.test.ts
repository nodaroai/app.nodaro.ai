/**
 * A workflow, app or template run of AI Avatar in audio mode (node-executor.ts):
 * its audio is measured by the route's own rule (`measureAiAvatarAudio`,
 * through the probe guard) before anything is reserved, and the run holds the
 * duration bucket of the measured seconds — no longer the 120-second default
 * for any audio. Audio the route refuses leaves no placeholder jobs row and
 * reserves nothing; a text-mode run is not probed.
 *
 * Every external dependency is stubbed, as in the Nodaro Image Upscale stamp's test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { built, mockProbe, mockCheckCredits, mockReserveCredits, mockQueueAdd } = vi.hoisted(() => ({
  built: { payload: {} as Record<string, unknown>, modelIdentifier: "heygen-avatar-iv:720p:120s" },
  mockProbe: vi.fn(async (_src: string, _opts?: unknown): Promise<number> => 10),
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
  probeSoundLengthSec: mockProbe,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "ai-avatar",
    queueName: "video-generation",
    modelIdentifier: built.modelIdentifier,
    payload: built.payload,
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "ai-avatar", data: {} }, appliedMappings: [] }),
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
import { ClipUnreadableError } from "@/lib/video-utility-probe.js"
import { LINK_HOST_UNREACHABLE } from "@/providers/video/probe-guard.js"

const AUDIO = "https://cdn.example/voiceover.mp3"

function makeNode(): SimpleNode {
  return { id: "n1", type: "ai-avatar", data: { speechMode: "audio", avatarId: "a1" } }
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
  mockProbe.mockImplementation(async () => 10)
  built.modelIdentifier = "heygen-avatar-iv:720p:120s"
  built.payload = { jobId: "test-job-id", avatarSource: "avatar", engine: "avatar-iv", avatarId: "a1", speechMode: "audio", audioUrl: AUDIO, resolution: "720p" }
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

/** The credit id the run reserved (the reservation's third argument). */
async function reservedId(): Promise<unknown> {
  await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow("reservation-sentinel")
  return mockReserveCredits.mock.calls[0]?.[2]
}

function expectNoRowLeft(): void {
  expect(deletedIds).toEqual(["test-job-id"])
  expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
  expect(mockReserveCredits).not.toHaveBeenCalled()
  expect(mockQueueAdd).not.toHaveBeenCalled()
}

describe("node-executor: AI Avatar's audio is measured before the run holds", () => {
  it.each([
    [10, "heygen-avatar-iv:720p:10s"],
    [10.2, "heygen-avatar-iv:720p:15s"],
    [300, "heygen-avatar-iv:720p:360s"],
    // A longer audio is trimmed to 600 s by the worker, and held at that cap.
    [700, "heygen-avatar-iv:720p:600s"],
  ] as const)("audio measured at %s s holds %s", async (sec, id) => {
    mockProbe.mockImplementation(async () => sec)
    expect(await reservedId()).toBe(id)
    // The workflow run's own bound: the packet scan within the render's download time, no route deadline.
    expect(mockProbe).toHaveBeenCalledWith(AUDIO, expect.objectContaining({ timeoutMs: expect.any(Number), packetTimeoutMs: expect.any(Number) }))
  })

  it("the measured bucket on its settings: Avatar V at 1080p", async () => {
    built.payload = { ...built.payload, engine: "avatar-v", resolution: "1080p" }
    mockProbe.mockImplementation(async () => 45)
    expect(await reservedId()).toBe("heygen-avatar-v:1080p:60s")
  })

  it("a link whose host could not be looked up for now is the retryable refusal every measuring route answers, before anything is held", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockProbe.mockImplementation(async () => { throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { reason: "dns" }) })
    const err = (await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string }
    expect(err.errorCode).toBe(LINK_HOST_UNREACHABLE.code)
    expectNoRowLeft()
  })

  it("audio that cannot be read is refused (invalid_media_duration) before anything is held", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockProbe.mockImplementation(async () => { throw new ClipUnreadableError("no audio stream") })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "invalid_media_duration" })
    expectNoRowLeft()
  })

  it("a link that is not a public http(s) one is refused unprobed", async () => {
    built.payload = { ...built.payload, audioUrl: "file:///etc/hosts" }
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "invalid_media_duration" })
    expect(mockProbe).not.toHaveBeenCalled()
    expectNoRowLeft()
  })

  it("a text-mode run is not probed: it holds its build's own id (the script's length)", async () => {
    built.payload = { ...built.payload, speechMode: "text", script: "Hello there.", voiceId: "v1", audioUrl: undefined }
    built.modelIdentifier = "heygen-avatar-iv:720p:5s"
    expect(await reservedId()).toBe("heygen-avatar-iv:720p:5s")
    expect(mockProbe).not.toHaveBeenCalled()
  })
})
