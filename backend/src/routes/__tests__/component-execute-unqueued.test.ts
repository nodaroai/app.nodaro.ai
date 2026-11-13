// /v1/component/execute when its inner run cannot be started.
//
// The route answers `202 { jobId }` for the wrapper job before it starts the
// inner run in the background (services/app-execution.ts, which settles a run
// the queue refused and throws an UnqueuedRunError saying how). When that start
// throws, the wrapper is failed with a fixed message — never the queue's own
// words — from `processing` only, so a wrapper cancelled meanwhile keeps its
// cancel:
//   - nothing runs (a row could not be created, or the queue's refusal failed
//     the run, "failed"): its Idempotency-Key is released in the same write, so
//     a retry with the same key starts a new run;
//   - the run's state is unknown ("unsettled": it may be waiting or running):
//     the key stays and the inner run is stamped on the wrapper, so a same-key
//     retry never starts a second run beside it.
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
}))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: m.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: m.insertJob,
  insertJobIdempotent: m.insertJobIdempotent,
  billingPairColumns: () => ({}),
}))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markFailed }))
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

/** The wrapper's terminal write, once the background run has settled it. */
async function terminalWrite() {
  await vi.waitFor(() => expect(m.jobUpdates.some((u) => u.fields.status === "failed" || u.fields.status === "completed")).toBe(true))
  return m.jobUpdates.find((u) => u.fields.status === "failed" || u.fields.status === "completed")!
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

  it("a run whose state the refusal left unknown (unsettled): the key stays, the inner run is stamped, and the message is the fixed one", async () => {
    m.executeAppRun.mockRejectedValue(new UnqueuedRunError("exec-child", "unsettled", new Error(STORE_OOM)))
    const res = await post({ "idempotency-key": "mcp:comp-retry-04" })
    expect(res.statusCode).toBe(202)

    const { input } = await notStartedFailure()
    expect(input.error_message).toBe(COMPONENT_RUN_NOT_STARTED_MESSAGE)
    expect(input.from).toEqual(["processing"])
    // It may be waiting or running: a same-key retry must answer this wrapper, never start a second run.
    expect(input.extra).not.toHaveProperty("idempotency_key")
    // Stamped as a started run is (`input_data._executionId`), in the same write.
    expect(input.extra).toEqual({ input_data: { type: "component", componentName: "Comp", appSlug: "comp", inputs: {}, _executionId: "exec-child" } })
    expect(JSON.stringify(m.markFailed.mock.calls)).not.toContain("maxmemory")
    expect(m.jobUpdates).toHaveLength(0)
  })

  it.each([
    ["failed", new UnqueuedRunError("exec-child", "failed", new Error(STORE_OOM))],
    ["unsettled", new UnqueuedRunError("exec-child", "unsettled", new Error(STORE_OOM))],
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
