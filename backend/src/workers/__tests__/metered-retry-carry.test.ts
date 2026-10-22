/**
 * R31: a metered worker job's spend is carried across BullMQ attempts. The
 * queue default is `attempts: 3` (generate-script, lottie motion graphics),
 * and the video worker rethrows a non-final failure for a fresh attempt —
 * which used to start an empty spend, leaving every earlier BILLED attempt
 * free. Each attempt now records what it billed on the row (`noteSpend`: a
 * running ledger with its attempts, in the server-only `jobs.llm_billing`
 * column — never `output_data`, R32) and the next attempt's spend starts from
 * it. An unbilled transient failure (a 5xx with no usage) records nothing and
 * retries as before.
 *
 * Drives the REAL `workerLlmBilling` against an in-memory jobs row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  row: {
    output_data: null as Record<string, unknown> | null,
    provider_cost: null as number | null,
    llm_billing: null as Record<string, unknown> | null,
  },
  /** Every jobs-row select's column list. */
  selects: [] as string[],
  failRead: false,
  /** Fail only the next N jobs-row reads (a transient blip). */
  failNext: 0,
  /** The filters of a conditional (`.or`) update — the monotone provider_cost write. */
  orFilters: [] as string[],
  settle: vi.fn(async (..._a: unknown[]) => ({ outcome: "charged", charged: 40, shortfall: 0 }) as { outcome: string; charged?: number; shortfall?: number }),
}))

vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "jobs") h.selects.push(cols)
            if (table === "usage_logs") return { data: { action: "generate-script:claude-sonnet-5.5" }, error: null }
            if (h.failNext > 0) {
              h.failNext--
              return { data: null, error: { message: "read failed" } }
            }
            if (h.failRead) return { data: null, error: { message: "read failed" } }
            return { data: { provider_cost: h.row.provider_cost, llm_billing: h.row.llm_billing }, error: null }
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          // A plain update applies when awaited; `.or(...)` applies only when the row matches
          // (`provider_cost.is.null,provider_cost.lt.<cost>`).
          then: (resolve: (v: { error: null }) => void) => {
            Object.assign(h.row, patch)
            resolve({ error: null })
          },
          or: async (filter: string) => {
            h.orFilters.push(filter)
            const cost = patch.provider_cost as number
            if (h.row.provider_cost === null || h.row.provider_cost < cost) Object.assign(h.row, patch)
            return { error: null }
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

import { workerLlmBilling } from "../shared.js"
import type { LlmRequest, LlmResponse } from "../../lib/llm/types.js"

const ctx = { jobId: "job-1", usageLogId: "usage-1" }
/** A BullMQ attempt with retries left (the queue default `attempts: 3`). */
const job = { attemptsMade: 0, opts: { attempts: 3 } }
const MODEL = "claude-sonnet-5.5"
const request: LlmRequest = { modelId: MODEL, system: "S".repeat(1200), messages: [{ role: "user", content: "write a heist" }] }
const answer = (creditsUsd: number): LlmResponse =>
  ({ text: "…", usage: { inputTokens: 900, outputTokens: 700 }, creditsUsd, lane: "kie" }) as LlmResponse

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { output_data: null, provider_cost: null, llm_billing: null }
  h.selects = []
  h.failRead = false
  h.failNext = 0
  h.orFilters = []
})

describe("R31: every BILLED BullMQ attempt of a metered job is charged", () => {
  it("billed fail, then success → both charged", async () => {
    // Attempt 1: the model answered (billed) and the answer would not parse → the handler records it, then rethrows.
    const first = await workerLlmBilling(ctx, job)
    first.recorder.add(MODEL, request, { response: answer(0.02) })
    await first.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.02, 10)
    // The running ledger: its own column, with its charge id — never output_data (R32).
    expect(h.row.llm_billing).toMatchObject({ calls: 1, chargeId: "generate-script:claude-sonnet-5.5" })
    expect(h.row.output_data).toBeNull()

    // Attempt 2 (a fresh process / handler call): starts from attempt 1's spend, then succeeds.
    const second = await workerLlmBilling(ctx, job)
    expect(second.spend.attempts).toHaveLength(1)
    second.recorder.add(MODEL, request, { response: answer(0.03) })
    const settled = await second.settle()

    const spend = h.settle.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.05, 10)
    expect(settled).toMatchObject({ metered: true, outcome: "charged", charged: 40 })
    expect(settled).not.toHaveProperty("billing") // the settle writes the ledger column itself
  })

  it("unbilled fail (a 5xx with no usage), then success → one charged", async () => {
    const first = await workerLlmBilling(ctx, job)
    first.recorder.add(MODEL, request, { error: new Error("KIE 502 Bad Gateway") })
    await first.noteSpend()
    // Nothing billed → nothing written: the retry is today's retry.
    expect(h.row.output_data).toBeNull()
    expect(h.row.llm_billing).toBeNull()
    expect(h.row.provider_cost).toBeNull()

    const second = await workerLlmBilling(ctx, job)
    expect(second.spend.attempts).toHaveLength(0)
    second.recorder.add(MODEL, request, { response: answer(0.03) })
    await second.settle()
    expect((h.settle.mock.calls[0]![3] as { attempts: unknown[] }).attempts).toHaveLength(1)
  })

  it("the running ledger replaces its own column with its cost in ONE update; output_data is never touched; a seeded spend needs no read", async () => {
    h.row.output_data = { stage: "drafting", analysisJobId: "a-1" }
    const billing = await workerLlmBilling(ctx, job)
    billing.recorder.add(MODEL, request, { response: answer(0.02) })
    h.selects = []
    h.failRead = true // a seeded spend never reads the row before writing
    await billing.noteSpend()
    expect(h.selects).toEqual([])
    expect(h.row.output_data).toEqual({ stage: "drafting", analysisJobId: "a-1" })
    expect(h.row.llm_billing).toMatchObject({ calls: 1, attempts: [expect.objectContaining({ creditsUsd: 0.02 })] })
    expect(h.row.provider_cost).toBeCloseTo(0.02, 10)

    billing.recorder.add(MODEL, request, { response: answer(0.01) })
    await billing.noteSpend()
    expect(h.row.llm_billing).toMatchObject({ calls: 2 })
    expect(h.row.provider_cost).toBeCloseTo(0.03, 10)
  })

  it("a row that cannot be read at the start fails the attempt closed while a retry remains, before any call (D13)", async () => {
    h.failRead = true
    await expect(workerLlmBilling(ctx, job)).rejects.toThrow(/billing ledger could not be read/)
    await expect(workerLlmBilling(ctx, { attemptsMade: 1, opts: { attempts: 3 } })).rejects.toThrow(/a retry remains/)
  })

  it("settle() never reads the row back for a seeded spend (a failed read cannot drop what it settles)", async () => {
    const billing = await workerLlmBilling(ctx, job)
    billing.recorder.add(MODEL, request, { response: answer(0.02) })
    h.failRead = true
    const settled = await billing.settle()
    expect(settled).toMatchObject({ metered: true, charged: 40 })
    expect((h.settle.mock.calls[0]![3] as { costUsd: number }).costUsd).toBeCloseTo(0.02, 10)
  })
})

describe("D13: a row that cannot be read at the start of the FINAL / only attempt — proceed", () => {
  it("a single-attempt job (llm-structured, 3d-scene run attempts: 1) proceeds and settles what it billed", async () => {
    h.failRead = true
    for (const only of [{ attemptsMade: 0, opts: { attempts: 1 } }, { attemptsMade: 0, opts: {} }]) {
      h.settle.mockClear()
      const billing = await workerLlmBilling(ctx, only)
      expect(billing.metered).toBe(true)
      expect(billing.spend.attempts).toHaveLength(0)
      billing.recorder.add(MODEL, request, { response: answer(0.03) })
      const settled = await billing.settle()
      const spend = h.settle.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
      expect(spend.attempts).toHaveLength(1)
      expect(spend.costUsd).toBeCloseTo(0.03, 10)
      expect(settled).toMatchObject({ metered: true, outcome: "charged" })
    }
  })

  it("the final attempt of a retried job: the first read that succeeds (noteSpend) seeds the earlier billed calls in", async () => {
    // Attempt 1 billed 0.02 and recorded it.
    const first = await workerLlmBilling(ctx, job)
    first.recorder.add(MODEL, request, { response: answer(0.02) })
    await first.noteSpend()

    // Final attempt: the start read fails, then the row reads again.
    h.failNext = 1
    const last = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    expect(last.spend.attempts).toHaveLength(0)
    last.recorder.add(MODEL, request, { response: answer(0.03) })
    await last.noteSpend()
    expect(last.spend.attempts).toHaveLength(2)
    expect(h.row.provider_cost).toBeCloseTo(0.05, 10)
    expect(h.row.llm_billing).toMatchObject({ calls: 2 })

    await last.settle()
    const spend = h.settle.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2) // seeded once — never counted twice
    expect(spend.costUsd).toBeCloseTo(0.05, 10)
  })

  it("no noteSpend read succeeds: settle reads once more and seeds; the cost write meanwhile only raises provider_cost", async () => {
    const first = await workerLlmBilling(ctx, job)
    first.recorder.add(MODEL, request, { response: answer(0.04) })
    await first.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.04, 10)

    h.failNext = 2 // the start read and noteSpend's read
    const last = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    last.recorder.add(MODEL, request, { response: answer(0.01) })
    await last.noteSpend()
    expect(h.orFilters).toHaveLength(1)
    expect(h.row.provider_cost).toBeCloseTo(0.04, 10) // the cumulative figure is never lowered
    // Still unseeded: the ledger is never written (the late seed would count this attempt twice).
    expect(h.row.llm_billing).toMatchObject({ calls: 1 })

    await last.settle()
    const spend = h.settle.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.05, 10)
  })

  it("the row stays unreadable through the settle: what this final attempt billed is settled (D13: proceed)", async () => {
    h.failRead = true
    const last = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    last.recorder.add(MODEL, request, { response: answer(0.03) })
    await last.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.03, 10) // raised from nothing: the job reads as billed
    await last.settle()
    expect((h.settle.mock.calls[0]![3] as { attempts: unknown[] }).attempts).toHaveLength(1)
  })
})

describe("round 4: the START carry floors to a higher provider_cost (stale attempts)", () => {
  const STALE = { lane: "kie" as const, modelId: MODEL, requestChars: 6000, inputTokens: 1500, outputTokens: 900, creditsUsd: 0.018 }
  const ledgerOf = (attempts: unknown[], costUsd: number) => ({ costUsd, source: "kie-stated", calls: attempts.length, lanes: ["kie"], attempts })

  it("attempts 0.018 + provider_cost 0.05 → the carried spend totals 0.05; after this attempt bills nothing is counted twice", async () => {
    h.row = { output_data: null, provider_cost: 0.05, llm_billing: ledgerOf([STALE], 0.018) }
    const second = await workerLlmBilling(ctx, { attemptsMade: 1, opts: { attempts: 3 } })
    expect(second.spend.attempts).toHaveLength(2) // the recorded attempt + one stated for the difference
    expect(second.spend.costUsd).toBeCloseTo(0.05, 10)
    expect(second.spend.attempts[1]).toMatchObject({ lane: "kie", modelId: MODEL, creditsUsd: expect.closeTo(0.032, 10) })

    second.recorder.add(MODEL, request, { response: answer(0.03) })
    await second.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.08, 10)
    const attempts = (h.row.llm_billing as { attempts: Array<{ creditsUsd: number }> }).attempts
    expect(attempts.reduce((sum, a) => sum + a.creditsUsd, 0)).toBeCloseTo(0.08, 10) // the row's attempts now equal its cost

    // A further attempt carries 0.08 — never re-floored to 0.11.
    const third = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    expect(third.spend.costUsd).toBeCloseTo(0.08, 10)
    third.recorder.add(MODEL, request, { response: answer(0.01) })
    await third.settle()
    expect((h.settle.mock.calls[0]![3] as { costUsd: number }).costUsd).toBeCloseTo(0.09, 10)
  })

  it("a provider_cost with no ledger at all (the earlier attempt's only noteSpend read failed) is carried whole, as one stated attempt", async () => {
    h.row = { output_data: null, provider_cost: 0.05, llm_billing: null }
    const billing = await workerLlmBilling(ctx, { attemptsMade: 1, opts: { attempts: 3 } })
    expect(billing.spend.attempts).toHaveLength(1)
    expect(billing.spend.costUsd).toBeCloseTo(0.05, 10)
  })

  it("provider_cost equal to the attempts' sum → carried as recorded, no stated attempt", async () => {
    h.row = { output_data: null, provider_cost: 0.036, llm_billing: ledgerOf([STALE, STALE], 0.036) }
    const billing = await workerLlmBilling(ctx, { attemptsMade: 1, opts: { attempts: 3 } })
    expect(billing.spend.attempts).toHaveLength(2)
    expect(billing.spend.costUsd).toBeCloseTo(0.036, 10)
  })

  it("the LATE seed never floors: this attempt's monotone write may already be in provider_cost", async () => {
    h.row = { output_data: null, provider_cost: 0.018, llm_billing: ledgerOf([STALE], 0.018) }
    h.failNext = 2 // the start read and noteSpend's read
    const last = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    last.recorder.add(MODEL, request, { response: answer(0.04) })
    await last.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.04, 10) // raised to this attempt's own cost
    await last.settle() // the late seed: the row's attempts only
    const spend = h.settle.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.058, 10) // 0.018 + 0.04 — never 0.04 + 0.04
  })

  it("seedFromRow(): an unseeded spend is seeded by it (true); a still-unreadable row answers false; a seeded spend answers true with no read", async () => {
    h.row = { output_data: null, provider_cost: 0.018, llm_billing: ledgerOf([STALE], 0.018) }
    h.failNext = 2
    const last = await workerLlmBilling(ctx, { attemptsMade: 2, opts: { attempts: 3 } })
    expect(await last.seedFromRow()).toBe(false)
    expect(await last.seedFromRow()).toBe(true)
    expect(last.spend.attempts).toHaveLength(1)
    h.failRead = true
    expect(await last.seedFromRow()).toBe(true) // already seeded: never re-seeded
    expect(last.spend.attempts).toHaveLength(1)
  })

  it("round 5 double fault: seedFromRow BEFORE any call floors like the start read (stale 0.018 beside provider_cost 0.05 → 0.05)", async () => {
    // An earlier attempt's last noteSpend read failed (stale attempts, higher
    // provider_cost); this attempt's start read fails too.
    h.row = { output_data: null, provider_cost: 0.05, llm_billing: ledgerOf([STALE], 0.018) }
    h.failNext = 1
    const last = await workerLlmBilling(ctx, { attemptsMade: 0, opts: { attempts: 1 } })
    expect(last.spend.attempts).toHaveLength(0)
    expect(await last.seedFromRow()).toBe(true)
    expect(last.spend.costUsd).toBeCloseTo(0.05, 10) // the recorded 0.018 + a stated 0.032
    expect(last.spend.attempts).toHaveLength(2)
    last.recorder.add(MODEL, request, { response: answer(0.03) })
    await last.settle()
    expect((h.settle.mock.calls[0]![3] as { costUsd: number }).costUsd).toBeCloseTo(0.08, 10)
  })

  it("round 5: seedFromRow AFTER this attempt billed never floors (its monotone write may be in provider_cost)", async () => {
    // Once this attempt billed, provider_cost can no longer be told apart from
    // its own monotone write, so the late seed carries the attempts only.
    h.row = { output_data: null, provider_cost: 0.1, llm_billing: ledgerOf([STALE], 0.018) }
    h.failNext = 2 // the start read and noteSpend's read
    const last = await workerLlmBilling(ctx, { attemptsMade: 0, opts: { attempts: 1 } })
    last.recorder.add(MODEL, request, { response: answer(0.04) })
    await last.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.1, 10) // the monotone write never lowers it
    expect(await last.seedFromRow()).toBe(true)
    expect(last.spend.attempts).toHaveLength(2)
    expect(last.spend.costUsd).toBeCloseTo(0.058, 10) // 0.04 + the carried 0.018 — no stated floor attempt
  })
})

