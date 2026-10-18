import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * `runWorkflow` and a run that continues an earlier one: it sends the
 * continuation fields, and it tells the refusals apart by their CODE. Any 409
 * that named an execution used to read as "already running" — a superseded
 * continuation names one too, and the editor then attached itself to a run
 * that had ended long before.
 */

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { runWorkflow, WorkflowAlreadyRunningError } from "../api"
import { ContinuationPreviewPendingError, ContinuationRefusedError, ContinuationSupersededError } from "../run-workflow-errors"

function answer(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("runWorkflow continuing an earlier run", () => {
  it("a continue-from-failed sends the run and the mode, and no node ids", async () => {
    const fetchMock = answer(202, { executionId: "exec-2", status: "pending", continuedFrom: "exec-1" })
    vi.stubGlobal("fetch", fetchMock)
    const result = await runWorkflow("wf-1", undefined, "key-12345", { continueFromExecutionId: "exec-1", continueMode: "from-failed" })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      continueFromExecutionId: "exec-1",
      continueMode: "from-failed",
      reviewer: "editor",
    })
    expect(result).toEqual({ executionId: "exec-2", status: "pending", continuedFrom: "exec-1" })
  })

  it("a run of named nodes continuing a run sends no mode", async () => {
    const fetchMock = answer(202, { executionId: "exec-2" })
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1", ["r"], undefined, { inputOverrides: { r: { quality: "final" } }, continueFromExecutionId: "exec-1" })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      nodeIds: ["r"],
      inputOverrides: { r: { quality: "final" } },
      continueFromExecutionId: "exec-1",
      reviewer: "editor",
    })
  })

  it("a mode with no run to continue is not sent", async () => {
    const fetchMock = answer(202, { executionId: "exec-2" })
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1", undefined, undefined, { continueMode: "from-failed" })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ reviewer: "editor" })
  })

  it("409 already_running is the run already going", async () => {
    vi.stubGlobal("fetch", answer(409, { error: { code: "already_running", message: "busy" }, executionId: "exec-live" }))
    const err = await runWorkflow("wf-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowAlreadyRunningError)
    expect((err as WorkflowAlreadyRunningError).executionId).toBe("exec-live")
  })

  it("409 continuation_superseded names a newer run, and is NOT 'already running'", async () => {
    vi.stubGlobal("fetch", answer(409, {
      error: { code: "continuation_superseded", message: "continue that one" },
      executionId: "exec-3",
      supersededBy: { executionId: "exec-3", status: "failed" },
    }))
    const err = await runWorkflow("wf-1", undefined, undefined, { continueFromExecutionId: "exec-1", continueMode: "from-failed" }).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(WorkflowAlreadyRunningError)
    expect(err).toBeInstanceOf(ContinuationSupersededError)
    expect((err as ContinuationSupersededError).supersededBy).toEqual({ executionId: "exec-3", status: "failed" })
  })

  it("409 continuation_preview_pending carries what holds the run and the run that finishes it", async () => {
    const next = { continueFromExecutionId: "exec-4", nodeIds: ["r1", "r2", "cap"], inputOverrides: { r1: { quality: "final" }, r2: { quality: "final" } } }
    vi.stubGlobal("fetch", answer(409, {
      error: { code: "continuation_preview_pending", message: "render its final first" },
      executionId: "exec-4",
      renderNodeIds: ["r1", "r2"],
      reviewNodeIds: [],
      next,
    }))
    const err = await runWorkflow("wf-1", undefined, undefined, { continueFromExecutionId: "exec-1", continueMode: "from-failed" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContinuationPreviewPendingError)
    const pending = err as ContinuationPreviewPendingError
    expect(pending.executionId).toBe("exec-4")
    expect(pending.renderNodeIds).toEqual(["r1", "r2"])
    expect(pending.reviewNodeIds).toEqual([])
    expect(pending.next).toEqual(next)
  })

  it.each([
    { status: 404, code: "continuation_not_found" },
    { status: 409, code: "continuation_not_completed" },
    { status: 409, code: "continuation_subset_required" },
    { status: 400, code: "continuation_version_mismatch" },
  ])("$status $code is a continuation refusal with its code", async ({ status, code }) => {
    vi.stubGlobal("fetch", answer(status, { error: { code, message: "no" } }))
    const err = await runWorkflow("wf-1", ["r"], undefined, { continueFromExecutionId: "exec-1" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContinuationRefusedError)
    expect((err as ContinuationRefusedError).code).toBe(code)
  })

  it("another 409 that names an execution is neither 'already running' nor a continuation refusal", async () => {
    vi.stubGlobal("fetch", answer(409, { error: { code: "something_else", message: "nope" }, executionId: "exec-9" }))
    const err = await runWorkflow("wf-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(WorkflowAlreadyRunningError)
    expect(err).not.toBeInstanceOf(ContinuationRefusedError)
  })
})
