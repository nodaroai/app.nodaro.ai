/**
 * `tk.triggers` — a daemon names a trigger row; the host re-reads it and runs
 * every fire-time gate the built-in lanes run, plus the ones a message lane
 * needs (the account link, an orphaned node, rate and runs in flight).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  triggerRow: null as Record<string, unknown> | null,
  listRows: [] as Record<string, unknown>[],
  accountOwned: true,
  nodeOnGraph: true,
  inFlight: 0,
  rateCount: 1,
  insertResult: { data: { id: "exec-1" }, error: null } as { data: unknown; error: unknown },
  inserted: [] as Record<string, unknown>[],
  triggerUpdates: [] as Record<string, unknown>[],
  queued: [] as unknown[][],
  canRun: true,
  degraded: false,
  refusals: [] as unknown[],
  triggerEqs: [] as [string, unknown][],
}))

vi.mock("../supabase.js", () => {
  const chain = (onThen: () => unknown, onMaybe?: () => unknown, record?: (col: string, val: unknown) => void) => {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "in", "contains"]) c[m] = () => c
    c.eq = (col: string, val: unknown) => {
      record?.(col, val)
      return c
    }
    c.maybeSingle = async () => onMaybe?.()
    c.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      try {
        resolve(onThen())
      } catch (e) {
        reject?.(e)
      }
    }
    return c
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === "workflow_triggers") {
          const c = chain(
            () => ({ data: state.listRows, error: null }),
            () => ({ data: state.triggerRow, error: null }),
            (col, val) => state.triggerEqs.push([col, val]),
          )
          c.update = (patch: Record<string, unknown>) => {
            state.triggerUpdates.push(patch)
            return chain(() => ({ data: null, error: null }))
          }
          return c
        }
        if (table === "plugin_account_secrets") {
          return chain(() => null, () => ({ data: state.accountOwned ? { id: "acc-1" } : null, error: null }))
        }
        if (table === "workflows") {
          return chain(() => null, () => ({ data: state.nodeOnGraph ? { id: "wf-row" } : null, error: null }))
        }
        // workflow_executions: the in-flight count, or the insert
        const c = chain(() => ({ count: state.inFlight, error: null }))
        c.insert = (row: Record<string, unknown>) => {
          state.inserted.push(row)
          return { select: () => ({ single: async () => state.insertResult }) }
        }
        return c
      },
    },
  }
})
vi.mock("../queue.js", () => ({
  redis: { incr: async () => state.rateCount, expire: async () => 1 },
}))
vi.mock("../runtime-env.js", () => ({ getRuntimeEnv: () => "test" }))
vi.mock("../workflow-access.js", () => ({ canRunWorkflow: async () => state.canRun }))
vi.mock("../trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: async (args: unknown) => {
    state.refusals.push(args)
  },
}))
vi.mock("../billing-context.js", () => ({
  resolveBillingContext: async () => ({ payer: "owner" }),
  shouldRefuseDegradedRunFor: async () => state.degraded,
}))
vi.mock("../insert-job.js", () => ({ billingPairColumns: () => ({ billing_payer: "owner" }) }))
vi.mock("../orchestration-queue.js", () => ({
  orchestrationQueue: {
    add: async (...args: unknown[]) => {
      state.queued.push(args)
    },
  },
}))

import {
  firePluginTrigger,
  listActivePluginTriggers,
  MAX_TRIGGER_DATA_BYTES,
  MAX_TRIGGER_RUNS_IN_FLIGHT,
  TRIGGER_FIRES_PER_MINUTE,
} from "../plugin-triggers.js"

const ROW = {
  id: "trig-1",
  workflow_id: "wf-row",
  user_id: "user-row",
  type: "telegram_account",
  is_active: true,
  config: { nodeId: "node-7", accountId: "acc-1" },
}
const FIRE = {
  triggerId: "trig-1",
  accountId: "acc-1",
  triggerData: { text: "hello", chatId: "-1001" },
  idempotencyKey: "trig-1:-1001:42",
}

beforeEach(() => {
  state.triggerRow = { ...ROW }
  state.listRows = []
  state.accountOwned = true
  state.nodeOnGraph = true
  state.inFlight = 0
  state.rateCount = 1
  state.insertResult = { data: { id: "exec-1" }, error: null }
  state.inserted = []
  state.triggerUpdates = []
  state.queued = []
  state.canRun = true
  state.degraded = false
  state.refusals = []
  state.triggerEqs = []
})

describe("firePluginTrigger", () => {
  it("fires the ROW's workflow for the ROW's owner, lane-namespaced and branch-scoped", async () => {
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: true, executionId: "exec-1" })
    expect(state.inserted[0]).toMatchObject({
      workflow_id: "wf-row",
      user_id: "user-row",
      status: "pending",
      trigger_type: "telegram_account",
      trigger_data: FIRE.triggerData,
      idempotency_key: "telegram_account:trig-1:-1001:42",
      billing_payer: "owner",
    })
    const [name, job, opts] = state.queued[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(name).toBe("workflow-execution")
    expect(job).toMatchObject({ executionId: "exec-1", workflowId: "wf-row", userId: "user-row", triggerType: "telegram_account", triggerNodeId: "node-7" })
    expect(opts).toEqual({ jobId: "exec-1" })
    expect(state.triggerUpdates).toEqual([{ last_triggered_at: expect.any(String) }])
  })

  it.each([
    ["a missing row", null],
    ["a paused row", { ...ROW, is_active: false }],
    ["a built-in lane's row", { ...ROW, type: "webhook" }],
    ["a row that now names another account", { ...ROW, config: { ...ROW.config, accountId: "acc-2" } }],
  ])("%s starts nothing", async (_label, row) => {
    state.triggerRow = row
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "inactive" })
    expect(state.inserted).toHaveLength(0)
    expect(state.queued).toHaveLength(0)
  })

  it("an account that is not the row owner's starts nothing", async () => {
    state.accountOwned = false
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "inactive" })
    expect(state.inserted).toHaveLength(0)
  })

  it("an orphaned row (its node left the graph) is switched off instead of running the whole workflow", async () => {
    state.nodeOnGraph = false
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "inactive" })
    expect(state.triggerUpdates).toEqual([{ is_active: false }])
    expect(state.inserted).toHaveLength(0)
  })

  it("is throttled past its per-minute rate, and with too many runs already in flight", async () => {
    state.rateCount = TRIGGER_FIRES_PER_MINUTE + 1
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "throttled" })
    state.rateCount = 1
    state.inFlight = MAX_TRIGGER_RUNS_IN_FLIGHT
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "throttled" })
    expect(state.inserted).toHaveLength(0)
  })

  it("an owner who lost access gets one visible refusal and no run", async () => {
    state.canRun = false
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "refused" })
    expect(state.refusals).toEqual([{ workflowId: "wf-row", userId: "user-row", triggerType: "telegram_account", triggerId: "trig-1" }])
    expect(state.inserted).toHaveLength(0)
  })

  it("a degraded payer resolve refuses rather than bills", async () => {
    state.degraded = true
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "degraded" })
    expect(state.inserted).toHaveLength(0)
  })

  it("a redelivered event is a duplicate, not a second run", async () => {
    state.insertResult = { data: null, error: { code: "23505", message: "duplicate key" } }
    expect(await firePluginTrigger(FIRE)).toEqual({ fired: false, reason: "duplicate" })
    expect(state.queued).toHaveLength(0)
  })

  it("any other insert failure throws instead of pretending", async () => {
    state.insertResult = { data: null, error: { code: "XX000", message: "boom" } }
    await expect(firePluginTrigger(FIRE)).rejects.toThrow(/insert failed/)
  })

  it("refuses malformed input before touching the database", async () => {
    await expect(firePluginTrigger({ ...FIRE, idempotencyKey: "" })).rejects.toThrow(/idempotencyKey/)
    await expect(firePluginTrigger({ ...FIRE, triggerId: " " })).rejects.toThrow(/triggerId/)
    await expect(firePluginTrigger({ ...FIRE, accountId: "" })).rejects.toThrow(/accountId/)
    const huge = { text: "x".repeat(MAX_TRIGGER_DATA_BYTES + 1) }
    await expect(firePluginTrigger({ ...FIRE, triggerData: huge })).rejects.toThrow(/exceeds/)
    expect(state.triggerEqs).toHaveLength(0)
  })
})

describe("listActivePluginTriggers", () => {
  it("reads the lane's active rows and lifts the node id out of the config", async () => {
    state.listRows = [
      { id: "t1", workflow_id: "w1", user_id: "u1", config: { nodeId: "n1", accountId: "a" } },
      { id: "t2", workflow_id: "w2", user_id: "u2", config: {} },
    ]
    expect(await listActivePluginTriggers({ type: "telegram_account" })).toEqual([
      { id: "t1", workflowId: "w1", userId: "u1", nodeId: "n1", config: { nodeId: "n1", accountId: "a" } },
      { id: "t2", workflowId: "w2", userId: "u2", nodeId: null, config: {} },
    ])
    expect(state.triggerEqs).toEqual([
      ["type", "telegram_account"],
      ["is_active", true],
    ])
  })

  it("refuses a lane that is not a plugin lane", async () => {
    await expect(listActivePluginTriggers({ type: "webhook" as never })).rejects.toThrow(/not a plugin trigger lane/)
  })
})
