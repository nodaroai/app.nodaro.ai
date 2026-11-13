/**
 * enqueueExecution / settleUnqueuedExecution (lib/enqueue-execution.ts): a run
 * the orchestration queue takes is answered by the route as before; a run the
 * queue refuses is failed from `pending` only, through the run's own failure
 * path, with its Idempotency-Key released in the same write and nothing
 * refunded, and answered 500 internal_error. A run that moved on meanwhile
 * (the queue took it after all and a worker claimed it) is answered as
 * started. A failure write that throws leaves the run for the never-started
 * sweep: still a 500, and an app report says so.
 *
 * The failure write retries inside the run's failure path, so a write that
 * errored can land with only its answer lost: the retry then finds the row no
 * longer `pending` and the path answers false. A false after a RETRIED write is
 * read back: a row that reads failed with this failure's own message was
 * failed by this call (answered 500, the event and the use-case wrapper done
 * here), any other row moved on, and a read that fails decides nothing
 * ("unsettled", reported). A false after the FIRST write is believed without a
 * read: nothing of this call's landed, so the run moved on — and a read that
 * failed there would turn a run a worker is running into an error.
 *
 * The queue's errors here are the ones its connection really throws
 * (lib/queue-connection.ts waits out an outage rather than throwing): an
 * error reply from its store, or "Connection is closed" on shutdown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  failWaiting: vi.fn(),
  insertAppReport: vi.fn(),
  emit: vi.fn(),
  finalizeWrapper: vi.fn(),
  /** What the read-back of the run answers (`workflow_executions` by id). */
  readBack: vi.fn(),
  from: vi.fn(),
  /** What each request's enqueueExecution answered. */
  outcomes: [] as unknown[],
}))

vi.mock("@/lib/concurrency-lanes/run-failure.js", () => ({ failWaitingExecutionDetailed: m.failWaiting }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { emit: m.emit } }))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: m.finalizeWrapper }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: m.from } }))

import {
  enqueueExecution,
  failUnqueuedRun,
  settleUnqueuedExecution,
  settleUnqueuedRun,
  UnqueuedRunError,
  UNQUEUED_EXECUTION_CLIENT_MESSAGE,
  UNQUEUED_EXECUTION_MESSAGE,
  UNQUEUED_EXECUTION_UNSETTLED_KIND,
} from "../enqueue-execution.js"

const EXEC = "00000000-0000-4000-8000-000000000060"
const USER = "00000000-0000-4000-8000-000000000001"
const STORE_OOM = "OOM command not allowed when used memory > 'maxmemory'."
const CLOSED = "Connection is closed."

/** A route that queues EXEC the way a run route does, and answers 202 after. */
async function makeApp(enqueue: () => Promise<unknown> = () => m.queueAdd("workflow-execution", { executionId: EXEC }, { jobId: EXEC })): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  app.post("/run", async (req, reply) => {
    const outcome = await enqueueExecution(req, reply, EXEC, enqueue)
    m.outcomes.push(outcome)
    if (reply.sent) return
    return reply.status(202).send({ executionId: EXEC, status: "pending" })
  })
  await app.ready()
  return app
}

const post = async (enqueue?: () => Promise<unknown>) => (await makeApp(enqueue)).inject({ method: "POST", url: "/run" })

/** A request stand-in for the settle step on its own (it only logs and reads the user). */
function fakeRequest(userId?: string): FastifyRequest {
  return { userId, log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as unknown as FastifyRequest
}

/** The read-back's chain: `.from("workflow_executions").select(…).eq("id", …).maybeSingle()`. */
function readBackChain() {
  const c: Record<string, unknown> = {}
  c.select = vi.fn().mockReturnValue(c)
  c.eq = vi.fn().mockReturnValue(c)
  c.maybeSingle = m.readBack
  return c
}

/** A row the read-back finds. */
const row = (status: string, error_message: string | null = null) => ({ data: { status, error_message }, error: null })

/** The failure path's answer after its first write (nothing of an earlier write can have landed). */
const firstWrite = (failed: boolean) => ({ failed, attempts: 1 })
/** The failure path's answer after a retried write (the first errored, and may have landed with its answer lost). */
const retriedWrite = (failed: boolean) => ({ failed, attempts: 2 })

beforeEach(() => {
  m.queueAdd.mockReset().mockResolvedValue({ id: EXEC })
  m.failWaiting.mockReset().mockResolvedValue(firstWrite(true))
  m.insertAppReport.mockReset().mockResolvedValue(true)
  m.emit.mockReset()
  m.finalizeWrapper.mockReset().mockResolvedValue("not_use_case")
  // By default the run reads as moved on: a worker claimed it.
  m.readBack.mockReset().mockResolvedValue(row("running"))
  m.from.mockReset().mockImplementation(() => readBackChain())
  m.outcomes.length = 0
})

describe("enqueueExecution", () => {
  it("a run the queue takes: nothing is failed and the route answers as before", async () => {
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ executionId: EXEC, status: "pending" })
    expect(m.queueAdd).toHaveBeenCalledWith("workflow-execution", { executionId: EXEC }, { jobId: EXEC })
    expect(m.outcomes).toEqual([null])
    expect(m.failWaiting).not.toHaveBeenCalled()
  })

  it("a queue that refuses the run (an error reply from its store): failed from pending with its key released, answered 500", async () => {
    m.queueAdd.mockRejectedValue(new Error(STORE_OOM))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_EXECUTION_CLIENT_MESSAGE } })
    // The queue's own words never reach the caller.
    expect(res.body).not.toContain("maxmemory")
    // One write, through the run's own failure path (from `pending` only), the key released in it.
    expect(m.failWaiting).toHaveBeenCalledTimes(1)
    expect(m.failWaiting).toHaveBeenCalledWith(EXEC, UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
    expect(m.outcomes).toEqual(["failed"])
    // The 500 files its own internal-error report; the unsettled one is not filed.
    expect(m.insertAppReport).not.toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_EXECUTION_UNSETTLED_KIND }))
    // The failure path saw its own write land and did its event and wrapper itself: nothing is read back or sent twice.
    expect(m.from).not.toHaveBeenCalled()
    expect(m.emit).not.toHaveBeenCalled()
    expect(m.finalizeWrapper).not.toHaveBeenCalled()
  })

  it("an enqueue that throws before it returns a promise is a refusal like any other", async () => {
    const res = await post(() => {
      throw new Error(CLOSED)
    })
    expect(res.statusCode).toBe(500)
    expect(m.failWaiting).toHaveBeenCalledWith(EXEC, UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
    expect(m.outcomes).toEqual(["failed"])
  })

  it("a run that moved on meanwhile (a closed connection delivered it, a worker claimed it), missed by the first write: answered as started, nothing read", async () => {
    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    m.failWaiting.mockResolvedValue(firstWrite(false))
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ executionId: EXEC, status: "pending" })
    expect(m.outcomes).toEqual(["moved-on"])
    // No write of this call's can have landed: the false is believed without a read.
    expect(m.from).not.toHaveBeenCalled()
    expect(m.insertAppReport).not.toHaveBeenCalled()
    expect(m.emit).not.toHaveBeenCalled()
    expect(m.finalizeWrapper).not.toHaveBeenCalled()
  })

  it("a first-write miss is never read back, so a read that would fail cannot turn a running run into an error", async () => {
    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    m.failWaiting.mockResolvedValue(firstWrite(false))
    m.readBack.mockResolvedValue({ data: null, error: { message: "could not read" } })
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(m.outcomes).toEqual(["moved-on"])
    expect(m.readBack).not.toHaveBeenCalled()
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a run that moved on, missed by a retried write: the false is read back by id before it is believed", async () => {
    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(row("running"))
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ executionId: EXEC, status: "pending" })
    expect(m.outcomes).toEqual(["moved-on"])
    expect(m.from).toHaveBeenCalledWith("workflow_executions")
    expect(m.readBack).toHaveBeenCalledTimes(1)
    expect(m.insertAppReport).not.toHaveBeenCalled()
    expect(m.emit).not.toHaveBeenCalled()
    expect(m.finalizeWrapper).not.toHaveBeenCalled()
  })

  it("a run another failure ended meanwhile (its owner cancelled it, a sweep failed it) moved on too: not this call's to answer", async () => {
    m.queueAdd.mockRejectedValue(new Error(CLOSED))
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(row("failed", "The run waited too long for a free slot."))
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(m.outcomes).toEqual(["moved-on"])
    expect(m.emit).not.toHaveBeenCalled()
  })

  it("a retried write that landed with its answer lost: the read shows this failure, so the run failed — 500, its event sent, its wrapper settled", async () => {
    m.queueAdd.mockRejectedValue(new Error(STORE_OOM))
    // The failure path's first attempt committed but its answer was lost; its retry's
    // compare-and-set from `pending` matched nothing, so it answered false.
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(row("failed", UNQUEUED_EXECUTION_MESSAGE))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_EXECUTION_CLIENT_MESSAGE } })
    expect(m.outcomes).toEqual(["failed"])
    // What the failure path would have done had it seen its write land, done once here.
    expect(m.emit).toHaveBeenCalledTimes(1)
    expect(m.emit).toHaveBeenCalledWith(EXEC, {
      type: "execution:failed",
      executionId: EXEC,
      nodeStates: {},
      errorMessage: UNQUEUED_EXECUTION_MESSAGE,
    })
    expect(m.finalizeWrapper).toHaveBeenCalledTimes(1)
    expect(m.finalizeWrapper).toHaveBeenCalledWith(EXEC)
    expect(m.insertAppReport).not.toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_EXECUTION_UNSETTLED_KIND }))
  })

  it("a wrapper settle that throws after a landed write is logged, and the run still answers failed", async () => {
    m.queueAdd.mockRejectedValue(new Error(STORE_OOM))
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(row("failed", UNQUEUED_EXECUTION_MESSAGE))
    m.finalizeWrapper.mockRejectedValue(new Error("could not read the wrapper"))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(m.outcomes).toEqual(["failed"])
    expect(m.emit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["answers an error", () => m.readBack.mockResolvedValue({ data: null, error: { message: "could not read" } })],
    ["throws", () => m.readBack.mockRejectedValue(new Error("fetch failed"))],
  ])("a read-back (after a retried write) that %s decides nothing: unsettled, reported, and answered 500", async (_label, arrange) => {
    m.queueAdd.mockRejectedValue(new Error(STORE_OOM))
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    arrange()
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_EXECUTION_CLIENT_MESSAGE } })
    expect(m.outcomes).toEqual(["unsettled"])
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({
      node: "enqueue-execution",
      kind: UNQUEUED_EXECUTION_UNSETTLED_KIND,
      severity: "error",
      userId: USER,
      executionId: EXEC,
    }))
    expect(m.emit).not.toHaveBeenCalled()
    expect(m.finalizeWrapper).not.toHaveBeenCalled()
  })

  it("a failure write that throws: left pending for the never-started sweep, reported, and still answered 500", async () => {
    m.queueAdd.mockRejectedValue(new Error(STORE_OOM))
    m.failWaiting.mockRejectedValue(new Error("could not write the execution"))
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_EXECUTION_CLIENT_MESSAGE } })
    expect(m.outcomes).toEqual(["unsettled"])
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({
      node: "enqueue-execution",
      kind: UNQUEUED_EXECUTION_UNSETTLED_KIND,
      severity: "error",
      userId: USER,
      executionId: EXEC,
    }))
    // A write that threw is not read back here: the report covers both states it may have left.
    expect(m.from).not.toHaveBeenCalled()
  })
})

describe("settleUnqueuedExecution", () => {
  it("answers what became of the run, and never throws", async () => {
    m.failWaiting.mockResolvedValueOnce(firstWrite(true))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("failed")
    m.failWaiting.mockResolvedValueOnce(retriedWrite(true))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("failed")
    m.failWaiting.mockResolvedValueOnce(firstWrite(false))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("moved-on")
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce(row("running"))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("moved-on")
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce(row("failed", UNQUEUED_EXECUTION_MESSAGE))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("failed")
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce({ data: null, error: { message: "could not read" } })
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("unsettled")
    m.failWaiting.mockRejectedValueOnce(new Error("could not write the execution"))
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("unsettled")
    expect(m.failWaiting).toHaveBeenCalledTimes(7)
    for (const call of m.failWaiting.mock.calls) expect(call).toEqual([EXEC, UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null }])
    // Only the three retried misses were read back.
    expect(m.readBack).toHaveBeenCalledTimes(3)
  })

  it("a run that is gone by the read-back (no row) moved on: it is not this call's to fail", async () => {
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce({ data: null, error: null })
    await expect(settleUnqueuedExecution(fakeRequest(USER), EXEC)).resolves.toBe("moved-on")
    expect(m.emit).not.toHaveBeenCalled()
  })

  it("a request with no user (a bot's or a webhook's): the report names none", async () => {
    m.failWaiting.mockRejectedValueOnce(new Error("could not write the execution"))
    const req = fakeRequest()
    await expect(settleUnqueuedExecution(req, EXEC)).resolves.toBe("unsettled")
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_EXECUTION_UNSETTLED_KIND, userId: null, executionId: EXEC }))
    expect(req.log.error).toHaveBeenCalled()
  })
})

// The core the schedule fire shares (lib/schedule-fire.ts): its own message, its own columns
// (it keeps the run's key), and no report — the caller decides what an unknown outcome means.
describe("failUnqueuedRun", () => {
  const OTHER_MESSAGE = "Execution failed — it could not be queued to start. Run it again."

  it("writes the caller's message and columns, and reads a retried miss back against that message", async () => {
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce(row("failed", OTHER_MESSAGE))
    await expect(failUnqueuedRun(EXEC, OTHER_MESSAGE, {})).resolves.toEqual({ outcome: "failed" })
    expect(m.failWaiting).toHaveBeenCalledWith(EXEC, OTHER_MESSAGE, {})
    // The event says what the run says.
    expect(m.emit).toHaveBeenCalledWith(EXEC, { type: "execution:failed", executionId: EXEC, nodeStates: {}, errorMessage: OTHER_MESSAGE })
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a retried miss whose row carries another message moved on", async () => {
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce(row("failed", UNQUEUED_EXECUTION_MESSAGE))
    await expect(failUnqueuedRun(EXEC, OTHER_MESSAGE, {})).resolves.toEqual({ outcome: "moved-on" })
    expect(m.emit).not.toHaveBeenCalled()
  })

  it("a first-write miss moved on, with no read", async () => {
    m.failWaiting.mockResolvedValueOnce(firstWrite(false))
    await expect(failUnqueuedRun(EXEC, OTHER_MESSAGE, {})).resolves.toEqual({ outcome: "moved-on" })
    expect(m.readBack).not.toHaveBeenCalled()
  })

  it("unsettled answers the write's error when it threw, none when the read-back failed, and files no report either way", async () => {
    const writeErr = new Error("could not write the execution")
    m.failWaiting.mockRejectedValueOnce(writeErr)
    await expect(failUnqueuedRun(EXEC, OTHER_MESSAGE, {})).resolves.toEqual({ outcome: "unsettled", err: writeErr })
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce({ data: null, error: { message: "could not read" } })
    await expect(failUnqueuedRun(EXEC, OTHER_MESSAGE, {})).resolves.toEqual({ outcome: "unsettled" })
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })
})

describe("settleUnqueuedRun (a service with no request)", () => {
  it("a retried miss is read back; an unknown outcome is reported against the user", async () => {
    m.failWaiting.mockResolvedValueOnce(retriedWrite(false))
    m.readBack.mockResolvedValueOnce({ data: null, error: { message: "could not read" } })
    const log = { error: vi.fn(), warn: vi.fn() }
    await expect(settleUnqueuedRun(EXEC, USER, log)).resolves.toBe("unsettled")
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_EXECUTION_UNSETTLED_KIND, userId: USER, executionId: EXEC }))
    expect(log.error).toHaveBeenCalled()
  })

  it("a first-write miss moved on without a read or a report", async () => {
    m.failWaiting.mockResolvedValueOnce(firstWrite(false))
    await expect(settleUnqueuedRun(EXEC, USER)).resolves.toBe("moved-on")
    expect(m.readBack).not.toHaveBeenCalled()
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })
})

describe("UnqueuedRunError", () => {
  it("carries the run, the outcome and the queue's own error as its cause", () => {
    const cause = new Error(STORE_OOM)
    const err = new UnqueuedRunError(EXEC, "unsettled", cause)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("UnqueuedRunError")
    expect(err.executionId).toBe(EXEC)
    expect(err.outcome).toBe("unsettled")
    expect(err.cause).toBe(cause)
  })
})
