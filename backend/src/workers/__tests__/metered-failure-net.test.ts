/**
 * The worker's final-attempt failure net (`refundJobCredits`) for a METERED
 * LLM hold (A5, D10): a failed job is settled from what it billed — charged
 * its billed usage, refunded only when nothing was billed — never the whole
 * hold committed, never a billed call refunded. Whether the hold is metered
 * is read off its usage log (the reservation decides, not the rollback
 * switch); every other hold refunds exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  action: "generate-script:claude-sonnet-5.5" as string | null,
  readError: false,
  settle: vi.fn(async (..._a: unknown[]) => ({ outcome: "charged", charged: 9, shortfall: 0 }) as { outcome: string; charged?: number; shortfall?: number }),
  refundCredits: vi.fn(async () => {}),
  commitCredits: vi.fn(async () => {}),
  trySettleManagedCredits: vi.fn(async () => false),
  report: vi.fn(async () => true),
  /** The job row's recorded billing (an earlier attempt's running ledger in the server-only `llm_billing` column, its provider_cost). */
  row: null as { llm_billing?: unknown; provider_cost?: number } | null,
  /** The job row's read returns an error (not a throw — supabase's shape). */
  rowError: false,
}))

vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table !== "usage_logs") return h.rowError ? { data: null, error: { message: "timeout" } } : { data: h.row, error: null }
            if (h.readError) return { data: null, error: { message: "boom" } }
            return { data: h.action === null ? null : { action: h.action }, error: null }
          },
        }),
      }),
    }),
  },
}))
vi.mock("../../lib/llm-billing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm-billing.js")>()),
  settleLlmUsageLog: h.settle,
}))
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: { refundCredits: h.refundCredits, commitCredits: h.commitCredits, trySettleManagedCredits: h.trySettleManagedCredits },
}))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: h.report }))

import { attachLlmSpend, refundJobCredits, workerLlmBilling } from "../shared.js"
import { LlmSpend } from "../../lib/llm-billing.js"
import { StructuredLlmError } from "../../lib/llm/structured.js"
import { PostProcessingError } from "../../lib/post-processing-error.js"
import { LlmContentRefusalError } from "../../lib/llm-errors.js"

const ATTEMPT = { lane: "kie" as const, modelId: "claude-sonnet-5.5", requestChars: 6000, inputTokens: 1500, outputTokens: 900, creditsUsd: 0.018 }

function billedSpend(n = 1): LlmSpend {
  const spend = new LlmSpend()
  spend.add("claude-sonnet-5.5", { modelId: "claude-sonnet-5.5", system: "", messages: [] }, {
    output: { attempts: Array.from({ length: n }, () => ATTEMPT) } as never,
  })
  return spend
}

beforeEach(() => {
  vi.clearAllMocks()
  h.row = null
  h.rowError = false
  h.action = "generate-script:claude-sonnet-5.5"
  h.readError = false
  h.settle.mockResolvedValue({ outcome: "charged", charged: 9, shortfall: 0 })
})

describe("worker failure net — a metered hold", () => {
  it("worker failure net: final-attempt failure with billed usage is charged, without usage refunded", async () => {
    // Billed: the handler's spend rides the error (an answer that would not parse).
    const billed = attachLlmSpend(new Error("Failed to parse script output"), billedSpend(2))
    await refundJobCredits("usage-1", "job-1", billed)
    expect(h.settle).toHaveBeenCalledTimes(1)
    const [log, jobId, chargeId, spend] = h.settle.mock.calls[0]! as [string, string, string, LlmSpend]
    expect([log, jobId, chargeId]).toEqual(["usage-1", "job-1", "generate-script:claude-sonnet-5.5"])
    expect(spend.attempts).toHaveLength(2)
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.commitCredits).not.toHaveBeenCalled()

    // Not billed (a transport error before any answer): the settle refunds it.
    h.settle.mockClear()
    h.settle.mockResolvedValue({ outcome: "refunded" })
    await refundJobCredits("usage-1", "job-1", new Error("ECONNRESET"))
    const empty = h.settle.mock.calls[0]![3] as LlmSpend
    expect(empty.billedAnything).toBe(false)
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("an error that carries its own billed usage (no handler spend) is charged from it", async () => {
    const failure = new StructuredLlmError("validation failed", { inputTokens: 3000, outputTokens: 1800, complete: true, attempts: [ATTEMPT, ATTEMPT] })
    await refundJobCredits("usage-1", "job-1", failure)
    expect((h.settle.mock.calls[0]![3] as LlmSpend).attempts).toHaveLength(2)
  })

  it("settles before the post-processing skip and the refusal rule — neither leaves a metered hold reserved or commits it whole", async () => {
    const post = attachLlmSpend(new PostProcessingError("R2 upload failed"), billedSpend())
    await refundJobCredits("usage-1", "job-1", post)
    expect(h.settle).toHaveBeenCalledTimes(1)

    h.settle.mockClear()
    const refusal = new LlmContentRefusalError("refused", { inputTokens: 900, outputTokens: 20, creditsUsd: 0.004, complete: true }, "kie")
    await refundJobCredits("usage-1", "job-1", refusal, { chargeBilledRefusal: true })
    expect((h.settle.mock.calls[0]![3] as LlmSpend).attempts).toHaveLength(1)
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("an unconfirmed settle is left reserved and REPORTED — never refunded", async () => {
    h.settle.mockResolvedValue({ outcome: "unsettled" })
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("x"), billedSpend()))
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-failure", jobId: "job-1", severity: "error" }))
  })

  it("a reservation that cannot be read: a billed failure is left reserved and reported; an unbilled one refunds as before", async () => {
    h.readError = true
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("x"), billedSpend()))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledTimes(1)

    await refundJobCredits("usage-1", "job-1", new Error("ECONNRESET"))
    expect(h.refundCredits).toHaveBeenCalledWith("usage-1")
  })
})

describe("worker failure net — every other hold, exactly as before", () => {
  it("a tier reservation (the rollback) refunds; a billed content refusal of an LLM product commits the hold", async () => {
    h.action = "generate-script:premium"
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("x"), billedSpend()))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).toHaveBeenCalledWith("usage-1")

    const refusal = new LlmContentRefusalError("refused", { inputTokens: 900, outputTokens: 20, creditsUsd: 0.004, complete: true }, "kie")
    await refundJobCredits("usage-1", "job-1", refusal, { chargeBilledRefusal: true })
    expect(h.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("a fixed-price media job refunds as before", async () => {
    h.action = "nano-banana"
    await refundJobCredits("usage-1", "job-1", new Error("provider down"))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).toHaveBeenCalledWith("usage-1")
  })
})

describe("worker failure net — no handler spend: the ROW's recorded billing (I-2, R31)", () => {
  it("billed attempt 1, then attempt 2 failing before its call: the carried attempts are settled, never refunded", async () => {
    h.row = { llm_billing: { costUsd: 0.018, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [ATTEMPT] }, provider_cost: 0.018 }
    await refundJobCredits("usage-1", "job-1", new Error("analysis wait timed out"))
    expect(h.settle).toHaveBeenCalledTimes(1)
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts).toHaveLength(1)
    expect(spend.costUsd).toBeCloseTo(0.018, 10)
    expect(h.refundCredits).not.toHaveBeenCalled()
  })

  it("a row with a recorded cost but no attempts is charged that cost as one stated charge", async () => {
    h.row = { llm_billing: null, provider_cost: 0.03 }
    await refundJobCredits("usage-1", "job-1", new Error("x"))
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.costUsd).toBeCloseTo(0.03, 10)
  })

  it("nothing recorded on the row and nothing billed by the error: refunded through the settle", async () => {
    h.row = { llm_billing: null }
    h.settle.mockResolvedValue({ outcome: "refunded" })
    await refundJobCredits("usage-1", "job-1", new Error("ECONNRESET"))
    expect((h.settle.mock.calls[0]![3] as LlmSpend).billedAnything).toBe(false)
  })
})

describe("worker failure net — the row's billing, read failures and double counting (I-2, D10)", () => {
  it("the row cannot be read (a returned error): the hold is kept and reported — never refunded, never settled on a guess", async () => {
    h.rowError = true
    await refundJobCredits("usage-1", "job-1", new Error("analysis wait timed out"))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-failure", jobId: "job-1" }))
  })

  it("the row's attempts already hold this failure's usage (noteSpend ran before the rethrow): the error's usage is not added again", async () => {
    h.row = { llm_billing: { costUsd: 0.018, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [ATTEMPT] }, provider_cost: 0.018 }
    const err = Object.freeze(new StructuredLlmError("validation failed", {
      inputTokens: 1500, outputTokens: 900, providerCost: 0.018, complete: true, attempts: [ATTEMPT],
    }, { lane: "kie" }))
    await refundJobCredits("usage-1", "job-1", err)
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts).toHaveLength(1)
    expect(spend.costUsd).toBeCloseTo(0.018, 10)
  })

  it("a recorded cost with no attempts is charged on the lane its ledger names", async () => {
    h.row = { llm_billing: { costUsd: 0.03, calls: 1, lanes: ["direct-anthropic"] }, provider_cost: 0.03 }
    await refundJobCredits("usage-1", "job-1", new Error("x"))
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts[0]!.lane).toBe("direct-anthropic")
    expect(spend.costUsd).toBeCloseTo(0.03, 10)
  })
})

describe("worker failure net — stale attempts beside a higher cumulative provider_cost (round 3)", () => {
  it("provider_cost exceeds what the row's attempts sum to (a noteSpend whose read failed wrote the cost alone): the cost is charged, once", async () => {
    // Attempts record 0.018; the newest billed call raised provider_cost to 0.05 without its ledger.
    h.row = { llm_billing: { costUsd: 0.018, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [ATTEMPT] }, provider_cost: 0.05 }
    await refundJobCredits("usage-1", "job-1", new Error("x"))
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts).toHaveLength(1)
    expect(spend.costUsd).toBeCloseTo(0.05, 10) // never 0.018 (the newest call refunded), never 0.068 (double counted)
    expect(h.refundCredits).not.toHaveBeenCalled()
  })

  it("provider_cost equal to the attempts' sum: the attempts are settled as recorded", async () => {
    h.row = { llm_billing: { costUsd: 0.036, source: "kie-stated", calls: 2, lanes: ["kie", "kie"], attempts: [ATTEMPT, ATTEMPT] }, provider_cost: 0.036 }
    await refundJobCredits("usage-1", "job-1", new Error("x"))
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.036, 10)
  })
})

describe("worker failure net — a spend opened unseeded on a final attempt (D13)", () => {
  const FINAL = { attemptsMade: 2, opts: { attempts: 3 } }
  const EARLIER = { llm_billing: { costUsd: 0.018, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [ATTEMPT] }, provider_cost: 0.018 }

  it("the row reads again at the failure: the earlier attempt's calls are seeded in beside this attempt's", async () => {
    h.rowError = true
    const billing = await workerLlmBilling({ jobId: "job-1", usageLogId: "usage-1" }, FINAL)
    billing.recorder.add("claude-sonnet-5.5", { modelId: "claude-sonnet-5.5", system: "", messages: [] }, { output: { attempts: [ATTEMPT] } as never })
    h.rowError = false
    h.row = EARLIER
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("parse failed"), billing.spend))
    const spend = h.settle.mock.calls[0]![3] as LlmSpend
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.036, 10)
  })

  it("the row still cannot be read: kept and reported — never settled on this attempt alone, never refunded", async () => {
    h.rowError = true
    const billing = await workerLlmBilling({ jobId: "job-1", usageLogId: "usage-1" }, FINAL)
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("parse failed"), billing.spend))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-failure", jobId: "job-1" }))
  })

  it("the RESERVATION cannot be read at the failure: kept and reported with that reason (not the ledger's)", async () => {
    h.rowError = true
    const billing = await workerLlmBilling({ jobId: "job-1", usageLogId: "usage-1" }, FINAL)
    h.rowError = false
    h.row = EARLIER
    h.readError = true
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("parse failed"), billing.spend))
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ why: "the reservation could not be read" }) }))
  })

  it("the row still cannot be read: the ledger is named as the reason", async () => {
    h.rowError = true
    const billing = await workerLlmBilling({ jobId: "job-1", usageLogId: "usage-1" }, FINAL)
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("parse failed"), billing.spend))
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ why: "its billing ledger could not be read" }) }))
  })
})
