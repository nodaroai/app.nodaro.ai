import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  error: null as { message: string } | null,
  filters: [] as string[],
  update: null as Record<string, unknown> | null,
  children: vi.fn(async (_exec: string, _owner: string) => ({ cancelled: 0, adoptable: new Map() })),
}))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        m.update = row
        const chain: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { m.filters.push(`${c}=${String(v)}`); return chain },
          in: async (c: string, v: unknown[]) => { m.filters.push(`${c} in ${v.join("|")}`); return { data: null, error: m.error } },
        }
        return chain
      },
    }),
  },
}))
vi.mock("../../reconcile/cancel-inflight-jobs.js", () => ({ cancelInFlightChildJobs: m.children }))
import { cancelUseCaseInnerExecution } from "../cancel-run.js"

beforeEach(() => { m.error = null; m.filters.length = 0; m.update = null; m.children.mockClear() })

describe("cancelUseCaseInnerExecution", () => {
  it("cancels the run's not-yet-started jobs, then flips the owner's live run to cancelled", async () => {
    await cancelUseCaseInnerExecution("exec-in", "u1", "Cancelled with its node")
    expect(m.children).toHaveBeenCalledWith("exec-in", "u1")
    expect(m.update).toMatchObject({ status: "cancelled", error_message: "Cancelled with its node" })
    expect(m.filters).toEqual(["id=exec-in", "user_id=u1", "status in pending|running|stopping"])
  })
  it("a failed flip throws (the caller logs it; a silent no-op would leave the run billing)", async () => {
    m.error = { message: "db down" }
    await expect(cancelUseCaseInnerExecution("exec-in", "u1", "x")).rejects.toThrow(/db down/)
  })
})
