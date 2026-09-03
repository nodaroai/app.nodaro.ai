import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

interface JobRow {
  id: string
  status: string
  error_message: string | null
  workflow_execution_id?: string | null
  input_data?: Record<string, unknown> | null
}

interface ExecutionRow {
  id: string
  started_at: string | null
  node_states: Record<string, { status: string; jobId?: string; iterationTotal?: number }>
  /** Which environment claimed the row (migration 374). Absent = legacy NULL. */
  runtime_env?: string | null
}

const mocks = vi.hoisted(() => ({
  executions: [] as ExecutionRow[],
  jobs: [] as JobRow[],
  updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  // BullMQ orchestration-job state per executionId. undefined = no job.
  orchJob: new Map<
    string,
    { state: string; failedReason?: string; attemptsMade?: number } | undefined
  >(),
  /** Every runtime-env scope call the scan made, verbatim. */
  scanFilters: [] as Array<{ method: "eq" | "or"; args: string[] }>,
}))

vi.mock("../../supabase.js", () => {
  function from(table: string) {
    if (table === "workflow_executions") {
      return {
        select: () => ({
          in: () => ({
            lt: () => {
              // Production chain added .order(...).limit() — the order
              // call must be supported even though the mock doesn't use
              // its arguments (it just returns the predetermined dataset).
              const terminal = (rows: ExecutionRow[]) => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: rows, error: null }),
                }),
              })
              // The scan is scoped to this environment's rows (lib/runtime-env.ts).
              // The mock RECORDS the predicate AND APPLIES it, so a test can assert
              // both the filter string and the rows it actually excludes. Leaving
              // .order/.limit reachable unscoped keeps the pre-fix chain (every row,
              // regardless of environment) expressible — that is the bug shape.
              return {
                ...terminal(mocks.executions),
                eq: (column: string, value: string) => {
                  mocks.scanFilters.push({ method: "eq", args: [column, value] })
                  return terminal(
                    mocks.executions.filter((r) => (r.runtime_env ?? null) === value),
                  )
                },
                or: (filters: string) => {
                  mocks.scanFilters.push({ method: "or", args: [filters] })
                  // Interpret the predicate rather than restating its rule: the
                  // mock follows whatever `runtime_env.eq.X` / `runtime_env.is.null`
                  // terms the production string carries.
                  const terms = filters.split(",")
                  const allowed = terms
                    .filter((t) => t.startsWith("runtime_env.eq."))
                    .map((t) => t.slice("runtime_env.eq.".length))
                  const allowNull = terms.includes("runtime_env.is.null")
                  return terminal(
                    mocks.executions.filter((r) => {
                      const v = r.runtime_env ?? null
                      return v === null ? allowNull : allowed.includes(v)
                    }),
                  )
                },
              }
            },
          }),
        }),
        update: (updates: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            // Production now chains .select("id") after .neq for the
            // retry-aware writer; the mock continues to short-circuit
            // here regardless of which terminal pattern fires.
            neq: () => ({
              select: () => {
                mocks.updates.push({ id, updates })
                return Promise.resolve({ data: [{ id }], error: null })
              },
            }),
          }),
        }),
      }
    }
    if (table === "jobs") {
      // Path-2's select uses `node_id:input_data->>node_id` to project the
      // JSON field. The mock surfaces it as a top-level `node_id` so the
      // reconciler's `job.node_id` access matches production behavior.
      const project = (j: JobRow) => ({
        id: j.id,
        status: j.status,
        error_message: j.error_message,
        node_id: (j.input_data as Record<string, unknown> | null | undefined)?.node_id ?? null,
      })
      return {
        select: () => ({
          // Path-1 query: .select("id, status, error_message").in("id", [...])
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: mocks.jobs.filter((j) => ids.includes(j.id)).map(project),
              error: null,
            }),
          // Path-2 query: .select(...).eq("workflow_execution_id", X).in("status", [...])
          eq: (eqCol: string, eqVal: string) => ({
            in: (inCol: string, inVals: string[]) =>
              Promise.resolve({
                data: mocks.jobs
                  .filter((j) => {
                    if (eqCol === "workflow_execution_id" && j.workflow_execution_id !== eqVal) return false
                    if (inCol === "status" && !inVals.includes(j.status)) return false
                    return true
                  })
                  .map(project),
                error: null,
              }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  }
  return { supabase: { from } }
})

vi.mock("../../orchestration-queue.js", () => ({
  orchestrationQueue: {
    getJob: (jobId: string) => {
      const j = mocks.orchJob.get(jobId)
      if (!j) return Promise.resolve(null)
      return Promise.resolve({
        id: jobId,
        getState: () => Promise.resolve(j.state),
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
      })
    },
  },
}))

import { reconcileWorkflowExecutionsTick } from "../workflow-executions-cron.js"

describe("reconcileWorkflowExecutionsTick", () => {
  const SAVED_ENV: Record<string, string | undefined> = {}
  const ENV_KEYS = ["RUNTIME_ENV", "RAILWAY_ENVIRONMENT_NAME"] as const

  beforeEach(() => {
    mocks.executions.length = 0
    mocks.jobs.length = 0
    mocks.updates.length = 0
    mocks.orchJob.clear()
    mocks.scanFilters.length = 0
    for (const k of ENV_KEYS) {
      SAVED_ENV[k] = process.env[k]
      delete process.env[k]
    }
    // Default the suite to production: the cases below seed rows with no
    // runtime_env (the legacy, pre-374 shape), and production is the one
    // environment that reconciles those. Cross-environment cases set their own.
    process.env.RUNTIME_ENV = "production"
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (SAVED_ENV[k] === undefined) delete process.env[k]
      else process.env[k] = SAVED_ENV[k]
    }
  })

  /**
   * A `running` execution whose `started_at` is older than
   * `BACKOFF_FROM_START_MS` (2 min) but newer than
   * `STALE_EXECUTION_THRESHOLD_MS` (4h), with node states that are neither
   * all-completed nor any-failed — control reaches the final
   * orchestration-queue fallback rather than an earlier branch.
   */
  const seedRunningExecution = (id: string) => {
    mocks.executions.push({
      id,
      started_at: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
      node_states: { n1: { status: "running", jobId: `${id}-n1` } },
    })
    mocks.jobs.push({ id: `${id}-n1`, status: "processing", error_message: null })
  }

  it("marks an execution completed when all child jobs are completed in DB", async () => {
    mocks.executions.push({
      id: "exec-1",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
        n2: { status: "completed", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "completed", error_message: null },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].id).toBe("exec-1")
    expect(mocks.updates[0].updates.status).toBe("completed")
    // node_states should be reconciled (j1 was running → now completed)
    expect(mocks.updates[0].updates.node_states).toMatchObject({
      n1: { status: "completed" },
      n2: { status: "completed" },
    })
  })

  it("does NOT complete a crashed-mid-fan-out node (iterationTotal>1) from partial iterations", async () => {
    // Regression for the fan-out partial-resume DATA-LOSS: a fan-out node that
    // crashed mid-flight is "running" with iterationTotal=3 but only 1 iteration
    // job is terminal. Reconcile must NOT mark it (and thus the whole execution)
    // "completed" — its assembled output was never persisted, so the remaining
    // items would be silently dropped. It must be left for the orchestrator re-run.
    mocks.executions.push({
      id: "exec-fanout",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        fan: { status: "running", iterationTotal: 3 },
        done: { status: "completed", jobId: "jd" },
      },
    })
    mocks.jobs.push(
      { id: "fan-0", status: "completed", error_message: null, workflow_execution_id: "exec-fanout", input_data: { node_id: "fan" } },
      { id: "jd", status: "completed", error_message: null },
    )
    // Live orchestrator job → execution is not abandonable; it must simply wait.
    mocks.orchJob.set("exec-fanout", { state: "active" })

    await reconcileWorkflowExecutionsTick()

    // The execution must NOT be flipped to "completed" (that would drop iterations 1 & 2).
    expect(mocks.updates.find((u) => u.updates.status === "completed")).toBeUndefined()
  })

  it("skips an execution when child jobs are still pending/processing in DB AND BullMQ orchestrator job is active", async () => {
    mocks.executions.push({
      id: "exec-2",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
        n2: { status: "running", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "processing", error_message: null },
    )
    // Orchestrator is alive — cron should NOT touch this row.
    mocks.orchJob.set("exec-2", { state: "active" })

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(0)
  })

  it("marks an orphaned execution failed when no BullMQ orchestration job exists (the blind-spot path)", async () => {
    mocks.executions.push({
      id: "exec-orphan",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        // jobId is a placeholder that was never persisted to `jobs`
        n1: { status: "running", jobId: "exec-node_1" },
      },
    })
    // No matching `jobs` row → reconcileNodeStatesFromJobs returns unchanged
    // No orchestration BullMQ job → orphan branch fires
    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/orphaned/)
  })

  it("marks an execution failed when a child job failed and no others active", async () => {
    mocks.executions.push({
      id: "exec-3",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "completed", jobId: "j1" },
        n2: { status: "running", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "failed", error_message: "Provider 500" },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/reconciled by cron/)
  })

  it("marks an execution failed when older than the abandon threshold", async () => {
    mocks.executions.push({
      id: "exec-4",
      // 5 hours old — past the 4-hour threshold
      started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
      },
    })
    // jobs table returns nothing — job ID was lost / never persisted
    // (mocks.jobs is empty)

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/abandoned/)
  })

  it("emits no updates when there are no stuck rows", async () => {
    await reconcileWorkflowExecutionsTick()
    expect(mocks.updates).toHaveLength(0)
  })

  it("recovers via jobs.workflow_execution_id + input_data.node_id when node_states.jobId was never persisted", async () => {
    // Simulates the orchestrator dying between `INSERT INTO jobs` and the
    // fire-and-forget `updateExecution` that flushes node_states.jobId.
    // node_states says "running" with NO jobId, but a completed jobs row
    // tagged with `input_data.node_id === "n1"` exists for this execution.
    mocks.executions.push({
      id: "exec-recovered",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running" },
      },
    })
    mocks.jobs.push({
      id: "j-anon",
      status: "completed",
      error_message: null,
      workflow_execution_id: "exec-recovered",
      input_data: { type: "generate-video", node_id: "n1" },
    })

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("completed")
    expect(mocks.updates[0].updates.node_states).toMatchObject({
      n1: { status: "completed" },
    })
  })

  it("backfills node_states.jobId on Path-2 recovery so downstream lookups can trace the job", async () => {
    mocks.executions.push({
      id: "exec-backfill",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running" },
      },
    })
    mocks.jobs.push({
      id: "j-recovered",
      status: "completed",
      error_message: null,
      workflow_execution_id: "exec-backfill",
      input_data: { type: "generate-video", node_id: "n1" },
    })

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    const node_states = mocks.updates[0].updates.node_states as Record<string, { status: string; jobId?: string }>
    expect(node_states.n1.status).toBe("completed")
    // jobId is filled in from the recovered jobs row so a future
    // `reopenWorkflowExecutionIfSoleCause`-style lookup keyed on jobId can
    // still find the owning node.
    expect(node_states.n1.jobId).toBe("j-recovered")
  })

  it("preserves user cancellation — cancelled child jobs become 'skipped' node_states, not 'failed'", async () => {
    // User clicked Cancel mid-flight. Orchestrator marked child jobs
    // cancelled but died before writing execution.status='cancelled'. The
    // cron picks up the row; Path-2 must NOT collapse cancelled jobs into
    // a "failed" execution — that would surface as a misleading failure
    // for a deliberate user action.
    mocks.executions.push({
      id: "exec-cancel",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running" },
      },
    })
    mocks.jobs.push({
      id: "j-cancelled",
      status: "cancelled",
      error_message: "User cancellation",
      workflow_execution_id: "exec-cancel",
      input_data: { type: "generate-video", node_id: "n1" },
    })

    await reconcileWorkflowExecutionsTick()

    // Cancelled→skipped means allCompleted is true (completed/skipped both
    // count) and the execution row is marked completed, not failed.
    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("completed")
    expect(mocks.updates[0].updates.error_message).toBeUndefined()
    const node_states = mocks.updates[0].updates.node_states as Record<string, { status: string; error?: string }>
    expect(node_states.n1.status).toBe("skipped")
    expect(node_states.n1.error).toBe("User cancellation")
  })

  it("fan-out determinism: failed > cancelled > completed precedence regardless of row order", async () => {
    // Same node has multiple jobs (list iteration / retries). Without
    // per-node aggregation, the LAST iterated job's status wins and the
    // outcome depends on Supabase's row order. Verify that with mixed
    // statuses the precedence is failed > cancelled > completed.
    mocks.executions.push({
      id: "exec-fanout",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running" },
      },
    })
    // Push in this order: cancelled, completed, failed. The pre-aggregation
    // logic would have ended with whichever was iterated last.
    mocks.jobs.push(
      { id: "j-a", status: "cancelled", error_message: null, workflow_execution_id: "exec-fanout", input_data: { type: "generate-video", node_id: "n1" } },
      { id: "j-b", status: "completed", error_message: null, workflow_execution_id: "exec-fanout", input_data: { type: "generate-video", node_id: "n1" } },
      { id: "j-c", status: "failed", error_message: "Provider 500", workflow_execution_id: "exec-fanout", input_data: { type: "generate-video", node_id: "n1" } },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    const node_states = mocks.updates[0].updates.node_states as Record<string, { status: string; error?: string }>
    expect(node_states.n1.status).toBe("failed")
    expect(node_states.n1.error).toBe("Provider 500")
    // Execution is marked failed because n1 is failed and no others active.
    expect(mocks.updates[0].updates.status).toBe("failed")
  })

  it("fan-out: cancelled overrides completed but not failed (precedence holds in arbitrary order)", async () => {
    mocks.executions.push({
      id: "exec-fanout-cancel",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running" },
      },
    })
    mocks.jobs.push(
      { id: "j-x", status: "completed", error_message: null, workflow_execution_id: "exec-fanout-cancel", input_data: { type: "generate-video", node_id: "n1" } },
      { id: "j-y", status: "cancelled", error_message: null, workflow_execution_id: "exec-fanout-cancel", input_data: { type: "generate-video", node_id: "n1" } },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    const node_states = mocks.updates[0].updates.node_states as Record<string, { status: string }>
    // cancelled > completed in precedence — the user-cancel signal wins
    // over partial successes from earlier iterations.
    expect(node_states.n1.status).toBe("skipped")
    // Execution still marks completed (skipped + completed both count as
    // "done" for allCompleted).
    expect(mocks.updates[0].updates.status).toBe("completed")
  })

  it("leaves a prioritized orchestration job alone instead of orphaning its execution", async () => {
    seedRunningExecution("exec-prio")
    mocks.orchJob.set("exec-prio", { state: "prioritized" })
    await reconcileWorkflowExecutionsTick()
    expect(mocks.updates.find((u) => u.id === "exec-prio")).toBeUndefined()
  })

  it("leaves a waiting-children orchestration job alone", async () => {
    seedRunningExecution("exec-wc")
    mocks.orchJob.set("exec-wc", { state: "waiting-children" })
    await reconcileWorkflowExecutionsTick()
    expect(mocks.updates.find((u) => u.id === "exec-wc")).toBeUndefined()
  })

  it("leaves a delayed orchestration job alone", async () => {
    seedRunningExecution("exec-delayed")
    mocks.orchJob.set("exec-delayed", { state: "delayed" })
    await reconcileWorkflowExecutionsTick()
    expect(mocks.updates.find((u) => u.id === "exec-delayed")).toBeUndefined()
  })

  it("reports a BullMQ-failed orchestration job as a crash, not as orphaned — the reason stays out of error_message", async () => {
    // workflow_executions.error_message is rendered verbatim to users
    // (executions page tooltip, editor executions tab, published-app
    // runners) and has no error_detail sibling (unlike jobs, migration 368)
    // to hold raw diagnostic text. redactProviderDetail only strips
    // secrets/URLs, so a BullMQ string like "job stalled more than
    // allowable limit" would reach the user completely intact — it must
    // not be embedded in error_message at all. The plain sentence is what
    // the user sees; the reason goes to the log for admin/ops diagnosis.
    seedRunningExecution("exec-failed")
    mocks.orchJob.set("exec-failed", {
      state: "failed",
      failedReason: "job stalled more than allowable limit",
      attemptsMade: 3,
    })
    await reconcileWorkflowExecutionsTick()
    const update = mocks.updates.find((u) => u.id === "exec-failed")!.updates
    expect(update.status).toBe("failed")
    expect(update.error_message).toContain("orchestrator job failed")
    expect(update.error_message).not.toContain("job stalled")
    expect(update.error_message).not.toContain("orphaned")
  })

  // Minor 1 (2026-09-01 triage report): a job BullMQ fails for exceeding
  // `maxStalledCount` never actually re-attempts — `attemptsMade` stays 0 —
  // so "after 0 attempt(s)" read as a bug report rather than a diagnosis.
  it("drops the attempt count entirely when the job never attempted (maxStalledCount trip)", async () => {
    seedRunningExecution("exec-stalled")
    mocks.orchJob.set("exec-stalled", {
      state: "failed",
      failedReason: "job stalled more than allowable limit",
      attemptsMade: 0,
    })
    await reconcileWorkflowExecutionsTick()
    const update = mocks.updates.find((u) => u.id === "exec-stalled")!.updates
    expect(update.status).toBe("failed")
    expect(update.error_message).toContain("orchestrator job failed")
    expect(update.error_message).not.toContain("attempt")
  })

  it("still orphans an execution whose orchestration job is genuinely gone", async () => {
    seedRunningExecution("exec-gone")
    mocks.orchJob.set("exec-gone", undefined)
    await reconcileWorkflowExecutionsTick()
    const update = mocks.updates.find((u) => u.id === "exec-gone")!.updates
    expect(update.error_message).toContain("Execution orphaned")
  })

  it("logs the redacted failedReason for ops but keeps the raw reason and secrets out of error_message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      seedRunningExecution("exec-failed-secret")
      mocks.orchJob.set("exec-failed-secret", {
        state: "failed",
        failedReason:
          "fetch failed: https://r2.example.com/bucket/secret-key.png?token=abc123 unexpectedly",
        attemptsMade: 2,
      })
      await reconcileWorkflowExecutionsTick()
      const update = mocks.updates.find((u) => u.id === "exec-failed-secret")!.updates

      // error_message never carries the raw reason at all — not the URL,
      // not the secret, not even the redacted form.
      expect(update.error_message).not.toContain("secret-key")
      expect(update.error_message).not.toContain("token=abc123")
      expect(update.error_message).not.toContain("r2.example.com")
      expect(update.error_message).not.toContain("fetch failed")

      // The redacted reason DOES reach the log (admin/ops diagnosis), and
      // the log line itself never carries the un-redacted secret.
      const loggedCall = errorSpy.mock.calls.find((call) =>
        String(call[0]).includes("exec-failed-secret"),
      )
      expect(loggedCall).toBeDefined()
      const logged = String(loggedCall![0])
      expect(logged).toContain("r2.example.com/…")
      expect(logged).not.toContain("secret-key")
      expect(logged).not.toContain("token=abc123")
    } finally {
      errorSpy.mockRestore()
    }
  })
  // -------------------------------------------------------------------------
  // Cross-environment scoping (migration 374).
  //
  // Staging and production share one database and have separate Redis
  // instances, so before this scope existed each environment's cron saw the
  // other's healthy executions as orphaned and killed them mid-run.
  // -------------------------------------------------------------------------

  it("does NOT touch another environment's execution, even with no job in this queue", async () => {
    process.env.RUNTIME_ENV = "staging"
    seedRunningExecution("exec-prod-owned")
    mocks.executions[0].runtime_env = "production"
    // No orchestration job in THIS environment's Redis — production's job lives
    // in production's Redis, which staging cannot see. Pre-fix, this row was
    // marked "Execution orphaned" while production was still running it.
    mocks.orchJob.set("exec-prod-owned", undefined)

    await reconcileWorkflowExecutionsTick()

    expect(mocks.scanFilters).toEqual([{ method: "eq", args: ["runtime_env", "staging"] }])
    expect(mocks.updates).toEqual([])
  })

  it("DOES abandon its own environment's orphaned execution", async () => {
    process.env.RUNTIME_ENV = "staging"
    seedRunningExecution("exec-staging-owned")
    mocks.executions[0].runtime_env = "staging"
    mocks.orchJob.set("exec-staging-owned", undefined)

    await reconcileWorkflowExecutionsTick()

    expect(mocks.scanFilters).toEqual([{ method: "eq", args: ["runtime_env", "staging"] }])
    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].id).toBe("exec-staging-owned")
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toContain("Execution orphaned")
  })

  it("production also scans legacy rows (NULL runtime_env), and only those", async () => {
    process.env.RUNTIME_ENV = "production"
    seedRunningExecution("exec-legacy")       // no runtime_env → pre-374 row
    seedRunningExecution("exec-staging-live") // another environment's row
    mocks.executions[1].runtime_env = "staging"
    mocks.orchJob.set("exec-legacy", undefined)
    mocks.orchJob.set("exec-staging-live", undefined)

    await reconcileWorkflowExecutionsTick()

    expect(mocks.scanFilters).toEqual([
      { method: "or", args: ["runtime_env.eq.production,runtime_env.is.null"] },
    ])
    expect(mocks.updates.map((u) => u.id)).toEqual(["exec-legacy"])
  })

  it("reads the environment per tick — a redeploy under a new name re-scopes", async () => {
    process.env.RUNTIME_ENV = "staging"
    seedRunningExecution("exec-a")
    mocks.executions[0].runtime_env = "staging"
    mocks.orchJob.set("exec-a", undefined)
    await reconcileWorkflowExecutionsTick()

    process.env.RUNTIME_ENV = "preview-42"
    mocks.updates.length = 0
    await reconcileWorkflowExecutionsTick()

    expect(mocks.scanFilters).toEqual([
      { method: "eq", args: ["runtime_env", "staging"] },
      { method: "eq", args: ["runtime_env", "preview-42"] },
    ])
    expect(mocks.updates).toEqual([])
  })
})
