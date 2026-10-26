/**
 * Worker- and DAG-queued metered LLM jobs (A5, metered LLM pricing Task 11).
 *
 * A workflow run reserves a worker-queued LLM node (Generate Script, the lottie
 * Motion Graphics engine) itself — not through a route — so the orchestrator
 * must reserve the SAME metered hold the route would (`computeLlmMeteredHold`,
 * the one hold formula `llmHoldForCalls`), under `<feature>:<model>`, never a
 * tier row. And what a metered node reports into the execution total — and so
 * into an app creator's percentage — is what it was CHARGED (`credits_actual`,
 * from the settle's receipt), never the hold.
 *
 * The worker settles (the handlers' own tests), the failure net
 * (`llm-structured.test.ts`), the Scene3D planner's summed spend
 * (`scene3d-authoring.test.ts`) and the creator fee on the actual
 * (`workers/__tests__/app-run-metered-creator-fee.test.ts`) are covered where
 * their modules are.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const h = vi.hoisted(() => ({
  rollback: false,
  jobRow: null as Record<string, unknown> | null,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deletes: [] as string[],
  checkCredits: vi.fn(),
  reserveCredits: vi.fn(),
  queueAdd: vi.fn(async () => {}),
  refundJobCredits: vi.fn(async () => {}),
  meteredCancelVerdict: vi.fn(async () => "not-metered" as "not-metered" | "not-started" | "settled" | "retry"),
  /** R38 / N1: the post-flip settle of a not-started verdict — kept (the call started meanwhile), settled (at the actual), or refund. */
  keptAfterFlip: vi.fn(async (_id: string) => "refund" as "kept" | "settled" | "refund"),
  loopbackFetch: vi.fn(),
  /** usage_logs rows the run loader reads (a node's steps' settled charges). */
  usageLogs: [] as Array<Record<string, unknown>>,
}))

vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40), EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  llmMeteredPricing: () => !h.rollback,
}))

/** A chainable supabase stub: every filter returns the chain; awaiting it (or single/maybeSingle) answers by table + op. */
vi.mock("../../../lib/supabase.js", () => {
  function chain(table: string, op: string, row?: Record<string, unknown>) {
    const resolve = () => {
      if (op === "insert") return { data: { id: "job-1" }, error: null }
      if (op === "select" && table === "jobs") return { data: h.jobRow, error: null }
      if (op === "select" && table === "usage_logs") return { data: h.usageLogs, error: null }
      if (op === "update" && table === "jobs" && row?.status === "cancelled") {
        return { data: [{ id: "job-1", user_id: "user-1", provider_task_id: null, provider_kind: null, credits: 368 }], error: null }
      }
      return { data: null, error: null }
    }
    const self: Record<string, unknown> = {}
    for (const m of ["eq", "in", "not", "is", "neq", "or", "order", "limit", "select", "gte", "lte"]) self[m] = () => self
    self.single = async () => resolve()
    self.maybeSingle = async () => resolve()
    self.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko)
    return self
  }
  return {
    supabase: {
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => chain(table, "insert", row),
        update: (row: Record<string, unknown>) => {
          h.updates.push({ table, row })
          return chain(table, "update", row)
        },
        delete: () => {
          h.deletes.push(table)
          return chain(table, "delete")
        },
        select: () => chain(table, "select"),
      }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 10 })) }))
vi.mock("../../../ee/billing/credits.js", () => ({ CreditsService: { checkCredits: h.checkCredits, reserveCredits: h.reserveCredits } }))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, tryRemoveFromQueue: vi.fn() }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: h.queueAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: h.refundJobCredits }))
vi.mock("../../../lib/cancel-job.js", () => ({ settleMeteredHoldsBeforeCancel: h.meteredCancelVerdict, settleMeteredHoldAfterFlip: h.keptAfterFlip }))
// R53: a run step's charge adds its settled metered side holds (none unless a test says so).
const stepSide = vi.hoisted(() => ({ map: new Map<string, number>() }))
vi.mock("../../../lib/job-step-charge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/job-step-charge.js")>()),
  sideHoldChargesFor: async () => stepSide.map,
}))
// A node's job's steps (child jobs, lib/job-run-steps.ts) — none unless a test says so.
type StepRow = { id: string; parent_job_id: string; usage_log_id: string | null; credits: number | null }
const runSteps = vi.hoisted(() => ({ map: new Map<string, StepRow[]>(), owners: [] as string[] }))
vi.mock("../../../lib/job-run-steps.js", () => ({
  runStepsOf: async (jobs: Array<{ id: string; owner: string }>) => {
    runSteps.owners.push(...jobs.map((j) => j.owner))
    return { steps: runSteps.map, incomplete: new Set<string>() }
  },
}))
// 554: a cancelled job's metered SIDE holds settle on their own markers after the flip.
const sideHolds = vi.hoisted(() => ({ settle: vi.fn(async (_ids: readonly string[]) => {}) }))
vi.mock("../../../lib/llm-side-hold.js", () => ({ settleSideHoldsAfterFlip: sideHolds.settle }))
vi.mock("../../../lib/availability-viewer.js", () => ({
  assertNodeAvailableForUser: async () => {},
  viewerForNode: async () => ({ admin: false }),
}))
vi.mock("../loopback-fetch.js", () => ({ loopbackFetch: h.loopbackFetch }))
vi.mock("../execution-cancel-check.js", () => ({ executionCancelledNow: async () => false }))

import { computeLlmMeteredHold, executeNode } from "../node-executor.js"
import { buildScriptRequest } from "../../../providers/script/script-generator.js"
import { buildLottieRequest } from "../../../lib/lottie-request.js"
import { llmHoldForCalls } from "../../../ee/billing/llm-billing-impl.js"

const SCRIPT_MODEL = "claude-opus-4.7"

function ctx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    billingContext: { payer: "user", userId: "user-1" },
    cancelled: false,
    ...overrides,
  }
}

const scriptNode = (data: Record<string, unknown> = {}): SimpleNode =>
  ({ id: "script", type: "generate-script", data: { llmModel: SCRIPT_MODEL, sceneCount: 4, tone: "tense", ...data } }) as SimpleNode

/** The hold a route reserves for the same request — the parity target. */
async function routeHold(feature: "generate-script" | "motion-graphics-lottie", request: ReturnType<typeof buildScriptRequest>) {
  return llmHoldForCalls(feature, [{ modelId: request.modelId, request }])
}

const COMPLETED_SCRIPT = (extra: Record<string, unknown> = {}) => ({
  status: "completed",
  output_data: { script: { title: "Heist", scenes: [{ sceneNumber: 1 }] }, ...extra },
  error_message: null,
  progress: 100,
  credits_actual: 27,
  credits: 368,
  error_hint: null,
  input_data: {},
})

beforeEach(() => {
  vi.clearAllMocks()
  h.rollback = false
  h.updates.length = 0
  h.deletes.length = 0
  // The settle's ledger lives in the server-only `llm_billing` column (R32), never output_data.
  h.jobRow = { ...COMPLETED_SCRIPT(), llm_billing: { costUsd: 0.048, source: "kie-stated", calls: 1, lanes: ["kie"], chargeId: `generate-script:${SCRIPT_MODEL}` } }
  h.checkCredits.mockResolvedValue({ allowed: true, balance: 10_000 })
  h.reserveCredits.mockImplementation(async (_u: string, _j: string, _id: string, _p: number, _d: number, opts: { creditOverride?: number }) => ({
    usageLogId: "usage-1",
    creditsReserved: opts.creditOverride ?? 3,
    watermark: false,
  }))
  h.meteredCancelVerdict.mockResolvedValue("not-metered")
})

describe("DAG reservation of a worker-queued metered LLM node", () => {
  it("generate-script DAG node reserves under generate-script:<model> at the metered hold, never a tier row", async () => {
    await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx())

    const request = buildScriptRequest({ prompt: "a bank heist", sceneCount: 4, tone: "tense", llmModel: SCRIPT_MODEL, advanced: {}, brief: {}, lanes: { cheapLanesOnly: false } })
    const { chargeId, holdCredits } = await routeHold("generate-script", request)
    expect(chargeId).toBe(`generate-script:${SCRIPT_MODEL}`)
    expect(holdCredits).toBeGreaterThan(1)

    // The preflight and the reservation both name the metered id with the hold as their override.
    expect(h.checkCredits).toHaveBeenCalledWith("user-1", chargeId, undefined, holdCredits, expect.anything())
    expect(h.reserveCredits).toHaveBeenCalledTimes(1)
    const [, , reserveId, , , opts] = h.reserveCredits.mock.calls[0]!
    expect(reserveId).toBe(chargeId)
    expect(opts).toMatchObject({ creditOverride: holdCredits })
    expect(String(reserveId)).not.toMatch(/:(economy|standard|premium|premium-direct)$/)
  })

  it("the DAG hold equals the route's hold for the same settings (one formula)", async () => {
    const payload = { prompt: "a bank heist", sceneCount: 4, tone: "tense", llmModel: SCRIPT_MODEL, styleGuide: "noir" }
    const dag = await computeLlmMeteredHold("generate-script", payload)
    const request = buildScriptRequest({ prompt: "a bank heist", sceneCount: 4, tone: "tense", llmModel: SCRIPT_MODEL, brief: { styleGuide: "noir" }, advanced: {}, lanes: {} })
    expect(dag).toEqual(await routeHold("generate-script", request))
  })

  it("lottie: the hold covers the FIRST attempt only — the repair re-ask is collected at settle", async () => {
    const payload = { prompt: "a bouncing logo", fps: 30, width: 1920, height: 1080, durationInFrames: 150, backgroundColor: "#00000000", llmModel: "claude-sonnet-5.5" }
    const dag = await computeLlmMeteredHold("motion-graphics-lottie", payload)
    const first = buildLottieRequest(payload)
    expect(dag).toEqual(await llmHoldForCalls("motion-graphics-lottie", [{ modelId: first.modelId, request: first }]))
    // A repair turn (first answer + feedback) would be a bigger request: it is not in the hold.
    const repair = buildLottieRequest(payload, [
      { role: "user", content: "x" }, { role: "assistant", content: "y".repeat(20_000) }, { role: "user", content: "fix it" },
    ])
    const twoAttempts = await llmHoldForCalls("motion-graphics-lottie", [
      { modelId: first.modelId, request: first }, { modelId: repair.modelId, request: repair },
    ])
    expect(dag!.holdCredits).toBeLessThan(twoAttempts.holdCredits)
  })

  it("every other job is not a metered LLM job (undefined → the payload's own id reserves)", async () => {
    expect(await computeLlmMeteredHold("generate-image", { prompt: "x" })).toBeUndefined()
  })

  it("mid-run 402 surfaces 'Needs up to N credits' on the node (B15) — and no row is left", async () => {
    const hold = (await computeLlmMeteredHold("generate-script", { prompt: "a bank heist", sceneCount: 4, tone: "tense", llmModel: SCRIPT_MODEL }))!
    h.checkCredits.mockResolvedValue({ allowed: false, balance: 12, required: hold.holdCredits, error: `Insufficient credits. Required: ${hold.holdCredits}, Available: 12` })

    const err = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(`Needs up to ${hold.holdCredits} credits`)
    expect((err as Error & { errorCode?: string }).errorCode).toBe("insufficient_credits")
    expect(h.reserveCredits).not.toHaveBeenCalled()
    expect(h.deletes).toContain("jobs")
  })

  it("a balance that moved between the preflight and the reserve says the same", async () => {
    h.reserveCredits.mockRejectedValueOnce(new Error("Insufficient credits"))
    const err = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx()).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/Needs up to \d+ credits/)
    expect((err as Error & { errorCode?: string }).errorCode).toBe("insufficient_credits")
  })

  it("a model with no price is refused before any reservation, with the shared sentence", async () => {
    const node = scriptNode({ llmModel: "no-such-model-9" })
    const err = await executeNode(node, { prompt: "a bank heist" }, [], [node], {}, ctx()).catch((e: unknown) => e)
    expect((err as Error).message).toContain(`The model "no-such-model-9" has no price yet`)
    expect((err as Error & { errorCode?: string }).errorCode).toBe("llm_model_unpriced")
    expect(h.checkCredits).not.toHaveBeenCalled()
    expect(h.reserveCredits).not.toHaveBeenCalled()
  })

  it("rollback: DAG reserves the tier id and commits the whole hold as before", async () => {
    h.rollback = true
    h.jobRow = COMPLETED_SCRIPT() // a tier job: no billing ledger
    const result = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx())

    expect(await computeLlmMeteredHold("generate-script", { prompt: "a bank heist", llmModel: SCRIPT_MODEL })).toBeUndefined()
    const [, , reserveId, , , opts] = h.reserveCredits.mock.calls[0]!
    expect(reserveId).toBe("generate-script:premium")
    expect((opts as { creditOverride?: number }).creditOverride).toBeUndefined()
    expect(h.checkCredits).toHaveBeenCalledWith("user-1", "generate-script:premium", undefined, undefined, expect.anything())
    // A tier job reports its reservation, as it always has.
    expect(result.creditsUsed).toBe(3)
  })
})

describe("what a metered node reports into the execution total (A5)", () => {
  it("generate-script node in an app run: reports the actual 27, not the 368 hold", async () => {
    h.reserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 368, watermark: false })
    const result = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx({ isAppRun: true }))
    expect(result.creditsUsed).toBe(27)
  })

  it("a column value that is not a ledger: the hold is reported (the pre-metered figure), never a guess", async () => {
    h.jobRow = { ...COMPLETED_SCRIPT(), llm_billing: "not-a-ledger" }
    h.reserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 368, watermark: false })
    const result = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx({ isAppRun: true }))
    expect(result.creditsUsed).toBe(368)
  })

  it("without a metered ledger (a tier job) the reservation is reported, byte-identical to before", async () => {
    h.rollback = true
    h.jobRow = COMPLETED_SCRIPT()
    h.reserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 368, watermark: false })
    const result = await executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, ctx({ isAppRun: true }))
    expect(result.creditsUsed).toBe(368)
  })

  it("sync llm-chat node in an app run now counts toward totalCredits (its settle writes credits_actual)", async () => {
    h.loopbackFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ jobId: "chat-job" }),
      text: async () => JSON.stringify({ jobId: "chat-job" }),
    })
    h.jobRow = {
      status: "completed", output_data: { text: "hello" }, llm_billing: { costUsd: 0.004, source: "provider-usage", calls: 1, lanes: ["kie"], chargeId: "llm-chat:claude-fable-5" },
      error_message: null, progress: 100, credits_actual: 6, credits: 368, error_hint: null, input_data: {},
    }
    const node = { id: "chat", type: "llm-chat", data: { prompt: "say hello", llmModel: "claude-fable-5" } } as SimpleNode
    const result = await executeNode(node, {}, [], [node], {}, ctx({ isAppRun: true }))
    expect(result.creditsUsed).toBe(6)
  })

  it("R53: a step's charge includes its settled side holds — the run total and the creator fee base see the readings, as when they were inside the job's charge", async () => {
    h.loopbackFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ jobId: "chat-job" }),
      text: async () => JSON.stringify({ jobId: "chat-job" }),
    })
    h.jobRow = { status: "completed", output_data: { text: "hello" }, error_message: null, progress: 100, credits_actual: 6, credits: 368, error_hint: null, input_data: {} }
    stepSide.map = new Map([["chat-job", 4]])
    try {
      const node = { id: "chat", type: "llm-chat", data: { prompt: "say hello", llmModel: "claude-fable-5" } } as SimpleNode
      const result = await executeNode(node, {}, [], [node], {}, ctx({ isAppRun: true }))
      expect(result.creditsUsed).toBe(10)
      // …and a UGC step's child charge (jobCharge) the same way.
      const { ugcDepsFor } = await import("../node-executor.js")
      expect(await ugcDepsFor(node, ctx()).jobCharge("chat-job")).toBe(10)
    } finally {
      stepSide.map = new Map()
    }
  })

  it("a node whose job ran steps (child jobs) counts each settled step — the run total and the creator fee base follow it", async () => {
    h.loopbackFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ jobId: "chat-job" }),
      text: async () => JSON.stringify({ jobId: "chat-job" }),
    })
    h.jobRow = { status: "completed", output_data: { text: "hello" }, error_message: null, progress: 100, credits_actual: 6, credits: 368, error_hint: null, input_data: {} }
    runSteps.map = new Map([["chat-job", [
      { id: "step-1", parent_job_id: "chat-job", usage_log_id: "ul-step-1", credits: 66 },
      { id: "step-2", parent_job_id: "chat-job", usage_log_id: "ul-step-2", credits: 3564 },
      { id: "step-3", parent_job_id: "chat-job", usage_log_id: "ul-step-3", credits: 40 },
    ]]])
    h.usageLogs = [
      { id: "ul-step-1", status: "committed", credits_used: 66, credits_charged: 66 },
      { id: "ul-step-2", status: "committed", credits_used: 3564, credits_charged: 854 },
      // A step still held adds nothing until it settles.
      { id: "ul-step-3", status: "reserved", credits_used: 40, credits_charged: null },
    ]
    runSteps.owners = []
    try {
      const node = { id: "chat", type: "llm-chat", data: { prompt: "say hello", llmModel: "claude-fable-5" } } as SimpleNode
      const result = await executeNode(node, {}, [], [node], {}, ctx({ isAppRun: true }))
      expect(result.creditsUsed).toBe(6 + 66 + 854)
      // The steps are read as the run's user's.
      expect(runSteps.owners).toEqual(["user-1"])
      const { ugcDepsFor } = await import("../node-executor.js")
      expect(await ugcDepsFor(node, ctx()).jobCharge("chat-job")).toBe(6 + 66 + 854)
    } finally {
      runSteps.map = new Map()
      h.usageLogs = []
    }
  })

  it("a node whose job ran no steps reports exactly what it did before", async () => {
    h.loopbackFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ jobId: "chat-job" }),
      text: async () => JSON.stringify({ jobId: "chat-job" }),
    })
    h.jobRow = { status: "completed", output_data: { text: "hello" }, error_message: null, progress: 100, credits_actual: 6, credits: 368, error_hint: null, input_data: {} }
    const node = { id: "chat", type: "llm-chat", data: { prompt: "say hello", llmModel: "claude-fable-5" } } as SimpleNode
    const result = await executeNode(node, {}, [], [node], {}, ctx({ isAppRun: true }))
    expect(result.creditsUsed).toBe(6)
  })
})

describe("a cancel of a metered job never refunds a billed call (D10)", () => {
  it("a billed metered hold the sweep could not commit yet: the job is left to it — not cancelled, not refunded", async () => {
    h.meteredCancelVerdict.mockResolvedValue("retry")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    expect(h.meteredCancelVerdict).toHaveBeenCalledWith("job-1")
    expect(h.updates.some((u) => u.row.status === "cancelled")).toBe(false)
    expect(h.refundJobCredits).not.toHaveBeenCalled()
  })

  it("R38: pre-call before the flip, but the worker's call started before it landed → cancelled, its hold kept (never refunded)", async () => {
    h.meteredCancelVerdict.mockResolvedValue("not-started")
    h.keptAfterFlip.mockResolvedValueOnce("kept")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    expect(h.updates.some((u) => u.row.status === "cancelled")).toBe(true)
    expect(h.keptAfterFlip).toHaveBeenCalledWith("job-1")
    expect(h.refundJobCredits).not.toHaveBeenCalled()
  })

  it("N1: nothing in flight but an earlier attempt billed → settled at the actual AFTER the flip; only what is still reserved is refunded (never a second metered settle)", async () => {
    h.meteredCancelVerdict.mockResolvedValue("not-started")
    h.keptAfterFlip.mockResolvedValueOnce("settled")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    const flip = h.updates.findIndex((u) => u.row.status === "cancelled")
    expect(flip).toBeGreaterThanOrEqual(0)
    expect(h.keptAfterFlip).toHaveBeenCalledWith("job-1")
    expect(h.refundJobCredits).not.toHaveBeenCalled()
  })

  it("554: a cancel settles the job's side holds AFTER its flip, whatever its own hold's verdict — never on a cancel that left the job live", async () => {
    h.meteredCancelVerdict.mockResolvedValue("not-started")
    h.keptAfterFlip.mockResolvedValueOnce("kept")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    expect(sideHolds.settle).toHaveBeenCalledWith(["job-1"])
    sideHolds.settle.mockClear()
    h.meteredCancelVerdict.mockResolvedValue("retry")
    const live = ctx()
    live.onJobCreated = () => { live.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, live)).rejects.toThrow("Execution cancelled")
    expect(sideHolds.settle).not.toHaveBeenCalled()
  })

  it("R38: still pre-call after the flip → refunded at once", async () => {
    h.meteredCancelVerdict.mockResolvedValue("not-started")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    expect(h.refundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", "Execution cancelled")
  })

  it("otherwise the cancel goes on: the sweep's rule ran first, then the flip and the refund of what is still reserved", async () => {
    h.meteredCancelVerdict.mockResolvedValue("settled")
    const run = ctx()
    run.onJobCreated = () => { run.cancelled = true }
    await expect(executeNode(scriptNode(), { prompt: "a bank heist" }, [], [scriptNode()], {}, run)).rejects.toThrow("Execution cancelled")
    expect(h.updates.some((u) => u.row.status === "cancelled")).toBe(true)
    expect(h.refundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", "Execution cancelled")
  })
})
