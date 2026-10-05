/**
 * node-executor — a component node whose inner run was refused with a STABLE
 * CODE (the preview stop rule writes the bare code as the inner execution's
 * error_message) fails with the readable copy on the canvas node, keeping the
 * code in `errorCode` for clients that branch on it — the way the sub-workflow
 * backstop throws PREVIEW_RENDER_NESTED_MESSAGE. Harness: the component branch
 * of node-executor-credit-propagation.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { PREVIEW_RENDER_NESTED, PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared"
import type { SimpleNode, ResolvedInputs, OrchestratorContext } from "../types.js"
import { PREVIEW_RENDER_NESTED_MESSAGE } from "../nested-preview-renders.js"
import { PREVIEW_REVIEW_REQUIRED_MESSAGE } from "../../../lib/preview-review-gate.js"

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
// executeNode asks the availability door first; the real module reads the
// deployment profile through config helpers this file's config stub omits.
vi.mock("../../../lib/availability-viewer.js", () => ({
  assertNodeAvailableForUser: async () => {},
  viewerForNode: async () => ({ admin: false }),
}))
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
    billingContext: { payer: "user", userId: "user-1" },
    cancelled: false,
    ...overrides,
  }
}

const noInputs: ResolvedInputs = {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const component: SimpleNode = {
  id: "cmp",
  type: "component",
  data: {
    appSlug: "my-app",
    componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
    exposedSettings: {},
  },
}

describe("node-executor — a component's refused inner run reads as its copy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRow = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ jobId: "wrapper-job-1" }) })),
    )
  })

  it.each([
    [PREVIEW_RENDER_NESTED, PREVIEW_RENDER_NESTED_MESSAGE],
    [PREVIEW_REVIEW_REQUIRED, PREVIEW_REVIEW_REQUIRED_MESSAGE],
  ])("%s → the en copy, with the code in errorCode", async (code, message) => {
    mockJobRow = { status: "failed", error_message: code, progress: 0 }
    const err = (await executeNode(component, noInputs, [], [component], {}, ctx()).catch((e) => e)) as Error & {
      errorCode?: string
    }
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(message)
    expect(err.errorCode).toBe(code)
  })

  // The component's inner run is a NEW job across an HTTP hop: the parent's
  // answer to "does the preview stop rule apply?" must ride the body, or a
  // parent queued before the deploy has its component refused (decided
  // 2026-10-05: such a run gets no gate at all).
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("ctx.previewStopRule %s → the internal call carries previewStopRule %s", async (ctxRule, sent) => {
    mockJobRow = { status: "failed", error_message: "x", progress: 0 }
    await executeNode(component, noInputs, [], [component], {}, ctx({ previewStopRule: ctxRule })).catch(() => {})
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v1/component/execute"))
    expect(call).toBeDefined()
    const body = JSON.parse((call![1] as { body: string }).body) as { previewStopRule?: unknown }
    expect(body.previewStopRule).toBe(sent)
  })

  it("any other failure passes through unchanged", async () => {
    mockJobRow = { status: "failed", error_message: "Provider exploded", progress: 0 }
    const err = (await executeNode(component, noInputs, [], [component], {}, ctx()).catch((e) => e)) as Error & {
      errorCode?: string
    }
    expect(err.message).toBe("Provider exploded")
    expect(err.errorCode).toBeUndefined()
  })
})
