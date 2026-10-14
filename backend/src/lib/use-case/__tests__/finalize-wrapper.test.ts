import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph, type TightenEpisodeSettings } from "@nodaro/render-rules"

const settings: TightenEpisodeSettings = { ...TIGHTEN_EPISODE_DEFAULTS, captions: false }
const graph = toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video" } }), settings)
const m = vi.hoisted(() => ({
  exec: null as Record<string, unknown> | null,
  wrapper: null as Record<string, unknown> | null,
  wrapperError: null as { message: string } | null,
  completed: vi.fn(async (_id: string, _fields: Record<string, unknown>) => true),
  failed: vi.fn(async (_id: string, _input: Record<string, unknown>) => true),
  commit: vi.fn(async (_id: string) => {}),
  refund: vi.fn(async (_id: string) => 1),
}))
vi.mock("../../execution-inline-graph.js", () => ({ loadExecutionForWrapper: async () => m.exec }))
vi.mock("../../supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.wrapper, error: m.wrapperError }) }) }) }) },
}))
vi.mock("../../../workers/shared.js", () => ({ markJobCompleted: m.completed }))
vi.mock("../../job-failure.js", () => ({ markJobFailed: m.failed }))
vi.mock("../../credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: m.commit, refundReservedCreditsForJob: m.refund }))
import { finalizeUseCaseWrapper } from "../finalize-wrapper.js"

const done = { "uc-plan": { status: "completed", output: { json: { v: 1 } } }, "uc-render": { status: "completed", output: { videoUrl: "https://r2/cut.mp4" } } }
const exec = (over: Record<string, unknown> = {}) => ({ id: "exec-1", userId: "u1", status: "completed", nodeStates: done, totalCreditsUsed: 872, errorMessage: null, wrapperJobId: "job-w", inlineGraph: graph, ...over })

/** A CAS that one caller wins: the first flip answers true, every later one false. */
function oneWinner(): () => Promise<boolean> {
  let won = false
  return async () => {
    await new Promise((r) => setTimeout(r, 1))
    if (won) return false
    won = true
    return true
  }
}

beforeEach(() => {
  m.exec = exec()
  m.wrapper = { id: "job-w", user_id: "u1", status: "processing", input_data: { type: "tighten-episode", _executionId: "exec-1", _feeCredits: 10 } }
  m.wrapperError = null
  for (const f of [m.completed, m.failed, m.commit, m.refund]) f.mockReset()
  m.completed.mockResolvedValue(true)
  m.failed.mockResolvedValue(true)
  m.refund.mockResolvedValue(1)
})

describe("finalizeUseCaseWrapper", () => {
  it("completed run: completes the wrapper with the result and inner+fee credits, then commits the fee once", async () => {
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("completed")
    expect(m.completed).toHaveBeenCalledWith("job-w", expect.objectContaining({
      output_data: expect.objectContaining({ videoUrl: "https://r2/cut.mp4", json: { v: 1 }, _executionId: "exec-1" }),
      credits_actual: 882,
    }))
    expect(m.commit).toHaveBeenCalledTimes(1)
    expect(m.commit).toHaveBeenCalledWith("job-w")
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("a wrapper whose start stamp never landed is stamped as it settles (completed or failed); a stamped one is left as is", async () => {
    m.wrapper = { ...m.wrapper!, input_data: { type: "tighten-episode", _feeCredits: 10 } }
    await finalizeUseCaseWrapper("exec-1")
    expect(m.completed.mock.calls[0]![1].input_data).toEqual({ type: "tighten-episode", _feeCredits: 10, _executionId: "exec-1" })
    m.exec = exec({ status: "failed", errorMessage: "boom" })
    await finalizeUseCaseWrapper("exec-1")
    expect((m.failed.mock.calls[0]![1].extra as Record<string, unknown>).input_data).toEqual({ type: "tighten-episode", _feeCredits: 10, _executionId: "exec-1" })
    m.wrapper = { ...m.wrapper!, input_data: { type: "tighten-episode", _executionId: "exec-1", _feeCredits: 10 } }
    m.exec = exec()
    await finalizeUseCaseWrapper("exec-1")
    expect(m.completed.mock.calls[1]![1]).not.toHaveProperty("input_data")
  })
  it("a second call (the sweep after the finally) moves no money", async () => {
    await finalizeUseCaseWrapper("exec-1")
    m.wrapper = { ...m.wrapper!, status: "completed" }
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(m.commit).toHaveBeenCalledTimes(1)
    expect(m.completed).toHaveBeenCalledTimes(1)
  })
  it("a wrapper whose result is held for review is a reviewer's: the finaliser moves nothing", async () => {
    m.wrapper = { ...m.wrapper!, status: "pending_review" }
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    m.exec = exec({ status: "failed" })
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  })
  it("a wrapper some cancel writer flipped without settling: its fee is refunded, idempotently (exactly once across calls)", async () => {
    m.wrapper = { ...m.wrapper!, status: "cancelled" }
    m.exec = exec({ status: "cancelled" })
    // The real refund moves only a `reserved` hold: the first call refunds it, every later one finds none.
    m.refund.mockResolvedValueOnce(1).mockResolvedValue(0)
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(m.refund).toHaveBeenCalledWith("job-w")
    expect(await m.refund.mock.results[0]!.value).toBe(1)
    expect(await m.refund.mock.results[1]!.value).toBe(0)
    expect(m.commit).not.toHaveBeenCalled()
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  })
  it("a completed or failed wrapper was settled by whoever flipped it: no money moves", async () => {
    for (const status of ["completed", "failed"]) {
      m.wrapper = { ...m.wrapper!, status }
      expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    }
    expect(m.refund).not.toHaveBeenCalled(); expect(m.commit).not.toHaveBeenCalled()
  })
  it("a run reporting to another wrapper settles nothing for the expected one", async () => {
    expect(await finalizeUseCaseWrapper("exec-1", "job-other")).toBe("not_use_case")
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
    expect(await finalizeUseCaseWrapper("exec-1", "job-w")).toBe("completed")
  })
  it("lost the CAS (someone else finalised): no commit", async () => {
    m.completed.mockResolvedValue(false)
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(m.commit).not.toHaveBeenCalled()
  })
  it("two finalisers at once (the finally and the sweep) on a completed run: the fee is committed exactly once", async () => {
    m.completed.mockImplementation(oneWinner())
    const outcomes = await Promise.all([finalizeUseCaseWrapper("exec-1"), finalizeUseCaseWrapper("exec-1")])
    expect([...outcomes].sort()).toEqual(["already_final", "completed"])
    expect(m.commit).toHaveBeenCalledTimes(1)
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("two finalisers at once on a run cancelled from outside: the fee is refunded exactly once", async () => {
    m.exec = exec({ status: "cancelled", nodeStates: { "uc-plan": done["uc-plan"] } })
    m.failed.mockImplementation(oneWinner())
    const outcomes = await Promise.all([finalizeUseCaseWrapper("exec-1"), finalizeUseCaseWrapper("exec-1")])
    expect([...outcomes].sort()).toEqual(["already_final", "failed"])
    expect(m.refund).toHaveBeenCalledTimes(1)
    expect(m.commit).not.toHaveBeenCalled()
  })
  for (const status of ["failed", "cancelled", "timed_out", "discarded"]) {
    it(`${status} run: fails the wrapper keeping completed outputs, refunds the fee once`, async () => {
      m.exec = exec({ status, errorMessage: "Node execution failed: uc-render: boom", nodeStates: { ...done, "uc-render": { status: "failed" } } })
      expect(await finalizeUseCaseWrapper("exec-1")).toBe("failed")
      expect(m.failed).toHaveBeenCalledWith("job-w", expect.objectContaining({
        extra: { output_data: expect.objectContaining({ json: { v: 1 }, failedNodeId: "uc-render" }) },
        from: ["pending", "queued", "processing"],
      }))
      expect(m.refund).toHaveBeenCalledTimes(1)
      expect(m.refund).toHaveBeenCalledWith("job-w")
      expect(m.commit).not.toHaveBeenCalled()
    })
  }
  it("names the failed step in the user's words, never an inner node id", async () => {
    m.exec = exec({ status: "failed", errorMessage: "Node execution failed: uc-render: boom", nodeStates: { ...done, "uc-render": { status: "failed" } } })
    await finalizeUseCaseWrapper("exec-1")
    const message = (m.failed.mock.calls[0]![1] as { error_message: string }).error_message
    expect(message).toBe("Apply Cut: boom")
  })
  it("a run cancelled with no failed step says it was cancelled", async () => {
    m.exec = exec({ status: "cancelled", errorMessage: null, nodeStates: {} })
    await finalizeUseCaseWrapper("exec-1")
    expect((m.failed.mock.calls[0]![1] as { error_message: string }).error_message).toBe("The run was cancelled")
  })
  it("lost the failure CAS (the wrapper was cancelled first, its hold refunded there): no second refund", async () => {
    m.exec = exec({ status: "cancelled" })
    m.failed.mockResolvedValue(false)
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("already_final")
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("a completed run with no media is a failure (never a completed job without a result)", async () => {
    m.exec = exec({ nodeStates: { "uc-plan": done["uc-plan"] } })
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("failed")
    expect((m.failed.mock.calls[0]![1] as { error_message: string }).error_message).toBe("The run finished without a result")
    expect(m.refund).toHaveBeenCalledTimes(1)
    expect(m.completed).not.toHaveBeenCalled()
  })
  it("a run whose snapshot was erased still settles its wrapper (failed, refunded) — never left processing", async () => {
    m.exec = exec({ inlineGraph: null })
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("failed")
    expect(m.failed).toHaveBeenCalledWith("job-w", expect.objectContaining({ extra: { output_data: { quality: "final", _executionId: "exec-1" } } }))
    expect(m.refund).toHaveBeenCalledTimes(1)
  })
  it("a fee of 0 (a Render final) completes with the inner total alone", async () => {
    m.wrapper = { ...m.wrapper!, input_data: { _executionId: "exec-1", _feeCredits: 0 } }
    await finalizeUseCaseWrapper("exec-1")
    expect(m.completed).toHaveBeenCalledWith("job-w", expect.objectContaining({ credits_actual: 872 }))
  })
  it("still running: does nothing", async () => {
    for (const status of ["pending", "running", "stopping"]) {
      m.exec = exec({ status })
      expect(await finalizeUseCaseWrapper("exec-1")).toBe("not_terminal")
    }
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  })
  it("not a use-case run, a run that is gone, or a wrapper owned by someone else: does nothing", async () => {
    m.exec = exec({ wrapperJobId: null })
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("not_use_case")
    m.exec = null
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("not_use_case")
    m.exec = exec(); m.wrapper = { ...m.wrapper!, user_id: "u2" }
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("not_use_case")
    m.wrapper = null
    expect(await finalizeUseCaseWrapper("exec-1")).toBe("not_use_case")
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  })
  it("an unreadable wrapper throws (a read error is never taken for a missing wrapper)", async () => {
    m.wrapperError = { message: "db down" }
    await expect(finalizeUseCaseWrapper("exec-1")).rejects.toThrow(/db down/)
    expect(m.completed).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  })
})
