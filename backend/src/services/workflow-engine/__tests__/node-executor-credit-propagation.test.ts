/**
 * node-executor — sub-workflow + component branches must propagate inner
 * credit spend to the orchestrator via `result.creditsUsed`.
 *
 * Root-cause regression (monetization under-pay + total_credits_used
 * under-report): the `sub-workflow` branch returned `{ output }` and the
 * `component` branch returned `{ output, jobId }`, both dropping `creditsUsed`.
 * The orchestrator accumulates per-node spend as
 * `totalCredits += result.creditsUsed ?? 0`, so a workflow whose cost lives
 * inside a sub-workflow or component contributed 0 to the parent total →
 * `workflow_executions.total_credits_used` was wrong and, for monetized app
 * runs, `process_app_monetization` computed the creator's percentage on an
 * under-stated base.
 *
 * - sub-workflow: inner nodes share the parent execution; their summed
 *   creditsUsed (from executeSubWorkflow) must flow through node-executor.
 * - component: the inner run is a SEPARATE workflow_executions row, so the
 *   wrapper job's `credits_actual` (= inner total_credits_used) is the source
 *   of truth and must be surfaced as the component node's creditsUsed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SimpleNode, ResolvedInputs, OrchestratorContext } from "../types.js"

// ---------------------------------------------------------------------------
// Mocks (must precede the import of the module under test)
// ---------------------------------------------------------------------------

// executeSubWorkflow is the unit boundary for the sub-workflow branch.
const mockExecuteSubWorkflow = vi.fn()
vi.mock("../sub-workflow-handler.js", () => ({
  executeSubWorkflow: (...args: unknown[]) => mockExecuteSubWorkflow(...args),
}))

// supabase — only the component branch's wrapper-job poll path is exercised.
// `from("jobs").select(...).eq(...).single()` resolves to `{ data: <jobRow> }`.
// `mockJobRow` is the row the poll reads; tests set it per-case.
let mockJobRow: Record<string, unknown> | null = null
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: async () => ({ data: mockJobRow }),
        })),
      })),
    })),
  },
}))

// config — component branch reads INTERNAL_ORCHESTRATOR_SECRET; both branches
// gate credit logic on hasCredits(). Keep credits ON so nothing short-circuits.
vi.mock("../../../lib/config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) },
  hasCredits: () => true,
}))

// Heavy/irrelevant deps pulled in transitively by node-executor — stub to keep
// the import graph hermetic (no BullMQ/Redis, no credit RPCs).
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
}))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))

import { executeNode } from "../node-executor.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    ...overrides,
  }
}

const noInputs: ResolvedInputs = {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("node-executor — sub-workflow branch credit propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("propagates creditsUsed returned by executeSubWorkflow", async () => {
    const n: SimpleNode = { id: "sw", type: "sub-workflow", data: { workflowId: "ref" } }
    mockExecuteSubWorkflow.mockResolvedValue({
      output: { imageUrl: "https://out.png" },
      creditsUsed: 11,
    })

    const result = await executeNode(n, noInputs, [], [n], {}, ctx())

    expect(result.output).toEqual({ imageUrl: "https://out.png" })
    expect(result.creditsUsed).toBe(11)
  })

  it("surfaces creditsUsed 0 (not undefined) for a free sub-workflow", async () => {
    const n: SimpleNode = { id: "sw", type: "sub-workflow", data: { workflowId: "ref" } }
    mockExecuteSubWorkflow.mockResolvedValue({ output: { text: "hi" }, creditsUsed: 0 })

    const result = await executeNode(n, noInputs, [], [n], {}, ctx())
    expect(result.creditsUsed).toBe(0)
  })
})

describe("node-executor — component branch credit propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRow = null
    // fetch is used by executeComponentNode to kick off /v1/component/execute.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ jobId: "wrapper-job-1" }),
      })),
    )
  })

  it("surfaces the wrapper job's credits_actual as the node's creditsUsed", async () => {
    // The component-execute route writes the inner execution's
    // total_credits_used into the wrapper job's credits_actual on completion.
    const n: SimpleNode = {
      id: "cmp",
      type: "component",
      data: {
        appSlug: "my-app",
        componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
        exposedSettings: {},
      },
    }
    mockJobRow = {
      status: "completed",
      output_data: { result: "https://r.png" },
      credits_actual: 42,
      progress: 100,
    }

    const result = await executeNode(n, noInputs, [], [n], {}, ctx())

    expect(result.jobId).toBe("wrapper-job-1")
    expect(result.creditsUsed).toBe(42)
  })

  it("treats a missing credits_actual as 0 (no NaN/undefined)", async () => {
    const n: SimpleNode = {
      id: "cmp",
      type: "component",
      data: {
        appSlug: "my-app",
        componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
        exposedSettings: {},
      },
    }
    mockJobRow = {
      status: "completed",
      output_data: { result: "https://r.png" },
      credits_actual: null,
      progress: 100,
    }

    const result = await executeNode(n, noInputs, [], [n], {}, ctx())
    expect(result.creditsUsed).toBe(0)
  })
})
