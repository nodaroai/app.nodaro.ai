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
 * ONE ENVIRONMENT, ONE SCAN (migration 374). Several deployments can share a
 * single Supabase database while each has its OWN Redis — that is exactly how
 * staging (next.nodaro.ai) and production (app.nodaro.ai) run. The orphan gate
 * below asks `orchestrationQueue.getJob(row.id)`, which can only ever see jobs
 * THIS environment enqueued, so an execution belonging to another environment
 * looks orphaned no matter how healthy it is. Unscoped, this tick killed live
 * runs across the environment boundary (internal validation: a staging
 * execution marked "Execution orphaned" by production's cron 2m38s after it
 * started, while its nodes were still progressing — and the generation already
 * in flight was charged for output the closed execution could not deliver).
 * The scan is therefore scoped through `scopeToRuntimeEnv` (lib/runtime-env.ts),
 * the same helper the boot sweep uses. Rows claimed before 374 have a NULL
 * `runtime_env` and are reconciled by the environment named `production` only.
 *
 * SCOPING IS NOT ENOUGH, AND THE ORPHAN VERDICT NO LONGER RELIES ON IT.
 * `runtime_env` holds an environment NAME, which is unique within a Railway
 * project and nowhere else — so a second process that also calls itself
 * `production` against this database (a fork, a per-customer image, a staged
 * rollout, a developer running the server with a copied env file) inherits
 * production's rows plus its own empty Redis, and 374 does nothing. That
 * recurred on 2026-09-15: three live production executions were marked
 * orphaned 2–3.5 minutes after they started by a process no Railway
 * deployment's logs account for. The orphan branch therefore now demands
 * corroboration from the shared database before it writes — see
 * `executionLivenessEvidence` below.
 *
 * See the stuck-execution prevention design for the broader picture.
 */
import os from "node:os"
import { supabase } from "../supabase.js"
import { orchestrationQueue } from "../orchestration-queue.js"
import { ORCHESTRATOR_ALIVE_STATES, ORCHESTRATOR_LOCK_MS } from "../orchestration-queue-config.js"
import { IN_FLIGHT_JOB_STATUSES } from "../job-status.js"
import { reconcileNodeStatesFromJobs } from "./node-states.js"
import { updateExecutionWithRetry } from "../execution-writes.js"
import { redactProviderDetail } from "../provider-error-detail.js"
import { getRuntimeEnv, scopeToRuntimeEnv } from "../runtime-env.js"
import type { NodeExecutionState } from "../../services/workflow-engine/types.js"
import { STALE_EXECUTION_THRESHOLD_MS, staleExecutionThresholdMs } from "../job-budget.js"
import { executionBudgetExcessMs } from "../execution-budget.js"

/** Every queued-or-running BullMQ state for the orchestration queue — defined
 *  in the Redis-free leaf `../orchestration-queue-config.js` so
 *  `orchestrator-worker.ts`'s boot sweep (and both files' tests) can read it
 *  without opening this module's queue connection. Re-exported here because
 *  this module's orphan gate is its oldest consumer. */
export { ORCHESTRATOR_ALIVE_STATES } from "../orchestration-queue-config.js"

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

/*
 * Absolute abandon threshold — `STALE_EXECUTION_THRESHOLD_MS` (4 hours,
 * `lib/job-budget.ts`), the SAME constant `orchestrator-worker.ts ::
 * cleanupStaleExecutions` uses. Executions running longer than it with no
 * completed-state inference are marked failed — plus the budget excess of
 * any long render the run dispatched (Track 0.11): this branch runs BEFORE
 * the queue-liveness gate below, so without the excess it would write
 * "abandoned" onto a live run whose cap legitimately passed 4 hours.
 */

/**
 * Per-tick scan cap. We don't want one degenerate workflow to monopolize
 * the cron tick; the next tick picks up any leftovers.
 */
const BATCH_LIMIT = 500

/**
 * Who this process is, for the two orphan-gate log lines below. The verdict
 * "no orchestrator job in queue" is only ever as true as the Redis THIS
 * process is holding, so a log line about it that doesn't name the process is
 * not diagnosable — which is exactly what happened on 2026-09-15: three live
 * production executions were marked orphaned and NO deployment that runs this
 * code had logged a tick, because `skipped` is (deliberately) not in the
 * tick-log gate and the owning environment's cron had simply skipped them.
 * Identifying the writer then took a log crawl across six containers and
 * still failed.
 */
function processIdentity(): string {
  return `${getRuntimeEnv()}/${process.env.RAILWAY_ENVIRONMENT_ID ?? os.hostname()}`
}

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

/**
 * Is this execution demonstrably ALIVE, on evidence that does not depend on
 * which Redis this process happens to be holding?
 *
 * THE ORPHAN VERDICT NEEDS CORROBORATION. `orchestrationQueue.getJob(id)`
 * answers "is there a job in MY queue", and a `null` is read as "the
 * orchestrator is gone". That inference is only sound inside the one
 * deployment that owns the row. `runtime_env` (migration 374) was meant to
 * guarantee that, but it keys on the environment's NAME — which is unique
 * within a Railway project, not globally — so any second process that calls
 * itself `production` against the same database (a fork, a per-customer
 * image, a staged rollout, a developer running the server with a copied env
 * file) inherits production's rows and its own empty Redis, and kills live
 * runs. It happened on 2026-09-15: three of one user's runs were marked
 * orphaned 2–3.5 minutes after they started, while their nodes were still
 * completing; one lost 4 in-flight generations and 85 charged credits, and
 * two finished successfully but kept the failure text forever.
 *
 * So ask the SHARED source of truth instead — a row this process cannot be
 * wrong about because every deployment writes it to the same database:
 *
 *   1. a child `jobs` row still in flight (`IN_FLIGHT_JOB_STATUSES`, which
 *      includes `pending_review` — a job parked on a human is waiting, not
 *      orphaned), or
 *   2. a `node_states` timestamp written within `ORCHESTRATOR_LOCK_MS`. Only
 *      a live orchestrator writes those, and inside the lock window BullMQ
 *      itself has not yet declared the worker dead. This covers what (1)
 *      cannot see: the sub-second gap between one level's last child
 *      finishing and the next level's job rows existing, and nodes that run
 *      INLINE (no `jobs` row at all for their duration).
 *
 * Both signals are conservative — they only ever DELAY a verdict. The >4h
 * abandon branch above still fires on a genuinely dead run, and the 5-minute
 * child-job reconciler (`lib/reconcile/start.ts`) terminalizes stuck children,
 * after which the orphan branch is reached normally. The trade is explicit: a
 * dead run whose children are stuck `processing` waits for that sweep instead
 * of ~4 minutes, and in exchange a live run is never killed from outside.
 */
async function executionLivenessEvidence(
  executionId: string,
  states: Record<string, NodeExecutionState>,
  now: number,
): Promise<string | null> {
  // Freshly written node_states — no query, and the only signal that covers
  // inline nodes and the between-levels gap.
  for (const [nodeId, st] of Object.entries(states)) {
    for (const stamp of [st?.startedAt, st?.completedAt]) {
      if (typeof stamp !== "string" || !stamp) continue
      const t = Date.parse(stamp)
      if (Number.isNaN(t)) continue
      if (now - t < ORCHESTRATOR_LOCK_MS) {
        return `node ${nodeId} was updated ${Math.round((now - t) / 1000)}s ago`
      }
    }
  }

  // Worker-queued children: the `jobs` row carries the execution id.
  const { data: scoped } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("workflow_execution_id", executionId)
    .in("status", [...IN_FLIGHT_JOB_STATUSES])
  if (scoped && scoped.length > 0) {
    return `${scoped.length} child job(s) still in flight`
  }

  // Sync-HTTP children: their `jobs` row is created by the route, which has no
  // orchestrator context and leaves `workflow_execution_id` NULL
  // (node-executor.ts stamps only `input_data.node_id`). node_states is the
  // only link back to them, so look them up by id.
  const jobIds = new Set<string>()
  for (const st of Object.values(states)) {
    if (typeof st?.jobId === "string" && st.jobId) jobIds.add(st.jobId)
    if (Array.isArray(st?.jobIds)) {
      for (const jid of st.jobIds) if (typeof jid === "string" && jid) jobIds.add(jid)
    }
  }
  if (jobIds.size === 0) return null
  const { data: byId } = await supabase
    .from("jobs")
    .select("id, status")
    .in("id", Array.from(jobIds))
  const live = (byId ?? []).filter((j) =>
    (IN_FLIGHT_JOB_STATUSES as readonly string[]).includes(j.status as string),
  )
  return live.length > 0 ? `${live.length} child job(s) still in flight` : null
}

/** Exported for unit tests. Run-once equivalent of the cron tick. */
export async function reconcileWorkflowExecutionsTick(): Promise<void> {
  const start = Date.now()
  const now = Date.now()
  const backoffCutoff = new Date(now - BACKOFF_FROM_START_MS).toISOString()

  const scan = supabase
    .from("workflow_executions")
    .select("id, started_at, node_states")
    .in("status", ["running", "stopping"])
    .lt("started_at", backoffCutoff)

  // Only THIS environment's rows. Staging and production share one database
  // but have separate Redis instances, so `orchestrationQueue.getJob` below
  // can only ever find jobs this environment enqueued — without the scope,
  // every healthy execution of the other environment reads as orphaned and
  // gets killed mid-run. Same helper as the boot sweep, so they can't drift.
  const { data: rows, error } = await scopeToRuntimeEnv(scan)
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
  /** Orphan verdicts REFUSED because the database said the run was alive.
   *  Counted apart from `skipped` (and, unlike `skipped`, included in the
   *  tick log below) because a veto means this process's Redis and the shared
   *  database disagreed — i.e. this process does not own the row. */
  let vetoed = 0
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
    // LOAD-BEARING PARTITION. A job held in `pending_review` (the job-policy
    // hook, spec 2026-09-03-job-policy-hook-design D15) keeps its node at
    // `status: "running"` and carries the hold on the SIDECAR
    // `NodeExecutionState.awaitingReview` — precisely so this hand-rolled
    // partition keeps counting it. A fourth `NodeExecutionStatus` member would
    // make `anyActive` false and the `anyFailed && !anyActive` branch below
    // would flip a whole execution to `failed` while a child is legitimately
    // under human review. Both halves are pinned in
    // __tests__/workflow-executions-cron.test.ts ("D15 sidecar" / "PROOF of D15").
    //
    // The >4h abandon branch further down is a KNOWN gap for a very long
    // review (spec §18): orchestrated jobs are hold-ineligible in v1 (D8), so
    // it is unreachable until eligibility widens, and the fix belongs with
    // that widening (an execution-level roll-up), not here.
    const anyActive = statuses.some((s) => s === "pending" || s === "running")

    if (allCompleted) {
      const updates: Record<string, unknown> = {
        status: "completed",
        completed_at: new Date().toISOString(),
        // A completed run must not keep a failure sentence. An execution that
        // a sweep already wrote "Execution orphaned …" onto and that then
        // finished anyway kept it forever: `error_message` is rendered
        // verbatim (executions page tooltip, editor executions tab,
        // published-app runners), so the user saw a successful run reported
        // as orphaned. Observed on two production rows, 2026-09-15.
        error_message: null,
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
    // The run's budget excess (Track 0.11) is read only once the base
    // threshold has passed, so an execution with nothing budgeted costs no
    // extra query and is judged exactly as before.
    const isAbandonable =
      startedAt === 0 ||
      (startedAt > 0 && now - startedAt > STALE_EXECUTION_THRESHOLD_MS &&
        now - startedAt > staleExecutionThresholdMs(await executionBudgetExcessMs(row.id, states)))

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
      if (ORCHESTRATOR_ALIVE_STATES.has(state)) {
        // Orchestrator alive (or BullMQ has a stalled lock that will expire).
        // Leave alone — let the orchestrator (or the stalled re-pick) handle it.
        skipped++
        continue
      }
      if (state === "failed") {
        // The job is PRESENT and terminal-failed — the opposite of orphaned.
        // `workflow_executions.error_message` is rendered verbatim to users
        // (executions page tooltip, editor executions tab, published-app
        // runners) and has no `error_detail` sibling to hold raw diagnostic
        // text the way `jobs` does (migration 368). `redactProviderDetail`
        // only strips secrets/URLs — it would leave a BullMQ string like
        // "job stalled more than allowable limit" fully intact — so the
        // reason is NOT embedded in `error_message`; it goes to the log
        // (admin/ops diagnosis) and the user sees a plain, honest sentence.
        // This is what made the six 2026-08-23..09-01 rows undiagnosable —
        // the log line now carries the reason a log crawl needs.
        const attempts = orchJob.attemptsMade ?? 0
        // A job BullMQ fails for exceeding `maxStalledCount` never actually
        // re-attempts (it dies mid-run, repeatedly, without the worker
        // function returning) — `attemptsMade` stays 0. "after 0 attempt(s)"
        // reads as a bug report, not a diagnosis, so the phrase is dropped
        // entirely rather than naming a count that never happened.
        const attemptsSuffix = attempts > 0 ? ` after ${attempts} attempt(s)` : ""
        const reason = redactProviderDetail(orchJob.failedReason) ?? "unknown"
        console.error(
          `[reconcile/workflow-executions] execution ${row.id}: orchestrator job failed${attemptsSuffix}: ${reason}`,
        )
        await tryTerminalWrite(
          row.id,
          {
            status: "failed",
            error_message:
              `Execution failed — orchestrator job failed${attemptsSuffix} and could not be recovered (reconciled by cron)`,
            completed_at: new Date().toISOString(),
          },
          "mark orchestrator-job-failed",
          () => { abandoned++ },
        )
        continue
      }
    }

    // LAST GATE BEFORE A DESTRUCTIVE VERDICT. "No job in my queue" is not
    // evidence that the orchestrator is gone — only that it isn't in THIS
    // process's Redis. Ask the shared database before killing a user's run.
    const alive = await executionLivenessEvidence(row.id, states, Date.now())
    if (alive) {
      vetoed++
      console.warn(
        `[reconcile/workflow-executions] ${processIdentity()} found no orchestration job for execution ${row.id}, but the database says it is ALIVE (${alive}) — NOT marking it orphaned. This process does not own the row.`,
      )
      continue
    }

    console.warn(
      `[reconcile/workflow-executions] ${processIdentity()} marking execution ${row.id} orphaned (started_at=${row.started_at}): no orchestration job in this queue and no live child job or recent node activity.`,
    )
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

  if (reconciledCompleted > 0 || reconciledFailed > 0 || abandoned > 0 || vetoed > 0 || cancelledRaces > 0 || writeFailures > 0) {
    console.log(
      `[reconcile/workflow-executions] tick: scanned=${scanned} completed=${reconciledCompleted} failed=${reconciledFailed} abandoned=${abandoned} vetoed=${vetoed} skipped=${skipped} cancelled-races=${cancelledRaces} write-failures=${writeFailures} (${Date.now() - start}ms)`,
    )
  }
}
