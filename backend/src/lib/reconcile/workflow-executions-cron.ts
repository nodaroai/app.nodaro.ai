/**
 * Periodic reconciler for stuck `workflow_executions` rows.
 *
 * The boot-time `cleanupStaleExecutions` in `orchestrator-worker.ts` only
 * fires once per process start, so it can't recover executions that get
 * stuck WHILE the orchestrator stays alive (lost wake-ups, DB write
 * failures, mid-flight crashes that the same process recovers from
 * automatically without rebooting). This cron runs every 90 seconds and
 * runs the same reconciliation logic against the same DB rows.
 *
 * Recovery latency: at most TICK_INTERVAL_MS + BACKOFF_FROM_START_MS.
 *
 * See `specs/stuck-execution-prevention-plan.md` for the broader design.
 */
import { supabase } from "../supabase.js"
import { orchestrationQueue } from "../orchestration-queue.js"
import { reconcileNodeStatesFromJobs } from "./node-states.js"
import { updateExecutionWithRetry } from "../execution-writes.js"
import type { NodeExecutionState } from "../../services/workflow-engine/types.js"

/**
 * 90 seconds. Pipelines and workflow executions take minutes, so this is
 * fast enough for user UX. Below this, you start hitting the orchestrator
 * during its own healthy operation; the `BACKOFF_FROM_START_MS` skip below
 * is the lower-bound safety so we never race a fresh execution.
 */
const TICK_INTERVAL_MS = 90_000

/**
 * Skip executions that started less than 2 minutes ago — a freshly-launched
 * orchestrator may not have written its first node_states update yet.
 * Reconciling that window would mis-mark healthy executions.
 */
const BACKOFF_FROM_START_MS = 120_000

/**
 * Absolute abandon threshold — 4 hours. Mirrors the constant in
 * `orchestrator-worker.ts::cleanupStaleExecutions`. Executions running
 * longer than this with no completed-state inference are marked failed.
 */
const STALE_EXECUTION_THRESHOLD_MS = 4 * 60 * 60 * 1000

/**
 * Per-tick scan cap. We don't want one degenerate workflow to monopolize
 * the cron tick; the next tick picks up any leftovers.
 */
const BATCH_LIMIT = 500

let intervalId: ReturnType<typeof setInterval> | null = null

export function startWorkflowExecutionsReconcileCron(): void {
  if (intervalId) return
  console.log("[reconcile/workflow-executions] Started, every 90 seconds")
  // Don't run on boot — `cleanupStaleExecutions` already handles that path.
  intervalId = setInterval(async () => {
    try {
      await reconcileWorkflowExecutionsTick()
    } catch (err) {
      console.error("[reconcile/workflow-executions] tick failed:", err)
    }
  }, TICK_INTERVAL_MS)
}

export function stopWorkflowExecutionsReconcileCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/** Exported for unit tests. Run-once equivalent of the cron tick. */
export async function reconcileWorkflowExecutionsTick(): Promise<void> {
  const start = Date.now()
  const now = Date.now()
  const backoffCutoff = new Date(now - BACKOFF_FROM_START_MS).toISOString()

  const { data: rows, error } = await supabase
    .from("workflow_executions")
    .select("id, started_at, node_states")
    .in("status", ["running", "stopping"])
    .lt("started_at", backoffCutoff)
    // Oldest-first ordering for the same reason as cleanupStaleExecutions:
    // a backlog with persistent write failures shouldn't re-process the
    // same heap-order rows on every tick.
    .order("started_at", { ascending: true, nullsFirst: false })
    .limit(BATCH_LIMIT)

  if (error) {
    console.error("[reconcile/workflow-executions] query failed:", error.message)
    return
  }
  if (!rows || rows.length === 0) return

  let scanned = 0
  let reconciledCompleted = 0
  let reconciledFailed = 0
  let abandoned = 0
  let skipped = 0
  let cancelledRaces = 0
  let writeFailures = 0

  /**
   * Run a terminal updateExecutionWithRetry call and update the right
   * counter based on the outcome. Mirrors the helper in
   * orchestrator-worker.ts::cleanupStaleExecutions — single source of
   * truth for counter semantics (cancelledRace and writeFailures are
   * distinct from "successful reconciliation").
   */
  async function tryTerminalWrite(
    rowId: string,
    updates: Record<string, unknown>,
    action: string,
    onSuccess: () => void,
  ): Promise<void> {
    try {
      const result = await updateExecutionWithRetry(rowId, updates)
      if (result.cancelledRace) {
        cancelledRaces++
        return
      }
      onSuccess()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error(
        `[reconcile/workflow-executions] failed to ${action} ${rowId}: ${detail}`,
      )
      writeFailures++
    }
  }

  for (const row of rows) {
    scanned++
    const rawStates = (row.node_states ?? {}) as Record<string, NodeExecutionState>
    const { next: states, changed } = await reconcileNodeStatesFromJobs(rawStates, row.id)

    const statuses = Object.values(states).map((s) => s?.status)
    const allCompleted = statuses.length > 0 && statuses.every((s) => s === "completed" || s === "skipped")
    const anyFailed = statuses.some((s) => s === "failed")
    const anyActive = statuses.some((s) => s === "pending" || s === "running")

    if (allCompleted) {
      const updates: Record<string, unknown> = {
        status: "completed",
        completed_at: new Date().toISOString(),
      }
      if (changed) updates.node_states = states
      await tryTerminalWrite(row.id, updates, "flip to completed", () => { reconciledCompleted++ })
      continue
    }

    if (anyFailed && !anyActive) {
      const updates: Record<string, unknown> = {
        status: "failed",
        error_message: "Execution failed — child job error (reconciled by cron)",
        completed_at: new Date().toISOString(),
      }
      if (changed) updates.node_states = states
      await tryTerminalWrite(row.id, updates, "flip to failed", () => { reconciledFailed++ })
      continue
    }

    // Null started_at: orchestrator never claimed the row. Treat as
    // immediately abandonable so the user can re-run. Non-null started_at
    // requires the >4h threshold to avoid racing a healthy orchestrator.
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0
    const isAbandonable =
      startedAt === 0 ||
      (startedAt > 0 && now - startedAt > STALE_EXECUTION_THRESHOLD_MS)

    if (isAbandonable) {
      await tryTerminalWrite(
        row.id,
        {
          status: "failed",
          error_message:
            startedAt === 0
              ? "Execution failed — orchestrator never claimed this row (never started)"
              : "Execution abandoned — no orchestrator activity for >4h",
          completed_at: new Date().toISOString(),
        },
        "mark abandoned",
        () => { abandoned++ },
      )
      continue
    }

    // Final fallback: the execution is still "running" / "stopping" past
    // the backoff window AND we couldn't infer terminality from child jobs.
    // If BullMQ has no active orchestration job for it, the orchestrator
    // died and left no recoverable state (e.g., node_states references
    // placeholder jobIds like `exec-node_X` that were never persisted to
    // the `jobs` table). Mark the execution failed so the user can re-run
    // instead of waiting 4 hours for the abandon threshold.
    //
    // Safe-by-construction race analysis: a normally-completing execution
    // updates `workflow_executions.status = 'completed'` BEFORE the BullMQ
    // job is removed (the orchestrator's DB write happens inside the
    // worker function; BullMQ only removes the job after the function
    // returns). So if we see `status='running'` AND no live BullMQ job,
    // the orchestrator is genuinely gone.
    const orchJob = await orchestrationQueue.getJob(row.id)
    if (orchJob) {
      const state = await orchJob.getState()
      if (state === "active" || state === "waiting" || state === "delayed") {
        // Orchestrator alive (or BullMQ has a stalled lock that will
        // expire). Leave alone — let the orchestrator (or BullMQ
        // stalled-retry) handle it.
        skipped++
        continue
      }
    }

    await tryTerminalWrite(
      row.id,
      {
        status: "failed",
        error_message: "Execution orphaned — no orchestrator job in queue (reconciled by cron)",
        completed_at: new Date().toISOString(),
      },
      "mark orphaned",
      () => { abandoned++ },
    )
  }

  if (reconciledCompleted > 0 || reconciledFailed > 0 || abandoned > 0 || cancelledRaces > 0 || writeFailures > 0) {
    console.log(
      `[reconcile/workflow-executions] tick: scanned=${scanned} completed=${reconciledCompleted} failed=${reconciledFailed} abandoned=${abandoned} skipped=${skipped} cancelled-races=${cancelledRaces} write-failures=${writeFailures} (${Date.now() - start}ms)`,
    )
  }
}
