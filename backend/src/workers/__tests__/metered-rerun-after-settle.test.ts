// @test-units-by-name names no node type: it settles usage logs through CreditsService (mocked)
/**
 * A metered worker job RE-RUN after its settle was confirmed (D10): a stall
 * re-pick of a process that died after `commit_credits_metered` returned but
 * before `markJobCompleted`. An LLM job has no provider task to resume, so the
 * stall guard re-runs the handler, and `attemptsMade` is not bumped (a
 * single-attempt job re-runs as its "final" attempt). Its usage log is
 * already `committed`, so the re-run's commit is refused ("Usage log not
 * found").
 *
 * That job IS charged: the re-run completes (credits_actual = the committed
 * charge), never `unsettled` (the sweep reads only reserved logs, would
 * answer not-metered and FAIL a job the user paid for), and its own vendor
 * spend — uncollectable on a committed log — is an `uncollected_overrun`
 * anomaly. A re-run that FAILS files no false "hold unsettled" report.
 *
 * Drives the REAL workerLlmBilling → settleLlmUsageLog → settle impl chain
 * against an in-memory jobs row and usage log (the commit RPC's CAS on
 * `status = 'reserved'` simulated in CreditsService.commitCredits).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  job: { output_data: null as Record<string, unknown> | null, provider_cost: null as number | null, credits_actual: null as number | null },
  log: {
    action: "llm-structured:claude-sonnet-5.5",
    status: "reserved",
    credits_used: 12,
    credits_charged: null as number | null,
    user_id: "user-1",
    metadata: {} as Record<string, unknown>,
  },
  anomalies: [] as Array<Record<string, unknown>>,
  report: vi.fn(async (..._a: unknown[]) => true),
  serviceRefund: vi.fn(async () => {}),
}))

vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ ai_provider: "kie", cost_markup_percent: 0 })),
}))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: h.report }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "usage_logs") return { data: { ...h.log }, error: null }
            return { data: { output_data: h.job.output_data, provider_cost: h.job.provider_cost }, error: null }
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          then: (resolve: (v: { error: null }) => void) => {
            if (table === "jobs") Object.assign(h.job, patch)
            resolve({ error: null })
          },
          or: async () => {
            const cost = patch.provider_cost as number
            if (h.job.provider_cost === null || h.job.provider_cost < cost) Object.assign(h.job, patch)
            return { error: null }
          },
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        if (table === "credit_anomalies") h.anomalies.push(values)
        return { error: null }
      },
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}))
// The metered commit: `commit_credits_metered` locks only a RESERVED log; any
// other status raises "Usage log not found", which the wrapper answers undefined.
vi.mock("../../ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ee/billing/credits.js")>()),
  CreditsService: {
    commitCredits: vi.fn(async (_id: string, actual: number) => {
      if (h.log.status !== "reserved") return undefined
      h.log.status = "committed"
      h.log.credits_charged = actual
      return { charged: actual, collectedOverHold: Math.max(0, actual - h.log.credits_used), shortfall: 0 }
    }),
    refundCredits: vi.fn(async () => {
      if (h.log.status === "reserved") h.log.status = "refunded"
    }),
  },
}))
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: { refundCredits: h.serviceRefund, commitCredits: vi.fn(), trySettleManagedCredits: vi.fn(async () => false) },
}))

import { attachLlmSpend, refundJobCredits, workerLlmBilling } from "../shared.js"
import type { LlmRequest, LlmResponse } from "../../lib/llm/types.js"

const ctx = { jobId: "job-1", usageLogId: "usage-1" }
/** llm-structured runs `attempts: 1`; a stall re-pick re-runs it as the same (final) attempt. */
const only = { attemptsMade: 0, opts: { attempts: 1 } }
const MODEL = "claude-sonnet-5.5"
const request: LlmRequest = { modelId: MODEL, system: "S", messages: [{ role: "user", content: "draft" }] }
const answer = (creditsUsd: number): LlmResponse =>
  ({ text: "…", usage: { inputTokens: 900, outputTokens: 700 }, creditsUsd, lane: "kie" }) as LlmResponse

/** Run 1: bills X = 0.02 USD (10 credits at 0% markup), settles — then the process dies before markJobCompleted. */
async function firstRunSettlesThenDies(): Promise<void> {
  const run1 = await workerLlmBilling(ctx, only)
  run1.recorder.add(MODEL, request, { response: answer(0.02) })
  await run1.noteSpend()
  expect(await run1.settle()).toMatchObject({ metered: true, outcome: "charged", charged: 10 })
  expect(h.log).toMatchObject({ status: "committed", credits_charged: 10 })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  h.job = { output_data: null, provider_cost: null, credits_actual: null }
  h.log = { action: "llm-structured:claude-sonnet-5.5", status: "reserved", credits_used: 12, credits_charged: null, user_id: "user-1", metadata: {} }
  h.anomalies = []
})

describe("a metered worker job re-run after a CONFIRMED settle", () => {
  it("success: the re-run is charged at the committed figure (credits_actual 10), never unsettled; its own spend Y is an uncollected_overrun anomaly", async () => {
    await firstRunSettlesThenDies()

    // Run 2 — the stall re-pick. The start carry floors the earlier 0.02 (the settle wrote provider_cost, no attempts).
    const run2 = await workerLlmBilling(ctx, only)
    expect(run2.metered).toBe(true)
    expect(run2.spend.costUsd).toBeCloseTo(0.02, 10)
    run2.recorder.add(MODEL, request, { response: answer(0.01) }) // Y = 0.01 USD = 5 credits
    await run2.noteSpend()
    const settled = await run2.settle()

    // Charged → the handler completes the job with the re-run's output.
    expect(settled).toMatchObject({ metered: true, outcome: "charged", charged: 10 })
    expect(h.job.credits_actual).toBe(10)
    expect(h.job.provider_cost).toBeCloseTo(0.03, 10) // the real vendor spend, both runs
    expect(h.log).toMatchObject({ status: "committed", credits_charged: 10 }) // never re-settled or refunded
    expect(h.anomalies).toHaveLength(1)
    expect(h.anomalies[0]).toMatchObject({
      job_id: "job-1",
      usage_log_id: "usage-1",
      user_id: "user-1",
      model_identifier: "llm-structured:claude-sonnet-5.5",
      credits_actual: 15,
      diff: 5,
      anomaly_type: "uncollected_overrun",
    })
    expect(h.report).not.toHaveBeenCalled()
  })

  it("final-attempt failure: the net treats the committed hold as settled — no false 'metered-hold-unsettled-on-failure' report, no refund", async () => {
    await firstRunSettlesThenDies()

    const run2 = await workerLlmBilling(ctx, only)
    run2.recorder.add(MODEL, request, { response: answer(0.01) })
    await run2.noteSpend()
    // The answer would not parse: the handler rethrows with its spend attached.
    await refundJobCredits("usage-1", "job-1", attachLlmSpend(new Error("Failed to parse"), run2.spend))

    expect(h.report).not.toHaveBeenCalled()
    expect(h.serviceRefund).not.toHaveBeenCalled()
    expect(h.log).toMatchObject({ status: "committed", credits_charged: 10 })
    expect(h.anomalies).toHaveLength(1)
    expect(h.anomalies[0]).toMatchObject({ diff: 5, anomaly_type: "uncollected_overrun" })
  })

  it("a log still reserved whose commit RPC fails stays unsettled (the sweep's), with no anomaly", async () => {
    const { CreditsService } = await import("../../ee/billing/credits.js")
    vi.mocked(CreditsService.commitCredits).mockResolvedValueOnce(undefined)
    const run = await workerLlmBilling(ctx, only)
    run.recorder.add(MODEL, request, { response: answer(0.02) })
    expect(await run.settle()).toEqual({ metered: true, outcome: "unsettled" })
    expect(h.job.credits_actual).toBeNull()
    expect(h.anomalies).toHaveLength(0)
  })
})
