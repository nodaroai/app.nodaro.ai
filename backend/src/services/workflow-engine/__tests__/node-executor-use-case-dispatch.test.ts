/**
 * node-executor — a use-case node (Tighten Episode) goes to its own executor
 * with its fan-out iteration and sub-workflow scope (its idempotency key's
 * parts), and the wrapper it waited on becomes the node's job. Harness: the
 * component branch of node-executor-component-refusal-copy.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import type { OrchestratorContext } from "../types.js"

const mockExecuteUseCaseNode = vi.hoisted(() => vi.fn(async () => ({ output: { videoUrl: "https://r2/ep-tight.mp4" }, jobId: "job-w", creditsUsed: 942 })))
vi.mock("../use-case-node.js", () => ({ executeUseCaseNode: mockExecuteUseCaseNode }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) }, hasCredits: () => true }))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../../lib/availability-viewer.js", () => ({
  assertNodeAvailableForUser: async () => {},
  viewerForNode: async () => ({ admin: false }),
}))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("../../../ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))

import { executeNode } from "../node-executor.js"

const ctx = { executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual", billingContext: { payer: "user", userId: "user-1" }, cancelled: false } as unknown as OrchestratorContext

describe("executeNode — a use-case node", () => {
  it("dispatches to executeUseCaseNode with its iteration and scope, and reports the wrapper as its job", async () => {
    const node = { id: "t1", type: "tighten-episode", data: { label: "Tighten Episode" } }
    const inputs = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }
    const result = await executeNode(node, inputs, [], [node], {}, ctx, 3, 3, ["sub-1-0"])
    expect(mockExecuteUseCaseNode).toHaveBeenCalledWith(node, inputs, ctx, 3, ["sub-1-0"])
    expect(result).toEqual({ output: { videoUrl: "https://r2/ep-tight.mp4" }, jobId: "job-w", creditsUsed: 942 })
  })
})
