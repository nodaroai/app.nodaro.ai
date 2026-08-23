/**
 * Settling a turn whose process died.
 *
 * The generic sync sweep refunds — right for a provider call that never
 * happened, wrong for a turn that already burned model tokens. This handler
 * charges what was spent and refunds only when nothing was.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const { fromMock, commitMock, refundMock, tables } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  commitMock: vi.fn(),
  refundMock: vi.fn(),
  tables: {
    turn: null as null | { id: string; thread_id: string; cost_usd: number | null; status: string },
    jobUpdateResult: [] as Array<{ id: string; usage_log_id: string | null }>,
    jobUpdatePatch: null as null | Record<string, unknown>,
    turnUpdatePatch: null as null | Record<string, unknown>,
  },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("@/workers/shared.js", () => ({ commitJobCredits: commitMock }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: refundMock }))

const { reconcileCopilotTurn } = await import("../reconcile.js")

function chainFor(table: string) {
  if (table === "copilot_turns") {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: tables.turn }),
      update: vi.fn((patch: Record<string, unknown>) => {
        tables.turnUpdatePatch = patch
        return { eq: vi.fn().mockReturnThis() }
      }),
    }
  }
  return {
    update: vi.fn((patch: Record<string, unknown>) => {
      tables.jobUpdatePatch = patch
      return {
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: tables.jobUpdateResult }),
      }
    }),
  }
}

beforeEach(() => {
  fromMock.mockReset()
  fromMock.mockImplementation(chainFor)
  commitMock.mockReset()
  refundMock.mockReset()
  tables.turn = { id: "turn1", thread_id: "th1", cost_usd: 0.42, status: "running" }
  tables.jobUpdateResult = [{ id: "job1", usage_log_id: "log1" }]
  tables.jobUpdatePatch = null
  tables.turnUpdatePatch = null
})

describe("reconcileCopilotTurn", () => {
  it("charges the persisted spend instead of refunding it", async () => {
    await reconcileCopilotTurn({ id: "job1", reconcile_attempts: 0 })
    expect(commitMock).toHaveBeenCalledWith("log1", "job1", 0.42, 0, true, true)
    expect(refundMock).not.toHaveBeenCalled()
    expect(tables.jobUpdatePatch?.status).toBe("completed")
  })

  it("refunds when the turn spent nothing", async () => {
    tables.turn = { id: "turn1", thread_id: "th1", cost_usd: 0, status: "running" }
    await reconcileCopilotTurn({ id: "job1", reconcile_attempts: 0 })
    expect(refundMock).toHaveBeenCalledWith("job1")
    expect(commitMock).not.toHaveBeenCalled()
    expect(tables.jobUpdatePatch?.status).toBe("failed")
  })

  it("does nothing when a live handler already settled the job", async () => {
    tables.jobUpdateResult = []
    await reconcileCopilotTurn({ id: "job1", reconcile_attempts: 0 })
    expect(commitMock).not.toHaveBeenCalled()
    expect(refundMock).not.toHaveBeenCalled()
  })

  it("settles the turn row so the thread is not wedged", async () => {
    await reconcileCopilotTurn({ id: "job1", reconcile_attempts: 1 })
    expect(tables.turnUpdatePatch).toMatchObject({ status: "failed", error: "turn_abandoned" })
  })
})
