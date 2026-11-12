// The never-started sweep (lib/reconcile/never-started-executions.ts) against a
// fake `workflow_executions` table that APPLIES the scan's filters, so a test
// pins both the predicate and the rows it lets through.
//
// The bug it closes: a run written `pending` whose hand-off to the
// orchestration queue never landed stayed `pending` forever. Both stale sweeps
// scan only claimed rows (`running` / `stopping`), and the schedule cron and
// the webhook trigger read `pending` as "already running", so one such row
// silenced its workflow's schedule for good.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

interface Row {
  id: string
  user_id: string
  status: string
  started_at: string | null
  created_at: string
  runtime_env: string | null
}

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  filters: [] as Array<[string, string, unknown]>,
  queueState: new Map<string, string>(),
  /** Runs whose job lookup fails / never answers / whose job's state read never answers. */
  queueRejects: new Set<string>(),
  queueHangs: new Set<string>(),
  stateHangs: new Set<string>(),
  lookedUp: [] as string[],
  waitedMs: new Map<string, number>(),
  waitOpts: [] as Array<Record<string, unknown>>,
  failed: [] as Array<{ id: string; message: string }>,
  failThrows: new Set<string>(),
  failLoses: new Set<string>(),
}))

vi.mock("../../supabase.js", () => {
  function scan() {
    const filters: Array<[string, string, unknown]> = []
    const keep = (r: Row) =>
      filters.every(([kind, col, value]) => {
        const v = (r as unknown as Record<string, unknown>)[col]
        if (kind === "eq") return v === value
        if (kind === "is") return v === value
        if (kind === "lt") return typeof v === "string" && v < (value as string)
        if (kind === "or") {
          // Interpret the runtime-env predicate rather than restating its rule.
          const terms = (value as string).split(",")
          const allowed = terms.filter((t) => t.startsWith("runtime_env.eq.")).map((t) => t.slice("runtime_env.eq.".length))
          return r.runtime_env === null ? terms.includes("runtime_env.is.null") : allowed.includes(r.runtime_env)
        }
        return true
      })
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => (filters.push(["eq", col, value]), builder),
      is: (col: string, value: unknown) => (filters.push(["is", col, value]), builder),
      lt: (col: string, value: unknown) => (filters.push(["lt", col, value]), builder),
      or: (value: string) => (filters.push(["or", "", value]), builder),
      order: () => builder,
      limit: () => {
        mocks.filters.push(...filters)
        return Promise.resolve({ data: mocks.rows.filter(keep), error: null })
      },
    }
    return builder
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table !== "workflow_executions") throw new Error(`unexpected table ${table}`)
        return scan()
      },
    },
  }
})

vi.mock("../../orchestration-queue.js", () => {
  // A Redis that is down: BullMQ keeps the command and never answers.
  const never = () => new Promise<never>(() => {})
  return {
    orchestrationQueue: {
      getJob: (id: string) => {
        mocks.lookedUp.push(id)
        if (mocks.queueHangs.has(id)) return never()
        if (mocks.queueRejects.has(id)) return Promise.reject(new Error("Connection is closed."))
        const state = mocks.queueState.get(id)
        const getState = () => (mocks.stateHangs.has(id) ? never() : Promise.resolve(state))
        return Promise.resolve(state ? { id, getState } : null)
      },
    },
  }
})

vi.mock("../../concurrency-lanes/execution-wait.js", () => ({
  executionQueuedMs: async (id: string, _owner: string, opts: Record<string, unknown> = {}) => {
    mocks.waitOpts.push(opts)
    return mocks.waitedMs.get(id) ?? 0
  },
}))

vi.mock("../../concurrency-lanes/run-failure.js", () => ({
  failWaitingExecution: async (id: string, message: string) => {
    if (mocks.failThrows.has(id)) throw new Error("terminal write failed after its retries")
    if (mocks.failLoses.has(id)) return false
    mocks.failed.push({ id, message })
    return true
  },
}))

import { NEVER_STARTED_MESSAGE, sweepNeverStartedExecutions } from "../never-started-executions.js"
import { STALE_EXECUTION_THRESHOLD_MS } from "../../job-budget.js"
import { BULL_CALL_TIMEOUT_MS } from "../../bull-call-timeout.js"

const NOW = Date.parse("2026-11-12T12:00:00.000Z")
const HOUR = 60 * 60 * 1000
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString()

const pending = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  user_id: "owner-1",
  status: "pending",
  started_at: null,
  created_at: hoursAgo(5),
  runtime_env: "production",
  ...over,
})

const ENV_KEYS = ["RUNTIME_ENV", "RAILWAY_ENVIRONMENT_NAME"] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  mocks.rows = []
  mocks.filters = []
  mocks.queueState.clear()
  mocks.queueRejects.clear()
  mocks.queueHangs.clear()
  mocks.stateHangs.clear()
  mocks.lookedUp = []
  mocks.waitedMs.clear()
  mocks.waitOpts = []
  mocks.failed = []
  mocks.failThrows.clear()
  mocks.failLoses.clear()
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.RUNTIME_ENV = "production"
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("sweepNeverStartedExecutions — a run that never started stops blocking its workflow", () => {
  it("fails a run created more than 4 hours ago that no worker ever claimed and no queue holds", async () => {
    mocks.rows = [pending("e1")]

    const settled = await sweepNeverStartedExecutions(NOW)

    expect(settled).toBe(1)
    expect(mocks.failed).toEqual([{ id: "e1", message: NEVER_STARTED_MESSAGE }])
  })

  it("logs each run it fails with the run's id and the install that judged it, and nothing for a run it leaves", async () => {
    mocks.rows = [pending("e1"), pending("held")]
    mocks.queueState.set("held", "waiting")

    await sweepNeverStartedExecutions(NOW)

    const lines = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]))
    const perRow = lines.filter((l) => l.includes("failed execution"))
    expect(perRow).toHaveLength(1)
    expect(perRow[0]).toContain("[reconcile/never-started] production/")
    expect(perRow[0]).toContain("execution e1")
    expect(lines.some((l) => l.includes("held"))).toBe(false)
  })

  it("scans only never-claimed pending rows older than the stale-run backstop", async () => {
    await sweepNeverStartedExecutions(NOW)

    expect(mocks.filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "pending"],
        ["is", "started_at", null],
        ["lt", "created_at", new Date(NOW - STALE_EXECUTION_THRESHOLD_MS).toISOString()],
      ]),
    )
  })

  it("leaves younger runs, claimed runs and finished runs alone", async () => {
    mocks.rows = [
      pending("young", { created_at: hoursAgo(3) }),
      pending("claimed", { started_at: hoursAgo(5) }),
      pending("running", { status: "running", started_at: hoursAgo(5) }),
      pending("done", { status: "completed" }),
    ]

    expect(await sweepNeverStartedExecutions(NOW)).toBe(0)
    expect(mocks.failed).toEqual([])
  })

  it.each(["waiting", "delayed", "active", "prioritized"])("leaves a run whose job this queue still holds (%s): it will start", async (state) => {
    mocks.rows = [pending("e1")]
    mocks.queueState.set("e1", state)

    expect(await sweepNeverStartedExecutions(NOW)).toBe(0)
    expect(mocks.failed).toEqual([])
  })

  it.each(["completed", "failed"])("a job the queue has already finished (%s) is no sign the run will start", async (state) => {
    mocks.rows = [pending("e1")]
    mocks.queueState.set("e1", state)

    expect(await sweepNeverStartedExecutions(NOW)).toBe(1)
    expect(mocks.failed.map((f) => f.id)).toEqual(["e1"])
  })

  it("a run parked for its run slot for 5 hours is untouched: waiting never counts against it", async () => {
    mocks.rows = [pending("parked", { created_at: hoursAgo(5) })]
    mocks.waitedMs.set("parked", 5 * HOUR)

    expect(await sweepNeverStartedExecutions(NOW)).toBe(0)
    expect(mocks.failed).toEqual([])
    expect(mocks.waitOpts).toEqual([expect.objectContaining({ includeOwnWait: true, nowMs: NOW })])
  })

  it("a run that waited an hour for its slot and then stuck is failed once 4 hours past that wait have gone", async () => {
    mocks.rows = [pending("e1", { created_at: hoursAgo(5.5) })]
    mocks.waitedMs.set("e1", 1 * HOUR)

    expect(await sweepNeverStartedExecutions(NOW)).toBe(1)
  })

  it("does not count a run a worker claimed between the scan and the write (the compare-and-set lost)", async () => {
    mocks.rows = [pending("e1")]
    mocks.failLoses.add("e1")

    expect(await sweepNeverStartedExecutions(NOW)).toBe(0)
  })

  it("one row whose write fails does not stop the rest of the batch", async () => {
    mocks.rows = [pending("bad", { created_at: hoursAgo(6) }), pending("good")]
    mocks.failThrows.add("bad")

    expect(await sweepNeverStartedExecutions(NOW)).toBe(1)
    expect(mocks.failed.map((f) => f.id)).toEqual(["good"])
  })

  it("a queue lookup that fails is no sign the job is gone: that run is left, and the batch goes on", async () => {
    mocks.rows = [pending("flaky", { created_at: hoursAgo(6) }), pending("gone")]
    mocks.queueRejects.add("flaky")

    expect(await sweepNeverStartedExecutions(NOW)).toBe(1)
    expect(mocks.failed.map((f) => f.id)).toEqual(["gone"])
  })

  it.each([
    ["finding the job", "queueHangs"],
    ["reading the job's state", "stateHangs"],
  ] as const)("a queue that does not answer (%s) ends the pass: no run is judged until it does", async (_step, hang) => {
    vi.useFakeTimers()
    mocks.rows = [pending("first", { created_at: hoursAgo(6) }), pending("second")]
    mocks.queueState.set("first", "waiting")
    mocks[hang].add("first")

    const pass = sweepNeverStartedExecutions(NOW)
    await vi.advanceTimersByTimeAsync(BULL_CALL_TIMEOUT_MS)

    expect(await pass).toBe(0)
    expect(mocks.failed).toEqual([])
    expect(mocks.lookedUp).toEqual(["first"])
  })

  it("production sweeps its own runs and unstamped (older) rows, never another install's", async () => {
    mocks.rows = [
      pending("own", { runtime_env: "production" }),
      pending("unstamped", { runtime_env: null }),
      pending("staging", { runtime_env: "staging" }),
    ]

    await sweepNeverStartedExecutions(NOW)

    expect(mocks.failed.map((f) => f.id).sort()).toEqual(["own", "unstamped"])
  })

  it("any other install sweeps only the runs it created", async () => {
    process.env.RUNTIME_ENV = "staging"
    mocks.rows = [
      pending("own", { runtime_env: "staging" }),
      pending("unstamped", { runtime_env: null }),
      pending("production", { runtime_env: "production" }),
    ]

    await sweepNeverStartedExecutions(NOW)

    expect(mocks.failed.map((f) => f.id)).toEqual(["own"])
  })
})
