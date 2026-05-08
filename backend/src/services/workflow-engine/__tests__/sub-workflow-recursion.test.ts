/**
 * L2#6 — Sub-workflow recursion depth + cycle detection.
 *
 * `executeSubWorkflow` enforces two safety invariants:
 *
 *   1. **Depth limit:** rejects when current depth >= MAX_SUB_WORKFLOW_DEPTH.
 *      Without this, an unbounded chain of sub-workflows can blow the
 *      orchestrator stack and starve other executions.
 *
 *   2. **Cycle detection:** rejects when (workflowId, routeId) pair is
 *      already in the executingRouteKeys set. Same workflowId with a
 *      DIFFERENT routeId is allowed (legitimate fan-out into a different
 *      route of the same workflow).
 *
 * Both checks happen BEFORE any database call, so the test can probe them
 * with minimal mocking.
 *
 * Bug class: a malicious or accidentally-recursive workflow chains to
 * itself indefinitely → orchestrator hang, BullMQ queue backup.
 */

import { describe, it, expect, vi } from "vitest"
import type { SimpleNode } from "../types.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "../types.js"

// Mock supabase + admin-check to keep the test hermetic. The depth + cycle
// checks both run before any DB call, so the mocks just keep imports clean.
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    })),
  },
}))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

import { executeSubWorkflow } from "../sub-workflow-handler.js"
import type { OrchestratorContext } from "../types.js"

function makeNode(workflowId: string, routeId = "default"): SimpleNode {
  return {
    id: `sw-${workflowId}-${routeId}`,
    type: "sub-workflow",
    data: { workflowId, selectedRouteId: routeId },
  }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    userId: "user-1",
    workflowOwnerId: "user-1",
  } as OrchestratorContext
}

// ---------------------------------------------------------------------------
// Sanity: MAX_SUB_WORKFLOW_DEPTH is a sensible value (small positive int).
// ---------------------------------------------------------------------------

describe("MAX_SUB_WORKFLOW_DEPTH constant", () => {
  it("is a small positive integer (1-10)", () => {
    expect(MAX_SUB_WORKFLOW_DEPTH).toBeGreaterThanOrEqual(1)
    expect(MAX_SUB_WORKFLOW_DEPTH).toBeLessThanOrEqual(10)
    expect(Number.isInteger(MAX_SUB_WORKFLOW_DEPTH)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — depth limit throws.
// ---------------------------------------------------------------------------

describe("executeSubWorkflow — depth limit", () => {
  it(`throws when depth equals MAX_SUB_WORKFLOW_DEPTH (${MAX_SUB_WORKFLOW_DEPTH})`, async () => {
    await expect(
      executeSubWorkflow(
        makeNode("wf-1"),
        {},
        makeCtx(),
        MAX_SUB_WORKFLOW_DEPTH,
        new Set(),
      ),
    ).rejects.toThrow(/depth limit exceeded/)
  })

  it(`throws when depth exceeds MAX_SUB_WORKFLOW_DEPTH (${MAX_SUB_WORKFLOW_DEPTH + 1})`, async () => {
    await expect(
      executeSubWorkflow(
        makeNode("wf-1"),
        {},
        makeCtx(),
        MAX_SUB_WORKFLOW_DEPTH + 1,
        new Set(),
      ),
    ).rejects.toThrow(/depth limit exceeded/)
  })

  it("the error message names the actual max depth value", async () => {
    let err: Error | undefined
    try {
      await executeSubWorkflow(
        makeNode("wf-1"),
        {},
        makeCtx(),
        MAX_SUB_WORKFLOW_DEPTH,
        new Set(),
      )
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toContain(String(MAX_SUB_WORKFLOW_DEPTH))
  })
})

// ---------------------------------------------------------------------------
// Test 2 — cycle detection throws.
// ---------------------------------------------------------------------------

describe("executeSubWorkflow — cycle detection", () => {
  it("throws when the (workflowId, routeId) pair is already in executingRouteKeys", async () => {
    const seen = new Set<string>(["wf-1:default"])
    await expect(
      executeSubWorkflow(makeNode("wf-1", "default"), {}, makeCtx(), 0, seen),
    ).rejects.toThrow(/Cycle detected/)
  })

  it("error message includes the offending routeKey", async () => {
    const seen = new Set<string>(["wf-1:routeA"])
    let err: Error | undefined
    try {
      await executeSubWorkflow(makeNode("wf-1", "routeA"), {}, makeCtx(), 0, seen)
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toContain("wf-1:routeA")
  })

  it("does NOT throw when the SAME workflowId is reached via a DIFFERENT routeId (legitimate fan-out)", async () => {
    // executingRouteKeys has wf-1:routeA. We're now entering wf-1:routeB.
    // Different routes of the same workflow are independent fan-outs and
    // should NOT be flagged as cycles. The handler will pass the cycle
    // check and proceed to the DB lookup; with our supabase mock returning
    // null, it then throws "Referenced workflow ... not found" — a
    // DIFFERENT error than "Cycle detected".
    const seen = new Set<string>(["wf-1:routeA"])
    await expect(
      executeSubWorkflow(makeNode("wf-1", "routeB"), {}, makeCtx(), 0, seen),
    ).rejects.not.toThrow(/Cycle detected/)
  })

  it("default routeId is treated as a distinct key", async () => {
    // wf-1:default vs wf-1:custom should NOT collide
    const seen = new Set<string>(["wf-1:custom"])
    await expect(
      executeSubWorkflow(makeNode("wf-1"), {}, makeCtx(), 0, seen),
    ).rejects.not.toThrow(/Cycle detected/)
  })
})

// ---------------------------------------------------------------------------
// Test 3 — depth check fires BEFORE cycle check (depth is the harder limit).
// ---------------------------------------------------------------------------

describe("depth check has precedence over cycle check", () => {
  it("at MAX depth + already-seen routeKey, the depth error wins", async () => {
    const seen = new Set<string>(["wf-1:default"])
    await expect(
      executeSubWorkflow(
        makeNode("wf-1"),
        {},
        makeCtx(),
        MAX_SUB_WORKFLOW_DEPTH,
        seen,
      ),
    ).rejects.toThrow(/depth limit exceeded/)
  })
})
