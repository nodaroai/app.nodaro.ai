// P14 — the schedule fire's payer resolve INPUTS are pinned, not just
// presence: a wrong identity there spends someone else's money (the same pin
// the webhook and manual-run lanes already carry).
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCanRun, mockResolve, mockQueueAdd, execInserts, mockRecordRefusal } = vi.hoisted(() => ({
  mockCanRun: vi.fn(),
  mockResolve: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })),
  mockQueueAdd: vi.fn(async () => ({})),
  execInserts: [] as Array<Record<string, unknown>>,
  mockRecordRefusal: vi.fn(async () => undefined),
}))

vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: mockCanRun }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: mockRecordRefusal,
  RUN_REQUIRES_AUTHENTICATED_MEMBER: "run_requires_authenticated_member",
}))
vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-context.js")>()
  return { ...actual, resolveBillingContext: mockResolve }
})
vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: mockQueueAdd },
}))

const TRIGGER = {
  id: "trig-1",
  workflow_id: "wf-1",
  user_id: "owner-1",
  // Fires every minute; last fire long past.
  config: { interval: "1m" },
  last_triggered_at: "2020-01-01T00:00:00.000Z",
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "limit", "update", "order"]) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      chain.single = vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null })
      if (table === "workflow_triggers") {
        // The triggers listing resolves the chain itself (thenable).
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [TRIGGER], error: null })
        return chain
      }
      if (table === "workflow_executions") {
        // Active-exec check resolves empty; the insert is captured.
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
        chain.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
          execInserts.push(row)
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }),
            }),
          }
        })
        return chain
      }
      return chain
    }),
  },
}))

import { checkScheduledTriggers } from "../schedule-cron.js"

beforeEach(() => {
  vi.clearAllMocks()
  execInserts.length = 0
})

describe("schedule fire payer (P14)", () => {
  it("resolves under the TRIGGER OWNER and the workflow's CURRENT home; row and payload carry the answer", async () => {
    mockCanRun.mockResolvedValue(true)
    await checkScheduledTriggers()

    expect(mockResolve).toHaveBeenCalledWith({ userId: "owner-1", workflowId: "wf-1" })
    expect(execInserts).toHaveLength(1)
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        userId: "owner-1",
        triggerType: "schedule",
        billingContext: { payer: "user", userId: "owner-1" },
      }),
      expect.anything(),
    )
  })

  it("an owner who lost run access: tick skipped, ONE recorded refusal, no resolve", async () => {
    mockCanRun.mockResolvedValue(false)
    await checkScheduledTriggers()

    expect(mockRecordRefusal).toHaveBeenCalledWith({
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "schedule",
      triggerId: "trig-1",
    })
    expect(mockResolve).not.toHaveBeenCalled()
    expect(execInserts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
