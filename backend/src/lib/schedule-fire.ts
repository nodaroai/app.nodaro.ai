/**
 * How a scheduled execution is admitted, written and enqueued — ONE path for
 * the schedule cron's fires (`schedule-cron.ts`) and the retry sweep's
 * retries of them (`schedule-retry-sweep.ts`), so a retry is created exactly
 * the way the fire it retries was.
 */

import { SCHEDULE_TRIGGER_NODE_TYPE, normalizeScheduleRetry } from "@nodaro/shared/workflow"
import { supabase } from "./supabase.js"
import { orchestrationQueue } from "./orchestration-queue.js"
import { canRunWorkflow } from "./workflow-access.js"
import { resolveBillingContext, shouldRefuseDegradedRunFor, type BillingContext } from "./billing-context.js"
import { billingPairColumns } from "./insert-job.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { refusePreviewFire } from "./preview-fire-refusal.js"
import type { ScheduleRetryStamp } from "./schedule-retry.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

export const UNIQUE_VIOLATION = "23505"

/** The trigger row columns a fire reads. */
export interface ScheduleTriggerRow {
  readonly id: string
  readonly workflow_id: string
  readonly user_id: string
  readonly config: Record<string, unknown>
  /** The value the tick READ — what the claim moves from (`claimTick`). */
  readonly last_triggered_at: string | null
}

/**
 * May this trigger start a run at all? Asked BEFORE anything is claimed or
 * written, by the cron and the retry sweep alike:
 *
 * - Does the trigger's owner STILL have the right to run this workflow? The
 *   same question the webhook fire path asks, for the same reason: a trigger
 *   outlives the session that created it, and a collaborator who created one
 *   can later lose the grant, be suspended, or watch the workspace be
 *   archived. Skipped, not deactivated — `canRunWorkflow` returns false for
 *   a transient outage too, and a cron that turned a Redis blip into a
 *   permanently dead schedule would be worse than one that quietly skips a
 *   tick and tries again next interval. The owner gets ONE visible failed
 *   row (deduped) instead of a history that silently stops (P14/W6).
 * - The branch stops at a Preview render nobody is there to review: refused,
 *   leaving the owner one deduped failed row.
 */
export async function admitScheduleTrigger(trigger: ScheduleTriggerRow, nodeId: string | null): Promise<boolean> {
  if (!(await canRunWorkflow(trigger.user_id, trigger.workflow_id))) {
    await recordTriggerFireRefusal({
      workflowId: trigger.workflow_id,
      userId: trigger.user_id,
      triggerType: "schedule",
      triggerId: trigger.id,
    })
    return false
  }

  return !(await refusePreviewFire({
    workflowId: trigger.workflow_id,
    userId: trigger.user_id,
    triggerType: "schedule",
    triggerId: trigger.id,
    triggerNodeId: nodeId,
  }))
}

/**
 * P14: the payer, resolved at FIRE TIME (same rule as the webhook fire); the
 * row carries the pair (W7), the payload carries the context. A DEGRADED
 * resolve on WORKSPACE-HOMED (or unreadable-home) work skips the tick (the
 * next one retries) rather than billing the owner's pocket — the ONE
 * fail-closed probe. Null when the run must not be created this tick.
 */
export async function resolveScheduleBilling(trigger: ScheduleTriggerRow, log: string): Promise<BillingContext | null> {
  const billingContext = await resolveBillingContext({
    userId: trigger.user_id,
    workflowId: trigger.workflow_id,
  })
  if (await shouldRefuseDegradedRunFor(billingContext, trigger.workflow_id)) {
    console.error(`${log} degraded billing resolve on workspace workflow ${trigger.workflow_id} — tick skipped`)
    return null
  }
  return billingContext
}

/**
 * An execution THIS OWNER already has pending or running. Scoped to them
 * like the webhook path and the run route: before workflows were shared, "an
 * active execution of this workflow" and "an active execution of mine" were
 * the same set, and leaving it workflow-wide would let one member's manual
 * run suppress another member's scheduled one.
 */
export async function hasActiveExecution(trigger: Pick<ScheduleTriggerRow, "workflow_id" | "user_id">): Promise<boolean> {
  const { data: activeExec } = await supabase
    .from("workflow_executions")
    .select("id")
    .eq("workflow_id", trigger.workflow_id)
    .eq("user_id", trigger.user_id)
    .in("status", ["pending", "running"])
    .limit(1)
  return Array.isArray(activeExec) && activeExec.length > 0
}

export interface ScheduleExecutionArgs {
  readonly trigger: ScheduleTriggerRow
  /** The node this row was projected from: the worker runs the branch behind it. A hand-made row names none. */
  readonly nodeId: string | null
  readonly now: Date
  /**
   * What `{{trigger.last_triggered_at}}` filters compare against ("fetch items
   * newer than the previous run"): the fire before this one — and, for a
   * retry, the SAME value the failed run carried, so it reads the same window.
   */
  readonly previousLastTriggeredAt: string | null
  readonly billingContext: BillingContext
  /** The row's claim: the unique (user_id, idempotency_key) index refuses a duplicate whatever wrote it. */
  readonly idempotencyKey: string
  /** A retry's place in its chain; absent on a scheduled fire. */
  readonly retry?: ScheduleRetryStamp
}

export type ScheduleExecutionInsert =
  | { readonly ok: true; readonly executionId: string }
  | { readonly ok: false; readonly duplicate: boolean }

/**
 * Write the execution row and hand it to the orchestrator. The row's
 * `trigger_data` is the lane's own fixed keys (never caller data): the fire
 * time, the schedule, the previous fire, and a retry's stamp.
 *
 * A duplicate key means this fire (or this retry attempt) already has its
 * run — `duplicate: true`, nothing enqueued. Any other insert failure leaves
 * no run behind (`duplicate: false`), so the caller may give its claim back.
 */
export async function createScheduleExecution(args: ScheduleExecutionArgs): Promise<ScheduleExecutionInsert> {
  const { trigger, now, previousLastTriggeredAt, billingContext } = args
  const config = trigger.config
  const { data: execution, error: execError } = await supabase
    .from("workflow_executions")
    .insert({
      workflow_id: trigger.workflow_id,
      user_id: trigger.user_id,
      status: "pending",
      trigger_type: "schedule",
      ...billingPairColumns(billingContext),
      trigger_data: {
        timestamp: now.toISOString(),
        cron: config.cron,
        rules: config.rules,
        last_triggered_at: previousLastTriggeredAt,
        ...(args.retry ? { retry: args.retry } : {}),
      },
      idempotency_key: args.idempotencyKey,
    })
    .select("id")
    .single()

  if (execError || !execution) {
    return { ok: false, duplicate: execError?.code === UNIQUE_VIOLATION }
  }

  // Whether this schedule's runs count as the workflow OWNER'S OWN — the
  // only lane a PLAIN stored credential may travel on (plan D3) — is a
  // stored fact about the trigger, writable only by the backend
  // (migration 436): stamped when the owner's own browser session created
  // the row — the editor's sync after a save that ADDED the node
  // (POST /v1/workflows/:id/sync-triggers), or POST /v1/workflow-triggers.
  // A token's or an app's graph write, and every other lane, leaves the
  // default. Never re-derived here: uuid equality would say "owner" for a
  // token-created schedule too. Read best-effort: on a database the column
  // has not reached yet this fails closed and the schedule still fires.
  const ownerInitiated = await readOwnerInitiated(trigger.id)

  await orchestrationQueue.add("workflow-execution", buildScheduleJob(args, execution.id, ownerInitiated), {
    jobId: execution.id,
  })

  return { ok: true, executionId: execution.id }
}

/** The orchestrator job for a scheduled execution (a fire's or a retry's). */
export function buildScheduleJob(args: ScheduleExecutionArgs, executionId: string, ownerInitiated: boolean): WorkflowExecutionJob {
  const { trigger, nodeId, now, previousLastTriggeredAt, billingContext } = args
  // Cheap lanes only (decided 2026-10-20): with the trigger's retry policy
  // saying so, the model calls this run makes that honour the flag stay on
  // the aggregator lane — a KIE failure is not re-asked on the vendor's own,
  // pricier API; the run fails and the retry sweep handles it. The original
  // scheduled run and its retries alike, read from the trigger's CURRENT
  // config at fire time.
  const cheapLanesOnly = normalizeScheduleRetry(trigger.config.retry)?.cheapLanesOnly === true
  return {
    executionId,
    workflowId: trigger.workflow_id,
    userId: trigger.user_id,
    triggerType: "schedule",
    ownerInitiated,
    // The node this row was projected from: the worker runs the branch
    // behind it (`triggerRunScope`). A hand-made row names none.
    ...(nodeId ? { triggerNodeId: nodeId } : {}),
    triggerData: {
      timestamp: now.toISOString(),
      last_triggered_at: previousLastTriggeredAt,
    },
    billingContext,
    // Nobody watches a scheduled run: it cannot review a Preview render.
    reviewerPresent: false,
    ...(cheapLanesOnly ? { cheapLanesOnly: true } : {}),
  }
}

/**
 * The per-trigger claim every scheduled execution takes BEFORE it is written
 * — a fire and a retry alike, so the two serialize on ONE row: a tick's fire
 * and the sweep's retry of the same trigger, on two replicas, cannot both
 * land. `last_triggered_at` moves from the value the caller READ to
 * `claimedAt` only if it still holds that value; true when this call won.
 * Every process that reads the row races here, and only one update can
 * match — zero rows back means someone else claimed, so skip. A failed write
 * claims nothing (the tick is skipped, the next one retries).
 *
 * A retry therefore moves `last_triggered_at` too: for the next fire it is
 * the schedule's latest run time (a legacy `interval` schedule counts its
 * next run from it; a rules / cron schedule reads it only as "fired this
 * minute"), and the retry itself carries the FAILED run's previous-fire time
 * in its own row and payload, so what it reads is what the failed run read.
 */
export async function claimTick(triggerId: string, previous: string | null, claimedAt: string): Promise<boolean> {
  const update = supabase.from("workflow_triggers").update({ last_triggered_at: claimedAt }).eq("id", triggerId)
  const conditional = previous === null ? update.is("last_triggered_at", null) : update.eq("last_triggered_at", previous)
  const { data, error } = await conditional.select("id")
  if (error) {
    console.error(`[schedule-fire] could not claim trigger ${triggerId}: ${error.message}`)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/** Give a claim back — only while the row still carries it, so a later claim is never undone. */
export async function releaseTick(triggerId: string, claimedAt: string, previous: string | null): Promise<void> {
  const { error } = await supabase
    .from("workflow_triggers")
    .update({ last_triggered_at: previous })
    .eq("id", triggerId)
    .eq("last_triggered_at", claimedAt)
  if (error) console.error(`[schedule-fire] could not release the claim on trigger ${triggerId}: ${error.message}`)
}

/**
 * True only when the graph was read and carries no schedule-trigger node with
 * this id. The graph is the single source of truth for a node-managed
 * schedule: a row whose node is gone is an orphan (a save lane that did not
 * project the removal). The cron deletes such a row; the retry sweep only
 * refuses to run it. An unreadable graph changes nothing this tick.
 */
export async function scheduleNodeGone(workflowId: string, nodeId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("workflows").select("nodes").eq("id", workflowId).maybeSingle()
    if (error || !data || !Array.isArray(data.nodes)) return false
    const nodes = data.nodes as Array<{ id?: unknown; type?: unknown }>
    return !nodes.some((n) => n.id === nodeId && n.type === SCHEDULE_TRIGGER_NODE_TYPE)
  } catch {
    return false
  }
}

let provenanceWarned = false
/** Once per process: the flag read failing every minute is one fact, not sixty log lines an hour. */
function warnProvenanceUnreadableOnce(reason: string): void {
  if (provenanceWarned) return
  provenanceWarned = true
  console.warn(`[schedule-fire] workflow_triggers.owner_initiated unreadable (${reason}) — schedules run as not owner-initiated until migration 436 is on this database`)
}

async function readOwnerInitiated(triggerId: string): Promise<boolean> {
  try {
    const { data: provenance, error: provenanceError } = await supabase
      .from("workflow_triggers")
      .select("owner_initiated")
      .eq("id", triggerId)
      .maybeSingle()
    if (provenanceError) warnProvenanceUnreadableOnce(provenanceError.message)
    return provenance?.owner_initiated === true
  } catch (err) {
    warnProvenanceUnreadableOnce(err instanceof Error ? err.message : String(err))
    return false
  }
}
