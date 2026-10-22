import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const refundMock = vi.fn().mockResolvedValue(1)
  // select chain: from("jobs").select(...).eq(...).in(...) → rows
  const rows: Array<Record<string, unknown>> = []
  // The `.eq` filters are APPLIED (a row with no such column reads as the
  // execution's own: exec-1, owned by owner-1), so a filter the query leaves
  // out shows up as a row the test did not expect.
  const ROW_DEFAULTS: Record<string, unknown> = { workflow_execution_id: "exec-1", user_id: "owner-1" }
  const selectInMock = vi.fn((filters: Record<string, unknown>) => Promise.resolve({
    data: rows.filter((r) => Object.entries(filters).every(([c, v]) => (r[c] ?? ROW_DEFAULTS[c]) === v)),
    error: null as { message: string } | null,
  }))
  const selectChain = (filters: Record<string, unknown>): Record<string, unknown> => ({
    eq: (col: string, v: unknown) => selectChain({ ...filters, [col]: v }),
    in: () => selectInMock(filters),
  })
  const selectMock = vi.fn(() => selectChain({}))
  // update chain: from("jobs").update(...).eq(...).in(...).select("id") → flipped
  const updateCalls: Array<Record<string, unknown>> = []
  const updSelectMock = vi.fn(() => Promise.resolve({ data: [{ id: "flipped" }], error: null }))
  const updInMock = vi.fn(() => ({ select: updSelectMock }))
  const updEqMock = vi.fn(() => ({ in: updInMock }))
  const updateMock = vi.fn((arg: Record<string, unknown>) => {
    updateCalls.push(arg)
    return { eq: updEqMock }
  })
  const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }))
  return { refundMock, rows, selectInMock, updateMock, updateCalls, fromMock }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
const owned = vi.hoisted(() => ({
  cancel: vi.fn(async (_id: string, _owner: string) => ({ kind: "cancelled" as string })),
  // D10: the reconcile sweep's metered rule, applied before a stale row is
  // cancelled. Default: no billed metered hold — today's cancel + refund.
  meteredVerdict: vi.fn(async (_id: string, _known?: unknown) => "not-metered" as "not-metered" | "not-started" | "settled" | "retry"),
  /** R38 / N1: the post-flip settle of a not-started verdict — kept (the call started meanwhile), settled (at the actual), or refund. */
  keptAfterFlip: vi.fn(async (_id: string) => "refund" as "kept" | "settled" | "refund"),
}))
// 554: a cancelled job's metered SIDE holds settle on their own markers after the flip.
const sideHolds = vi.hoisted(() => ({ settle: vi.fn(async (_ids: readonly string[]) => {}) }))
vi.mock("../../llm-side-hold.js", () => ({ settleSideHoldsAfterFlip: sideHolds.settle }))
vi.mock("../../cancel-job.js", () => ({
  cancelOwnedJob: owned.cancel,
  settleMeteredHoldsBeforeCancel: owned.meteredVerdict,
  settleMeteredHoldAfterFlip: owned.keptAfterFlip,
}))

import { cancelInFlightChildJobs } from "../cancel-inflight-jobs.js"
import { declaredJobBudgetMs } from "../../job-budget.js"

describe("cancelInFlightChildJobs — adoption split (audit A2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.updateCalls.length = 0
    mocks.refundMock.mockResolvedValue(1)
    owned.meteredVerdict.mockResolvedValue("not-metered")
  })

  it("a use-case wrapper → the shared single-job cancel (fee refunded, hidden run stopped), never the bare flip", async () => {
    owned.cancel.mockClear()
    mocks.rows.push(
      { id: "j-wrap", provider: "use-case", input_data: { node_id: "node-uc", type: "tighten-episode", _executionId: "inner" }, provider_task_id: null },
      { id: "j-pre", input_data: { node_id: "node-1", type: "generate-image" }, provider_task_id: null },
    )

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", { adoptLiveBudgetedRenders: true })

    expect(owned.cancel).toHaveBeenCalledTimes(1)
    expect(owned.cancel).toHaveBeenCalledWith("j-wrap", "owner-1")
    expect(cancelled).toBe(2)
    expect(adoptable.size).toBe(0)
    expect(mocks.updateCalls).toHaveLength(1)
    expect(mocks.refundMock).toHaveBeenCalledTimes(1)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-pre")
  })

  it("a use-case wrapper the shared cancel could not flip is not counted", async () => {
    owned.cancel.mockClear().mockResolvedValueOnce({ kind: "lost_race" })
    mocks.rows.push({ id: "j-wrap", provider: "use-case", input_data: {}, provider_task_id: null })
    expect((await cancelInFlightChildJobs("exec-1", "owner-1")).cancelled).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
  })

  it("PRE-provider row (no provider_task_id) → cancelled + refunded, node_id stripped", async () => {
    mocks.rows.push({
      id: "j-pre",
      input_data: { node_id: "node-1", type: "generate-image" },
      provider_task_id: null,
      usage_log_id: "ul-1",
      credits: 4,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-pre")
    const upd = mocks.updateCalls[0]!
    expect(upd.status).toBe("cancelled")
    const inputData = upd.input_data as Record<string, unknown>
    expect(inputData.node_id).toBeUndefined()
    expect(inputData.superseded_node_id).toBe("node-1")
  })

  it("POST-provider single-shot row → ADOPTED (no cancel, no refund — provider already paid)", async () => {
    mocks.rows.push({
      id: "j-post",
      input_data: { node_id: "node-2", type: "image-to-video" },
      provider_task_id: "kie-task-1",
      usage_log_id: "ul-2",
      credits: 15,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(cancelled).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(adoptable.get("node-2")).toEqual({
      jobId: "j-post",
      usageLogId: "ul-2",
      creditsReserved: 15,
    })
  })

  it("an adopted row carries the budget its job declares (Track 0.11) — the SAME registry read the dispatch made", async () => {
    const edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
      segments: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, inMs: i * 60_000, outMs: (i + 1) * 60_000, video: "A" })),
    }
    const inputData = { node_id: "node-9", type: "apply-edl", edl, output: "video", quality: "final" }
    mocks.rows.push({
      id: "j-render", input_data: inputData, provider_task_id: "task-9", usage_log_id: "ul-9", credits: 30, job_type: "apply-edl",
    })
    mocks.rows.push({
      id: "j-img", input_data: { node_id: "node-10", type: "generate-image" }, provider_task_id: "kie-10", usage_log_id: "ul-10", credits: 4, job_type: "generate-image",
    })

    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(adoptable.get("node-9")?.budgetMs).toBe(declaredJobBudgetMs("apply-edl", inputData))
    expect(adoptable.get("node-9")?.budgetMs).toBeGreaterThan(90 * 60_000)
    expect(adoptable.get("node-10")?.budgetMs).toBeUndefined()
  })

  it("POST-provider FAN-OUT iteration (iterationIndex set) → cancelled, not adopted", async () => {
    mocks.rows.push({
      id: "j-fan",
      input_data: { node_id: "node-3", iterationIndex: 2 },
      provider_task_id: "kie-task-2",
      usage_log_id: "ul-3",
      credits: 5,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-fan")
  })

  it("POST-provider row WITHOUT node_id (legacy/orphan) → cancelled, not adopted", async () => {
    mocks.rows.push({
      id: "j-orphan",
      input_data: {},
      provider_task_id: "kie-task-3",
      usage_log_id: null,
      credits: null,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
  })

  it("mixed batch: splits correctly and first adoptable per node wins", async () => {
    mocks.rows.push(
      { id: "j-a", input_data: { node_id: "n1" }, provider_task_id: "t-a", usage_log_id: "ul-a", credits: 3 },
      { id: "j-b", input_data: { node_id: "n1" }, provider_task_id: "t-b", usage_log_id: "ul-b", credits: 3 },
      { id: "j-c", input_data: { node_id: "n2" }, provider_task_id: null, usage_log_id: "ul-c", credits: 2 },
    )

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    // j-a adopted for n1; j-b (duplicate for n1) cancelled; j-c (pre-provider) cancelled.
    expect(adoptable.get("n1")?.jobId).toBe("j-a")
    expect(cancelled).toBe(2)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-b")
    expect(mocks.refundMock).toHaveBeenCalledWith("j-c")
  })

  it("attacker: an in-flight job another user pointed at this execution is neither adopted nor touched", async () => {
    // Before 474 a browser could insert its own `jobs` row naming any
    // execution, with a provider task id and a node id of its choosing. The
    // resume must not adopt it (its result would become the node's), and must
    // not cancel or refund a row it does not own.
    mocks.rows.push(
      { id: "j-planted", user_id: "attacker", input_data: { node_id: "n1" }, provider_task_id: "evil-task", usage_log_id: null, credits: 0 },
      { id: "j-own", input_data: { node_id: "n2" }, provider_task_id: "t-own", usage_log_id: "ul-own", credits: 3 },
    )

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")

    expect(adoptable.has("n1")).toBe(false)
    expect(adoptable.get("n2")?.jobId).toBe("j-own")
    expect(cancelled).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })
})

describe("cancelInFlightChildJobs — a billed metered hold is never refunded (D10)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.updateCalls.length = 0
    mocks.refundMock.mockResolvedValue(1)
    owned.meteredVerdict.mockResolvedValue("not-metered")
  })

  it("asks the sweep's metered rule before the flip, with the row's sweep counters", async () => {
    mocks.rows.push({
      id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null,
      reconcile_attempts: 3, reconcile_last_error: "metered_settle_retry:billed: no receipt",
    })
    await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(owned.meteredVerdict).toHaveBeenCalledWith("j-llm", { reconcile_attempts: 3, reconcile_last_error: "metered_settle_retry:billed: no receipt" })
    expect(owned.meteredVerdict.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateMock.mock.invocationCallOrder[0]!)
  })

  it("a billed hold the sweep could not commit yet → left for the sweep: not cancelled, not refunded (and, outside a resume, not adopted)", async () => {
    owned.meteredVerdict.mockResolvedValue("retry")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(cancelled).toBe(0)
    expect(adoptable.size).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("resume: a metered job whose call may be in flight (retry) is ADOPTED for its node — never re-run, never cancelled or refunded", async () => {
    owned.meteredVerdict.mockResolvedValue("retry")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null, usage_log_id: "ul-llm", credits: 12 })
    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", { adoptLiveBudgetedRenders: true })
    expect(cancelled).toBe(0)
    expect(adoptable.get("node-1")).toMatchObject({ jobId: "j-llm", usageLogId: "ul-llm", creditsReserved: 12 })
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("resume: a fan-out iteration (or an orphan with no node) left live by the metered rule is not adopted", async () => {
    owned.meteredVerdict.mockResolvedValue("retry")
    mocks.rows.push(
      { id: "j-iter", input_data: { node_id: "node-1", type: "generate-script", iterationIndex: 2 }, provider_task_id: null },
      { id: "j-orphan", input_data: { type: "generate-script" }, provider_task_id: null },
    )
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", { adoptLiveBudgetedRenders: true })
    expect(adoptable.size).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
  })

  it("R38: a pre-call verdict is re-read after the flip — a worker that started its call meanwhile keeps its hold (no refund)", async () => {
    owned.meteredVerdict.mockResolvedValue("not-started")
    owned.keptAfterFlip.mockResolvedValueOnce("kept")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    const { cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(cancelled).toBe(1)
    expect(owned.keptAfterFlip).toHaveBeenCalledWith("j-llm")
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("N1: an earlier attempt billed, nothing in flight → settled at the actual after the flip; the refund then touches only what is still reserved", async () => {
    owned.meteredVerdict.mockResolvedValue("not-started")
    owned.keptAfterFlip.mockResolvedValueOnce("settled")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    const { cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(cancelled).toBe(1)
    expect(owned.keptAfterFlip.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.updateMock.mock.invocationCallOrder[0]!)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-llm")
  })

  it("554: the stale job's side holds settle after its flip; a job left live (retry) is not touched", async () => {
    owned.meteredVerdict.mockResolvedValue("not-started")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(sideHolds.settle).toHaveBeenCalledWith(["j-llm"])
    expect(sideHolds.settle.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.updateMock.mock.invocationCallOrder[0]!)
  })

  it("R38: a pre-call verdict still pre-call after the flip → refunded at once", async () => {
    owned.meteredVerdict.mockResolvedValue("not-started")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(owned.keptAfterFlip).toHaveBeenCalledWith("j-llm")
    expect(mocks.refundMock).toHaveBeenCalledWith("j-llm")
  })

  it("no re-read for any other verdict (a tier job's cancel is unchanged)", async () => {
    mocks.rows.push({ id: "j-tier", input_data: { node_id: "node-1", type: "generate-image" }, provider_task_id: null })
    await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(owned.keptAfterFlip).not.toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-tier")
  })

  it("a committed (settled) billed hold → the stale row is cancelled; the refund touches only what is still reserved", async () => {
    owned.meteredVerdict.mockResolvedValue("settled")
    mocks.rows.push({ id: "j-llm", input_data: { node_id: "node-1", type: "generate-script" }, provider_task_id: null })
    const { cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(cancelled).toBe(1)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-llm")
  })
})
