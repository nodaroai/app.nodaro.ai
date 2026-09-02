/**
 * node-executor → payload-builder THREADING of the pre-mapping `authoredData`
 * snapshot (§4.6).
 *
 * `resolveFieldMappings` rewrites `node.data.<field>` with an upstream node's
 * output BEFORE `buildPayload` runs, so the settle pass inside the builder
 * cannot tell an authored prompt from injected DATA on its own. `executeNode`
 * snapshots `node.data` before the mapping block and hands it down as
 * `PayloadBuildContext.authoredData`.
 *
 * The rule itself is pinned in `payload-builder-unresolved-refs.test.ts`; this
 * file pins only that the snapshot ARRIVES — the parameter is optional, so a
 * dropped argument compiles clean and would silently re-open the refusal on
 * every `{}`-injected prompt.
 *
 * Every external dependency is stubbed (supabase, credits, BullMQ, the payload
 * builder itself) so the test runs in pure Node.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockReserveCredits } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "text-to-audio",
    queueName: "video-generation",
    modelIdentifier: "elevenlabs-sfx",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
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

// The mapping resolver stands in for "an upstream value overwrote data.prompt".
// Its real behaviour is covered by resolve-field-mappings' own tests.
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: (data: Record<string, unknown>) => ({ ...data, prompt: '{"k": "v"}' }),
  NODE_MAPPABLE_FIELDS: { "text-to-audio": ["prompt"] },
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

describe("node-executor threads the pre-mapping authoredData to buildPayload", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes data as the AUTHOR left it, while the node itself carries the mapped value", async () => {
    const node: SimpleNode = { id: "n1", type: "text-to-audio", data: { label: "SFX", prompt: "{}" } }
    // The poll never resolves in this harness; the enqueue is all we need.
    void executeNode(node, {}, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())

    const [builtNode, , , , buildCtx] = mockBuildPayload.mock.calls[0] as unknown as [
      SimpleNode, string, unknown, unknown, { authoredData?: Record<string, unknown> },
    ]
    // The mapped value is what gets composed …
    expect((builtNode.data as Record<string, unknown>).prompt).toBe('{"k": "v"}')
    // … and the authored snapshot is what the §4.6 settle pass compares against.
    expect(buildCtx.authoredData?.prompt).toBe("{}")
  })
})
