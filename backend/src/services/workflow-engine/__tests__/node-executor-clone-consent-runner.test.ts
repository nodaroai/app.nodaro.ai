/**
 * A one-off voice clone runs only on its RUNNER's own consent (decided 2026-11-13). The rule is pinned in
 * `payload-builder-speech-and-deny.test.ts` (`replicaConsentIsFor` against `runUserId`); this file pins that
 * `executeNode` hands the build the runner (`ctx.userId`), never the workflow's or the app's owner
 * (`ctx.workflowOwnerId`): an app run by anyone but its author is judged against that runner, so the
 * author's tick in the app's snapshot does not speak for them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockReserveCredits } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({ jobName: "text-to-speech", queueName: "audio-generation", modelIdentifier: "gemini-3-8-flash-tts", payload: { jobId: "test-job-id" } })),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      select: vi.fn(),
    }),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../output-extractor.js")>()),
  buildNodeOutputFromJobData: vi.fn(),
}))
vi.mock("../resolve-field-mappings.js", () => ({ resolveFieldMappings: (data: Record<string, unknown>) => data, NODE_MAPPABLE_FIELDS: {} }))
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: vi.fn(async () => ({ admin: false })),
  assertNodeAvailableForUser: vi.fn(async () => undefined),
}))

import { executeNode } from "../node-executor.js"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const AUTHOR = "author-1"
const RUNNER = "runner-2"
const tts: SimpleNode = {
  id: "tts",
  type: "text-to-speech",
  data: {
    label: "Narration",
    provider: "gemini-3-8-flash-tts",
    directText: "Hello there.",
    replica: { sourceAudioUrl: "https://cdn.example.test/ref.wav", consentAudioUrl: "https://cdn.example.test/consent.wav" },
    replicaConsent: { userId: AUTHOR, signature: "ab".repeat(32) },
  },
}
const ctxFor = (userId: string, extra: Partial<OrchestratorContext> = {}) =>
  ({ executionId: "exec-1", workflowId: "wf-1", userId, triggerType: "manual", cancelled: false, isAppRun: false, onJobCreated: vi.fn(), ...extra }) as unknown as OrchestratorContext

/** The build context `executeNode` handed the payload build. */
async function buildContextFor(ctx: OrchestratorContext): Promise<{ runUserId?: string }> {
  void executeNode(tts, {}, [], [tts], {}, ctx).catch(() => {})
  await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  const call = mockBuildPayload.mock.calls[0] as unknown as unknown[]
  return call[4] as { runUserId?: string }
}

describe("executeNode judges a one-off clone's consent against the runner", () => {
  beforeEach(() => vi.clearAllMocks())

  it("an editor run: the runner is the run's user", async () => {
    expect((await buildContextFor(ctxFor(AUTHOR))).runUserId).toBe(AUTHOR)
  })

  it("an app run by someone else: the runner, never the app's author", async () => {
    const built = await buildContextFor(ctxFor(RUNNER, { isAppRun: true, workflowOwnerId: AUTHOR }))
    expect(built.runUserId).toBe(RUNNER)
  })

  it("the author's own app run: the author", async () => {
    const built = await buildContextFor(ctxFor(AUTHOR, { isAppRun: true, workflowOwnerId: AUTHOR }))
    expect(built.runUserId).toBe(AUTHOR)
  })
})
