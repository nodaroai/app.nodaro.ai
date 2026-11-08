/**
 * node-executor → payload-builder THREADING of the voice lock's lookups.
 *
 * `buildPayload` is synchronous, so `executeNode` resolves the gender of each
 * voice a speech node will dispatch (`voicesTheBuildDispatches` →
 * `resolveVoiceGenders`, lib/voice-gender.ts) as the EXECUTION's user and hands
 * the answer down as `PayloadBuildContext.voiceGenders`.
 *
 * The rule itself is pinned in `payload-builder-speech-and-deny.test.ts` and
 * `lib/__tests__/voice-gender.test.ts`; this file pins only that the lookup is
 * asked for the right voices and its answer ARRIVES. A dropped argument fails
 * closed (the builder refuses an unresolved non-premade voice), so this is
 * what keeps a fine library voice usable in a workflow under a lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockReserveCredits, mockResolveVoiceGenders } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "text-to-speech",
    queueName: "video-generation",
    modelIdentifier: "elevenlabs-v3",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
  mockResolveVoiceGenders: vi.fn(async (voices: readonly string[], _lookup: { userId?: string | null }) =>
    voices.length > 0 ? new Map(voices.map((v) => [v, "male" as const])) : new Map()),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
        update: vi.fn().mockReturnValue({ eq: eqFn }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: (data: Record<string, unknown>) => data,
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: vi.fn(async () => ({ admin: false })),
  assertNodeAvailableForUser: vi.fn(async () => {}),
}))
vi.mock("@/lib/voice-gender.js", () => ({ resolveVoiceGenders: mockResolveVoiceGenders }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const ctx = (userId: string) => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId,
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

async function buildCtxFor(node: SimpleNode, resolvedInputs: Record<string, unknown> = {}): Promise<{ voiceGenders?: unknown }> {
  // The poll never resolves in this harness; the build is all we need.
  void executeNode(node, resolvedInputs, [], [node], {}, ctx("user-1")).catch(() => {})
  await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  return (mockBuildPayload.mock.calls[0] as unknown as unknown[])[4] as { voiceGenders?: unknown }
}

describe("node-executor hands the voice lock's lookups to buildPayload", () => {
  beforeEach(() => vi.clearAllMocks())

  it("looks up the voice a text-to-speech node sends, as the execution's user, and hands the answer on", async () => {
    const node: SimpleNode = { id: "n1", type: "text-to-speech", data: { label: "Voice", directText: "hi", voiceId: "LibVoice000000000001" } }

    const buildCtx = await buildCtxFor(node, { voice: "AutoWired00000000001" })

    expect(mockResolveVoiceGenders).toHaveBeenCalledWith(["AutoWired00000000001"], { userId: "user-1" })
    expect(buildCtx.voiceGenders).toEqual(new Map([["AutoWired00000000001", "male"]]))
  })

  it("looks up every voice of a dialogue node's lines", async () => {
    const node: SimpleNode = {
      id: "n2",
      type: "text-to-dialogue",
      data: { label: "Talk", dialogue: [{ id: "1", text: "Hi", voice: "Daniel" }, { id: "2", text: "Yo", voice: "LibVoice000000000001" }] },
    }

    const buildCtx = await buildCtxFor(node)

    expect(mockResolveVoiceGenders).toHaveBeenCalledWith(["Daniel", "LibVoice000000000001"], { userId: "user-1" })
    expect(buildCtx.voiceGenders).toEqual(new Map([["Daniel", "male"], ["LibVoice000000000001", "male"]]))
  })

  it("looks up the voice a Voice Changer node converts into", async () => {
    const node: SimpleNode = { id: "n4", type: "voice-changer", data: { label: "Revoice", audioUrl: "https://example.com/a.mp3", voiceId: "LibVoice000000000001" } }

    const buildCtx = await buildCtxFor(node)

    expect(mockResolveVoiceGenders).toHaveBeenCalledWith(["LibVoice000000000001"], { userId: "user-1" })
    expect(buildCtx.voiceGenders).toEqual(new Map([["LibVoice000000000001", "male"]]))
  })

  it("hands nothing on when the lookup has nothing to say (no lock)", async () => {
    mockResolveVoiceGenders.mockResolvedValueOnce(undefined as never)
    const node: SimpleNode = { id: "n3", type: "text-to-speech", data: { label: "Voice", directText: "hi", voice: "Daniel" } }

    const buildCtx = await buildCtxFor(node)

    expect(buildCtx).not.toHaveProperty("voiceGenders")
  })
})
