// A fixed + calls job (the Meta Ads and Instagram scrapes) whose completion or
// failure write lost its CAS settles its calls as a cancel ONLY when its row
// was cancelled. Two attempts of one job can both run (a lock that lapsed under
// a live attempt): the one whose write lost to the other's completion must not
// settle the winner's still-reserved hold as a cancel — that would charge a
// delivered scrape only its analyses and file an anomaly.
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  row: { status: "cancelled" } as { status: string } | null,
  readError: null as null | { message: string },
  reads: 0,
  afterFlip: vi.fn(async (..._a: unknown[]) => "settled" as "kept" | "settled" | "refund"),
  refund: vi.fn(async (..._a: unknown[]) => 0),
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, id: string) => ({
          maybeSingle: async () => {
            expect([table, cols, col, id]).toEqual(["jobs", "status", "id", "job-1"])
            h.reads++
            return h.readError ? { data: null, error: h.readError } : { data: h.row, error: null }
          },
        }),
      }),
    }),
  },
}))
vi.mock("../cancel-job.js", () => ({ settleMeteredHoldAfterFlip: h.afterFlip }))
vi.mock("../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: h.refund }))

const { settleFixedPlusLlmCallsAfterCancel } = await import("../llm-fixed-plus-calls.js")

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { status: "cancelled" }
  h.readError = null
  h.reads = 0
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("settleFixedPlusLlmCallsAfterCancel", () => {
  it("a cancelled row: settles its calls by the cancel's after-flip rule (status read once)", async () => {
    await settleFixedPlusLlmCallsAfterCancel("job-1")
    expect(h.reads).toBe(1)
    expect(h.afterFlip).toHaveBeenCalledWith("job-1")
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("a cancelled row whose calls billed nothing is refunded", async () => {
    h.afterFlip.mockResolvedValueOnce("refund")
    await settleFixedPlusLlmCallsAfterCancel("job-1")
    expect(h.refund).toHaveBeenCalledWith("job-1")
  })

  it.each(["completed", "failed", "processing"])("a %s row (another attempt won the write) settles nothing: its hold stays the winner's", async (status) => {
    h.row = { status }
    await settleFixedPlusLlmCallsAfterCancel("job-1")
    expect(h.reads).toBe(1)
    expect(h.afterFlip).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("a status that cannot be read settles nothing and never throws (the cancelled-hold sweep has it)", async () => {
    h.readError = { message: "connection reset" }
    await expect(settleFixedPlusLlmCallsAfterCancel("job-1")).resolves.toBeUndefined()
    expect(h.afterFlip).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("a missing row settles nothing", async () => {
    h.row = null
    await settleFixedPlusLlmCallsAfterCancel("job-1")
    expect(h.afterFlip).not.toHaveBeenCalled()
  })
})
