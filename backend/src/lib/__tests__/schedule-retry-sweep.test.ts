// The schedule retry sweep (lib/schedule-retry-sweep.ts) against a fake
// database: a due failure becomes a retry row + an orchestrator job created
// exactly as the cron creates a fire; the per-trigger claim (the row's
// `last_triggered_at` CAS, applied for real by the fake) serializes a fire
// and a retry of one trigger; the deterministic key is the second line two
// sweeps race on (one row, one job); the policy's `cheapLanesOnly` rides the
// job; and the rows the decision steps over (another trigger's runs, a
// refusal tombstone) never hide a failure.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { db, mockQueueAdd } = vi.hoisted(() => ({
  db: {
    triggers: [] as Array<Record<string, unknown>>,
    /** `workflow_executions`, newest LAST (the fake orders by created_at desc). */
    executions: [] as Array<Record<string, unknown>>,
    active: false,
    /** Scripted answers to the next active-run reads (a sibling appearing mid-way); `active` once used up. */
    activeAnswers: [] as boolean[],
    /** The stored graph's node ids (the orphan check reads them). */
    graphNodeIds: ["sched-node"] as string[],
    insertAttempts: [] as Array<Record<string, unknown>>,
    executionKeys: new Set<string>(),
    selects: [] as Array<{ table: string; columns: string; filters: Array<[string, string, unknown]> }>,
    triggerUpdates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }>,
  },
  mockQueueAdd: vi.fn(async () => ({})),
}))

vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: vi.fn(async () => true) }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: vi.fn(async () => undefined),
  RUN_REQUIRES_AUTHENTICATED_MEMBER: "run_requires_authenticated_member",
}))
vi.mock("@/lib/preview-fire-refusal.js", () => ({ refusePreviewFire: vi.fn(async () => false) }))
vi.mock("@/lib/billing-context.js", () => ({
  resolveBillingContext: vi.fn(async (input: { userId: string }) => ({ payer: "user", userId: input.userId })),
  shouldRefuseDegradedRunFor: vi.fn(async () => false),
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mockQueueAdd } }))

function query(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let op: "select" | "insert" | "update" | "delete" = "select"
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
    if (op === "select") db.selects.push({ table, columns, filters: [...filters] })
    if (table === "workflow_triggers") {
      if (op === "update") {
        // The claim, applied for real: the row moves only when every filter still matches.
        db.triggerUpdates.push({ patch, filters: [...filters] })
        const hit = db.triggers.filter(matches)
        db.triggers = db.triggers.map((row) => (hit.includes(row) ? { ...row, ...patch } : row))
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (op === "delete") {
        db.triggers = db.triggers.filter((row) => !matches(row))
        return { data: null, error: null }
      }
      if (columns === "owner_initiated") return { data: { owner_initiated: false }, error: null }
      return { data: db.triggers.filter(matches), error: null }
    }
    if (table === "workflow_executions") {
      if (filters.some(([kind, col]) => kind === "in" && col === "status")) {
        const active = db.activeAnswers.length > 0 ? db.activeAnswers.shift()! : db.active
        return { data: active ? [{ id: "running-1" }] : [], error: null }
      }
      return { data: [...db.executions].reverse().filter(matches), error: null }
    }
    if (table === "workflows") return { data: { nodes: db.graphNodeIds.map((id) => ({ id, type: "schedule-trigger" })) }, error: null }
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
    is(col: string, value: unknown) {
      filters.push(["is", col, value])
      return builder
    },
    insert(row: Record<string, unknown>) {
      op = "insert"
      db.insertAttempts.push(row)
      return {
        select: () => ({
          single: async () => {
            const key = `${String(row.user_id)}|${String(row.idempotency_key)}`
            if (db.executionKeys.has(key)) {
              return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
            }
            db.executionKeys.add(key)
            const id = `exec-new-${db.executionKeys.size}`
            db.executions.push({ ...row, id, created_at: new Date().toISOString() })
            return { data: { id }, error: null }
          },
        }),
      }
    },
    eq(col: string, value: unknown) {
      filters.push(["eq", col, value])
      return builder
    },
    in(col: string, value: unknown[]) {
      filters.push(["in", col, value])
      return builder
    },
    order() {
      return builder
    },
    limit() {
      return builder
    },
    maybeSingle: () => run(),
    single: () => run(),
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return run().then(resolve, reject)
    },
  }
  return builder
}

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn((table: string) => query(table)) } }))

import { sweepScheduleRetries } from "../schedule-retry-sweep.js"
import { checkScheduledTriggers } from "../schedule-cron.js"
import type { ScheduleTriggerRow } from "../schedule-fire.js"

const NOW = new Date("2026-10-20T12:00:00.000Z")
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()
const RETRY = { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true }
const PREVIOUS_FIRE = "2026-10-20T09:00:00.000Z"
/** The failed fire's own time — what the row's `last_triggered_at` holds since. */
const FAILED_FIRE_AT = minutesAgo(50)

const trigger = (over: Record<string, unknown> = {}) => ({
  id: "trig-1",
  workflow_id: "wf-1",
  user_id: "owner-1",
  type: "schedule",
  is_active: true,
  last_triggered_at: FAILED_FIRE_AT,
  config: { rules: [{ id: "r1", kind: "hours", every: 2, minute: 0 }], nodeId: "sched-node", retry: RETRY, ...over },
})

/** The list the cron's check hands the sweep: the active schedules as it read them. */
const listed = (): ScheduleTriggerRow[] =>
  db.triggers.map((t) => ({
    id: t.id as string,
    workflow_id: t.workflow_id as string,
    user_id: t.user_id as string,
    config: t.config as Record<string, unknown>,
    last_triggered_at: (t.last_triggered_at as string | null) ?? null,
  }))

/** The sweep as the cron runs it: on the list the check just read. */
const sweep = (now: Date = NOW, rows: ScheduleTriggerRow[] = listed()) => sweepScheduleRetries(now, rows)

const failedFire = (over: Record<string, unknown> = {}) => ({
  id: "exec-0",
  workflow_id: "wf-1",
  user_id: "owner-1",
  status: "failed",
  trigger_type: "schedule",
  idempotency_key: "schedule:trig-1:" + PREVIOUS_FIRE,
  trigger_data: { timestamp: minutesAgo(50), rules: [], last_triggered_at: PREVIOUS_FIRE },
  completed_at: minutesAgo(45),
  updated_at: minutesAgo(45),
  created_at: minutesAgo(50),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.triggers = []
  db.executions = []
  db.active = false
  db.activeAnswers = []
  db.graphNodeIds = ["sched-node"]
  db.insertAttempts = []
  db.executionKeys = new Set()
  db.selects = []
  db.triggerUpdates = []
})

describe("sweepScheduleRetries — a due failure is run again, the way the cron fires", () => {
  it("creates the retry row and the orchestrator job: the schedule lane, the deterministic key, the chain stamp, the failed run's previous-fire time, cheap lanes only", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]

    await sweep()

    expect(db.insertAttempts).toHaveLength(1)
    const row = db.insertAttempts[0]!
    expect(row).toMatchObject({
      workflow_id: "wf-1",
      user_id: "owner-1",
      status: "pending",
      trigger_type: "schedule",
      idempotency_key: "retry:exec-0:1",
    })
    expect(row.trigger_data).toEqual({
      timestamp: NOW.toISOString(),
      cron: undefined,
      rules: [{ id: "r1", kind: "hours", every: 2, minute: 0 }],
      last_triggered_at: PREVIOUS_FIRE,
      retry: { triggerId: "trig-1", chainRoot: "exec-0", retryOf: "exec-0", attempt: 1, maxAttempts: 3 },
    })
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const [name, jobData, opts] = mockQueueAdd.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
    expect(name).toBe("workflow-execution")
    expect(opts).toEqual({ jobId: "exec-new-1" })
    expect(jobData).toMatchObject({
      executionId: "exec-new-1",
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "schedule",
      triggerNodeId: "sched-node",
      triggerData: { timestamp: NOW.toISOString(), last_triggered_at: PREVIOUS_FIRE },
      reviewerPresent: false,
      cheapLanesOnly: true,
    })
  })

  it("the policy's cheapLanesOnly off: the job carries no flag", async () => {
    db.triggers = [trigger({ retry: { ...RETRY, cheapLanesOnly: false } })]
    db.executions = [failedFire()]
    await sweep()
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect((mockQueueAdd.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).not.toHaveProperty("cheapLanesOnly")
  })

  it("two sweeps that read the same failure (two replicas) create ONE retry: the per-trigger claim lets one through, the loser never inserts or enqueues", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]

    await Promise.all([sweep(), sweep()])

    expect(db.insertAttempts).toHaveLength(1)
    expect(db.executionKeys.size).toBe(1)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    // The claim moved the row from the value both sweeps read to now.
    expect(db.triggers[0]!.last_triggered_at).toBe(NOW.toISOString())
    const claim = db.triggerUpdates.find((u) => "last_triggered_at" in u.patch)
    expect(claim?.filters).toEqual([["eq", "id", "trig-1"], ["eq", "last_triggered_at", FAILED_FIRE_AT]])
  })

  it("the retry's key is the second line: a retry of the same attempt that somehow exists is a duplicate — nothing enqueued, the claim kept", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    db.executionKeys.add("owner-1|retry:exec-0:1")
    await sweep()
    expect(db.insertAttempts).toHaveLength(1)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.triggers[0]!.last_triggered_at).toBe(NOW.toISOString())
  })

  it("a fire and a retry of the same trigger on the same tick never both insert — they serialize on the trigger's claim", async () => {
    // 12:00 matches the "every 2 hours at :00" rule, and the fire 50 minutes
    // ago failed 45 minutes ago: the check wants to fire, the sweep wants to retry.
    db.triggers = [trigger()]
    db.executions = [failedFire()]

    const check = checkScheduledTriggers(NOW)
    await Promise.all([check, sweep()])

    expect(db.insertAttempts).toHaveLength(1)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(db.triggers[0]!.last_triggered_at).toBe(NOW.toISOString())
  })

  it("a stale read (the row moved on since) claims nothing: no retry", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    const rows = listed()
    db.triggers = [{ ...trigger(), last_triggered_at: minutesAgo(1) }]
    await sweep(NOW, rows)
    expect(db.insertAttempts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.triggers[0]!.last_triggered_at).toBe(minutesAgo(1))
  })

  it("a sibling run that appears between the check and the claim: the claim is given back and nothing is written", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    db.activeAnswers = [false, true]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(db.triggers[0]!.last_triggered_at).toBe(FAILED_FIRE_AT)
    const release = db.triggerUpdates.at(-1)
    expect(release?.patch).toEqual({ last_triggered_at: FAILED_FIRE_AT })
    expect(release?.filters).toEqual([["eq", "id", "trig-1"], ["eq", "last_triggered_at", NOW.toISOString()]])
  })

  it("a schedule whose node left the graph (an orphan the cron will drop) is never retried", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    db.graphNodeIds = ["some-other-node"]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)
    expect(db.triggerUpdates).toHaveLength(0)
  })

  it("the cron hands the sweep only the schedules it kept: an orphan it dropped is not swept", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    db.graphNodeIds = []
    const kept = await checkScheduledTriggers(NOW)
    expect(kept).toEqual([])
    expect(db.triggers).toEqual([])
  })

  it("a sweep a minute later sees the retry it made (pending) as the trigger's latest run and does nothing", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    await sweep()
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)

    await sweep(new Date(NOW.getTime() + 60_000))
    expect(db.insertAttempts).toHaveLength(1)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("a failed retry is retried again with the next attempt, up to the cap", async () => {
    db.triggers = [trigger()]
    db.executions = [
      failedFire(),
      failedFire({
        id: "exec-1",
        idempotency_key: "retry:exec-0:1",
        trigger_data: { ...failedFire().trigger_data, retry: { triggerId: "trig-1", chainRoot: "exec-0", retryOf: "exec-0", attempt: 1, maxAttempts: 3 } },
        created_at: minutesAgo(40),
      }),
    ]
    await sweep()
    expect(db.insertAttempts[0]).toMatchObject({ idempotency_key: "retry:exec-0:2" })
    expect((db.insertAttempts[0]!.trigger_data as { retry: unknown }).retry).toEqual({ triggerId: "trig-1", chainRoot: "exec-0", retryOf: "exec-1", attempt: 2, maxAttempts: 3 })

    db.insertAttempts = []
    db.executions = [
      ...db.executions,
      failedFire({
        id: "exec-3",
        idempotency_key: "retry:exec-0:3",
        trigger_data: { ...failedFire().trigger_data, retry: { triggerId: "trig-1", chainRoot: "exec-0", retryOf: "exec-2", attempt: 3, maxAttempts: 3 } },
        created_at: minutesAgo(35),
      }),
    ]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)
  })

  it("a run of the workflow still pending or running: the retry waits", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    db.active = true
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("not yet due, cancelled, or a trigger with no policy: no retry — and no policy means no execution read at all", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire({ completed_at: minutesAgo(10), updated_at: minutesAgo(10) })]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)

    db.executions = [failedFire({ status: "cancelled" })]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)

    db.selects = []
    db.triggers = [trigger({ retry: undefined })]
    db.executions = [failedFire()]
    await sweep()
    expect(db.insertAttempts).toHaveLength(0)
    expect(db.selects.filter((s) => s.table === "workflow_executions")).toHaveLength(0)
  })

  it("a refusal tombstone and another schedule's newer run are stepped over — they never hide this trigger's failure", async () => {
    db.triggers = [trigger()]
    db.executions = [
      failedFire(),
      // The workflow's second schedule ran fine after the failure.
      failedFire({ id: "exec-other", status: "completed", idempotency_key: "schedule:trig-2:initial", created_at: minutesAgo(40) }),
      // A fire refused (the owner briefly lost access): a tombstone, no key.
      failedFire({ id: "exec-tomb", idempotency_key: null, trigger_data: { triggerId: "trig-1" }, created_at: minutesAgo(35) }),
    ]
    await sweep()
    expect(db.insertAttempts).toHaveLength(1)
    expect(db.insertAttempts[0]).toMatchObject({ idempotency_key: "retry:exec-0:1" })
  })

  it("the sweep reads the trigger list from the cron's check, never the table", async () => {
    db.triggers = [trigger()]
    db.executions = [failedFire()]
    await sweep()
    expect(db.selects.filter((s) => s.table === "workflow_triggers" && s.columns !== "owner_initiated")).toHaveLength(0)
    expect(db.insertAttempts).toHaveLength(1)
  })
})
