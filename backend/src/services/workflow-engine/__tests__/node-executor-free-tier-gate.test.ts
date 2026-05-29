/**
 * Free-tier blocked-models gate in node-executor.ts (Part B, Task 7).
 *
 * Verifies that `executeWorkerQueuedNode` (via `executeNode`) checks
 * `CreditsService.checkCredits` BEFORE `reserveCredits`, so free-tier users
 * cannot generate a blocked model (e.g. 4K gemini-omni-video) via the
 * orchestrator/workflow path.
 *
 * The test also confirms the orphaned placeholder `jobs` row is deleted on
 * block (no orphan left behind).
 *
 * Limitation: this test stubs every external dependency (supabase, BullMQ,
 * workers/shared) so it runs in pure Node without any infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockJobInsert,
  mockJobUpdate,
  mockJobDelete,
  mockCheckCredits,
  mockReserveCredits,
  mockQueueAdd,
  mockHasCreditsRef,
} = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }

  // Supabase chain mock
  const mockJobDelete = vi.fn().mockResolvedValue({ error: null })
  const mockJobUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })
  const mockJobInsert = vi.fn().mockResolvedValue({
    data: { id: "test-job-id" },
    error: null,
  })

  const mockCheckCredits = vi.fn()
  const mockReserveCredits = vi.fn()
  const mockQueueAdd = vi.fn().mockResolvedValue(undefined)

  return {
    mockJobInsert,
    mockJobUpdate,
    mockJobDelete,
    mockCheckCredits,
    mockReserveCredits,
    mockQueueAdd,
    mockHasCreditsRef,
  }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => mockHasCreditsRef.value,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const deleteFn = vi.fn().mockReturnValue({ eq: mockJobDelete })
  const selectFn = vi.fn().mockReturnValue({
    single: mockJobInsert,
  })
  const insertFn = vi.fn().mockReturnValue({
    select: selectFn,
  })

  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCredits: mockCheckCredits,
    reserveCredits: mockReserveCredits,
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: mockQueueAdd },
}))

vi.mock("@/lib/render-queue.js", () => ({
  renderQueue: { add: mockQueueAdd },
}))

vi.mock("@/workers/shared.js", () => ({
  refundJobCredits: vi.fn().mockResolvedValue(undefined),
}))

// Minimal payload-builder stub for a generate-video node
vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn().mockReturnValue({
    jobName: "image-to-video",
    queueName: "video-generation",
    modelIdentifier: "gemini-omni-video:4k:8",
    payload: { jobId: "test-job-id", provider: "gemini-omni-video" },
  }),
}))

vi.mock("../output-extractor.js", () => ({
  buildNodeOutputFromJobData: vi.fn(),
}))

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
vi.mock("@nodaro/shared", () => ({
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e, node) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
}))

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { supabase } from "@/lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(): SimpleNode {
  return { id: "n1", type: "generate-video", data: { provider: "gemini-omni-video", resolution: "4k" } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-free-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("node-executor free-tier blocked-models gate (Part B, Task 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: supabase insert returns a job id
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    const mockDeleteEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq })

    vi.mocked(supabase.from).mockReturnValue({
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      select: vi.fn(),
    } as unknown as ReturnType<typeof supabase.from>)
  })

  it("rejects execution when checkCredits returns allowed=false (blocked model)", async () => {
    mockCheckCredits.mockResolvedValue({
      allowed: false,
      error: "This model requires a paid subscription. Upgrade to Basic or higher.",
    })

    const node = makeNode()
    const ctx = makeCtx()

    await expect(
      executeNode(node, {}, [], [], {}, ctx),
    ).rejects.toThrow(/Credit reservation failed|paid subscription|blocked/)

    // Must NOT call reserveCredits when blocked
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("cleans up orphaned jobs row when blocked by checkCredits", async () => {
    mockCheckCredits.mockResolvedValue({
      allowed: false,
      error: "This model requires a paid subscription.",
    })

    let deletedJobId: string | null = null
    const mockDeleteEqCapture = vi.fn().mockImplementation((field: string, value: string) => {
      if (field === "id") deletedJobId = value
      return Promise.resolve({ error: null })
    })
    const mockDeleteCapture = vi.fn().mockReturnValue({ eq: mockDeleteEqCapture })

    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })

    vi.mocked(supabase.from).mockReturnValue({
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDeleteCapture,
      select: vi.fn(),
    } as unknown as ReturnType<typeof supabase.from>)

    const node = makeNode()
    const ctx = makeCtx()

    await expect(executeNode(node, {}, [], [], {}, ctx)).rejects.toThrow()

    // Blocked → no credit reservation attempted
    expect(mockReserveCredits).not.toHaveBeenCalled()
    // Orphan row should have been deleted
    expect(mockDeleteCapture).toHaveBeenCalled()
    expect(deletedJobId).toBe("test-job-id")
  })

  it("calls checkCredits (preflight) before reserveCredits when allowed=true", async () => {
    // Limitation: we can't run the full happy path end-to-end because
    // pollJobToCompletion hangs waiting for the jobs row status to change.
    // Instead we verify call order by making reserveCredits throw AFTER checkCredits
    // succeeds — that short-circuits the flow cleanly.
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))

    const node = makeNode()
    const ctx = makeCtx()

    await expect(executeNode(node, {}, [], [], {}, ctx)).rejects.toThrow()

    // Both called: preflight passed, reservation attempted
    expect(mockCheckCredits).toHaveBeenCalledTimes(1)
    expect(mockReserveCredits).toHaveBeenCalled()
    // checkCredits called BEFORE reserveCredits
    expect(mockCheckCredits.mock.invocationCallOrder[0]).toBeLessThan(
      mockReserveCredits.mock.invocationCallOrder[0],
    )
  })
})
