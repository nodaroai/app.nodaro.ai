/**
 * `refundJobHoldsConfirmed` — a refund the caller may DELETE the job after.
 * True only when a read after the refund finds nothing of the job's still
 * `reserved`: a refund that fails, or a read that fails, is never "done"
 * (deleting the job would strand the hold — `usage_logs.job_id` is ON DELETE
 * SET NULL). `jobCreditHolds` — which jobs hold credits; null when unknown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  /** Reserved log ids per read, in order; `"error"` = the read fails. */
  reads: [] as Array<string[] | "error">,
  refundFails: new Set<string>(),
  refunds: [] as string[],
  holdsResult: { data: [] as Array<{ id: string; job_id: string | null; credits_used?: number }>, error: null as unknown },
  holdsQuery: [] as unknown[][],
  holdsOrder: [] as string[],
  /** Status each single-log read answers, in order. */
  logStatuses: [] as Array<string | "error">,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        if (cols === "id, job_id, credits_used") {
          return {
            in: (_c: string, ids: string[]) => ({
              in: (_s: string, statuses: string[]) => {
                h.holdsQuery.push([ids, statuses])
                const ordered = {
                  order: (col: string) => {
                    h.holdsOrder.push(col)
                    return h.holdsOrder.length % 2 === 1 ? ordered : Promise.resolve(h.holdsResult)
                  },
                }
                return ordered
              },
            }),
          }
        }
        if (cols === "status") {
          return {
            eq: () => ({
              maybeSingle: () => {
                const next = h.logStatuses.shift() ?? "refunded"
                return Promise.resolve(next === "error" ? { data: null, error: { message: "timeout" } } : { data: { status: next }, error: null })
              },
            }),
          }
        }
        return {
          eq: () => ({
            eq: () => {
              const next = h.reads.shift() ?? []
              return Promise.resolve(next === "error"
                ? { data: null, error: { message: "timeout" } }
                : { data: next.map((id) => ({ id })), error: null })
            },
          }),
        }
      },
    }),
  },
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    refundCredits: vi.fn(async (id: string) => {
      h.refunds.push(id)
      if (h.refundFails.has(id)) throw new Error("rpc failed")
    }),
  },
}))

import { jobCreditHolds, refundJobHoldsConfirmed, refundUsageLogConfirmed } from "../credits-job-lifecycle.js"

beforeEach(() => {
  h.reads = []
  h.refundFails.clear()
  h.refunds.length = 0
  h.holdsResult = { data: [], error: null }
  h.holdsQuery.length = 0
  h.holdsOrder.length = 0
  h.logStatuses = []
})

describe("refundJobHoldsConfirmed", () => {
  it("nothing held: confirmed at once, nothing refunded", async () => {
    h.reads = [[]]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(true)
    expect(h.refunds).toEqual([])
  })

  it("refunds the hold and confirms it by reading again", async () => {
    h.reads = [["log-1"], []]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(true)
    expect(h.refunds).toEqual(["log-1"])
  })

  it("a refund that keeps failing is NOT confirmed (tries twice, then reads)", async () => {
    h.refundFails.add("log-1")
    h.reads = [["log-1"], ["log-1"], ["log-1"]]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(false)
    expect(h.refunds).toEqual(["log-1", "log-1"])
  })

  it("a refund that succeeds on the second try is confirmed", async () => {
    h.reads = [["log-1"], ["log-1"], []]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(true)
  })

  it("a read that fails is NOT confirmed — it never looks like 'nothing held'", async () => {
    h.reads = ["error"]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(false)
    h.reads = [["log-1"], "error"]
    expect(await refundJobHoldsConfirmed("job-1")).toBe(false)
  })
})

describe("jobCreditHolds", () => {
  it("maps each job to its reserved or committed logs, oldest first", async () => {
    h.holdsResult = { data: [
      { id: "log-a", job_id: "job-a", credits_used: 60 },
      { id: "log-b", job_id: "job-b", credits_used: 90 },
      { id: "log-a2", job_id: "job-a", credits_used: 60 },
    ], error: null }
    const holds = await jobCreditHolds(["job-a", "job-b", "job-c"])
    expect([...holds!]).toEqual([
      ["job-a", [{ id: "log-a", credits: 60 }, { id: "log-a2", credits: 60 }]],
      ["job-b", [{ id: "log-b", credits: 90 }]],
    ])
    expect(h.holdsQuery).toEqual([[["job-a", "job-b", "job-c"], ["reserved", "committed"]]])
    // Every reader orders them the same way: by creation, then id.
    expect(h.holdsOrder).toEqual(["created_at", "id"])
  })

  it("null when the read fails", async () => {
    h.holdsResult = { data: [], error: { message: "timeout" } }
    expect(await jobCreditHolds(["job-a"])).toBeNull()
  })

  it("no jobs: no read", async () => {
    expect([...(await jobCreditHolds([]))!]).toEqual([])
    expect(h.holdsQuery).toEqual([])
  })
})

describe("refundUsageLogConfirmed", () => {
  it("refunds the one log and confirms it is no longer reserved", async () => {
    h.logStatuses = ["refunded"]
    expect(await refundUsageLogConfirmed("log-1")).toBe(true)
    expect(h.refunds).toEqual(["log-1"])
  })

  it("not confirmed while the log stays reserved (tries twice)", async () => {
    h.refundFails.add("log-1")
    h.logStatuses = ["reserved", "reserved"]
    expect(await refundUsageLogConfirmed("log-1")).toBe(false)
    expect(h.refunds).toEqual(["log-1", "log-1"])
  })

  it("not confirmed when the read fails", async () => {
    h.logStatuses = ["error", "error"]
    expect(await refundUsageLogConfirmed("log-1")).toBe(false)
  })
})
