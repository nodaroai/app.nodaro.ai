// /v1/component/execute when its inner run cannot be started.
//
// The route answers `202 { jobId }` for the wrapper job before it starts the
// inner run in the background (services/app-execution.ts, which settles a run
// the queue refused and throws an UnqueuedRunError saying how). When that start
// throws, the wrapper is failed with a fixed message — never the queue's own
// words — from `processing` only, so a wrapper cancelled meanwhile keeps its
// cancel, when nothing runs (a row could not be created, or the queue's
// refusal failed the run, "failed"): its Idempotency-Key is released in the
// same write, so a retry with the same key starts a new run.
// When the run's state is unknown ("unsettled": it may be waiting, failed with
// its answer lost, or running — and a run that runs is charged), the wrapper is
// NOT failed: it is stamped with the inner run and follows it like a started
// one, settling from the run's real end, and its key stays, so a same-key retry
// never starts a second run beside it.
// A failure AFTER the inner run started keeps the key too.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  executeAppRun: vi.fn(),
  insertJob: vi.fn(),
  insertJobIdempotent: vi.fn(),
  /** Every `jobs` update: its fields, its filters, and whether it matched the wrapper row. */
  jobUpdates: [] as Array<{ fields: Record<string, unknown>; id?: unknown; filters: Record<string, unknown>; applied?: boolean }>,
  /** The wrapper row's status when a write reaches it (the route inserts it `processing`). */
  wrapperStatus: "processing",
  /** What a poll of the inner run answers. */
  pollRead: vi.fn(),
  /**
   * The not-started failure write (lib/job-failure.ts): a compare-and-set that
   * flips the wrapper only when it is in one of `from` (it reads `wrapperStatus`).
   */
  markFailed: vi.fn(),
  /** The follow's wait (ms); 90 minutes unless a test spends it. */
  waitMs: 90 * 60_000,
  /** The compare-and-set that fails a run still waiting (`pending`). */
  failWaiting: vi.fn(),
}))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: m.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: m.insertJob,
  insertJobIdempotent: m.insertJobIdempotent,
  billingPairColumns: () => ({}),
}))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markFailed }))
vi.mock("@/lib/concurrency-lanes/run-failure.js", () => ({ failWaitingExecution: m.failWaiting }))
// The follow's wait is a test knob; its budget and queue-time lookups read nothing.
vi.mock("@/services/workflow-engine/types.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get POLL_ABSOLUTE_TIMEOUT_MS() { return m.waitMs },
  JOB_POLL_INTERVAL_MS: 1,
}))
vi.mock("@/lib/execution-budget.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), executionBudgetExcessMs: async () => 0 }))
vi.mock("@/lib/concurrency-lanes/execution-wait.js", () => ({ executionQueuedMs: async () => 0 }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockReturnValue({}) }))

vi.mock("@/lib/supabase.js", () => {
  const appRow = {
    id: "app-1",
    workflow_id: "wf-inner",
    name: "Comp",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: [],
    snapshot_edges: [],
  }
  function chain(result: unknown) {
    const c: Record<string, unknown> = {}
    for (const k of ["select", "eq", "is", "order", "limit", "insert"]) c[k] = vi.fn().mockReturnValue(c)
    c.single = vi.fn().mockResolvedValue({ data: result, error: null })
    c.maybeSingle = vi.fn().mockResolvedValue({ data: result, error: null })
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [result], error: null })
    return c
  }
  function jobsTable() {
    const c = chain({ id: "row-1" })
    c.update = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
      const entry: { fields: Record<string, unknown>; id?: unknown; filters: Record<string, unknown>; applied?: boolean } = { fields, filters: {} }
      m.jobUpdates.push(entry)
      // `.eq(…)` chains as often as the write filters; awaiting it applies the
      // write only when every filter matches the wrapper row (id + status).
      const builder: Record<string, unknown> = {
        eq: vi.fn().mockImplementation((col: string, value: unknown) => {
          entry.filters[col] = value
          if (col === "id") entry.id = value
          return builder
        }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const row: Record<string, unknown> = { id: "wrapper-1", status: m.wrapperStatus }
          entry.applied = Object.entries(entry.filters).every(([col, value]) => row[col] === value)
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
      return builder
    })
    return c
  }
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "published_apps") return chain(appRow)
        if (table === "jobs") return jobsTable()
        if (table === "workflow_executions") {
          const c = chain(null)
          c.single = m.pollRead
          return c
        }
        return chain({ id: "row-1" })
      }),
    },
  }
})

import { componentExecuteRoutes, COMPONENT_RUN_NOT_STARTED_MESSAGE } from "../component-execute.js"
import { UnqueuedRunError } from "../../lib/enqueue-execution.js"

const STORE_OOM = "OOM command not allowed when used memory > 'maxmemory'."

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  m.jobUpdates.length = 0
  m.wrapperStatus = "processing"
  m.waitMs = 90 * 60_000
  m.failWaiting.mockReset().mockResolvedValue(true)
  m.markFailed.mockImplementation(async (_jobId: string, input: { from?: readonly string[] }) =>
    (input.from ?? []).includes(m.wrapperStatus) ? "flipped" : "missed",
  )
  m.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  m.insertJobIdempotent.mockResolvedValue({ row: { id: "wrapper-1" }, created: true })
  m.executeAppRun.mockResolvedValue({ executionId: "exec-child", appRunId: "run-1", deduped: false })
  m.pollRead.mockResolvedValue({ data: { status: "completed", completed_nodes: 1, total_nodes: 1, total_credits_used: 0, node_states: {} }, error: null })

  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    req.authKind = "jwt"
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/v1/component/execute", headers, payload: { appSlug: "comp" } })
}

/**
 * The wrapper's terminal write, once the background run has settled it: a
 * completion is an update of the row, a failure goes through the one failure
 * writer. Either way it is a compare-and-set from `processing` — the shape of
 * every write is read back as `{ fields, from }`.
 */
async function terminalWrite(): Promise<{ fields: Record<string, unknown>; from?: readonly string[]; applied?: boolean }> {
  await vi.waitFor(() => expect(
    m.jobUpdates.some((u) => u.fields.status === "completed") || m.markFailed.mock.calls.length > 0,
  ).toBe(true))
  const done = m.jobUpdates.find((u) => u.fields.status === "completed")
  if (done) return { fields: done.fields, from: done.filters.status ? [done.filters.status as string] : undefined, applied: done.applied }
  const [, input] = m.markFailed.mock.calls[0] as [string, { error_message: string; from?: readonly string[]; extra?: Record<string, unknown> }]
  return { fields: { status: "failed", error_message: input.error_message, ...(input.extra ?? {}) }, from: input.from }
}

/** The not-started failure write, once the background run has made it: the wrapper's id and its input. */
async function notStartedFailure() {
  await vi.waitFor(() => expect(m.markFailed).toHaveBeenCalledTimes(1))
  const [jobId, input] = m.markFailed.mock.calls[0] as [string, { error_message: string; from?: readonly string[]; extra?: Record<string, unknown> }]
  return { jobId, input }
}

describe("POST /v1/component/execute — an inner run that cannot be started", () => {
  it("a run the queue refused and executeAppRun failed: 202, then the wrapper is failed with a fixed message and its key released in the same write", async () => {
    m.executeAppRun.mockRejectedValue(new UnqueuedRunError("exec-child", "failed", new Error(STORE_OOM)))
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "wrapper-1" })

    const { jobId, input } = await notStartedFailure()
    expect(jobId).toBe("wrapper-1")
    // Through the one failure writer, from `processing` only: a wrapper cancelled meanwhile is not overwritten.
    expect(input).toEqual({ error_message: COMPONENT_RUN_NOT_STARTED_MESSAGE, from: ["processing"], extra: { idempotency_key: null } })
    // The queue's own words never reach the job a client reads.
    expect(JSON.stringify(m.markFailed.mock.calls)).not.toContain("maxmemory")
    // One write: nothing else touched the wrapper.
    expect(m.jobUpdates).toHaveLength(0)
  })

  it("a wrapper inserted under an Idempotency-Key: the key is freed, so a retry with it starts a new run", async () => {
    m.executeAppRun.mockRejectedValue(new UnqueuedRunError("exec-child", "failed", new Error("Connection is closed.")))
    const res = await post({ "idempotency-key": "mcp:comp-retry-01" })
    expect(res.statusCode).toBe(202)
    expect(m.insertJobIdempotent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "component" }), "mcp:comp-retry-01")

    const { input } = await notStartedFailure()
    expect(input.extra).toEqual({ idempotency_key: null })
  })

  it.each([
    ["could not be created", new Error("Failed to create workflow execution")],
    ["could not get its run row", new Error("Failed to create app run")],
  ])("an inner run that %s (nothing was queued) is failed the same way, its key released (its cause stays in the log)", async (_label, cause) => {
    m.executeAppRun.mockRejectedValue(cause)
    await post({ "idempotency-key": "mcp:comp-retry-03" })
    const { input } = await notStartedFailure()
    expect(input).toEqual({ error_message: COMPONENT_RUN_NOT_STARTED_MESSAGE, from: ["processing"], extra: { idempotency_key: null } })
  })

  it.each([
    ["failed", new UnqueuedRunError("exec-child", "failed", new Error(STORE_OOM))],
    ["not created", new Error("Failed to create workflow execution")],
  ])("a wrapper its owner cancelled meanwhile (%s) is not overwritten", async (_label, cause) => {
    m.wrapperStatus = "cancelled"
    m.executeAppRun.mockRejectedValue(cause)
    await post({ "idempotency-key": "mcp:comp-retry-05" })
    await notStartedFailure()
    // The failure write was sent from `processing` only, and so matched nothing; nothing else was written.
    await expect(m.markFailed.mock.results[0]!.value).resolves.toBe("missed")
    expect(m.jobUpdates).toHaveLength(0)
  })

  it("a failure write that errors or throws is logged and never escapes the background run", async () => {
    m.executeAppRun.mockRejectedValue(new UnqueuedRunError("exec-child", "failed", new Error(STORE_OOM)))
    m.markFailed.mockRejectedValueOnce(new Error("fetch failed"))
    const res = await post()
    expect(res.statusCode).toBe(202)
    await notStartedFailure()
    // The wrapper is left `processing` for the stuck-wrapper sweep; nothing else touched it.
    expect(m.jobUpdates).toHaveLength(0)
  })
})

describe("POST /v1/component/execute — a run whose state the queue's refusal left unknown (unsettled)", () => {
  const WRAPPER_INPUT = { type: "component", componentName: "Comp", appSlug: "comp", inputs: {} }
  const unsettled = () => new UnqueuedRunError("exec-child", "unsettled", new Error(STORE_OOM), { appRunId: "run-1" })

  /** Every write to the wrapper, in order: none of them may release its key. */
  function expectKeyKept(): void {
    for (const u of m.jobUpdates) expect(u.fields).not.toHaveProperty("idempotency_key")
  }

  it("the wrapper is not failed: it stays processing, is stamped with the inner run, and settles completed when the run completes", async () => {
    m.executeAppRun.mockRejectedValue(unsettled())
    const res = await post({ "idempotency-key": "mcp:comp-retry-04" })
    expect(res.statusCode).toBe(202)

    const write = await terminalWrite()
    // The run may have been running all along, and a run that runs is charged: the wrapper reports what it really did.
    expect(write.fields.status).toBe("completed")
    expect(write.fields.output_data).toMatchObject({ _executionId: "exec-child", _appRunId: "run-1" })
    expect(m.markFailed).not.toHaveBeenCalled()
    // Stamped as a started run is (`input_data._executionId`), before the terminal write.
    const stamp = m.jobUpdates.find((u) => (u.fields.input_data as Record<string, unknown> | undefined)?._executionId === "exec-child")
    expect(stamp?.fields.input_data).toEqual({ ...WRAPPER_INPUT, _executionId: "exec-child" })
    expect(m.jobUpdates.indexOf(stamp!)).toBeLessThan(m.jobUpdates.findIndex((u) => u.fields.status === "completed"))
    // The completion is a write from `processing` only.
    expect(write.from).toEqual(["processing"])
    // It may be waiting or running: a same-key retry must answer this wrapper, never start a second run.
    expectKeyKept()
  })

  it("settles failed with the run's own message when the run ends failed (a failure write that landed with its answer lost, or the never-started sweep)", async () => {
    m.executeAppRun.mockRejectedValue(unsettled())
    m.pollRead.mockResolvedValue({
      data: { status: "failed", completed_nodes: 0, total_nodes: 1, node_states: {}, error_message: "The run could not be queued to start. Run it again." },
      error: null,
    })
    const res = await post({ "idempotency-key": "mcp:comp-retry-06" })
    expect(res.statusCode).toBe(202)

    const write = await terminalWrite()
    expect(write.fields.status).toBe("failed")
    expect(write.fields.error_message).toBe("The run could not be queued to start. Run it again.")
    expect(write.fields.output_data).toEqual({ _executionId: "exec-child", _appRunId: "run-1" })
    // Through the one failure writer, from `processing` only, and never the not-started write (no key released).
    expect(write.from).toEqual(["processing"])
    expect(write.fields).not.toHaveProperty("idempotency_key")
    expect(JSON.stringify(m.jobUpdates) + JSON.stringify(m.markFailed.mock.calls)).not.toContain("maxmemory")
    expectKeyKept()
  })

  it("waits while the run is still going, settling only at its end", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    try {
      m.executeAppRun.mockRejectedValue(unsettled())
      m.pollRead
        .mockResolvedValueOnce({ data: { status: "running", completed_nodes: 0, total_nodes: 2 }, error: null })
        .mockResolvedValue({ data: { status: "completed", completed_nodes: 2, total_nodes: 2, total_credits_used: 7, node_states: {} }, error: null })
      const res = await post()
      expect(res.statusCode).toBe(202)
      await vi.waitFor(() => expect(m.pollRead).toHaveBeenCalledTimes(1))
      expect(m.jobUpdates.some((u) => u.fields.status !== undefined)).toBe(false)
      await vi.runOnlyPendingTimersAsync()
      const write = await terminalWrite()
      expect(write.fields).toMatchObject({ status: "completed", credits_actual: 7 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("POST /v1/component/execute — an owner's cancel while the run is followed", () => {
  it("a run that completes does not overwrite a cancelled wrapper: the completion is a write from processing that matches nothing", async () => {
    m.wrapperStatus = "cancelled"
    const res = await post()
    expect(res.statusCode).toBe(202)
    const write = await terminalWrite()
    expect(write.fields.status).toBe("completed")
    expect(write.from).toEqual(["processing"])
    expect(write.applied).toBe(false)
  })

  it("a run that fails does not overwrite it either: the failure goes through the failure writer from processing only", async () => {
    m.wrapperStatus = "cancelled"
    m.pollRead.mockResolvedValue({ data: { status: "failed", completed_nodes: 0, total_nodes: 1, node_states: {}, error_message: "boom" }, error: null })
    await post()
    const write = await terminalWrite()
    expect(write.from).toEqual(["processing"])
    await expect(m.markFailed.mock.results[0]!.value).resolves.toBe("missed")
    expect(m.jobUpdates.some((u) => u.fields.status === "failed" || u.fields.status === "completed")).toBe(false)
  })

  it("progress is written to a processing wrapper only", async () => {
    m.pollRead.mockResolvedValue({ data: { status: "completed", completed_nodes: 1, total_nodes: 2, total_credits_used: 0, node_states: {} }, error: null })
    await post()
    await terminalWrite()
    const progress = m.jobUpdates.find((u) => u.fields.progress === 50)
    expect(progress?.filters.status).toBe("processing")
  })
})

describe("POST /v1/component/execute — the follow's wait is spent", () => {
  beforeEach(() => {
    m.waitMs = 0
    m.pollRead.mockResolvedValue({ data: { status: "pending", completed_nodes: 0, total_nodes: 1 }, error: null })
  })

  it("an inner run still waiting for its slot is failed first (so it cannot start and charge later), then the wrapper, keeping its key", async () => {
    const res = await post({ "idempotency-key": "mcp:comp-timeout-01" })
    expect(res.statusCode).toBe(202)
    const write = await terminalWrite()
    expect(m.failWaiting).toHaveBeenCalledWith("exec-child", "Component execution timed out")
    expect(m.failWaiting.mock.invocationCallOrder[0]).toBeLessThan(m.markFailed.mock.invocationCallOrder[0]!)
    expect(write.fields).toMatchObject({ status: "failed", error_message: "Component execution timed out" })
    expect(write.from).toEqual(["processing"])
    // The key stays: a retry needs a new one.
    expect(write.fields).not.toHaveProperty("idempotency_key")
  })

  it("an inner run that is running is not touched by the wrapper's timeout (the compare-and-set misses), and the wrapper still fails", async () => {
    m.failWaiting.mockResolvedValue(false)
    await post()
    const write = await terminalWrite()
    expect(m.failWaiting).toHaveBeenCalledTimes(1)
    expect(write.fields).toMatchObject({ status: "failed", error_message: "Component execution timed out" })
  })

  it("a failure write for the waiting run that throws leaves the wrapper processing for the stuck-wrapper sweep", async () => {
    m.failWaiting.mockRejectedValue(new Error("write failed"))
    await post()
    await vi.waitFor(() => expect(m.failWaiting).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(m.markFailed).not.toHaveBeenCalled()
    expect(m.jobUpdates.some((u) => u.fields.status === "failed" || u.fields.status === "completed")).toBe(false)
  })

  it("a cancelled wrapper keeps its cancel at the timeout", async () => {
    m.wrapperStatus = "cancelled"
    await post()
    await terminalWrite()
    await expect(m.markFailed.mock.results[0]!.value).resolves.toBe("missed")
  })
})

describe("POST /v1/component/execute — a failure after the inner run started", () => {
  it("keeps the wrapper's key: the inner run may still be running, so a same-key retry answers this job", async () => {
    m.pollRead.mockRejectedValue(new Error("poll read failed"))
    const res = await post({ "idempotency-key": "mcp:comp-retry-02" })
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(m.executeAppRun).toHaveBeenCalledTimes(1))

    const write = await terminalWrite()
    expect(write.fields.status).toBe("failed")
    expect(write.fields).not.toHaveProperty("idempotency_key")
    expect(write.fields.error_message).not.toBe(COMPONENT_RUN_NOT_STARTED_MESSAGE)
  })

  it("a run that completes settles the wrapper as before, its key untouched", async () => {
    const res = await post()
    expect(res.statusCode).toBe(202)
    const write = await terminalWrite()
    expect(write.fields.status).toBe("completed")
    expect(write.fields).not.toHaveProperty("idempotency_key")
  })
})
