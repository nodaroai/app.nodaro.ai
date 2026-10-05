// A schedule tick fires only after it has CLAIMED the tick: an atomic
// conditional update that moves `last_triggered_at` from the value the tick
// read to now. Two processes that read the same row (two replicas, or two
// environments sharing one database) cannot both win it, so only one of them
// ever creates an execution.
//
// The fake database below keeps ONE server-side copy of the trigger row and
// applies the update's filters for real, so a claim whose `previous` no
// longer matches updates zero rows — exactly what PostgREST answers. It also
// enforces the (user_id, idempotency_key) unique constraint, so the tests pin
// that the loser of a race never even attempts the insert, rather than
// leaning on the constraint to reject it.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { db, mockQueueAdd } = vi.hoisted(() => ({
  db: {
    trigger: null as null | Record<string, unknown>,
    /** The list read's answer, frozen at the first read of a test (a stale snapshot). */
    listed: null as null | Record<string, unknown>,
    /** How many list reads must arrive before any of them answers (a barrier). */
    listBarrier: 1,
    listWaiters: [] as Array<() => void>,
    insertAttempts: [] as Array<Record<string, unknown>>,
    executionKeys: new Set<string>(),
    /** When set, the execution insert fails with this error. */
    insertError: null as null | { code?: string; message: string },
    triggerUpdates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }>,
  },
  mockQueueAdd: vi.fn(async () => ({})),
}))

vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: vi.fn(async () => true) }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: vi.fn(async () => undefined),
  RUN_REQUIRES_AUTHENTICATED_MEMBER: "run_requires_authenticated_member",
}))
vi.mock("@/lib/billing-context.js", () => ({
  resolveBillingContext: vi.fn(async (input: { userId: string }) => ({ payer: "user", userId: input.userId })),
  shouldRefuseDegradedRunFor: vi.fn(async () => false),
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mockQueueAdd } }))

/** A PostgREST-shaped builder over the fake: filters recorded, executed on await / single / maybeSingle. */
function query(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let op: "select" | "update" | "insert" | "delete" = "select"
  let columns = "*"
  let patch: Record<string, unknown> = {}
  let returning = false

  const matches = (row: Record<string, unknown>) =>
    filters.every(([kind, col, value]) => {
      if (kind === "eq") return row[col] === value
      if (kind === "is") return row[col] === value
      if (kind === "in") return (value as unknown[]).includes(row[col])
      return true
    })

  async function run(): Promise<{ data: unknown; error: unknown }> {
    if (table === "workflow_triggers") {
      if (op === "select" && columns === "owner_initiated") return { data: { owner_initiated: false }, error: null }
      if (op === "select") {
        if (db.listed === null) db.listed = { ...(db.trigger as Record<string, unknown>) }
        const snapshot = db.listed
        await new Promise<void>((resolve) => {
          db.listWaiters.push(resolve)
          if (db.listWaiters.length >= db.listBarrier) for (const wake of db.listWaiters.splice(0)) wake()
        })
        return { data: [{ ...snapshot }], error: null }
      }
      if (op === "update") {
        db.triggerUpdates.push({ patch, filters: [...filters] })
        const row = db.trigger as Record<string, unknown>
        if (!matches(row)) return { data: returning ? [] : null, error: null }
        db.trigger = { ...row, ...patch }
        return { data: returning ? [{ id: row.id }] : null, error: null }
      }
      return { data: null, error: null }
    }
    if (table === "workflow_executions") {
      if (op === "select") return { data: [], error: null }
      return { data: null, error: null }
    }
    if (table === "workflows") return { data: { nodes: [{ id: "sched-node", type: "schedule-trigger" }] }, error: null }
    return { data: null, error: null }
  }

  const builder: Record<string, unknown> = {
    select(cols?: string) {
      if (op === "select") columns = cols ?? "*"
      else returning = true
      return builder
    },
    update(p: Record<string, unknown>) {
      op = "update"
      patch = p
      return builder
    },
    delete() {
      op = "delete"
      return builder
    },
    insert(row: Record<string, unknown>) {
      db.insertAttempts.push(row)
      return {
        select: () => ({
          single: async () => {
            if (db.insertError) return { data: null, error: db.insertError }
            const key = `${String(row.user_id)}|${String(row.idempotency_key)}`
            if (db.executionKeys.has(key)) {
              return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
            }
            db.executionKeys.add(key)
            return { data: { id: `exec-${db.executionKeys.size}` }, error: null }
          },
        }),
      }
    },
    eq(col: string, value: unknown) {
      filters.push(["eq", col, value])
      return builder
    },
    is(col: string, value: unknown) {
      filters.push(["is", col, value])
      return builder
    },
    in(col: string, value: unknown[]) {
      filters.push(["in", col, value])
      return builder
    },
    limit() {
      return builder
    },
    order() {
      return builder
    },
    single: () => run(),
    maybeSingle: () => run(),
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return run().then(resolve, reject)
    },
  }
  return builder
}

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn((table: string) => query(table)) } }))

import { checkScheduledTriggers } from "../schedule-cron.js"

const PREVIOUS = "2026-10-05T09:00:00.000Z"
const NOW = new Date("2026-10-05T10:00:00.250Z")

function seed(lastTriggeredAt: string | null, config: Record<string, unknown> = { interval: "1m", nodeId: "sched-node" }) {
  db.trigger = {
    id: "trig-1",
    workflow_id: "wf-1",
    user_id: "owner-1",
    type: "schedule",
    is_active: true,
    config,
    last_triggered_at: lastTriggeredAt,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.trigger = null
  db.listed = null
  db.listBarrier = 1
  db.listWaiters = []
  db.insertAttempts = []
  db.executionKeys = new Set()
  db.insertError = null
  db.triggerUpdates = []
})

describe("checkScheduledTriggers — a tick fires only after it claims the tick", () => {
  it("two concurrent ticks that read the same row fire ONCE: the loser never inserts or enqueues", async () => {
    seed(PREVIOUS)
    db.listBarrier = 2 // both ticks have read the row before either acts on it

    await Promise.all([checkScheduledTriggers(NOW), checkScheduledTriggers(NOW)])

    expect(db.insertAttempts).toHaveLength(1)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(db.trigger?.last_triggered_at).toBe(NOW.toISOString())
  })

  it("the claim is a compare-and-swap from the value the tick READ, to now", async () => {
    seed(PREVIOUS)

    await checkScheduledTriggers(NOW)

    const claim = db.triggerUpdates.find((u) => "last_triggered_at" in u.patch)
    expect(claim?.patch).toEqual({ last_triggered_at: NOW.toISOString() })
    expect(claim?.filters).toEqual([
      ["eq", "id", "trig-1"],
      ["eq", "last_triggered_at", PREVIOUS],
    ])
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("a schedule that never fired claims through IS NULL", async () => {
    seed(null)

    await checkScheduledTriggers(NOW)

    const claim = db.triggerUpdates.find((u) => "last_triggered_at" in u.patch)
    expect(claim?.filters).toEqual([
      ["eq", "id", "trig-1"],
      ["is", "last_triggered_at", null],
    ])
    expect(db.trigger?.last_triggered_at).toBe(NOW.toISOString())
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("a row someone else fired after this tick read it: zero rows claimed, nothing fires", async () => {
    seed(PREVIOUS)
    // The list answers the stale snapshot; the server row has moved on.
    db.listed = { ...db.trigger }
    db.trigger = { ...db.trigger, last_triggered_at: "2026-10-05T10:00:00.100Z" }

    await checkScheduledTriggers(NOW)

    expect(db.insertAttempts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.trigger?.last_triggered_at).toBe("2026-10-05T10:00:00.100Z")
  })

  it("still counts the run once it fired (executionCount), without touching the claimed timestamp again", async () => {
    seed(PREVIOUS, { interval: "1m", nodeId: "sched-node", executionCount: 4 })

    await checkScheduledTriggers(NOW)

    expect((db.trigger?.config as Record<string, unknown>).executionCount).toBe(5)
    expect(db.trigger?.last_triggered_at).toBe(NOW.toISOString())
  })

  it("an execution insert that fails gives the claim back, so the next tick can retry", async () => {
    seed(PREVIOUS)
    db.insertError = { code: "08006", message: "connection failure" }

    await checkScheduledTriggers(NOW)

    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.trigger?.last_triggered_at).toBe(PREVIOUS)
    const release = db.triggerUpdates.at(-1)
    expect(release?.patch).toEqual({ last_triggered_at: PREVIOUS })
    // Released only if the row still carries THIS tick's claim.
    expect(release?.filters).toEqual([
      ["eq", "id", "trig-1"],
      ["eq", "last_triggered_at", NOW.toISOString()],
    ])
  })

  it("a duplicate idempotency key keeps the claim: that tick already ran, and the schedule moves on instead of colliding every minute", async () => {
    seed(PREVIOUS)
    db.executionKeys.add(`owner-1|schedule:trig-1:${PREVIOUS}`)

    await checkScheduledTriggers(NOW)

    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.trigger?.last_triggered_at).toBe(NOW.toISOString())
  })
})
