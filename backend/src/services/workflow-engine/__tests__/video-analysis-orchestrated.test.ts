/**
 * Orchestrated end-to-end dispatch for the `video-analysis` node (plan Task 19,
 * Step 1).
 *
 * Drives a 2-node workflow (video-analysis --json--> extract-field) through the
 * REAL payload-builder + node-executor, mocking ONLY the external boundaries
 * (Supabase job lifecycle, CreditsService, the BullMQ queues). This is the
 * integration counterpart to the pure `payload-builder-video-analysis.test.ts`
 * unit tests — it proves the node actually DISPATCHES end-to-end:
 *
 *   (a) buildPayload handles the node (no "Unknown node type" throw — the same
 *       outage class the registry-walk guard protects, exercised live) and the
 *       orchestrator enqueues jobName "video-analysis".
 *   (b) With no probed/upstream duration, the reserved model identifier is the
 *       CEILING composite `video-analysis:gemini-3-flash:600s`, and that value
 *       is the SAME `reservedCreditId` the enqueued payload carries (single
 *       source of truth — commit/refund key by it).
 *   (c) A completed job's `{ json }` flows through DIRECT_OUTPUT_KEYS into
 *       state.output.json and is consumable by a downstream extract-field node
 *       (the scenes payload reaches its input).
 *
 * Mirrors the mocking style of `seedance2-ref-video-reserve.test.ts` /
 * `node-executor-credit-propagation.test.ts`, but deliberately keeps
 * payload-builder + @nodaro/shared + the inline/output-extractor siblings REAL
 * so the dispatch, credit-id derivation, and json flow are genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — declared before vi.mock() calls
// ---------------------------------------------------------------------------

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
}))

// The completed jobs row the poll reads back. Set per-test in beforeEach.
const JOB_ID = "job-va-orch-1"
let jobRecord: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Mocks — only the external boundaries. payload-builder, @nodaro/shared, the
// inline-executor / output-extractor / execution-graph siblings stay REAL.
// ---------------------------------------------------------------------------

vi.mock("../../../lib/supabase.js", () => {
  // insert().select().single() → the new jobId; update().eq() → resolved; and
  // the poll's select().eq().single() → the completed jobRecord. Each of
  // insert/update/select returns its own terminal so the three call chains in
  // executeWorkerNode + pollJobToCompletion never collide on `.eq`.
  const builder = {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: JOB_ID }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: jobRecord }) }) }),
  }
  return { supabase: { from: () => builder } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
// Reference-sheet Stage A is only invoked for reference-sheet nodes — stub so
// its provider import graph never loads for this video-analysis flow.
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

// ---------------------------------------------------------------------------
// Import SUT (+ real payload-builder + real shared schema) after mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../node-executor.js"
import { buildPayload } from "../payload-builder.js"
import { videoAnalysisResultSchema } from "@nodaro/shared"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  OrchestratorContext,
} from "../types.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CEILING_ID = "video-analysis:gemini-3-flash:600s"

// Minimal-but-valid merged analysis result. Parsed through the SHARED schema so
// a future contract drift makes THIS fixture fail loudly rather than asserting
// on a shape the worker would reject.
const ANALYSIS = videoAnalysisResultSchema.parse({
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9" },
  slots: [],
  scenes: [
    {
      startSec: 0,
      endSec: 4,
      label: "opening shot",
      shotType: "wide",
      camera: "slow push-in",
      visual: "a wide establishing shot of a neon city at night",
      audio: { mode: "music", content: "brooding synthwave" },
      sceneNumber: 1,
      visualResolved: "a wide establishing shot of a neon city at night",
      slotRefs: [],
    },
  ],
})

function vaNode(): SimpleNode {
  // youtubeUrl source, no probedYoutube + no upstream videoDuration → the
  // ceiling composite is the only resolvable credit id.
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/abc123" } }
}

function extractNode(): SimpleNode {
  // "scenes.label" auto-iterates the scenes array → each scene's label, so a
  // non-empty result proves the scenes payload reached the input.
  return { id: "ef", type: "extract-field", data: { field: "scenes.label", mode: "custom" } }
}

const EDGES: SimpleEdge[] = [
  { id: "e1", source: "va", target: "ef", sourceHandle: "json", targetHandle: "in" } as SimpleEdge,
]

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("video-analysis — orchestrated dispatch + ceiling reserve + downstream json flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobRecord = {
      status: "completed",
      output_data: { json: ANALYSIS },
      error_message: null,
      progress: 100,
      credits_actual: 3,
    }
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-va-1", creditsReserved: 3, watermark: false })
  })

  it("(a) dispatches without throwing and enqueues jobName 'video-analysis' on the video queue", async () => {
    const nodes = [vaNode(), extractNode()]
    await expect(executeNode(nodes[0], {}, EDGES, nodes, {}, makeCtx())).resolves.toBeDefined()

    expect(mockVideoAdd).toHaveBeenCalledTimes(1)
    expect(mockRenderAdd).not.toHaveBeenCalled()
    expect(mockVideoAdd.mock.calls[0][0]).toBe("video-analysis")
  })

  it("(b) reserves the ceiling composite with no duration, matching payload.reservedCreditId", async () => {
    const nodes = [vaNode(), extractNode()]
    await executeNode(nodes[0], {}, EDGES, nodes, {}, makeCtx())

    // The orchestrator reserved by the node's top-level modelIdentifier.
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const reservedId = mockReserveCredits.mock.calls[0][2] as string
    expect(reservedId).toBe(CEILING_ID)

    // ...which is exactly the reservedCreditId the enqueued payload carries
    // (end-to-end proof the reserve and the payload agree on one credit id).
    const enqueuedPayload = mockVideoAdd.mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.reservedCreditId).toBe(reservedId)
    expect(enqueuedPayload.reservedCreditId).toBe(CEILING_ID)

    // Pin the source invariant: buildPayload returns modelIdentifier === payload.reservedCreditId.
    const built = buildPayload(vaNode(), JOB_ID, {}, undefined)
    expect(built.modelIdentifier).toBe(CEILING_ID)
    expect(built.payload.reservedCreditId).toBe(CEILING_ID)
  })

  it("(c) a completed job's { json } flows via DIRECT_OUTPUT_KEYS into a downstream extract-field", async () => {
    const nodes = [vaNode(), extractNode()]
    const ctx = makeCtx()

    const vaResult = await executeNode(nodes[0], {}, EDGES, nodes, {}, ctx)

    // buildNodeOutputFromJobData promoted `json` (a DIRECT_OUTPUT_KEY) into
    // state.output — the full analysis object, untouched.
    expect(vaResult.output.json).toEqual(ANALYSIS)

    // Persist va's output as the orchestrator would, then run the downstream
    // extract-field through the SAME node-executor dispatch. It reads
    // state.output.json and pulls each scene's label — proving the scenes
    // payload reached its input.
    const nodeStates: Record<string, NodeExecutionState> = {
      va: { status: "completed", output: vaResult.output },
    }
    const efResult = await executeNode(nodes[1], {}, EDGES, nodes, nodeStates, ctx)
    expect(efResult.output.extractedText).toBe("opening shot")
  })
})
