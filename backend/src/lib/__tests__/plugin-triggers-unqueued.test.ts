/**
 * A plugin daemon's trigger fire (lib/plugin-triggers.ts) when the queue
 * refuses the run it wrote. The run row carries the event's lane-namespaced
 * idempotency key, so a run left `pending` would hold it, and the daemon's
 * redelivery of the same event would be answered `duplicate` and lost. So
 * the refused run is failed from `pending` with its key released (the
 * executions twin, lib/enqueue-execution.ts `enqueueRunOrThrow`) and the
 * fire rejects; the same event offered again then fires a new run. A run a
 * worker claimed meanwhile is running: answered as fired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ExecRow {
  id: string
  user_id: string
  status: string
  idempotency_key: string | null
  error_message?: string
}

const m = vi.hoisted(() => ({
  rows: [] as ExecRow[],
  nextId: 1,
  queueAdd: vi.fn(),
  triggerUpdates: [] as Record<string, unknown>[],
  /** Before the failure write runs: what moves the row on meanwhile (a worker's claim). */
  beforeFailWrite: null as null | ((row: ExecRow) => void),
  failWriteThrows: false,
  insertAppReport: vi.fn(),
  /** The redis counters the fire's offers and rate are kept in. */
  counters: new Map<string, number>(),
}))

// The run's own failure path, over the rows below: a CAS from `pending` with the extra columns in the same write.
vi.mock("@/lib/concurrency-lanes/run-failure.js", () => ({
  failWaitingExecutionDetailed: vi.fn(async (id: string, message: string, extra: Record<string, unknown>) => {
    if (m.failWriteThrows) throw new Error("write failed")
    const row = m.rows.find((r) => r.id === id)!
    m.beforeFailWrite?.(row)
    if (row.status !== "pending") return { failed: false, attempts: 1 }
    Object.assign(row, extra, { status: "failed", error_message: message })
    return { failed: true, attempts: 1 }
  }),
}))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { emit: vi.fn() } }))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: vi.fn() }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: m.queueAdd } }))
// A counter store that keeps its counts (the fire's rate is a count taken before the run is written).
vi.mock("@/lib/queue.js", () => ({
  redis: {
    get: async (k: string) => (m.counters.has(k) ? String(m.counters.get(k)) : null),
    incr: async (k: string) => {
      m.counters.set(k, (m.counters.get(k) ?? 0) + 1)
      return m.counters.get(k)!
    },
    decr: async (k: string) => {
      m.counters.set(k, (m.counters.get(k) ?? 0) - 1)
      return m.counters.get(k)!
    },
    expire: async () => 1,
  },
}))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "test" }))
vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: async () => true }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({ recordTriggerFireRefusal: async () => undefined }))
vi.mock("@/lib/preview-fire-refusal.js", () => ({ refusePreviewFire: async () => false }))
vi.mock("@/lib/llm-unpriced-fire-refusal.js", () => ({ refuseUnpricedFire: async () => false }))
vi.mock("@/lib/billing-context.js", () => ({
  resolveBillingContext: async () => ({ payer: "owner" }),
  shouldRefuseDegradedRunFor: async () => false,
}))
vi.mock("@/lib/insert-job.js", () => ({ billingPairColumns: () => ({}) }))

vi.mock("@/lib/supabase.js", () => {
  /** A query that answers `result` however it is narrowed, awaited or read as one row. */
  function query(result: () => unknown): Record<string, unknown> {
    const q: Record<string, unknown> = {}
    for (const k of ["select", "eq", "in", "contains"]) q[k] = () => q
    q.maybeSingle = async () => result()
    q.then = (resolve: (v: unknown) => void) => resolve(result())
    return q
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === "workflow_triggers") {
          const q = query(() => ({
            data: { id: "trig-1", workflow_id: "wf-1", user_id: "user-1", type: "telegram_account", is_active: true, config: { nodeId: "node-7", accountId: "acc-1" } },
            error: null,
          }))
          q.update = (patch: Record<string, unknown>) => {
            m.triggerUpdates.push(patch)
            return query(() => ({ data: null, error: null }))
          }
          return q
        }
        if (table === "plugin_account_secrets") return query(() => ({ data: { id: "acc-1" }, error: null }))
        if (table === "workflows") return query(() => ({ data: { id: "wf-1" }, error: null }))
        // workflow_executions: the runs-in-flight count, or the insert under the unique (user_id, idempotency_key).
        const q = query(() => ({ count: m.rows.filter((r) => r.status === "pending" || r.status === "running").length, error: null }))
        q.insert = (row: { user_id: string; idempotency_key: string }) => ({
          select: () => ({
            single: async () => {
              if (m.rows.some((r) => r.user_id === row.user_id && r.idempotency_key === row.idempotency_key)) {
                return { data: null, error: { code: "23505", message: "duplicate key" } }
              }
              const id = `exec-${m.nextId++}`
              m.rows.push({ id, user_id: row.user_id, status: "pending", idempotency_key: row.idempotency_key })
              return { data: { id }, error: null }
            },
          }),
        })
        return q
      },
    },
  }
})

import { firePluginTrigger } from "../plugin-triggers.js"
import { UnqueuedRunError, UNQUEUED_EXECUTION_MESSAGE, UNQUEUED_EXECUTION_UNSETTLED_KIND } from "../enqueue-execution.js"

const FIRE = { triggerId: "trig-1", accountId: "acc-1", triggerData: { text: "hello" }, idempotencyKey: "trig-1:-1001:42" }
const STORE_OOM = "OOM command not allowed when used memory > 'maxmemory'."

/** The fire's answer, or what it rejected with. */
const fire = () => firePluginTrigger(FIRE).then((r) => r, (e: unknown) => e)

beforeEach(() => {
  m.rows = []
  m.nextId = 1
  m.queueAdd.mockReset().mockResolvedValue({})
  m.triggerUpdates = []
  m.beforeFailWrite = null
  m.failWriteThrows = false
  m.insertAppReport.mockReset().mockResolvedValue(undefined)
  m.counters.clear()
})

/** The counts kept this minute: [offers, fire rate]. */
const counts = (): [number, number] => {
  const of = (prefix: string) => [...m.counters].filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0)
  return [of("plugin:trigger-offers:"), of("plugin:trigger-rate:")]
}

describe("firePluginTrigger — a run the queue refuses", () => {
  it("is failed from `pending` with its key released, and the fire rejects with the queue's error as its cause", async () => {
    const refused = new Error(STORE_OOM)
    m.queueAdd.mockRejectedValueOnce(refused)
    const err = await fire()
    expect(err).toBeInstanceOf(UnqueuedRunError)
    expect(err).toMatchObject({ executionId: "exec-1", outcome: "failed" })
    expect((err as Error).cause).toBe(refused)
    expect(m.rows).toEqual([{ id: "exec-1", user_id: "user-1", status: "failed", idempotency_key: null, error_message: UNQUEUED_EXECUTION_MESSAGE }])
    // Nothing fired: the trigger's "last fired" stays as it was.
    expect(m.triggerUpdates).toEqual([])
  })

  it("the same event offered again fires a new run instead of being answered `duplicate`", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error(STORE_OOM))
    expect(await fire()).toBeInstanceOf(UnqueuedRunError)
    expect(await fire()).toEqual({ fired: true, executionId: "exec-2" })
    expect(m.rows.map((r) => [r.id, r.status, r.idempotency_key])).toEqual([
      ["exec-1", "failed", null],
      ["exec-2", "pending", "telegram_account:trig-1:-1001:42"],
    ])
    // Once a run holds the key, a third offer is the duplicate it always was.
    expect(await fire()).toEqual({ fired: false, reason: "duplicate" })
  })

  it("a run the queue refused and failed does not spend the minute's fire rate; the offer still counts", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error(STORE_OOM))
    expect(await fire()).toBeInstanceOf(UnqueuedRunError)
    expect(counts()).toEqual([1, 0])
    // A fire that started a run spends one.
    expect(await fire()).toEqual({ fired: true, executionId: "exec-2" })
    expect(counts()).toEqual([2, 1])
  })

  it("a run whose state is unknown (it may be running) keeps its count of the rate", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error(STORE_OOM))
    m.failWriteThrows = true
    expect(await fire()).toMatchObject({ outcome: "unsettled" })
    expect(counts()).toEqual([1, 1])
  })

  it("a run a worker claimed meanwhile (a closed connection delivered it) is answered as fired and never written", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    m.beforeFailWrite = (row) => {
      row.status = "running"
    }
    expect(await fire()).toEqual({ fired: true, executionId: "exec-1" })
    expect(m.rows[0]).toMatchObject({ status: "running", idempotency_key: "telegram_account:trig-1:-1001:42" })
    expect(m.triggerUpdates).toEqual([{ last_triggered_at: expect.any(String) }])
  })

  it("a failure write that fails leaves the outcome unknown: the fire rejects and the run is filed as an app report", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error(STORE_OOM))
    m.failWriteThrows = true
    const err = await fire()
    expect(err).toBeInstanceOf(UnqueuedRunError)
    expect(err).toMatchObject({ executionId: "exec-1", outcome: "unsettled" })
    expect(m.insertAppReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: UNQUEUED_EXECUTION_UNSETTLED_KIND, executionId: "exec-1", userId: "user-1" }),
    )
  })
})
