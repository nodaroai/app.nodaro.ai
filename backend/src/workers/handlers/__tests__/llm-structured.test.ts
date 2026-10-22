/**
 * The async structured-draft handler. Guarantees:
 *   - a story run drafts the caller's input verbatim and completes with the
 *     output + usage, then commits the reservation (the sync route's exact
 *     lifecycle);
 *   - a movie run waits for the child, mirrors its progress into the
 *     analysis band, writes stage "drafting", composes caller text + the
 *     COMPACT stripped analysis, and carries analysisJobId + analysisCredits
 *     on the finished row;
 *   - a failed / cancelled / unreadable child fails the parent with a reason;
 *   - a failed READ of the child is retried, never reported as absence;
 *   - a cancelled parent stops waiting;
 *   - a lost completion CAS never commits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  markJobCompleted: vi.fn(),
  setJobProgress: vi.fn(async () => {}),
  commitReservedCreditsForJob: vi.fn(async () => {}),
  markProviderCallStart: vi.fn(async () => {}),
  throwIfJobCancelled: vi.fn(async () => {}),
  prepareStructuredRequest: vi.fn(),
  runStructuredCompletion: vi.fn(),
  jobUpdate: vi.fn(),
  jobRead: vi.fn(),
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return { ...actual, markJobCompleted: mocks.markJobCompleted, setJobProgress: mocks.setJobProgress }
})
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: mocks.commitReservedCreditsForJob }))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("../../../lib/job-cancellation.js", () => ({ throwIfJobCancelled: mocks.throwIfJobCancelled }))
vi.mock("../../../lib/llm-structured-request.js", () => ({
  prepareStructuredRequest: mocks.prepareStructuredRequest,
  runStructuredCompletion: mocks.runStructuredCompletion,
}))
// The reservation's usage log (its `action` decides whether the job settles
// metered): undefined = a tier hold, today's path.
const reservation = vi.hoisted(() => ({
  action: undefined as string | undefined,
  /** The row's running billing ledger (an earlier BullMQ attempt's, R31) — the server-only `llm_billing` column (R32). */
  ledger: { calls: 3 } as Record<string, unknown> | undefined,
  /** Fail the next N reads of the job row (a transient blip; supabase returns an error). */
  failReads: 0,
  /** Apply the handler's ledger writes to the row (`ledger` = the `llm_billing` column; an `output_data` write never touches it). */
  stateful: false,
}))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => table === "usage_logs"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reservation.action ? { action: reservation.action } : null, error: null }) }) }) }
      : {
          // select("…").eq("id", x).single() → the child row; .maybeSingle() → the settled row's ledger
          select: () => ({ eq: () => ({
            single: async () => ({ data: mocks.jobRead(), error: null }),
            maybeSingle: async () => {
              if (reservation.failReads > 0) {
                reservation.failReads--
                return { data: null, error: { message: "read failed" } }
              }
              return { data: { provider_cost: null, llm_billing: reservation.ledger ?? null }, error: null }
            },
          }) }),
          // update({...}).eq("id", x) → the stage write (`.or(…)`: noteSpend's monotone cost write)
          update: (row: Record<string, unknown>) => {
            mocks.jobUpdate(row)
            const apply = () => {
              if (reservation.stateful && "llm_billing" in row) {
                reservation.ledger = row.llm_billing as Record<string, unknown> | undefined
              }
            }
            // R38: the pre-call marker's write is CONDITIONAL (only over an empty
            // ledger column or an earlier marker) and is applied when it resolves.
            const marker = (row.llm_billing as { preCall?: unknown } | null | undefined)?.preCall === true
            if (!marker) apply()
            const conditional = {
              in: () => conditional,
              or: () => conditional,
              eq: () => conditional,
              select: async () => {
                const empty = reservation.ledger == null || (reservation.ledger as { preCall?: unknown }).preCall === true
                if (marker && empty) apply()
                return { data: marker && empty ? [{ id: "parent-1" }] : [], error: null }
              },
            }
            return {
              eq: () => Object.assign(Promise.resolve({ data: null, error: null }), { or: async () => ({ error: null }), in: () => conditional }),
            }
          },
        }),
  },
}))
// The metered settle (lib/llm-billing.ts): observed, with the real spend ledger.
const settle = vi.hoisted(() => ({
  usageLog: vi.fn(async (..._args: unknown[]) => ({ outcome: "charged" as const, charged: 27, shortfall: 0 }) as { outcome: string; charged?: number; shortfall?: number }),
}))
vi.mock("../../../lib/llm-billing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/llm-billing.js")>()),
  settleLlmUsageLog: settle.usageLog,
}))
const refunds = vi.hoisted(() => ({ refundCredits: vi.fn(async () => {}), commitCredits: vi.fn(async () => {}), trySettleManagedCredits: vi.fn(async () => false) }))
vi.mock("../../../ee/services/credits.js", () => ({ CreditsService: refunds }))

import { composeAnalysisInput, handleLlmStructured, waitForAnalysis, ANALYSIS_WAIT_BUDGET_MS } from "../llm-structured.js"
import { stripDerivedAnalysisFields, videoAnalysisResultSchema } from "@nodaro/shared/video"

const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
const analysis = {
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Clip" },
  slots: [{ slotId: "hero", label: "Hero", source: "wired-character", role: "person", description: "tan man" }],
  // Keys in the SCHEMA's own shape order (windowSceneBase, then the
  // analyzedSceneSchema extension): the handler composes from the zod
  // PARSED analysis, which re-emits keys in shape order, and the movie-run
  // test compares the composed string byte-for-byte.
  scenes: [{ startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "push-in", visual: "{slot:hero} waves", audio: [], sceneNumber: 1, visualResolved: "Hero waves", slotRefs: ["hero"] }],
  warnings: ["one"],
}
const base = { jobId: "parent-1", usageLogId: "usage-1", system: "SYS", input: "Draft this.", jsonSchema: SCHEMA, maxRetries: 2 }
const job = (data: Record<string, unknown>) => ({ id: "bull-1", data, updateProgress: vi.fn() }) as never
const ctx = { jobId: "parent-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const prepared = { ok: true as const, model: { id: "m" }, schema: {}, modelIdentifier: "llm-structured:premium" }

beforeEach(() => {
  vi.clearAllMocks()
  reservation.action = undefined
  reservation.ledger = { calls: 3 }
  reservation.failReads = 0
  reservation.stateful = false
  mocks.prepareStructuredRequest.mockReturnValue(prepared)
  mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 10, outputTokens: 5, providerCost: 0.0021, lane: "kie" })
  mocks.markJobCompleted.mockResolvedValue(true)
})

describe("fixture", () => {
  it("is a real analysis result — every test below depends on it validating", () => {
    // On a vocabulary miss (source / shotType / angle enums) fix THIS fixture
    // against packages/shared/src/video-analysis.ts, never an assertion.
    expect(videoAnalysisResultSchema.safeParse(analysis).success).toBe(true)
  })
})

describe("composeAnalysisInput", () => {
  it("appends the COMPACT stripped analysis after a blank line", () => {
    const out = composeAnalysisInput("Draft this.", analysis as never)
    expect(out.startsWith("Draft this.\n\n{")).toBe(true)
    expect(out).toBe(`Draft this.\n\n${JSON.stringify(stripDerivedAnalysisFields(analysis))}`)
    expect(out).not.toContain("visualResolved")
    expect(out).not.toContain("warnings")
    expect(out).not.toContain("\n  ")
  })
})

describe("waitForAnalysis", () => {
  const row = (extra: Record<string, unknown>) => ({ status: "processing", progress: 0, output_data: null, error_message: null, user_id: "user-1", credits: null, ...extra })
  // An `Error` entry is a REJECTED read (a transient PostgREST failure), a
  // `null` entry a genuinely missing row — the two must not behave alike.
  const deps = (rows: Array<ReturnType<typeof row> | Error | null>) => {
    const queue = [...rows]
    let t = 0
    const readJob = async () => {
      const next = queue.shift() ?? null
      if (next instanceof Error) throw next
      return next
    }
    return {
      deps: { readJob, onProgress: vi.fn(async () => {}), sleep: async (ms: number) => { t += ms }, now: () => t },
      clock: () => t,
    }
  }
  it("mirrors progress into the analysis band and returns the validated json + credits when the child completes", async () => {
    const d = deps([row({ progress: 50 }), row({ status: "completed", progress: 100, output_data: { json: analysis }, credits: 60 })])
    const out = await waitForAnalysis("child-1", "user-1", d.deps)
    expect(out.credits).toBe(60)
    expect(out.analysis.scenes).toHaveLength(1)
    expect(d.deps.onProgress).toHaveBeenCalledWith(35) // 50% of the 0–70 band
    expect(mocks.throwIfJobCancelled).toHaveBeenCalled()
  })
  it("fails with the child's reason on failed / cancelled, on a foreign row, on an unreadable result, and on the budget", async () => {
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "failed", error_message: "Provider said no" })]).deps)).rejects.toThrow("Video analysis failed: Provider said no")
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "cancelled" })]).deps)).rejects.toThrow("Video analysis cancelled")
    await expect(waitForAnalysis("c", "user-1", deps([row({ user_id: "someone-else" })]).deps)).rejects.toThrow("not found")
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "completed", output_data: { json: { nope: true } } })]).deps)).rejects.toThrow("readable")
    const forever = deps(Array.from({ length: 400 }, () => row({})))
    await expect(waitForAnalysis("c", "user-1", forever.deps)).rejects.toThrow("did not finish")
    expect(forever.clock()).toBeGreaterThanOrEqual(ANALYSIS_WAIT_BUDGET_MS)
  })
  it("retries a failed READ and still returns the analysis when a later tick answers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const d = deps([new Error("fetch failed"), new Error("fetch failed"), row({ status: "completed", progress: 100, output_data: { json: analysis }, credits: 60 })])
    const out = await waitForAnalysis("child-1", "user-1", d.deps)
    expect(out.credits).toBe(60)
    expect(out.analysis.scenes).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[worker] analysis read failed for child-1"), expect.any(Error))
    warn.mockRestore()
  })
  it("a read that never succeeds ends on the BUDGET — never on 'not found' (which would refund a live child)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const forever = deps(Array.from({ length: 400 }, () => new Error("fetch failed")))
    await expect(waitForAnalysis("c", "user-1", forever.deps)).rejects.toThrow("did not finish")
    expect(forever.clock()).toBeGreaterThanOrEqual(ANALYSIS_WAIT_BUDGET_MS)
    warn.mockRestore()
  })
  it("stops when the PARENT is cancelled", async () => {
    mocks.throwIfJobCancelled.mockRejectedValueOnce(new Error("Job parent-1 was cancelled"))
    await expect(waitForAnalysis("c", "user-1", deps([row({})]).deps)).rejects.toThrow("cancelled")
  })
})

describe("handleLlmStructured", () => {
  it("story run: drafts the input verbatim, completes with output + usage, commits", async () => {
    await handleLlmStructured(job(base), ctx)
    expect(mocks.runStructuredCompletion).toHaveBeenCalledWith(expect.objectContaining({ system: "SYS" }), prepared, "Draft this.")
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ output_data: { stage: "drafting" } })
    // The lane and the cost ride the sync route's admin-only columns, never output_data.
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("parent-1", {
      output_data: { output: { title: "Rain" }, inputTokens: 10, outputTokens: 5 },
      provider: "kie",
      provider_cost: 0.0021,
    })
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
    expect(mocks.markProviderCallStart).not.toHaveBeenCalledWith("parent-1", "anthropic-sync")
  })
  it("movie run: waits for the child, composes, writes stage drafting with the child id, carries analysisJobId + analysisCredits", async () => {
    mocks.jobRead.mockReturnValue({ status: "completed", progress: 100, output_data: { json: analysis }, error_message: null, user_id: "user-1", credits: 60 })
    await handleLlmStructured(job({ ...base, analysisJobId: "child-1" }), ctx)
    const input = mocks.runStructuredCompletion.mock.calls[0][2] as string
    expect(input).toBe(composeAnalysisInput("Draft this.", analysis as never))
    // The stage write REPLACES output_data, so the child's price rides it too.
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ output_data: { stage: "drafting", analysisJobId: "child-1", analysisCredits: 60 } })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("parent-1", {
      output_data: { output: { title: "Rain" }, inputTokens: 10, outputTokens: 5, analysisJobId: "child-1", analysisCredits: 60 },
      provider: "kie",
      provider_cost: 0.0021,
    })
  })
  it("a REUSED analysis: waits (returns at once), composes, and reports NO analysis price — the run that made it paid", async () => {
    mocks.jobRead.mockReturnValue({ status: "completed", progress: 100, output_data: { json: analysis }, error_message: null, user_id: "user-1", credits: 60 })
    await handleLlmStructured(job({ ...base, analysisJobId: "child-1", analysisReused: true }), ctx)
    expect(mocks.runStructuredCompletion.mock.calls[0][2]).toBe(composeAnalysisInput("Draft this.", analysis as never))
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ output_data: { stage: "drafting", analysisJobId: "child-1" } })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("parent-1", {
      output_data: { output: { title: "Rain" }, inputTokens: 10, outputTokens: 5, analysisJobId: "child-1" },
      provider: "kie",
      provider_cost: 0.0021,
    })
  })
  it("a pre-flight refusal at run time fails the job with its message (no completion, no commit)", async () => {
    mocks.prepareStructuredRequest.mockReturnValue({ ok: false, status: 400, error: { code: "validation_error", message: "Unknown llmModel" } })
    await expect(handleLlmStructured(job(base), ctx)).rejects.toThrow("Unknown llmModel")
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
  // The worker funnel fails and refunds the row but records no provider cost;
  // a failure that carried usage writes its cost and lane before it propagates.
  it("a failure that carried usage records its provider cost and lane on the row, then propagates", async () => {
    const { StructuredLlmError } = await import("../../../lib/llm/structured.js")
    mocks.runStructuredCompletion.mockRejectedValue(
      new StructuredLlmError("llm-structured: validation failed after 3 attempt(s): x", { inputTokens: 40_000, outputTokens: 9_000, providerCost: 0.0871, complete: true }, { lane: "direct-anthropic" }),
    )
    await expect(handleLlmStructured(job(base), ctx)).rejects.toThrow("validation failed")
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ provider_cost: 0.0871, provider: "direct-anthropic" })
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a failure that reported no usage writes nothing extra and propagates", async () => {
    mocks.runStructuredCompletion.mockRejectedValue(new Error("boom"))
    await expect(handleLlmStructured(job(base), ctx)).rejects.toThrow("boom")
    expect(mocks.jobUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ provider_cost: expect.anything() }))
  })

  it("never commits when the completion CAS loses (cancelled mid-flight)", async () => {
    mocks.markJobCompleted.mockResolvedValue(false)
    await handleLlmStructured(job(base), ctx)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("a metered hold (A5: the worker settles what the draft cost)", () => {
  const ATTEMPTS = [
    { lane: "kie", modelId: "claude-opus-5.5", requestChars: 4000, inputTokens: 900, outputTokens: 400, creditsUsd: 0.02 },
    { lane: "kie", modelId: "claude-opus-5.5", requestChars: 5200, inputTokens: 1200, outputTokens: 380, creditsUsd: 0.025 },
  ]
  beforeEach(() => {
    reservation.action = "llm-structured:claude-opus-5.5"
    mocks.prepareStructuredRequest.mockReturnValue({ ...prepared, model: { id: "claude-opus-5.5" } })
  })

  it("settles every attempt (the validation re-ask included) under the reserved charge id BEFORE the completion; the ledger never rides output_data (R32)", async () => {
    mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 2100, outputTokens: 780, providerCost: 0.045, lane: "kie", attempts: ATTEMPTS })
    await handleLlmStructured(job(base), ctx)

    expect(settle.usageLog).toHaveBeenCalledTimes(1)
    const [log, jobId, chargeId, spend] = settle.usageLog.mock.calls[0]! as [string, string, string, { attempts: unknown[] }]
    expect([log, jobId, chargeId]).toEqual(["usage-1", "parent-1", "llm-structured:claude-opus-5.5"])
    expect(spend.attempts).toHaveLength(2)
    expect(settle.usageLog.mock.invocationCallOrder[0]).toBeLessThan(mocks.markJobCompleted.mock.invocationCallOrder[0]!)
    // The spend is on the row BEFORE the settle: a settle that throws before its ledger still leaves the job billed.
    const noted = mocks.jobUpdate.mock.calls.findIndex(([row]) => (row as { provider_cost?: number }).provider_cost === 0.045)
    expect(noted).toBeGreaterThanOrEqual(0)
    expect(mocks.jobUpdate.mock.invocationCallOrder[noted]).toBeLessThan(settle.usageLog.mock.invocationCallOrder[0]!)
    const fields = mocks.markJobCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown>; credits_actual?: number }
    // R32: the ledger is the settle's own write, in the server-only column — never on output_data.
    expect(fields.output_data).not.toHaveProperty("billing")
    // The running ledger noteSpend wrote before the settle: its own column, with its charge id.
    expect(mocks.jobUpdate.mock.calls[noted]![0]).toMatchObject({
      provider_cost: 0.045,
      llm_billing: { calls: 2, chargeId: "llm-structured:claude-opus-5.5" },
    })
    expect(mocks.jobUpdate.mock.calls.every(([row]) => !((row as { output_data?: object }).output_data && "billing" in (row as { output_data: object }).output_data))).toBe(true)
    // The receipt's charge rides the completion: a lost settle write never reports the hold.
    expect(fields.credits_actual).toBe(27)
    // The settle wrote the summed cost and the charge: no tier commit, no overwrite of provider_cost.
    expect("provider_cost" in fields).toBe(false)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("an unconfirmed settle leaves the row for the reconcile sweep (no completion)", async () => {
    settle.usageLog.mockResolvedValueOnce({ outcome: "unsettled" })
    mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 1, outputTokens: 1, providerCost: 0.01, lane: "kie", attempts: ATTEMPTS.slice(0, 1) })
    await handleLlmStructured(job(base), ctx)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a billed validation failure is CHARGED by the failure net — every attempt, never a refund", async () => {
    const { StructuredLlmError } = await import("../../../lib/llm/structured.js")
    const failure = new StructuredLlmError("validation failed after 2 attempts", {
      inputTokens: 2100, outputTokens: 780, complete: true, attempts: ATTEMPTS as never,
    })
    mocks.runStructuredCompletion.mockRejectedValue(failure)
    const err = await handleLlmStructured(job(base), ctx).catch((e: unknown) => e)
    expect(err).toBe(failure) // annotated, never wrapped

    const { llmSpendOf, refundJobCredits } = await import("../../shared.js")
    expect(llmSpendOf(err)?.attempts).toHaveLength(2)
    // The worker's final-attempt failure net.
    await refundJobCredits("usage-1", "parent-1", err, { chargeBilledRefusal: true })
    expect(settle.usageLog).toHaveBeenCalledTimes(1)
    expect(settle.usageLog.mock.calls[0]![2]).toBe("llm-structured:claude-opus-5.5")
    expect((settle.usageLog.mock.calls[0]![3] as { attempts: unknown[] }).attempts).toHaveLength(2)
    expect(refunds.refundCredits).not.toHaveBeenCalled()
    expect(refunds.commitCredits).not.toHaveBeenCalled()
  })

  it("a tier hold (the rollback) keeps today's path: completes, then commits the reserved tier", async () => {
    reservation.action = "llm-structured:premium"
    mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 10, outputTokens: 5, providerCost: 0.0021, lane: "kie", attempts: ATTEMPTS.slice(0, 1) })
    await handleLlmStructured(job(base), ctx)
    expect(settle.usageLog).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted.mock.calls[0]![1]).toMatchObject({ provider: "kie", provider_cost: 0.0021 })
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
  })
})

describe("R31 + I-2: an earlier attempt's billed calls survive a final attempt that fails BEFORE its call", () => {
  const CARRIED = { lane: "kie" as const, modelId: "claude-opus-5.5", requestChars: 4000, inputTokens: 900, outputTokens: 400, creditsUsd: 0.02 }
  beforeEach(() => {
    reservation.action = "llm-structured:claude-opus-5.5"
    reservation.ledger = { costUsd: 0.02, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [CARRIED] }
  })

  it("a pre-flight failure on attempt 2 carries attempt 1's spend: the failure net settles it instead of refunding", async () => {
    mocks.prepareStructuredRequest.mockReturnValue({ ok: false, error: { message: "schema rejected" } })
    const err = await handleLlmStructured(job(base), ctx).catch((e: unknown) => e)
    expect((err as Error).message).toBe("schema rejected")

    const { llmSpendOf, refundJobCredits } = await import("../../shared.js")
    expect(llmSpendOf(err)?.attempts).toHaveLength(1)
    await refundJobCredits("usage-1", "parent-1", err, { chargeBilledRefusal: true })
    expect(settle.usageLog).toHaveBeenCalledTimes(1)
    expect((settle.usageLog.mock.calls[0]![3] as { attempts: unknown[] }).attempts).toHaveLength(1)
    expect(refunds.refundCredits).not.toHaveBeenCalled()
  })

  it("an analysis-wait failure on attempt 2 carries it too", async () => {
    mocks.prepareStructuredRequest.mockReturnValue({ ...prepared, model: { id: "claude-opus-5.5" } })
    mocks.jobRead.mockReturnValue({ status: "failed", progress: 0, output_data: null, error_message: "boom", user_id: "user-1", credits: 1 })
    const err = await handleLlmStructured(job({ ...base, analysisJobId: "child-1" }), ctx).catch((e: unknown) => e)
    const { llmSpendOf } = await import("../../shared.js")
    expect(llmSpendOf(err)?.attempts).toHaveLength(1)
  })

  it("the stage write on a retry (it replaces output_data) never touches the running ledger, which lives in its own column", async () => {
    reservation.stateful = true
    mocks.prepareStructuredRequest.mockReturnValue({ ...prepared, model: { id: "claude-opus-5.5" } })
    mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 1, outputTokens: 1, providerCost: 0.01, lane: "kie", attempts: [CARRIED] })
    await handleLlmStructured(job(base), ctx)
    const stage = mocks.jobUpdate.mock.calls.map(([row]) => row as Record<string, unknown>).find((r) => (r.output_data as { stage?: string } | undefined)?.stage === "drafting")
    expect(stage).toEqual({ output_data: { stage: "drafting" } })
    // noteSpend then wrote the carried attempt beside this one's, in the ledger column.
    expect(reservation.ledger).toMatchObject({ calls: 2, attempts: [expect.objectContaining({ creditsUsd: 0.02 }), expect.objectContaining({ creditsUsd: 0.02 })] })
    expect((settle.usageLog.mock.calls[0]![3] as { costUsd: number }).costUsd).toBeCloseTo(0.04, 10)
  })

  it("a metered failure never overwrites the cumulative provider_cost with the last attempt's figure", async () => {
    mocks.prepareStructuredRequest.mockReturnValue({ ...prepared, model: { id: "claude-opus-5.5" } })
    const { StructuredLlmError } = await import("../../../lib/llm/structured.js")
    mocks.runStructuredCompletion.mockRejectedValue(new StructuredLlmError("validation failed", {
      inputTokens: 900, outputTokens: 400, providerCost: 0.03, complete: true, attempts: [CARRIED],
    }, { lane: "kie" }))
    await handleLlmStructured(job(base), ctx).catch(() => {})
    const costWrites = mocks.jobUpdate.mock.calls.map(([row]) => (row as { provider_cost?: unknown }).provider_cost).filter((v) => v !== undefined)
    // Only noteSpend's cumulative figure (attempt 1 + attempt 2 = 0.04), never the last attempt's 0.03 alone.
    expect(costWrites.every((v) => typeof v === "number" && Math.abs((v as number) - 0.04) < 1e-9)).toBe(true)
  })
})

describe("D13 round 4: a stall-restarted final attempt whose start read failed never wipes the earlier ledger", () => {
  const CARRIED = { lane: "kie" as const, modelId: "claude-opus-5.5", requestChars: 4000, inputTokens: 900, outputTokens: 400, creditsUsd: 0.02 }
  const THIS = { ...CARRIED, creditsUsd: 0.01 }
  // BullMQ does not bump attemptsMade on a stall-restart: the rerun is "attempt 0 of 1" — final.
  const stalled = (data: Record<string, unknown>) => ({ id: "bull-1", data, updateProgress: vi.fn(), attemptsMade: 0, opts: { attempts: 1 } }) as never
  const stageWrites = () => mocks.jobUpdate.mock.calls.map(([row]) => row as { output_data?: Record<string, unknown> }).filter((r) => r.output_data?.stage === "drafting")
  beforeEach(() => {
    reservation.action = "llm-structured:claude-opus-5.5"
    reservation.ledger = { costUsd: 0.02, source: "kie-stated", calls: 1, lanes: ["kie"], attempts: [CARRIED] }
    reservation.stateful = true
    mocks.prepareStructuredRequest.mockReturnValue({ ...prepared, model: { id: "claude-opus-5.5" } })
    mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 1, outputTokens: 1, providerCost: 0.01, lane: "kie", attempts: [THIS] })
  })

  it("the start read fails, the seeding read succeeds: the earlier attempt is seeded before the call; the stage write leaves the ledger alone; the settle charges both", async () => {
    reservation.failReads = 1
    await handleLlmStructured(stalled(base), ctx)
    const [stage] = stageWrites()
    expect(stage).toEqual({ output_data: { stage: "drafting" } })
    expect(reservation.ledger).toMatchObject({ calls: 2 })
    const spend = settle.usageLog.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2) // seeded once — never counted twice
    expect(spend.costUsd).toBeCloseTo(0.03, 10)
  })

  it("the seeding read fails too: the stage write still happens (it cannot wipe the ledger column); the next read seeds it; the settle charges both", async () => {
    reservation.failReads = 2
    await handleLlmStructured(stalled({ ...base, analysisJobId: undefined }), ctx)
    expect(stageWrites()).toEqual([{ output_data: { stage: "drafting" } }])
    const spend = settle.usageLog.mock.calls[0]![3] as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.03, 10)
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
  })

  it("a tier hold (the rollback) writes its stage as before, with no extra read", async () => {
    reservation.action = "llm-structured:premium"
    reservation.failReads = 1 // would fail a seeding read — none happens
    await handleLlmStructured(stalled(base), ctx)
    expect(stageWrites()).toEqual([{ output_data: { stage: "drafting" } }])
    expect(reservation.failReads).toBe(1)
  })
})
